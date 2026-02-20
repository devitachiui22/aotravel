/**
 * =================================================================================================
 * ⚡ AOTRAVEL SERVER PRO - TITANIUM SOCKET ENGINE v12.0.0 (CORE DE TEMPO REAL)
 * =================================================================================================
 *
 * ARQUIVO: src/services/socketService.js
 * DESCRIÇÃO: Motor centralizado e exclusivo de WebSockets.
 *            Gerencia conexões, salas de chat, telemetria de motoristas e faz
 *            a ponte (Bridge) com os Controllers HTTP.
 *
 * ✅ CORREÇÕES APLICADAS:
 * 1. Fim da duplicidade: Nenhuma lógica de socket no server.js. Tudo acontece aqui.
 * 2. Bridge Perfeita: Os eventos chamam os controllers oficiais injetando req/res.
 * 3. Salas (Rooms): Motoristas e passageiros agora entram nas salas corretas
 *    (user_<id> e ride_<id>) garantindo que os eventos de `ride_accepted` e chat
 *    sejam entregues perfeitamente.
 * 4. Presença: Heartbeat e cleanup automático de motoristas inativos.
 * 5. ✅ CORREÇÃO CRÍTICA: Sintaxe inválida na linha 51 corrigida.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const { Server } = require("socket.io");
const pool = require('../config/db');
const { getFullRideDetails, logSystem, logError } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// Instância global do Socket.IO
let io;

// Cores para Logs de Terminal
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m'
};

/**
 * =================================================================================================
 * 1. INICIALIZAÇÃO DO SERVIDOR DE SOCKETS
 * =================================================================================================
 */
function setupSocketIO(httpServer) {
    if (io) return io; // Singleton Pattern

    io = new Server(httpServer, {
        cors: {
            origin: SYSTEM_CONFIG.SERVER?.CORS_ORIGIN || "*",
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // ✅ CORREÇÃO: Array de métodos definido
            credentials: true
        },
        pingTimeout: SYSTEM_CONFIG.SOCKET?.PING_TIMEOUT || 20000,
        pingInterval: SYSTEM_CONFIG.SOCKET?.PING_INTERVAL || 25000,
        transports: SYSTEM_CONFIG.SOCKET?.TRANSPORTS || ["websocket", "polling"],
        allowEIO3: true,
        connectTimeout: 10000,
        maxHttpBufferSize: 1e6 // 1MB para uploads via socket (imagens de chat)
    });

    global.io = io;

    io.on('connection', _handleConnection);

    console.log(`${colors.green}✅ Motor de Tempo Real iniciado com sucesso.${colors.reset}`);

    // Job de Fundo: Limpa motoristas inativos a cada 2 minutos (Zombie connection cleanup)
    setInterval(() => {
        _cleanInactiveDrivers();
    }, 120000);

    return io;
}

/**
 * =================================================================================================
 * 2. GERENCIADOR PRINCIPAL DE CONEXÕES
 * =================================================================================================
 */
function _handleConnection(socket) {
    const socketId = socket.id;
    const query = socket.handshake.query;

    console.log(`${colors.magenta}🔌 Terminal conectado: ${socketId}${colors.reset}`);

    // Auto-Join de Sala baseada na autenticação via query params
    if (query && query.userId) {
        const userId = query.userId;
        const role = query.role || 'passenger';

        // Sala pessoal para notificações diretas (ex: emitToUser)
        socket.join(`user_${userId}`);

        // Se for motorista, entra no pool de drivers e registra online
        if (role === 'driver') {
            socket.join('drivers');
            socket.join(`driver_${userId}`);
            _registerDriverOnline(userId, socketId, -8.8399, 13.2894); // Lat/Lng padrão (Luanda) até receber update
        }
    }

    // =========================================================================
    // 3. REGISTRO DE LISTENERS E EVENTOS GLOBAIS
    // =========================================================================

    // --- IDENTIDADE E PRESENÇA ---
    socket.on('join_user', (userId) => _handleJoinUser(socket, userId));
    socket.on('join_driver_room', (data) => _handleJoinDriver(socket, data));
    socket.on('update_location', (data) => _handleUpdateLocation(socket, data));
    socket.on('heartbeat', (data) => _handleHeartbeat(socket, data));

    // --- CICLO DE VIDA DA MISSÃO (CORRIDA) ---
    // Usamos o padrão Bridge para reaproveitar a lógica blindada do RideController
    socket.on('request_ride', (data) => _routeToController('requestRide', data, socket, 'ride_request_response'));
    socket.on('accept_ride', (data) => _routeToController('acceptRide', data, socket, 'ride_accepted_confirmation'));
    socket.on('start_trip', (data) => _routeToController('startRide', data, socket, 'trip_started_ack'));
    socket.on('update_status', (data) => _routeToController('updateStatus', data, socket, 'status_update_ack'));
    socket.on('complete_ride', (data) => _routeToController('completeRide', data, socket, 'ride_completed_ack'));
    socket.on('cancel_ride', (data) => _routeToController('cancelRide', data, socket, 'ride_cancelled_ack'));

    // --- RASTREAMENTO TÁTICO (GPS DA CORRIDA) ---
    socket.on('update_trip_gps', (data) => {
        const { ride_id, lat, lng, rotation, speed } = data;
        socket.to(`ride_${ride_id}`).emit('trip_gps_update', {
            ride_id: ride_id,
            lat: lat,
            lng: lng,
            rotation: rotation || 0,
            speed: speed || 0,
            timestamp: new Date().toISOString()
        });
    });

    // --- COMUNICAÇÃO E CHAT (SALA DA CORRIDA) ---
    socket.on('join_ride', (rideId) => {
        if (!rideId) return;
        socket.join(`ride_${rideId}`);
        console.log(`🚪 Socket ${socket.id} ingressou na sala ride_${rideId}`);
        socket.emit('ride_joined', { success: true, ride_id: rideId });
    });

    socket.on('leave_ride', (rideId) => {
        if (!rideId) return;
        socket.leave(`ride_${rideId}`);
        console.log(`🚪 Socket ${socket.id} deixou a sala ride_${rideId}`);
    });

    socket.on('send_message', (data) => _handleSendMessage(socket, data));
    socket.on('typing_indicator', (data) => {
        if (!data.ride_id || !data.user_id) return;
        socket.to(`ride_${data.ride_id}`).emit('user_typing', {
            user_id: data.user_id,
            is_typing: data.is_typing
        });
    });

    socket.on('mark_messages_read', async (data) => {
        const { ride_id, user_id } = data;
        if (!ride_id || !user_id) return;
        try {
            await pool.query(`
                UPDATE chat_messages SET is_read = true, read_at = NOW()
                WHERE ride_id = $1 AND sender_id != $2 AND is_read = false
            `, [ride_id, user_id]);
        } catch (e) { /* silent fail */ }
    });

    // --- DESCONEXÃO ---
    socket.on('disconnect', () => _handleDisconnect(socket));
}

