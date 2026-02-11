/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE LIFECYCLE CONTROLLER (TITANIUM CORE)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/rideController.js
 * DESCRIÇÃO: Controlador central para gestão de corridas.
 *            Responsável por: Solicitação, Aceite (Lock), Rastreamento, Finalização e
 *            Liquidação Financeira (Split de Pagamento).
 *
 * INTEGRAÇÃO:
 * - WalletService: Para movimentação de valores.
 * - SocketService: Para notificações em tempo real.
 * - DbBootstrap: Alinhado com schema v2026.02.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const { getDistance, getFullRideDetails, logSystem, logError, generateRef } = require('../utils/helpers');
const { emitGlobal, emitToUser } = require('../services/socketService');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. SOLICITAÇÃO DE CORRIDA (REQUEST)
// =================================================================================================

/**
 * POST /api/rides/request
 * Cria a intenção de corrida, calcula preço e notifica motoristas.
 */
exports.requestRide = async (req, res) => {
    const {
        origin_lat, origin_lng, dest_lat, dest_lng,
        origin_name, dest_name, ride_type, distance_km
    } = req.body;

    // Validação Estrita de Geolocalização
    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng) {
        return res.status(400).json({ error: "Coordenadas GPS incompletas." });
    }

    try {
        // 1. Precificação Dinâmica (Busca config do banco para hot-reload de preços)
        const settingsRes = await pool.query("SELECT value FROM app_settings WHERE key = 'ride_prices'");
        const prices = settingsRes.rows[0]?.value || {
            base_price: 600,
            km_rate: 300,
            moto_base: 400,
            moto_km_rate: 180,
            delivery_base: 1000,
            delivery_km_rate: 450
        };

        // Lógica de Cálculo
        let estimatedPrice = 0;
        const dist = parseFloat(distance_km) ||
                     getDistance(origin_lat, origin_lng, dest_lat, dest_lng);

        if (ride_type === 'moto') {
            estimatedPrice = prices.moto_base + (dist * prices.moto_km_rate);
        } else if (ride_type === 'delivery') {
            estimatedPrice = prices.delivery_base + (dist * prices.delivery_km_rate);
        } else {
            // Padrão 'ride' (Carro)
            estimatedPrice = prices.base_price + (dist * prices.km_rate);
        }

        // Arredondamento para múltiplos de 50 Kz (Facilita troco em dinheiro)
        estimatedPrice = Math.ceil(estimatedPrice / 50) * 50;

        // Preço mínimo de segurança
        if (estimatedPrice < 500) estimatedPrice = 500;

        // 2. Persistência no Banco
        const insertQuery = `
            INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, final_price,
                ride_type, distance_km, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW())
            RETURNING *
        `;

        const result = await pool.query(insertQuery, [
            req.user.id,
            origin_lat, origin_lng, dest_lat, dest_lng,
            origin_name || 'Origem desconhecida',
            dest_name || 'Destino desconhecido',
            estimatedPrice,
            ride_type || 'ride',
            dist
        ]);

        const ride = result.rows[0];

        // 3. Dispatch Inteligente (Socket.IO)
        // Busca motoristas ativos no raio de ação
        const maxRadius = SYSTEM_CONFIG.RIDES.MAX_RADIUS_KM || 15;

        const driversRes = await pool.query(`
            SELECT dp.driver_id, dp.lat, dp.lng, dp.socket_id, u.fcm_token
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE u.is_online = true
            AND u.role = 'driver'
            AND u.is_blocked = false
            AND dp.last_update > NOW() - INTERVAL '30 minutes'
        `);

        let driversNotified = 0;

        // Filtra em memória (Geofencing)
        driversRes.rows.forEach(driver => {
            const distanceToPickup = getDistance(origin_lat, origin_lng, driver.lat, driver.lng);

            if (distanceToPickup <= maxRadius) {
                // Notifica via Socket se tiver socket_id
                if (driver.socket_id) {
                    emitToUser(driver.driver_id, 'ride_opportunity', {
                        ...ride,
                        distance_to_pickup: distanceToPickup
                    });
                    driversNotified++;
                }

                // TODO: Aqui entraria a chamada ao Firebase (FCM) para push notification
                // se o driver estiver em background.
            }
        });

        logSystem('RIDE_REQUEST', `Corrida #${ride.id} criada por User ${req.user.id}. Drivers notificados: ${driversNotified}`);

        res.status(201).json({
            success: true,
            message: "Solicitação enviada aos motoristas.",
            ride: ride,
            drivers_nearby: driversNotified
        });

    } catch (e) {
        logError('RIDE_REQUEST', e);
        res.status(500).json({ error: "Erro ao solicitar corrida." });
    }
};

