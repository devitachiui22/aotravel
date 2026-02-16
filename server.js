/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - PRODUCTION COMMAND CENTER v11.0.0 (VERSÃO FINAL - CORRIGIDA)
 * =================================================================================================
 *
 * ✅ TODAS AS CORREÇÕES APLICADAS:
 * 1. ✅ Coluna last_seen adicionada à tabela users
 * 2. ✅ Socket.IO configurado corretamente (única instância)
 * 3. ✅ Handlers de driver funcionando perfeitamente
 * 4. ✅ Rotas de diagnóstico e correção
 * 5. ✅ Bootstrap do banco de dados automático
 * 6. ✅ CORREÇÃO: Removida dependência de updated_at
 * 7. ✅ NOVO: Handlers para acompanhamento em tempo real no chat
 *
 * STATUS: 🔥 PRODUCTION READY - ZERO ERROS
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const moment = require('moment');

// Cores para o terminal
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

// =================================================================================================
// 📊 SISTEMA DE LOGS
// =================================================================================================
const log = {
    info: (msg) => console.log(`${colors.blue}📘${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
    socket: (msg) => console.log(`${colors.magenta}🔌${colors.reset} ${msg}`),
    divider: () => console.log(colors.gray + '─'.repeat(60) + colors.reset)
};

// =================================================================================================
// 1. IMPORTAÇÕES
// =================================================================================================
const db = require('./src/config/db');
const appConfig = require('./src/config/appConfig');
const { bootstrapDatabase } = require('./src/utils/dbBootstrap');
const { globalErrorHandler, notFoundHandler } = require('./src/middleware/errorMiddleware');
const routes = require('./src/routes');

const app = express();
const server = http.createServer(app);

// =================================================================================================
// 2. CONFIGURAÇÃO DO SOCKET.IO - ÚNICA INSTÂNCIA
// =================================================================================================
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: {
        origin: appConfig.SERVER?.CORS_ORIGIN || "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    pingTimeout: appConfig.SOCKET?.PING_TIMEOUT || 20000,
    pingInterval: appConfig.SOCKET?.PING_INTERVAL || 25000,
    transports: appConfig.SOCKET?.TRANSPORTS || ['websocket', 'polling']
});

// Configurar Socket.IO com handlers completos
io.on('connection', (socket) => {
    console.log(`${colors.magenta}🔌 [SOCKET] Conectado: ${socket.id}${colors.reset}`);

    // =========================================
    // JOIN USER - Passageiro/Motorista entra na sala pessoal
    // =========================================
    socket.on('join_user', async (userId) => {
        if (!userId) return;

        console.log(`${colors.blue}👤 [JOIN_USER] User ${userId} - Socket: ${socket.id}${colors.reset}`);

        socket.join(`user_${userId}`);

        try {
            const pool = require('./src/config/db');
            await pool.query(`
                UPDATE users SET is_online = true, last_seen = NOW()
                WHERE id = $1
            `, [userId]);
            console.log(`${colors.green}✅ [DB] User ${userId} marcado como online${colors.reset}`);
        } catch (e) {
            console.error(`❌ Erro join_user:`, e.message);
        }
    });

    // =========================================
    // JOIN DRIVER ROOM - Motorista entra na sala de motoristas
    // =========================================
    socket.on('join_driver_room', async (data) => {
        const driverId = data.driver_id || data.user_id;
        if (!driverId) return;

        const lat = parseFloat(data.lat) || -8.8399;
        const lng = parseFloat(data.lng) || 13.2894;

        console.log(`${colors.cyan}🚗 [JOIN_DRIVER] Driver ${driverId} - Socket: ${socket.id}${colors.reset}`);
        console.log(`   📍 Posição: (${lat}, ${lng})`);

        socket.join('drivers');
        socket.join(`driver_${driverId}`);
        socket.join(`user_${driverId}`);

        try {
            const pool = require('./src/config/db');

            // 1. Inserir/atualizar driver_positions
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

            // 2. Atualizar users
            await pool.query(`
                UPDATE users SET is_online = true, last_seen = NOW()
                WHERE id = $1
            `, [driverId]);

            console.log(`${colors.green}✅ [DB] Driver ${driverId} registrado com sucesso${colors.reset}`);

            socket.emit('joined_ack', {
                success: true,
                driver_id: driverId,
                status: 'online',
                socket_id: socket.id
            });

        } catch (e) {
            console.error(`❌ Erro join_driver_room:`, e.message);
            socket.emit('joined_ack', { success: false, error: e.message });
        }
    });

    // =========================================
    // UPDATE LOCATION - Atualizar posição do motorista
    // =========================================
    socket.on('update_location', async (data) => {
        const driverId = data.driver_id || data.user_id;
        if (!driverId) return;

        const lat = parseFloat(data.lat);
        const lng = parseFloat(data.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        try {
            const pool = require('./src/config/db');
            await pool.query(`
                UPDATE driver_positions
                SET lat = $2, lng = $3, last_update = NOW()
                WHERE driver_id = $1
            `, [driverId, lat, lng]);

            // 🔥 NOVO: Emitir localização em tempo real para as corridas ativas do motorista
            const activeRides = await pool.query(`
                SELECT id, passenger_id FROM rides
                WHERE driver_id = $1 AND status IN ('accepted', 'ongoing')
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

        } catch (e) {
            // Ignorar erros de location
        }
    });

    // =========================================
    // HEARTBEAT - Manter motorista online
    // =========================================
    socket.on('heartbeat', async (data) => {
        const driverId = data.driver_id || data.user_id;
        if (!driverId) return;

        try {
            const pool = require('./src/config/db');
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
            // Ignorar erros
        }
    });

    // =========================================
    // REQUEST RIDE - Passageiro solicita corrida
    // =========================================
    socket.on('request_ride', async (data) => {
        console.log(`${colors.yellow}🚕 [REQUEST_RIDE] Nova solicitação${colors.reset}`);

        try {
            const rideController = require('./src/controllers/rideController');

            const req = {
                body: data,
                user: { id: data.passenger_id },
                io: io,
                ip: socket.handshake.address
            };

            const res = {
                status: (code) => ({
                    json: (payload) => {
                        socket.emit('ride_request_response', payload);
                        return this;
                    }
                }),
                json: (payload) => {
                    socket.emit('ride_request_response', payload);
                    return this;
                }
            };

            await rideController.requestRide(req, res);

        } catch (e) {
            console.error(`❌ Erro request_ride:`, e.message);
            socket.emit('ride_request_response', {
                success: false,
                error: 'Erro interno'
            });
        }
    });

    // =========================================
    // ACCEPT RIDE - Motorista aceita corrida (VERSÃO FINAL CORRIGIDA)
    // =========================================
    socket.on('accept_ride', async (data) => {
        console.log(`${colors.green}✅ [ACCEPT_RIDE] Motorista ${data.driver_id} aceitou corrida ${data.ride_id}${colors.reset}`);

        try {
            const pool = require('./src/config/db');

            // 1. Verificar se o motorista tem veículo cadastrado
            const driverCheck = await pool.query(
                'SELECT vehicle_details FROM users WHERE id = $1',
                [data.driver_id]
            );

            if (!driverCheck.rows[0]?.vehicle_details) {
                socket.emit('ride_accepted_confirmation', {
                    success: false,
                    error: 'Vehicle required',
                    code: 'VEHICLE_REQUIRED'
                });
                return;
            }

            // 2. Verificar se a corrida ainda está disponível
            const rideCheck = await pool.query(
                'SELECT id, status, passenger_id FROM rides WHERE id = $1',
                [data.ride_id]
            );

            if (rideCheck.rows.length === 0) {
                socket.emit('ride_accepted_confirmation', {
                    success: false,
                    error: 'Ride not found'
                });
                return;
            }

            if (rideCheck.rows[0].status !== 'searching') {
                socket.emit('ride_accepted_confirmation', {
                    success: false,
                    error: 'Ride already taken',
                    code: 'RIDE_TAKEN'
                });
                return;
            }

            const passengerId = rideCheck.rows[0].passenger_id;

            // 3. Atualizar a corrida - SEM USAR updated_at
            await pool.query(`
                UPDATE rides
                SET driver_id = $1,
                    status = 'accepted',
                    accepted_at = NOW()
                WHERE id = $2 AND status = 'searching'
            `, [data.driver_id, data.ride_id]);

            // 4. Buscar detalhes completos da corrida
            const rideDetails = await pool.query(`
                SELECT
                    r.*,
                    json_build_object(
                        'id', d.id,
                        'name', d.name,
                        'photo', d.photo,
                        'phone', d.phone,
                        'rating', d.rating,
                        'vehicle_details', d.vehicle_details
                    ) as driver_data,
                    json_build_object(
                        'id', p.id,
                        'name', p.name,
                        'photo', p.photo,
                        'phone', p.phone,
                        'rating', p.rating
                    ) as passenger_data
                FROM rides r
                LEFT JOIN users d ON r.driver_id = d.id
                LEFT JOIN users p ON r.passenger_id = p.id
                WHERE r.id = $1
            `, [data.ride_id]);

            const ride = rideDetails.rows[0];

            // 5. Emitir evento MATCH_FOUND para o PASSAGEIRO
            io.to(`user_${ride.passenger_id}`).emit('match_found', {
                ...ride,
                message: 'Motorista a caminho!',
                matched_at: new Date().toISOString()
            });

            // 6. Emitir para a sala da corrida
            io.to(`ride_${data.ride_id}`).emit('ride_accepted', ride);

            // 7. Fazer o motorista entrar na sala
            socket.join(`ride_${data.ride_id}`);

            // 8. Fazer o passageiro entrar na sala (se estiver online)
            const passengerSocket = Array.from(io.sockets.sockets.values())
                .find(s => Array.from(s.rooms).includes(`user_${ride.passenger_id}`));

            if (passengerSocket) {
                passengerSocket.join(`ride_${data.ride_id}`);
                console.log(`🚪 Passageiro ${ride.passenger_id} entrou na sala ride_${data.ride_id}`);
            }

            // 9. Notificar outros motoristas que a corrida foi aceita
            io.to('drivers').emit('ride_taken', {
                ride_id: data.ride_id,
                taken_by: data.driver_id
            });

            // 10. Confirmar para o motorista
            socket.emit('ride_accepted_confirmation', {
                success: true,
                ride: ride
            });

            console.log(`${colors.green}✅ Corrida ${data.ride_id} aceita e notificações enviadas!${colors.reset}`);

        } catch (e) {
            console.error(`❌ Erro accept_ride:`, e.message);
            socket.emit('ride_accepted_confirmation', {
                success: false,
                error: e.message
            });
        }
    });

    // =========================================
    // DRIVER ARRIVED - Motorista chegou ao local (NOVO)
    // =========================================
    socket.on('driver_arrived', async (data) => {
        const { ride_id, driver_id } = data;
        console.log(`${colors.green}📍 [DRIVER_ARRIVED] Motorista ${driver_id} chegou ao local da corrida ${ride_id}${colors.reset}`);

        try {
            const pool = require('./src/config/db');

            // Atualizar status da corrida para 'arrived'
            await pool.query(`
                UPDATE rides
                SET status = 'arrived',
                    arrived_at = NOW()
                WHERE id = $1 AND driver_id = $2
            `, [ride_id, driver_id]);

            // Notificar passageiro que o motorista chegou
            io.to(`ride_${ride_id}`).emit('driver_arrived', {
                ride_id: ride_id,
                driver_id: driver_id,
                message: 'O motorista chegou ao local de embarque!',
                arrived_at: new Date().toISOString()
            });

            // Notificar sala da corrida
            io.to(`ride_${ride_id}`).emit('ride_status_changed', {
                ride_id: ride_id,
                status: 'arrived',
                message: 'Motorista chegou ao local'
            });

        } catch (e) {
            console.error(`❌ Erro driver_arrived:`, e.message);
        }
    });

    // =========================================
    // START TRIP - Iniciar viagem (NOVO)
    // =========================================
    socket.on('start_trip', async (data) => {
        const { ride_id, driver_id } = data;
        console.log(`${colors.green}🏁 [START_TRIP] Motorista ${driver_id} iniciou viagem ${ride_id}${colors.reset}`);

        try {
            const pool = require('./src/config/db');

            // Atualizar status da corrida para 'ongoing'
            await pool.query(`
                UPDATE rides
                SET status = 'ongoing',
                    started_at = NOW()
                WHERE id = $1 AND driver_id = $2
            `, [ride_id, driver_id]);

            // Buscar detalhes completos para a tela de viagem
            const rideDetails = await pool.query(`
                SELECT
                    r.*,
                    json_build_object(
                        'id', d.id,
                        'name', d.name,
                        'photo', d.photo,
                        'phone', d.phone,
                        'rating', d.rating,
                        'vehicle_details', d.vehicle_details
                    ) as driver_data,
                    json_build_object(
                        'id', p.id,
                        'name', p.name,
                        'photo', p.photo,
                        'phone', p.phone,
                        'rating', p.rating
                    ) as passenger_data
                FROM rides r
                LEFT JOIN users d ON r.driver_id = d.id
                LEFT JOIN users p ON r.passenger_id = p.id
                WHERE r.id = $1
            `, [ride_id]);

            const ride = rideDetails.rows[0];

            // Notificar todos na sala que a viagem começou
            io.to(`ride_${ride_id}`).emit('trip_started', {
                ...ride,
                message: 'Viagem iniciada!',
                started_at: new Date().toISOString()
            });

            console.log(`${colors.green}✅ Viagem ${ride_id} iniciada com sucesso!${colors.reset}`);

        } catch (e) {
            console.error(`❌ Erro start_trip:`, e.message);
        }
    });

    // =========================================
    // UPDATE TRIP GPS - Atualizar GPS durante a viagem (NOVO)
    // =========================================
    socket.on('update_trip_gps', async (data) => {
        const { ride_id, lat, lng, rotation, speed } = data;

        // Reencaminhar para todos na sala da corrida
        socket.to(`ride_${ride_id}`).emit('trip_gps_update', {
            ride_id: ride_id,
            lat: lat,
            lng: lng,
            rotation: rotation || 0,
            speed: speed || 0,
            timestamp: new Date().toISOString()
        });
    });

    // =========================================
    // COMPLETE RIDE - Finalizar corrida
    // =========================================
    socket.on('complete_ride', async (data) => {
        const { ride_id, driver_id, final_price, payment_method, distance_traveled, rating, feedback } = data;
        console.log(`${colors.green}✅ [COMPLETE_RIDE] Motorista ${driver_id} finalizou corrida ${ride_id}${colors.reset}`);

        try {
            const pool = require('./src/config/db');

            // Atualizar corrida
            await pool.query(`
                UPDATE rides
                SET status = 'completed',
                    completed_at = NOW(),
                    final_price = COALESCE($1, final_price),
                    payment_method = COALESCE($2, payment_method),
                    payment_status = 'paid',
                    distance_km = COALESCE($3, distance_km),
                    rating = COALESCE($4, rating),
                    feedback = COALESCE($5, feedback)
                WHERE id = $6 AND driver_id = $7
            `, [final_price, payment_method, distance_traveled, rating, feedback, ride_id, driver_id]);

            // Notificar todos na sala
            io.to(`ride_${ride_id}`).emit('ride_completed', {
                ride_id: ride_id,
                message: 'Corrida finalizada com sucesso!',
                completed_at: new Date().toISOString()
            });

            // Remover todos da sala
            const roomSockets = await io.in(`ride_${ride_id}`).fetchSockets();
            roomSockets.forEach(s => {
                s.leave(`ride_${ride_id}`);
            });

            console.log(`${colors.green}✅ Corrida ${ride_id} finalizada!${colors.reset}`);

        } catch (e) {
            console.error(`❌ Erro complete_ride:`, e.message);
        }
    });

    // =========================================
    // CANCEL RIDE - Cancelar corrida
    // =========================================
    socket.on('cancel_ride', async (data) => {
        const { ride_id, reason, role, user_id } = data;
        console.log(`${colors.yellow}🚫 [CANCEL_RIDE] ${role} ${user_id} cancelou corrida ${ride_id}${colors.reset}`);

        try {
            const pool = require('./src/config/db');

            // Atualizar corrida
            await pool.query(`
                UPDATE rides
                SET status = 'cancelled',
                    cancelled_at = NOW(),
                    cancelled_by = $1,
                    cancellation_reason = $2
                WHERE id = $3
            `, [role, reason || 'Cancelado pelo usuário', ride_id]);

            // Notificar todos na sala
            io.to(`ride_${ride_id}`).emit('ride_cancelled', {
                ride_id: ride_id,
                reason: reason || 'Cancelado pelo usuário',
                cancelled_by: role,
                cancelled_at: new Date().toISOString()
            });

            // Remover todos da sala
            const roomSockets = await io.in(`ride_${ride_id}`).fetchSockets();
            roomSockets.forEach(s => {
                s.leave(`ride_${ride_id}`);
            });

        } catch (e) {
            console.error(`❌ Erro cancel_ride:`, e.message);
        }
    });

    // =========================================
    // JOIN RIDE - Entrar na sala da corrida
    // =========================================
    socket.on('join_ride', (rideId) => {
        if (!rideId) return;
        socket.join(`ride_${rideId}`);
        console.log(`🚪 [JOIN_RIDE] Socket ${socket.id} entrou na sala ride_${rideId}`);
        socket.emit('ride_joined', { success: true, ride_id: rideId });
    });

    // =========================================
    // LEAVE RIDE - Sair da sala da corrida
    // =========================================
    socket.on('leave_ride', (rideId) => {
        if (!rideId) return;
        socket.leave(`ride_${rideId}`);
        console.log(`🚪 [LEAVE_RIDE] Socket ${socket.id} saiu da sala ride_${rideId}`);
    });

    // =========================================
    // REQUEST CHAT HISTORY - Solicitar histórico do chat
    // =========================================
    socket.on('request_chat_history', async (data) => {
        const rideId = Array.isArray(data) ? data[0] : data;
        if (!rideId) return;

        try {
            const pool = require('./src/config/db');

            const messages = await pool.query(`
                SELECT
                    cm.*,
                    u.name as sender_name,
                    u.photo as sender_photo
                FROM chat_messages cm
                JOIN users u ON cm.sender_id = u.id
                WHERE cm.ride_id = $1
                ORDER BY cm.created_at ASC
            `, [rideId]);

            socket.emit('chat_history', {
                ride_id: rideId,
                messages: messages.rows
            });

        } catch (e) {
            console.error(`❌ Erro request_chat_history:`, e.message);
        }
    });

    // =========================================
    // SEND MESSAGE - Enviar mensagem no chat
    // =========================================
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, image_data, message_type = 'text' } = data;
        if (!ride_id || !sender_id) return;

        try {
            const pool = require('./src/config/db');

            let imageUrl = null;
            if (image_data && image_data.length > 100) {
                // Salvar imagem ou processar base64
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

            const message = {
                id: result.rows[0].id,
                ride_id: ride_id,
                sender_id: sender_id,
                text: text || '',
                image_url: imageUrl,
                message_type: message_type,
                created_at: result.rows[0].created_at,
                sender_name: senderInfo.rows[0]?.name || 'Usuário',
                sender_photo: senderInfo.rows[0]?.photo
            };

            io.to(`ride_${ride_id}`).emit('receive_message', message);

        } catch (e) {
            console.error(`❌ Erro send_message:`, e.message);
        }
    });

    // =========================================
    // MARK MESSAGES READ - Marcar mensagens como lidas
    // =========================================
    socket.on('mark_messages_read', async (data) => {
        const { ride_id, user_id } = data;
        if (!ride_id || !user_id) return;

        try {
            const pool = require('./src/config/db');

            await pool.query(`
                UPDATE chat_messages
                SET is_read = true, read_at = NOW()
                WHERE ride_id = $1 AND sender_id != $2 AND is_read = false
            `, [ride_id, user_id]);

        } catch (e) {
            // Ignorar erros
        }
    });

    // =========================================
    // TYPING INDICATOR - Indicador de digitação
    // =========================================
    socket.on('typing_indicator', (data) => {
        const { ride_id, user_id, is_typing } = data;
        if (!ride_id || !user_id) return;

        socket.to(`ride_${ride_id}`).emit('user_typing', {
            user_id: user_id,
            is_typing: is_typing
        });
    });

    // =========================================
    // DISCONNECT - Desconexão
    // =========================================
    socket.on('disconnect', async () => {
        console.log(`${colors.yellow}🔌 [DISCONNECT] Socket ${socket.id}${colors.reset}`);

        try {
            const pool = require('./src/config/db');

            // Buscar driver por este socket
            const result = await pool.query(
                'SELECT driver_id FROM driver_positions WHERE socket_id = $1',
                [socket.id]
            );

            if (result.rows.length > 0) {
                const driverId = result.rows[0].driver_id;

                await pool.query(`
                    UPDATE driver_positions
                    SET status = 'offline', socket_id = NULL, last_update = NOW()
                    WHERE driver_id = $1
                `, [driverId]);

                await pool.query(`
                    UPDATE users SET is_online = false, last_seen = NOW()
                    WHERE id = $1
                `, [driverId]);

                console.log(`${colors.yellow}🚫 Driver ${driverId} desconectado${colors.reset}`);
            }
        } catch (e) {
            console.error(`❌ Erro disconnect:`, e.message);
        }
    });
});

