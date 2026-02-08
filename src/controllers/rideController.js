const pool = require('../config/db');
const { logSystem, logError } = require('../utils/logger');
const { getDistance } = require('../utils/helpers');
const { getFullRideDetails } = require('../utils/queries');

// Nota: O Socket 'io' deve ser passado para estas funções se formos notificar por aqui,
// mas para manter a estrutura REST separada, as notificações via Socket aqui estão sendo
// referenciadas. No app.js/server.js global, exportaremos o io, ou simplificamos.
// Para este refatoramento, vou assumir que 'req.app.get("io")' funciona ou importamos um singleton.
// MAS, para garantir zero falhas, vou usar uma abordagem direta se o servidor global expor o io.
// No server.js faremos `app.set('io', io)`.

exports.requestRide = async (req, res) => {
    const { origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, ride_type, distance_km } = req.body;
    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng || !origin_name || !dest_name) return res.status(400).json({ error: "Dados de origem e destino são obrigatórios." });

    try {
        const priceConfig = await pool.query("SELECT value FROM app_settings WHERE key = 'ride_prices'");
        const prices = priceConfig.rows[0]?.value || { base_price: 600, km_rate: 300, moto_base: 400, moto_km_rate: 180, delivery_base: 1000, delivery_km_rate: 450 };

        let initial_price;
        if (ride_type === 'moto') initial_price = prices.moto_base + (distance_km * prices.moto_km_rate);
        else if (ride_type === 'delivery') initial_price = prices.delivery_base + (distance_km * prices.delivery_km_rate);
        else initial_price = prices.base_price + (distance_km * prices.km_rate);
        initial_price = Math.max(initial_price, 800);

        const result = await pool.query(
            `INSERT INTO rides (passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, final_price, ride_type, distance_km, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW()) RETURNING *`,
            [req.user.id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km]
        );
        const ride = result.rows[0];

        const io = req.app.get('io');
        if (io) {
            io.emit('new_ride_request', ride);
            const driversRes = await pool.query(`
                SELECT dp.*, u.name, u.photo, u.rating, u.vehicle_details FROM driver_positions dp
                JOIN users u ON dp.driver_id = u.id
                WHERE u.is_online = true AND u.role = 'driver' AND u.is_blocked = false AND dp.last_update > NOW() - INTERVAL '30 minutes'
            `);
            const nearbyDrivers = driversRes.rows.filter(driver => getDistance(origin_lat, origin_lng, driver.lat, driver.lng) <= 15.0);
            nearbyDrivers.forEach(driver => {
                io.to(`user_${driver.driver_id}`).emit('ride_opportunity', { ...ride, driver_distance: getDistance(origin_lat, origin_lng, driver.lat, driver.lng) });
            });
        }

        logSystem('RIDE_REQUEST', `Corrida ${ride.id} solicitada por ${req.user.id}`);
        res.json(ride);
    } catch (e) {
        logError('RIDE_REQUEST', e);
        res.status(500).json({ error: "Erro ao solicitar corrida." });
    }
};

exports.acceptRide = async (req, res) => {
    const { ride_id, final_price } = req.body;
    if (!ride_id) return res.status(400).json({ error: "ID da corrida é obrigatório." });
    if (req.user.role !== 'driver') return res.status(403).json({ error: "Apenas motoristas podem aceitar corridas." });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const checkRes = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
        if (checkRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: "Corrida não encontrada." }); }
        const ride = checkRes.rows[0];
        if (ride.status !== 'searching') { await client.query('ROLLBACK'); return res.status(400).json({ error: "Esta corrida já foi aceita ou está em andamento.", current_status: ride.status }); }

        const updateRes = await client.query(
            `UPDATE rides SET driver_id = $1, final_price = COALESCE($2, initial_price), status = 'accepted', accepted_at = NOW() WHERE id = $3 RETURNING *`,
            [req.user.id, final_price || ride.initial_price, ride_id]
        );
        await client.query('COMMIT');
        
        const fullData = await getFullRideDetails(ride_id);
        const io = req.app.get('io');
        if (io) {
            io.to(`ride_${ride_id}`).emit('match_found', fullData);
            io.to(`user_${ride.passenger_id}`).emit('ride_accepted', fullData);
            io.to(`user_${req.user.id}`).emit('ride_accepted_confirmation', fullData);
        }
        logSystem('RIDE_ACCEPT', `Corrida ${ride_id} aceita por ${req.user.id}`);
        res.json(fullData);
    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_ACCEPT', e);
        res.status(500).json({ error: "Erro ao aceitar corrida." });
    } finally {
        client.release();
    }
};

