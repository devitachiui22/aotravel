const { pool } = require('../config/db');
const { logSystem, logError } = require('../utils/logger');
const { getDistance } = require('../utils/helpers');
const { getFullRideDetails } = require('../utils/queries');

/**
 * =================================================================================================
 * 🚗 RIDE CONTROLLER - VERSÃO FULL TITANIUM
 * =================================================================================================
 */

// 1. SOLICITAR CORRIDA
exports.requestRide = async (req, res) => {
    const { origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, ride_type, distance_km } = req.body;
    const passenger_id = req.user.id;

    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng) {
        return res.status(400).json({ error: "Dados de geolocalização incompletos." });
    }

    try {
        // Busca configurações de preço dinâmico
        const priceConfig = await pool.query("SELECT value FROM app_settings WHERE key = 'ride_prices'");
        const prices = priceConfig.rows[0]?.value || {
            base_price: 600, km_rate: 300,
            moto_base: 400, moto_km_rate: 180,
            delivery_base: 1000, delivery_km_rate: 450
        };

        let initial_price;
        if (ride_type === 'moto') initial_price = prices.moto_base + (distance_km * prices.moto_km_rate);
        else if (ride_type === 'delivery') initial_price = prices.delivery_base + (distance_km * prices.delivery_km_rate);
        else initial_price = prices.base_price + (distance_km * prices.km_rate);

        // Preço mínimo de segurança
        initial_price = Math.max(initial_price, 800);

        const result = await pool.query(
            `INSERT INTO rides (passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, final_price, ride_type, distance_km, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW()) RETURNING *`,
            [passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km]
        );
        const ride = result.rows[0];

        const io = req.app.get('io');
        if (io) {
            // Notifica o próprio passageiro
            io.to(`user_${passenger_id}`).emit('searching_started', ride);

            // Busca motoristas num raio de 15km
            const driversRes = await pool.query(`
                SELECT dp.driver_id, dp.lat, dp.lng FROM driver_positions dp
                JOIN users u ON dp.driver_id = u.id
                WHERE u.is_online = true AND u.role = 'driver' AND u.is_blocked = false
                AND dp.last_update > NOW() - INTERVAL '30 minutes'
            `);

            driversRes.rows.forEach(driver => {
                const dist = getDistance(origin_lat, origin_lng, driver.lat, driver.lng);
                if (dist <= 15.0) {
                    io.to(`user_${driver.driver_id}`).emit('ride_opportunity', {
                        ...ride,
                        distance_to_driver: dist
                    });
                }
            });
        }

        logSystem('RIDE_REQUEST', `Corrida ${ride.id} iniciada pelo passageiro ${passenger_id}`);
        res.json(ride);
    } catch (e) {
        logError('RIDE_REQUEST', e);
        res.status(500).json({ error: "Erro interno ao processar solicitação." });
    }
};

