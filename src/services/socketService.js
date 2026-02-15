/**
 * =================================================================================================
 * ⚡ AOTRAVEL SERVER PRO - TITANIUM SOCKET ENGINE v8.0.0
 * =================================================================================================
 *
 * ARQUIVO: src/services/socketService.js
 * DESCRIÇÃO: Motor de comunicação Real-Time de alta performance.
 *            Gerencia conexões, salas, roteamento de eventos e sincronização de estado.
 *
 * ✅ CARACTERÍSTICAS DE PRODUÇÃO:
 * 1. Bridge Socket-to-Controller (Reutiliza lógica ACID dos controllers)
 * 2. Gerenciamento robusto de salas (Rooms)
 * 3. Sistema de Heartbeat e Keep-Alive
 * 4. Debounce de desconexão (Prevenção de flickering)
 * 5. Logs detalhados de tráfego de eventos
 * 6. Integração profunda com socketController (Estado do motorista)
 *
 * STATUS: 🔥 PRODUCTION READY - CRITICAL CORE COMPONENT
 * =================================================================================================
 */

const { Server } = require("socket.io");
const pool = require('../config/db');
const { logSystem, logError, getFullRideDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');
const socketController = require('../controllers/socketController');
const rideController = require('../controllers/rideController'); // ✅ Importação do Controller Lógico

// Cores para Logs
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    dim: '\x1b[2m'
};

let io;

// Mapas de Estado em Memória (Alta Performance)
const userSockets = new Map(); // userId -> socketId
const socketUsers = new Map(); // socketId -> userId
const disconnectTimers = new Map(); // userId -> Timeout

// Configurações
const DISCONNECT_GRACE_PERIOD = 10000; // 10 segundos de tolerância para reconexão

/**
 * =================================================================================================
 * 1. INICIALIZAÇÃO DO SERVIDOR
 * =================================================================================================
 */
function initializeSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: SYSTEM_CONFIG.SERVER?.CORS_ORIGIN || "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        pingTimeout: SYSTEM_CONFIG.SOCKET?.PING_TIMEOUT || 20000,
        pingInterval: SYSTEM_CONFIG.SOCKET?.PING_INTERVAL || 25000,
        transports: SYSTEM_CONFIG.SOCKET?.TRANSPORTS || ['websocket', 'polling'], // Websocket preferencial
        allowEIO3: true,
        connectTimeout: 10000,
        maxHttpBufferSize: 1e6
    });

    // Expor globalmente para uso em controllers HTTP
    global.io = io;

    io.on('connection', (socket) => {
        handleConnection(socket);
    });

    logSystem('SOCKET_ENGINE', `${colors.green}✅ [SOCKET ENGINE] Servidor iniciado e pronto.${colors.reset}`);

    // Loop de manutenção (Logs periódicos de status)
    setInterval(async () => {
        const clients = io.engine?.clientsCount || 0;
        const onlineDrivers = await socketController.countOnlineDrivers();
        if (clients > 0) {
            io.emit('server_status', {
                online_users: clients,
                online_drivers: onlineDrivers,
                timestamp: new Date().toISOString()
            });
        }
    }, 30000);

    return io;
}

/**
 * =================================================================================================
 * 2. HANDLER DE CONEXÃO
 * =================================================================================================
 */