exports.startRide = async (req, res) => {
    const { ride_id } = req.body;
    if (!ride_id) return res.status(400).json({ error: "ID da corrida é obrigatório." });
    try {
        const result = await pool.query(
            `UPDATE rides SET status = 'ongoing', started_at = NOW() WHERE id = $1 AND (driver_id = $2 OR passenger_id = $2) RETURNING *`,
            [ride_id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Corrida não encontrada ou permissão negada." });
        
        const fullData = await getFullRideDetails(ride_id);
        const io = req.app.get('io');
        if (io) io.to(`ride_${ride_id}`).emit('trip_started', fullData);
        
        logSystem('RIDE_START', `Corrida ${ride_id} iniciada por ${req.user.id}`);
        res.json(fullData);
    } catch (e) {
        logError('RIDE_START', e);
        res.status(500).json({ error: "Erro ao iniciar corrida." });
    }
};

exports.completeRide = async (req, res) => {
    const { ride_id, rating, feedback, payment_method } = req.body;
    if (!ride_id) return res.status(400).json({ error: "ID da corrida é obrigatório." });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const rideRes = await client.query(`SELECT * FROM rides WHERE id = $1 FOR UPDATE`, [ride_id]);
        if (rideRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: "Corrida não encontrada." }); }
        
        const ride = rideRes.rows[0];
        const io = req.app.get('io');

        if (ride.status === 'completed') {
            await client.query('COMMIT');
            const existingData = await getFullRideDetails(ride_id);
            if(io) io.to(`ride_${ride_id}`).emit('ride_completed', existingData);
            return res.json({ success: true, message: "Corrida já foi finalizada anteriormente.", ...existingData });
        }

        if (ride.status !== 'ongoing') { await client.query('ROLLBACK'); return res.status(400).json({ error: "Corrida não está em andamento.", current_status: ride.status }); }

        const driverEarnings = ride.final_price || ride.initial_price;
        const finalRating = rating || 5;
        const finalFeedback = feedback || '';
        const finalPaymentMethod = payment_method || 'cash';

        await client.query(
            `UPDATE rides SET status = 'completed', rating = $1, feedback = $2, payment_method = $3, payment_status = 'paid', completed_at = NOW() WHERE id = $4`,
            [finalRating, finalFeedback, finalPaymentMethod, ride_id]
        );

        await client.query(
            `INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id, status) VALUES ($1, $2, 'earnings', 'Corrida finalizada', $3, 'completed')`,
            [ride.driver_id, driverEarnings, ride_id]
        );
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [driverEarnings, ride.driver_id]);

        if (finalPaymentMethod === 'wallet') {
            await client.query(
                `INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id, status) VALUES ($1, $2, 'payment', 'Pagamento de corrida', $3, 'completed')`,
                [ride.passenger_id, -driverEarnings, ride_id]
            );
            await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [driverEarnings, ride.passenger_id]);
        }

        await client.query('COMMIT');
        const fullData = await getFullRideDetails(ride_id);
        
        if (io) {
            io.to(`ride_${ride_id}`).emit('ride_completed', fullData);
            io.to(`user_${ride.passenger_id}`).emit('ride_completed', fullData);
            io.to(`user_${ride.driver_id}`).emit('ride_completed', fullData);
        }

        logSystem('RIDE_COMPLETE', `Corrida ${ride_id} finalizada. Método: ${finalPaymentMethod}`);
        res.json(fullData);
    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_COMPLETE', e);
        res.status(500).json({ error: "Erro ao processar finalização.", details: e.message });
    } finally {
        client.release();
    }
};

exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;
    if (!ride_id) return res.status(400).json({ error: "ID da corrida é obrigatório." });

    try {
        const result = await pool.query(
            `UPDATE rides SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, cancellation_reason = $2 WHERE id = $3 AND (passenger_id = $1 OR driver_id = $1) RETURNING *`,
            [req.user.role, reason || 'Cancelado pelo usuário', ride_id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Corrida não encontrada ou permissão negada." });
        const ride = result.rows[0];

        const io = req.app.get('io');
        if (io) {
            io.to(`ride_${ride_id}`).emit('ride_cancelled', { ride_id, cancelled_by: req.user.role, reason: reason || 'Cancelado pelo usuário', ride: ride });
        }

        logSystem('RIDE_CANCEL', `Corrida ${ride_id} cancelada por ${req.user.id}`);
        res.json({ success: true, message: "Corrida cancelada com sucesso.", ride: ride });
    } catch (e) {
        logError('RIDE_CANCEL', e);
        res.status(500).json({ error: "Erro ao cancelar corrida." });
    }
};

exports.getHistory = async (req, res) => {
    const { limit = 50, offset = 0, status } = req.query;
    try {
        let query = `SELECT r.*, CASE WHEN r.passenger_id = $1 THEN d.name ELSE p.name END as counterpart_name, CASE WHEN r.passenger_id = $1 THEN d.photo ELSE p.photo END as counterpart_photo, CASE WHEN r.passenger_id = $1 THEN 'driver' ELSE 'passenger' END as counterpart_role FROM rides r LEFT JOIN users d ON r.driver_id = d.id LEFT JOIN users p ON r.passenger_id = p.id WHERE (r.passenger_id = $1 OR r.driver_id = $1)`;
        const params = [req.user.id];
        let paramCount = 2;
        if (status) { query += ` AND r.status = $${paramCount}`; params.push(status); paramCount++; }
        query += ` ORDER BY r.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) {
        logError('RIDE_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
};

exports.getDetails = async (req, res) => {
    try {
        const data = await getFullRideDetails(req.params.id);
        if (!data) return res.status(404).json({ error: "Corrida não encontrada" });
        if (data.passenger_id !== req.user.id && data.driver_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: "Acesso negado." });
        res.json(data);
    } catch (e) {
        logError('RIDE_DETAILS', e);
        res.status(500).json({ error: e.message });
    }
};