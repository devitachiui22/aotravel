/**
 * =================================================================================================
 * ⚡ AOTRAVEL SERVER PRO - TITANIUM SOCKET ENGINE v13.0.0 (CORE DE TEMPO REAL)
 * =================================================================================================
 *
 * ARQUIVO: src/services/socketService.js
 * DESCRIÇÃO: Motor centralizado e exclusivo de WebSockets.
 *
 * ✅ CORREÇÕES APLICADAS NESTA VERSÃO:
 * 1. RESYNC AUTOMÁTICO: Quando o motorista liga o terminal, o backend varre o DB e
 *    envia imediatamente todas as corridas "searching" pendentes num raio de 20km.
 * 2. MODO OFFLINE MANUAL: Adicionado listener 'driver_offline' para limpar a presença no DB
 *    apenas quando o motorista realmente clicar no botão vermelho.
 * 3. REPASSA A DISTÂNCIA E ETA DO MOTORISTA PARA A SALA: Evento update_trip_gps
 * 4. SINCRONIA PERFEITA DE TELEMETRIA: Emissão dupla para ride_${ride_id} e passenger_ride_${ride_id}
 *
 * STATUS: 🔥 PRODUCTION READY - FULL VERSION - 100% BLINDADO
 * =================================================================================================
 */

const { Server } = require("socket.io");
const pool = require('../config/db');
const { getFullRideDetails, logSystem, logError, getDistance, generateRef } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// Instância global do Socket.IO
let io;

