/**
 * =================================================================================================
 * 🔌 AOTRAVEL SERVER PRO - REAL-TIME EVENT ENGINE (TITANIUM SOCKETS)
 * =================================================================================================
 *
 * ARQUIVO: src/services/socketService.js
 * DESCRIÇÃO: Motor de comunicação bidirecional em tempo real.
 *            Gerencia salas, rastreamento GPS de alta frequência, fluxo de estado de corridas
 *            e chat criptografado (em trânsito).
 *
 * INTEGRAÇÃO:
 * - Sincronizado com 'driver_positions' (Radar).
 * - Usa transações ACID para aceite de corridas.
 * - Dispara notificações ricas (Rich Payloads) para o Frontend Flutter.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const { Server } = require("socket.io");
const pool = require('../config/db');
const { logSystem, logError, getDistance, getFullRideDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

let io; // Instância global do IO (Singleton)

// Armazenamento em memória para debounce de desconexão (Evita flicker em 4G instável)
const disconnectTimers = new Map();

/**
 * INICIALIZAÇÃO DO SERVIDOR SOCKET.IO
 * Configurado para alta tolerância a latência e desconexões breves.
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
        transports: SYSTEM_CONFIG.SOCKET.TRANSPORTS,
        allowEIO3: true // Compatibilidade com clientes Socket.IO v2/v3 (Legacy Apps)
    });

    // Expor globalmente para acesso via Controllers HTTP (Webhooks, Cron Jobs)
    global.io = io;

    io.on('connection', (socket) => {
        handleConnection(socket);
    });

    logSystem('SOCKET_ENGINE', '🚀 Servidor Real-Time iniciado e pronto para conexões.');
}

/**
 * MANIPULADOR DE CONEXÃO (PER-SOCKET LOGIC)
 */
