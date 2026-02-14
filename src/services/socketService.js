/**
 * =================================================================================================
 * ⚡ AOTRAVEL SERVER PRO - SOCKET SERVICE (CORREÇÃO DE REGISTRO IMEDIATO) - COMPLETO
 * =================================================================================================
 *
 * ARQUIVO: src/services/socketService.js
 * DESCRIÇÃO: Motor de comunicação bidirecional em tempo real com registro imediato no banco.
 *
 * ✅ CORREÇÕES APLICADAS (v7.0.0):
 * 1. ✅ Registro imediato no banco ao entrar na sala de motoristas
 * 2. ✅ Normalização robusta de ID (driver_id, user_id, id)
 * 3. ✅ Salva posição mesmo sem GPS (lat/lng = 0) para garantir presença
 * 4. ✅ Logs detalhados para debug
 * 5. ✅ Compatível com a estrutura da tabela driver_positions
 * 6. ✅ ❌ ROTA DE DEBUG REMOVIDA (deve ficar no server.js)
 *
 * STATUS: 🔥 PRODUCTION READY - CORRIGIDO
 * =================================================================================================
 */

const { Server } = require("socket.io");
const pool = require('../config/db');
const { logSystem, logError, getDistance, getFullRideDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

const socketController = require('../controllers/socketController');

let io;

// Armazenamento em memória para debounce de desconexão
const disconnectTimers = new Map();
const userSockets = new Map(); // userId -> socketId
const socketUsers = new Map(); // socketId -> userId

/**
 * INICIALIZAÇÃO DO SERVIDOR SOCKET.IO
 */
function initializeSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: SYSTEM_CONFIG.SERVER?.CORS_ORIGIN || "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        pingTimeout: SYSTEM_CONFIG.SOCKET?.PING_TIMEOUT || 60000,
        pingInterval: SYSTEM_CONFIG.SOCKET?.PING_INTERVAL || 25000,
        transports: SYSTEM_CONFIG.SOCKET?.TRANSPORTS || ['websocket', 'polling'],
        allowEIO3: true,
        connectTimeout: 10000,
        maxHttpBufferSize: 1e6
    });

    // Expor globalmente
    global.io = io;

    io.on('connection', (socket) => {
        handleConnection(socket);
    });

    logSystem('SOCKET_ENGINE', '🚀 Servidor Real-Time iniciado e pronto para conexões.');

    // Monitoramento periódico
    setInterval(async () => {
        const onlineDrivers = await socketController.countOnlineDrivers();
        if (onlineDrivers > 0) {
            console.log(`📊 [STATUS] Motoristas online: ${onlineDrivers}`);
        }
        io.emit('drivers_online_update', {
            count: onlineDrivers,
            timestamp: new Date().toISOString()
        });
    }, 10000);

    return io;
}

/**
 * MANIPULADOR DE CONEXÃO
 */
