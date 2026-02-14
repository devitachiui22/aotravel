/**
 * =================================================================================================
 * ⚡ AOTRAVEL SERVER PRO - SOCKET SERVICE (CORREÇÃO DE REGISTRO IMEDIATO) - COMPLETO
 * =================================================================================================
 *
 * ARQUIVO: src/services/socketService.js
 * DESCRIÇÃO: Motor de comunicação bidirecional em tempo real com registro imediato no banco.
 *            Gerencia salas, rastreamento GPS de alta frequência, fluxo de estado de corridas
 *            e chat criptografado (em trânsito).
 *
 * CORREÇÕES APLICADAS (v5.0.0):
 * 1. ✅ REGISTRO IMEDIATO no banco ao entrar na sala de motoristas
 * 2. ✅ Normalização robusta de ID (driver_id, user_id, id)
 * 3. ✅ Salva posição mesmo sem GPS (lat/lng = 0) para garantir presença
 * 4. ✅ Logs detalhados para debug
 * 5. ✅ Compatível com a estrutura da tabela driver_positions (status = 'online')
 *
 * INTEGRAÇÃO:
 * - SocketController: updateDriverPosition, removeDriverPosition, countOnlineDrivers
 * - RideController: fluxo completo de corridas
 * - DriverHomeScreen: Heartbeat a cada 45 segundos
 *
 * STATUS: 🔥 PRODUCTION READY - REGISTRO IMEDIATO FUNCIONANDO - COMPLETO
 * =================================================================================================
 */

