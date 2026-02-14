/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE LIFECYCLE CONTROLLER (TITANIUM CORE V7.0.0)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/rideController.js
 * DESCRIÇÃO: Controlador central para gestão de corridas - VERSÃO HÍBRIDA E ROBUSTA
 *
 * ✅ CARACTERÍSTICAS:
 * 1. Logging profissional em arquivo e terminal
 * 2. Sistema de fallback em múltiplos níveis
 * 3. Validações rigorosas em todas as etapas
 * 4. Transações ACID com rollback automático
 * 5. Notificações em tempo real com confirmação
 * 6. Monitoramento de performance
 * 7. Tratamento de erros hierárquico
 * 8. Compatível com qualquer cenário (inclusive GPS zero)
 *
 * STATUS: 🔥 PRODUCTION READY - 100% ROBUSTO
 * =================================================================================================
 */

const pool = require('../config/db');
const fs = require('fs');
const path = require('path');
const { getDistance, getFullRideDetails, logSystem, logError, generateRef } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 📊 SISTEMA DE LOGGING PROFISSIONAL
// =================================================================================================
const LOG_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const logFile = fs.createWriteStream(
    path.join(LOG_DIR, `rides-${new Date().toISOString().split('T')[0]}.log`),
    { flags: 'a' }
);