function handleConnection(socket) {
    const socketId = socket.id;
    // logSystem('SOCKET', `Nova conexão: ${socketId} (Transport: ${socket.conn.transport.name})`);

    // =============================================================================================
    // 1. GESTÃO DE SALAS E PRESENÇA (ROOM MANAGEMENT)
    // =============================================================================================

    /**
     * Evento: JOIN_USER
     * Ocorre quando o usuário abre o app. Vincula o SocketID ao UserID no banco.
     */
    socket.on('join_user', async (userId) => {
        if (!userId) return;

        const roomName = `user_${userId}`;
        socket.join(roomName);

        // Limpa timer de desconexão se o usuário reconectou rápido (Flapping)
        if (disconnectTimers.has(userId)) {
            clearTimeout(disconnectTimers.get(userId));
            disconnectTimers.delete(userId);
            // logSystem('SOCKET', `Reconexão rápida detectada para User ${userId}. Mantido online.`);
        }

        try {
            // 1. Atualizar status Online
            await pool.query(
                "UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1",
                [userId]
            );

            // 2. Se for motorista, registrar/atualizar na tabela de radar (driver_positions)
            // IMPORTANTE: driver_id é PK na tabela driver_positions
            const userRes = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);

            if (userRes.rows.length > 0 && userRes.rows[0].role === 'driver') {
                await pool.query(
                    `INSERT INTO driver_positions (driver_id, socket_id, last_update, status)
                     VALUES ($1, $2, NOW(), 'active')
                     ON CONFLICT (driver_id)
                     DO UPDATE SET socket_id = $2, last_update = NOW(), status = 'active'`,
                    [userId, socketId]
                );
            }

            // Confirmação para o cliente
            socket.emit('joined_ack', { room: roomName, status: 'online' });

        } catch (e) {
            logError('JOIN_USER', e);
        }
    });

    /**
     * Evento: JOIN_RIDE
     * Ocorre ao entrar na tela de detalhes da corrida. Habilita Chat e Rastreamento.
     */
    socket.on('join_ride', (rideId) => {
        if (!rideId) return;
        const roomName = `ride_${rideId}`;
        socket.join(roomName);
        // logSystem('ROOM', `Socket ${socketId} entrou na sala da corrida: ${roomName}`);
    });

    // =============================================================================================
    // 2. TELEMETRIA, RADAR E GEOLOCALIZAÇÃO
    // =============================================================================================

    /**
     * Evento: UPDATE_LOCATION (Heartbeat do Motorista)
     * Atualiza a posição no DB e verifica passageiros próximos (Reverse Radar).
     */
    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading } = data;

        // Validação básica de payload
        if (!user_id || !lat || !lng) return;

        try {
            // 1. Atualizar posição (UPSERT Blindado)
            await pool.query(
                `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update, socket_id)
                 VALUES ($1, $2, $3, $4, NOW(), $5)
                 ON CONFLICT (driver_id) DO UPDATE SET
                    lat = $2,
                    lng = $3,
                    heading = $4,
                    last_update = NOW(),
                    socket_id = $5`,
                [user_id, parseFloat(lat), parseFloat(lng), parseFloat(heading || 0), socketId]
            );

            // 2. RADAR REVERSO (Smart Dispatch)
            // Se o motorista se move, verifica se entrou no raio de uma corrida pendente.
            // Otimização: Busca apenas corridas criadas nos últimos 15 min.

            // Busca corridas pendentes
            const pendingRides = await pool.query(
                `SELECT * FROM rides
                 WHERE status = 'searching'
                 AND created_at > NOW() - INTERVAL '15 minutes'`
            );

            if (pendingRides.rows.length > 0) {
                pendingRides.rows.forEach(ride => {
                    const dist = getDistance(lat, lng, ride.origin_lat, ride.origin_lng);
                    const maxRadius = SYSTEM_CONFIG.RIDES.MAX_RADIUS_KM || 15;

                    // Se estiver dentro do raio, avisa este motorista específico
                    if (dist <= maxRadius) {
                        io.to(socketId).emit('ride_opportunity', {
                            ...ride,
                            distance_to_pickup: dist,
                            estimated_earnings: ride.initial_price * 0.8 // Pré-cálculo visual
                        });
                    }
                });
            }

        } catch (e) {
            // Silencia erros de GPS para não flodar o log, a menos que seja crítico
            if (process.env.NODE_ENV === 'development') logError('UPDATE_LOC', e);
        }
    });

    /**
     * Evento: UPDATE_TRIP_GPS
     * Usado DURANTE uma corrida ativa para mostrar o carrinho movendo no mapa do passageiro.
     * Alta frequência, sem persistência no banco para performance.
     */
    socket.on('update_trip_gps', (data) => {
        const { ride_id, lat, lng, rotation } = data;
        if (!ride_id) return;

        // Relay direto para a sala da corrida (Passageiro escuta aqui)
        socket.to(`ride_${ride_id}`).emit('driver_location_update', {
            lat,
            lng,
            rotation,
            timestamp: new Date().toISOString()
        });
    });

    // =============================================================================================
    // 3. FLUXO DE CORRIDA (RIDE LIFECYCLE) - ACID COMPLIANT
    // =============================================================================================

    /**
     * Evento: REQUEST_RIDE (Solicitação de Corrida via Socket - Legacy/Backup)
     * Nota: A via principal é HTTP POST /api/rides/request, mas suportamos via socket.
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

            // Dispatch: Notificar motoristas próximos
            const driversRes = await pool.query(`
                SELECT dp.driver_id, dp.lat, dp.lng, dp.socket_id
                FROM driver_positions dp
                JOIN users u ON dp.driver_id = u.id
                WHERE u.is_online = true
                AND u.role = 'driver'
                AND u.is_blocked = false
                AND dp.last_update > NOW() - INTERVAL '30 minutes'
            `);

            const nearbyDrivers = driversRes.rows.filter(d => {
                return getDistance(origin_lat, origin_lng, d.lat, d.lng) <= (SYSTEM_CONFIG.RIDES.MAX_RADIUS_KM || 15);
            });

            nearbyDrivers.forEach(d => {
                const dist = getDistance(origin_lat, origin_lng, d.lat, d.lng);
                io.to(d.socket_id).emit('ride_opportunity', {
                    ...ride,
                    distance_to_pickup: dist
                });
            });

        } catch (e) {
            logError('SOCKET_REQUEST_RIDE', e);
            socket.emit('error', { message: 'Erro ao solicitar corrida via socket.' });
        }
    });

    /**
     * Evento: ACCEPT_RIDE (Aceite de Corrida) - CRÍTICO
     * Usa transação para evitar duplo aceite.
     */
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;

        const client = await pool.connect();
        try {
            await client.query('BEGIN'); // Start Transaction

            // 1. Lock Row (Bloqueia leitura/escrita nesta corrida até o commit)
            const checkRes = await client.query(
                "SELECT status, initial_price FROM rides WHERE id = $1 FOR UPDATE",
                [ride_id]
            );

            if (checkRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return socket.emit('error_response', { message: "Corrida não encontrada." });
            }

            const ride = checkRes.rows[0];

            if (ride.status !== 'searching') {
                await client.query('ROLLBACK');
                return socket.emit('error_response', { message: "Esta corrida já foi aceita por outro motorista." });
            }

            // 2. Update Status
            await client.query(
                `UPDATE rides SET
                    driver_id = $1,
                    final_price = COALESCE($2, initial_price),
                    status = 'accepted',
                    accepted_at = NOW()
                 WHERE id = $3`,
                [driver_id, final_price || ride.initial_price, ride_id]
            );

            await client.query('COMMIT'); // Commit Transaction

            // 3. Fetch Full Data & Notify
            const fullData = await getFullRideDetails(ride_id);

            // Sincroniza socket do motorista na sala
            socket.join(`ride_${ride_id}`);

            // Broadcast para a sala (Passageiro e Motorista)
            io.to(`ride_${ride_id}`).emit('match_found', fullData);

            // Redundância: Emite para as salas privadas dos usuários
            if (fullData.passenger_id) io.to(`user_${fullData.passenger_id}`).emit('match_found', fullData);
            if (fullData.driver_id) io.to(`user_${fullData.driver_id}`).emit('match_found', fullData);

            logSystem('RIDE_MATCH', `Corrida #${ride_id} aceita por Driver ${driver_id}`);

        } catch (e) {
            await client.query('ROLLBACK');
            logError('ACCEPT_RIDE_FATAL', e);
            socket.emit('error_response', { message: "Erro crítico ao processar aceite." });
        } finally {
            client.release();
        }
    });

    /**
     * Evento: START_TRIP
     */
    socket.on('start_trip', async (data) => {
        const { ride_id } = data;
        if (!ride_id) return;

        try {
            await pool.query(
                "UPDATE rides SET status = 'ongoing', started_at = NOW() WHERE id = $1",
                [ride_id]
            );

            const fullData = await getFullRideDetails(ride_id);

            io.to(`ride_${ride_id}`).emit('trip_started', fullData);
            io.to(`ride_${ride_id}`).emit('trip_started_now', {
                status: 'ongoing',
                started_at: new Date().toISOString()
            });

        } catch (e) {
            logError('START_TRIP', e);
        }
    });

    /**
     * Evento: CANCEL_RIDE
     */
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role, reason } = data; // role: 'driver' | 'passenger'

        try {
            await pool.query(
                `UPDATE rides SET
                    status = 'cancelled',
                    cancelled_at = NOW(),
                    cancelled_by = $1,
                    cancellation_reason = $2
                 WHERE id = $3`,
                [role, reason || 'Cancelamento solicitado', ride_id]
            );

            // Mensagem amigável
            const msg = role === 'driver'
                ? "O motorista precisou cancelar a corrida."
                : "O passageiro cancelou a solicitação.";

            // Notifica todos na sala
            io.to(`ride_${ride_id}`).emit('ride_terminated', {
                reason: msg,
                origin: role,
                ride_id: ride_id,
                cancelled_at: new Date().toISOString()
            });

            // Garante notificação na sala do usuário oposto
            const details = await getFullRideDetails(ride_id);
            if (details) {
                const targetId = role === 'driver' ? details.passenger_id : details.driver_id;
                if (targetId) {
                    io.to(`user_${targetId}`).emit('ride_cancelled', { reason: msg });
                }
            }

        } catch (e) {
            logError('CANCEL_RIDE', e);
        }
    });

    // =============================================================================================
    // 4. CHAT E COMUNICAÇÃO (ENCRIPTADO EM TRÂNSITO)
    // =============================================================================================

    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, image_data } = data;

        if (!ride_id || !sender_id) return;

        try {
            // Salva no banco
            const res = await pool.query(
                `INSERT INTO chat_messages (ride_id, sender_id, text, image_url, created_at, is_read)
                 VALUES ($1, $2, $3, $4, NOW(), false)
                 RETURNING *`,
                [ride_id, sender_id, text || (image_data ? '📷 Imagem' : ''), image_data || null]
            );

            const msg = res.rows[0];

            // Enriquece com dados do remetente
            const senderRes = await pool.query('SELECT name, photo FROM users WHERE id = $1', [sender_id]);
            const senderInfo = senderRes.rows[0];

            const payload = {
                ...msg,
                sender_name: senderInfo?.name || 'Usuário',
                sender_photo: senderInfo?.photo || null,
                timestamp: msg.created_at
            };

            // Emite para a sala
            io.to(`ride_${ride_id}`).emit('receive_message', payload);

        } catch (e) {
            logError('CHAT_MSG', e);
        }
    });

    // =============================================================================================
    // 5. GESTÃO DE DESCONEXÃO (GRACEFUL SHUTDOWN)
    // =============================================================================================

    socket.on('disconnect', () => {
        // Encontra quem era o usuário deste socket
        // Como o socket.io não guarda state user_id por padrão, fazemos engenharia reversa via rooms
        // ou assumimos que o cliente mandou 'leave'.
        // A melhor prática aqui é consultar a tabela driver_positions pelo socket_id.

        handleDisconnect(socketId);
    });
}