// Cores para Logs de Terminal
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m'
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
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            credentials: true
        },
        pingTimeout: SYSTEM_CONFIG.SOCKET?.PING_TIMEOUT || 20000,
        pingInterval: SYSTEM_CONFIG.SOCKET?.PING_INTERVAL || 25000,
        transports: SYSTEM_CONFIG.SOCKET?.TRANSPORTS || ["websocket", "polling"],
        allowEIO3: true,
        connectTimeout: 10000,
        maxHttpBufferSize: 1e6 // 1MB para uploads via socket
    });

    global.io = io;

    io.on('connection', _handleConnection);

    console.log(`${colors.green}✅ Motor de Tempo Real v13.0 iniciado com sucesso.${colors.reset}`);
    console.log(`${colors.cyan}📡 Socket.IO ouvindo em ${SYSTEM_CONFIG.SERVER?.PORT || 3000}${colors.reset}`);

    // Job de Fundo: Limpa motoristas inativos a cada 2 minutos
    setInterval(() => {
        _cleanInactiveDrivers();
    }, 120000);

    // Job de Fundo: Atualiza heartbeat dos motoristas online
    setInterval(() => {
        _updateDriversHeartbeat();
    }, 30000);

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
    const clientIp = socket.handshake.address;

    console.log(`${colors.magenta}🔌 Terminal conectado: ${socketId} | IP: ${clientIp}${colors.reset}`);

    // Auto-Join de Sala baseada na autenticação via query params
    if (query && query.userId) {
        const userId = query.userId;
        const role = query.role || 'passenger';
        const userName = query.userName || 'Usuário';

        console.log(`${colors.green}👤 Usuário ${userId} (${userName}) conectado como ${role}${colors.reset}`);

        // Sala pessoal para notificações diretas
        socket.join(`user_${userId}`);

        if (role === 'driver') {
            socket.join('drivers');
            socket.join(`driver_${userId}`);

            const lat = parseFloat(query.lat) || -8.8399;
            const lng = parseFloat(query.lng) || 13.2894;

            _registerDriverOnline(userId, socketId, lat, lng, socket);
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

    // ✅ NOVO: Evento para quando o motorista clica em "Ficar Offline"
    socket.on('driver_offline', async (data) => {
        const driverId = data.driver_id || data.user_id;
        if (!driverId) return;

        console.log(`${colors.yellow}🛑 Motorista ${driverId} solicitou modo OFFLINE manualmente.${colors.reset}`);

        try {
            await pool.query(
                "UPDATE driver_positions SET status = 'offline', socket_id = NULL WHERE driver_id = $1",
                [driverId]
            );
            await pool.query(
                "UPDATE users SET is_online = false WHERE id = $1",
                [driverId]
            );

            socket.leave('drivers');
            socket.leave(`driver_${driverId}`);

            socket.emit('offline_confirmed', {
                success: true,
                message: "Você está offline. Para receber novas corridas, volte ao modo online."
            });

            console.log(`${colors.green}✅ Motorista ${driverId} marcado como OFFLINE manualmente.${colors.reset}`);
        } catch (e) {
            logError('DRIVER_OFFLINE', e);
            socket.emit('offline_confirmed', {
                success: false,
                error: "Erro ao processar solicitação offline."
            });
        }
    });

    // --- CICLO DE VIDA DA MISSÃO (CORRIDA) ---
    socket.on('request_ride', (data) => _routeToController('requestRide', data, socket, 'ride_request_response'));
    socket.on('accept_ride', (data) => _routeToController('acceptRide', data, socket, 'ride_accepted_confirmation'));
    socket.on('start_trip', (data) => _routeToController('startRide', data, socket, 'trip_started_ack'));
    socket.on('update_status', (data) => _routeToController('updateStatus', data, socket, 'status_update_ack'));
    socket.on('complete_ride', (data) => _routeToController('completeRide', data, socket, 'ride_completed_ack'));
    socket.on('cancel_ride', (data) => _routeToController('cancelRide', data, socket, 'ride_cancelled_ack'));

    // --- NEGOCIAÇÃO DE PREÇO ---
    socket.on('negotiate_price', (data) => _routeToController('negotiatePrice', data, socket, 'negotiation_ack'));
    socket.on('respond_negotiation', (data) => _routeToController('respondToNegotiation', data, socket, 'negotiation_response_ack'));

    // ✅ RASTREAMENTO TÁTICO (GPS DA CORRIDA) - REPASSA DISTÂNCIA E ETA
    socket.on('update_trip_gps', (data) => {
        const { ride_id, lat, lng, rotation, speed, distance, eta_minutes } = data;

        if (!ride_id || !lat || !lng) return;

        console.log(`${colors.cyan}📍 Atualização GPS - Ride ${ride_id}: (${lat}, ${lng}) | Dist: ${distance}km | ETA: ${eta_minutes}min${colors.reset}`);

        // Emite para todos na sala da corrida (exceto o remetente)
        socket.to(`ride_${ride_id}`).emit('trip_gps_update', {
            ride_id: ride_id,
            lat: lat,
            lng: lng,
            rotation: rotation || 0,
            speed: speed || 0,
            distance: distance || 0,
            eta_minutes: eta_minutes || 0,
            timestamp: new Date().toISOString()
        });

        // Também emite diretamente para o passageiro para garantir
        socket.to(`passenger_ride_${ride_id}`).emit('driver_gps_update', {
            ride_id: ride_id,
            lat: lat,
            lng: lng,
            rotation: rotation || 0,
            speed: speed || 0,
            distance: distance || 0,
            eta_minutes: eta_minutes || 0,
            timestamp: new Date().toISOString()
        });

        // Emite para compatibilidade com código antigo
        socket.to(`passenger_ride_${ride_id}`).emit('location_update', {
            ride_id: ride_id,
            lat: lat,
            lng: lng,
            rotation: rotation || 0,
            speed: speed || 0,
            distance: distance || 0,
            eta_minutes: eta_minutes || 0
        });
    });

    // --- PAGAMENTOS ---
    socket.on('request_payment', (data) => {
        const { ride_id, driver_id, amount, method } = data;

        console.log(`${colors.cyan}💰 Pagamento solicitado: Ride ${ride_id}, Amount: ${amount}, Method: ${method}${colors.reset}`);

        // Emite diretamente para o passageiro
        io.to(`ride_${ride_id}`).emit('payment_requested', {
            ride_id: ride_id,
            driver_id: driver_id,
            amount: amount,
            method: method,
            timestamp: new Date().toISOString()
        });

        // Também emite para a sala do passageiro
        io.to(`passenger_ride_${ride_id}`).emit('wallet_payment_request', {
            ride_id: ride_id,
            driver_id: driver_id,
            amount: amount,
            method: method,
            timestamp: new Date().toISOString()
        });

        socket.emit('payment_request_ack', {
            success: true,
            message: "Solicitação de pagamento enviada ao passageiro."
        });
    });

    socket.on('process_payment', (data) => _routeToController('completeRide', {
        ...data,
        payment_method: 'wallet'
    }, socket, 'payment_processed_ack'));

    // --- COMUNICAÇÃO E CHAT (SALA DA CORRIDA) ---
    socket.on('join_ride', (rideId) => {
        if (!rideId) return;

        socket.join(`ride_${rideId}`);

        // Também cria sala específica para passageiro
        if (query && query.role === 'passenger') {
            socket.join(`passenger_ride_${rideId}`);
        }

        console.log(`${colors.cyan}🚪 Socket ${socket.id} ingressou na sala ride_${rideId}${colors.reset}`);
        socket.emit('ride_joined', { success: true, ride_id: rideId });
    });

    socket.on('leave_ride', (rideId) => {
        if (!rideId) return;

        socket.leave(`ride_${rideId}`);
        socket.leave(`passenger_ride_${rideId}`);

        console.log(`${colors.yellow}🚪 Socket ${socket.id} deixou a sala ride_${rideId}${colors.reset}`);
        socket.emit('ride_left', { success: true, ride_id: rideId });
    });

    socket.on('send_message', (data) => _handleSendMessage(socket, data));

    socket.on('typing_indicator', (data) => {
        if (!data.ride_id || !data.user_id) return;

        socket.to(`ride_${data.ride_id}`).emit('user_typing', {
            user_id: data.user_id,
            is_typing: data.is_typing,
            ride_id: data.ride_id
        });
    });

    socket.on('mark_messages_read', async (data) => {
        const { ride_id, user_id } = data;
        if (!ride_id || !user_id) return;

        try {
            const result = await pool.query(`
                UPDATE chat_messages
                SET is_read = true, read_at = NOW()
                WHERE ride_id = $1 AND sender_id != $2 AND is_read = false
                RETURNING id
            `, [ride_id, user_id]);

            if (result.rows.length > 0) {
                // Notifica o outro usuário que as mensagens foram lidas
                io.to(`ride_${ride_id}`).emit('messages_read', {
                    ride_id: ride_id,
                    reader_id: user_id,
                    message_ids: result.rows.map(r => r.id),
                    read_at: new Date().toISOString()
                });
            }
        } catch (e) {
            logError('MARK_MESSAGES_READ', e);
        }
    });

    // --- DESCONEXÃO ---
    socket.on('disconnect', () => _handleDisconnect(socket));
}

/**
 * =================================================================================================
 * 4. PONTES DE LIGAÇÃO (CONTROLLER BRIDGE)
 * =================================================================================================
 */
async function _routeToController(methodName, data, socket, responseEvent) {
    const rideController = require('../controllers/rideController');

    const userId = data.driver_id || data.passenger_id || data.user_id;
    const role = data.role || (data.driver_id ? 'driver' : 'passenger');
    const requestId = generateRef('SOCK');

    console.log(`${colors.blue}🔄 [${requestId}] Roteando ${methodName} para o controller...${colors.reset}`);

    const req = {
        body: data,
        user: { id: userId, role: role },
        io: io,
        ip: socket.handshake.address,
        headers: socket.handshake.headers
    };

    const res = {
        statusCode: 200,
        status: function(code) {
            this.statusCode = code;
            return this;
        },
        json: function(payload) {
            console.log(`${colors.green}✅ [${requestId}] Resposta de ${methodName} enviada com status ${this.statusCode}${colors.reset}`);
            socket.emit(responseEvent, {
                ...payload,
                request_id: requestId,
                timestamp: new Date().toISOString()
            });
            return this;
        }
    };

    try {
        if (typeof rideController[methodName] !== 'function') {
            throw new Error(`Método ${methodName} não encontrado no Controller.`);
        }
        await rideController[methodName](req, res);
    } catch (e) {
        logError('BRIDGE_ERROR', e);
        socket.emit(responseEvent, {
            success: false,
            error: "Erro interno na operação do servidor.",
            code: "INTERNAL_ERROR",
            request_id: requestId,
            details: process.env.NODE_ENV === 'development' ? e.message : undefined
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

    console.log(`${colors.green}👤 Usuário ${userIdStr} ingressou na sala user_${userIdStr}${colors.reset}`);

    try {
        await pool.query(
            "UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1",
            [userIdStr]
        );

        socket.emit('joined_ack', {
            success: true,
            user_id: userIdStr,
            socket_id: socket.id,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        logError('JOIN_USER', e);
        socket.emit('joined_ack', {
            success: false,
            error: "Erro ao atualizar status de online."
        });
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

    await _registerDriverOnline(driverId, socket.id, lat, lng, socket);

    socket.emit('joined_ack', {
        success: true,
        driver_id: driverId,
        status: 'online',
        timestamp: new Date().toISOString()
    });

    // 🔥 O GRANDE FIX: ENVIAR CORRIDAS PENDENTES QUANDO O MOTORISTA FICA ONLINE
    try {
        console.log(`${colors.cyan}🔍 Buscando corridas pendentes para motorista ${driverId}...${colors.reset}`);

        const pendingRides = await pool.query(`
            SELECT id, origin_lat, origin_lng, passenger_id, initial_price,
                   ride_type, distance_km, origin_name, dest_name
            FROM rides
            WHERE status = 'searching'
              AND created_at > NOW() - INTERVAL '30 minutes'
            ORDER BY created_at DESC
        `);

        if (pendingRides.rows.length > 0) {
            console.log(`${colors.green}🔄 Encontradas ${pendingRides.rows.length} corridas pendentes para sincronização.${colors.reset}`);

            let sentCount = 0;

            for (const row of pendingRides.rows) {
                // Calcula distância do motorista até a origem da corrida
                let distanceToPickup = getDistance(
                    lat, lng,
                    parseFloat(row.origin_lat), parseFloat(row.origin_lng)
                );

                // Só envia se estiver dentro do raio de 20km
                if (distanceToPickup <= 20) {
                    const fullRide = await getFullRideDetails(row.id);
                    if (fullRide) {
                        const payload = {
                            ...fullRide,
                            distance_to_pickup: parseFloat(distanceToPickup.toFixed(1)),
                            resync: true,
                            timestamp: new Date().toISOString()
                        };

                        // Envia direto para o motorista que acabou de conectar
                        socket.emit('ride_opportunity', payload);
                        sentCount++;
                    }
                }
            }

            console.log(`${colors.green}✅ ${sentCount} corridas reenviadas para motorista ${driverId}${colors.reset}`);
        } else {
            console.log(`${colors.yellow}ℹ️ Nenhuma corrida pendente encontrada.${colors.reset}`);
        }
    } catch (e) {
        logError('FETCH_PENDING_RIDES', e);
    }
}

async function _registerDriverOnline(driverId, socketId, lat, lng, socket) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verifica se já existe um registro
        const existing = await client.query(
            "SELECT * FROM driver_positions WHERE driver_id = $1",
            [driverId]
        );

        if (existing.rows.length > 0) {
            // Atualiza registro existente
            await client.query(`
                UPDATE driver_positions
                SET lat = $2, lng = $3, socket_id = $4, status = 'online', last_update = NOW()
                WHERE driver_id = $1
            `, [driverId, lat, lng, socketId]);
        } else {
            // Cria novo registro
            await client.query(`
                INSERT INTO driver_positions (driver_id, lat, lng, socket_id, status, last_update)
                VALUES ($1, $2, $3, $4, 'online', NOW())
            `, [driverId, lat, lng, socketId]);
        }

        await client.query(
            "UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1",
            [driverId]
        );

        await client.query('COMMIT');

        console.log(`${colors.green}✅ Motorista ${driverId} registrado como ONLINE (Pos: ${lat}, ${lng})${colors.reset}`);

        // Notifica outros motoristas sobre o novo online
        socket.to('drivers').emit('driver_online', {
            driver_id: driverId,
            lat: lat,
            lng: lng,
            timestamp: new Date().toISOString()
        });

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
    const heading = parseFloat(data.heading) || 0;
    const speed = parseFloat(data.speed) || 0;

    if (!driverId || isNaN(lat) || isNaN(lng)) return;

    try {
        // Atualiza posição do motorista
        await pool.query(`
            UPDATE driver_positions
            SET lat = $2, lng = $3, heading = $4, speed = $5, last_update = NOW()
            WHERE driver_id = $1
        `, [driverId, lat, lng, heading, speed]);

        // Busca corridas ativas deste motorista
        const activeRides = await pool.query(`
            SELECT id, passenger_id FROM rides
            WHERE driver_id = $1 AND status IN ('accepted', 'ongoing', 'arrived')
        `, [driverId]);

        // Emite atualização para cada corrida ativa
        activeRides.rows.forEach(ride => {
            const locationPayload = {
                ride_id: ride.id,
                driver_id: driverId,
                lat: lat,
                lng: lng,
                heading: heading,
                speed: speed,
                timestamp: new Date().toISOString()
            };

            io.to(`ride_${ride.id}`).emit('driver_location_update', locationPayload);
            io.to(`passenger_ride_${ride.id}`).emit('driver_location', locationPayload);
        });

    } catch (e) {
        logError('UPDATE_LOCATION', e);
    }
}

async function _handleHeartbeat(socket, data) {
    const driverId = data.driver_id || data.user_id;
    if (!driverId) return;

    try {
        await pool.query(
            "UPDATE driver_positions SET last_update = NOW() WHERE driver_id = $1",
            [driverId]
        );
        await pool.query(
            "UPDATE users SET last_seen = NOW(), is_online = true WHERE id = $1",
            [driverId]
        );

        socket.emit('heartbeat_ack', {
            success: true,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        logError('HEARTBEAT', e);
    }
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

        const senderInfo = await pool.query(
            'SELECT name, photo FROM users WHERE id = $1',
            [sender_id]
        );

        const payload = {
            id: result.rows[0].id,
            ride_id: ride_id,
            sender_id: sender_id,
            text: text || '',
            image_url: imageUrl,
            message_type: message_type,
            created_at: result.rows[0].created_at,
            sender_name: senderInfo.rows[0]?.name || 'Usuário',
            sender_photo: senderInfo.rows[0]?.photo || null,
            timestamp: new Date().toISOString()
        };

        // Emite para todos na sala da corrida
        io.to(`ride_${ride_id}`).emit('receive_message', payload);

        // Confirma para o remetente
        socket.emit('message_sent', {
            ...payload,
            delivered: true
        });

    } catch (e) {
        logError('SEND_MESSAGE', e);
        socket.emit('message_error', {
            error: "Erro ao enviar mensagem",
            details: e.message
        });
    }
}

async function _handleDisconnect(socket) {
    console.log(`${colors.yellow}🔌 Terminal desconectado: ${socket.id}${colors.reset}`);

    try {
        // Busca motorista associado a este socket
        const result = await pool.query(
            'SELECT driver_id FROM driver_positions WHERE socket_id = $1',
            [socket.id]
        );

        if (result.rows.length > 0) {
            const driverId = result.rows[0].driver_id;

            // Delay de 10 segundos para reconexão rápida
            setTimeout(async () => {
                try {
                    const check = await pool.query(
                        'SELECT socket_id, status FROM driver_positions WHERE driver_id = $1',
                        [driverId]
                    );

                    // Se ainda estiver com o mesmo socket ou sem socket, marca como offline
                    if (check.rows[0]?.socket_id === socket.id || !check.rows[0]?.socket_id) {
                        await pool.query(
                            "UPDATE driver_positions SET status = 'offline', socket_id = NULL WHERE driver_id = $1",
                            [driverId]
                        );
                        await pool.query(
                            "UPDATE users SET is_online = false WHERE id = $1",
                            [driverId]
                        );

                        // Notifica outros motoristas
                        io.to('drivers').emit('driver_offline', {
                            driver_id: driverId,
                            timestamp: new Date().toISOString()
                        });

                        console.log(`${colors.yellow}🚫 Motorista ${driverId} marcado como offline após timeout.${colors.reset}`);
                    }
                } catch (innerError) {
                    logError('DISCONNECT_TIMEOUT', innerError);
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
                await pool.query(
                    "UPDATE users SET is_online = false WHERE id = $1",
                    [row.driver_id]
                );

                // Notifica outros motoristas
                io.to('drivers').emit('driver_offline', {
                    driver_id: row.driver_id,
                    reason: 'inactivity',
                    timestamp: new Date().toISOString()
                });

                console.log(`${colors.yellow}🧹 Motorista ${row.driver_id} varrido por inatividade (3min sem heartbeat).${colors.reset}`);
            }
        }
    } catch (e) {
        logError('CLEAN_INACTIVE_DRIVERS', e);
    }
}

async function _updateDriversHeartbeat() {
    try {
        // Atualiza timestamp de todos os motoristas online para evitar limpeza acidental
        await pool.query(`
            UPDATE driver_positions
            SET last_update = NOW()
            WHERE status = 'online'
              AND last_update > NOW() - INTERVAL '2 minutes'
        `);
    } catch (e) {
        logError('HEARTBEAT_UPDATE', e);
    }
}

/**
 * =================================================================================================
 * 6. FUNÇÕES DE UTILIDADE PÚBLICA
 * =================================================================================================
 */

function getIO() {
    if (!io) throw new Error("Socket.IO não inicializado!");
    return io;
}

function emitToUser(userId, event, data) {
    if (!userId || !io) return false;

    try {
        io.to(`user_${userId}`).emit(event, {
            ...data,
            timestamp: new Date().toISOString()
        });
        return true;
    } catch (e) {
        logError('EMIT_TO_USER', e);
        return false;
    }
}

function emitToRide(rideId, event, data) {
    if (!rideId || !io) return false;

    try {
        io.to(`ride_${rideId}`).emit(event, {
            ...data,
            timestamp: new Date().toISOString()
        });
        return true;
    } catch (e) {
        logError('EMIT_TO_RIDE', e);
        return false;
    }
}

function emitToDrivers(event, data) {
    if (!io) return false;

    try {
        io.to('drivers').emit(event, {
            ...data,
            timestamp: new Date().toISOString()
        });
        return true;
    } catch (e) {
        logError('EMIT_TO_DRIVERS', e);
        return false;
    }
}

function emitToDriver(driverId, event, data) {
    if (!driverId || !io) return false;

    try {
        io.to(`driver_${driverId}`).emit(event, {
            ...data,
            timestamp: new Date().toISOString()
        });
        return true;
    } catch (e) {
        logError('EMIT_TO_DRIVER', e);
        return false;
    }
}

// =================================================================================================
// EXPORTAÇÃO DO MÓDULO
// =================================================================================================
module.exports = {
    setupSocketIO,
    getIO,
    emitToUser,
    emitToRide,
    emitToDrivers,
    emitToDriver
};
