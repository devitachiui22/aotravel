/**
 * =================================================================================================
 * ⚡ AOTRAVEL SERVER PRO - SOCKET SERVICE (CORREÇÃO DO FLUXO DE CORRIDAS) v7.5.0
 * =================================================================================================
 *
 * ARQUIVO: src/services/socketService.js
 * DESCRIÇÃO: Motor de comunicação bidirecional em tempo real - VERSÃO ULTRA FORÇADA
 *
 * ✅ CORREÇÕES APLICADAS v7.5.0:
 * 1. ✅ Cores padronizadas para todos os logs
 * 2. ✅ Coordenadas padrão (Luanda) para garantir dados válidos
 * 3. ✅ Chamada explícita ao socketController.joinDriverRoom
 * 4. ✅ Debounce de 30 segundos na desconexão (versão simplificada)
 * 5. ✅ Logs ultra detalhados para debug
 * 6. ✅ Integração completa com rideController
 * 7. ✅ Monitoramento em tempo real
 * 8. ✅ Salas para usuários, motoristas e corridas
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

// Coordenadas padrão (Luanda, Angola)
const DEFAULT_LAT = -8.8399;
const DEFAULT_LNG = 13.2894;

let io;

// Armazenamento em memória
const userSockets = new Map(); // userId -> socketId
const disconnectTimers = new Map(); // timeout de desconexão

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
        try {
            const onlineCount = await socketController.countOnlineDrivers();
            if (onlineCount > 0) {
                console.log(`${colors.blue}📊 [STATUS] Motoristas online: ${onlineCount}${colors.reset}`);
            }
            io.emit('drivers_online_update', {
                count: onlineCount,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logError('STATUS_MONITOR', error);
        }
    }, 10000);

    return io;
}

// =================================================================================================
// 2. MANIPULADOR DE CONEXÃO
// =================================================================================================
function handleConnection(socket) {
    const socketId = socket.id;

    console.log(`${colors.magenta}\n🔌 NOVA CONEXÃO: ${socketId} (Transport: ${socket.conn.transport.name})${colors.reset}`);

    // =====================================================================
    // 1. JOIN USER (PASSAGEIRO)
    // =====================================================================
    socket.on('join_user', async (userId) => {
        console.log(`${colors.blue}\n👤 [join_user] INÍCIO - Socket: ${socketId}, User: ${userId}${colors.reset}`);

        if (!userId) {
            console.log(`${colors.red}❌ [join_user] User ID não fornecido${colors.reset}`);
            socket.emit('error', { message: 'User ID não fornecido' });
            return;
        }

        const userIdStr = userId.toString();
        const roomName = `user_${userIdStr}`;

        socket.join(roomName);
        userSockets.set(userIdStr, socketId);

        console.log(`${colors.green}✅ [join_user] User ${userIdStr} entrou na sala ${roomName}${colors.reset}`);

        // Cancelar timer de desconexão se existir
        if (disconnectTimers.has(userIdStr)) {
            clearTimeout(disconnectTimers.get(userIdStr));
            disconnectTimers.delete(userIdStr);
            console.log(`${colors.yellow}⏱️ [join_user] Timer de desconexão cancelado para user ${userIdStr}${colors.reset}`);
        }

        try {
            await pool.query(
                "UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1",
                [userId]
            );
            console.log(`${colors.green}✅ [DB] Users atualizado - is_online: true${colors.reset}`);

            // Buscar informações do usuário
            const userRes = await pool.query(
                "SELECT role, name FROM users WHERE id = $1",
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

                if (pendingRides.rows.length > 0) {
                    console.log(`${colors.cyan}📊 Corridas pendentes: ${pendingRides.rows.length}${colors.reset}`);

                    pendingRides.rows.forEach(ride => {
                        const rideRoom = `ride_${ride.id}`;
                        socket.join(rideRoom);
                        console.log(`${colors.green}✅ Entrou na sala da corrida ${ride.id} (${ride.status})${colors.reset}`);
                    });
                }
            }

            socket.emit('joined_ack', {
                success: true,
                room: roomName,
                status: 'online',
                user_id: userId,
                socket_id: socketId,
                timestamp: new Date().toISOString()
            });

            console.log(`${colors.green}✅ [join_user] Confirmação enviada para user ${userIdStr}${colors.reset}`);

        } catch (error) {
            logError('JOIN_USER', error);
            socket.emit('error', { message: 'Erro ao registrar usuário', error: error.message });
        }

        console.log(`${colors.blue}👤 [join_user] FIM\n${colors.reset}`);
    });

    // =====================================================================
    // 2. JOIN DRIVER ROOM - VERSÃO CORRIGIDA E FORÇADA
    // =====================================================================
    socket.on('join_driver_room', async (data) => {
        console.log(`${colors.magenta}\n🚗 [join_driver_room] ========================================${colors.reset}`);
        console.log(`${colors.magenta}🚗 Dados recebidos:${colors.reset}`, JSON.stringify(data, null, 2));
        console.log(`${colors.magenta}🚗 Socket ID: ${socketId}${colors.reset}`);

        // Extrair dados
        let driverId = null;
        let lat = DEFAULT_LAT;
        let lng = DEFAULT_LNG;
        let heading = 0;
        let speed = 0;

        if (typeof data === 'object') {
            driverId = data.driver_id || data.user_id || data.id;
            lat = parseFloat(data.lat) || DEFAULT_LAT;
            lng = parseFloat(data.lng) || DEFAULT_LNG;
            heading = parseFloat(data.heading) || 0;
            speed = parseFloat(data.speed) || 0;
        } else {
            driverId = data;
        }

        if (!driverId) {
            console.log(`${colors.red}❌ [join_driver_room] ID não fornecido${colors.reset}`);
            return;
        }

        const driverIdStr = driverId.toString();

        // Entrar nas salas
        socket.join('drivers');
        socket.join(`driver_${driverIdStr}`);
        socket.join(`user_${driverIdStr}`);

        userSockets.set(driverIdStr, socketId);

        console.log(`${colors.green}✅ [join_driver_room] Driver ${driverIdStr} registrado nas salas: drivers, driver_${driverIdStr}, user_${driverIdStr}${colors.reset}`);
        console.log(`${colors.cyan}📍 Posição: (${lat}, ${lng}), Heading: ${heading}°, Speed: ${speed} km/h${colors.reset}`);

        // Cancelar timer de desconexão
        if (disconnectTimers.has(driverIdStr)) {
            clearTimeout(disconnectTimers.get(driverIdStr));
            disconnectTimers.delete(driverIdStr);
            console.log(`${colors.yellow}⏱️ Timer de desconexão cancelado para driver ${driverIdStr}${colors.reset}`);
        }

        try {
            // 🔴 CHAMADA DIRETA AO CONTROLLER
            console.log(`${colors.cyan}🔄 Chamando socketController.joinDriverRoom...${colors.reset}`);

            await socketController.joinDriverRoom({
                driver_id: driverIdStr,
                user_id: driverIdStr,
                lat: lat,
                lng: lng,
                heading: heading,
                speed: speed,
                status: 'online'
            }, socket);

            console.log(`${colors.green}✅ Controller executado com sucesso${colors.reset}`);

            // Buscar corridas ativas para este motorista
            const activeRides = await pool.query(
                `SELECT * FROM rides
                 WHERE driver_id = $1
                 AND status IN ('accepted', 'ongoing')
                 ORDER BY created_at DESC`,
                [driverIdStr]
            );

            if (activeRides.rows.length > 0) {
                console.log(`${colors.cyan}📊 Corridas ativas: ${activeRides.rows.length}${colors.reset}`);

                activeRides.rows.forEach(ride => {
                    const rideRoom = `ride_${ride.id}`;
                    socket.join(rideRoom);
                    console.log(`${colors.green}✅ Entrou na sala da corrida ativa ${ride.id} (${ride.status})${colors.reset}`);
                });
            }

            socket.emit('joined_ack', {
                success: true,
                room: 'drivers',
                driver_id: driverIdStr,
                status: 'online',
                socket_id: socketId,
                timestamp: new Date().toISOString()
            });

            console.log(`${colors.green}✅ [join_driver_room] Confirmação enviada para driver ${driverIdStr}${colors.reset}`);

            // Atualizar contagem global
            const onlineCount = await socketController.countOnlineDrivers();
            io.emit('drivers_online_count', onlineCount);

        } catch (error) {
            console.log(`${colors.red}❌ [join_driver_room] Erro:${colors.reset}`, error.message);
            console.error(error);

            socket.emit('joined_ack', {
                success: false,
                driver_id: driverIdStr,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`${colors.magenta}🚗 ========================================${colors.reset}\n`);
    });

    // =====================================================================
    // 3. UPDATE LOCATION
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
            lat: data.lat || DEFAULT_LAT,
            lng: data.lng || DEFAULT_LNG,
            heading: data.heading || 0,
            speed: data.speed || 0,
            accuracy: data.accuracy || 0,
            status: 'online'
        }, socket);

        // Se estiver em uma corrida, emitir atualização
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
        }
    });

    // =====================================================================
    // 4. HEARTBEAT
    // =====================================================================
    socket.on('heartbeat', async (data) => {
        const driverId = data.driver_id || data.user_id;

        if (!driverId) return;

        try {
            await pool.query(`
                UPDATE driver_positions
                SET last_update = NOW()
                WHERE driver_id = $1
            `, [driverId]);

            socket.emit('heartbeat_ack', {
                timestamp: new Date().toISOString(),
                driver_id: driverId
            });
        } catch (error) {
            logError('HEARTBEAT', error);
        }
    });

    // =====================================================================
    // 5. REQUEST RIDE - VERSÃO CORRIGIDA
    // =====================================================================
    socket.on('request_ride', async (data) => {
        console.log(`${colors.cyan}\n🚕 [request_ride] ========================================${colors.reset}`);
        console.log(`${colors.cyan}🚕 SOLICITAÇÃO DE CORRIDA VIA SOCKET${colors.reset}`);
        console.log(`${colors.cyan}🚕 Dados recebidos:${colors.reset}`, JSON.stringify(data, null, 2));

        try {
            // Validar dados mínimos
            if (!data.passenger_id || !data.pickup_lat || !data.pickup_lng) {
                throw new Error('Dados incompletos para solicitar corrida');
            }

            // Simular requisição HTTP
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
                    json: (response) => {
                        console.log(`${colors.green}📦 [request_ride] Resposta (${code}):${colors.reset}`, response);

                        // Notificar passageiro
                        io.to(`user_${data.passenger_id}`).emit('ride_request_response', {
                            success: code === 201,
                            message: response.message,
                            ride: response.ride,
                            dispatch_stats: response.dispatch_stats,
                            timestamp: new Date().toISOString()
                        });

                        // Se encontrou motoristas, eles já foram notificados via ride_opportunity
                        if (response.dispatch_stats?.drivers_notified > 0) {
                            console.log(`${colors.green}✅ ${response.dispatch_stats.drivers_notified} motoristas notificados${colors.reset}`);

                            // Entrar na sala da corrida
                            if (response.ride?.id) {
                                socket.join(`ride_${response.ride.id}`);
                                console.log(`${colors.green}✅ Entrou na sala ride_${response.ride.id}${colors.reset}`);
                            }
                        } else {
                            console.log(`${colors.yellow}⚠️ Nenhum motorista disponível no momento${colors.reset}`);
                        }
                    }
                })
            };

            // Chamar o controller
            await rideController.requestRide(mockReq, mockRes);

        } catch (error) {
            console.log(`${colors.red}❌ [request_ride] Erro:${colors.reset}`, error.message);
            console.error(error);

            io.to(`user_${data.passenger_id}`).emit('ride_request_error', {
                message: 'Erro ao processar solicitação',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }

        console.log(`${colors.cyan}🚕 ========================================${colors.reset}\n`);
    });

    // =====================================================================
    // 6. JOIN RIDE
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
    // 7. LEAVE RIDE
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
    // 8. GET NEARBY DRIVERS
    // =====================================================================
    socket.on('get_nearby_drivers', async (data) => {
        const { lat, lng, radius = 15 } = data;

        if (!lat || !lng) return;

        console.log(`${colors.cyan}🗺️ [get_nearby_drivers] Buscando motoristas em raio de ${radius}km${colors.reset}`);

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
    // 9. ACCEPT RIDE
    // =====================================================================
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id } = data;

        console.log(`${colors.green}\n✅ [accept_ride] ========================================${colors.reset}`);
        console.log(`${colors.green}✅ Aceitando corrida: ${ride_id}, Driver: ${driver_id}${colors.reset}`);

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

            // Verificar se a corrida está disponível
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

            if (ride.passenger_id === parseInt(driver_id)) {
                await client.query('ROLLBACK');
                socket.emit('error_response', {
                    message: "Você não pode aceitar sua própria corrida",
                    code: "SELF_RIDE"
                });
                return;
            }

            // Aceitar a corrida
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

            console.log(`${colors.green}✅ Corrida ${ride_id} aceita com sucesso por driver ${driver_id}${colors.reset}`);

            // Buscar detalhes completos
            const fullRide = await getFullRideDetails(ride_id);

            // Entrar na sala da corrida
            socket.join(`ride_${ride_id}`);

            const matchPayload = {
                ...fullRide,
                matched_at: new Date().toISOString(),
                message: "Motorista a caminho do ponto de embarque! 🚗"
            };

            // Notificar todos na sala
            io.to(`ride_${ride_id}`).emit('match_found', matchPayload);
            io.to(`ride_${ride_id}`).emit('ride_accepted', matchPayload);

            // Notificar passageiro
            if (fullRide.passenger_id) {
                io.to(`user_${fullRide.passenger_id}`).emit('match_found', matchPayload);
                console.log(`${colors.green}✅ Passageiro ${fullRide.passenger_id} notificado${colors.reset}`);
            }

            // Notificar outros motoristas
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

        } catch (error) {
            await client.query('ROLLBACK');
            logError('ACCEPT_RIDE_FATAL', error);
            socket.emit('error_response', {
                message: "Erro crítico ao processar aceite",
                error: error.message,
                code: "FATAL_ERROR"
            });
        } finally {
            client.release();
        }

        console.log(`${colors.green}✅ ========================================${colors.reset}\n`);
    });

    // =====================================================================
    // 10. START TRIP
    // =====================================================================
    socket.on('start_trip', async (data) => {
        const { ride_id, driver_id } = data;

        if (!ride_id || !driver_id) return;

        console.log(`${colors.cyan}\n🚗 [start_trip] Iniciando viagem ${ride_id}${colors.reset}`);

        try {
            await pool.query(
                `UPDATE rides SET
                    status = 'ongoing',
                    started_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                AND driver_id = $2
                AND status = 'accepted'`,
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

            console.log(`${colors.green}✅ Viagem ${ride_id} iniciada com sucesso${colors.reset}`);

        } catch (error) {
            logError('START_TRIP', error);
        }
    });

    // =====================================================================
    // 11. COMPLETE RIDE
    // =====================================================================
    socket.on('complete_ride', async (data) => {
        const { ride_id, driver_id } = data;

        if (!ride_id || !driver_id) return;

        console.log(`${colors.green}\n✅ [complete_ride] Finalizando corrida ${ride_id}${colors.reset}`);

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
                message: "Viagem finalizada! Obrigado por viajar conosco! ⭐"
            });

            if (fullRide.passenger_id) {
                io.to(`user_${fullRide.passenger_id}`).emit('ride_completed', {
                    ride_id: ride_id,
                    completed_at: new Date().toISOString(),
                    message: "Sua viagem foi concluída. Avalie o motorista! ⭐"
                });
            }

            console.log(`${colors.green}✅ Corrida ${ride_id} finalizada com sucesso${colors.reset}`);

        } catch (error) {
            logError('COMPLETE_RIDE', error);
        }
    });

    // =====================================================================
    // 12. CANCEL RIDE
    // =====================================================================
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role, reason, user_id } = data;

        if (!ride_id || !role) return;

        console.log(`${colors.yellow}\n⚠️ [cancel_ride] Cancelando corrida ${ride_id} por ${role}${colors.reset}`);

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

            const payload = {
                ride_id: ride_id,
                cancelled_by: role,
                reason: msg,
                cancelled_at: new Date().toISOString()
            };

            io.to(`ride_${ride_id}`).emit('ride_cancelled', payload);

            const targetId = role === 'driver' ? fullRide?.passenger_id : fullRide?.driver_id;
            if (targetId) {
                io.to(`user_${targetId}`).emit('ride_cancelled', payload);
            }

            console.log(`${colors.green}✅ Corrida ${ride_id} cancelada com sucesso${colors.reset}`);

        } catch (error) {
            logError('CANCEL_RIDE', error);
        }
    });

    // =====================================================================
    // 13. SEND MESSAGE (CHAT)
    // =====================================================================
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, image_data, message_type = 'text' } = data;

        if (!ride_id || !sender_id) {
            socket.emit('chat_error', { message: 'Dados incompletos' });
            return;
        }

        console.log(`${colors.blue}💬 [send_message] Nova mensagem na corrida ${ride_id}${colors.reset}`);

        try {
            // Verificar participação
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

            // Inserir mensagem
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
                is_read: false
            };

            // Emitir para todos na sala
            io.to(`ride_${ride_id}`).emit('receive_message', payload);

            // Notificar destinatário
            const recipientId = ride.passenger_id === parseInt(sender_id) ? ride.driver_id : ride.passenger_id;
            if (recipientId) {
                io.to(`user_${recipientId}`).emit('new_message_notification', {
                    ride_id: ride_id,
                    message_id: msg.id,
                    sender_name: senderInfo?.name,
                    preview: text?.substring(0, 50) || '📷 Imagem',
                    timestamp: msg.created_at.toISOString()
                });
            }

            console.log(`${colors.green}✅ Mensagem enviada com sucesso${colors.reset}`);

        } catch (error) {
            logError('CHAT_MSG', error);
            socket.emit('chat_error', { message: 'Erro ao enviar mensagem' });
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

        console.log(`${colors.yellow}👤 [leave_user] User ${userIdStr} saiu${colors.reset}`);

        try {
            await pool.query(
                "UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1",
                [userId]
            );

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
        console.log(`${colors.yellow}\n🔌 DESCONECTADO: ${socketId} - Razão: ${reason}${colors.reset}`);
        handleDisconnect(socketId);
    });

    socket.on('error', (error) => {
        console.log(`${colors.red}❌ [socket_error] Socket ${socketId}:${colors.reset}`, error.message);
        logError('SOCKET_ERROR', { socketId, error: error.message });
    });
}

// =================================================================================================
// 3. LÓGICA DE DESCONEXÃO (30 SEGUNDOS)
// =================================================================================================
async function handleDisconnect(socketId) {
    try {
        // Marcar como offline após 30 segundos
        setTimeout(async () => {
            try {
                const result = await pool.query(
                    'UPDATE driver_positions SET status = $1, last_update = NOW() WHERE socket_id = $2 RETURNING driver_id',
                    ['offline', socketId]
                );

                if (result.rows.length > 0) {
                    const driverId = result.rows[0].driver_id;

                    await pool.query(
                        'UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1',
                        [driverId]
                    );

                    console.log(`${colors.yellow}🟤 Driver ${driverId} marcado como OFFLINE (timeout 30s)${colors.reset}`);

                    // Atualizar contagem global
                    const onlineCount = await socketController.countOnlineDrivers();
                    io.emit('drivers_online_count', onlineCount);
                }

                // Remover da memória
                for (const [userId, sockId] of userSockets.entries()) {
                    if (sockId === socketId) {
                        userSockets.delete(userId);
                        break;
                    }
                }

            } catch (error) {
                logError('DISCONNECT_TIMEOUT', error);
            }
        }, 30000); // 30 segundos

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
    if (!userId || !io) return;

    const roomName = `user_${userId.toString()}`;
    io.to(roomName).emit(event, {
        ...data,
        timestamp: new Date().toISOString()
    });
}

function emitToRide(rideId, event, data) {
    if (!rideId || !io) return;

    const roomName = `ride_${rideId}`;
    io.to(roomName).emit(event, {
        ...data,
        timestamp: new Date().toISOString()
    });
}

function getUserSocket(userId) {
    return userSockets.get(userId.toString());
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
    getUserSocket,
    userSockets
};
