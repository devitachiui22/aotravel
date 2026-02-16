/**
 * =================================================================================================
 * ⚡ AOTRAVEL SERVER PRO - TITANIUM SOCKET ENGINE v8.5.0 (CORREÇÃO RADICAL)
 * =================================================================================================
 */

const { Server } = require("socket.io");
const pool = require('../config/db');
const { logSystem, logError, getFullRideDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

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

// Mapas de Estado
const userSockets = new Map();
const socketUsers = new Map();
const disconnectTimers = new Map();

const DEFAULT_LAT = -8.8399;
const DEFAULT_LNG = 13.2894;
const DISCONNECT_GRACE_PERIOD = 10000;

// =================================================================================================
// 1. INICIALIZAÇÃO
// =================================================================================================
function initializeSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: SYSTEM_CONFIG.SERVER?.CORS_ORIGIN || "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        pingTimeout: SYSTEM_CONFIG.SOCKET?.PING_TIMEOUT || 20000,
        pingInterval: SYSTEM_CONFIG.SOCKET?.PING_INTERVAL || 25000,
        transports: SYSTEM_CONFIG.SOCKET?.TRANSPORTS || ['websocket', 'polling'],
        allowEIO3: true,
        connectTimeout: 10000,
        maxHttpBufferSize: 1e6
    });

    global.io = io;

    io.on('connection', (socket) => {
        handleConnection(socket);
    });

    console.log(`${colors.green}✅ [SOCKET ENGINE] Servidor iniciado e pronto.${colors.reset}`);

    // Limpeza automática de motoristas inativos a cada 2 minutos
    setInterval(() => {
        cleanInactiveDrivers();
    }, 120000);

    return io;
}

// =================================================================================================
// 2. HANDLER DE CONEXÃO
// =================================================================================================
function handleConnection(socket) {
    const socketId = socket.id;
    const query = socket.handshake.query;

    console.log(`${colors.blue}🔌 [CONNECT] Nova conexão: ${socketId}${colors.reset}`);

    // Auto-join se userId vier na query
    if (query && query.userId) {
        const userId = query.userId;
        const role = query.role || 'passenger';

        socket.join(`user_${userId}`);
        userSockets.set(userId.toString(), socketId);
        socketUsers.set(socketId, userId.toString());

        if (role === 'driver') {
            socket.join('drivers');
            socket.join(`driver_${userId}`);

            // Registrar no banco IMEDIATAMENTE
            registerDriverOnline(userId, socketId, DEFAULT_LAT, DEFAULT_LNG);
        }
    }

    // EVENTOS
    socket.on('join_user', (userId) => handleJoinUser(socket, userId));
    socket.on('join_driver_room', (data) => handleJoinDriver(socket, data));
    socket.on('update_location', (data) => handleUpdateLocation(socket, data));
    socket.on('heartbeat', (data) => handleHeartbeat(socket, data));
    socket.on('disconnect', (reason) => handleDisconnect(socket, reason));

    // Ride events
    socket.on('request_ride', (data) => handleRequestRide(socket, data));
    socket.on('accept_ride', (data) => handleAcceptRide(socket, data));
    socket.on('start_trip', (data) => handleStartTrip(socket, data));
    socket.on('complete_ride', (data) => handleCompleteRide(socket, data));
    socket.on('cancel_ride', (data) => handleCancelRide(socket, data));

    // Chat
    socket.on('send_message', (data) => handleSendMessage(socket, data));
    socket.on('typing_indicator', (data) => handleTyping(socket, data));

    // Salas de corrida
    socket.on('join_ride', (rideId) => {
        if (!rideId) return;
        socket.join(`ride_${rideId}`);
        socket.emit('ride_joined', { success: true, ride_id: rideId });
    });

    socket.on('leave_ride', (rideId) => {
        if (!rideId) return;
        socket.leave(`ride_${rideId}`);
    });
}

// =================================================================================================
// 3. HANDLERS PRINCIPAIS
// =================================================================================================