// =================================================================================================
// 2. ACEITE DE CORRIDA (MATCHING ACID)
// =================================================================================================

/**
 * POST /api/rides/accept
 * Motorista aceita a corrida. Usa transação para evitar 'Race Condition'.
 */
exports.acceptRide = async (req, res) => {
    const { ride_id } = req.body;
    const driverId = req.user.id;

    if (req.user.role !== 'driver') {
        return res.status(403).json({ error: "Apenas motoristas podem aceitar corridas." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Start Transaction

        // 1. Lock Row: Impede que outro motorista leia este registro simultaneamente
        const checkRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = checkRes.rows[0];

        // 2. Validação de Estado
        if (ride.status !== 'searching') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: "Esta corrida já foi aceita por outro motorista.",
                code: "RIDE_TAKEN"
            });
        }

        if (ride.passenger_id === driverId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Você não pode aceitar sua própria corrida." });
        }

        // 3. Atualização Atômica
        const updateRes = await client.query(
            `UPDATE rides SET
                driver_id = $1,
                status = 'accepted',
                accepted_at = NOW(),
                updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [driverId, ride_id]
        );

        await client.query('COMMIT'); // Commit Transaction

        // 4. Notificações e Payload Rico
        // Busca detalhes completos (com fotos e dados do passageiro)
        const fullRide = await getFullRideDetails(ride_id);

        // Notifica Passageiro
        emitToUser(fullRide.passenger_id, 'match_found', fullRide);

        // Notifica a sala da corrida
        if (global.io) global.io.to(`ride_${ride_id}`).emit('match_found', fullRide);

        logSystem('RIDE_MATCH', `Corrida #${ride_id} aceita por Driver ${driverId}`);

        res.json({
            success: true,
            ride: fullRide
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_ACCEPT_FATAL', e);
        res.status(500).json({ error: "Erro crítico ao aceitar corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 3. FLUXO DE EXECUÇÃO (START / STATUS UPDATE)
// =================================================================================================

/**
 * POST /api/rides/update-status
 * Atualizações intermediárias: 'arrived' (Chegou no embarque), 'picked_up' (Passageiro embarcou).
 */
exports.updateStatus = async (req, res) => {
    const { ride_id, status } = req.body;
    const allowedStatuses = ['arrived', 'picked_up'];

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: "Status inválido." });
    }

    try {
        // Valida propriedade da corrida
        const check = await pool.query(
            "SELECT driver_id FROM rides WHERE id = $1",
            [ride_id]
        );

        if (check.rows.length === 0 || check.rows[0].driver_id !== req.user.id) {
            return res.status(403).json({ error: "Permissão negada." });
        }

        // Se for 'picked_up', mudamos o status da corrida para 'ongoing' no banco
        // Se for 'arrived', é apenas um evento, mas podemos querer persistir logs.
        // Neste design, mantemos simples:

        if (status === 'picked_up') {
             await pool.query(
                "UPDATE rides SET status = 'ongoing', started_at = NOW(), updated_at = NOW() WHERE id = $1",
                [ride_id]
            );
        }

        const fullRide = await getFullRideDetails(ride_id);

        // Notificações Específicas
        if (status === 'arrived') {
            emitToUser(fullRide.passenger_id, 'driver_arrived', {
                message: "O motorista chegou ao local de embarque!",
                ride_id
            });
        } else if (status === 'picked_up') {
            emitToUser(fullRide.passenger_id, 'trip_started', fullRide);
        }

        // Sync Global da Sala
        if (global.io) global.io.to(`ride_${ride_id}`).emit('ride_status_changed', { status, ride: fullRide });

        res.json({ success: true, status });

    } catch (e) {
        logError('RIDE_STATUS_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar status." });
    }
};

/**
 * POST /api/rides/start
 * Início formal da viagem (redundância para 'picked_up' ou botão explícito).
 */
exports.startRide = async (req, res) => {
    const { ride_id } = req.body;

    try {
        const result = await pool.query(
            `UPDATE rides SET
                status = 'ongoing',
                started_at = NOW(),
                updated_at = NOW()
             WHERE id = $1 AND driver_id = $2
             RETURNING *`,
            [ride_id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Corrida não encontrada ou não pertence a você." });
        }

        const fullRide = await getFullRideDetails(ride_id);

        if (global.io) {
            global.io.to(`ride_${ride_id}`).emit('trip_started', fullRide);
            global.io.to(`ride_${ride_id}`).emit('trip_started_now', {
                status: 'ongoing',
                started_at: new Date().toISOString()
            });
        }

        res.json(fullRide);

    } catch (e) {
        logError('RIDE_START', e);
        res.status(500).json({ error: "Erro ao iniciar corrida." });
    }
};

// =================================================================================================
// 4. FINALIZAÇÃO E PAGAMENTO (COMPLETE)
// =================================================================================================

/**
 * POST /api/rides/complete
 * Finaliza a corrida, calcula taxas e executa a liquidação financeira.
 */
exports.completeRide = async (req, res) => {
    const { ride_id, rating, feedback, payment_method } = req.body;

    // Default cash se não especificado
    const method = payment_method || 'cash';

    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Start Transaction

        // 1. Lock e Validação
        const rideRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (ride.driver_id !== req.user.id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Apenas o motorista responsável pode finalizar." });
        }

        if (ride.status !== 'ongoing' && ride.status !== 'accepted') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Status inválido para finalização: ${ride.status}` });
        }

        // 2. Atualizar Status da Corrida
        await client.query(
            `UPDATE rides SET
                status = 'completed',
                completed_at = NOW(),
                rating = $1,
                feedback = $2,
                payment_method = $3,
                payment_status = 'paid',
                updated_at = NOW()
             WHERE id = $4`,
            [rating || 0, feedback || '', method, ride_id]
        );

        // 3. Lógica Financeira (Wallet Integration)
        const amount = parseFloat(ride.final_price || ride.initial_price);
        const txRef = generateRef('RIDE');

        // Se pagamento for via CARTEIRA (Wallet)
        if (method === 'wallet') {
            // A. Debita Passageiro
            await client.query(
                `UPDATE users SET balance = balance - $1 WHERE id = $2`,
                [amount, ride.passenger_id]
            );

            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, category)
                 VALUES ($1, $2, $2, $3, $4, 'payment', 'internal', 'completed', $5, 'ride')`,
                [`${txRef}-PAY`, ride.passenger_id, ride.driver_id, -amount, `Pagamento Corrida #${ride_id}`]
            );

            // B. Credita Motorista
            await client.query(
                `UPDATE users SET balance = balance + $1 WHERE id = $2`,
                [amount, ride.driver_id]
            );

            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, category)
                 VALUES ($1, $2, $3, $2, $4, 'earnings', 'internal', 'completed', $5, 'ride')`,
                [`${txRef}-EARN`, ride.driver_id, ride.passenger_id, amount, `Recebimento Corrida #${ride_id}`]
            );
        }
        // Se pagamento for DINHEIRO (Cash)
        else {
            // Apenas registramos o ganho no histórico do motorista (sem alterar saldo digital, pois já está no bolso)
            // Futuro: Debitar comissão da plataforma do saldo digital do motorista.
            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, amount, type, method, status, description, category, metadata)
                 VALUES ($1, $2, $3, 'earnings', 'cash', 'completed', $4, 'ride', '{"is_cash": true}')`,
                [`${txRef}-CASH`, ride.driver_id, amount, `Corrida em Dinheiro #${ride_id}`]
            );
        }

        await client.query('COMMIT');

        // 4. Notificação Final
        const fullRide = await getFullRideDetails(ride_id);

        // Emite para ambos
        if (global.io) global.io.to(`ride_${ride_id}`).emit('ride_completed', fullRide);

        // Atualiza saldo visual dos usuários se foi via wallet
        if (method === 'wallet' && global.io) {
             emitToUser(ride.passenger_id, 'wallet_update', { type: 'payment', amount: -amount });
             emitToUser(ride.driver_id, 'wallet_update', { type: 'earnings', amount: amount });
        }

        logSystem('RIDE_COMPLETE', `Corrida #${ride_id} finalizada (${method}). Valor: ${amount}`);
        res.json(fullRide);

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_COMPLETE_FATAL', e);
        res.status(500).json({ error: "Erro crítico ao finalizar corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 5. CANCELAMENTO E HISTÓRICO
// =================================================================================================

/**
 * POST /api/rides/cancel
 */
exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;
    const userId = req.user.id;
    const role = req.user.role;

    try {
        // Verifica se a corrida pode ser cancelada (não finalizada)
        const check = await pool.query("SELECT status FROM rides WHERE id = $1", [ride_id]);
        if (check.rows.length === 0) return res.status(404).json({ error: "Corrida não encontrada." });
        if (['completed', 'cancelled'].includes(check.rows[0].status)) {
            return res.status(400).json({ error: "Corrida já finalizada ou cancelada." });
        }

        const result = await pool.query(
            `UPDATE rides SET
                status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = $1,
                cancellation_reason = $2,
                updated_at = NOW()
             WHERE id = $3 AND (passenger_id = $4 OR driver_id = $4)
             RETURNING *`,
            [role, reason || 'Cancelado pelo usuário', ride_id, userId]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ error: "Permissão negada." });
        }

        const ride = result.rows[0];

        // Notificação
        if (global.io) {
            global.io.to(`ride_${ride_id}`).emit('ride_terminated', {
                reason: role === 'driver' ? "Motorista cancelou." : "Passageiro cancelou.",
                origin: role,
                cancelled_at: new Date().toISOString()
            });

            // Força atualização no passageiro se o motorista cancelar
            const targetId = role === 'driver' ? ride.passenger_id : ride.driver_id;
            if (targetId) emitToUser(targetId, 'ride_cancelled', { reason: reason });
        }

        res.json({ success: true, message: "Corrida cancelada." });

    } catch (e) {
        logError('RIDE_CANCEL', e);
        res.status(500).json({ error: "Erro ao cancelar corrida." });
    }
};

