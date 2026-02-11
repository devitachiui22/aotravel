/**
 * =================================================================================================
 * 🔌 AOTRAVEL SERVER PRO - REAL-TIME SOCKET ENGINE
 * =================================================================================================
 *
 * ARQUIVO: src/services/socketService.js
 * DESCRIÇÃO: Motor de comunicação em tempo real. Gerencia salas, rastreamento GPS,
 *            fluxo de corridas, chat e notificações instantâneas.
 *            Substitui a lógica monolítica do 'io.on' no antigo server.js.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const { Server } = require("socket.io");
const pool = require('../config/db');
const { logSystem, logError, getDistance, getFullRideDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

let io; // Instância global do IO para uso interno

/**
 * Inicializa o Servidor Socket.IO
 * @param {Object} httpServer - Servidor HTTP do Express
 */
function initializeSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: SYSTEM_CONFIG.SERVER.CORS_ORIGIN,
            methods: ["GET", "POST"],
            credentials: true
        },
        pingTimeout: SYSTEM_CONFIG.SOCKET.PING_TIMEOUT,
        pingInterval: SYSTEM_CONFIG.SOCKET.PING_INTERVAL,
        transports: SYSTEM_CONFIG.SOCKET.TRANSPORTS
    });

    // Torna o IO acessível globalmente para os Controllers (REST API)
    global.io = io;

    io.on('connection', (socket) => {
        logSystem('SOCKET', `Nova conexão estabelecida: ${socket.id}`);

        // =====================================================================
        // 1. GESTÃO DE SALAS (ROOMS) E PRESENÇA
        // =====================================================================

        /**
         * Evento: Entrar na sala do usuário (Privada)
         * Usado para notificações direcionadas e status online.
         */
        socket.on('join_user', async (userId) => {
            if (!userId) return;

            const roomName = `user_${userId}`;
            socket.join(roomName);

            try {
                // Marcar como online no banco
                await pool.query(
                    "UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1",
                    [userId]
                );

                // Se for motorista, registrar na tabela de posições (Radar)
                const userRes = await pool.query(
                    "SELECT role FROM users WHERE id = $1",
                    [userId]
                );

                if (userRes.rows.length > 0 && userRes.rows[0].role === 'driver') {
                    await pool.query(
                        `INSERT INTO driver_positions (driver_id, socket_id, last_update)
                         VALUES ($1, $2, NOW())
                         ON CONFLICT (driver_id)
                         DO UPDATE SET socket_id = $2, last_update = NOW()`,
                        [userId, socket.id]
                    );
                }

                logSystem('ROOM', `Usuário ${userId} sincronizado na sala: ${roomName}`);
            } catch (e) {
                logError('JOIN_USER', e);
            }
        });

        /**
         * Evento: Entrar na sala de uma corrida específica
         * Usado para Chat e Atualizações de Status em tempo real.
         */
        socket.on('join_ride', (rideId) => {
            if (!rideId) return;
            const roomName = `ride_${rideId}`;
            socket.join(roomName);
            logSystem('ROOM', `Socket ${socket.id} entrou na sala da corrida: ${roomName}`);
        });

        // =====================================================================
        // 2. TELEMETRIA E RADAR (GPS)
        // =====================================================================

        /**
         * Evento: Atualização de Localização (Driver)
         * - Atualiza a posição no banco.
         * - Aciona o RADAR REVERSO para encontrar passageiros próximos.
         */
        socket.on('update_location', async (data) => {
            const { user_id, lat, lng, heading } = data;
            if (!user_id) return;

            try {
                // 1. Atualizar posição do motorista
                await pool.query(
                    `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update, socket_id)
                     VALUES ($1, $2, $3, $4, NOW(), $5)
                     ON CONFLICT (driver_id) DO UPDATE SET
                        lat = $2,
                        lng = $3,
                        heading = $4,
                        last_update = NOW(),
                        socket_id = $5`,
                    [user_id, lat, lng, heading || 0, socket.id]
                );

                // 2. RADAR REVERSO: Procurar corridas pendentes ('searching')
                // Otimização: Busca apenas corridas criadas nos últimos 10 minutos
                const pendingRides = await pool.query(
                    `SELECT * FROM rides
                     WHERE status = 'searching'
                     AND created_at > NOW() - INTERVAL '10 minutes'`
                );

                if (pendingRides.rows.length > 0) {
                    pendingRides.rows.forEach(ride => {
                        const dist = getDistance(lat, lng, ride.origin_lat, ride.origin_lng);
                        // Raio de detecção: 12KM
                        if (dist <= 12.0) {
                            io.to(socket.id).emit('ride_opportunity', {
                                ...ride,
                                distance_to_driver: dist
                            });
                            // logSystem('RADAR', `Motorista ${user_id} detectou pedido ${ride.id} a ${dist.toFixed(1)}km`);
                        }
                    });
                }
            } catch (e) {
                logError('UPDATE_LOCATION', e);
            }
        });

        /**
         * Evento: GPS de Viagem Ativa
         * Repassa a posição do motorista para o passageiro visualizar no mapa.
         */
        socket.on('update_trip_gps', (data) => {
            const { ride_id, lat, lng, rotation } = data;
            // Envia para todos na sala da corrida (exceto o remetente)
            socket.to(`ride_${ride_id}`).emit('driver_location_update', {
                lat,
                lng,
                rotation,
                timestamp: new Date().toISOString()
            });
        });

        // =====================================================================
        // 3. FLUXO DE CORRIDA (CORE BUSINESS)
        // =====================================================================

        /**
         * Evento: Solicitação de Corrida (Legacy WebSocket Fallback)
         * Nota: O app principal usa a API REST, mas mantemos isso para compatibilidade total.
         */
        socket.on('request_ride', async (data) => {
            const {
                passenger_id, origin_lat, origin_lng,
                dest_lat, dest_lng, origin_name, dest_name,
                initial_price, ride_type, distance_km
            } = data;

            try {
                // Inserir corrida
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

                // Buscar motoristas e notificar
                const driversRes = await pool.query(`
                    SELECT dp.* FROM driver_positions dp
                    JOIN users u ON dp.driver_id = u.id
                    WHERE u.is_online = true AND u.role = 'driver' AND u.is_blocked = false
                    AND dp.last_update > NOW() - INTERVAL '30 minutes'
                `);

                const nearbyDrivers = driversRes.rows.filter(d => {
                    return getDistance(origin_lat, origin_lng, d.lat, d.lng) <= 15.0;
                });

                nearbyDrivers.forEach(d => {
                    io.to(`user_${d.driver_id}`).emit('ride_opportunity', {
                        ...ride,
                        distance_to_driver: getDistance(origin_lat, origin_lng, d.lat, d.lng)
                    });
                });

            } catch (e) {
                logError('SOCKET_REQUEST_RIDE', e);
            }
        });

        /**
         * Evento: Aceite de Corrida (Motorista)
         * Executa transação atômica para evitar que dois motoristas peguem a mesma corrida.
         */
        socket.on('accept_ride', async (data) => {
            const { ride_id, driver_id, final_price } = data;
            logSystem('ACCEPT', `Motorista ${driver_id} tentando aceitar Ride ${ride_id}`);

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // SELECT FOR UPDATE bloqueia a linha até o fim da transação
                const checkRes = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);

                if (checkRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return socket.emit('error_response', { message: "Corrida não encontrada." });
                }

                const ride = checkRes.rows[0];

                if (ride.status !== 'searching') {
                    await client.query('ROLLBACK');
                    return socket.emit('error_response', { message: "Esta corrida já foi aceita." });
                }

                // Atualiza estado da corrida
                await client.query(
                    `UPDATE rides SET
                        driver_id = $1,
                        final_price = COALESCE($2, initial_price),
                        status = 'accepted',
                        accepted_at = NOW()
                     WHERE id = $3`,
                    [driver_id, final_price || ride.initial_price, ride_id]
                );

                await client.query('COMMIT');

                // Busca dados completos (Payload Rico)
                const fullData = await getFullRideDetails(ride_id);

                // Sincroniza salas
                socket.join(`ride_${ride_id}`);

                // Notificações Globais
                io.to(`user_${ride.passenger_id}`).emit('match_found', fullData);
                io.to(`user_${driver_id}`).emit('match_found', fullData);
                io.to(`ride_${ride_id}`).emit('match_found', fullData);

                logSystem('SUCCESS', `Match: Passageiro ${ride.passenger_id} <-> Motorista ${driver_id}`);

            } catch (e) {
                await client.query('ROLLBACK');
                logError('ACCEPT_CRITICAL', e);
                socket.emit('error_response', { message: "Erro ao processar aceite." });
            } finally {
                client.release();
            }
        });

        /**
         * Evento: Iniciar Viagem
         */
        socket.on('start_trip', async (data) => {
            const { ride_id } = data;
            try {
                await pool.query(
                    "UPDATE rides SET status = 'ongoing', started_at = NOW() WHERE id = $1",
                    [ride_id]
                );
                const fullData = await getFullRideDetails(ride_id);

                // Emite evento para a sala
                io.to(`ride_${ride_id}`).emit('trip_started_now', {
                    full_details: fullData,
                    status: 'ongoing',
                    started_at: new Date().toISOString()
                });
                // Compatibilidade com versões antigas
                io.to(`ride_${ride_id}`).emit('trip_started', fullData);
            } catch (e) {
                logError('START_TRIP', e);
            }
        });

        /**
         * Evento: Cancelamento de Corrida
         */
        socket.on('cancel_ride', async (data) => {
            const { ride_id, role, reason } = data;
            try {
                await pool.query(
                    `UPDATE rides SET
                        status = 'cancelled',
                        cancelled_at = NOW(),
                        cancelled_by = $1,
                        cancellation_reason = $2
                     WHERE id = $3`,
                    [role, reason || 'Cancelado via App', ride_id]
                );

                const msg = role === 'driver' ? "Motorista cancelou." : "Passageiro cancelou.";

                io.to(`ride_${ride_id}`).emit('ride_terminated', {
                    reason: msg,
                    origin: role,
                    cancelled_at: new Date().toISOString()
                });

                // Notificação Individual para garantir entrega
                const details = await getFullRideDetails(ride_id);
                if (details) {
                    const targetId = role === 'driver' ? details.passenger_id : details.driver_id;
                    if (targetId) io.to(`user_${targetId}`).emit('ride_terminated', { reason: msg, origin: role });
                }
            } catch (e) {
                logError('CANCEL_RIDE', e);
            }
        });

        // =====================================================================
        // 4. CHAT E COMUNICAÇÃO
        // =====================================================================

        socket.on('send_message', async (data) => {
            const { ride_id, sender_id, text, file_data } = data;
            try {
                const res = await pool.query(
                    `INSERT INTO chat_messages (ride_id, sender_id, text, image_url, created_at)
                     VALUES ($1, $2, $3, $4, NOW())
                     RETURNING *`,
                    [ride_id, sender_id, text || (file_data ? '📷 Foto' : ''), file_data || null]
                );

                const msg = res.rows[0];
                const senderRes = await pool.query('SELECT name, photo FROM users WHERE id = $1', [sender_id]);

                const payload = {
                    ...msg,
                    sender_name: senderRes.rows[0]?.name,
                    sender_photo: senderRes.rows[0]?.photo
                };

                io.to(`ride_${ride_id}`).emit('receive_message', payload);

                // Notificação Push se destinatário estiver fora da sala (Lógica simplificada aqui)
            } catch (e) {
                logError('CHAT_MSG', e);
            }
        });

        socket.on('update_price_negotiation', async (data) => {
            const { ride_id, new_price } = data;
            try {
                await pool.query("UPDATE rides SET final_price = $1 WHERE id = $2", [new_price, ride_id]);
                io.to(`ride_${ride_id}`).emit('price_updated', {
                    new_price,
                    updated_at: new Date().toISOString()
                });
            } catch (e) {
                logError('NEGOTIATION', e);
            }
        });

        // =====================================================================
        // 5. DESCONEXÃO
        // =====================================================================

        socket.on('disconnect', async () => {
            // Lógica de limpeza e status offline
            // Implementa delay para evitar "flicks" em conexões instáveis
            try {
                const posRes = await pool.query('SELECT driver_id FROM driver_positions WHERE socket_id = $1', [socket.id]);
                if (posRes.rows.length > 0) {
                    const driverId = posRes.rows[0].driver_id;
                    // Timeout de segurança (5 min)
                    setTimeout(async () => {
                        const check = await pool.query('SELECT socket_id FROM driver_positions WHERE driver_id = $1', [driverId]);
                        if (check.rows.length > 0 && check.rows[0].socket_id === socket.id) {
                            await pool.query('UPDATE users SET is_online = false WHERE id = $1', [driverId]);
                            logSystem('OFFLINE', `Motorista ${driverId} marcado como offline (Timeout).`);
                        }
                    }, 300000);
                }
            } catch (e) {
                logError('DISCONNECT', e);
            }
        });
    });
}

/**
 * Função para emitir eventos globalmente (ex: de um Controller REST)
 */
function emitGlobal(event, data) {
    if (io) {
        io.emit(event, data);
    }
}

/**
 * Função para emitir para um usuário específico
 */
function emitToUser(userId, event, data) {
    if (io) {
        io.to(`user_${userId}`).emit(event, data);
    }
}

module.exports = {
    initializeSocket,
    emitGlobal,
    emitToUser
};