/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE MANAGEMENT CONTROLLER
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/rideController.js
 * DESCRIÇÃO: Controlador central para o ciclo de vida das corridas (Ride Lifecycle).
 *            Gerencia solicitações, aceites, atualizações de estado e histórico.
 *            Integra-se fortemente com o SocketService para notificações em tempo real.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const { getDistance, getFullRideDetails, logSystem, logError } = require('../utils/helpers');
const { emitGlobal, emitToUser } = require('../services/socketService');
const SYSTEM_CONFIG = require('../config/appConfig');

/**
 * REQUEST RIDE (PASSAGEIRO)
 * Rota: POST /api/rides/request
 * Lógica: Cria registro de corrida, calcula preço estimado e notifica motoristas próximos.
 */
exports.requestRide = async (req, res) => {
    const {
        origin_lat, origin_lng, dest_lat, dest_lng,
        origin_name, dest_name, ride_type, distance_km
    } = req.body;

    // Validação estrita de coordenadas
    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng || !origin_name || !dest_name) {
        return res.status(400).json({ error: "Dados de geolocalização incompletos." });
    }

    try {
        // 1. Carregar configuração de preços do banco (Hot-Reloading de tarifas)
        const priceConfigRes = await pool.query(
            "SELECT value FROM app_settings WHERE key = 'ride_prices'"
        );

        // Fallback para defaults se a configuração não existir
        const prices = priceConfigRes.rows[0]?.value || {
            base_price: 600,
            km_rate: 300,
            moto_base: 400,
            moto_km_rate: 180,
            delivery_base: 1000,
            delivery_km_rate: 450
        };

        // 2. Cálculo do Preço Estimado
        let initial_price;
        if (ride_type === 'moto') {
            initial_price = prices.moto_base + (distance_km * prices.moto_km_rate);
        } else if (ride_type === 'delivery') {
            initial_price = prices.delivery_base + (distance_km * prices.delivery_km_rate);
        } else {
            // Padrão: Carro / Comfort
            initial_price = prices.base_price + (distance_km * prices.km_rate);
        }

        // Garante preço mínimo de operação (Ex: 800 Kz)
        initial_price = Math.max(initial_price, 800);
        // Arredonda para múltiplo de 50 para facilitar troco
        initial_price = Math.ceil(initial_price / 50) * 50;

        // 3. Inserção no Banco de Dados
        const result = await pool.query(
            `INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, final_price,
                ride_type, distance_km, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW())
            RETURNING *`,
            [
                req.user.id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, ride_type, distance_km
            ]
        );

        const ride = result.rows[0];

        // 4. Notificação Global via Socket (Legacy fallback)
        emitGlobal('new_ride_request', ride);

        // 5. Motor de Busca de Motoristas (Smart Dispatch)
        // Busca motoristas ativos, não bloqueados, com atualização recente de GPS (30 min)
        const driversRes = await pool.query(`
            SELECT dp.*, u.name, u.photo, u.rating, u.vehicle_details, u.fcm_token
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE u.is_online = true
            AND u.role = 'driver'
            AND u.is_blocked = false
            AND dp.last_update > NOW() - INTERVAL '30 minutes'
        `);

        // Filtra por raio geográfico (Ex: 15km)
        const nearbyDrivers = driversRes.rows.filter(driver => {
            const dist = getDistance(origin_lat, origin_lng, driver.lat, driver.lng);
            return dist <= SYSTEM_CONFIG.WALLET_LIMITS.MAX_RADIUS_KM || 15.0;
        });

        // Dispara evento específico para cada motorista encontrado
        nearbyDrivers.forEach(driver => {
            const distToPickup = getDistance(origin_lat, origin_lng, driver.lat, driver.lng);
            emitToUser(driver.driver_id, 'ride_opportunity', {
                ...ride,
                driver_distance: distToPickup
            });
            // Futuro: Adicionar lógica de Push Notification (FCM) aqui
        });

        logSystem('RIDE_REQUEST', `Corrida #${ride.id} solicitada por ${req.user.id}. Drivers notificados: ${nearbyDrivers.length}`);

        // Retorna o objeto da corrida para o app do passageiro monitorar
        res.json(ride);

    } catch (e) {
        logError('RIDE_REQUEST_ERROR', e);
        res.status(500).json({ error: "Erro ao processar solicitação de corrida." });
    }
};

