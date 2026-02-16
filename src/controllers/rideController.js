/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE LIFECYCLE CONTROLLER (TITANIUM CORE V9.0.0 - FINAL)
 * =================================================================================================
 *
 * ✅ CORREÇÕES APLICADAS:
 *   - Removida referência a "updated_at" em todas as queries que causavam erro
 *   - Queries otimizadas sem triggers problemáticas
 *   - Sistema de logging profissional integrado
 *   - Dispatch com níveis de raio progressivos
 *   - Notificações em tempo real completas
 *   - Gestão de pagamentos por carteira/dinheiro
 *   - Estatísticas e performance para motoristas
 *   - Avaliações e feedback
 *   - Cálculo de preços corrigido e sincronizado
 *   - Cálculo de distância corrigido usando a fórmula de Haversine
 */

const pool = require('../config/db');
const fs = require('fs');
const path = require('path');
const { logError, generateRef } = require('../utils/helpers');

// =================================================================================================
// 📊 SISTEMA DE LOGGING PROFISSIONAL
// =================================================================================================
const LOG_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const logFile = fs.createWriteStream(
    path.join(LOG_DIR, `rides-${new Date().toISOString().split('T')[0]}.log`),
    { flags: 'a' }
);

// Cores para Logs no Terminal
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m'
};