function handleConnection(socket) {
    const socketId = socket.id;
    console.log(`🔌 Nova conexão: ${socketId} (Transport: ${socket.conn.transport.name})`);

    // =====================================================================
    // 1. JOIN USER
    // =====================================================================
    socket.on('join_user', async (userId) => {
        if (!userId) {
            socket.emit('error', { message: 'User ID não fornecido' });
            return;
        }

        const userIdStr = userId.toString();
        const roomName = `user_${userIdStr}`;

        socket.join(roomName);
        userSockets.set(userIdStr, socketId);
        socketUsers.set(socketId, userIdStr);

        console.log(`👤 [SOCKET] User ${userIdStr} entrou na sala ${roomName}`);

        if (disconnectTimers.has(userIdStr)) {
            clearTimeout(disconnectTimers.get(userIdStr));
            disconnectTimers.delete(userIdStr);
        }

        try {
            await pool.query(
                "UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1",
                [userId]
            );

            const userRes = await pool.query(
                "SELECT role, name, photo, rating, vehicle_details FROM users WHERE id = $1",
                [userId]
            );

            if (userRes.rows.length > 0) {
                const user = userRes.rows[0];

                // Buscar corridas pendentes
                const pendingRides = await pool.query(
                    `SELECT * FROM rides
                     WHERE (passenger_id = $1 OR driver_id = $1)
                     AND status IN ('searching', 'accepted', 'ongoing')
                     ORDER BY created_at DESC`,
                    [userId]
                );

                pendingRides.rows.forEach(ride => {
                    const rideRoom = `ride_${ride.id}`;
                    socket.join(rideRoom);
                });
            }

            socket.emit('joined_ack', {
                success: true,
                room: roomName,
                status: 'online',
                user_id: userId,
                socket_id: socketId,
                timestamp: new Date().toISOString()
            });

        } catch (e) {
            logError('JOIN_USER', e);
            socket.emit('error', { message: 'Erro ao registrar usuário', error: e.message });
        }
    });

    // =====================================================================
    // 2. JOIN DRIVER ROOM (CRÍTICO)
    // =====================================================================
    socket.on('join_driver_room', async (data) => {
        let driverId = null;
        let lat = 0.0;
        let lng = 0.0;
        let heading = 0.0;
        let speed = 0.0;

        if (typeof data === 'object') {
            driverId = data.driver_id || data.user_id || data.id;
            lat = parseFloat(data.lat) || 0.0;
            lng = parseFloat(data.lng) || 0.0;
            heading = parseFloat(data.heading) || 0.0;
            speed = parseFloat(data.speed) || 0.0;
        } else {
            driverId = data;
        }

        if (!driverId) {
            console.error('❌ [SOCKET] join_driver_room falhou: ID nulo');
            return;
        }

        const driverIdStr = driverId.toString();

        socket.join('drivers');
        socket.join(`driver_${driverIdStr}`);
        socket.join(`user_${driverIdStr}`);

        userSockets.set(driverIdStr, socketId);
        socketUsers.set(socketId, driverIdStr);

        console.log(`🚗 [SOCKET] Driver ${driverIdStr} REGISTRADO (Socket: ${socketId})`);

        if (disconnectTimers.has(driverIdStr)) {
            clearTimeout(disconnectTimers.get(driverIdStr));
            disconnectTimers.delete(driverIdStr);
        }

        try {
            // Usar o controller para salvar no banco
            await socketController.joinDriverRoom({
                driver_id: driverIdStr,
                user_id: driverIdStr,
                lat: lat,
                lng: lng,
                heading: heading,
                speed: speed,
                status: 'online'
            }, socket);

        } catch (e) {
            console.error(`❌ [DB ERROR] Falha ao salvar driver ${driverIdStr}:`, e.message);
        }

        socket.emit('joined_ack', {
            room: 'drivers',
            driver_id: driverIdStr,
            status: 'online',
            timestamp: new Date().toISOString()
        });

        const onlineCount = await socketController.countOnlineDrivers();
        io.emit('drivers_online_count', onlineCount);
    });

    // =====================================================================
    // 3. JOIN RIDE
    // =====================================================================
    socket.on('join_ride', (rideId) => {
        if (!rideId) {
            socket.emit('error', { message: 'Ride ID não fornecido' });
            return;
        }

        const roomName = `ride_${rideId}`;
        socket.join(roomName);

        socket.emit('ride_joined', {
            success: true,
            ride_id: rideId,
            room: roomName,
            timestamp: new Date().toISOString()
        });
    });

    // =====================================================================
    // 4. LEAVE RIDE
    // =====================================================================
    socket.on('leave_ride', (rideId) => {
        if (!rideId) return;

        const roomName = `ride_${rideId}`;
        socket.leave(roomName);

        socket.emit('ride_left', {
            success: true,
            ride_id: rideId,
            room: roomName
        });
    });

    // =====================================================================
    // 5. UPDATE LOCATION
    // =====================================================================
    socket.on('update_location', async (data) => {
        const driverId = data.driver_id || data.user_id || data.id;

        if (!driverId || !data.lat || !data.lng) {
            return;
        }

        await socketController.updateDriverPosition({
            driver_id: driverId,
            user_id: driverId,
            lat: data.lat || 0,
            lng: data.lng || 0,
            heading: data.heading || 0,
            speed: data.speed || 0,
            accuracy: data.accuracy || 0,
            status: 'online'
        }, socket);

        if (data.ride_id) {
            io.to(`ride_${data.ride_id}`).emit('driver_location_update', {
                lat: parseFloat(data.lat),
                lng: parseFloat(data.lng),
                heading: parseFloat(data.heading || 0),
                speed: parseFloat(data.speed || 0),
                timestamp: new Date().toISOString(),
                ride_id: data.ride_id
            });
        }
    });

    // =====================================================================
    // 6. UPDATE TRIP GPS
    // =====================================================================
    socket.on('update_trip_gps', (data) => {
        const { ride_id, lat, lng, rotation, speed } = data;

        if (!ride_id || !lat || !lng) return;

        io.to(`ride_${ride_id}`).emit('driver_location_update', {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            rotation: parseFloat(rotation || 0),
            speed: parseFloat(speed || 0),
            timestamp: new Date().toISOString(),
            ride_id: ride_id
        });
    });

    // =====================================================================
    // 7. HEARTBEAT
    // =====================================================================
    socket.on('heartbeat', async (data) => {
        const driverId = data.driver_id || data.user_id;
        
        if (!driverId) return;
        
        // Apenas atualizar timestamp (sem alterar posição)
        await socketController.updateDriverActivity(driverId);
    });

    // =====================================================================
    // 8. GET NEARBY DRIVERS
    // =====================================================================
    socket.on('get_nearby_drivers', async (data) => {
        const { lat, lng, radius = 15 } = data;

        if (!lat || !lng) return;

        try {
            const drivers = await socketController.getNearbyDrivers(lat, lng, radius);

            socket.emit('nearby_drivers', {
                drivers: drivers,
                count: drivers.length,
                timestamp: new Date().toISOString()
            });

        } catch (e) {
            logError('NEARBY_DRIVERS', e);
        }
    });

    // =====================================================================
    // 9. REQUEST RIDE (fallback)
    // =====================================================================
    socket.on('request_ride', (data) => {
        console.log('🚕 [SOCKET] Request ride (via socket)');
        socket.emit('ride_request_received', {
            message: 'Solicitação recebida, processando...',
            timestamp: new Date().toISOString()
        });
    });

    // =====================================================================
    // 10. ACCEPT RIDE
    // =====================================================================
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id } = data;

        if (!ride_id || !driver_id) {
            socket.emit('error_response', {
                message: "Dados incompletos para aceitar corrida",
                code: "INCOMPLETE_DATA"
            });
            return;
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const checkRes = await client.query(
                "SELECT * FROM rides WHERE id = $1 FOR UPDATE SKIP LOCKED",
                [ride_id]
            );

            if (checkRes.rows.length === 0) {
                await client.query('ROLLBACK');
                socket.emit('error_response', {
                    message: "Corrida não encontrada ou já processada",
                    code: "RIDE_NOT_FOUND"
                });
                return;
            }

            const ride = checkRes.rows[0];

            if (ride.status !== 'searching') {
                await client.query('ROLLBACK');
                socket.emit('error_response', {
                    message: "Esta corrida já foi aceita por outro motorista",
                    code: "RIDE_TAKEN",
                    current_status: ride.status
                });
                return;
            }

            if (ride.passenger_id === driver_id) {
                await client.query('ROLLBACK');
                socket.emit('error_response', {
                    message: "Você não pode aceitar sua própria corrida",
                    code: "SELF_RIDE"
                });
                return;
            }

            await client.query(
                `UPDATE rides SET
                    driver_id = $1,
                    status = 'accepted',
                    accepted_at = NOW(),
                    updated_at = NOW()
                 WHERE id = $2`,
                [driver_id, ride_id]
            );

            await client.query('COMMIT');

            const fullRide = await getFullRideDetails(ride_id);

            socket.join(`ride_${ride_id}`);

            const matchPayload = {
                ...fullRide,
                matched_at: new Date().toISOString(),
                message: "Motorista a caminho do ponto de embarque!"
            };

            io.to(`ride_${ride_id}`).emit('match_found', matchPayload);
            io.to(`ride_${ride_id}`).emit('ride_accepted', matchPayload);

            if (fullRide.passenger_id) {
                io.to(`user_${fullRide.passenger_id}`).emit('match_found', matchPayload);
            }

            const otherDriversRes = await pool.query(`
                SELECT socket_id
                FROM driver_positions
                WHERE status = 'online'
                AND last_update > NOW() - INTERVAL '30 minutes'
                AND socket_id IS NOT NULL
                AND driver_id != $1
            `, [driver_id]);

            otherDriversRes.rows.forEach(driver => {
                if (driver.socket_id) {
                    io.to(driver.socket_id).emit('ride_taken', {
                        ride_id: ride_id,
                        message: 'Esta corrida já não está mais disponível',
                        taken_by: driver_id,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            socket.emit('ride_accepted_confirmation', {
                success: true,
                ride: matchPayload
            });

        } catch (e) {
            await client.query('ROLLBACK');
            logError('ACCEPT_RIDE_FATAL', e);
            socket.emit('error_response', {
                message: "Erro crítico ao processar aceite",
                error: e.message,
                code: "FATAL_ERROR"
            });
        } finally {
            client.release();
        }
    });

    // =====================================================================
    // 11. START TRIP
    // =====================================================================
    socket.on('start_trip', async (data) => {
        const { ride_id, driver_id } = data;

        if (!ride_id) return;

        try {
            await pool.query(
                `UPDATE rides SET
                    status = 'ongoing',
                    started_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                AND driver_id = $2`,
                [ride_id, driver_id]
            );

            const fullRide = await getFullRideDetails(ride_id);

            io.to(`ride_${ride_id}`).emit('trip_started', fullRide);
            io.to(`ride_${ride_id}`).emit('trip_started_now', {
                status: 'ongoing',
                started_at: new Date().toISOString(),
                ride_id: ride_id
            });

            if (fullRide.passenger_id) {
                io.to(`user_${fullRide.passenger_id}`).emit('trip_started', {
                    ...fullRide,
                    message: "Sua viagem começou! Boa viagem! 🚗"
                });
            }

        } catch (e) {
            logError('START_TRIP', e);
        }
    });

    // =====================================================================
    // 12. COMPLETE RIDE
    // =====================================================================
    socket.on('complete_ride', async (data) => {
        const { ride_id, driver_id } = data;

        if (!ride_id) return;

        try {
            await pool.query(
                `UPDATE rides SET
                    status = 'completed',
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                AND driver_id = $2
                AND status = 'ongoing'`,
                [ride_id, driver_id]
            );

            const fullRide = await getFullRideDetails(ride_id);

            io.to(`ride_${ride_id}`).emit('ride_completed', {
                ...fullRide,
                completed_at: new Date().toISOString(),
                message: "Viagem finalizada! Obrigado por viajar conosco!"
            });

            if (fullRide.passenger_id) {
                io.to(`user_${fullRide.passenger_id}`).emit('ride_completed', {
                    ride_id: ride_id,
                    completed_at: new Date().toISOString(),
                    message: "Sua viagem foi concluída. Avalie o motorista!"
                });
            }

        } catch (e) {
            logError('COMPLETE_RIDE', e);
        }
    });

    // =====================================================================
    // 13. CANCEL RIDE
    // =====================================================================
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role, reason, user_id } = data;

        if (!ride_id || !role) return;

        try {
            await pool.query(
                `UPDATE rides SET
                    status = 'cancelled',
                    cancelled_at = NOW(),
                    cancelled_by = $1,
                    cancellation_reason = $2,
                    updated_at = NOW()
                 WHERE id = $3`,
                [role, reason || 'Cancelamento solicitado', ride_id]
            );

            const fullRide = await getFullRideDetails(ride_id);

            const msg = role === 'driver'
                ? "O motorista precisou cancelar a corrida."
                : "O passageiro cancelou a solicitação.";

            io.to(`ride_${ride_id}`).emit('ride_cancelled', {
                ride_id: ride_id,
                cancelled_by: role,
                reason: msg,
                cancelled_at: new Date().toISOString()
            });

            const targetId = role === 'driver' ? fullRide?.passenger_id : fullRide?.driver_id;
            if (targetId) {
                io.to(`user_${targetId}`).emit('ride_cancelled', {
                    ride_id: ride_id,
                    cancelled_by: role,
                    reason: msg,
                    cancelled_at: new Date().toISOString()
                });
            }

            if (fullRide?.status === 'searching') {
                const driversRes = await pool.query(`
                    SELECT socket_id
                    FROM driver_positions
                    WHERE status = 'online'
                    AND last_update > NOW() - INTERVAL '30 minutes'
                    AND socket_id IS NOT NULL
                `);

                driversRes.rows.forEach(driver => {
                    if (driver.socket_id) {
                        io.to(driver.socket_id).emit('ride_cancelled_by_passenger', {
                            ride_id: ride_id,
                            message: 'Esta corrida foi cancelada pelo passageiro.',
                            timestamp: new Date().toISOString()
                        });
                    }
                });
            }

        } catch (e) {
            logError('CANCEL_RIDE', e);
        }
    });

    // =====================================================================
    // 14. SEND MESSAGE
    // =====================================================================
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, image_data, message_type = 'text' } = data;

        if (!ride_id || !sender_id) {
            socket.emit('chat_error', { message: 'Dados incompletos' });
            return;
        }

        try {
            const rideCheck = await pool.query(
                `SELECT passenger_id, driver_id FROM rides WHERE id = $1`,
                [ride_id]
            );

            if (rideCheck.rows.length === 0) {
                socket.emit('chat_error', { message: 'Corrida não encontrada' });
                return;
            }

            const ride = rideCheck.rows[0];
            if (ride.passenger_id !== sender_id && ride.driver_id !== sender_id) {
                socket.emit('chat_error', { message: 'Você não é participante desta corrida' });
                return;
            }

            const res = await pool.query(
                `INSERT INTO chat_messages (
                    ride_id, sender_id, text, image_url,
                    message_type, created_at, is_read
                )
                VALUES ($1, $2, $3, $4, $5, NOW(), false)
                RETURNING *`,
                [ride_id, sender_id, text || null, image_data || null, message_type]
            );

            const msg = res.rows[0];

            const senderRes = await pool.query(
                'SELECT name, photo, role FROM users WHERE id = $1',
                [sender_id]
            );

            const senderInfo = senderRes.rows[0];

            const payload = {
                id: msg.id,
                ride_id: msg.ride_id,
                sender_id: msg.sender_id,
                text: msg.text,
                image_url: msg.image_url,
                message_type: msg.message_type,
                created_at: msg.created_at.toISOString(),
                sender_name: senderInfo?.name || 'Usuário',
                sender_photo: senderInfo?.photo || null,
                sender_role: senderInfo?.role || 'user',
                is_read: false
            };

            io.to(`ride_${ride_id}`).emit('receive_message', payload);

            const recipientId = ride.passenger_id === sender_id ? ride.driver_id : ride.passenger_id;
            if (recipientId) {
                io.to(`user_${recipientId}`).emit('new_message_notification', {
                    ride_id: ride_id,
                    message_id: msg.id,
                    sender_name: senderInfo?.name,
                    preview: text?.substring(0, 50) || '📷 Imagem',
                    timestamp: msg.created_at.toISOString()
                });
            }

        } catch (e) {
            logError('CHAT_MSG', e);
            socket.emit('chat_error', { message: 'Erro ao enviar mensagem' });
        }
    });

    // =====================================================================
    // 15. MARK MESSAGES READ
    // =====================================================================
    socket.on('mark_messages_read', async (data) => {
        const { ride_id, user_id } = data;

        if (!ride_id || !user_id) return;

        try {
            await pool.query(
                `UPDATE chat_messages
                 SET is_read = true, read_at = NOW()
                 WHERE ride_id = $1
                 AND sender_id != $2
                 AND is_read = false`,
                [ride_id, user_id]
            );

            io.to(`ride_${ride_id}`).emit('messages_read', {
                ride_id: ride_id,
                read_by: user_id,
                timestamp: new Date().toISOString()
            });

        } catch (e) {
            logError('MARK_READ', e);
        }
    });

    // =====================================================================
    // 16. TYPING INDICATOR
    // =====================================================================
    socket.on('typing_indicator', (data) => {
        const { ride_id, user_id, is_typing } = data;

        if (!ride_id || !user_id) return;

        socket.to(`ride_${ride_id}`).emit('user_typing', {
            user_id: user_id,
            is_typing: is_typing,
            timestamp: new Date().toISOString()
        });
    });

    // =====================================================================
    // 17. REQUEST PAYMENT
    // =====================================================================
    socket.on('request_payment', (data) => {
        const { ride_id, passenger_id, amount, driver_id } = data;

        if (ride_id && passenger_id) {
            const paymentPayload = {
                ride_id,
                passenger_id,
                driver_id,
                amount: amount || 0,
                timestamp: new Date().toISOString(),
                message: "Pagamento solicitado pelo motorista"
            };

            io.to(`user_${passenger_id}`).emit('payment_requested_overlay', paymentPayload);
            io.to(`ride_${ride_id}`).emit('payment_requested', paymentPayload);
        }
    });

    // =====================================================================
    // 18. PING
    // =====================================================================
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
            callback({
                pong: true,
                timestamp: new Date().toISOString(),
                socket_id: socketId
            });
        }
    });

    // =====================================================================
    // 19. GET CONNECTION STATUS
    // =====================================================================
    socket.on('get_connection_status', () => {
        socket.emit('connection_status', {
            connected: true,
            socket_id: socketId,
            transport: socket.conn.transport.name,
            timestamp: new Date().toISOString()
        });
    });

    // =====================================================================
    // 20. LEAVE USER
    // =====================================================================
    socket.on('leave_user', async (userId) => {
        if (!userId) return;

        const userIdStr = userId.toString();
        const roomName = `user_${userIdStr}`;

        socket.leave(roomName);
        userSockets.delete(userIdStr);
        socketUsers.delete(socketId);

        try {
            await pool.query(
                "UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1",
                [userId]
            );

            await pool.query(
                `UPDATE driver_positions SET status = 'offline' WHERE driver_id = $1`,
                [userId]
            );

        } catch (e) {
            logError('LEAVE_USER', e);
        }
    });

    // =====================================================================
    // 21. DISCONNECT
    // =====================================================================
    socket.on('disconnect', (reason) => {
        console.log(`❌ [SOCKET] Desconectado: ${socketId} - Razão: ${reason}`);
        handleDisconnect(socketId, reason);
    });

    socket.on('error', (error) => {
        logError('SOCKET_ERROR', { socketId, error: error.message });
    });
}

