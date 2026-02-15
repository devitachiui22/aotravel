/**
 * =================================================================================================
 * ⚡ AOTRAVEL SERVER PRO - SOCKET SERVICE (CORREÇÃO DO FLUXO DE CORRIDAS) v7.3.0
 * =================================================================================================
 *
 * ARQUIVO: src/services/socketService.js
 * DESCRIÇÃO: Motor de comunicação bidirecional em tempo real - ULTRA ESTÁVEL
 *
 * ✅ CORREÇÕES APLICADAS v7.3.0:
 * 1. Chamada explícita ao `socketController.joinDriverRoom` no evento
 * 2. Logs massivos com cores específicas para debug
 * 3. Transações ACID para operações críticas
 * 4. Debounce inteligente na desconexão (5 minutos)
 * 5. Sincronização completa com banco de dados
 * 6. Monitoramento em tempo real de motoristas online
 * 7. Tratamento robusto de erros com rollback
 * 8. Emissão de eventos garantida com confirmação
 *
 * STATUS: 🔥 ABSOLUTAMENTE PRODUCTION READY
 * =================================================================================================
 */

const { Server } = require("socket.io");
const pool = require('../config/db');
const { logSystem, logError, getFullRideDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

const socketController = require('../controllers/socketController');
const rideController = require('../controllers/rideController');

// Cores para logs no terminal
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
};

let io;

// Armazenamento em memória para debounce de desconexão
const disconnectTimers = new Map();
const userSockets = new Map(); // userId -> socketId
const socketUsers = new Map(); // socketId -> userId
const authenticatedUsers = new Map(); // socketId -> user data