async function handleJoinUser(socket, userId) {
    if (!userId) return;

    const userIdStr = userId.toString();
    const roomName = `user_${userIdStr}`;

    socket.join(roomName);
    userSockets.set(userIdStr, socket.id);
    socketUsers.set(socket.id, userIdStr);

    // Cancelar timer de desconexão
    if (disconnectTimers.has(userIdStr)) {
        clearTimeout(disconnectTimers.get(userIdStr));
        disconnectTimers.delete(userIdStr);
    }

    try {
        await pool.query(
            "UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1",
            [userId]
        );

        socket.emit('joined_ack', {
            success: true,
            user_id: userId,
            socket_id: socket.id
        });

        console.log(`${colors.green}👤 [USER] ${userId} entrou online${colors.reset}`);
    } catch (e) {
        console.error(`❌ Erro ao registrar user ${userId}:`, e.message);
    }
}

async function handleJoinDriver(socket, data) {
    const driverId = data.driver_id || data.user_id;
    if (!driverId) return;

    const driverIdStr = driverId.toString();
    const socketId = socket.id;
    const lat = parseFloat(data.lat) || DEFAULT_LAT;
    const lng = parseFloat(data.lng) || DEFAULT_LNG;

    console.log(`${colors.magenta}🚗 [DRIVER JOIN] Driver ${driverIdStr} com socket ${socketId}${colors.reset}`);

    // Entrar nas salas
    socket.join('drivers');
    socket.join(`driver_${driverIdStr}`);
    socket.join(`user_${driverIdStr}`);

    userSockets.set(driverIdStr, socketId);
    socketUsers.set(socketId, driverIdStr);

    // Registrar no banco de dados
    await registerDriverOnline(driverIdStr, socketId, lat, lng);

    socket.emit('joined_ack', {
        success: true,
        driver_id: driverIdStr,
        status: 'online'
    });

    // Atualizar contagem
    const count = await countOnlineDrivers();
    io.emit('drivers_online_count', count);
}

async function registerDriverOnline(driverId, socketId, lat, lng) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Inserir ou atualizar posição
        await client.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, socket_id, status, last_update)
            VALUES ($1, $2, $3, $4, 'online', NOW())
            ON CONFLICT (driver_id) DO UPDATE SET
                lat = $2,
                lng = $3,
                socket_id = $4,
                status = 'online',
                last_update = NOW()
        `, [driverId, lat, lng, socketId]);

        // Atualizar usuário
        await client.query(`
            UPDATE users SET is_online = true, last_seen = NOW()
            WHERE id = $1
        `, [driverId]);

        await client.query('COMMIT');

        console.log(`${colors.green}✅ [DB] Driver ${driverId} registrado como online${colors.reset}`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`❌ [DB] Erro ao registrar driver ${driverId}:`, e.message);
    } finally {
        client.release();
    }
}

async function handleUpdateLocation(socket, data) {
    const driverId = data.driver_id || data.user_id || socketUsers.get(socket.id);
    if (!driverId) return;

    const lat = parseFloat(data.lat);
    const lng = parseFloat(data.lng);

    if (isNaN(lat) || isNaN(lng)) return;

    try {
        await pool.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, socket_id, status, last_update)
            VALUES ($1, $2, $3, $4, 'online', NOW())
            ON CONFLICT (driver_id) DO UPDATE SET
                lat = $2,
                lng = $3,
                socket_id = $4,
                status = 'online',
                last_update = NOW()
        `, [driverId, lat, lng, socket.id]);

        // Se estiver em uma corrida, transmitir posição
        if (data.ride_id) {
            io.to(`ride_${data.ride_id}`).emit('driver_location_update', {
                ride_id: data.ride_id,
                lat: lat,
                lng: lng,
                heading: data.heading || 0,
                speed: data.speed || 0,
                timestamp: new Date().toISOString()
            });
        }
    } catch (e) {
        // Ignorar erros
    }
}