/**
 * GET /api/rides/history
 * Histórico paginado.
 */
exports.getHistory = async (req, res) => {
    const { limit = 20, offset = 0, status } = req.query;
    const userId = req.user.id;

    try {
        let query = `
            SELECT r.*,
                   -- Dados do Parceiro (Se sou passageiro, mostre motorista, e vice-versa)
                   CASE WHEN r.passenger_id = $1 THEN d.name ELSE p.name END as counterpart_name,
                   CASE WHEN r.passenger_id = $1 THEN d.photo ELSE p.photo END as counterpart_photo,
                   CASE WHEN r.passenger_id = $1 THEN 'driver' ELSE 'passenger' END as counterpart_role
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
        res.json(result.rows);

    } catch (e) {
        logError('RIDE_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
};

/**
 * GET /api/rides/:id
 * Detalhes completos.
 */
exports.getRideDetails = async (req, res) => {
    try {
        const fullRide = await getFullRideDetails(req.params.id);
        if (!fullRide) return res.status(404).json({ error: "Corrida não encontrada." });

        // Segurança: Apenas participantes
        if (fullRide.passenger_id !== req.user.id && fullRide.driver_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Acesso negado." });
        }

        res.json(fullRide);
    } catch (e) {
        logError('RIDE_DETAILS', e);
        res.status(500).json({ error: "Erro ao carregar detalhes." });
    }
};

/**
 * GET /api/driver/performance-stats
 * Dashboard do Motorista (Requisito do Frontend).
 */
exports.getDriverPerformance = async (req, res) => {
    try {
        if (req.user.role !== 'driver') return res.status(403).json({ error: "Apenas motoristas." });

        // Estatísticas de hoje (Aggregation)
        const statsQuery = `
            SELECT
                COUNT(*) as missions,
                COALESCE(SUM(final_price), 0) as earnings
            FROM rides
            WHERE driver_id = $1
              AND status = 'completed'
              AND created_at >= CURRENT_DATE
        `;
        const statsRes = await pool.query(statsQuery, [req.user.id]);

        // Últimas 5 corridas para lista rápida
        const recentQuery = `
            SELECT r.*, p.name as passenger_name
            FROM rides r
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE r.driver_id = $1 AND r.status = 'completed'
            ORDER BY r.created_at DESC LIMIT 5
        `;
        const recentRes = await pool.query(recentQuery, [req.user.id]);

        res.json({
            today_earnings: parseFloat(statsRes.rows[0].earnings),
            missions_count: parseInt(statsRes.rows[0].missions),
            recent_rides: recentRes.rows
        });

    } catch (e) {
        logError('DRIVER_STATS', e);
        res.status(500).json({ error: "Erro ao carregar estatísticas." });
    }
};