function handleConnection(socket) {
    const socketId = socket.id;
    const transport = socket.conn.transport.name;
    const query = socket.handshake.query;

    console.log(`${colors.blue}🔌 [CONNECT] Nova conexão: ${socketId} (${transport})${colors.reset}`);

    // Recuperação automática se userId vier na query (Reconexão rápida)
    if (query && query.userId) {
        const userId = query.userId;
        const role = query.role || 'passenger';
        console.log(`${colors.cyan}🔄 [AUTO-JOIN] Reconexão detectada para User ${userId} (${role})${colors.reset}`);

        if (role === 'driver') {
            _handleJoinDriver(socket, { driver_id: userId, auto: true });
        } else {
            _handleJoinUser(socket, userId);
        }
    }

    // =================================================================
    // 2.1. REGISTRO DE USUÁRIO (JOIN USER)
    // =================================================================
    socket.on('join_user', (userId) => _handleJoinUser(socket, userId));

    // =================================================================
    // 2.2. REGISTRO DE MOTORISTA (JOIN DRIVER)
    // =================================================================
    socket.on('join_driver_room', (data) => _handleJoinDriver(socket, data));

    // =================================================================
    // 2.3. RIDE REQUEST (BRIDGE PARA CONTROLLER)
    // =================================================================
    socket.on('request_ride', (data) => {
        console.log(`${colors.magenta}🚕 [REQUEST] Recebido via Socket${colors.reset}`);
        // Roteia para o rideController.requestRide simulando HTTP
        routeToController(rideController.requestRide, data, socket, 'ride_request_response');
    });

    // =================================================================
    // 2.4. ACCEPT RIDE (BRIDGE PARA CONTROLLER)
    // =================================================================
    socket.on('accept_ride', (data) => {
        console.log(`${colors.magenta}🤝 [ACCEPT] Recebido via Socket${colors.reset}`);
        // Roteia para o rideController.acceptRide simulando HTTP
        routeToController(rideController.acceptRide, data, socket, 'ride_accepted_confirmation');
    });

    // =================================================================
    // 2.5. ATUALIZAÇÃO DE LOCALIZAÇÃO (HIGH FREQUENCY)
    // =================================================================
    socket.on('update_location', (data) => _handleLocationUpdate(socket, data));
    socket.on('update_trip_gps', (data) => _handleTripGpsUpdate(socket, data));

    // =================================================================
    // 2.6. EVENTOS DE CORRIDA (IN-RIDE)
    // =================================================================
    socket.on('join_ride', (rideId) => {
        if (!rideId) return;
        const roomName = `ride_${rideId}`;
        socket.join(roomName);
        socket.emit('ride_joined', {
            success: true,
            ride_id: rideId,
            room: roomName,
            timestamp: new Date().toISOString()
        });
    });

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

    socket.on('start_trip', (data) => _handleStartTrip(socket, data));
    socket.on('complete_ride', (data) => _handleCompleteRide(socket, data));

    // Cancelamento via Socket
    socket.on('cancel_ride', async (data) => {
        routeToController(rideController.cancelRide, data, socket, 'ride_cancelled_ack');
    });

    // =================================================================
    // 2.7. CHAT E COMUNICAÇÃO
    // =================================================================
    socket.on('send_message', (data) => _handleChatMessage(socket, data));
    socket.on('typing_indicator', (data) => _handleTyping(socket, data));
    socket.on('mark_messages_read', (data) => _handleReadReceipt(socket, data));

    // =================================================================
    // 2.8. PAGAMENTOS
    // =================================================================
    socket.on('request_payment', (data) => _handlePaymentRequest(socket, data));
    socket.on('confirm_payment', (data) => _handlePaymentConfirmation(socket, data));

    // =================================================================
    // 2.9. UTILITÁRIOS
    // =================================================================
    socket.on('get_nearby_drivers', (data) => _handleGetNearbyDrivers(socket, data));
    socket.on('heartbeat', (data) => _handleHeartbeat(socket, data));
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
            callback({
                pong: true,
                timestamp: new Date().toISOString(),
                socket_id: socketId
            });
        }
    });
    socket.on('get_connection_status', () => {
        socket.emit('connection_status', {
            connected: true,
            socket_id: socketId,
            transport: socket.conn.transport.name,
            timestamp: new Date().toISOString()
        });
    });
    socket.on('leave_user', (userId) => _handleLeaveUser(socket, userId));

    // =================================================================
    // 2.10. DESCONEXÃO
    // =================================================================
    socket.on('disconnect', (reason) => handleDisconnect(socket, reason));
    socket.on('error', (error) => {
        logError('SOCKET_ERROR', { socketId, error: error.message });
    });
}

/**
 * =================================================================================================
 * 3. LÓGICA DETALHADA DOS HANDLERS
 * =================================================================================================
 */