const { Server } = require("socket.io");
const pool = require('../config/db');
const { logSystem, logError, getDistance, getFullRideDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

const socketController = require('../controllers/socketController');
const rideController = require('../controllers/rideController');

let io;

// Armazenamento em memória para debounce de desconexão (Evita flicker em 4G instável)
const disconnectTimers = new Map();
// Mapa de sockets por usuário para acesso rápido
const userSockets = new Map(); // userId -> socketId
// Mapa de usuários por socket para lookup reverso
const socketUsers = new Map(); // socketId -> userId

/**
 * INICIALIZAÇÃO DO SERVIDOR SOCKET.IO
 * Configurado para alta tolerância a latência e desconexões breves.
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
        maxHttpBufferSize: 1e6 // 1MB para suporte a imagens no chat
    });

    // Expor globalmente para acesso via Controllers HTTP
    global.io = io;

    io.on('connection', (socket) => {
        handleConnection(socket);
    });

    logSystem('SOCKET_ENGINE', '🚀 Servidor Real-Time iniciado e pronto para conexões.');

    // Monitoramento periódico
    setInterval(async () => {
        const onlineDrivers = await socketController.countOnlineDrivers();
        if (onlineDrivers > 0) console.log(`📊 [STATUS] Motoristas online: ${onlineDrivers}`);
        io.emit('drivers_online_update', { 
            count: onlineDrivers,
            timestamp: new Date().toISOString()
        });
    }, 10000);

    return io;
}

/**
 * MANIPULADOR DE CONEXÃO (PER-SOCKET LOGIC)
 */
function handleConnection(socket) {
    const socketId = socket.id;
    console.log(`🔌 Nova conexão: ${socketId} (Transport: ${socket.conn.transport.name})`);

    // =============================================================================================
    // 1. GESTÃO DE SALAS E PRESENÇA (ROOM MANAGEMENT)
    // =============================================================================================

    /**
     * Evento: JOIN_USER
     * Ocorre quando o usuário abre o app. Vincula o SocketID ao UserID no banco.
     */
    socket.on('join_user', async (userId) => {
        if (!userId) {
            socket.emit('error', { message: 'User ID não fornecido' });
            return;
        }

        const userIdStr = userId.toString();
        const roomName = `user_${userIdStr}`;

        // Entrar na sala pessoal
        socket.join(roomName);

        // Armazenar mapeamento
        userSockets.set(userIdStr, socketId);
        socketUsers.set(socketId, userIdStr);

        console.log(`👤 [SOCKET] User ${userIdStr} entrou na sala ${roomName}`);

        // Limpa timer de desconexão se o usuário reconectou rápido
        if (disconnectTimers.has(userIdStr)) {
            clearTimeout(disconnectTimers.get(userIdStr));
            disconnectTimers.delete(userIdStr);
            logSystem('SOCKET', `🔄 Reconexão rápida detectada para User ${userIdStr}`);
        }

        try {
            // 1. Atualizar status Online
            await pool.query(
                "UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1",
                [userId]
            );

            // 2. Se for motorista, registrar/atualizar na tabela de radar
            const userRes = await pool.query(
                "SELECT role, name, photo, rating, vehicle_details FROM users WHERE id = $1",
                [userId]
            );

            if (userRes.rows.length > 0) {
                const user = userRes.rows[0];

                if (user.role === 'driver') {
                    // Motorista - atualizar posição com socket_id
                    await pool.query(
                        `INSERT INTO driver_positions (driver_id, socket_id, last_update, status)
                         VALUES ($1, $2, NOW(), 'online')
                         ON CONFLICT (driver_id)
                         DO UPDATE SET
                            socket_id = $2,
                            last_update = NOW(),
                            status = 'online'`,
                        [userId, socketId]
                    );

                    logSystem('SOCKET', `🚗 Motorista ${userId} online`);
                }

                // Buscar corridas pendentes do usuário
                const pendingRides = await pool.query(
                    `SELECT * FROM rides
                     WHERE (passenger_id = $1 OR driver_id = $1)
                     AND status IN ('searching', 'accepted', 'ongoing')
                     ORDER BY created_at DESC`,
                    [userId]
                );

                // Reconectar às salas de corridas ativas
                pendingRides.rows.forEach(ride => {
                    const rideRoom = `ride_${ride.id}`;
                    socket.join(rideRoom);
                    logSystem('SOCKET', `User ${userId} reconectado à sala ${rideRoom}`);
                });
            }

            // Confirmação para o cliente
            socket.emit('joined_ack', {
                success: true,
                room: roomName,
                status: 'online',
                user_id: userId,
                socket_id: socketId,
                timestamp: new Date().toISOString()
            });

            console.log(`✅ [SOCKET] User ${userId} entrou na sala privada: ${roomName}`);

        } catch (e) {
            logError('JOIN_USER', e);
            socket.emit('error', { message: 'Erro ao registrar usuário', error: e.message });
        }
    });

    /**
     * Evento: JOIN_DRIVER_ROOM (A CORREÇÃO CRÍTICA - REGISTRO IMEDIATO)
     * 🚗 CRÍTICO: ENTRADA DE MOTORISTA COM POSIÇÃO
     */
    socket.on('join_driver_room', async (data) => {
        // 1. Normalizar ID e Dados
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
            driverId = data; // Veio apenas o ID (int ou string)
        }

        if (!driverId) {
            console.error('❌ [SOCKET] join_driver_room falhou: ID nulo');
            return;
        }

        const driverIdStr = driverId.toString();

        // 2. Entrar nas salas do Socket.IO
        socket.join('drivers');
        socket.join(`driver_${driverIdStr}`);
        socket.join(`user_${driverIdStr}`); // Garantia extra

        // Armazenar mapeamento
        userSockets.set(driverIdStr, socketId);
        socketUsers.set(socketId, driverIdStr);
        
        console.log(`🚗 [SOCKET] Driver ${driverIdStr} REGISTRADO (Socket: ${socketId})`);

        // Limpa timer de desconexão se o motorista reconectou rápido
        if (disconnectTimers.has(driverIdStr)) {
            clearTimeout(disconnectTimers.get(driverIdStr));
            disconnectTimers.delete(driverIdStr);
            logSystem('SOCKET', `🔄 Reconexão rápida detectada para Driver ${driverIdStr}`);
        }

        // 3. 🔥 SALVAR NO BANCO IMEDIATAMENTE (SEM CONDICIONAIS DE GPS)
        // Isso garante que o motorista exista na tabela driver_positions
        try {
            await socketController.updateDriverPosition({
                driver_id: driverIdStr,
                lat: lat,
                lng: lng,
                heading: heading,
                speed: speed,
                status: 'online'
            }, socket);
            
            console.log(`💾 [DB] Driver ${driverIdStr} salvo como ONLINE no banco (lat: ${lat}, lng: ${lng})`);
            
        } catch (e) {
            console.error(`❌ [DB ERROR] Falha ao salvar driver ${driverIdStr}:`, e.message);
        }

        // 4. Enviar confirmação
        socket.emit('joined_ack', { 
            room: 'drivers',
            driver_id: driverIdStr,
            status: 'online', 
            timestamp: new Date().toISOString() 
        });

        // 5. Emitir contagem atualizada
        const onlineCount = await socketController.countOnlineDrivers();
        io.emit('drivers_online_count', onlineCount);
    });

    /**
     * Evento: JOIN_RIDE
     * Ocorre ao entrar na tela de detalhes da corrida. Habilita Chat e Rastreamento.
     */
    socket.on('join_ride', (rideId) => {
        if (!rideId) {
            socket.emit('error', { message: 'Ride ID não fornecido' });
            return;
        }

        const roomName = `ride_${rideId}`;
        socket.join(roomName);

        logSystem('SOCKET', `🚖 Socket ${socketId} entrou na sala da corrida: ${roomName}`);

        socket.emit('ride_joined', {
            success: true,
            ride_id: rideId,
            room: roomName,
            timestamp: new Date().toISOString()
        });
    });

    /**
     * Evento: LEAVE_RIDE
     * Sair da sala da corrida
     */
    socket.on('leave_ride', (rideId) => {
        if (!rideId) return;

        const roomName = `ride_${rideId}`;
        socket.leave(roomName);

        logSystem('SOCKET', `Socket ${socketId} saiu da sala: ${roomName}`);

        socket.emit('ride_left', {
            success: true,
            ride_id: rideId,
            room: roomName
        });
    });

    // =============================================================================================
    // 2. TELEMETRIA, RADAR E GEOLOCALIZAÇÃO
    // =============================================================================================

    /**
     * Evento: UPDATE_LOCATION (Heartbeat do Motorista)
     */
    socket.on('update_location', async (data) => {
        const driverId = data.driver_id || data.user_id || data.id;
        
        if (!driverId || !data.lat || !data.lng) {
            // Log silencioso para não poluir
            return;
        }

        // Atualiza a posição e renova o timestamp no banco
        await socketController.updateDriverPosition({
            driver_id: driverId,
            lat: data.lat || 0,
            lng: data.lng || 0,
            heading: data.heading || 0,
            speed: data.speed || 0,
            status: 'online'
        }, socket);

        // Se tiver ride_id, atualizar também no trip
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

    /**
     * Evento: UPDATE_TRIP_GPS
     * Usado DURANTE uma corrida ativa para mostrar o carrinho movendo no mapa do passageiro.
     */
    socket.on('update_trip_gps', (data) => {
        const { ride_id, lat, lng, rotation, speed } = data;

        if (!ride_id || !lat || !lng) return;

        // Relay direto para a sala da corrida (Passageiro escuta aqui)
        io.to(`ride_${ride_id}`).emit('driver_location_update', {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            rotation: parseFloat(rotation || 0),
            speed: parseFloat(speed || 0),
            timestamp: new Date().toISOString(),
            ride_id: ride_id
        });
    });

    /**
     * Evento: GET_NEARBY_DRIVERS
     * Passageiro solicita motoristas próximos
     */
    socket.on('get_nearby_drivers', async (data) => {
        const { lat, lng, radius = 15 } = data;

        if (!lat || !lng) return;

        try {
            const driversRes = await pool.query(`
                SELECT
                    dp.driver_id,
                    dp.lat,
                    dp.lng,
                    dp.heading,
                    u.name,
                    u.rating,
                    u.vehicle_details,
                    u.photo
                FROM driver_positions dp
                JOIN users u ON dp.driver_id = u.id
                WHERE u.is_online = true
                AND u.role = 'driver'
                AND u.is_blocked = false
                AND dp.status = 'online'
                AND dp.last_update > NOW() - INTERVAL '30 minutes'
            `);

            const nearbyDrivers = driversRes.rows
                .map(driver => {
                    const distance = getDistance(lat, lng, driver.lat, driver.lng);
                    return {
                        ...driver,
                        distance: parseFloat(distance.toFixed(2))
                    };
                })
                .filter(driver => driver.distance <= radius)
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 20); // Limite de 20 motoristas

            socket.emit('nearby_drivers', {
                drivers: nearbyDrivers,
                count: nearbyDrivers.length,
                timestamp: new Date().toISOString()
            });

        } catch (e) {
            logError('NEARBY_DRIVERS', e);
        }
    });

    // =============================================================================================
    // 3. FLUXO DE CORRIDA (RIDE LIFECYCLE)
    // =============================================================================================

    /**
     * Evento: REQUEST_RIDE (Fallback)
     */
    socket.on('request_ride', (data) => {
        console.log('🚕 [SOCKET] Request ride (via socket)');
        socket.emit('ride_request_received', {
            message: 'Solicitação recebida, processando...',
            timestamp: new Date().toISOString()
        });
    });

    /**
     * Evento: ACCEPT_RIDE (Aceite de Corrida) - CRÍTICO
     * Usa transação para evitar duplo aceite.
     */
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

            // 1. Lock Row com FOR UPDATE SKIP LOCKED
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

            // 2. Validações
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

            // 3. Atualizar status
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

            // 4. Buscar dados completos
            const fullRide = await getFullRideDetails(ride_id);

            // 5. Entrar na sala da corrida
            socket.join(`ride_${ride_id}`);

            // 6. Notificações em tempo real
            const matchPayload = {
                ...fullRide,
                matched_at: new Date().toISOString(),
                message: "Motorista a caminho do ponto de embarque!"
            };

            // Notificar sala da corrida
            io.to(`ride_${ride_id}`).emit('match_found', matchPayload);
            io.to(`ride_${ride_id}`).emit('ride_accepted', matchPayload);

            // Notificar passageiro
            if (fullRide.passenger_id) {
                io.to(`user_${fullRide.passenger_id}`).emit('match_found', matchPayload);
            }

            // Notificar todos os outros motoristas que a corrida foi aceita
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

            console.log(`✅ [SOCKET] Corrida #${ride_id} aceita por Driver ${driver_id}`);

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

    /**
     * Evento: START_TRIP
     */
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

            // Notificações
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

            console.log(`✅ [SOCKET] Corrida #${ride_id} iniciada`);

        } catch (e) {
            logError('START_TRIP', e);
        }
    });

    /**
     * Evento: COMPLETE_RIDE
     */
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

            console.log(`✅ [SOCKET] Corrida #${ride_id} finalizada`);

        } catch (e) {
            logError('COMPLETE_RIDE', e);
        }
    });

    /**
     * Evento: CANCEL_RIDE
     */
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

            // Mensagem amigável
            const msg = role === 'driver'
                ? "O motorista precisou cancelar a corrida."
                : "O passageiro cancelou a solicitação.";

            // Notifica todos na sala
            io.to(`ride_${ride_id}`).emit('ride_cancelled', {
                ride_id: ride_id,
                cancelled_by: role,
                reason: msg,
                cancelled_at: new Date().toISOString()
            });

            // Notifica o outro participante
            const targetId = role === 'driver' ? fullRide?.passenger_id : fullRide?.driver_id;
            if (targetId) {
                io.to(`user_${targetId}`).emit('ride_cancelled', {
                    ride_id: ride_id,
                    cancelled_by: role,
                    reason: msg,
                    cancelled_at: new Date().toISOString()
                });
            }

            // Se estava buscando motorista, notifica motoristas próximos
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

            console.log(`✅ [SOCKET] Corrida #${ride_id} cancelada por ${role}`);

        } catch (e) {
            logError('CANCEL_RIDE', e);
        }
    });

    // =============================================================================================
    // 4. CHAT E COMUNICAÇÃO
    // =============================================================================================

    /**
     * Evento: SEND_MESSAGE
     * Envia mensagem no chat da corrida
     */
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, image_data, message_type = 'text' } = data;

        if (!ride_id || !sender_id) {
            socket.emit('chat_error', { message: 'Dados incompletos' });
            return;
        }

        try {
            // Validar se o remetente é participante da corrida
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

            // Salva no banco
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

            // Enriquece com dados do remetente
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

            // Emite para a sala
            io.to(`ride_${ride_id}`).emit('receive_message', payload);

            // Notifica o destinatário
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

            console.log(`💬 [SOCKET] Mensagem enviada na corrida #${ride_id}`);

        } catch (e) {
            logError('CHAT_MSG', e);
            socket.emit('chat_error', { message: 'Erro ao enviar mensagem' });
        }
    });

    /**
     * Evento: MARK_MESSAGES_READ
     * Marca mensagens como lidas
     */
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

    /**
     * Evento: TYPING_INDICATOR
     * Indicador de digitação
     */
    socket.on('typing_indicator', (data) => {
        const { ride_id, user_id, is_typing } = data;

        if (!ride_id || !user_id) return;

        socket.to(`ride_${ride_id}`).emit('user_typing', {
            user_id: user_id,
            is_typing: is_typing,
            timestamp: new Date().toISOString()
        });
    });

    // =============================================================================================
    // 5. EVENTOS DE PAGAMENTO
    // =============================================================================================

    /**
     * Evento: REQUEST_PAYMENT
     * Motorista solicita pagamento ao passageiro
     */
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
            console.log(`💰 [SOCKET] Pagamento solicitado para passageiro ${passenger_id} - Corrida #${ride_id}`);

            // Notificar também a sala da corrida
            io.to(`ride_${ride_id}`).emit('payment_requested', paymentPayload);
        }
    });

    // =============================================================================================
    // 6. UTILITÁRIOS E STATUS
    // =============================================================================================

    /**
     * Evento: PING
     * Manter conexão ativa
     */
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
            callback({
                pong: true,
                timestamp: new Date().toISOString(),
                socket_id: socketId
            });
        }
    });

    /**
     * Evento: GET_CONNECTION_STATUS
     * Verificar status da conexão
     */
    socket.on('get_connection_status', () => {
        socket.emit('connection_status', {
            connected: true,
            socket_id: socketId,
            transport: socket.conn.transport.name,
            timestamp: new Date().toISOString()
        });
    });

    /**
     * Evento: LEAVE_USER
     * Desconectar usuário manualmente
     */
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

            console.log(`User ${userId} desconectado manualmente`);

        } catch (e) {
            logError('LEAVE_USER', e);
        }
    });

    // =============================================================================================
    // 7. GESTÃO DE DESCONEXÃO
    // =============================================================================================

    socket.on('disconnect', (reason) => {
        console.log(`❌ [SOCKET] Desconectado: ${socketId} - Razão: ${reason}`);
        handleDisconnect(socketId, reason);
    });

    socket.on('error', (error) => {
        logError('SOCKET_ERROR', { socketId, error: error.message });
    });
}