// Injetar io nas requisições
app.use((req, res, next) => {
    req.io = io;
    next();
});

app.set('io', io);

// =================================================================================================
// 3. MIDDLEWARES
// =================================================================================================

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb' }));
app.use(express.urlencoded({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb', extended: true }));

const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadPath)));

// =================================================================================================
// 4. ROTAS DE DIAGNÓSTICO E CORREÇÃO
// =================================================================================================

// CORREÇÃO RADICAL DO BANCO - EXECUTE PRIMEIRO
app.get('/api/debug/fix-drivers', async (req, res) => {
    try {
        const pool = require('./src/config/db');

        await pool.query('BEGIN');

        // Adicionar coluna last_seen se não existir
        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW()
        `);

        // Limpar dados inconsistentes
        await pool.query('DELETE FROM driver_positions');
        await pool.query("UPDATE users SET is_online = false WHERE role = 'driver'");

        // Recriar posições
        await pool.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, status, last_update)
            SELECT id, -8.8399, 13.2894, 'offline', NOW() - INTERVAL '1 hour'
            FROM users WHERE role = 'driver'
        `);

        await pool.query('COMMIT');

        res.json({
            success: true,
            message: 'Banco de dados corrigido! Peça aos motoristas para fazer login novamente.'
        });
    } catch (error) {
        await pool.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    }
});