/**
 * ACCEPT RIDE (MOTORISTA)
 * Rota: POST /api/rides/accept
 * Lógica: Bloqueia a corrida (Atomic Lock), atribui motorista e notifica partes.
 */
exports.acceptRide = async (req, res) => {
    const { ride_id, final_price } = req.body;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    if (req.user.role !== 'driver') {
        return res.status(403).json({ error: "Apenas motoristas podem aceitar corridas." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Verificar e Bloquear Registro (SELECT FOR UPDATE)
        // Isso impede "Race Condition" onde dois motoristas aceitam ao mesmo tempo.
        const checkQuery = "SELECT * FROM rides WHERE id = $1 FOR UPDATE";
        const checkRes = await client.query(checkQuery, [ride_id]);

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = checkRes.rows[0];

        if (ride.status !== 'searching') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: "Esta corrida já foi aceita ou não está mais disponível.",
                current_status: ride.status
            });
        }

        // 2. Atualizar Corrida
        const updateQuery = `
            UPDATE rides SET
                driver_id = $1,
                final_price = COALESCE($2, initial_price),
                status = 'accepted',
                accepted_at = NOW()
            WHERE id = $3
            RETURNING *
        `;

        await client.query(updateQuery, [
            req.user.id,
            final_price || ride.initial_price, // Permite contra-proposta se implementado
            ride_id
        ]);

        await client.query('COMMIT');

        // 3. Obter Dados Ricos para Atualização de UI
        const fullData = await getFullRideDetails(ride_id);

        // 4. Notificações Real-Time
        // Emite para a sala da corrida (Ambos)
        if (global.io) {
            global.io.to(`ride_${ride_id}`).emit('match_found', fullData);

            // Emite especificamente para os usuários (Redundância necessária)
            global.io.to(`user_${ride.passenger_id}`).emit('ride_accepted', fullData);
            global.io.to(`user_${req.user.id}`).emit('ride_accepted_confirmation', fullData);
        }

        logSystem('RIDE_ACCEPT', `Corrida #${ride_id} aceita por Motorista ${req.user.id}`);
        res.json(fullData);

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_ACCEPT_ERROR', e);
        res.status(500).json({ error: "Erro ao aceitar corrida." });
    } finally {
        client.release();
    }
};

/**
 * START RIDE (MOTORISTA/PASSAGEIRO)
 * Rota: POST /api/rides/start
 * Lógica: Altera status para 'ongoing' e registra hora de início.
 */