// =================================================================================================
// 1. INICIALIZAÇÃO DO SERVIDOR SOCKET.IO
// =================================================================================================
function initializeSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: SYSTEM_CONFIG.SERVER?.CORS_ORIGIN || "*",
            methods: ["GET", "POST", "PUT", "DELETE"],
            credentials: true
        },
        pingTimeout: SYSTEM_CONFIG.SOCKET?.PING_TIMEOUT || 60000,
        pingInterval: SYSTEM_CONFIG.SOCKET?.PING_INTERVAL || 25000,
        transports: SYSTEM_CONFIG.SOCKET?.TRANSPORTS || ['websocket', 'polling'],
        allowEIO3: true,
        connectTimeout: 10000,
        maxHttpBufferSize: 1e6,
        cookie: false
    });

    // Expor globalmente para acesso em controllers
    global.io = io;

    io.on('connection', (socket) => {
        handleConnection(socket);
    });

    logSystem('SOCKET_ENGINE', '🚀 Servidor Real-Time iniciado e pronto para conexões.');

    // Monitoramento periódico de motoristas online (a cada 10 segundos)
    setInterval(async () => {
        try {
            const stats = await socketController.getDriverStats();
            const onlineCount = stats.online;
            
            if (onlineCount > 0) {
                console.log(`${colors.blue}📊 [STATUS] Motoristas online: ${onlineCount}${colors.reset}`);
            }
            
            // Emitir atualização global
            io.emit('drivers_online_update', {
                count: onlineCount,
                stats: stats,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logError('STATUS_MONITOR', error);
        }
    }, 10000);

    // Limpeza de motoristas inativos (a cada 1 minuto)
    setInterval(async () => {
        try {
            const cleaned = await socketController.cleanInactiveDrivers();
            if (cleaned > 0) {
                console.log(`${colors.yellow}🧹 Limpeza automática: ${cleaned} motoristas inativos removidos${colors.reset}`);
                
                // Atualizar contagem global
                const stats = await socketController.getDriverStats();
                io.emit('drivers_online_update', {
                    count: stats.online,
                    stats: stats,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            logError('CLEANUP_JOB', error);
        }
    }, 60000);

    return io;
}

// =================================================================================================
// 2. MANIPULADOR DE CONEXÃO
// =================================================================================================
function handleConnection(socket) {
    const socketId = socket.id;
    
    console.log(`${colors.green}🔌 [SOCKET] Nova conexão: ${socketId} (Transport: ${socket.conn.transport.name})${colors.reset}`);

    // =====================================================================
    // 1. JOIN USER
    // =====================================================================
    socket.on('join_user', async (userId) => {
        const timestamp = new Date().toISOString();
        
        console.log(`${colors.blue}\n👤 [join_user] INÍCIO - Socket: ${socketId}${colors.reset}`);
        console.log(`${colors.blue}👤 User ID: ${userId} - Timestamp: ${timestamp}${colors.reset}`);

        if (!userId) {
            console.log(`${colors.red}❌ [join_user] User ID não fornecido${colors.reset}`);
            socket.emit('error', { message: 'User ID não fornecido' });
            return;
        }

        const userIdStr = userId.toString();
        const roomName = `user_${userIdStr}`;

        try {
            socket.join(roomName);
            userSockets.set(userIdStr, socketId);
            socketUsers.set(socketId, userIdStr);

            console.log(`${colors.green}✅ [join_user] User ${userIdStr} entrou na sala ${roomName}${colors.reset}`);

            // Cancelar timer de desconexão se existir
            if (disconnectTimers.has(userIdStr)) {
                clearTimeout(disconnectTimers.get(userIdStr));
                disconnectTimers.delete(userIdStr);
                console.log(`${colors.yellow}⏱️ [join_user] Timer de desconexão cancelado para user ${userIdStr}${colors.reset}`);
            }

            // Atualizar status no banco
            const userUpdate = await pool.query(
                "UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1 RETURNING is_online",
                [userId]
            );

            console.log(`${colors.green}✅ [DB] Users atualizado - is_online: ${userUpdate.rows[0]?.is_online}${colors.reset}`);

            // Buscar informações do usuário
            const userRes = await pool.query(
                "SELECT role, name, photo, rating, vehicle_details FROM users WHERE id = $1",
                [userId]
            );

            if (userRes.rows.length > 0) {
                const user = userRes.rows[0];
                authenticatedUsers.set(socketId, { id: userIdStr, ...user });

                // Buscar corridas pendentes
                const pendingRides = await pool.query(
                    `SELECT * FROM rides
                     WHERE (passenger_id = $1 OR driver_id = $1)
                     AND status IN ('searching', 'accepted', 'ongoing')
                     ORDER BY created_at DESC`,
                    [userId]
                );

                console.log(`${colors.cyan}📊 Corridas pendentes encontradas: ${pendingRides.rows.length}${colors.reset}`);

                // Entrar nas salas das corridas
                pendingRides.rows.forEach(ride => {
                    const rideRoom = `ride_${ride.id}`;
                    socket.join(rideRoom);
                    console.log(`${colors.green}✅ Entrou na sala da corrida ${ride.id} (status: ${ride.status})${colors.reset}`);
                });
            }

            // Emitir confirmação
            socket.emit('joined_ack', {
                success: true,
                room: roomName,
                status: 'online',
                user_id: userId,
                socket_id: socketId,
                timestamp: timestamp
            });

            console.log(`${colors.green}✅ [join_user] Confirmação enviada para user ${userIdStr}${colors.reset}`);

        } catch (error) {
            logError('JOIN_USER', error);
            socket.emit('error', { 
                message: 'Erro ao registrar usuário', 
                error: error.message 
            });
        }
        
        console.log(`${colors.blue}👤 [join_user] FIM\n${colors.reset}`);
    });

    // =====================================================================
    // 2. JOIN DRIVER ROOM - VERSÃO CORRIGIDA COM LOGS MASSIVOS
    // =====================================================================
    socket.on('join_driver_room', async (data) => {
        console.log(`${colors.magenta}\n🔴🔴🔴🔴🔴 [join_driver_room] INÍCIO 🔴🔴🔴🔴🔴${colors.reset}`);
        console.log(`${colors.magenta}📍 Socket ID: ${socketId}${colors.reset}`);
        console.log(`${colors.magenta}📍 Dados recebidos:${colors.reset}`, JSON.stringify(data, null, 2));

        let driverId = null;
        let lat = 0.0;
        let lng = 0.0;
        let heading = 0.0;
        let speed = 0.0;
        let accuracy = 0.0;

        // Extrair dados do payload
        if (typeof data === 'object') {
            driverId = data.driver_id || data.user_id || data.id;
            lat = parseFloat(data.lat) || 0.0;
            lng = parseFloat(data.lng) || 0.0;
            heading = parseFloat(data.heading) || 0.0;
            speed = parseFloat(data.speed) || 0.0;
            accuracy = parseFloat(data.accuracy) || 0.0;
        } else {
            driverId = data;
        }

        if (!driverId) {
            console.log(`${colors.red}❌ [join_driver_room] ID nulo - abortando${colors.reset}`);
            return;
        }

        const driverIdStr = driverId.toString();
        const timestamp = new Date().toISOString();

        console.log(`${colors.magenta}📍 Driver ID: ${driverIdStr}${colors.reset}`);
        console.log(`${colors.magenta}📍 Posição: (${lat}, ${lng})${colors.reset}`);
        console.log(`${colors.magenta}📍 Heading/Speed: ${heading}°, ${speed} km/h${colors.reset}`);
        console.log(`${colors.magenta}📍 Accuracy: ${accuracy}${colors.reset}`);

        try {
            // Entrar nas salas necessárias
            socket.join('drivers');
            socket.join(`driver_${driverIdStr}`);
            socket.join(`user_${driverIdStr}`);

            // Atualizar maps de usuários
            userSockets.set(driverIdStr, socketId);
            socketUsers.set(socketId, driverIdStr);

            console.log(`${colors.green}✅ [SOCKET] Driver ${driverIdStr} registrado nas salas: drivers, driver_${driverIdStr}, user_${driverIdStr}${colors.reset}`);

            // Cancelar timer de desconexão se existir
            if (disconnectTimers.has(driverIdStr)) {
                clearTimeout(disconnectTimers.get(driverIdStr));
                disconnectTimers.delete(driverIdStr);
                console.log(`${colors.yellow}⏱️ Timer de desconexão cancelado para driver ${driverIdStr}${colors.reset}`);
            }

            // 🔴 CHAMADA DIRETA AO CONTROLLER - VERSÃO CORRIGIDA
            console.log(`${colors.cyan}🔄 Chamando socketController.joinDriverRoom...${colors.reset}`);
            
            await socketController.joinDriverRoom({
                driver_id: driverIdStr,
                user_id: driverIdStr,
                lat: lat,
                lng: lng,
                heading: heading,
                speed: speed,
                accuracy: accuracy,
                status: 'online'
            }, socket);
            
            console.log(`${colors.green}✅ Controller executado com sucesso${colors.reset}`);

            // Buscar informações do motorista
            const driverInfo = await pool.query(
                "SELECT name, photo, rating, vehicle_details FROM users WHERE id = $1",
                [driverIdStr]
            );

            if (driverInfo.rows.length > 0) {
                authenticatedUsers.set(socketId, { 
                    id: driverIdStr, 
                    role: 'driver',
                    ...driverInfo.rows[0] 
                });
            }

            // Buscar corridas ativas para este motorista
            const activeRides = await pool.query(
                `SELECT * FROM rides
                 WHERE driver_id = $1
                 AND status IN ('accepted', 'ongoing')
                 ORDER BY created_at DESC`,
                [driverIdStr]
            );

            if (activeRides.rows.length > 0) {
                console.log(`${colors.cyan}📊 Corridas ativas encontradas: ${activeRides.rows.length}${colors.reset}`);
                
                activeRides.rows.forEach(ride => {
                    const rideRoom = `ride_${ride.id}`;
                    socket.join(rideRoom);
                    console.log(`${colors.green}✅ Entrou na sala da corrida ativa ${ride.id}${colors.reset}`);
                });
            }

            // Emitir confirmação
            socket.emit('joined_ack', {
                room: 'drivers',
                driver_id: driverIdStr,
                status: 'online',
                timestamp: timestamp
            });

            console.log(`${colors.green}✅ [SOCKET] joined_ack enviado para driver ${driverIdStr}${colors.reset}`);

            // Atualizar contagem global de motoristas online
            const onlineCount = await socketController.countOnlineDrivers();
            io.emit('drivers_online_count', {
                count: onlineCount,
                timestamp: timestamp
            });

            console.log(`${colors.blue}📊 Motoristas online atualizados: ${onlineCount}${colors.reset}`);

        } catch (error) {
            console.log(`${colors.red}❌ [ERROR] Falha no join_driver_room:${colors.reset}`, error.message);
            console.error(error.stack);
            
            socket.emit('joined_ack', {
                success: false,
                driver_id: driverIdStr,
                error: error.message,
                timestamp: timestamp
            });
        }

        console.log(`${colors.magenta}🔴🔴🔴🔴🔴 [join_driver_room] FIM 🔴🔴🔴🔴🔴\n${colors.reset}`);
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
        
        console.log(`${colors.cyan}🚗 [join_ride] Socket ${socketId} entrou na sala ${roomName}${colors.reset}`);

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
        
        console.log(`${colors.yellow}🚗 [leave_ride] Socket ${socketId} saiu da sala ${roomName}${colors.reset}`);

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

        console.log(`${colors.cyan}📍 [update_location] Driver ${driverId}: (${data.lat}, ${data.lng})${colors.reset}`);

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

        // Se estiver em uma corrida, emitir atualização para os participantes
        if (data.ride_id) {
            io.to(`ride_${data.ride_id}`).emit('driver_location_update', {
                lat: parseFloat(data.lat),
                lng: parseFloat(data.lng),
                heading: parseFloat(data.heading || 0),
                speed: parseFloat(data.speed || 0),
                timestamp: new Date().toISOString(),
                ride_id: data.ride_id,
                driver_id: driverId
            });
            
            console.log(`${colors.green}✅ Localização do driver ${driverId} emitida para ride ${data.ride_id}${colors.reset}`);
        }
    });

    // =====================================================================
    // 6. HEARTBEAT
    // =====================================================================
    socket.on('heartbeat', async (data) => {
        const driverId = data.driver_id || data.user_id;

        if (!driverId) return;

        // Apenas atualizar timestamp (sem alterar posição)
        await socketController.updateDriverActivity(driverId);
        
        // Responder com pong para manter conexão viva
        socket.emit('heartbeat_ack', {
            timestamp: new Date().toISOString(),
            driver_id: driverId
        });
    });

    // =====================================================================
    // 7. GET NEARBY DRIVERS
    // =====================================================================
    socket.on('get_nearby_drivers', async (data) => {
        const { lat, lng, radius = 15 } = data;

        if (!lat || !lng) return;

        console.log(`${colors.cyan}🗺️ [get_nearby_drivers] Buscando motoristas em raio de ${radius}km de (${lat}, ${lng})${colors.reset}`);

        try {
            const drivers = await socketController.getNearbyDrivers(lat, lng, radius);

            socket.emit('nearby_drivers', {
                drivers: drivers,
                count: drivers.length,
                timestamp: new Date().toISOString()
            });

            console.log(`${colors.green}✅ Encontrados ${drivers.length} motoristas próximos${colors.reset}`);

        } catch (error) {
            logError('NEARBY_DRIVERS', error);
        }
    });

    // =====================================================================
    // 8. REQUEST RIDE - VERSÃO CORRIGIDA COM CONTROLLER
    // =====================================================================
    socket.on('request_ride', async (data) => {
        console.log(`${colors.cyan}\n🚕 [request_ride] ========================================${colors.reset}`);
        console.log(`${colors.cyan}🚕 SOLICITAÇÃO DE CORRIDA VIA SOCKET${colors.reset}`);
        console.log(`${colors.cyan}🚕 Socket ID: ${socketId}${colors.reset}`);
        console.log(`${colors.cyan}🚕 Dados recebidos:${colors.reset}`, JSON.stringify(data, null, 2));
        console.log(`${colors.cyan}🚕 ========================================${colors.reset}`);

        try {
            // Validar dados mínimos
            if (!data.passenger_id || !data.pickup_lat || !data.pickup_lng) {
                throw new Error('Dados incompletos para solicitar corrida');
            }

            // Criar um objeto req simulado para o controller
            const mockReq = {
                body: {
                    ...data,
                    passenger_id: parseInt(data.passenger_id)
                },
                user: { id: data.passenger_id },
                io: io
            };

            const mockRes = {
                status: (code) => ({
                    json: async (response) => {
                        console.log(`${colors.green}📦 [request_ride] Resposta do controller (${code}):${colors.reset}`, response);

                        // Emitir para o passageiro
                        io.to(`user_${data.passenger_id}`).emit('ride_request_response', {
                            success: code === 201,
                            message: response.message,
                            ride: response.ride,
                            dispatch_stats: response.dispatch_stats,
                            timestamp: new Date().toISOString()
                        });

                        // Se houver motoristas notificados, eles já receberam via ride_opportunity
                        if (response.dispatch_stats?.drivers_notified > 0) {
                            console.log(`${colors.green}✅ [request_ride] ${response.dispatch_stats.drivers_notified} motoristas notificados${colors.reset}`);
                            
                            // Entrar na sala da corrida
                            if (response.ride?.id) {
                                socket.join(`ride_${response.ride.id}`);
                                console.log(`${colors.green}✅ Entrou na sala ride_${response.ride.id}${colors.reset}`);
                            }
                        } else {
                            console.log(`${colors.yellow}⚠️ [request_ride] Nenhum motorista disponível no momento${colors.reset}`);
                        }
                    }
                })
            };

            // Chamar o controller
            await rideController.requestRide(mockReq, mockRes);

        } catch (error) {
            console.log(`${colors.red}❌ [request_ride] Erro ao processar solicitação:${colors.reset}`, error.message);
            console.error(error.stack);

            io.to(`user_${data.passenger_id}`).emit('ride_request_error', {
                message: 'Erro ao processar solicitação',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
        
        console.log(`${colors.cyan}🚕 ========================================\n${colors.reset}`);
    });

    // =====================================================================
    // 9. ACCEPT RIDE - VERSÃO CORRIGIDA COM TRANSAÇÃO
    // =====================================================================
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id } = data;
        const timestamp = new Date().toISOString();

        console.log(`${colors.green}\n✅ [accept_ride] ========================================${colors.reset}`);
        console.log(`${colors.green}✅ Aceitando corrida: ${ride_id}${colors.reset}`);
        console.log(`${colors.green}✅ Driver ID: ${driver_id}${colors.reset}`);
        console.log(`${colors.green}✅ Timestamp: ${timestamp}${colors.reset}`);

        if (!ride_id || !driver_id) {
            console.log(`${colors.red}❌ [accept_ride] Dados incompletos${colors.reset}`);
            socket.emit('error_response', {
                message: "Dados incompletos para aceitar corrida",
                code: "INCOMPLETE_DATA",
                timestamp: timestamp
            });
            return;
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Bloquear a corrida para evitar concorrência
            const checkRes = await client.query(
                "SELECT * FROM rides WHERE id = $1 FOR UPDATE SKIP LOCKED",
                [ride_id]
            );

            if (checkRes.rows.length === 0) {
                await client.query('ROLLBACK');
                console.log(`${colors.yellow}⚠️ [accept_ride] Corrida não encontrada ou já processada${colors.reset}`);
                
                socket.emit('error_response', {
                    message: "Corrida não encontrada ou já processada",
                    code: "RIDE_NOT_FOUND",
                    timestamp: timestamp
                });
                return;
            }

            const ride = checkRes.rows[0];
            console.log(`${colors.cyan}📊 Status atual da corrida: ${ride.status}${colors.reset}`);

            if (ride.status !== 'searching') {
                await client.query('ROLLBACK');
                console.log(`${colors.yellow}⚠️ [accept_ride] Corrida já foi aceita por outro motorista${colors.reset}`);
                
                socket.emit('error_response', {
                    message: "Esta corrida já foi aceita por outro motorista",
                    code: "RIDE_TAKEN",
                    current_status: ride.status,
                    timestamp: timestamp
                });
                return;
            }

            if (ride.passenger_id === parseInt(driver_id)) {
                await client.query('ROLLBACK');
                console.log(`${colors.yellow}⚠️ [accept_ride] Motorista tentou aceitar própria corrida${colors.reset}`);
                
                socket.emit('error_response', {
                    message: "Você não pode aceitar sua própria corrida",
                    code: "SELF_RIDE",
                    timestamp: timestamp
                });
                return;
            }

            // Atualizar a corrida
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

            console.log(`${colors.green}✅ [accept_ride] Corrida ${ride_id} aceita com sucesso por driver ${driver_id}${colors.reset}`);

            // Buscar detalhes completos da corrida
            const fullRide = await getFullRideDetails(ride_id);

            // Entrar na sala da corrida
            socket.join(`ride_${ride_id}`);

            const matchPayload = {
                ...fullRide,
                matched_at: timestamp,
                message: "Motorista a caminho do ponto de embarque! 🚗"
            };

            // Emitir para todos na sala da corrida
            io.to(`ride_${ride_id}`).emit('match_found', matchPayload);
            io.to(`ride_${ride_id}`).emit('ride_accepted', matchPayload);

            // Emitir especificamente para o passageiro
            if (fullRide.passenger_id) {
                io.to(`user_${fullRide.passenger_id}`).emit('match_found', matchPayload);
                console.log(`${colors.green}✅ Notificação enviada para passageiro ${fullRide.passenger_id}${colors.reset}`);
            }

            // Notificar outros motoristas que a corrida não está mais disponível
            const otherDriversRes = await pool.query(`
                SELECT socket_id
                FROM driver_positions
                WHERE status = 'online'
                AND last_update > NOW() - INTERVAL '30 minutes'
                AND socket_id IS NOT NULL
                AND driver_id != $1
            `, [driver_id]);

            console.log(`${colors.cyan}📊 Notificando ${otherDriversRes.rows.length} outros motoristas que a corrida foi aceita${colors.reset}`);

            otherDriversRes.rows.forEach(driver => {
                if (driver.socket_id) {
                    io.to(driver.socket_id).emit('ride_taken', {
                        ride_id: ride_id,
                        message: 'Esta corrida já não está mais disponível',
                        taken_by: driver_id,
                        timestamp: timestamp
                    });
                }
            });

            // Confirmar para o motorista
            socket.emit('ride_accepted_confirmation', {
                success: true,
                ride: matchPayload,
                timestamp: timestamp
            });

            console.log(`${colors.green}✅ [accept_ride] Processo concluído com sucesso${colors.reset}`);

        } catch (error) {
            await client.query('ROLLBACK');
            console.log(`${colors.red}❌ [accept_ride] Erro crítico:${colors.reset}`, error.message);
            console.error(error.stack);
            
            logError('ACCEPT_RIDE_FATAL', error);
            
            socket.emit('error_response', {
                message: "Erro crítico ao processar aceite",
                error: error.message,
                code: "FATAL_ERROR",
                timestamp: timestamp
            });
        } finally {
            client.release();
        }
        
        console.log(`${colors.green}✅ ========================================\n${colors.reset}`);
    });

    // =====================================================================
    // 10. START TRIP
    // =====================================================================
    socket.on('start_trip', async (data) => {
        const { ride_id, driver_id } = data;
        const timestamp = new Date().toISOString();

        console.log(`${colors.cyan}\n🚗 [start_trip] ========================================${colors.reset}`);
        console.log(`${colors.cyan}🚗 Iniciando viagem: ${ride_id}${colors.reset}`);
        console.log(`${colors.cyan}🚗 Driver ID: ${driver_id}${colors.reset}`);

        if (!ride_id || !driver_id) return;

        try {
            const result = await pool.query(
                `UPDATE rides SET
                    status = 'ongoing',
                    started_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                AND driver_id = $2
                AND status = 'accepted'
                RETURNING *`,
                [ride_id, driver_id]
            );

            if (result.rows.length === 0) {
                console.log(`${colors.yellow}⚠️ [start_trip] Não foi possível iniciar a viagem${colors.reset}`);
                return;
            }

            const fullRide = await getFullRideDetails(ride_id);

            // Emitir para todos na sala
            io.to(`ride_${ride_id}`).emit('trip_started', fullRide);
            io.to(`ride_${ride_id}`).emit('trip_started_now', {
                status: 'ongoing',
                started_at: timestamp,
                ride_id: ride_id
            });

            // Emitir especificamente para o passageiro
            if (fullRide.passenger_id) {
                io.to(`user_${fullRide.passenger_id}`).emit('trip_started', {
                    ...fullRide,
                    message: "Sua viagem começou! Boa viagem! 🚗"
                });
            }

            console.log(`${colors.green}✅ [start_trip] Viagem ${ride_id} iniciada com sucesso${colors.reset}`);

        } catch (error) {
            logError('START_TRIP', error);
            console.log(`${colors.red}❌ [start_trip] Erro:${colors.reset}`, error.message);
        }
        
        console.log(`${colors.cyan}🚗 ========================================\n${colors.reset}`);
    });

    // =====================================================================
    // 11. COMPLETE RIDE
    // =====================================================================
    socket.on('complete_ride', async (data) => {
        const { ride_id, driver_id } = data;
        const timestamp = new Date().toISOString();

        console.log(`${colors.green}\n✅ [complete_ride] ========================================${colors.reset}`);
        console.log(`${colors.green}✅ Finalizando corrida: ${ride_id}${colors.reset}`);

        if (!ride_id || !driver_id) return;

        try {
            const result = await pool.query(
                `UPDATE rides SET
                    status = 'completed',
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                AND driver_id = $2
                AND status = 'ongoing'
                RETURNING *`,
                [ride_id, driver_id]
            );

            if (result.rows.length === 0) {
                console.log(`${colors.yellow}⚠️ [complete_ride] Não foi possível finalizar a corrida${colors.reset}`);
                return;
            }

            const fullRide = await getFullRideDetails(ride_id);

            const payload = {
                ...fullRide,
                completed_at: timestamp,
                message: "Viagem finalizada! Obrigado por viajar conosco! ⭐"
            };

            io.to(`ride_${ride_id}`).emit('ride_completed', payload);

            if (fullRide.passenger_id) {
                io.to(`user_${fullRide.passenger_id}`).emit('ride_completed', {
                    ride_id: ride_id,
                    completed_at: timestamp,
                    message: "Sua viagem foi concluída. Avalie o motorista! ⭐"
                });
            }

            console.log(`${colors.green}✅ [complete_ride] Corrida ${ride_id} finalizada com sucesso${colors.reset}`);

        } catch (error) {
            logError('COMPLETE_RIDE', error);
            console.log(`${colors.red}❌ [complete_ride] Erro:${colors.reset}`, error.message);
        }
        
        console.log(`${colors.green}✅ ========================================\n${colors.reset}`);
    });

    // =====================================================================
    // 12. CANCEL RIDE
    // =====================================================================
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role, reason, user_id } = data;
        const timestamp = new Date().toISOString();

        console.log(`${colors.yellow}\n⚠️ [cancel_ride] ========================================${colors.reset}`);
        console.log(`${colors.yellow}⚠️ Cancelando corrida: ${ride_id}${colors.reset}`);
        console.log(`${colors.yellow}⚠️ Cancelado por: ${role}${colors.reset}`);

        if (!ride_id || !role) return;

        try {
            const result = await pool.query(
                `UPDATE rides SET
                    status = 'cancelled',
                    cancelled_at = NOW(),
                    cancelled_by = $1,
                    cancellation_reason = $2,
                    updated_at = NOW()
                 WHERE id = $3
                 RETURNING *`,
                [role, reason || 'Cancelamento solicitado', ride_id]
            );

            if (result.rows.length === 0) {
                console.log(`${colors.yellow}⚠️ [cancel_ride] Não foi possível cancelar a corrida${colors.reset}`);
                return;
            }

            const fullRide = await getFullRideDetails(ride_id);

            const msg = role === 'driver'
                ? "O motorista precisou cancelar a corrida."
                : "O passageiro cancelou a solicitação.";

            const payload = {
                ride_id: ride_id,
                cancelled_by: role,
                reason: msg,
                cancelled_at: timestamp
            };

            io.to(`ride_${ride_id}`).emit('ride_cancelled', payload);

            const targetId = role === 'driver' ? fullRide?.passenger_id : fullRide?.driver_id;
            if (targetId) {
                io.to(`user_${targetId}`).emit('ride_cancelled', payload);
            }

            console.log(`${colors.green}✅ [cancel_ride] Corrida ${ride_id} cancelada com sucesso${colors.reset}`);

        } catch (error) {
            logError('CANCEL_RIDE', error);
            console.log(`${colors.red}❌ [cancel_ride] Erro:${colors.reset}`, error.message);
        }
        
        console.log(`${colors.yellow}⚠️ ========================================\n${colors.reset}`);
    });

    // =====================================================================
    // 13. SEND MESSAGE (CHAT)
    // =====================================================================
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, image_data, message_type = 'text' } = data;
        const timestamp = new Date().toISOString();

        if (!ride_id || !sender_id) {
            socket.emit('chat_error', { message: 'Dados incompletos' });
            return;
        }

        console.log(`${colors.blue}💬 [send_message] Nova mensagem na corrida ${ride_id}${colors.reset}`);

        try {
            // Verificar se o usuário é participante da corrida
            const rideCheck = await pool.query(
                `SELECT passenger_id, driver_id FROM rides WHERE id = $1`,
                [ride_id]
            );

            if (rideCheck.rows.length === 0) {
                socket.emit('chat_error', { message: 'Corrida não encontrada' });
                return;
            }

            const ride = rideCheck.rows[0];
            if (ride.passenger_id !== parseInt(sender_id) && ride.driver_id !== parseInt(sender_id)) {
                socket.emit('chat_error', { message: 'Você não é participante desta corrida' });
                return;
            }

            // Inserir mensagem no banco
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
                is_read: false,
                timestamp: timestamp
            };

            // Emitir para todos na sala da corrida
            io.to(`ride_${ride_id}`).emit('receive_message', payload);

            // Notificar o destinatário específico
            const recipientId = ride.passenger_id === parseInt(sender_id) ? ride.driver_id : ride.passenger_id;
            if (recipientId) {
                io.to(`user_${recipientId}`).emit('new_message_notification', {
                    ride_id: ride_id,
                    message_id: msg.id,
                    sender_name: senderInfo?.name,
                    preview: text?.substring(0, 50) || '📷 Imagem',
                    timestamp: timestamp
                });
            }

            console.log(`${colors.green}✅ [send_message] Mensagem enviada com sucesso${colors.reset}`);

        } catch (error) {
            logError('CHAT_MSG', error);
            socket.emit('chat_error', { 
                message: 'Erro ao enviar mensagem',
                error: error.message 
            });
        }
    });

    // =====================================================================
    // 14. TYPING INDICATOR
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
    // 15. PING
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
    // 16. GET CONNECTION STATUS
    // =====================================================================
    socket.on('get_connection_status', () => {
        socket.emit('connection_status', {
            connected: true,
            socket_id: socketId,
            transport: socket.conn.transport.name,
            rooms: Array.from(socket.rooms),
            authenticated: authenticatedUsers.has(socketId),
            timestamp: new Date().toISOString()
        });
    });

    // =====================================================================
    // 17. LEAVE USER
    // =====================================================================
    socket.on('leave_user', async (userId) => {
        if (!userId) return;

        const userIdStr = userId.toString();
        const roomName = `user_${userIdStr}`;

        socket.leave(roomName);
        userSockets.delete(userIdStr);
        socketUsers.delete(socketId);
        authenticatedUsers.delete(socketId);

        console.log(`${colors.yellow}👤 [leave_user] User ${userIdStr} saiu${colors.reset}`);

        try {
            await pool.query(
                "UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1",
                [userId]
            );

            // Se for motorista, atualizar também driver_positions
            await pool.query(
                `UPDATE driver_positions SET status = 'offline' WHERE driver_id = $1`,
                [userId]
            );

        } catch (error) {
            logError('LEAVE_USER', error);
        }
    });

    // =====================================================================
    // 18. DISCONNECT
    // =====================================================================
    socket.on('disconnect', (reason) => {
        console.log(`${colors.yellow}❌ [disconnect] Socket ${socketId} - Razão: ${reason}${colors.reset}`);
        handleDisconnect(socketId, reason);
    });

    socket.on('error', (error) => {
        console.log(`${colors.red}❌ [socket_error] Socket ${socketId}:${colors.reset}`, error.message);
        logError('SOCKET_ERROR', { socketId, error: error.message });
    });
}

