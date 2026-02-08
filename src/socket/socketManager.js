/**
 * =================================================================================================
 * 🛰️ TITANIUM SOCKET MANAGER - ULTIMATE FINAL VERSION (REVISÃO 2026.02.10)
 * =================================================================================================
 *
 * ARQUIVO: src/socket/socketManager.js
 * DESCRIÇÃO: Motor Real-time de Sincronia de Missões, Chat Multimídia e Radar Reverso.
 * STATUS: 100% OPERACIONAL | ZERO OMISSÕES | ZERO SIMPLIFICAÇÕES
 *
 * RESOLUÇÕES TÉCNICAS:
 * 1. MENSAGENS BI-DIRECIONAIS: Uso de io.to(room) para garantir recepção em ambos os terminais.
 * 2. NEGOCIAÇÃO GLOBAL: Atualização de preço emitida para a sala inteira.
 * 3. ARQUIVOS (BASE64): Payload otimizado para transmissão de imagens no chat.
 * 4. GRACE PERIOD: 20 segundos de tolerância para quedas de sinal 3G/4G em Angola.
 * 5. ANTI-DUPLICIDADE: Limpeza compulsória de salas zumbis no join_ride.
 * =================================================================================================
 */

const { pool } = require('../config/db');
const { logSystem, logError } = require('../utils/logger');
const { getDistance } = require('../utils/helpers');
const { getFullRideDetails } = require('../utils/queries');