exports.startRide = async (req, res) => {
    const { ride_id } = req.body;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    try {
        const result = await pool.query(
            `UPDATE rides SET
                status = 'ongoing',
                started_at = NOW()
             WHERE id = $1 AND (driver_id = $2 OR passenger_id = $2)
             RETURNING *`,
            [ride_id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Corrida não encontrada ou permissão negada." });
        }

        const fullData = await getFullRideDetails(ride_id);

        // Notificar via Socket
        if (global.io) {
            global.io.to(`ride_${ride_id}`).emit('trip_started', fullData);
            global.io.to(`ride_${ride_id}`).emit('trip_started_now', {
                full_details: fullData,
                status: 'ongoing',
                started_at: new Date().toISOString()
            });
        }

        logSystem('RIDE_START', `Corrida #${ride_id} iniciada.`);
        res.json(fullData);

    } catch (e) {
        logError('RIDE_START_ERROR', e);
        res.status(500).json({ error: "Erro ao iniciar corrida." });
    }
};

/**
 * COMPLETE RIDE (MOTORISTA)
 * Rota: POST /api/rides/complete
 * Lógica: Finaliza corrida, processa pagamento (Carteira/Cash) e distribui ganhos.
 */
exports.completeRide = async (req, res) => {
    const { ride_id, rating, feedback, payment_method } = req.body;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Bloquear Corrida
        const rideRes = await client.query(
            `SELECT * FROM rides WHERE id = $1 FOR UPDATE`,
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (ride.status !== 'ongoing') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: "Corrida não está em andamento.",
                current_status: ride.status
            });
        }

        // 2. Atualizar Status e Feedback
        await client.query(`
            UPDATE rides SET
                status = 'completed',
                rating = $1,
                feedback = $2,
                payment_method = $3,
                payment_status = 'paid',
                completed_at = NOW()
            WHERE id = $4
        `, [
            rating || 5,
            feedback || '',
            payment_method || 'cash',
            ride_id
        ]);

        // 3. Processamento Financeiro
        const ridePrice = parseFloat(ride.final_price || ride.initial_price);

        // Regras de comissão (Ex: 20% plataforma, 80% motorista)
        // Por simplicidade, nesta versão creditamos tudo ao motorista e debitamos taxa depois se necessário.

        // A. Crédito para Motorista (Registro Lógico)
        await client.query(
            `INSERT INTO wallet_transactions
             (user_id, amount, type, description, reference_id, status, category)
             VALUES ($1, $2, 'earnings', 'Ganho da Corrida #${ride_id}', $3, 'completed', 'ride')`,
            [ride.driver_id, ridePrice, ride_id]
        );

        // Atualiza saldo real do motorista
        await client.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2',
            [ridePrice, ride.driver_id]
        );

        // B. Débito do Passageiro (Apenas se pagar via Carteira)
        if (payment_method === 'wallet') {
            // Verifica saldo do passageiro antes (Opcional, mas recomendado)
            const passengerWallet = await client.query('SELECT balance FROM users WHERE id = $1', [ride.passenger_id]);
            // (Lógica de saldo negativo permitida ou bloqueada depende da regra de negócio. Aqui permitimos ficar negativo).

            await client.query(
                `INSERT INTO wallet_transactions
                 (user_id, amount, type, description, reference_id, status, category)
                 VALUES ($1, $2, 'payment', 'Pagamento da Corrida #${ride_id}', $3, 'completed', 'ride')`,
                [ride.passenger_id, -ridePrice, ride_id]
            );

            await client.query(
                'UPDATE users SET balance = balance - $1 WHERE id = $2',
                [ridePrice, ride.passenger_id]
            );
        }

        await client.query('COMMIT');

        // 4. Finalização e Notificação
        const fullData = await getFullRideDetails(ride_id);

        if (global.io) {
            global.io.to(`ride_${ride_id}`).emit('ride_completed', fullData);
        }

        logSystem('RIDE_COMPLETE', `Corrida #${ride_id} finalizada. Valor: ${ridePrice}`);
        res.json(fullData);

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_COMPLETE_ERROR', e);
        res.status(500).json({ error: "Erro crítico ao finalizar corrida." });
    } finally {
        client.release();
    }
};

/**
 * CANCEL RIDE (BILATERAL)
 * Rota: POST /api/rides/cancel
 * Lógica: Cancela a corrida e notifica a outra parte.
 */
exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    try {
        // Validação de permissão (apenas participantes podem cancelar)
        const result = await pool.query(
            `UPDATE rides SET
                status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = $1,
                cancellation_reason = $2
             WHERE id = $3 AND (passenger_id = $4 OR driver_id = $4)
             RETURNING *`,
            [req.user.role, reason || 'Cancelado pelo usuário', ride_id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Corrida não encontrada ou permissão negada." });
        }

        const ride = result.rows[0];

        // Notificar via Socket
        if (global.io) {
            global.io.to(`ride_${ride_id}`).emit('ride_cancelled', {
                ride_id,
                cancelled_by: req.user.role,
                reason: reason || 'Cancelado pelo usuário',
                ride: ride
            });

            // Notificação de término forçado
            global.io.to(`ride_${ride_id}`).emit('ride_terminated', {
                reason: req.user.role === 'driver' ? "O motorista cancelou." : "O passageiro cancelou.",
                origin: req.user.role,
                cancelled_at: new Date().toISOString()
            });
        }

        logSystem('RIDE_CANCEL', `Corrida #${ride_id} cancelada por ${req.user.role}.`);
        res.json({
            success: true,
            message: "Corrida cancelada com sucesso.",
            ride: ride
        });

    } catch (e) {
        logError('RIDE_CANCEL_ERROR', e);
        res.status(500).json({ error: "Erro ao cancelar corrida." });
    }
};

