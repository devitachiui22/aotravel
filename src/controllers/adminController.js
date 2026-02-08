const pool = require('../config/db');
const { logSystem, logError } = require('../utils/logger');
const { getUserFullDetails } = require('../utils/queries');

exports.getStats = async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT (SELECT COUNT(*) FROM users) as total_users, (SELECT COUNT(*) FROM users WHERE role = 'driver') as total_drivers,
            (SELECT COUNT(*) FROM users WHERE role = 'passenger') as total_passengers, (SELECT COUNT(*) FROM users WHERE is_online = true) as online_users,
            (SELECT COUNT(*) FROM rides) as total_rides, (SELECT COUNT(*) FROM rides WHERE status = 'completed') as completed_rides,
            (SELECT COUNT(*) FROM rides WHERE status = 'ongoing') as ongoing_rides, (SELECT COUNT(*) FROM rides WHERE status = 'searching') as searching_rides,
            (SELECT COALESCE(SUM(final_price), 0) FROM rides WHERE status = 'completed' AND completed_at >= CURRENT_DATE) as today_earnings,
            (SELECT COALESCE(SUM(balance), 0) FROM users) as total_balances
        `);
        const recentRides = await pool.query(`SELECT r.*, p.name as passenger_name, d.name as driver_name FROM rides r LEFT JOIN users p ON r.passenger_id = p.id LEFT JOIN users d ON r.driver_id = d.id ORDER BY r.created_at DESC LIMIT 10`);
        const recentUsers = await pool.query(`SELECT id, name, email, role, created_at, is_online FROM users ORDER BY created_at DESC LIMIT 10`);
        res.json({ stats: stats.rows[0], recent_rides: recentRides.rows, recent_users: recentUsers.rows });
    } catch (e) {
        logError('ADMIN_STATS', e);
        res.status(500).json({ error: "Erro ao buscar estatísticas." });
    }
};

exports.getUsers = async (req, res) => {
    const { role, is_online, is_blocked, search, limit = 50, offset = 0 } = req.query;
    try {
        let query = `SELECT id, name, email, phone, role, photo, balance, is_online, rating, is_blocked, is_verified, created_at, last_login FROM users WHERE 1=1`;
        const params = [];
        let paramCount = 1;
        if (role) { query += ` AND role = $${paramCount}`; params.push(role); paramCount++; }
        if (is_online !== undefined) { query += ` AND is_online = $${paramCount}`; params.push(is_online === 'true'); paramCount++; }
        if (is_blocked !== undefined) { query += ` AND is_blocked = $${paramCount}`; params.push(is_blocked === 'true'); paramCount++; }
        if (search) { query += ` AND (name ILIKE $${paramCount} OR email ILIKE $${paramCount} OR phone ILIKE $${paramCount})`; params.push(`%${search}%`); paramCount++; }
        query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);
        const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
        const countResult = await pool.query(countQuery, params.slice(0, -2));
        res.json({ users: result.rows, total: parseInt(countResult.rows[0].count), limit: parseInt(limit), offset: parseInt(offset) });
    } catch (e) {
        logError('ADMIN_USERS', e);
        res.status(500).json({ error: "Erro ao listar usuários." });
    }
};

exports.getUserDetails = async (req, res) => {
    try {
        const user = await getUserFullDetails(req.params.id);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
        const rides = await pool.query(`SELECT * FROM rides WHERE passenger_id = $1 OR driver_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.params.id]);
        const transactions = await pool.query(`SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.params.id]);
        const documents = await pool.query(`SELECT * FROM user_documents WHERE user_id = $1 ORDER BY created_at DESC`, [req.params.id]);
        delete user.password;
        res.json({ user: user, rides: rides.rows, transactions: transactions.rows, documents: documents.rows });
    } catch (e) {
        logError('ADMIN_USER_DETAILS', e);
        res.status(500).json({ error: "Erro ao buscar detalhes do usuário." });
    }
};

exports.updateUser = async (req, res) => {
    const { is_blocked, is_verified, role, balance, vehicle_details } = req.body;
    try {
        const updates = [];
        const values = [];
        let paramCount = 1;
        if (is_blocked !== undefined) { updates.push(`is_blocked = $${paramCount}`); values.push(is_blocked); paramCount++; }
        if (is_verified !== undefined) { updates.push(`is_verified = $${paramCount}`); values.push(is_verified); paramCount++; }
        if (role !== undefined) { updates.push(`role = $${paramCount}`); values.push(role); paramCount++; }
        if (balance !== undefined) { updates.push(`balance = $${paramCount}`); values.push(parseFloat(balance)); paramCount++; }
        if (vehicle_details !== undefined) { updates.push(`vehicle_details = $${paramCount}`); values.push(JSON.stringify(vehicle_details)); paramCount++; }
        if (updates.length === 0) return res.status(400).json({ error: "Nenhum dado para atualizar." });
        updates.push(`updated_at = NOW()`);
        values.push(req.params.id);
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        const result = await pool.query(query, values);
        const updatedUser = result.rows[0];
        delete updatedUser.password;
        logSystem('ADMIN_USER_UPDATE', `Usuário ${req.params.id} atualizado por admin ${req.user.id}`);
        res.json(updatedUser);
    } catch (e) {
        logError('ADMIN_USER_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar usuário." });
    }
};

exports.verifyDocument = async (req, res) => {
    const { status, rejection_reason } = req.body;
    if (!status || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: "Status inválido." });
    if (status === 'rejected' && !rejection_reason) return res.status(400).json({ error: "Motivo da rejeição é obrigatório." });

    try {
        const result = await pool.query(
            `UPDATE user_documents SET status = $1, verified_by = $2, verified_at = NOW(), rejection_reason = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
            [status, req.user.id, rejection_reason || null, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Documento não encontrado." });
        const document = result.rows[0];
        if (status === 'approved') {
            const pendingDocs = await pool.query(`SELECT COUNT(*) FROM user_documents WHERE user_id = $1 AND status != 'approved'`, [document.user_id]);
            if (parseInt(pendingDocs.rows[0].count) === 0) await pool.query('UPDATE users SET is_verified = true WHERE id = $1', [document.user_id]);
        }
        logSystem('DOCUMENT_VERIFY', `Documento ${req.params.id} ${status} por admin ${req.user.id}`);
        res.json({ success: true, message: `Documento ${status === 'approved' ? 'aprovado' : 'rejeitado'} com sucesso.`, document: document });
    } catch (e) {
        logError('DOCUMENT_VERIFY', e);
        res.status(500).json({ error: "Erro ao verificar documento." });
    }
};