function initializeSocket(io) {
    io.on('connection', (socket) => {
        logSystem('SOCKET', `Nova conexão Titanium estabelecida: ${socket.id}`);

        /**
         * 1. GESTÃO DE ENTRADA DO USUÁRIO (Sincronia de Status)
         * Registra o usuário como Online e vincula o socket atual ao perfil.
         */
        socket.on('join_user', async (userId) => {
            if (!userId) return;
            const roomName = `user_${userId}`;

            try {
                socket.join(roomName);

                // Atualiza status global para Online
                await pool.query(
                    "UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1",
                    [userId]
                );

                // Se for motorista, vincula socket_id para o Radar Reverso
                const userRes = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
                if (userRes.rows[0]?.role === 'driver') {
                    await pool.query(
                        `INSERT INTO driver_positions (driver_id, socket_id, last_update)
                         VALUES ($1, $2, NOW())
                         ON CONFLICT (driver_id) DO UPDATE SET socket_id = $2, last_update = NOW()`,
                        [userId, socket.id]
                    );
                }

                logSystem('ROOM', `Usuário ${userId} sincronizado na sala privada: ${roomName}`);
            } catch (e) {
                logError('JOIN_USER_CRITICAL', e);
            }
        });

        /**
         * 2. JOIN RIDE (Sincronia Atômica de Missão)
         * Garante que passageiro e motorista estejam no mesmo canal exclusivo da corrida.
         */
        socket.on('join_ride', (ride_id) => {
            if (!ride_id) {
                logError('ROOM_JOIN', 'ID da corrida ausente no handshake de sala.');
                return;
            }

            const roomName = `ride_${ride_id}`;

            try {
                // ANTI-DUPLICIDADE: Sai de qualquer outra sala de corrida ativa
                socket.rooms.forEach((room) => {
                    if (room.startsWith('ride_') && room !== roomName) {
                        socket.leave(room);
                        logSystem('ROOM_CLEAN', `Socket ${socket.id} limpou canal zumbi: ${room}`);
                    }
                });

                socket.join(roomName);
                logSystem('ROOM', `[TITAN] Conexão segura estabelecida na missão: ${roomName}`);

                // Confirmação para o terminal
                socket.emit('ride_room_confirmed', {
                    ride_id,
                    status: 'connected',
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                logError('ROOM_JOIN_FAILURE', e);
                socket.emit('error_response', { message: "Falha na sincronização de sala." });
            }
        });

        /**
         * 3. UPDATE LOCATION (Motor do Radar Reverso)
         * Recebe o GPS do motorista e notifica passageiros próximos com pedidos pendentes.
         */
        socket.on('update_location', async (data) => {
            const { user_id, lat, lng, heading } = data;
            if (!user_id || !lat || !lng) return;

            try {
                // Atualiza rastro no DB para auditoria e radar
                await pool.query(
                    `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update, socket_id)
                     VALUES ($1, $2, $3, $4, NOW(), $5)
                     ON CONFLICT (driver_id) DO UPDATE SET
                        lat = $2, lng = $3, heading = $4, last_update = NOW(), socket_id = $5`,
                    [user_id, lat, lng, heading || 0, socket.id]
                );

                // RADAR REVERSO: Busca corridas 'searching' num raio de 12km
                const pendingRides = await pool.query(
                    `SELECT * FROM rides WHERE status = 'searching' AND created_at > NOW() - INTERVAL '15 minutes'`
                );

                pendingRides.rows.forEach(ride => {
                    const dist = getDistance(lat, lng, ride.origin_lat, ride.origin_lng);
                    if (dist <= 12.0) {
                        io.to(socket.id).emit('ride_opportunity', {
                            ...ride,
                            distance_to_driver: dist,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
            } catch (e) {
                logError('GPS_RADAR_SYNC', e);
            }
        });

        /**
         * 4. REQUEST RIDE (Gatilho de Busca)
         */
        socket.on('request_ride', async (data) => {
            const {
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, ride_type, distance_km
            } = data;

            try {
                const result = await pool.query(
                    `INSERT INTO rides (
                        passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                        origin_name, dest_name, initial_price, final_price,
                        ride_type, distance_km, status, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW())
                    RETURNING *`,
                    [passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km]
                );

                const ride = result.rows[0];
                socket.join(`ride_${ride.id}`);

                // Confirma início da busca para o passageiro
                io.to(`user_${passenger_id}`).emit('searching_started', ride);

                // Varredura de motoristas ativos num raio de 15km
                const driversRes = await pool.query(`
                    SELECT dp.* FROM driver_positions dp
                    JOIN users u ON dp.driver_id = u.id
                    WHERE u.is_online = true AND u.role = 'driver' AND dp.last_update > NOW() - INTERVAL '30 minutes'
                `);

                const nearby = driversRes.rows.filter(d => getDistance(origin_lat, origin_lng, d.lat, d.lng) <= 15.0);
                nearby.forEach(d => {
                    io.to(`user_${d.driver_id}`).emit('ride_opportunity', {
                        ...ride,
                        distance_to_driver: getDistance(origin_lat, origin_lng, d.lat, d.lng)
                    });
                });

                logSystem('RIDE', `Busca iniciada: ID ${ride.id} por Passageiro ${passenger_id}`);
            } catch (e) {
                logError('RIDE_REQUEST_FAIL', e);
            }
        });

        /**
         * 5. ACCEPT RIDE (Match Sync)
         */
        socket.on('accept_ride', async (data) => {
            const { ride_id, driver_id, final_price } = data;
            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                // Validação de disponibilidade (Locking row)
                const check = await client.query("SELECT status, passenger_id FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
                if (check.rows.length === 0 || check.rows[0].status !== 'searching') {
                    await client.query('ROLLBACK');
                    return socket.emit('error_response', { message: "Desculpe, esta corrida já foi aceita por outro capitão." });
                }

                await client.query(
                    "UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted', accepted_at = NOW() WHERE id = $3",
                    [driver_id, final_price, ride_id]
                );

                await client.query('COMMIT');

                const fullData = await getFullRideDetails(ride_id);
                socket.join(`ride_${ride_id}`);

                // EMISSÃO GLOBAL: Garante que ambos terminais recebam os dados do match
                io.to(`user_${check.rows[0].passenger_id}`).emit('match_found', fullData);
                io.to(`ride_${ride_id}`).emit('match_found', fullData);

                logSystem('MATCH', `Missão ${ride_id} vinculada ao Capitão ${driver_id}`);
            } catch (e) {
                if (client) await client.query('ROLLBACK');
                logError('ACCEPT_MATCH_CRITICAL', e);
            } finally {
                client.release();
            }
        });

        /**
         * 6. CHAT SUPREMO (Sincronia de Texto e Arquivo)
         * Resolve o erro de mensagens que não chegavam ao destinatário.
         */
        socket.on('send_message', async (data) => {
            const { ride_id, sender_id, text, file_data } = data;
            if (!ride_id || !sender_id) return;

            try {
                const userRes = await pool.query("SELECT name, photo FROM users WHERE id = $1", [sender_id]);
                const sender = userRes.rows[0] || { name: "Usuário", photo: null };

                const finalText = text?.trim() ? text : (file_data ? '📷 Imagem transmitida' : '');

                // Persiste na tabela com file_data (Base64)
                const res = await pool.query(
                    `INSERT INTO chat_messages (ride_id, sender_id, text, file_data, created_at)
                     VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
                    [ride_id, sender_id, finalText, file_data || null]
                );

                const fullMsg = {
                    ...res.rows[0],
                    sender_name: sender.name,
                    sender_photo: sender.photo,
                    temp_id: data.temp_id // Devolve o temp_id para o Front confirmar o envio
                };

                // SINCRONIA TOTAL: io.to envia para TODOS na sala
                io.to(`ride_${ride_id}`).emit('receive_message', fullMsg);

                // Notificação Silenciosa (Background)
                (async () => {
                    const r = await pool.query('SELECT passenger_id, driver_id FROM rides WHERE id = $1', [ride_id]);
                    if (r.rows.length > 0) {
                        const target = (String(sender_id) === String(r.rows[0].passenger_id)) ? r.rows[0].driver_id : r.rows[0].passenger_id;
                        if (target) {
                            await pool.query(
                                "INSERT INTO notifications (user_id, title, body, type, data) VALUES ($1, $2, $3, 'chat', $4)",
                                [target, `Nova msg de ${sender.name}`, finalText.substring(0, 50), JSON.stringify({ ride_id, sender_id })]
                            );
                            io.to(`user_${target}`).emit('new_notification', { type: 'chat', ride_id });
                        }
                    }
                })();
            } catch (e) {
                logError('CHAT_SYNC_ERROR', e);
            }
        });

        /**
         * 7. NEGOCIAÇÃO DE PREÇO (Sync Bi-direcional)
         * Resolve o erro de atualizar apenas para um dos lados.
         */
        socket.on('update_price_negotiation', async (data) => {
            const { ride_id, new_price } = data;
            try {
                await pool.query("UPDATE rides SET final_price = $1 WHERE id = $2", [new_price, ride_id]);

                // Notifica a sala inteira sobre o novo acordo financeiro
                io.to(`ride_${ride_id}`).emit('price_updated', {
                    new_price,
                    ride_id,
                    updated_at: new Date().toISOString()
                });

                logSystem('PRICE', `Acordo de preço alterado na Ride ${ride_id} para ${new_price} Kz`);
            } catch (e) {
                logError('NEGOTIATION_FAIL', e);
            }
        });

        /**
         * 8. CONTROLE DE VIAGEM E GPS
         */
        socket.on('start_trip', async (data) => {
            const { ride_id } = data;
            try {
                await pool.query("UPDATE rides SET status = 'ongoing', started_at = NOW() WHERE id = $1", [ride_id]);
                const fullData = await getFullRideDetails(ride_id);

                // Notifica ambos que a missão iniciou fisicamente
                io.to(`ride_${ride_id}`).emit('trip_started_now', {
                    status: 'ongoing',
                    full_details: fullData
                });
            } catch (e) {
                logError('START_TRIP_FAIL', e);
            }
        });

        socket.on('update_trip_gps', (data) => {
            const { ride_id, lat, lng, rotation } = data;
            // Repassa o rastro apenas para a contraparte na sala
            socket.to(`ride_${ride_id}`).emit('driver_location_update', {
                lat, lng, rotation,
                timestamp: new Date().toISOString()
            });
        });

        /**
         * 9. CANCELAMENTO (Abort Mission)
         */
        socket.on('cancel_ride', async (data) => {
            const { ride_id, role, reason } = data;
            try {
                await pool.query(
                    "UPDATE rides SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, cancellation_reason = $2 WHERE id = $3",
                    [role, reason || 'Cancelado pelo terminal', ride_id]
                );

                io.to(`ride_${ride_id}`).emit('ride_terminated', {
                    status: 'cancelled',
                    reason: "A missão foi abortada por uma das partes.",
                    origin: role
                });
            } catch (e) {
                logError('CANCEL_SYNC_FAIL', e);
            }
        });

        /**
         * 10. DISCONNECT (Grace Period de 20s)
         * Evita o bug de "Motorista Offline" por oscilação de sinal em Luanda.
         */
        socket.on('disconnect', async () => {
            logSystem('SOCKET', `Link instável detectado para: ${socket.id}`);

            try {
                const res = await pool.query("SELECT driver_id FROM driver_positions WHERE socket_id = $1", [socket.id]);

                if (res.rows.length > 0) {
                    const driverId = res.rows[0].driver_id;

                    // Timer de tolerância tática
                    setTimeout(async () => {
                        try {
                            const check = await pool.query("SELECT socket_id FROM driver_positions WHERE driver_id = $1", [driverId]);

                            // Se o socket_id no DB ainda for o mesmo que caiu, ele não reconectou
                            if (check.rows.length > 0 && check.rows[0].socket_id === socket.id) {
                                await pool.query("UPDATE users SET is_online = false WHERE id = $1", [driverId]);
                                logSystem('OFFLINE', `Capitão ${driverId} confirmado offline após 20s de silêncio.`);
                            } else {
                                logSystem('SOCKET', `Capitão ${driverId} reconectou com sucesso. Link preservado.`);
                            }
                        } catch (err) {
                            logError('DISCONNECT_RECHECK_FAIL', err);
                        }
                    }, 20000);
                }
            } catch (e) {
                logError('DISCONNECT_HANDLER_CRITICAL', e);
            }
        });
    });
}

module.exports = initializeSocket;
