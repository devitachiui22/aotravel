const { pool } = require('../config/db');
const { logSystem, logError } = require('../utils/logger');
const { getDistance } = require('../utils/helpers');
const { getFullRideDetails } = require('../utils/queries');

/**
 * =================================================================================================
 * 🛰️ TITANIUM SOCKET MANAGER - FULL VERSION
 * =================================================================================================
 */
function initializeSocket(io) {
    io.on('connection', (socket) => {
        logSystem('SOCKET', `Nova conexão estabelecida: ${socket.id}`);

        // 1. GESTÃO DE ENTRADA DO USUÁRIO (Individual)
        socket.on('join_user', async (userId) => {
            if (!userId) return;
            const roomName = `user_${userId}`;
            socket.join(roomName);
            try {
                // Marca usuário como online e atualiza socket_id se for motorista
                await pool.query("UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1", [userId]);

                const userRes = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
                if (userRes.rows[0]?.role === 'driver') {
                    await pool.query(
                        `INSERT INTO driver_positions (driver_id, socket_id, last_update) VALUES ($1, $2, NOW())
                         ON CONFLICT (driver_id) DO UPDATE SET socket_id = $2, last_update = NOW()`,
                        [userId, socket.id]
                    );
                }
                logSystem('ROOM', `Usuário ${userId} ONLINE na sala privada: ${roomName}`);
            } catch (e) {
                logError('JOIN_USER', e);
            }
        });

        // 2. JOIN RIDE (Sincronia Total de Sala de Corrida)
        socket.on('join_ride', (ride_id) => {
            if (!ride_id) {
                logError('ROOM_JOIN', 'Tentativa de ingresso negada: ID da corrida é nulo.');
                return;
            }
            const roomName = `ride_${ride_id}`;
            try {
                // Limpeza de salas residuais para evitar duplicidade de mensagens
                socket.rooms.forEach((room) => {
                    if (room.startsWith('ride_') && room !== roomName) {
                        socket.leave(room);
                        logSystem('ROOM_CLEAN', `Socket ${socket.id} removido da sala antiga: ${room}`);
                    }
                });

                socket.join(roomName);
                logSystem('ROOM', `[TITAN] Socket ${socket.id} entrou na missão: ${roomName}`);

                // Confirmação para o cliente
                socket.emit('ride_room_confirmed', {
                    ride_id,
                    status: 'connected',
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                logError('ROOM_JOIN_CRITICAL', e);
                socket.emit('error_response', { message: "Erro ao sincronizar com a sala da corrida." });
            }
        });

        // 3. ATUALIZAÇÃO DE LOCALIZAÇÃO E RADAR
        socket.on('update_location', async (data) => {
            const { user_id, lat, lng, heading } = data;
            if (!user_id) return;
            try {
                await pool.query(
                    `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update, socket_id)
                     VALUES ($1, $2, $3, $4, NOW(), $5)
                     ON CONFLICT (driver_id) DO UPDATE SET lat = $2, lng = $3, heading = $4, last_update = NOW(), socket_id = $5`,
                    [user_id, lat, lng, heading || 0, socket.id]
                );

                // Radar Reverso: Busca pedidos pendentes próximos
                const pendingRides = await pool.query(
                    `SELECT * FROM rides WHERE status = 'searching' AND created_at > NOW() - INTERVAL '10 minutes'`
                );

                pendingRides.rows.forEach(ride => {
                    const dist = getDistance(lat, lng, ride.origin_lat, ride.origin_lng);
                    if (dist <= 10.0) { // Raio de 10km
                        io.to(socket.id).emit('ride_opportunity', { ...ride, distance_to_driver: dist });
                    }
                });
            } catch (e) {
                logError('UPDATE_LOCATION', e);
            }
        });

        // 4. SOLICITAÇÃO DE CORRIDA
        socket.on('request_ride', async (data) => {
            const { passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km } = data;
            try {
                const result = await pool.query(
                    `INSERT INTO rides (passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, final_price, ride_type, distance_km, status, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW()) RETURNING *`,
                    [passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km]
                );
                const ride = result.rows[0];

                socket.join(`ride_${ride.id}`);
                io.to(`user_${passenger_id}`).emit('searching_started', ride);

                // Notifica motoristas num raio de 15km
                const driversRes = await pool.query(`
                    SELECT dp.* FROM driver_positions dp
                    JOIN users u ON dp.driver_id = u.id
                    WHERE u.is_online = true AND u.role = 'driver' AND dp.last_update > NOW() - INTERVAL '30 minutes'
                `);

                const nearbyDrivers = driversRes.rows.filter(d => getDistance(origin_lat, origin_lng, d.lat, d.lng) <= 15.0);
                nearbyDrivers.forEach(d => {
                    io.to(`user_${d.driver_id}`).emit('ride_opportunity', {
                        ...ride,
                        distance_to_driver: getDistance(origin_lat, origin_lng, d.lat, d.lng)
                    });
                });
            } catch (e) {
                logError('RIDE_REQUEST', e);
                socket.emit('error', { message: "Erro ao criar solicitação." });
            }
        });

        // 5. ACEITAR CORRIDA (Com Transação ACID)
        socket.on('accept_ride', async (data) => {
            const { ride_id, driver_id, final_price } = data;
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const checkRes = await client.query("SELECT status, passenger_id FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);

                if (checkRes.rows.length === 0 || checkRes.rows[0].status !== 'searching') {
                    await client.query('ROLLBACK');
                    return socket.emit('error_response', { message: "Esta corrida já não está disponível." });
                }

                await client.query(
                    `UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted', accepted_at = NOW() WHERE id = $3`,
                    [driver_id, final_price, ride_id]
                );
                await client.query('COMMIT');

                const fullData = await getFullRideDetails(ride_id);
                socket.join(`ride_${ride_id}`);

                // Notifica todos os envolvidos
                io.to(`user_${checkRes.rows[0].passenger_id}`).emit('match_found', fullData);
                io.to(`ride_${ride_id}`).emit('match_found', fullData);
            } catch (e) {
                if (client) await client.query('ROLLBACK');
                logError('ACCEPT_CRITICAL', e);
            } finally {
                client.release();
            }
        });

        // 6. CHAT HÍBRIDO (Texto e Imagem com Sincronia Total)
        socket.on('send_message', async (data) => {
            const { ride_id, sender_id, text, file_data } = data;
            if (!ride_id || !sender_id) return;

            try {
                const userRes = await pool.query("SELECT name, photo FROM users WHERE id = $1", [sender_id]);
                const sender = userRes.rows[0] || { name: "Usuário", photo: null };
                const finalText = text?.trim() ? text : (file_data ? '📷 Foto enviada' : '');

                const res = await pool.query(
                    `INSERT INTO chat_messages (ride_id, sender_id, text, file_data, created_at)
                     VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
                    [ride_id, sender_id, finalText, file_data || null]
                );

                const fullMsg = {
                    ...res.rows[0],
                    sender_name: sender.name,
                    sender_photo: sender.photo
                };

                // Emissão simultânea para a sala (Motorista e Passageiro)
                io.to(`ride_${ride_id}`).emit('receive_message', fullMsg);

                // Notificações em background
                (async () => {
                    const rideRes = await pool.query('SELECT passenger_id, driver_id FROM rides WHERE id = $1', [ride_id]);
                    if (rideRes.rows.length > 0) {
                        const ride = rideRes.rows[0];
                        const recipientId = (String(sender_id) === String(ride.passenger_id)) ? ride.driver_id : ride.passenger_id;

                        if (recipientId) {
                            await pool.query(
                                `INSERT INTO notifications (user_id, title, body, type, data, created_at) VALUES ($1, $2, $3, 'chat', $4, NOW())`,
                                [recipientId, `Nova mensagem de ${sender.name}`, finalText.substring(0, 60), JSON.stringify({ ride_id, sender_id })]
                            );
                            io.to(`user_${recipientId}`).emit('new_notification', { type: 'chat', ride_id });
                        }
                    }
                })();
            } catch (e) {
                logError('CHAT_CRITICAL', e);
            }
        });

        // 7. NEGOCIAÇÃO DE PREÇO
        socket.on('update_price_negotiation', async (data) => {
            const { ride_id, new_price } = data;
            try {
                await pool.query("UPDATE rides SET final_price = $1 WHERE id = $2", [new_price, ride_id]);
                io.to(`ride_${ride_id}`).emit('price_updated', {
                    new_price,
                    ride_id,
                    updated_at: new Date().toISOString()
                });
            } catch (e) { logError('PRICE_SYNC', e); }
        });

        // 8. CONTROLE DA VIAGEM (Início e GPS)
        socket.on('start_trip', async (data) => {
            const { ride_id } = data;
            try {
                await pool.query("UPDATE rides SET status = 'ongoing', started_at = NOW() WHERE id = $1", [ride_id]);
                const fullData = await getFullRideDetails(ride_id);
                io.to(`ride_${ride_id}`).emit('trip_started_now', { full_details: fullData });
            } catch (e) { logError('START_TRIP', e); }
        });

        socket.on('update_trip_gps', (data) => {
            const { ride_id, lat, lng, rotation } = data;
            socket.to(`ride_${ride_id}`).emit('driver_location_update', {
                lat, lng, rotation,
                timestamp: new Date().toISOString()
            });
        });

        // 9. CANCELAMENTO
        socket.on('cancel_ride', async (data) => {
            const { ride_id, role, reason } = data;
            try {
                await pool.query(
                    `UPDATE rides SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, cancellation_reason = $2 WHERE id = $3`,
                    [role, reason || 'Cancelado pelo usuário', ride_id]
                );
                io.to(`ride_${ride_id}`).emit('ride_terminated', {
                    reason: "A viagem foi cancelada.",
                    origin: role
                });
            } catch (e) { logError('CANCEL', e); }
        });

        // 10. DESCONEXÃO COM GRACE PERIOD (20 Segundos para Reconexão 3G/4G)
        socket.on('disconnect', async () => {
            logSystem('SOCKET', `Conexão sinalizada para encerramento: ${socket.id}`);
            try {
                const res = await pool.query("SELECT driver_id FROM driver_positions WHERE socket_id = $1", [socket.id]);
                if (res.rows.length > 0) {
                    const driverId = res.rows[0].driver_id;

                    // Aguarda 20 segundos antes de marcar como offline (Trata trocas de antena/rede)
                    setTimeout(async () => {
                        const check = await pool.query("SELECT socket_id FROM driver_positions WHERE driver_id = $1", [driverId]);
                        // Se o socket_id no DB ainda for o mesmo deste socket que desconectou, ele não reconectou
                        if (check.rows.length > 0 && check.rows[0].socket_id === socket.id) {
                            await pool.query("UPDATE users SET is_online = false WHERE id = $1", [driverId]);
                            logSystem('OFFLINE', `Motorista ${driverId} confirmado offline após grace period.`);
                        }
                    }, 20000);
                }
            } catch (e) { logError('DISCONNECT_HANDLER', e); }
        });
    });
}

module.exports = initializeSocket;