exports.getRides = async (req, res) => {
    const { status, date_from, date_to, limit = 50, offset = 0 } = req.query;
    try {
        let query = `SELECT r.*, p.name as passenger_name, d.name as driver_name, p.phone as passenger_phone, d.phone as driver_phone FROM rides r LEFT JOIN users p ON r.passenger_id = p.id LEFT JOIN users d ON r.driver_id = d.id WHERE 1=1`;
        const params = [];
        let paramCount = 1;
        if (status) { query += ` AND r.status = $${paramCount}`; params.push(status); paramCount++; }
        if (date_from) { query += ` AND r.created_at >= $${paramCount}`; params.push(date_from); paramCount++; }
        if (date_to) { query += ` AND r.created_at <= $${paramCount}`; params.push(date_to); paramCount++; }
        query += ` ORDER BY r.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        const result = await pool.query(query, params);
        const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
        const countResult = await pool.query(countQuery, params.slice(0, -2));
        res.json({ rides: result.rows, total: parseInt(countResult.rows[0].count), limit: parseInt(limit), offset: parseInt(offset) });
    } catch (e) {
        logError('ADMIN_RIDES', e);
        res.status(500).json({ error: "Erro ao listar corridas." });
    }
};

exports.generateReport = async (req, res) => {
    const { report_type, date_from, date_to } = req.body;
    if (!report_type) return res.status(400).json({ error: "Tipo de relatório é obrigatório." });
    try {
        let reportData = {};
        if (report_type === 'financial') {
            const financialData = await pool.query(`SELECT DATE(created_at) as date, COUNT(*) as total_rides, SUM(final_price) as total_revenue, SUM(final_price * 0.2) as platform_earnings, SUM(final_price * 0.8) as driver_earnings FROM rides WHERE status = 'completed' AND created_at BETWEEN $1 AND $2 GROUP BY DATE(created_at) ORDER BY date DESC`, [date_from || '1900-01-01', date_to || '2100-01-01']);
            reportData = financialData.rows;
        } else if (report_type === 'user_activity') {
            const userActivity = await pool.query(`SELECT role, COUNT(*) as total_users, SUM(CASE WHEN is_online THEN 1 ELSE 0 END) as online_users, AVG(rating) as avg_rating, SUM(balance) as total_balance FROM users GROUP BY role`);
            reportData = userActivity.rows;
        } else if (report_type === 'ride_metrics') {
            const rideMetrics = await pool.query(`SELECT status, COUNT(*) as count, AVG(distance_km) as avg_distance, AVG(final_price) as avg_price, AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60) as avg_duration_minutes FROM rides WHERE created_at BETWEEN $1 AND $2 GROUP BY status`, [date_from || '1900-01-01', date_to || '2100-01-01']);
            reportData = rideMetrics.rows;
        } else {
            return res.status(400).json({ error: "Tipo de relatório inválido." });
        }
        const report = await pool.query(`INSERT INTO admin_reports (report_type, data, generated_by) VALUES ($1, $2, $3) RETURNING *`, [report_type, JSON.stringify(reportData), req.user.id]);
        res.json({ success: true, report_id: report.rows[0].id, generated_at: new Date().toISOString(), data: reportData });
    } catch (e) {
        logError('ADMIN_REPORT', e);
        res.status(500).json({ error: "Erro ao gerar relatório." });
    }
};

exports.getSettings = async (req, res) => {
    try {
        const settings = await pool.query('SELECT * FROM app_settings ORDER BY key');
        res.json(settings.rows);
    } catch (e) {
        logError('ADMIN_SETTINGS', e);
        res.status(500).json({ error: "Erro ao buscar configurações." });
    }
};

exports.updateSetting = async (req, res) => {
    const { value, description } = req.body;
    if (!value) return res.status(400).json({ error: "Valor é obrigatório." });
    try {
        const result = await pool.query(
            `INSERT INTO app_settings (key, value, description, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, description = $3, updated_at = NOW() RETURNING *`,
            [req.params.key, JSON.stringify(value), description || null]
        );
        res.json({ success: true, setting: result.rows[0], message: "Configuração atualizada com sucesso." });
    } catch (e) {
        logError('ADMIN_SETTING_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar configuração." });
    }
};