// 2. ACEITAR CORRIDA
exports.acceptRide = async (req, res) => {
    const { ride_id, final_price } = req.body;
    const driver_id = req.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const checkRes = await client.query("SELECT status FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
        if (checkRes.rows.length === 0) throw new Error("Corrida inexistente.");
        if (checkRes.rows[0].status !== 'searching') throw new Error("Corrida já aceita por outro motorista.");

        const updateRes = await client.query(
            `UPDATE rides SET driver_id = $1, final_price = COALESCE($2, initial_price), status = 'accepted', accepted_at = NOW()
             WHERE id = $3 RETURNING *`,
            [driver_id, final_price, ride_id]
        );

        await client.query('COMMIT');

        const fullData = await getFullRideDetails(ride_id);
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${fullData.passenger_id}`).emit('match_found', fullData);
            io.to(`user_${driver_id}`).emit('match_found', fullData);
            // Sincroniza a sala da corrida
            io.to(`ride_${ride_id}`).emit('match_found', fullData);
        }

        res.json(fullData);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message });
    } finally {
        client.release();
    }
};

// 3. INICIAR VIAGEM
exports.startRide = async (req, res) => {
    const { ride_id } = req.body;
    try {
        const result = await pool.query(
            `UPDATE rides SET status = 'ongoing', started_at = NOW()
             WHERE id = $1 AND driver_id = $2 RETURNING *`,
            [ride_id, req.user.id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "Corrida não encontrada." });

        const fullData = await getFullRideDetails(ride_id);
        const io = req.app.get('io');
        if (io) io.to(`ride_${ride_id}`).emit('trip_started', fullData);

        res.json(fullData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// 4. FINALIZAR CORRIDA (PONTO CRÍTICO)
exports.completeRide = async (req, res) => {
    const { ride_id, payment_method, rating, feedback } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Busca dados da corrida com trava de linha
        const rideRes = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
        if (rideRes.rows.length === 0) throw new Error("Corrida não encontrada.");

        const ride = rideRes.rows[0];
        if (ride.status === 'completed') {
            await client.query('ROLLBACK');
            return res.json(await getFullRideDetails(ride_id));
        }

        const earnings = ride.final_price || ride.initial_price;
        const method = payment_method || 'cash';

        // 1. Atualiza status da corrida
        await client.query(
            `UPDATE rides SET status = 'completed', payment_method = $1, rating = $2, feedback = $3,
             completed_at = NOW(), payment_status = 'paid' WHERE id = $4`,
            [method, rating || 5, feedback || '', ride_id]
        );

        // 2. Lógica Financeira: Carteira (Wallet)
        if (method === 'wallet') {
            // Debita do passageiro
            await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [earnings, ride.passenger_id]);
            await client.query(
                `INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id, status)
                 VALUES ($1, $2, 'payment', 'Pagamento de Corrida', $3, 'completed')`,
                [ride.passenger_id, -earnings, ride_id]
            );
        }

        // 3. Crédita ao Motorista (Independente do método, o saldo sobe para controle de ganhos)
        await client.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [earnings, ride.driver_id]);
        await client.query(
            `INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id, status)
             VALUES ($1, $2, 'earnings', 'Ganho de Corrida', $3, 'completed')`,
            [ride.driver_id, earnings, ride_id]
        );

        await client.query('COMMIT');

        // 4. Sincronização em Tempo Real (Avisa os Apps para navegarem para tela de recibo)
        const fullDetails = await getFullRideDetails(ride_id);
        const io = req.app.get('io');
        if (io) {
            io.to(`ride_${ride_id}`).emit('ride_completed', {
                status: 'completed',
                full_details: fullDetails
            });
            // Backup por sala de usuário
            io.to(`user_${ride.passenger_id}`).emit('ride_completed', fullDetails);
        }

        logSystem('FINISH', `Ride ${ride_id} concluída com sucesso.`);
        res.json(fullDetails);

    } catch (e) {
        await client.query('ROLLBACK');
        logError('COMPLETE_RIDE_FAIL', e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
};

// 5. CANCELAR CORRIDA
exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;
    try {
        const result = await pool.query(
            `UPDATE rides SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, cancellation_reason = $2
             WHERE id = $3 AND status IN ('searching', 'accepted') RETURNING *`,
            [req.user.role, reason || 'Cancelado pelo usuário', ride_id]
        );

        if (result.rows.length === 0) return res.status(400).json({ error: "Não é possível cancelar esta corrida." });

        const ride = result.rows[0];
        const io = req.app.get('io');
        if (io) {
            io.to(`ride_${ride_id}`).emit('ride_terminated', {
                reason: reason || 'Cancelado pelo usuário',
                origin: req.user.role
            });
        }

        res.json({ success: true, ride });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// 6. HISTÓRICO E DETALHES
exports.getHistory = async (req, res) => {
    const { limit = 20, offset = 0 } = req.query;
    try {
        const userId = req.user.id; // Vem do middleware de auth
        const result = await pool.query(
            `SELECT r.*, u.name as counterpart_name, u.photo as counterpart_photo
             FROM rides r
             JOIN users u ON (CASE WHEN r.passenger_id = $1 THEN r.driver_id = u.id ELSE r.passenger_id = u.id END)
             WHERE (r.passenger_id = $1 OR r.driver_id = $1)
             ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
            [req.user.id, limit, offset]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

exports.getDetails = async (req, res) => {
    try {
        const data = await getFullRideDetails(req.params.id);
        if (!data) return res.status(404).json({ error: "Corrida não encontrada" });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