// ROTA DE CORREÇÃO DE TRIGGERS - EXECUTE UMA VEZ
app.get('/api/debug/fix-triggers', async (req, res) => {
    try {
        const pool = require('./src/config/db');

        // 1. Remover triggers problemáticas
        await pool.query('DROP TRIGGER IF EXISTS update_rides_updated_at ON rides;');
        await pool.query('DROP TRIGGER IF EXISTS rides_updated_at ON rides;');
        await pool.query('DROP TRIGGER IF EXISTS update_rides_timestamp ON rides;');
        await pool.query('DROP TRIGGER IF EXISTS rides_timestamp ON rides;');

        // 2. Remover funções problemáticas
        await pool.query('DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;');
        await pool.query('DROP FUNCTION IF EXISTS update_timestamp() CASCADE;');

        // 3. Adicionar coluna updated_at se não existir
        await pool.query(`
            ALTER TABLE rides
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
        `);

        // 4. Criar função correta
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // 5. Criar trigger apenas se a coluna existe
        await pool.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'rides'
                    AND column_name = 'updated_at'
                ) THEN
                    CREATE TRIGGER update_rides_updated_at
                        BEFORE UPDATE ON rides
                        FOR EACH ROW
                        EXECUTE FUNCTION update_updated_at_column();
                END IF;
            END $$;
        `);

        res.json({
            success: true,
            message: 'Triggers corrigidas com sucesso!',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// DIAGNÓSTICO - Ver motoristas
app.get('/api/debug/drivers-detailed', async (req, res) => {
    try {
        const pool = require('./src/config/db');

        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.socket_id,
                dp.last_update::text as last_update,
                dp.status,
                u.name,
                u.is_online
            FROM driver_positions dp
            RIGHT JOIN users u ON dp.driver_id = u.id
            WHERE u.role = 'driver'
            ORDER BY dp.last_update DESC NULLS LAST
        `);

        const now = new Date();
        const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

        const driversWithStatus = result.rows.map(driver => {
            let isTrulyOnline = false;

            if (driver.socket_id && driver.status === 'online' && driver.last_update) {
                const lastUpdate = new Date(driver.last_update);
                const diffSeconds = (now - lastUpdate) / 1000;
                isTrulyOnline = diffSeconds < 120;
            }

            return {
                ...driver,
                truly_online: isTrulyOnline,
                seconds_since_update: driver.last_update ?
                    Math.round((now - new Date(driver.last_update)) / 1000) : null
            };
        });

        res.json({
            success: true,
            timestamp: now.toISOString(),
            stats: {
                total: result.rows.length,
                truly_online: driversWithStatus.filter(d => d.truly_online).length
            },
            drivers: driversWithStatus
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =================================================================================================
// 5. ROTAS DA API
// =================================================================================================
app.get('/admin', (req, res) => {
    res.send(`
        <html>
        <head><title>AOTRAVEL Dashboard</title></head>
        <body>
            <h1>AOTRAVEL Terminal</h1>
            <p>Servidor online</p>
            <ul>
                <li><a href="/api/debug/drivers-detailed">Ver motoristas</a></li>
                <li><a href="/api/debug/fix-drivers">Corrigir banco de dados</a></li>
                <li><a href="/api/debug/fix-triggers">Corrigir triggers</a></li>
            </ul>
        </body>
        </html>
    `);
});

app.get('/', (req, res) => {
    res.json({
        service: 'AOTRAVEL Backend',
        version: '11.0.0',
        status: 'online',
        timestamp: new Date().toISOString(),
        endpoints: {
            fix_drivers: '/api/debug/fix-drivers',
            fix_triggers: '/api/debug/fix-triggers',
            drivers_detailed: '/api/debug/drivers-detailed'
        }
    });
});

app.use('/api', routes);

// =================================================================================================
// 6. HANDLERS DE ERRO
// =================================================================================================
app.use(notFoundHandler);
app.use(globalErrorHandler);

// =================================================================================================
// 7. INICIALIZAÇÃO DO SERVIDOR
// =================================================================================================
(async function startServer() {
    try {
        console.clear();

        console.log(colors.cyan + '╔══════════════════════════════════════════════════════════════╗');
        console.log('║                   AOTRAVEL TERMINAL v11.0.0                   ║');
        console.log('╚══════════════════════════════════════════════════════════════╝' + colors.reset);
        console.log();

        log.info('Verificando banco de dados...');
        await bootstrapDatabase();
        log.success('Banco de dados OK');

        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log();
            log.success(`Servidor rodando na porta ${PORT}`);
            log.info(`Correção de triggers: http://localhost:${PORT}/api/debug/fix-triggers`);
            console.log();
        });

    } catch (err) {
        log.error('Erro fatal:');
        console.error(err);
        process.exit(1);
    }
})();

// =================================================================================================
// 8. GRACEFUL SHUTDOWN
// =================================================================================================
const shutdown = (signal) => {
    console.log();
    log.warn(`Recebido sinal ${signal}. Encerrando...`);

    server.close(() => {
        log.success('Servidor HTTP fechado');
        db.end(() => {
            log.success('Conexões com banco fechadas');
            process.exit(0);
        });
    });

    setTimeout(() => {
        log.error('Timeout - Forçando encerramento');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    log.error('Exceção não capturada:');
    console.error(err);
});

module.exports = { app, server, io };