async function handleHeartbeat(socket, data) {
    const driverId = data.driver_id || socketUsers.get(socket.id);
    if (!driverId) return;

    try {
        await pool.query(`
            UPDATE driver_positions
            SET last_update = NOW()
            WHERE driver_id = $1
        `, [driverId]);

        await pool.query(`
            UPDATE users SET last_seen = NOW()
            WHERE id = $1
        `, [driverId]);
    } catch (e) {
        // Ignorar
    }
}

async function handleDisconnect(socket, reason) {
    const socketId = socket.id;
    const userId = socketUsers.get(socketId);

    console.log(`${colors.yellow}🔌 [DISCONNECT] Socket ${socketId} (${reason})${colors.reset}`);

    if (userId) {
        // Grace period para reconexão
        const timer = setTimeout(async () => {
            const currentSocket = userSockets.get(userId);
            if (!currentSocket || currentSocket === socketId) {
                await setDriverOffline(userId);
                userSockets.delete(userId);
                socketUsers.delete(socketId);
            }
            disconnectTimers.delete(userId);
        }, DISCONNECT_GRACE_PERIOD);

        disconnectTimers.set(userId, timer);
    }
}

async function setDriverOffline(driverId) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        await client.query(`
            UPDATE driver_positions
            SET status = 'offline', socket_id = NULL, last_update = NOW()
            WHERE driver_id = $1
        `, [driverId]);

        await client.query(`
            UPDATE users SET is_online = false, last_seen = NOW()
            WHERE id = $1
        `, [driverId]);

        await client.query('COMMIT');

        console.log(`${colors.yellow}🚫 [OFFLINE] Driver ${driverId} desconectado${colors.reset}`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`❌ Erro ao desconectar driver ${driverId}:`, e.message);
    } finally {
        client.release();
    }
}

async function cleanInactiveDrivers() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Buscar motoristas inativos
        const result = await client.query(`
            UPDATE driver_positions
            SET status = 'offline', socket_id = NULL
            WHERE last_update < NOW() - INTERVAL '3 minutes'
                AND status = 'online'
            RETURNING driver_id
        `);

        if (result.rows.length > 0) {
            for (const row of result.rows) {
                await client.query(`
                    UPDATE users SET is_online = false
                    WHERE id = $1
                `, [row.driver_id]);

                console.log(`${colors.yellow}🧹 [CLEAN] Driver ${row.driver_id} removido por inatividade${colors.reset}`);
            }
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`❌ Erro na limpeza de inativos:`, e.message);
    } finally {
        client.release();
    }
}

async function countOnlineDrivers() {
    try {
        const result = await pool.query(`
            SELECT COUNT(*) as total
            FROM driver_positions
            WHERE status = 'online'
                AND last_update > NOW() - INTERVAL '2 minutes'
                AND socket_id IS NOT NULL
        `);
        return parseInt(result.rows[0].total) || 0;
    } catch (e) {
        return 0;
    }
}

// =================================================================================================
// 4. HANDLERS DE CORRIDA (Bridge para rideController)
// =================================================================================================

async function handleRequestRide(socket, data) {
    const rideController = require('../controllers/rideController');
    await routeToController(rideController.requestRide, data, socket, 'ride_request_response');
}

async function handleAcceptRide(socket, data) {
    const rideController = require('../controllers/rideController');
    await routeToController(rideController.acceptRide, data, socket, 'ride_accepted_confirmation');
}

async function handleStartTrip(socket, data) {
    const { ride_id, driver_id } = data;
    if (!ride_id) return;

    try {
        await pool.query(`
            UPDATE rides SET status = 'ongoing', started_at = NOW()
            WHERE id = $1 AND driver_id = $2
        `, [ride_id, driver_id]);

        const fullRide = await getFullRideDetails(ride_id);

        io.to(`ride_${ride_id}`).emit('trip_started', fullRide);

        if (fullRide?.passenger_id) {
            io.to(`user_${fullRide.passenger_id}`).emit('trip_started', fullRide);
        }
    } catch (e) {
        console.error('❌ Erro ao iniciar viagem:', e);
    }
}