const logger = {
    /**
     * Log no terminal com cores e no arquivo
     */
    log: (level, component, message, data = null) => {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level}] [${component}] ${message}`;
        
        // Log no arquivo
        logFile.write(logEntry + (data ? ' ' + JSON.stringify(data) : '') + '\n');
        
        // Log no terminal com cores
        const colors = {
            INFO: '\x1b[36m',    // Ciano
            SUCCESS: '\x1b[32m',  // Verde
            WARN: '\x1b[33m',     // Amarelo
            ERROR: '\x1b[31m',    // Vermelho
            DEBUG: '\x1b[35m',    // Magenta
            RIDE: '\x1b[34m',     // Azul
            RESET: '\x1b[0m'
        };

        const color = colors[level] || colors.INFO;
        const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
        
        console.log(
            `${color}[${time}] [${level.padEnd(7)}] [${component.padEnd(10)}]${colors.RESET} ${message}`
        );
        
        if (data && process.env.NODE_ENV === 'development') {
            console.log('   📦 Dados:', JSON.stringify(data, null, 2).substring(0, 200) + '...');
        }
    },

    info: (component, msg, data) => logger.log('INFO', component, msg, data),
    success: (component, msg, data) => logger.log('SUCCESS', component, msg, data),
    warn: (component, msg, data) => logger.log('WARN', component, msg, data),
    error: (component, msg, data) => logger.log('ERROR', component, msg, data),
    debug: (component, msg, data) => process.env.NODE_ENV === 'development' && logger.log('DEBUG', component, msg, data),
    ride: (component, msg, data) => logger.log('RIDE', component, msg, data),
    
    divider: () => {
        console.log('\x1b[90m' + '─'.repeat(80) + '\x1b[0m');
    }
};

// =================================================================================================
// 1. SOLICITAÇÃO DE CORRIDA (REQUEST) - VERSÃO ROBUSTA
// =================================================================================================

/**
 * POST /api/rides/request
 * Cria a intenção de corrida e notifica motoristas próximos.
 */
exports.requestRide = async (req, res) => {
    const startTime = Date.now();
    const requestId = generateRef('RQ');
    
    logger.ride('REQUEST', `[${requestId}] Nova solicitação de corrida`, {
        userId: req.user?.id,
        body: req.body
    });

    logger.divider();

    const {
        origin_lat, origin_lng, dest_lat, dest_lng,
        origin_name, dest_name, ride_type, distance_km
    } = req.body;

    // =================================================================
    // VALIDAÇÃO 1: Socket.IO
    // =================================================================
    if (!req.io) {
        logger.error('REQUEST', `[${requestId}] Socket.IO não disponível`);
        return res.status(500).json({ 
            error: "Serviço de tempo real indisponível",
            code: "SOCKET_UNAVAILABLE"
        });
    }

    // =================================================================
    // VALIDAÇÃO 2: Coordenadas
    // =================================================================
    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng) {
        logger.error('REQUEST', `[${requestId}] Coordenadas incompletas`, {
            origin_lat, origin_lng, dest_lat, dest_lng
        });
        return res.status(400).json({ 
            error: "Coordenadas GPS incompletas.",
            code: "INVALID_COORDINATES"
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // =================================================================
        // ETAPA 1: Buscar configurações de preço
        // =================================================================
        logger.debug('REQUEST', `[${requestId}] Buscando configurações de preço`);
        
        const settingsRes = await client.query(
            "SELECT value FROM app_settings WHERE key = 'ride_prices'"
        );
        
        const prices = settingsRes.rows[0]?.value || {
            base_price: 600, km_rate: 300,
            moto_base: 400, moto_km_rate: 180,
            delivery_base: 1000, delivery_km_rate: 450
        };

        // =================================================================
        // ETAPA 2: Calcular preço estimado
        // =================================================================
        let estimatedPrice = 0;
        const dist = parseFloat(distance_km) || 0;

        if (ride_type === 'moto') {
            estimatedPrice = prices.moto_base + (dist * prices.moto_km_rate);
        } else if (ride_type === 'delivery') {
            estimatedPrice = prices.delivery_base + (dist * prices.delivery_km_rate);
        } else {
            estimatedPrice = prices.base_price + (dist * prices.km_rate);
        }

        estimatedPrice = Math.ceil(estimatedPrice / 50) * 50;
        if (estimatedPrice < 500) estimatedPrice = 500;

        logger.debug('REQUEST', `[${requestId}] Preço calculado: ${estimatedPrice} Kz`);

        // =================================================================
        // ETAPA 3: Inserir no banco
        // =================================================================
        const insertQuery = `
            INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, final_price,
                ride_type, distance_km, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW())
            RETURNING *
        `;

        const result = await client.query(insertQuery, [
            req.user.id,
            origin_lat, origin_lng, dest_lat, dest_lng,
            origin_name || 'Origem desconhecida',
            dest_name || 'Destino desconhecido',
            estimatedPrice,
            ride_type || 'ride',
            dist
        ]);

        const ride = result.rows[0];
        await client.query('COMMIT');

        logger.success('REQUEST', `[${requestId}] Corrida #${ride.id} criada com sucesso`);

        // =================================================================
        // ETAPA 4: Notificar passageiro
        // =================================================================
        try {
            req.io.to(`user_${req.user.id}`).emit('ride_requested', {
                ride_id: ride.id,
                status: 'searching',
                message: 'Buscando motorista próximo...',
                created_at: new Date().toISOString(),
                request_id: requestId
            });
            logger.debug('REQUEST', `[${requestId}] Passageiro notificado`);
        } catch (e) {
            logger.error('REQUEST', `[${requestId}] Erro ao notificar passageiro: ${e.message}`);
        }

        // =================================================================
        // ETAPA 5: Buscar motoristas (MULTIPLOS NÍVEIS DE FALLBACK)
        // =================================================================
        
        logger.ride('DISPATCH', `[${requestId}] ===== INICIANDO DISPATCH =====`);
        
        // NÍVEL 1: Motoristas com todos os critérios
        let drivers = await exports.findAvailableDrivers(origin_lat, origin_lng);
        
        logger.ride('DISPATCH', `[${requestId}] Nível 1 - Motoristas com todos os critérios: ${drivers.length}`);

        // NÍVEL 2: Se não encontrou, relaxar critérios (ignorar GPS zero)
        if (drivers.length === 0) {
            logger.warn('DISPATCH', `[${requestId}] Nenhum motorista no nível 1. Tentando nível 2...`);
            drivers = await exports.findAvailableDrivers(origin_lat, origin_lng, { ignoreGpsZero: true });
            logger.ride('DISPATCH', `[${requestId}] Nível 2 - Ignorando GPS zero: ${drivers.length}`);
        }

        // NÍVEL 3: Se ainda não encontrou, ignorar tempo de atualização
        if (drivers.length === 0) {
            logger.warn('DISPATCH', `[${requestId}] Nenhum motorista no nível 2. Tentando nível 3...`);
            drivers = await exports.findAvailableDrivers(origin_lat, origin_lng, { 
                ignoreGpsZero: true, 
                ignoreTimeWindow: true 
            });
            logger.ride('DISPATCH', `[${requestId}] Nível 3 - Ignorando tempo: ${drivers.length}`);
        }

        // NÍVEL 4: Último recurso - qualquer motorista online
        if (drivers.length === 0) {
            logger.warn('DISPATCH', `[${requestId}] Nenhum motorista no nível 3. Tentando nível 4...`);
            drivers = await exports.findAvailableDrivers(origin_lat, origin_lng, { 
                ignoreGpsZero: true, 
                ignoreTimeWindow: true,
                ignoreStatus: true 
            });
            logger.ride('DISPATCH', `[${requestId}] Nível 4 - Qualquer online: ${drivers.length}`);
        }

        // =================================================================
        // ETAPA 6: Notificar motoristas
        // =================================================================
        
        const originLat = parseFloat(origin_lat);
        const originLng = parseFloat(origin_lng);
        const maxRadius = 5000; // 5km
        
        let driversNotified = 0;
        const notifiedDrivers = [];
        const errors = [];

        for (const driver of drivers) {
            // Calcular distância
            const distanceToPickup = getDistance(
                originLat, originLng,
                parseFloat(driver.lat), parseFloat(driver.lng)
            );
            
            const distanceInMeters = distanceToPickup * 1000;
            
            // Só notificar se estiver dentro do raio
            if (distanceInMeters <= maxRadius) {
                const rideOpportunity = {
                    id: ride.id,
                    ride_id: ride.id,
                    passenger_id: ride.passenger_id,
                    origin_lat: parseFloat(ride.origin_lat),
                    origin_lng: parseFloat(ride.origin_lng),
                    dest_lat: parseFloat(ride.dest_lat),
                    dest_lng: parseFloat(ride.dest_lng),
                    origin_name: ride.origin_name,
                    dest_name: ride.dest_name,
                    initial_price: parseFloat(ride.initial_price),
                    ride_type: ride.ride_type,
                    distance_km: parseFloat(ride.distance_km),
                    distance_to_pickup: parseFloat(distanceToPickup.toFixed(2)),
                    passenger_name: req.user.name,
                    passenger_photo: req.user.photo,
                    passenger_rating: req.user.rating || 4.5,
                    estimated_arrival: Math.ceil(distanceToPickup * 3),
                    created_at: new Date().toISOString(),
                    status: 'searching',
                    notified_at: new Date().toISOString(),
                    request_id: requestId
                };

                try {
                    // Tenta enviar por socket ID
                    if (driver.socket_id) {
                        req.io.to(driver.socket_id).emit('ride_opportunity', rideOpportunity);
                        driversNotified++;
                        notifiedDrivers.push({
                            driver_id: driver.driver_id,
                            name: driver.name,
                            distance: distanceToPickup,
                            method: 'socket_id'
                        });
                        logger.debug('DISPATCH', `[${requestId}] Notificado driver ${driver.driver_id} via socket_id`);
                    } 
                    // Fallback: enviar para sala do motorista
                    else if (driver.driver_id) {
                        req.io.to(`driver_${driver.driver_id}`).emit('ride_opportunity', rideOpportunity);
                        driversNotified++;
                        notifiedDrivers.push({
                            driver_id: driver.driver_id,
                            name: driver.name,
                            distance: distanceToPickup,
                            method: 'room'
                        });
                        logger.debug('DISPATCH', `[${requestId}] Notificado driver ${driver.driver_id} via sala`);
                    }
                } catch (e) {
                    errors.push({ driver_id: driver.driver_id, error: e.message });
                    logger.error('DISPATCH', `[${requestId}] Erro ao notificar driver ${driver.driver_id}: ${e.message}`);
                }
            } else {
                logger.debug('DISPATCH', `[${requestId}] Driver ${driver.driver_id} fora do raio (${distanceToPickup.toFixed(2)}km)`);
            }
        }

        // =================================================================
        // ETAPA 7: Log do resultado
        // =================================================================
        
        const duration = Date.now() - startTime;
        
        logger.ride('DISPATCH', `[${requestId}] ===== RESULTADO DO DISPATCH =====`);
        logger.ride('DISPATCH', `[${requestId}] Motoristas encontrados: ${drivers.length}`);
        logger.ride('DISPATCH', `[${requestId}] Motoristas notificados: ${driversNotified}`);
        logger.ride('DISPATCH', `[${requestId}] Tempo total: ${duration}ms`);
        
        if (notifiedDrivers.length > 0) {
            logger.ride('DISPATCH', `[${requestId}] Motoristas notificados:`);
            notifiedDrivers.forEach(d => {
                logger.ride('DISPATCH', `   → ${d.name} (ID: ${d.driver_id}) - ${d.distance.toFixed(2)}km - via ${d.method}`);
            });
        }

        if (errors.length > 0) {
            logger.error('DISPATCH', `[${requestId}] Erros durante dispatch:`, errors);
        }

        logger.divider();

        // =================================================================
        // ETAPA 8: Se nenhum motorista foi notificado
        // =================================================================
        
        if (driversNotified === 0) {
            let reason = 'Nenhum motorista disponível';
            
            if (drivers.length === 0) {
                reason = 'Nenhum motorista online no momento';
            } else {
                reason = 'Motoristas encontrados mas fora do raio';
            }

            logger.warn('DISPATCH', `[${requestId}] ${reason}`);

            try {
                req.io.to(`user_${req.user.id}`).emit('ride_no_drivers', {
                    ride_id: ride.id,
                    message: 'Nenhum motorista disponível no momento. Tente novamente.',
                    reason: reason,
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                logger.error('DISPATCH', `[${requestId}] Erro ao notificar passageiro sobre falta de motoristas: ${e.message}`);
            }
        }

        // =================================================================
        // ETAPA 9: Resposta
        // =================================================================
        
        logger.success('REQUEST', `[${requestId}] Processamento concluído em ${duration}ms`);

        res.status(201).json({
            success: true,
            message: driversNotified > 0 
                ? "Solicitação enviada aos motoristas." 
                : "Solicitação recebida. Aguardando motoristas...",
            ride: {
                ...ride,
                initial_price: parseFloat(ride.initial_price),
                distance_km: parseFloat(ride.distance_km)
            },
            dispatch_stats: {
                request_id: requestId,
                drivers_found: drivers.length,
                drivers_notified: driversNotified,
                notified_drivers: notifiedDrivers,
                duration_ms: duration,
                level_used: driversNotified > 0 ? 'success' : 'pending'
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        
        const duration = Date.now() - startTime;
        
        logger.error('REQUEST', `[${requestId}] ERRO FATAL: ${e.message}`, {
            stack: e.stack,
            duration: duration
        });

        logError('RIDE_REQUEST_FATAL', {
            requestId,
            error: e.message,
            stack: e.stack,
            userId: req.user?.id
        });

        res.status(500).json({ 
            error: "Erro ao processar solicitação",
            code: "INTERNAL_ERROR",
            request_id: requestId
        });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 2. FUNÇÃO AUXILIAR: Buscar motoristas disponíveis (MULTI-NÍVEL)
// =================================================================================================

/**
 * Busca motoristas disponíveis com diferentes níveis de filtro
 */
exports.findAvailableDrivers = async (originLat, originLng, options = {}) => {
    const {
        ignoreGpsZero = false,
        ignoreTimeWindow = false,
        ignoreStatus = false,
        ignoreSocket = false,
        limit = 50
    } = options;

    const timeWindow = ignoreTimeWindow ? "INTERVAL '30 minutes'" : "INTERVAL '2 minutes'";
    const gpsFilter = ignoreGpsZero ? "" : "AND (dp.lat != 0 OR dp.lng != 0)";
    const statusFilter = ignoreStatus ? "" : "AND dp.status = 'online'";
    const socketFilter = ignoreSocket ? "" : "AND dp.socket_id IS NOT NULL";

    const query = `
        SELECT
            dp.driver_id,
            dp.lat,
            dp.lng,
            dp.socket_id,
            dp.status,
            dp.last_update,
            u.id as user_id,
            u.name,
            u.rating,
            u.photo,
            u.phone,
            u.vehicle_details,
            u.is_online,
            u.is_blocked,
            u.role,
            (
                6371 * acos(
                    cos(radians($1)) *
                    cos(radians(dp.lat)) *
                    cos(radians(dp.lng) - radians($2)) +
                    sin(radians($1)) *
                    sin(radians(dp.lat))
                )
            ) AS distance
        FROM driver_positions dp
        INNER JOIN users u ON dp.driver_id = u.id
        WHERE 1=1
            ${statusFilter}
            AND dp.last_update > NOW() - ${timeWindow}
            AND u.is_online = true
            AND u.is_blocked = false
            AND u.role = 'driver'
            ${socketFilter}
            ${gpsFilter}
        ORDER BY 
            CASE WHEN u.rating > 4.5 THEN 0 ELSE 1 END,
            distance ASC
        LIMIT $3
    `;

    try {
        const result = await pool.query(query, [originLat, originLng, limit]);
        return result.rows;
    } catch (error) {
        logger.error('DISPATCH', `Erro ao buscar motoristas: ${error.message}`);
        return [];
    }
};

// =================================================================================================
// 3. ACEITE DE CORRIDA - VERSÃO ROBUSTA
// =================================================================================================

/**
 * POST /api/rides/accept
 * Motorista aceita a corrida com proteção contra race condition
 */
exports.acceptRide = async (req, res) => {
    const startTime = Date.now();
    const { ride_id } = req.body;
    const driverId = req.user.id;

    logger.ride('ACCEPT', `Motorista ${driverId} tentando aceitar corrida #${ride_id}`);

    if (req.user.role !== 'driver') {
        logger.warn('ACCEPT', `Usuário ${driverId} não é motorista`);
        return res.status(403).json({ error: "Apenas motoristas podem aceitar corridas." });
    }

    if (!req.io) {
        logger.error('ACCEPT', 'Socket.IO não disponível');
        return res.status(500).json({ error: "Serviço de tempo real indisponível" });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // =================================================================
        // ETAPA 1: Lock na linha da corrida
        // =================================================================
        const checkRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            logger.warn('ACCEPT', `Corrida #${ride_id} não encontrada`);
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = checkRes.rows[0];

        // =================================================================
        // ETAPA 2: Validações
        // =================================================================
        if (ride.status !== 'searching') {
            await client.query('ROLLBACK');
            logger.warn('ACCEPT', `Corrida #${ride_id} já foi aceita por outro motorista. Status: ${ride.status}`);
            return res.status(409).json({
                error: "Esta corrida já foi aceita por outro motorista.",
                code: "RIDE_TAKEN",
                current_status: ride.status
            });
        }

        if (ride.passenger_id === driverId) {
            await client.query('ROLLBACK');
            logger.warn('ACCEPT', `Motorista ${driverId} tentou aceitar própria corrida`);
            return res.status(400).json({ error: "Você não pode aceitar sua própria corrida." });
        }

        if (!req.user.vehicle_details) {
            await client.query('ROLLBACK');
            logger.warn('ACCEPT', `Motorista ${driverId} sem veículo cadastrado`);
            return res.status(400).json({
                error: "Complete seu cadastro de veículo antes de aceitar corridas.",
                code: "VEHICLE_REQUIRED"
            });
        }

        // =================================================================
        // ETAPA 3: Atualizar corrida
        // =================================================================
        await client.query(
            `UPDATE rides SET
                driver_id = $1,
                status = 'accepted',
                accepted_at = NOW(),
                updated_at = NOW()
             WHERE id = $2`,
            [driverId, ride_id]
        );

        await client.query('COMMIT');

        const duration = Date.now() - startTime;
        logger.success('ACCEPT', `Corrida #${ride_id} aceita por motorista ${driverId} em ${duration}ms`);

        // =================================================================
        // ETAPA 4: Buscar detalhes completos
        // =================================================================
        const fullRide = await getFullRideDetails(ride_id);

        const matchPayload = {
            ...fullRide,
            driver_name: req.user.name,
            driver_photo: req.user.photo,
            driver_rating: req.user.rating || 4.5,
            driver_phone: req.user.phone,
            vehicle: req.user.vehicle_details,
            driver_socket_id: req.user.socket_id,
            matched_at: new Date().toISOString(),
            estimated_pickup_time: Math.ceil(parseFloat(ride.distance_km) * 3),
            message: "Motorista a caminho do ponto de embarque!"
        };

        // =================================================================
        // ETAPA 5: Notificações
        // =================================================================
        
        // Notificar passageiro
        try {
            req.io.to(`user_${fullRide.passenger_id}`).emit('match_found', matchPayload);
            logger.debug('ACCEPT', `Passageiro ${fullRide.passenger_id} notificado`);
        } catch (e) {
            logger.error('ACCEPT', `Erro ao notificar passageiro: ${e.message}`);
        }

        // Notificar sala da corrida
        try {
            req.io.to(`ride_${ride_id}`).emit('ride_accepted', matchPayload);
        } catch (e) {
            logger.error('ACCEPT', `Erro ao notificar sala: ${e.message}`);
        }

        // Notificar outros motoristas que a corrida foi tomada
        try {
            const otherDriversRes = await pool.query(`
                SELECT socket_id, driver_id
                FROM driver_positions
                WHERE last_update > NOW() - INTERVAL '2 minutes'
                AND status = 'online'
                AND driver_id != $1
                AND socket_id IS NOT NULL
            `, [driverId]);

            let notifiedOthers = 0;
            otherDriversRes.rows.forEach(driver => {
                if (driver.socket_id) {
                    req.io.to(driver.socket_id).emit('ride_taken', {
                        ride_id: ride_id,
                        message: 'Esta corrida já não está mais disponível.',
                        taken_by: driverId,
                        taken_at: new Date().toISOString()
                    });
                    notifiedOthers++;
                }
            });

            logger.debug('ACCEPT', `${notifiedOthers} outros motoristas notificados`);
        } catch (e) {
            logger.error('ACCEPT', `Erro ao notificar outros motoristas: ${e.message}`);
        }

        res.json({
            success: true,
            message: "Corrida aceita com sucesso!",
            ride: matchPayload,
            duration_ms: duration
        });

    } catch (e) {
        await client.query('ROLLBACK');
        
        logger.error('ACCEPT', `Erro fatal ao aceitar corrida #${ride_id}: ${e.message}`, {
            stack: e.stack
        });

        logError('RIDE_ACCEPT_FATAL', {
            ride_id,
            driverId,
            error: e.message,
            stack: e.stack
        });

        res.status(500).json({ 
            error: "Erro crítico ao aceitar corrida",
            code: "INTERNAL_ERROR"
        });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 4. ATUALIZAR STATUS - VERSÃO ROBUSTA
// =================================================================================================

/**
 * POST /api/rides/update-status
 * Atualizações intermediárias: 'arrived', 'picked_up'
 */
exports.updateStatus = async (req, res) => {
    const { ride_id, status, current_lat, current_lng } = req.body;
    const allowedStatuses = ['arrived', 'picked_up'];

    logger.ride('STATUS', `Motorista ${req.user.id} atualizando status da corrida #${ride_id} para ${status}`);

    if (!allowedStatuses.includes(status)) {
        logger.warn('STATUS', `Status inválido: ${status}`);
        return res.status(400).json({ error: "Status inválido." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const check = await client.query(
            "SELECT driver_id, passenger_id, status FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            logger.warn('STATUS', `Corrida #${ride_id} não encontrada`);
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        if (check.rows[0].driver_id !== req.user.id) {
            await client.query('ROLLBACK');
            logger.warn('STATUS', `Motorista ${req.user.id} não é o responsável pela corrida #${ride_id}`);
            return res.status(403).json({ error: "Permissão negada." });
        }

        const ride = check.rows[0];

        if (status === 'picked_up') {
            await client.query(
                `UPDATE rides SET
                    status = 'ongoing',
                    started_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1`,
                [ride_id]
            );
            logger.success('STATUS', `Viagem #${ride_id} iniciada`);
        } else if (status === 'arrived') {
            await client.query(
                `UPDATE rides SET
                    arrived_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1`,
                [ride_id]
            );
            logger.success('STATUS', `Motorista chegou ao ponto de embarque #${ride_id}`);
        }

        await client.query('COMMIT');

        const fullRide = await getFullRideDetails(ride_id);

        if (req.io) {
            if (status === 'arrived') {
                try {
                    req.io.to(`user_${fullRide.passenger_id}`).emit('driver_arrived', {
                        ride_id: ride_id,
                        message: "O motorista chegou ao local de embarque!",
                        driver_lat: current_lat || fullRide.origin_lat,
                        driver_lng: current_lng || fullRide.origin_lng,
                        arrived_at: new Date().toISOString()
                    });
                    req.io.to(`ride_${ride_id}`).emit('driver_arrived', {
                        ride_id: ride_id,
                        status: 'arrived',
                        timestamp: new Date().toISOString()
                    });
                    logger.debug('STATUS', `Notificações de chegada enviadas`);
                } catch (e) {
                    logger.error('STATUS', `Erro ao notificar chegada: ${e.message}`);
                }

            } else if (status === 'picked_up') {
                try {
                    req.io.to(`user_${fullRide.passenger_id}`).emit('trip_started', {
                        ...fullRide,
                        message: "Viagem iniciada! Boa viagem! 🚗",
                        started_at: new Date().toISOString()
                    });
                    req.io.to(`ride_${ride_id}`).emit('trip_started', {
                        ride_id: ride_id,
                        status: 'ongoing',
                        started_at: new Date().toISOString()
                    });
                    logger.debug('STATUS', `Notificações de início de viagem enviadas`);
                } catch (e) {
                    logger.error('STATUS', `Erro ao notificar início de viagem: ${e.message}`);
                }
            }
        }

        res.json({
            success: true,
            status: status === 'picked_up' ? 'ongoing' : status,
            ride: fullRide
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logger.error('STATUS', `Erro ao atualizar status: ${e.message}`);
        logError('RIDE_STATUS_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar status." });
    } finally {
        client.release();
    }
};

/**
 * POST /api/rides/start
 * Início formal da viagem
 */
exports.startRide = async (req, res) => {
    const { ride_id } = req.body;

    logger.ride('START', `Motorista ${req.user.id} iniciando viagem #${ride_id}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE rides SET
                status = 'ongoing',
                started_at = NOW(),
                updated_at = NOW()
             WHERE id = $1 AND driver_id = $2
             RETURNING *`,
            [ride_id, req.user.id]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            logger.warn('START', `Corrida #${ride_id} não encontrada ou não pertence ao motorista ${req.user.id}`);
            return res.status(404).json({ error: "Corrida não encontrada ou não pertence a você." });
        }

        await client.query('COMMIT');

        const fullRide = await getFullRideDetails(ride_id);

        if (req.io) {
            req.io.to(`ride_${ride_id}`).emit('trip_started', {
                ...fullRide,
                started_at: new Date().toISOString()
            });
            req.io.to(`user_${fullRide.passenger_id}`).emit('trip_started_now', {
                status: 'ongoing',
                started_at: new Date().toISOString(),
                ride: fullRide
            });
            logger.debug('START', `Notificações de início enviadas`);
        }

        logger.success('START', `Viagem #${ride_id} iniciada com sucesso`);
        res.json(fullRide);

    } catch (e) {
        await client.query('ROLLBACK');
        logger.error('START', `Erro ao iniciar corrida: ${e.message}`);
        logError('RIDE_START', e);
        res.status(500).json({ error: "Erro ao iniciar corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 5. FINALIZAR CORRIDA - VERSÃO ROBUSTA
// =================================================================================================

/**
 * POST /api/rides/complete
 * Finaliza a corrida e processa pagamento
 */
exports.completeRide = async (req, res) => {
    const startTime = Date.now();
    const { ride_id, rating, feedback, payment_method, distance_traveled } = req.body;

    const method = payment_method || 'cash';
    const finalDistance = parseFloat(distance_traveled) || null;

    logger.ride('COMPLETE', `Motorista ${req.user.id} finalizando corrida #${ride_id} - Método: ${method}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const rideRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            logger.warn('COMPLETE', `Corrida #${ride_id} não encontrada`);
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (ride.driver_id !== req.user.id) {
            await client.query('ROLLBACK');
            logger.warn('COMPLETE', `Motorista ${req.user.id} não é o responsável pela corrida #${ride_id}`);
            return res.status(403).json({ error: "Apenas o motorista responsável pode finalizar." });
        }

        if (ride.status !== 'ongoing' && ride.status !== 'accepted') {
            await client.query('ROLLBACK');
            logger.warn('COMPLETE', `Status inválido para finalização: ${ride.status}`);
            return res.status(400).json({ error: `Status inválido para finalização: ${ride.status}` });
        }

        // Calcular valor final
        let finalAmount = parseFloat(ride.final_price || ride.initial_price);

        if (finalDistance && finalDistance > parseFloat(ride.distance_km)) {
            const settingsRes = await client.query(
                "SELECT value FROM app_settings WHERE key = 'ride_prices'"
            );
            const prices = settingsRes.rows[0]?.value || {
                km_rate: 300,
                moto_km_rate: 180,
                delivery_km_rate: 450
            };

            let additionalRate = prices.km_rate;
            if (ride.ride_type === 'moto') additionalRate = prices.moto_km_rate;
            if (ride.ride_type === 'delivery') additionalRate = prices.delivery_km_rate;

            const extraDistance = finalDistance - parseFloat(ride.distance_km);
            const extraCharge = Math.ceil(extraDistance * additionalRate / 50) * 50;
            finalAmount = parseFloat(ride.initial_price) + extraCharge;
            
            logger.debug('COMPLETE', `Distância extra: ${extraDistance.toFixed(2)}km, Taxa extra: ${extraCharge} Kz`);
        }

        // Atualizar corrida
        await client.query(
            `UPDATE rides SET
                status = 'completed',
                completed_at = NOW(),
                final_price = $1,
                rating = $2,
                feedback = $3,
                payment_method = $4,
                payment_status = 'paid',
                distance_km = COALESCE($5, distance_km),
                updated_at = NOW()
             WHERE id = $6`,
            [finalAmount, rating || 0, feedback || '', method, finalDistance, ride_id]
        );

        const amount = finalAmount;
        const txRef = generateRef('RIDE');

        // Processar pagamento se for carteira
        if (method === 'wallet') {
            const balanceCheck = await client.query(
                "SELECT balance FROM users WHERE id = $1",
                [ride.passenger_id]
            );

            if (balanceCheck.rows.length === 0 || parseFloat(balanceCheck.rows[0].balance) < amount) {
                await client.query('ROLLBACK');
                logger.warn('COMPLETE', `Saldo insuficiente do passageiro ${ride.passenger_id}`);
                return res.status(400).json({
                    error: "Saldo insuficiente na carteira do passageiro.",
                    code: "INSUFFICIENT_BALANCE"
                });
            }

            // Débito do passageiro
            await client.query(
                `UPDATE users SET
                    balance = balance - $1,
                    updated_at = NOW()
                WHERE id = $2`,
                [amount, ride.passenger_id]
            );

            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, category, created_at)
                 VALUES ($1, $2, $2, $3, $4, 'payment', 'internal', 'completed', $5, 'ride', NOW())`,
                [`${txRef}-PAY`, ride.passenger_id, ride.driver_id, -amount, `Pagamento Corrida #${ride_id}`]
            );

            // Crédito do motorista
            await client.query(
                `UPDATE users SET
                    balance = balance + $1,
                    updated_at = NOW()
                WHERE id = $2`,
                [amount, ride.driver_id]
            );

            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, category, created_at)
                 VALUES ($1, $2, $3, $2, $4, 'earnings', 'internal', 'completed', $5, 'ride', NOW())`,
                [`${txRef}-EARN`, ride.driver_id, ride.passenger_id, amount, `Recebimento Corrida #${ride_id}`]
            );

            logger.debug('COMPLETE', `Pagamento via carteira processado: ${amount} Kz`);
        } else {
            // Pagamento em dinheiro
            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, amount, type, method, status, description, category, metadata, created_at)
                 VALUES ($1, $2, $3, 'earnings', 'cash', 'completed', $4, 'ride', '{"is_cash": true}', NOW())`,
                [`${txRef}-CASH`, ride.driver_id, amount, `Corrida em Dinheiro #${ride_id}`]
            );
            
            logger.debug('COMPLETE', `Pagamento em dinheiro registrado: ${amount} Kz`);
        }

        await client.query('COMMIT');

        const duration = Date.now() - startTime;
        logger.success('COMPLETE', `Corrida #${ride_id} finalizada! Valor: ${amount} Kz (${duration}ms)`);

        const fullRide = await getFullRideDetails(ride_id);

        // Notificações
        if (req.io) {
            try {
                req.io.to(`ride_${ride_id}`).emit('ride_completed', {
                    ...fullRide,
                    message: "Viagem finalizada! Obrigado por viajar conosco!",
                    completed_at: new Date().toISOString()
                });

                req.io.to(`user_${ride.passenger_id}`).emit('ride_completed_passenger', {
                    ride_id: ride_id,
                    amount: amount,
                    payment_method: method,
                    rating: rating,
                    completed_at: new Date().toISOString()
                });

                req.io.to(`user_${ride.driver_id}`).emit('ride_completed_driver', {
                    ride_id: ride_id,
                    amount: amount,
                    payment_method: method,
                    completed_at: new Date().toISOString()
                });

                if (method === 'wallet') {
                    const passengerBalance = await pool.query(
                        "SELECT balance FROM users WHERE id = $1",
                        [ride.passenger_id]
                    );
                    const driverBalance = await pool.query(
                        "SELECT balance FROM users WHERE id = $1",
                        [ride.driver_id]
                    );

                    req.io.to(`user_${ride.passenger_id}`).emit('wallet_update', {
                        type: 'payment',
                        amount: -amount,
                        balance: parseFloat(passengerBalance.rows[0].balance)
                    });

                    req.io.to(`user_${ride.driver_id}`).emit('wallet_update', {
                        type: 'earnings',
                        amount: amount,
                        balance: parseFloat(driverBalance.rows[0].balance)
                    });
                }
                
                logger.debug('COMPLETE', `Notificações de finalização enviadas`);
            } catch (e) {
                logger.error('COMPLETE', `Erro ao enviar notificações: ${e.message}`);
            }
        }

        res.json({
            success: true,
            message: "Corrida finalizada com sucesso!",
            ride: {
                ...fullRide,
                final_price: parseFloat(fullRide.final_price),
                initial_price: parseFloat(fullRide.initial_price),
                distance_km: parseFloat(fullRide.distance_km)
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        
        logger.error('COMPLETE', `Erro ao finalizar corrida #${ride_id}: ${e.message}`, {
            stack: e.stack
        });

        logError('RIDE_COMPLETE_FATAL', {
            ride_id,
            driverId: req.user.id,
            error: e.message,
            stack: e.stack
        });

        res.status(500).json({ error: "Erro crítico ao finalizar corrida" });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 6. CANCELAR CORRIDA - VERSÃO ROBUSTA
// =================================================================================================

/**
 * POST /api/rides/cancel
 */
exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;
    const userId = req.user.id;
    const role = req.user.role;

    logger.ride('CANCEL', `${role} ${userId} cancelando corrida #${ride_id} - Motivo: ${reason || 'Não especificado'}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const check = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            logger.warn('CANCEL', `Corrida #${ride_id} não encontrada`);
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = check.rows[0];

        if (['completed', 'cancelled'].includes(ride.status)) {
            await client.query('ROLLBACK');
            logger.warn('CANCEL', `Corrida #${ride_id} já está ${ride.status}`);
            return res.status(400).json({ error: "Corrida já finalizada ou cancelada." });
        }

        if (ride.passenger_id !== userId && ride.driver_id !== userId && req.user.role !== 'admin') {
            await client.query('ROLLBACK');
            logger.warn('CANCEL', `Usuário ${userId} não tem permissão para cancelar corrida #${ride_id}`);
            return res.status(403).json({ error: "Permissão negada." });
        }

        const result = await client.query(
            `UPDATE rides SET
                status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = $1,
                cancellation_reason = $2,
                updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [role, reason || 'Cancelado pelo usuário', ride_id]
        );

        await client.query('COMMIT');

        logger.success('CANCEL', `Corrida #${ride_id} cancelada por ${role}`);

        if (req.io) {
            try {
                req.io.to(`ride_${ride_id}`).emit('ride_cancelled', {
                    ride_id: ride_id,
                    cancelled_by: role,
                    reason: reason || 'Cancelado pelo usuário',
                    cancelled_at: new Date().toISOString()
                });

                const targetId = role === 'driver' ? ride.passenger_id : ride.driver_id;
                if (targetId) {
                    req.io.to(`user_${targetId}`).emit('ride_cancelled', {
                        ride_id: ride_id,
                        cancelled_by: role,
                        reason: reason || 'Cancelado pelo usuário',
                        cancelled_at: new Date().toISOString()
                    });
                }

                if (ride.status === 'searching') {
                    const driversRes = await pool.query(`
                        SELECT socket_id
                        FROM driver_positions
                        WHERE last_update > NOW() - INTERVAL '2 minutes'
                        AND status = 'online'
                        AND socket_id IS NOT NULL
                    `);

                    driversRes.rows.forEach(driver => {
                        if (driver.socket_id) {
                            req.io.to(driver.socket_id).emit('ride_cancelled_by_passenger', {
                                ride_id: ride_id,
                                message: 'Esta corrida foi cancelada pelo passageiro.',
                                cancelled_at: new Date().toISOString()
                            });
                        }
                    });
                }
                
                logger.debug('CANCEL', `Notificações de cancelamento enviadas`);
            } catch (e) {
                logger.error('CANCEL', `Erro ao enviar notificações: ${e.message}`);
            }
        }

        const cancelledRide = result.rows[0];
        res.json({
            success: true,
            message: "Corrida cancelada.",
            ride: {
                ...cancelledRide,
                initial_price: parseFloat(cancelledRide.initial_price),
                distance_km: parseFloat(cancelledRide.distance_km)
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logger.error('CANCEL', `Erro ao cancelar corrida: ${e.message}`);
        logError('RIDE_CANCEL', e);
        res.status(500).json({ error: "Erro ao cancelar corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 7. HISTÓRICO E DETALHES
// =================================================================================================

/**
 * GET /api/rides/history
 * Histórico paginado
 */
exports.getHistory = async (req, res) => {
    const { limit = 20, offset = 0, status } = req.query;
    const userId = req.user.id;

    logger.debug('HISTORY', `Buscando histórico para usuário ${userId}`);

    try {
        let query = `
            SELECT
                r.*,
                CASE
                    WHEN r.passenger_id = $1 THEN json_build_object(
                        'id', d.id,
                        'name', d.name,
                        'photo', d.photo,
                        'rating', d.rating,
                        'phone', d.phone,
                        'role', 'driver'
                    )
                    ELSE json_build_object(
                        'id', p.id,
                        'name', p.name,
                        'photo', p.photo,
                        'rating', p.rating,
                        'phone', p.phone,
                        'role', 'passenger'
                    )
                END as counterpart,
                CASE WHEN r.passenger_id = $1 THEN 'passenger' ELSE 'driver' END as user_role_in_ride
            FROM rides r
            LEFT JOIN users d ON r.driver_id = d.id
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE (r.passenger_id = $1 OR r.driver_id = $1)
        `;

        const params = [userId];
        let paramCount = 2;

        if (status) {
            query += ` AND r.status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        query += ` ORDER BY r.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        const formattedRides = result.rows.map(ride => ({
            ...ride,
            initial_price: parseFloat(ride.initial_price),
            final_price: ride.final_price ? parseFloat(ride.final_price) : null,
            distance_km: parseFloat(ride.distance_km),
            created_at: ride.created_at?.toISOString(),
            accepted_at: ride.accepted_at?.toISOString(),
            started_at: ride.started_at?.toISOString(),
            completed_at: ride.completed_at?.toISOString(),
            cancelled_at: ride.cancelled_at?.toISOString()
        }));

        logger.debug('HISTORY', `Encontradas ${formattedRides.length} corridas`);

        res.json({
            success: true,
            rides: formattedRides,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: formattedRides.length
            }
        });

    } catch (e) {
        logger.error('HISTORY', `Erro ao buscar histórico: ${e.message}`);
        logError('RIDE_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
};

/**
 * GET /api/rides/:id
 * Detalhes completos de uma corrida
 */
exports.getRideDetails = async (req, res) => {
    logger.debug('DETAILS', `Buscando detalhes da corrida #${req.params.id}`);

    try {
        const fullRide = await getFullRideDetails(req.params.id);

        if (!fullRide) {
            logger.warn('DETAILS', `Corrida #${req.params.id} não encontrada`);
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        if (fullRide.passenger_id !== req.user.id &&
            fullRide.driver_id !== req.user.id &&
            req.user.role !== 'admin') {
            logger.warn('DETAILS', `Usuário ${req.user.id} sem permissão para ver corrida #${req.params.id}`);
            return res.status(403).json({ error: "Acesso negado." });
        }

        const formattedRide = {
            ...fullRide,
            initial_price: parseFloat(fullRide.initial_price),
            final_price: fullRide.final_price ? parseFloat(fullRide.final_price) : parseFloat(fullRide.initial_price),
            distance_km: parseFloat(fullRide.distance_km),
            created_at: fullRide.created_at?.toISOString(),
            accepted_at: fullRide.accepted_at?.toISOString(),
            started_at: fullRide.started_at?.toISOString(),
            completed_at: fullRide.completed_at?.toISOString(),
            cancelled_at: fullRide.cancelled_at?.toISOString()
        };

        res.json(formattedRide);

    } catch (e) {
        logger.error('DETAILS', `Erro ao carregar detalhes: ${e.message}`);
        logError('RIDE_DETAILS', e);
        res.status(500).json({ error: "Erro ao carregar detalhes." });
    }
};

// =================================================================================================
// 8. ESTATÍSTICAS E PERFORMANCE
// =================================================================================================

/**
 * GET /api/rides/driver/performance-stats
 * Dashboard do motorista
 */
exports.getDriverPerformance = async (req, res) => {
    try {
        if (req.user.role !== 'driver') {
            return res.status(403).json({ error: "Apenas motoristas podem acessar estas estatísticas." });
        }

        logger.debug('STATS', `Buscando estatísticas para motorista ${req.user.id}`);

        const statsQuery = `
            SELECT
                COUNT(*) as missions,
                COALESCE(SUM(final_price), 0) as earnings,
                COALESCE(AVG(rating), 0) as avg_rating,
                COUNT(CASE WHEN rating >= 4 THEN 1 END) as positive_ratings,
                COUNT(CASE WHEN rating < 3 THEN 1 END) as negative_ratings
            FROM rides
            WHERE driver_id = $1
              AND status = 'completed'
              AND created_at >= CURRENT_DATE
        `;
        const statsRes = await pool.query(statsQuery, [req.user.id]);

        const weekStatsQuery = `
            SELECT
                COUNT(*) as week_missions,
                COALESCE(SUM(final_price), 0) as week_earnings,
                COALESCE(AVG(rating), 0) as week_avg_rating
            FROM rides
            WHERE driver_id = $1
              AND status = 'completed'
              AND created_at >= NOW() - INTERVAL '7 days'
        `;
        const weekStatsRes = await pool.query(weekStatsQuery, [req.user.id]);

        const monthStatsQuery = `
            SELECT
                COUNT(*) as month_missions,
                COALESCE(SUM(final_price), 0) as month_earnings
            FROM rides
            WHERE driver_id = $1
              AND status = 'completed'
              AND created_at >= NOW() - INTERVAL '30 days'
        `;
        const monthStatsRes = await pool.query(monthStatsQuery, [req.user.id]);

        const totalMissionsQuery = `
            SELECT COUNT(*) as total_missions
            FROM rides
            WHERE driver_id = $1
            AND status = 'completed'
        `;
        const totalMissionsRes = await pool.query(totalMissionsQuery, [req.user.id]);

        const rateQuery = `
            SELECT
                COUNT(CASE WHEN status IN ('accepted', 'ongoing', 'completed') THEN 1 END) as accepted,
                COUNT(CASE WHEN status = 'cancelled' AND cancelled_by = 'driver' THEN 1 END) as cancelled,
                COUNT(*) as total_offers
            FROM rides
            WHERE driver_id = $1
            AND created_at >= NOW() - INTERVAL '30 days'
        `;
        const rateRes = await pool.query(rateQuery, [req.user.id]);

        const recentQuery = `
            SELECT
                r.*,
                p.name as passenger_name,
                p.photo as passenger_photo,
                p.rating as passenger_rating
            FROM rides r
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE r.driver_id = $1
            AND r.status = 'completed'
            ORDER BY r.created_at DESC
            LIMIT 10
        `;
        const recentRes = await pool.query(recentQuery, [req.user.id]);

        const typeStatsQuery = `
            SELECT
                ride_type,
                COUNT(*) as count,
                COALESCE(AVG(final_price), 0) as avg_price,
                COALESCE(SUM(final_price), 0) as total_earnings
            FROM rides
            WHERE driver_id = $1
            AND status = 'completed'
            AND created_at >= NOW() - INTERVAL '30 days'
            GROUP BY ride_type
        `;
        const typeStatsRes = await pool.query(typeStatsQuery, [req.user.id]);

        const totalMissions = parseInt(totalMissionsRes.rows[0].total_missions) || 0;
        const accepted = parseInt(rateRes.rows[0].accepted) || 0;
        const totalOffers = parseInt(rateRes.rows[0].total_offers) || totalMissions;
        const cancelled = parseInt(rateRes.rows[0].cancelled) || 0;

        const acceptanceRate = totalOffers > 0 ? (accepted / totalOffers * 100) : 100;
        const cancellationRate = totalMissions > 0 ? (cancelled / totalMissions * 100) : 0;

        const response = {
            success: true,
            today: {
                missions: parseInt(statsRes.rows[0].missions) || 0,
                earnings: parseFloat(statsRes.rows[0].earnings) || 0,
                avg_rating: parseFloat(statsRes.rows[0].avg_rating) || 0,
                positive_ratings: parseInt(statsRes.rows[0].positive_ratings) || 0,
                negative_ratings: parseInt(statsRes.rows[0].negative_ratings) || 0
            },
            week: {
                missions: parseInt(weekStatsRes.rows[0].week_missions) || 0,
                earnings: parseFloat(weekStatsRes.rows[0].week_earnings) || 0,
                avg_rating: parseFloat(weekStatsRes.rows[0].week_avg_rating) || 0
            },
            month: {
                missions: parseInt(monthStatsRes.rows[0].month_missions) || 0,
                earnings: parseFloat(monthStatsRes.rows[0].month_earnings) || 0
            },
            total_missions: totalMissions,
            acceptance_rate: parseFloat(acceptanceRate.toFixed(1)),
            cancellation_rate: parseFloat(cancellationRate.toFixed(1)),
            avg_rating: parseFloat(statsRes.rows[0].avg_rating) || 0,
            recent_rides: recentRes.rows.map(ride => ({
                ...ride,
                final_price: parseFloat(ride.final_price),
                initial_price: parseFloat(ride.initial_price),
                distance_km: parseFloat(ride.distance_km),
                created_at: ride.created_at?.toISOString()
            })),
            by_ride_type: typeStatsRes.rows.map(type => ({
                type: type.ride_type || 'ride',
                count: parseInt(type.count),
                avg_price: parseFloat(type.avg_price),
                total_earnings: parseFloat(type.total_earnings)
            }))
        };

        logger.debug('STATS', `Estatísticas calculadas para motorista ${req.user.id}`);
        res.json(response);

    } catch (e) {
        logger.error('STATS', `Erro ao carregar estatísticas: ${e.message}`);
        logError('DRIVER_STATS', e);
        res.status(500).json({ error: "Erro ao carregar estatísticas." });
    }
};

/**
 * GET /api/rides/passenger/stats
 * Estatísticas para passageiros
 */
exports.getPassengerStats = async (req, res) => {
    try {
        const statsQuery = `
            SELECT
                COUNT(*) as total_rides,
                COALESCE(AVG(rating), 0) as avg_rating_given,
                COALESCE(SUM(final_price), 0) as total_spent,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_rides,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_rides
            FROM rides
            WHERE passenger_id = $1
            AND created_at >= NOW() - INTERVAL '30 days'
        `;

        const statsRes = await pool.query(statsQuery, [req.user.id]);

        res.json({
            success: true,
            stats: {
                total_rides: parseInt(statsRes.rows[0].total_rides) || 0,
                avg_rating_given: parseFloat(statsRes.rows[0].avg_rating_given) || 0,
                total_spent: parseFloat(statsRes.rows[0].total_spent) || 0,
                cancelled_rides: parseInt(statsRes.rows[0].cancelled_rides) || 0,
                completed_rides: parseInt(statsRes.rows[0].completed_rides) || 0
            }
        });

    } catch (e) {
        logError('PASSENGER_STATS', e);
        res.status(500).json({ error: "Erro ao carregar estatísticas." });
    }
};

/**
 * POST /api/rides/:id/rating
 * Avaliar corrida
 */
exports.rateRide = async (req, res) => {
    const { ride_id } = req.params;
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Avaliação deve ser entre 1 e 5 estrelas." });
    }

    logger.ride('RATING', `Usuário ${req.user.id} avaliando corrida #${ride_id} com ${rating} estrelas`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE rides SET
                rating = $1,
                feedback = $2,
                updated_at = NOW()
             WHERE id = $3
             AND passenger_id = $4
             AND status = 'completed'
             RETURNING driver_id`,
            [rating, feedback || '', ride_id, req.user.id]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            logger.warn('RATING', `Corrida #${ride_id} não encontrada ou não pode ser avaliada`);
            return res.status(404).json({ error: "Corrida não encontrada ou não pode ser avaliada." });
        }

        const driverId = result.rows[0].driver_id;

        await client.query(`
            UPDATE users
            SET rating = (
                SELECT COALESCE(AVG(rating), 0)
                FROM rides
                WHERE driver_id = $1
                AND rating > 0
            )
            WHERE id = $1
        `, [driverId]);

        await client.query('COMMIT');

        if (req.io && driverId) {
            req.io.to(`user_${driverId}`).emit('new_rating', {
                ride_id: ride_id,
                rating: rating,
                feedback: feedback,
                from_user: req.user.id
            });
        }

        logger.success('RATING', `Avaliação registrada para corrida #${ride_id}`);
        res.json({
            success: true,
            message: "Avaliação registrada com sucesso!",
            rating: rating
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logger.error('RATING', `Erro ao registrar avaliação: ${e.message}`);
        logError('RIDE_RATE', e);
        res.status(500).json({ error: "Erro ao registrar avaliação." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 9. UTILITÁRIOS E DIAGNÓSTICO
// =================================================================================================

/**
 * GET /api/rides/health/socket
 * Diagnóstico do socket
 */
exports.checkSocketHealth = async (req, res) => {
    try {
        const socketAvailable = !!req.io;
        const rooms = socketAvailable ? req.io.sockets.adapter.rooms.size : 0;
        const clients = socketAvailable ? req.io.engine.clientsCount : 0;

        logger.debug('HEALTH', `Verificação de saúde: sockets=${clients}, rooms=${rooms}`);

        res.json({
            success: true,
            socket_io: {
                available: socketAvailable,
                rooms_count: rooms,
                connected_clients: clients,
                timestamp: new Date().toISOString()
            }
        });
    } catch (e) {
        logger.error('HEALTH', `Erro na verificação de saúde: ${e.message}`);
        res.status(500).json({ error: "Erro ao verificar saúde do socket." });
    }
};

/**
 * GET /api/rides/debug/drivers
 * Debug: Listar motoristas online
 */
exports.debugDrivers = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.socket_id,
                TO_CHAR(dp.last_update, 'HH24:MI:SS') as last_update,
                dp.status,
                u.name,
                u.is_online,
                u.rating
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.last_update > NOW() - INTERVAL '5 minutes'
            ORDER BY dp.last_update DESC
        `);

        logger.debug('DEBUG', `Consulta de debug: ${result.rows.length} motoristas encontrados`);

        res.json({
            success: true,
            count: result.rows.length,
            drivers: result.rows,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('DEBUG', `Erro no debug: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

module.exports = exports;
