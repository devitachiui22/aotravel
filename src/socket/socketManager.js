const pool = require('../config/db');
const { logSystem, logError } = require('../utils/logger');
const { getDistance } = require('../utils/helpers');
const { getFullRideDetails } = require('../utils/queries');

function initializeSocket(io) {
    io.on('connection', (socket) => {
        logSystem('SOCKET', `Nova conexão estabelecida: ${socket.id}`);

        // GESTÃO DE SALAS
        socket.on('join_user', async (userId) => {
            if (!userId) return;
            const roomName = `user_${userId}`;
            socket.join(roomName);
            try {
                await pool.query("UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1", [userId]);
                const userRes = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
                if (userRes.rows[0]?.role === 'driver') {
                    await pool.query(
                        `INSERT INTO driver_positions (driver_id, socket_id, last_update) VALUES ($1, $2, NOW())
                         ON CONFLICT (driver_id) DO UPDATE SET socket_id = $2, last_update = NOW()`,
                        [userId, socket.id]
                    );
                }
                logSystem('ROOM', `Usuário ${userId} agora ONLINE na sala: ${roomName}`);
            } catch (e) { logError('JOIN_USER', e); }
        });

        // JOIN RIDE
        socket.on('join_ride', (ride_id) => {
            if (!ride_id) { logError('ROOM_JOIN', 'Tentativa de ingresso negada: ID da corrida é nulo.'); return; }
            const roomName = `ride_${ride_id}`;
            try {
                socket.rooms.forEach((room) => {
                    if (room.startsWith('ride_') && room !== roomName) { socket.leave(room); logSystem('ROOM_CLEAN', `Socket ${socket.id} removido da sala residual: ${room}`); }
                });
                socket.join(roomName);
                logSystem('ROOM', `Socket ${socket.id} estabeleceu link seguro na sala: ${roomName}`);
                socket.emit('ride_room_confirmed', { ride_id: ride_id, status: 'connected', timestamp: new Date().toISOString() });
            } catch (e) {
                logError('ROOM_JOIN_CRITICAL', e);
                socket.emit('error_response', { message: "Erro ao sincronizar com a sala da missão." });
            }
        });

        // UPDATE LOCATION
        socket.on('update_location', async (data) => {
            const { user_id, lat, lng, heading } = data;
            if (!user_id) return;
            try {
                await pool.query(
                    `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update, socket_id) VALUES ($1, $2, $3, $4, NOW(), $5)
                     ON CONFLICT (driver_id) DO UPDATE SET lat = $2, lng = $3, heading = $4, last_update = NOW(), socket_id = $5`,
                    [user_id, lat, lng, heading || 0, socket.id]
                );
                const pendingRides = await pool.query(`SELECT * FROM rides WHERE status = 'searching' AND created_at > NOW() - INTERVAL '10 minutes'`);
                if (pendingRides.rows.length > 0) {
                    pendingRides.rows.forEach(ride => {
                        const dist = getDistance(lat, lng, ride.origin_lat, ride.origin_lng);
                        if (dist <= 12.0) {
                            io.to(socket.id).emit('ride_opportunity', { ...ride, distance_to_driver: dist });
                            logSystem('RADAR_REVERSO', `Notificando motorista ${user_id} sobre pedido ${ride.id}`);
                        }
                    });
                }
            } catch (e) { logError('UPDATE_LOCATION', e); }
        });

        // REQUEST RIDE
        socket.on('request_ride', async (data) => {
            const { passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km } = data;
            logSystem('RIDE_REQUEST', `Passageiro ${passenger_id} solicitando corrida.`);
            try {
                const result = await pool.query(
                    `INSERT INTO rides (passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, final_price, ride_type, distance_km, status, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW()) RETURNING *`,
                    [passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km]
                );
                const ride = result.rows[0];
                socket.join(`ride_${ride.id}`);
                io.to(`user_${passenger_id}`).emit('searching_started', ride);

                const driversRes = await pool.query(`
                    SELECT dp.*, u.name, u.photo, u.rating, u.vehicle_details FROM driver_positions dp
                    JOIN users u ON dp.driver_id = u.id
                    WHERE u.is_online = true AND u.role = 'driver' AND u.is_blocked = false AND dp.last_update > NOW() - INTERVAL '30 minutes'
                `);
                const nearbyDrivers = driversRes.rows.filter(d => getDistance(origin_lat, origin_lng, d.lat, d.lng) <= 15.0);
                if (nearbyDrivers.length === 0) {
                    logSystem('RIDE_REQUEST', `Zero motoristas imediatos encontrados.`);
                    io.to(`user_${passenger_id}`).emit('no_drivers_available', { ride_id: ride.id, message: "Procurando motoristas próximos..." });
                } else {
                    logSystem('RIDE_REQUEST', `Notificando ${nearbyDrivers.length} motoristas próximos.`);
                    nearbyDrivers.forEach(d => {
                        io.to(`user_${d.driver_id}`).emit('ride_opportunity', { ...ride, distance_to_driver: getDistance(origin_lat, origin_lng, d.lat, d.lng) });
                    });
                }
            } catch (e) {
                logError('RIDE_REQUEST', e);
                io.to(`user_${passenger_id}`).emit('error', { message: "Erro ao processar solicitação." });
            }
        });

        // ACCEPT RIDE
        socket.on('accept_ride', async (data) => {
            const { ride_id, driver_id, final_price } = data;
            logSystem('ACCEPT', `Motorista ${driver_id} tentando aceitar Ride ${ride_id}`);
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const checkRes = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
                if (checkRes.rows.length === 0) { await client.query('ROLLBACK'); return socket.emit('error_response', { message: "Corrida não encontrada." }); }
                const ride = checkRes.rows[0];
                if (ride.status !== 'searching') { await client.query('ROLLBACK'); return socket.emit('error_response', { message: "Esta corrida já foi aceita." }); }

                await client.query(
                    `UPDATE rides SET driver_id = $1, final_price = COALESCE($2, initial_price), status = 'accepted', accepted_at = NOW() WHERE id = $3`,
                    [driver_id, final_price, ride_id]
                );
                await client.query('COMMIT');
                logSystem('MATCH', `Corrida ${ride_id} confirmada no DB.`);
                
                const fullData = await getFullRideDetails(ride_id);
                socket.join(`ride_${ride_id}`);
                io.to(`user_${ride.passenger_id}`).emit('match_found', fullData);
                io.to(`user_${driver_id}`).emit('match_found', fullData);
                io.to(`ride_${ride_id}`).emit('match_found', fullData);
                logSystem('SUCCESS', `Match Finalizado: Passageiro ${ride.passenger_id} <-> Motorista ${driver_id}`);
            } catch (e) {
                if (client) await client.query('ROLLBACK');
                logError('ACCEPT_CRITICAL', e);
                socket.emit('error_response', { message: "Erro interno ao processar aceite." });
            } finally { client.release(); }
        });

        // SEND MESSAGE
        socket.on('send_message', async (data) => {
            const { ride_id, sender_id, text, file_data } = data;
            if (!ride_id || !sender_id) return console.error("❌ CHAT: Dados incompletos", data);
            try {
                const userRes = await pool.query("SELECT name, photo FROM users WHERE id = $1", [sender_id]);
                const sender = userRes.rows[0] || { name: "Usuário", photo: null };
                const finalText = text && text.trim() !== '' ? text : (file_data ? '📷 Foto enviada' : '');
                
                const res = await pool.query(
                    `INSERT INTO chat_messages (ride_id, sender_id, text, file_data, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
                    [ride_id, sender_id, finalText, file_data || null]
                );
                const fullMsg = { ...res.rows[0], sender_name: sender.name, sender_photo: sender.photo };
                io.to(`ride_${ride_id}`).emit('receive_message', fullMsg);
                if (typeof logSystem === 'function') logSystem('CHAT', `Msg de ${sender.name} na Ride ${ride_id}`);

                (async () => {
                    try {
                        const rideRes = await pool.query('SELECT passenger_id, driver_id FROM rides WHERE id = $1', [ride_id]);
                        if (rideRes.rows.length > 0) {
                            const ride = rideRes.rows[0];
                            const recipientId = (String(sender_id) === String(ride.passenger_id)) ? ride.driver_id : ride.passenger_id;
                            if (recipientId) {
                                const isRecipientOnline = io.sockets.adapter.rooms.has(`user_${recipientId}`);
                                await pool.query(
                                    `INSERT INTO notifications (user_id, title, body, type, data, created_at) VALUES ($1, $2, $3, 'chat', $4, NOW())`,
                                    [recipientId, `Nova mensagem de ${sender.name}`, finalText.length > 60 ? finalText.substring(0, 60) + '...' : finalText, JSON.stringify({ ride_id, sender_id, type: 'chat' })]
                                );
                                if (isRecipientOnline) io.to(`user_${recipientId}`).emit('new_notification', { type: 'chat', ride_id: ride_id });
                            }
                        }
                    } catch (notifErr) { console.error("⚠️ Erro ao processar notificação de chat:", notifErr.message); }
                })();
            } catch (e) {
                logError('CHAT_CRITICAL', e);
                socket.emit('error_message', { error: "Erro ao processar sua mensagem." });
            }
        });

        // UPDATE PRICE
        socket.on('update_price_negotiation', async (data) => {
            const { ride_id, new_price } = data;
            try {
                await pool.query("UPDATE rides SET final_price = $1 WHERE id = $2", [new_price, ride_id]);
                io.to(`ride_${ride_id}`).emit('price_updated', { new_price, updated_at: new Date().toISOString() });
            } catch (e) { logError('PRICE', e); }
        });

        // START TRIP
        socket.on('start_trip', async (data) => {
            const { ride_id } = data;
            try {
                await pool.query("UPDATE rides SET status = 'ongoing', started_at = NOW() WHERE id = $1", [ride_id]);
                const fullData = await getFullRideDetails(ride_id);
                io.to(`ride_${ride_id}`).emit('trip_started_now', { full_details: fullData, status: 'ongoing', started_at: new Date().toISOString() });
            } catch (e) { logError('START_TRIP', e); }
        });

        // UPDATE TRIP GPS
        socket.on('update_trip_gps', (data) => {
            const { ride_id, lat, lng, rotation } = data;
            socket.to(`ride_${ride_id}`).emit('driver_location_update', { lat, lng, rotation, timestamp: new Date().toISOString() });
        });

        // CANCEL RIDE
        socket.on('cancel_ride', async (data) => {
            const { ride_id, role, reason } = data;
            logSystem('CANCEL', `Ride ${ride_id} cancelada por ${role}.`);
            try {
                await pool.query(
                    `UPDATE rides SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, cancellation_reason = $2 WHERE id = $3`,
                    [role, reason || 'Cancelado pelo usuário', ride_id]
                );
                const message = role === 'driver' ? "O motorista cancelou a viagem." : "O passageiro cancelou a solicitação.";
                io.to(`ride_${ride_id}`).emit('ride_terminated', { reason: message, origin: role, can_restart: true, cancelled_at: new Date().toISOString() });
                const details = await getFullRideDetails(ride_id);
                if (details) {
                    const otherUserId = role === 'driver' ? details.passenger_id : details.driver_id;
                    if (otherUserId) io.to(`user_${otherUserId}`).emit('ride_terminated', { reason: message, origin: role });
                }
            } catch (e) { logError('CANCEL', e); }
        });

        // DISCONNECT
        socket.on('disconnect', async () => {
            logSystem('SOCKET', `Conexão sinalizada como encerrada: ${socket.id}`);
            try {
                const res = await pool.query("SELECT driver_id FROM driver_positions WHERE socket_id = $1", [socket.id]);
                if (res.rows.length > 0) {
                    const driverId = res.rows[0].driver_id;
                    setTimeout(async () => {
                        try {
                            const checkReconnection = await pool.query("SELECT socket_id FROM driver_positions WHERE driver_id = $1", [driverId]);
                            if (checkReconnection.rows.length > 0 && checkReconnection.rows[0].socket_id === socket.id) {
                                await pool.query("UPDATE users SET is_online = false WHERE id = $1", [driverId]);
                                logSystem('OFFLINE', `Motorista ${driverId} realmente desconectado.`);
                            } else {
                                logSystem('SOCKET', `Motorista ${driverId} reconectou com sucesso.`);
                            }
                        } catch (innerError) { logError('DISCONNECT_TIMEOUT_CRITICAL', innerError); }
                    }, 20000);
                }
            } catch (e) { logError('DISCONNECT_HANDLER_FAILURE', e); }
        });
    });
}

module.exports = initializeSocket;