/**
 * RIDE HISTORY
 * Rota: GET /api/rides/history
 * Lógica: Retorna lista paginada de corridas com dados do parceiro.
 */
exports.getHistory = async (req, res) => {
    const { limit = 50, offset = 0, status } = req.query;

    try {
        let query = `
            SELECT r.*,
                   CASE
                     WHEN r.passenger_id = $1 THEN d.name
                     ELSE p.name
                   END as counterpart_name,
                   CASE
                     WHEN r.passenger_id = $1 THEN d.photo
                     ELSE p.photo
                   END as counterpart_photo,
                   CASE
                     WHEN r.passenger_id = $1 THEN 'driver'
                     ELSE 'passenger'
                   END as counterpart_role
            FROM rides r
            LEFT JOIN users d ON r.driver_id = d.id
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE (r.passenger_id = $1 OR r.driver_id = $1)
        `;

        const params = [req.user.id];
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
        logError('RIDE_HISTORY_ERROR', e);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
};

/**
 * DRIVER PERFORMANCE STATS
 * Rota: GET /api/driver/performance-stats (Endpoint específico solicitado no driver_home_screen.dart)
 * Lógica: Retorna ganhos do dia, contagem de missões e últimas 5 corridas.
 */
exports.getDriverPerformance = async (req, res) => {
    try {
        // Estatísticas do dia
        const stats = await pool.query(`
            SELECT
                COUNT(*) as missions_count,
                COALESCE(SUM(final_price), 0) as today_earnings
            FROM rides
            WHERE driver_id = $1
            AND status = 'completed'
            AND created_at >= CURRENT_DATE
        `, [req.user.id]);

        // Últimas 5 corridas para o painel
        const recent = await pool.query(`
            SELECT r.*, p.name as passenger_name
            FROM rides r
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE r.driver_id = $1 AND r.status = 'completed'
            ORDER BY r.created_at DESC LIMIT 5
        `, [req.user.id]);

        res.json({
            missions_count: parseInt(stats.rows[0].missions_count),
            today_earnings: parseFloat(stats.rows[0].today_earnings),
            recent_rides: recent.rows
        });

    } catch (e) {
        logError('DRIVER_STATS_ERROR', e);
        res.status(500).json({ error: "Erro ao carregar estatísticas do motorista." });
    }
};

/**
 * GET RIDE DETAILS
 * Rota: GET /api/rides/:id
 */
exports.getRideDetails = async (req, res) => {
    try {
        const data = await getFullRideDetails(req.params.id);

        if (!data) {
            return res.status(404).json({ error: "Corrida não encontrada" });
        }

        // Segurança: Apenas as partes envolvidas ou admin podem ver
        if (data.passenger_id !== req.user.id && data.driver_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Acesso negado." });
        }

        res.json(data);
    } catch (e) {
        logError('RIDE_DETAILS_ERROR', e);
        res.status(500).json({ error: e.message });
    }
};

/**
 * UPDATE STATUS (GENÉRICO)
 * Rota: POST /api/rides/update-status
 * Usado pelo motorista para 'arrived', 'picked_up'.
 */
exports.updateStatus = async (req, res) => {
    const { ride_id, status } = req.body;

    if (!['arrived', 'picked_up'].includes(status)) {
        return res.status(400).json({ error: "Status inválido." });
    }

    try {
        await pool.query(
            "UPDATE rides SET status = $1 WHERE id = $2 AND driver_id = $3",
            [status, ride_id, req.user.id]
        );

        const fullData = await getFullRideDetails(ride_id);

        if (global.io) {
            // Notifica especificamente o passageiro (ex: "Motorista chegou")
            if (status === 'arrived') {
                global.io.to(`ride_${ride_id}`).emit('driver_arrived', fullData);
            }
            global.io.to(`ride_${ride_id}`).emit('ride_status_changed', { ...fullData, status });
        }

        res.json({ success: true });
    } catch (e) {
        logError('UPDATE_STATUS_ERROR', e);
        res.status(500).json({ error: "Erro ao atualizar status." });
    }
};