/**
 * Lógica de Desconexão com Debounce
 */
async function handleDisconnect(socketId, reason = 'unknown') {
    try {
        const userId = socketUsers.get(socketId);

        if (userId) {
            const posRes = await pool.query(
                'SELECT driver_id FROM driver_positions WHERE socket_id = $1',
                [socketId]
            );

            if (posRes.rows.length > 0) {
                const driverId = posRes.rows[0].driver_id;

                const timeout = setTimeout(async () => {
                    try {
                        const check = await pool.query(
                            'SELECT socket_id, status FROM driver_positions WHERE driver_id = $1',
                            [driverId]
                        );

                        if (check.rows.length > 0 && check.rows[0].socket_id === socketId) {
                            await pool.query(
                                'UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1',
                                [driverId]
                            );

                            await pool.query(
                                `UPDATE driver_positions SET status = 'offline' WHERE driver_id = $1`,
                                [driverId]
                            );

                            console.log(`Motorista ${driverId} marcado como offline (Timeout 5min)`);

                            const onlineCount = await socketController.countOnlineDrivers();
                            io.emit('drivers_online_count', onlineCount);
                        }

                        disconnectTimers.delete(driverId);
                        socketUsers.delete(socketId);
                        userSockets.delete(driverId);

                    } catch (err) {
                        logError('DISCONNECT_TIMEOUT', err);
                    }
                }, 300000);

                disconnectTimers.set(driverId, timeout);
            } else {
                await pool.query(
                    'UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1',
                    [userId]
                );

                socketUsers.delete(socketId);
                userSockets.delete(userId);
            }
        }

        await socketController.removeDriverPosition(socketId);

        const onlineCount = await socketController.countOnlineDrivers();
        io.emit('drivers_online_count', onlineCount);

    } catch (e) {
        logError('DISCONNECT_HANDLER', e);
    }
}