async function handleCompleteRide(socket, data) {
    const { ride_id, driver_id } = data;
    if (!ride_id) return;

    try {
        await pool.query(`
            UPDATE rides SET status = 'completed', completed_at = NOW()
            WHERE id = $1 AND driver_id = $2
        `, [ride_id, driver_id]);

        const fullRide = await getFullRideDetails(ride_id);

        io.to(`ride_${ride_id}`).emit('ride_completed', fullRide);

        if (fullRide?.passenger_id) {
            io.to(`user_${fullRide.passenger_id}`).emit('ride_completed', fullRide);
        }
    } catch (e) {
        console.error('❌ Erro ao completar viagem:', e);
    }
}

async function handleCancelRide(socket, data) {
    const rideController = require('../controllers/rideController');
    await routeToController(rideController.cancelRide, data, socket, 'ride_cancelled_ack');
}

async function handleSendMessage(socket, data) {
    const { ride_id, sender_id, text, message_type = 'text' } = data;
    if (!ride_id || !sender_id || !text) return;

    try {
        const result = await pool.query(`
            INSERT INTO chat_messages (ride_id, sender_id, text, message_type, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id, created_at
        `, [ride_id, sender_id, text, message_type]);

        const senderInfo = await pool.query(
            'SELECT name, photo FROM users WHERE id = $1',
            [sender_id]
        );

        const payload = {
            id: result.rows[0].id,
            ride_id: ride_id,
            sender_id: sender_id,
            text: text,
            message_type: message_type,
            created_at: result.rows[0].created_at,
            sender_name: senderInfo.rows[0]?.name || 'Usuário',
            sender_photo: senderInfo.rows[0]?.photo || null
        };

        io.to(`ride_${ride_id}`).emit('receive_message', payload);
    } catch (e) {
        console.error('❌ Erro ao enviar mensagem:', e);
    }
}

function handleTyping(socket, data) {
    const { ride_id, user_id, is_typing } = data;
    if (!ride_id || !user_id) return;

    socket.to(`ride_${ride_id}`).emit('user_typing', {
        user_id: user_id,
        is_typing: is_typing
    });
}

// =================================================================================================
// 5. BRIDGE PARA CONTROLLERS
// =================================================================================================

async function routeToController(controllerFunction, data, socket, responseEvent) {
    const req = {
        body: data,
        user: { id: data.passenger_id || data.driver_id || data.user_id },
        io: io,
        ip: socket.handshake.address
    };

    const res = {
        status: function(code) {
            this._status = code;
            return this;
        },
        json: function(payload) {
            this._json = payload;
            socket.emit(responseEvent, payload);
            return this;
        }
    };

    try {
        await controllerFunction(req, res);
    } catch (e) {
        console.error(`❌ [BRIDGE] Erro:`, e);
        socket.emit(responseEvent, {
            success: false,
            error: "Erro interno",
            code: "INTERNAL_ERROR"
        });
    }
}

// =================================================================================================
// 6. MÉTODOS PÚBLICOS
// =================================================================================================

function emitToUser(userId, event, data) {
    if (!userId || !io) return;
    io.to(`user_${userId}`).emit(event, data);
}

function emitToRide(rideId, event, data) {
    if (!rideId || !io) return;
    io.to(`ride_${rideId}`).emit(event, data);
}

function getIO() {
    return io;
}

function setupSocketIO(httpServer) {
    if (io) return io;
    if (httpServer && typeof httpServer.on === 'function') {
        return initializeSocket(httpServer);
    }
    return initializeSocket;
}

// =================================================================================================
// 7. EXPORTAÇÃO
// =================================================================================================

module.exports = {
    initializeSocket,
    setupSocketIO,
    getIO,
    emitToUser,
    emitToRide,
    userSockets,
    socketUsers
};