// --- 3.1 JOIN USER ---
async function _handleJoinUser(socket, userId) {
    if (!userId) {
        socket.emit('error', { message: 'User ID não fornecido' });
        return;
    }

    const userIdStr = userId.toString();
    const roomName = `user_${userIdStr}`;

    socket.join(roomName);
    userSockets.set(userIdStr, socket.id);
    socketUsers.set(socket.id, userIdStr);

    // Cancelar timer de desconexão se existir (usuário voltou rápido)
    if (disconnectTimers.has(userIdStr)) {
        clearTimeout(disconnectTimers.get(userIdStr));
        disconnectTimers.delete(userIdStr);
        console.log(`${colors.green}♻️ [RECONNECT] Usuário ${userIdStr} restaurado antes do timeout.${colors.reset}`);
    }

    try {
        await pool.query("UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1", [userId]);

        // Buscar corridas pendentes para reentrar nas salas
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

        socket.emit('joined_ack', {
            success: true,
            room: roomName,
            user_id: userId,
            socket_id: socket.id,
            status: 'online',
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error(`❌ Erro ao registrar user ${userId}:`, e.message);
        socket.emit('error', { message: 'Erro ao registrar usuário', error: e.message });
    }
}

// --- 3.2 JOIN DRIVER ---
async function _handleJoinDriver(socket, data) {
    console.log('\n🔴🔴🔴🔴🔴 JOIN DRIVER ROOM 🔴🔴🔴🔴🔴');
    console.log('Dados recebidos:', JSON.stringify(data, null, 2));

    let driverId = null;
    let lat = 0.0, lng = 0.0, heading = 0.0, speed = 0.0;

    // Normalização de dados
    if (typeof data === 'object') {
        driverId = data.driver_id || data.user_id || data.id;
        lat = parseFloat(data.lat) || 0.0;
        lng = parseFloat(data.lng) || 0.0;
        heading = parseFloat(data.heading) || 0;
        speed = parseFloat(data.speed) || 0;
    } else {
        driverId = data;
    }

    if (!driverId) {
        console.error('❌ [SOCKET] join_driver_room falhou: ID nulo');
        return;
    }

    const driverIdStr = driverId.toString();

    // Entrar nas salas críticas
    socket.join('drivers');          // Sala global de motoristas
    socket.join(`driver_${driverIdStr}`); // Sala privada do motorista
    socket.join(`user_${driverIdStr}`);   // Sala de usuário (para chat/notificações)

    userSockets.set(driverIdStr, socket.id);
    socketUsers.set(socket.id, driverIdStr);

    console.log(`🚗 [SOCKET] Driver ${driverIdStr} REGISTRADO (Socket: ${socket.id})`);

    // Cancelar timer de desconexão
    if (disconnectTimers.has(driverIdStr)) {
        clearTimeout(disconnectTimers.get(driverIdStr));
        disconnectTimers.delete(driverIdStr);
    }

    // Persistir no Banco e Memória (via SocketController)
    try {
        console.log('🔄 Chamando socketController.joinDriverRoom...');
        await socketController.joinDriverRoom({
            driver_id: driverIdStr,
            socket_id: socket.id,
            lat, lng, heading, speed,
            status: 'online'
        }, socket);
        console.log('✅ Controller executado com sucesso');

    } catch (e) {
        console.error(`❌ [DB ERROR] Falha ao salvar driver ${driverIdStr}:`, e.message);
        console.error(e.stack);
    }

    socket.emit('joined_ack', {
        room: 'drivers',
        driver_id: driverIdStr,
        status: 'online',
        timestamp: new Date().toISOString()
    });

    // Broadcast de contagem atualizada
    const count = await socketController.countOnlineDrivers();
    io.emit('drivers_online_count', count);

    console.log('🔴🔴🔴🔴🔴 FIM JOIN DRIVER ROOM 🔴🔴🔴🔴🔴\n');
}

// --- 3.3 LOCATION UPDATE ---
async function _handleLocationUpdate(socket, data) {
    const driverId = data.driver_id || data.user_id || socketUsers.get(socket.id);
    if (!driverId || !data.lat || !data.lng) return;

    // Atualiza DB e Cache
    await socketController.updateDriverPosition({
        ...data,
        driver_id: driverId,
        socket_id: socket.id
    }, socket);

    // Se estiver em corrida, transmite para a sala da corrida
    if (data.ride_id) {
        io.to(`ride_${data.ride_id}`).emit('driver_location_update', {
            ride_id: data.ride_id,
            lat: data.lat,
            lng: data.lng,
            heading: data.heading,
            speed: data.speed,
            timestamp: new Date().toISOString(),
            driver_id: driverId
        });
    }
}

// --- 3.4 TRIP GPS (Para passageiro ver o carro se movendo suavemente) ---
function _handleTripGpsUpdate(socket, data) {
    const { ride_id, lat, lng, rotation, speed } = data;
    if (!ride_id || !lat || !lng) return;

    // Emite diretamente para a sala da corrida (Baixa latência)
    io.to(`ride_${ride_id}`).emit('driver_location_update', {
        ride_id, lat, lng, rotation, speed,
        timestamp: new Date().toISOString()
    });
}

// --- 3.5 START TRIP ---
async function _handleStartTrip(socket, data) {
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
}

// --- 3.6 COMPLETE RIDE ---
async function _handleCompleteRide(socket, data) {
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
}

// --- 3.7 CHAT MESSAGE ---
async function _handleChatMessage(socket, data) {
    const { ride_id, sender_id, text, image_data, message_type = 'text' } = data;
    if (!ride_id || !sender_id) {
        socket.emit('chat_error', { message: 'Dados incompletos' });
        return;
    }

    try {
        // Verificar se usuário é participante da corrida
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

        // Salvar no banco
        const result = await pool.query(
            `INSERT INTO chat_messages (ride_id, sender_id, text, image_url, message_type, created_at, is_read)
             VALUES ($1, $2, $3, $4, $5, NOW(), false) RETURNING *`,
            [ride_id, sender_id, text || null, image_data || null, message_type || 'text']
        );

        const msg = result.rows[0];

        // Buscar informações do remetente
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

        // Broadcast para a sala
        io.to(`ride_${ride_id}`).emit('receive_message', payload);

        // Notificar o destinatário
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
}

// --- 3.8 TYPING INDICATOR ---
function _handleTyping(socket, data) {
    const { ride_id, user_id, is_typing } = data;
    if (!ride_id || !user_id) return;

    socket.to(`ride_${ride_id}`).emit('user_typing', {
        user_id: user_id,
        is_typing: is_typing,
        timestamp: new Date().toISOString()
    });
}

// --- 3.9 READ RECEIPT ---
async function _handleReadReceipt(socket, data) {
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
}

// --- 3.10 LEAVE USER ---
async function _handleLeaveUser(socket, userId) {
    if (!userId) return;

    const userIdStr = userId.toString();
    const roomName = `user_${userIdStr}`;

    socket.leave(roomName);
    userSockets.delete(userIdStr);
    socketUsers.delete(socket.id);

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
}

// --- 3.11 DISCONNECT HANDLER ---
function handleDisconnect(socket, reason) {
    const socketId = socket.id;
    const userId = socketUsers.get(socketId);

    console.log(`${colors.yellow}🔌 [DISCONNECT] Socket ${socketId} (${reason})${colors.reset}`);

    // Remover posição do motorista imediatamente
    socketController.removeDriverPosition(socketId).catch(e =>
        logError('DISCONNECT_REMOVE_POS', e)
    );

    if (userId) {
        // Iniciar Grace Period (Debounce)
        const timer = setTimeout(async () => {
            console.log(`${colors.red}🚫 [OFFLINE] Timeout expirou para User ${userId}. Removendo.${colors.reset}`);

            try {
                // Verificar se ainda não reconectou
                const currentSocket = userSockets.get(userId);
                if (!currentSocket || currentSocket === socketId) {
                    await pool.query(
                        'UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1',
                        [userId]
                    );

                    userSockets.delete(userId);
                    socketUsers.delete(socketId);
                }
            } catch (e) {
                logError('DISCONNECT_TIMEOUT', e);
            } finally {
                disconnectTimers.delete(userId);
            }

            // Atualizar contagem
            const count = await socketController.countOnlineDrivers();
            io.emit('drivers_online_count', count);

        }, DISCONNECT_GRACE_PERIOD);

        disconnectTimers.set(userId, timer);
    }
}

// --- 3.12 NEARBY DRIVERS ---
async function _handleGetNearbyDrivers(socket, data) {
    const { lat, lng, radius = 15 } = data;
    if(!lat || !lng) return;

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
}

// --- 3.13 HEARTBEAT ---
async function _handleHeartbeat(socket, data) {
    const driverId = data.driver_id || socketUsers.get(socket.id);
    if (driverId) {
        await socketController.updateDriverActivity(driverId);
    }
}

// --- 3.14 PAGAMENTOS ---
function _handlePaymentRequest(socket, data) {
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
}

function _handlePaymentConfirmation(socket, data) {
    const { ride_id } = data;
    if (ride_id) {
        io.to(`ride_${ride_id}`).emit('payment_confirmed', data);
        if (data.passenger_id) {
            io.to(`user_${data.passenger_id}`).emit('payment_confirmed', data);
        }
        if (data.driver_id) {
            io.to(`user_${data.driver_id}`).emit('payment_confirmed', data);
        }
    }
}

/**
 * =================================================================================================
 * 4. BRIDGE: SOCKET -> CONTROLLER (MOCK REQ/RES)
 * =================================================================================================
 * Esta função mágica permite chamar controllers HTTP via Socket sem duplicar código.
 */
async function routeToController(controllerFunction, data, socket, responseEventName) {
    // 1. Mock Request
    const req = {
        body: data,
        user: { id: data.passenger_id || data.driver_id || data.user_id }, // Tenta extrair ID
        io: io, // Injeta IO global
        ip: socket.handshake.address
    };

    // Validação básica de Auth no Mock
    if (!req.user.id) {
        // Tenta pegar do mapa de sockets
        const mappedId = socketUsers.get(socket.id);
        if (mappedId) req.user.id = mappedId;
    }

    // 2. Mock Response
    const res = {
        _status: 200,
        _json: null,
        status: function(code) {
            this._status = code;
            return this;
        },
        json: function(payload) {
            this._json = payload;

            // Log do resultado
            const isSuccess = this._status >= 200 && this._status < 300;
            const logColor = isSuccess ? colors.green : colors.red;
            console.log(`${logColor}📦 [CONTROLLER BRIDGE] Response ${this._status} para ${responseEventName}${colors.reset}`);

            // Emitir resposta de volta para o socket solicitante
            socket.emit(responseEventName, payload);

            // Se for erro, também emite evento de erro padrão
            if (!isSuccess) {
                socket.emit('error_response', {
                    code: payload.code || 'UNKNOWN_ERROR',
                    message: payload.error || payload.message || 'Erro desconhecido'
                });
            }

            return this;
        },
        // Suporte a send também
        send: function(body) { this.json(body); }
    };

    // 3. Executar Controller
    try {
        await controllerFunction(req, res);
    } catch (e) {
        console.error(`${colors.red}❌ [BRIDGE ERROR] Exceção no controller:${colors.reset}`, e);
        socket.emit(responseEventName, {
            success: false,
            error: "Erro interno no servidor (Bridge)",
            code: "INTERNAL_ERROR"
        });
    }
}

/**
 * =================================================================================================
 * 5. MÉTODOS HELPER PÚBLICOS (Para uso em outros arquivos)
 * =================================================================================================
 */

// Emitir para um usuário específico
function emitToUser(userId, event, data) {
    if (!userId || !io) return;
    io.to(`user_${userId}`).emit(event, data);
}

// Emitir para uma sala de corrida
function emitToRide(rideId, event, data) {
    if (!rideId || !io) return;
    io.to(`ride_${rideId}`).emit(event, data);
}

// Emitir para uma sala genérica
function emitToRoom(room, event, data) {
    if (!room || !io) return;
    io.to(room).emit(event, data);
}

// Emitir global
function emitGlobal(event, data) {
    if (!io) return;
    io.emit(event, data);
    logSystem('SOCKET_BROADCAST', `Evento global: ${event}`);
}

// Verificar se usuário está online
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

// Obter socket ID de um usuário
function getUserSocket(userId) {
    return userSockets.get(userId.toString());
}

// Obter lista de usuários online
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

// Obter instância do IO
function getIO() {
    return io;
}

// Setup inicial (chamado pelo server.js)
function setupSocketIO(httpServer) {
    console.log('🔌 [SOCKET] Inicializando serviço de tempo real...');

    if (io) return io; // Singleton

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
    // Expor mapas para debugging (opcional)
    userSockets,
    socketUsers,
    disconnectTimers
};