const logger = {
    log: (level, component, message, data = null) => {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level}] [${component}] ${message}`;
        logFile.write(logEntry + (data ? ' ' + JSON.stringify(data) : '') + '\n');

        const colorMap = {
            INFO: colors.cyan,
            SUCCESS: colors.green,
            WARN: colors.yellow,
            ERROR: colors.red,
            DEBUG: colors.magenta,
            RIDE: colors.blue
        };

        const color = colorMap[level] || colors.blue;
        const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });

        console.log(
            `${color}[${time}] [${level.padEnd(7)}] [${component.padEnd(10)}]${colors.reset} ${message}`
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
        console.log(colors.gray + '─'.repeat(80) + colors.reset);
    }
};

// =================================================================================================
// 1. FUNÇÃO AUXILIAR: Calcular distância entre dois pontos (Fórmula de Haversine)
// =================================================================================================
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distância em km
    return parseFloat(distance.toFixed(2));
}

// =================================================================================================
// 2. SOLICITAÇÃO DE CORRIDA (REQUEST)
// =================================================================================================

exports.requestRide = async (req, res) => {
    const startTime = Date.now();
    const requestId = generateRef('RQ');

    const body = req.body;
    const originLat = parseFloat(body.origin_lat || body.originLat);
    const originLng = parseFloat(body.origin_lng || body.originLng);
    const destLat = parseFloat(body.dest_lat || body.destLat);
    const destLng = parseFloat(body.dest_lng || body.destLng);
    const passengerId = req.user.id;

    logger.ride('REQUEST', `[${requestId}] Nova solicitação de corrida - Pax: ${passengerId}`);

    if (!req.io) {
        logger.error('REQUEST', `[${requestId}] Socket.IO não disponível`);
        return res.status(500).json({
            error: "Serviço de tempo real indisponível",
            code: "SOCKET_UNAVAILABLE"
        });
    }

    if (!originLat || !originLng || !destLat || !destLng) {
        logger.error('REQUEST', `[${requestId}] Coordenadas incompletas`);
        return res.status(400).json({
            error: "Coordenadas GPS incompletas.",
            code: "INVALID_COORDINATES"
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        logger.debug('REQUEST', `[${requestId}] Buscando configurações de preço`);

        // Calcular a distância real da viagem
        const distanceKm = calculateDistance(originLat, originLng, destLat, destLng);
        logger.debug('REQUEST', `[${requestId}] Distância calculada: ${distanceKm} km`);

        const settingsRes = await client.query(
            "SELECT value FROM app_settings WHERE key = 'ride_prices'"
        );

        const prices = settingsRes.rows[0]?.value || {
            base_price: 600, km_rate: 300,
            moto_base: 400, moto_km_rate: 180,
            delivery_base: 1000, delivery_km_rate: 450
        };

        let estimatedPrice = 0;
        const rideType = body.ride_type || 'ride';

        if (rideType === 'moto') {
            estimatedPrice = prices.moto_base + (distanceKm * prices.moto_km_rate);
        } else if (rideType === 'delivery') {
            estimatedPrice = prices.delivery_base + (distanceKm * prices.delivery_km_rate);
        } else {
            estimatedPrice = prices.base_price + (distanceKm * prices.km_rate);
        }

        estimatedPrice = Math.ceil(estimatedPrice / 50) * 50;
        if (estimatedPrice < 500) estimatedPrice = 500;

        logger.debug('REQUEST', `[${requestId}] Preço calculado: ${estimatedPrice} Kz`);

        const insertQuery = `
            INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, final_price,
                ride_type, distance_km, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW())
            RETURNING id, created_at
        `;

        const result = await client.query(insertQuery, [
            passengerId,
            originLat, originLng, destLat, destLng,
            body.origin_name || 'Origem desconhecida',
            body.dest_name || 'Destino desconhecido',
            estimatedPrice,
            rideType,
            distanceKm
        ]);

        const ride = result.rows[0];
        await client.query('COMMIT');

        logger.success('REQUEST', `[${requestId}] Corrida #${ride.id} criada com sucesso`);

        try {
            req.io.to(`user_${passengerId}`).emit('ride_requested', {
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

        logger.ride('DISPATCH', `[${requestId}] ===== INICIANDO DISPATCH =====`);

        let drivers = await exports.findAvailableDrivers(originLat, originLng, 10);

        logger.ride('DISPATCH', `[${requestId}] Nível 1 - Motoristas encontrados: ${drivers.length}`);

        if (drivers.length === 0) {
            logger.warn('DISPATCH', `[${requestId}] Nenhum motorista no nível 1. Expandindo raio para 15km...`);
            drivers = await exports.findAvailableDrivers(originLat, originLng, 15);
            logger.ride('DISPATCH', `[${requestId}] Nível 2 - Raio 15km: ${drivers.length}`);
        }

        if (drivers.length === 0) {
            logger.warn('DISPATCH', `[${requestId}] Nenhum motorista no nível 2. Tentando incluir GPS zero...`);
            drivers = await exports.findAvailableDrivers(originLat, originLng, 20, { includeGpsZero: true });
            logger.ride('DISPATCH', `[${requestId}] Nível 3 - Incluindo GPS zero: ${drivers.length}`);
        }

        const maxRadius = 5000;

        let driversNotified = 0;
        const notifiedDrivers = [];
        const errors = [];

        const ridePayload = {
            ride_id: ride.id,
            passenger_id: passengerId,
            passenger_name: req.user.name || 'Passageiro',
            passenger_photo: req.user.photo,
            passenger_rating: req.user.rating || 5.0,
            origin_lat: originLat,
            origin_lng: originLng,
            origin_name: body.origin_name,
            dest_lat: destLat,
            dest_lng: destLng,
            dest_name: body.dest_name,
            initial_price: estimatedPrice,
            distance_km: distanceKm,
            distance_to_pickup: 0,
            ride_type: rideType,
            request_id: requestId,
            timestamp: new Date().toISOString(),
            status: 'searching'
        };

        for (const driver of drivers) {
            let distanceToPickup = 0;
            let distanceInMeters = 0;

            if (driver.lat && driver.lng && driver.lat != 0 && driver.lng != 0) {
                distanceToPickup = calculateDistance(
                    originLat, originLng,
                    parseFloat(driver.lat), parseFloat(driver.lng)
                );
                distanceInMeters = distanceToPickup * 1000;
            }

            const driverPayload = {
                ...ridePayload,
                distance_to_pickup: parseFloat((distanceToPickup || 0).toFixed(1))
            };

            try {
                if (distanceInMeters <= maxRadius || driver.lat == 0 || driver.lng == 0) {
                    if (driver.socket_id) {
                        req.io.to(driver.socket_id).emit('ride_opportunity', driverPayload);
                        driversNotified++;
                        notifiedDrivers.push({
                            driver_id: driver.driver_id,
                            name: driver.name,
                            distance: distanceToPickup,
                            method: 'socket_id'
                        });
                        logger.debug('DISPATCH', `[${requestId}] Notificado driver ${driver.driver_id} via socket_id`);
                    } else if (driver.driver_id) {
                        req.io.to(`driver_${driver.driver_id}`).emit('ride_opportunity', driverPayload);
                        driversNotified++;
                        notifiedDrivers.push({
                            driver_id: driver.driver_id,
                            name: driver.name,
                            distance: distanceToPickup,
                            method: 'room'
                        });
                        logger.debug('DISPATCH', `[${requestId}] Notificado driver ${driver.driver_id} via sala`);
                    }
                } else {
                    logger.debug('DISPATCH', `[${requestId}] Driver ${driver.driver_id} fora do raio (${distanceToPickup.toFixed(2)}km)`);
                }
            } catch (e) {
                errors.push({ driver_id: driver.driver_id, error: e.message });
                logger.error('DISPATCH', `[${requestId}] Erro ao notificar driver ${driver.driver_id}: ${e.message}`);
            }
        }

        const duration = Date.now() - startTime;

        logger.ride('DISPATCH', `[${requestId}] ===== RESULTADO DO DISPATCH =====`);
        logger.ride('DISPATCH', `[${requestId}] Motoristas encontrados: ${drivers.length}`);
        logger.ride('DISPATCH', `[${requestId}] Motoristas notificados: ${driversNotified}`);
        logger.ride('DISPATCH', `[${requestId}] Tempo total: ${duration}ms`);

        if (notifiedDrivers.length > 0) {
            logger.ride('DISPATCH', `[${requestId}] Motoristas notificados:`);
            notifiedDrivers.forEach(d => {
                logger.ride('DISPATCH', `   → ${d.name} (ID: ${d.driver_id}) - ${d.distance?.toFixed(2) || '?'}km - via ${d.method}`);
            });
        }

        if (errors.length > 0) {
            logger.error('DISPATCH', `[${requestId}] Erros durante dispatch:`, errors);
        }

        logger.divider();

        if (driversNotified === 0) {
            let reason = 'Nenhum motorista disponível';

            if (drivers.length === 0) {
                reason = 'Nenhum motorista online no momento';
            } else {
                reason = 'Motoristas encontrados mas fora do raio';
            }

            logger.warn('DISPATCH', `[${requestId}] ${reason}`);

            try {
                req.io.to(`user_${passengerId}`).emit('ride_no_drivers', {
                    ride_id: ride.id,
                    message: 'Nenhum motorista disponível no momento. Tente novamente.',
                    reason: reason,
                    timestamp: new Date().toISOString()
                });
            } catch (e) {
                logger.error('DISPATCH', `[${requestId}] Erro ao notificar passageiro sobre falta de motoristas: ${e.message}`);
            }
        }

        logger.success('REQUEST', `[${requestId}] Processamento concluído em ${duration}ms`);

        res.status(201).json({
            success: true,
            message: driversNotified > 0
                ? "Solicitação enviada aos motoristas."
                : "Solicitação recebida. Aguardando motoristas...",
            ride: {
                id: ride.id,
                initial_price: estimatedPrice,
                distance_km: distanceKm,
                status: 'searching',
                created_at: ride.created_at
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
// 3. FUNÇÃO AUXILIAR: Buscar motoristas disponíveis
// =================================================================================================

exports.findAvailableDrivers = async (lat, lng, radiusKm = 10, options = {}) => {
    const { includeGpsZero = false } = options;

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
            u.vehicle_details,
            u.rating,
            u.photo,
            u.is_blocked,
            CASE
                WHEN dp.lat != 0 AND dp.lng != 0 THEN
                    (6371 * acos(
                        cos(radians($1)) *
                        cos(radians(dp.lat)) *
                        cos(radians(dp.lng) - radians($2)) +
                        sin(radians($1)) *
                        sin(radians(dp.lat))
                    ))
                ELSE 999999
            END as distance
        FROM driver_positions dp
        JOIN users u ON dp.driver_id = u.id
        WHERE
            dp.status = 'online'
            AND dp.last_update > NOW() - INTERVAL '2 minutes'
            AND dp.socket_id IS NOT NULL
            AND u.is_blocked = false
            AND u.role = 'driver'
            AND (
                (dp.lat != 0 AND dp.lng != 0 AND
                    (6371 * acos(
                        cos(radians($1)) *
                        cos(radians(dp.lat)) *
                        cos(radians(dp.lng) - radians($2)) +
                        sin(radians($1)) *
                        sin(radians(dp.lat))
                    )) <= $3
                )
                ${includeGpsZero ? "OR (dp.lat = 0 AND dp.lng = 0)" : ""}
            )
        ORDER BY
            CASE
                WHEN dp.lat = 0 OR dp.lng = 0 THEN 999999
                ELSE (6371 * acos(
                    cos(radians($1)) *
                    cos(radians(dp.lat)) *
                    cos(radians(dp.lng) - radians($2)) +
                    sin(radians($1)) *
                    sin(radians(dp.lat))
                ))
            END ASC NULLS LAST,
            u.rating DESC NULLS LAST
        LIMIT 20
    `;

    try {
        const result = await pool.query(query, [lat, lng, radiusKm]);

        if (result.rows.length > 0) {
            console.log(`✅ [FIND_DRIVERS] Encontrados ${result.rows.length} motoristas`);
            result.rows.forEach(d => {
                console.log(`   → ${d.name} (ID: ${d.driver_id}) - Distância: ${d.distance?.toFixed(2) || '?'}km`);
            });
        } else {
            console.log(`⚠️ [FIND_DRIVERS] Nenhum motorista encontrado para (${lat}, ${lng}) raio ${radiusKm}km`);
        }

        return result.rows;
    } catch (e) {
        console.error(`❌ [FIND_DRIVERS] Erro na query:`, e.message);
        return [];
    }
};

// =================================================================================================
// 4. FUNÇÃO AUXILIAR: Obter detalhes completos da corrida
// =================================================================================================

async function getFullRideDetails(rideId) {
    const result = await pool.query(`
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
    `, [rideId]);

    return result.rows[0];
}

// =================================================================================================
// 5. ACEITE DE CORRIDA - VERSÃO FINAL SEM UPDATED_AT
// =================================================================================================

exports.acceptRide = async (req, res) => {
    const startTime = Date.now();
    const { ride_id, driver_id } = req.body;
    const actualDriverId = driver_id || req.user.id;

    logger.ride('ACCEPT', `Motorista ${actualDriverId} tentando aceitar corrida #${ride_id}`);

    if (req.user.role !== 'driver') {
        logger.warn('ACCEPT', `Usuário ${actualDriverId} não é motorista`);
        return res.status(403).json({ error: "Apenas motoristas podem aceitar corridas." });
    }

    if (!req.io) {
        logger.error('ACCEPT', 'Socket.IO não disponível');
        return res.status(500).json({ error: "Serviço de tempo real indisponível" });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const rideRes = await client.query(
            "SELECT id, status, passenger_id, driver_id FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            logger.warn('ACCEPT', `Corrida #${ride_id} não encontrada`);
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (ride.status !== 'searching') {
            await client.query('ROLLBACK');
            logger.warn('ACCEPT', `Corrida #${ride_id} já foi aceita por outro motorista. Status: ${ride.status}`);
            return res.status(409).json({
                error: "Esta corrida já foi aceita por outro motorista.",
                code: "RIDE_TAKEN",
                current_status: ride.status
            });
        }

        if (ride.passenger_id == actualDriverId) {
            await client.query('ROLLBACK');
            logger.warn('ACCEPT', `Motorista ${actualDriverId} tentou aceitar própria corrida`);
            return res.status(400).json({ error: "Você não pode aceitar sua própria corrida." });
        }

        const driverRes = await client.query(
            "SELECT vehicle_details FROM users WHERE id = $1",
            [actualDriverId]
        );

        if (driverRes.rows.length === 0 || !driverRes.rows[0].vehicle_details) {
            await client.query('ROLLBACK');
            logger.warn('ACCEPT', `Motorista ${actualDriverId} sem veículo cadastrado`);
            return res.status(400).json({
                error: "Complete seu cadastro de veículo antes de aceitar corridas.",
                code: "VEHICLE_REQUIRED"
            });
        }

        await client.query(
            `UPDATE rides SET
                driver_id = $1,
                status = 'accepted',
                accepted_at = NOW()
             WHERE id = $2`,
            [actualDriverId, ride_id]
        );

        await client.query('COMMIT');

        const duration = Date.now() - startTime;
        logger.success('ACCEPT', `Corrida #${ride_id} aceita por motorista ${actualDriverId} em ${duration}ms`);

        const fullRide = await getFullRideDetails(ride_id);

        const driverData = {
            name: req.user.name,
            photo: req.user.photo,
            phone: req.user.phone,
            rating: req.user.rating || 4.5,
            vehicle_details: req.user.vehicle_details
        };

        const matchPayload = {
            ...fullRide,
            driver_name: driverData.name,
            driver_photo: driverData.photo,
            driver_phone: driverData.phone,
            driver_rating: driverData.rating,
            vehicle: driverData.vehicle_details,
            matched_at: new Date().toISOString(),
            estimated_pickup_time: Math.ceil(parseFloat(fullRide.distance_km || 0) * 3),
            message: "Motorista a caminho do ponto de embarque!"
        };

        try {
            req.io.to(`user_${fullRide.passenger_id}`).emit('match_found', matchPayload);
            logger.debug('ACCEPT', `Passageiro ${fullRide.passenger_id} notificado`);
        } catch (e) {
            logger.error('ACCEPT', `Erro ao notificar passageiro: ${e.message}`);
        }

        try {
            req.io.to(`ride_${ride_id}`).emit('ride_accepted', matchPayload);
        } catch (e) {
            logger.error('ACCEPT', `Erro ao notificar sala: ${e.message}`);
        }

        try {
            const otherDriversRes = await client.query(`
                SELECT socket_id, driver_id
                FROM driver_positions
                WHERE last_update > NOW() - INTERVAL '2 minutes'
                AND status = 'online'
                AND driver_id != $1
                AND socket_id IS NOT NULL
            `, [actualDriverId]);

            let notifiedOthers = 0;
            otherDriversRes.rows.forEach(driver => {
                if (driver.socket_id) {
                    req.io.to(driver.socket_id).emit('ride_taken', {
                        ride_id: ride_id,
                        message: 'Esta corrida já não está mais disponível.',
                        taken_by: actualDriverId,
                        taken_at: new Date().toISOString()
                    });
                    notifiedOthers++;
                }
            });

            logger.debug('ACCEPT', `${notifiedOthers} outros motoristas notificados`);
        } catch (e) {
            logger.error('ACCEPT', `Erro ao notificar outros motoristas: ${e.message}`);
        }

        try {
            const confirmationPayload = {
                success: true,
                ride: matchPayload,
                message: "Corrida aceita com sucesso!"
            };

            logger.debug('ACCEPT', `Enviando confirmação para motorista ${actualDriverId}`);
            req.io.to(`user_${actualDriverId}`).emit('ride_accepted_confirmation', confirmationPayload);
        } catch (e) {
            logger.error('ACCEPT', `Erro ao notificar motorista: ${e.message}`);
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
            driverId: actualDriverId,
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
// 6. ATUALIZAR STATUS (ARRIVED / PICKED_UP)
// =================================================================================================

exports.updateStatus = async (req, res) => {
    const { ride_id, status } = req.body;
    const driverId = req.user.id;

    logger.ride('STATUS', `Motorista ${driverId} atualizando status da corrida #${ride_id} para ${status}`);

    const allowed = ['arrived', 'ongoing', 'picked_up'];
    if (!allowed.includes(status)) {
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

        if (check.rows[0].driver_id !== driverId) {
            await client.query('ROLLBACK');
            logger.warn('STATUS', `Motorista ${driverId} não é o responsável pela corrida #${ride_id}`);
            return res.status(403).json({ error: "Permissão negada." });
        }

        const ride = check.rows[0];
        let newStatus = status;

        if (status === 'picked_up') {
            newStatus = 'ongoing';
        }

        let updateQuery = `UPDATE rides SET status = $1`;
        const params = [newStatus];
        let paramCounter = 2;

        if (status === 'arrived') {
            updateQuery += `, arrived_at = NOW()`;
        }
        if (status === 'picked_up') {
            updateQuery += `, started_at = NOW()`;
        }

        updateQuery += ` WHERE id = $${paramCounter} RETURNING *`;
        params.push(ride_id);

        const result = await client.query(updateQuery, params);

        await client.query('COMMIT');

        logger.success('STATUS', `Corrida #${ride_id} atualizada para ${newStatus}`);

        if (req.io) {
            const eventMap = {
                'arrived': 'driver_arrived',
                'picked_up': 'trip_started',
                'ongoing': 'trip_started'
            };

            const eventName = eventMap[status] || 'status_updated';

            const payload = {
                ride_id: ride_id,
                status: newStatus,
                timestamp: new Date().toISOString()
            };

            try {
                req.io.to(`ride_${ride_id}`).emit(eventName, payload);
                req.io.to(`user_${ride.passenger_id}`).emit(eventName, {
                    ...payload,
                    message: status === 'arrived'
                        ? "O motorista chegou ao local de embarque!"
                        : "Viagem iniciada! Boa viagem! 🚗"
                });
                logger.debug('STATUS', `Notificações enviadas para evento ${eventName}`);
            } catch (e) {
                logger.error('STATUS', `Erro ao enviar notificações: ${e.message}`);
            }
        }

        res.json({
            success: true,
            status: newStatus,
            ride: result.rows[0]
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

exports.startRide = async (req, res) => {
    req.body.status = 'picked_up';
    return exports.updateStatus(req, res);
};

// =================================================================================================
// 7. FINALIZAR CORRIDA
// =================================================================================================

exports.completeRide = async (req, res) => {
    const startTime = Date.now();
    const { ride_id, payment_method, final_price, rating, feedback, distance_traveled } = req.body;
    const driverId = req.user.id;
    const method = payment_method || 'cash';
    const amount = parseFloat(final_price) || 0;

    logger.ride('COMPLETE', `Motorista ${driverId} finalizando corrida #${ride_id} - Método: ${method}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const rideCheck = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            logger.warn('COMPLETE', `Corrida #${ride_id} não encontrada`);
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideCheck.rows[0];

        if (ride.driver_id !== driverId) {
            await client.query('ROLLBACK');
            logger.warn('COMPLETE', `Motorista ${driverId} não é o responsável pela corrida #${ride_id}`);
            return res.status(403).json({ error: "Apenas o motorista responsável pode finalizar." });
        }

        if (ride.status !== 'ongoing' && ride.status !== 'accepted') {
            await client.query('ROLLBACK');
            logger.warn('COMPLETE', `Status inválido para finalização: ${ride.status}`);
            return res.status(400).json({ error: `Status inválido para finalização: ${ride.status}` });
        }

        let finalAmount = amount || parseFloat(ride.final_price || ride.initial_price);

        if (distance_traveled && parseFloat(distance_traveled) > parseFloat(ride.distance_km || 0)) {
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

            const extraDistance = parseFloat(distance_traveled) - parseFloat(ride.distance_km || 0);
            const extraCharge = Math.ceil(extraDistance * additionalRate / 50) * 50;
            finalAmount = parseFloat(ride.initial_price) + extraCharge;

            logger.debug('COMPLETE', `Distância extra: ${extraDistance.toFixed(2)}km, Taxa extra: ${extraCharge} Kz`);
        }

        if (method === 'wallet') {
            const paxRes = await client.query(
                "SELECT balance FROM users WHERE id = $1",
                [ride.passenger_id]
            );

            const paxBalance = parseFloat(paxRes.rows[0]?.balance || 0);

            if (paxBalance < finalAmount) {
                await client.query('ROLLBACK');
                logger.warn('COMPLETE', `Saldo insuficiente do passageiro ${ride.passenger_id}: ${paxBalance} < ${finalAmount}`);
                return res.status(402).json({
                    error: "Saldo insuficiente do passageiro",
                    code: "INSUFFICIENT_FUNDS"
                });
            }

            await client.query(
                "UPDATE users SET balance = balance - $1 WHERE id = $2",
                [finalAmount, ride.passenger_id]
            );

            await client.query(
                "UPDATE users SET balance = balance + $1 WHERE id = $2",
                [finalAmount, driverId]
            );

            const txRef = generateRef('WLTX');

            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, category, created_at)
                 VALUES ($1, $2, $2, $3, $4, 'payment', 'internal', 'completed', $5, 'ride', NOW())`,
                [`${txRef}-PAY`, ride.passenger_id, driverId, -finalAmount, `Pagamento Corrida #${ride_id}`]
            );

            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, category, created_at)
                 VALUES ($1, $2, $3, $2, $4, 'earnings', 'internal', 'completed', $5, 'ride', NOW())`,
                [`${txRef}-EARN`, driverId, ride.passenger_id, finalAmount, `Recebimento Corrida #${ride_id}`]
            );

            logger.debug('COMPLETE', `Pagamento via carteira processado: ${finalAmount} Kz`);
        } else {
            const txRef = generateRef('CASH');

            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, amount, type, method, status, description, category, metadata, created_at)
                 VALUES ($1, $2, $3, 'earnings', 'cash', 'completed', $4, 'ride', '{"is_cash": true}', NOW())`,
                [`${txRef}-CASH`, driverId, finalAmount, `Corrida em Dinheiro #${ride_id}`]
            );

            logger.debug('COMPLETE', `Pagamento em dinheiro registrado: ${finalAmount} Kz`);
        }

        await client.query(
            `UPDATE rides SET
                status = 'completed',
                final_price = $1,
                payment_method = $2,
                payment_status = 'paid',
                completed_at = NOW(),
                rating = COALESCE($3, rating),
                feedback = COALESCE($4, feedback),
                distance_km = COALESCE($5, distance_km)
             WHERE id = $6`,
            [finalAmount, method, rating || 0, feedback || '', distance_traveled || ride.distance_km, ride_id]
        );

        await client.query('COMMIT');

        const duration = Date.now() - startTime;
        logger.success('COMPLETE', `Corrida #${ride_id} finalizada! Valor: ${finalAmount} Kz (${duration}ms)`);

        if (req.io) {
            try {
                const payload = {
                    ride_id: ride_id,
                    status: 'completed',
                    amount: finalAmount,
                    payment_method: method,
                    timestamp: new Date().toISOString()
                };

                req.io.to(`ride_${ride_id}`).emit('ride_completed', {
                    ...payload,
                    message: "Viagem finalizada! Obrigado por viajar conosco!"
                });

                req.io.to(`user_${ride.passenger_id}`).emit('ride_completed_passenger', {
                    ...payload,
                    message: "Sua viagem foi concluída. Avalie o motorista!"
                });

                req.io.to(`user_${driverId}`).emit('ride_completed_driver', payload);

                if (method === 'wallet') {
                    const passengerBalance = await pool.query(
                        "SELECT balance FROM users WHERE id = $1",
                        [ride.passenger_id]
                    );
                    const driverBalance = await pool.query(
                        "SELECT balance FROM users WHERE id = $1",
                        [driverId]
                    );

                    req.io.to(`user_${ride.passenger_id}`).emit('wallet_update', {
                        type: 'payment',
                        amount: -finalAmount,
                        balance: parseFloat(passengerBalance.rows[0].balance)
                    });

                    req.io.to(`user_${driverId}`).emit('wallet_update', {
                        type: 'earnings',
                        amount: finalAmount,
                        balance: parseFloat(driverBalance.rows[0].balance)
                    });
                }

                logger.debug('COMPLETE', `Notificações de finalização enviadas`);
            } catch (e) {
                logger.error('COMPLETE', `Erro ao enviar notificações: ${e.message}`);
            }
        }

        if (rating) {
            try {
                await pool.query(`
                    UPDATE users
                    SET rating = (
                        SELECT COALESCE(AVG(rating), 0)
                        FROM rides
                        WHERE driver_id = $1
                        AND rating > 0
                    )
                    WHERE id = $1
                `, [driverId]);
            } catch (e) {
                logger.error('COMPLETE', `Erro ao atualizar rating: ${e.message}`);
            }
        }

        res.json({
            success: true,
            message: "Corrida finalizada com sucesso!",
            ride: {
                id: ride_id,
                final_price: finalAmount,
                payment_method: method,
                completed_at: new Date().toISOString()
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');

        logger.error('COMPLETE', `Erro fatal ao finalizar corrida #${ride_id}: ${e.message}`, {
            stack: e.stack
        });

        logError('RIDE_COMPLETE_FATAL', {
            ride_id,
            driverId,
            error: e.message,
            stack: e.stack
        });

        res.status(500).json({ error: "Erro crítico ao finalizar corrida" });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 8. CANCELAR CORRIDA
// =================================================================================================

exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;
    const userId = req.user.id;
    const role = req.user.role || req.body.role || 'passenger';

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
                cancellation_reason = $2
             WHERE id = $3
             RETURNING *`,
            [role, reason || 'Cancelado pelo usuário', ride_id]
        );

        await client.query('COMMIT');

        logger.success('CANCEL', `Corrida #${ride_id} cancelada por ${role}`);

        if (req.io) {
            try {
                const payload = {
                    ride_id: ride_id,
                    status: 'cancelled',
                    reason: reason || 'Cancelado pelo usuário',
                    cancelled_by: role,
                    cancelled_at: new Date().toISOString()
                };

                req.io.to(`ride_${ride_id}`).emit('ride_cancelled', payload);

                const targetId = role === 'driver' ? ride.passenger_id : ride.driver_id;
                if (targetId) {
                    req.io.to(`user_${targetId}`).emit('ride_cancelled', payload);
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
// 9. HISTÓRICO E DETALHES
// =================================================================================================

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
// 10. ESTATÍSTICAS E PERFORMANCE
// =================================================================================================

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

// =================================================================================================
// 11. AVALIAÇÃO DA CORRIDA
// =================================================================================================

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
                feedback = $2
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
// 12. UTILITÁRIOS E DIAGNÓSTICO
// =================================================================================================

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