/**
 * Lógica de Desconexão com Debounce (Buffer de 5 minutos)
 */
async function handleDisconnect(socketId, reason = 'unknown') {
    try {
        // Recuperar userId deste socket
        const userId = socketUsers.get(socketId);

        if (userId) {
            // Verifica se era um motorista
            const posRes = await pool.query(
                'SELECT driver_id FROM driver_positions WHERE socket_id = $1',
                [socketId]
            );

            if (posRes.rows.length > 0) {
                const driverId = posRes.rows[0].driver_id;

                // Define timer de 5 minutos para marcar como offline
                const timeout = setTimeout(async () => {
                    try {
                        // Verifica se o socket_id ainda é o mesmo
                        const check = await pool.query(
                            'SELECT socket_id, status FROM driver_positions WHERE driver_id = $1',
                            [driverId]
                        );

                        if (check.rows.length > 0 && check.rows[0].socket_id === socketId) {
                            // Realmente caiu e não voltou
                            await pool.query(
                                'UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1',
                                [driverId]
                            );

                            await pool.query(
                                `UPDATE driver_positions SET status = 'offline' WHERE driver_id = $1`,
                                [driverId]
                            );

                            console.log(`Motorista ${driverId} marcado como offline (Timeout 5min)`);

                            // Atualizar contagem
                            const onlineCount = await socketController.countOnlineDrivers();
                            io.emit('drivers_online_count', onlineCount);
                        }

                        disconnectTimers.delete(driverId);
                        socketUsers.delete(socketId);
                        userSockets.delete(driverId);

                    } catch (err) {
                        logError('DISCONNECT_TIMEOUT', err);
                    }
                }, 300000); // 5 minutos

                disconnectTimers.set(driverId, timeout);
            } else {
                // Não é motorista, marca offline imediatamente
                await pool.query(
                    'UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1',
                    [userId]
                );

                socketUsers.delete(socketId);
                userSockets.delete(userId);
            }
        }

        // REMOVER MOTORISTA DA TABELA DE POSIÇÕES VIA CONTROLLER
        await socketController.removeDriverPosition(socketId);

        // ATUALIZAR CONTAGEM DE ONLINE
        const onlineCount = await socketController.countOnlineDrivers();
        console.log(`📊 [SOCKET] Motoristas online agora: ${onlineCount}`);

        // Emitir atualização para todos
        io.emit('drivers_online_count', onlineCount);

    } catch (e) {
        logError('DISCONNECT_HANDLER', e);
    }
}