/**
 * =================================================================================================
 * 4. PONTES DE LIGAÇÃO (CONTROLLER BRIDGE)
 * =================================================================================================
 * Transforma uma chamada de Socket numa chamada de Controller HTTP simulando req/res.
 */
async function _routeToController(methodName, data, socket, responseEvent) {
    const rideController = require('../controllers/rideController');

    // Identificação do Usuário extraída do Payload
    const userId = data.driver_id || data.passenger_id || data.user_id;
    const role = data.role || (data.driver_id ? 'driver' : 'passenger');

    // Construção de um Request Express Mockado
    const req = {
        body: data,
        user: { id: userId, role: role },
        io: io,
        ip: socket.handshake.address
    };

    // Construção de um Response Express Mockado
    const res = {
        statusCode: 200,
        status: function(code) {
            this.statusCode = code;
            return this;
        },
        json: function(payload) {
            // Emite de volta para o cliente específico que chamou
            socket.emit(responseEvent, payload);
            return this;
        }
    };

    try {
        if (typeof rideController[methodName] !== 'function') {
            throw new Error(`Método ${methodName} não encontrado no Controller.`);
        }
        // Executa a lógica de negócios real
        await rideController[methodName](req, res);
    } catch (e) {
        logError('BRIDGE_ERROR', e);
        socket.emit(responseEvent, {
            success: false,
            error: "Erro interno na operação do servidor.",
            code: "INTERNAL_ERROR"
        });
    }
}

/**
 * =================================================================================================
 * 5. HANDLERS ESPECÍFICOS DE PRESENÇA E CHAT
 * =================================================================================================
 */

async function _handleJoinUser(socket, userId) {
    if (!userId) return;
    const userIdStr = userId.toString();

    socket.join(`user_${userIdStr}`);

    try {
        await pool.query(
            "UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1",
            [userIdStr]
        );
        socket.emit('joined_ack', { success: true, user_id: userIdStr, socket_id: socket.id });
    } catch (e) {
        logError('JOIN_USER', e);
    }
}

async function _handleJoinDriver(socket, data) {
    const driverId = data.driver_id || data.user_id;
    if (!driverId) return;

    socket.join('drivers');
    socket.join(`driver_${driverId}`);
    socket.join(`user_${driverId}`);

    const lat = parseFloat(data.lat) || -8.8399;
    const lng = parseFloat(data.lng) || 13.2894;

    await _registerDriverOnline(driverId, socket.id, lat, lng);

    socket.emit('joined_ack', { success: true, driver_id: driverId, status: 'online' });
}