/**
 * Lógica de Desconexão com Debounce (Buffer de 5 minutos)
 */
async function handleDisconnect(socketId) {
    try {
        // Verifica se era um motorista
        const posRes = await pool.query('SELECT driver_id FROM driver_positions WHERE socket_id = $1', [socketId]);

        if (posRes.rows.length > 0) {
            const driverId = posRes.rows[0].driver_id;

            // Define um timer. Se ele não reconectar em 5 minutos, marca como offline.
            // Isso previne que motoristas "pisquem" no mapa quando o 4G cai.
            const timeout = setTimeout(async () => {
                try {
                    // Verifica se o socket_id ainda é o mesmo (se reconectou, o socket_id mudou e o DB foi atualizado)
                    const check = await pool.query('SELECT socket_id FROM driver_positions WHERE driver_id = $1', [driverId]);

                    if (check.rows.length > 0 && check.rows[0].socket_id === socketId) {
                        // Realmente caiu e não voltou
                        await pool.query('UPDATE users SET is_online = false WHERE id = $1', [driverId]);
                        await pool.query("UPDATE driver_positions SET status = 'offline' WHERE driver_id = $1", [driverId]);
                        // logSystem('OFFLINE', `Motorista ${driverId} marcado como offline (Timeout 5min).`);
                    }
                } catch (err) {
                    logError('DISCONNECT_TIMEOUT', err);
                }
                disconnectTimers.delete(driverId);
            }, 300000); // 5 minutos (300.000 ms)

            disconnectTimers.set(driverId, timeout);
        }
    } catch (e) {
        logError('DISCONNECT_HANDLER', e);
    }
}

// =================================================================================================
// HELPER METHODS (EXPORTS)
// =================================================================================================

/**
 * Emite evento para todos os sockets conectados (Global Broadcast)
 */
function emitGlobal(event, data) {
    if (io) io.emit(event, data);
}

/**
 * Emite evento para um usuário específico (Targeted)
 */
function emitToUser(userId, event, data) {
    if (io) io.to(`user_${userId}`).emit(event, data);
}

module.exports = {
    setupSocketIO: initializeSocket,
    initializeSocket,
    emitGlobal,
    emitToUser
};