// =================================================================================================
// HELPER METHODS (EXPORTS)
// =================================================================================================

/**
 * Obtém a instância do Socket.IO
 */
function getIO() {
    return io;
}

/**
 * Emite evento para todos os sockets conectados (Global Broadcast)
 */
function emitGlobal(event, data) {
    if (io) {
        io.emit(event, data);
        logSystem('SOCKET_BROADCAST', `Evento global: ${event}`);
    }
}

/**
 * Emite evento para um usuário específico (Targeted)
 */
function emitToUser(userId, event, data) {
    if (!userId) {
        logError('EMIT_TO_USER', 'UserId não fornecido');
        return;
    }

    if (io) {
        const roomName = `user_${userId.toString()}`;
        io.to(roomName).emit(event, data);

        if (process.env.NODE_ENV === 'development') {
            logSystem('SOCKET_EMIT', `📨 Evento ${event} enviado para User ${userId}`);
        }
    }
}

/**
 * Emite evento para uma sala de corrida específica
 */
function emitToRide(rideId, event, data) {
    if (!rideId) return;

    if (io) {
        const roomName = `ride_${rideId}`;
        io.to(roomName).emit(event, data);
    }
}

/**
 * Emite evento para uma sala específica
 */
function emitToRoom(room, event, data) {
    if (io && room) {
        io.to(room).emit(event, data);
    }
}

/**
 * Verifica se um usuário está online
 */
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

/**
 * Obtém socket_id de um usuário
 */
function getUserSocket(userId) {
    return userSockets.get(userId.toString());
}

/**
 * Obtém todos os usuários online
 */
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

/**
 * Setup Socket.IO (alias para initializeSocket para compatibilidade)
 */
function setupSocketIO(httpServer) {
    console.log('🔌 [SOCKET] Inicializando serviço de tempo real...');

    // Se receber uma instância existente, usar ela
    if (httpServer && typeof httpServer.on === 'function') {
        return initializeSocket(httpServer);
    }

    // Caso contrário, retornar função de inicialização
    return initializeSocket;
}

module.exports = {
    // Inicialização
    initializeSocket,
    setupSocketIO,
    getIO,

    // Emissores principais
    emitGlobal,
    emitToUser,
    emitToRide,
    emitToRoom,

    // Utilitários
    isUserOnline,
    getUserSocket,
    getOnlineUsers,

    // Mapas (para debug)
    userSockets,
    socketUsers,
    disconnectTimers
};