async function _registerDriverOnline(driverId, socketId, lat, lng) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, socket_id, status, last_update)
            VALUES ($1, $2, $3, $4, 'online', NOW())
            ON CONFLICT (driver_id) DO UPDATE SET
                lat = $2, lng = $3, socket_id = $4, status = 'online', last_update = NOW()
        `, [driverId, lat, lng, socketId]);

        await client.query("UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1", [driverId]);

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        logError('REG_DRIVER_ONLINE', e);
    } finally {
        client.release();
    }
}

async function _handleUpdateLocation(socket, data) {
    const driverId = data.driver_id || data.user_id;
    const lat = parseFloat(data.lat);
    const lng = parseFloat(data.lng);

    if (!driverId || isNaN(lat) || isNaN(lng)) return;

    try {
        await pool.query(`
            UPDATE driver_positions
            SET lat = $2, lng = $3, heading = $4, speed = $5, last_update = NOW()
            WHERE driver_id = $1
        `, [driverId, lat, lng, data.heading || 0, data.speed || 0]);

        // Otimização: Só propaga se o motorista estiver com uma corrida ativa
        const activeRides = await pool.query(`
            SELECT id FROM rides WHERE driver_id = $1 AND status IN ('accepted', 'ongoing', 'arrived')
        `, [driverId]);

        activeRides.rows.forEach(ride => {
            io.to(`ride_${ride.id}`).emit('driver_location_update', {
                ride_id: ride.id,
                driver_id: driverId,
                lat: lat,
                lng: lng,
                heading: data.heading || 0,
                speed: data.speed || 0,
                timestamp: new Date().toISOString()
            });
        });
    } catch (e) { /* Silent Fail para alta frequência */ }
}

async function _handleHeartbeat(socket, data) {
    const driverId = data.driver_id || data.user_id;
    if (!driverId) return;
    try {
        await pool.query("UPDATE driver_positions SET last_update = NOW() WHERE driver_id = $1", [driverId]);
        await pool.query("UPDATE users SET last_seen = NOW(), is_online = true WHERE id = $1", [driverId]);
    } catch (e) { /* Silent Fail */ }
}

async function _handleSendMessage(socket, data) {
    const { ride_id, sender_id, text, image_data, message_type = 'text' } = data;
    if (!ride_id || !sender_id) return;

    try {
        let imageUrl = null;
        if (image_data && image_data.length > 100) {
            imageUrl = 'data:image/jpeg;base64,' + image_data;
        }

        const result = await pool.query(`
            INSERT INTO chat_messages (ride_id, sender_id, text, image_url, message_type, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id, created_at
        `, [ride_id, sender_id, text || '', imageUrl, message_type]);

        const senderInfo = await pool.query('SELECT name, photo FROM users WHERE id = $1', [sender_id]);

        const payload = {
            id: result.rows[0].id,
            ride_id: ride_id,
            sender_id: sender_id,
            text: text || '',
            image_url: imageUrl,
            message_type: message_type,
            created_at: result.rows[0].created_at,
            sender_name: senderInfo.rows[0]?.name || 'Usuário',
            sender_photo: senderInfo.rows[0]?.photo || null
        };

        // Envia a mensagem para todos na sala da corrida
        io.to(`ride_${ride_id}`).emit('receive_message', payload);

    } catch (e) {
        logError('SEND_MESSAGE', e);
    }
}

async function _handleDisconnect(socket) {
    console.log(`${colors.yellow}🔌 Terminal desconectado: ${socket.id}${colors.reset}`);
    try {
        const result = await pool.query('SELECT driver_id FROM driver_positions WHERE socket_id = $1', [socket.id]);

        if (result.rows.length > 0) {
            const driverId = result.rows[0].driver_id;
            // Delay de 10 segundos para não derrubar num piscar de rede (Network Blip)
            setTimeout(async () => {
                const check = await pool.query('SELECT socket_id FROM driver_positions WHERE driver_id = $1', [driverId]);
                if (check.rows[0]?.socket_id === socket.id || !check.rows[0]?.socket_id) {
                    await pool.query("UPDATE driver_positions SET status = 'offline', socket_id = NULL WHERE driver_id = $1", [driverId]);
                    await pool.query("UPDATE users SET is_online = false WHERE id = $1", [driverId]);
                    console.log(`${colors.yellow}🚫 Motorista ${driverId} marcado como offline após timeout.${colors.reset}`);
                }
            }, 10000);
        }
    } catch (e) {
        logError('DISCONNECT_HANDLER', e);
    }
}

async function _cleanInactiveDrivers() {
    try {
        const result = await pool.query(`
            UPDATE driver_positions
            SET status = 'offline', socket_id = NULL
            WHERE last_update < NOW() - INTERVAL '3 minutes' AND status = 'online'
            RETURNING driver_id
        `);

        if (result.rows.length > 0) {
            for (const row of result.rows) {
                await pool.query("UPDATE users SET is_online = false WHERE id = $1", [row.driver_id]);
                console.log(`${colors.yellow}🧹 Motorista ${row.driver_id} varrido por inatividade extrema.${colors.reset}`);
            }
        }
    } catch (e) {
        logError('CLEAN_INACTIVE_DRIVERS', e);
    }
}

// =================================================================================================
// 6. MÉTODOS PÚBLICOS DE EMISSÃO GERAL
// =================================================================================================

function getIO() {
    if (!io) throw new Error("Socket.IO não inicializado!");
    return io;
}

function emitToUser(userId, event, data) {
    if (!userId || !io) return;
    io.to(`user_${userId}`).emit(event, data);
}

function emitToRide(rideId, event, data) {
    if (!rideId || !io) return;
    io.to(`ride_${rideId}`).emit(event, data);
}

module.exports = {
    setupSocketIO,
    getIO,
    emitToUser,
    emitToRide
};