// ===========================================================================
// HELPER METHODS
// ===========================================================================

function getIO() {
    return io;
}

function emitGlobal(event, data) {
    if (io) {
        io.emit(event, data);
        logSystem('SOCKET_BROADCAST', `Evento global: ${event}`);
    }
}

function emitToUser(userId, event, data) {
    if (!userId) {
        logError('EMIT_TO_USER', 'UserId não fornecido');
        return;
    }

    if (io) {
        const roomName = `user_${userId.toString()}`;
        io.to(roomName).emit(event, data);
    }
}

function emitToRide(rideId, event, data) {
    if (!rideId) return;

    if (io) {
        const roomName = `ride_${rideId}`;
        io.to(roomName).emit(event, data);
    }
}

function emitToRoom(room, event, data) {
    if (io && room) {
        io.to(room).emit(event, data);
    }
}

async function isUserOnline(userId) {
    try {
        const result = await pool.query(
            'SELECT is_online FROM users WHERE id = $1',
            [userId]
        );
        return result.rows[0]?.is_online || false;
    } catch (e) {
        logError('CHECK_ONLINE', e);
        return false;
    }
}

function getUserSocket(userId) {
    return userSockets.get(userId.toString());
}

async function getOnlineUsers() {
    try {
        const result = await pool.query(
            'SELECT id, name, role FROM users WHERE is_online = true'
        );
        return result.rows;
    } catch (e) {
        logError('GET_ONLINE_USERS', e);
        return [];
    }
}

function setupSocketIO(httpServer) {
    console.log('🔌 [SOCKET] Inicializando serviço de tempo real...');

    if (httpServer && typeof httpServer.on === 'function') {
        return initializeSocket(httpServer);
    }

    return initializeSocket;
}

module.exports = {
    initializeSocket,
    setupSocketIO,
    getIO,
    emitGlobal,
    emitToUser,
    emitToRide,
    emitToRoom,
    isUserOnline,
    getUserSocket,
    getOnlineUsers,
    userSockets,
    socketUsers,
    disconnectTimers
};