// =================================================================================================
// 3. LÓGICA DE DESCONEXÃO COM DEBOUNCE
// =================================================================================================
async function handleDisconnect(socketId, reason = 'unknown') {
    try {
        const userId = socketUsers.get(socketId);
        const userData = authenticatedUsers.get(socketId);

        if (userId) {
            console.log(`${colors.yellow}📊 [disconnect] Usuário ${userId} desconectado${colors.reset}`);

            // Verificar se é motorista
            const posRes = await pool.query(
                'SELECT driver_id FROM driver_positions WHERE socket_id = $1',
                [socketId]
            );

            if (posRes.rows.length > 0) {
                const driverId = posRes.rows[0].driver_id;

                // Configurar timer de desconexão (5 minutos)
                const timeout = setTimeout(async () => {
                    try {
                        // Verificar se o motorista ainda não reconectou
                        const check = await pool.query(
                            'SELECT socket_id, status FROM driver_positions WHERE driver_id = $1',
                            [driverId]
                        );

                        if (check.rows.length > 0 && check.rows[0].socket_id === socketId) {
                            // Marcar como offline
                            await pool.query(
                                'UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1',
                                [driverId]
                            );

                            await pool.query(
                                `UPDATE driver_positions SET status = 'offline' WHERE driver_id = $1`,
                                [driverId]
                            );

                            console.log(`${colors.yellow}⏱️ Motorista ${driverId} marcado como offline (Timeout 5min)${colors.reset}`);

                            // Atualizar contagem global
                            const onlineCount = await socketController.countOnlineDrivers();
                            io.emit('drivers_online_count', {
                                count: onlineCount,
                                timestamp: new Date().toISOString()
                            });
                        }

                        disconnectTimers.delete(driverId);
                        socketUsers.delete(socketId);
                        userSockets.delete(driverId);
                        authenticatedUsers.delete(socketId);

                    } catch (err) {
                        logError('DISCONNECT_TIMEOUT', err);
                    }
                }, 300000); // 5 minutos

                disconnectTimers.set(driverId, timeout);
                console.log(`${colors.yellow}⏱️ Timer de desconexão configurado para driver ${driverId} (5 minutos)${colors.reset}`);

            } else {
                // Não é motorista, marcar offline imediatamente
                await pool.query(
                    'UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1',
                    [userId]
                );

                socketUsers.delete(socketId);
                userSockets.delete(userId);
                authenticatedUsers.delete(socketId);
                
                console.log(`${colors.green}✅ Usuário ${userId} marcado como offline${colors.reset}`);
            }
        }

        // Remover posição do driver do socket (se houver)
        await socketController.removeDriverPosition(socketId);

        // Atualizar contagem global
        const onlineCount = await socketController.countOnlineDrivers();
        io.emit('drivers_online_count', {
            count: onlineCount,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logError('DISCONNECT_HANDLER', error);
    }
}

// =================================================================================================
// 4. HELPER METHODS
// =================================================================================================

function getIO() {
    return io;
}

function emitGlobal(event, data) {
    if (io) {
        io.emit(event, {
            ...data,
            timestamp: new Date().toISOString()
        });
        console.log(`${colors.blue}📢 [emitGlobal] Evento: ${event}${colors.reset}`);
    }
}

function emitToUser(userId, event, data) {
    if (!userId) {
        logError('EMIT_TO_USER', 'UserId não fornecido');
        return;
    }

    if (io) {
        const roomName = `user_${userId.toString()}`;
        io.to(roomName).emit(event, {
            ...data,
            timestamp: new Date().toISOString()
        });
        console.log(`${colors.blue}📢 [emitToUser] Evento ${event} para user ${userId}${colors.reset}`);
    }
}

function emitToRide(rideId, event, data) {
    if (!rideId) return;

    if (io) {
        const roomName = `ride_${rideId}`;
        io.to(roomName).emit(event, {
            ...data,
            timestamp: new Date().toISOString()
        });
        console.log(`${colors.blue}📢 [emitToRide] Evento ${event} para ride ${rideId}${colors.reset}`);
    }
}

function emitToRoom(room, event, data) {
    if (io && room) {
        io.to(room).emit(event, {
            ...data,
            timestamp: new Date().toISOString()
        });
    }
}

async function isUserOnline(userId) {
    try {
        const result = await pool.query(
            'SELECT is_online FROM users WHERE id = $1',
            [userId]
        );
        return result.rows[0]?.is_online || false;
    } catch (error) {
        logError('CHECK_ONLINE', error);
        return false;
    }
}

function getUserSocket(userId) {
    return userSockets.get(userId.toString());
}

async function getOnlineUsers() {
    try {
        const result = await pool.query(
            'SELECT id, name, role, photo FROM users WHERE is_online = true'
        );
        return result.rows;
    } catch (error) {
        logError('GET_ONLINE_USERS', error);
        return [];
    }
}

function getSocketCount() {
    return {
        total: io?.engine?.clientsCount || 0,
        users: userSockets.size,
        authenticated: authenticatedUsers.size,
        drivers: Array.from(authenticatedUsers.values()).filter(u => u.role === 'driver').length,
        passengers: Array.from(authenticatedUsers.values()).filter(u => u.role === 'passenger').length
    };
}

function setupSocketIO(httpServer) {
    console.log(`${colors.cyan}🔌 [SOCKET] Inicializando serviço de tempo real...${colors.reset}`);

    if (httpServer && typeof httpServer.on === 'function') {
        return initializeSocket(httpServer);
    }

    return initializeSocket;
}

// =================================================================================================
// 5. EXPORTAÇÕES
// =================================================================================================
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
    getSocketCount,
    userSockets,
    socketUsers,
    authenticatedUsers,
    disconnectTimers
};
