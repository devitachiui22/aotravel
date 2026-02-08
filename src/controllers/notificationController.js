const pool = require('../config/db');
const { logError } = require('../utils/logger');

exports.getNotifications = async (req, res) => {
    const { limit = 20, offset = 0, unread_only } = req.query;
    try {
        let query = `SELECT * FROM notifications WHERE user_id = $1`;
        const params = [req.user.id];
        let paramCount = 2;
        if (unread_only === 'true') { query += ` AND is_read = false`; }
        query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) {
        logError('NOTIFICATIONS_GET', e);
        res.status(500).json({ error: "Erro ao buscar notificações." });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true, message: "Notificação marcada como lida." });
    } catch (e) {
        logError('NOTIFICATION_READ', e);
        res.status(500).json({ error: "Erro ao marcar notificação como lida." });
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = $1 AND is_read = false', [req.user.id]);
        res.json({ success: true, message: "Todas notificações marcadas como lidas." });
    } catch (e) {
        logError('NOTIFICATIONS_READ_ALL', e);
        res.status(500).json({ error: "Erro ao marcar notificações como lidas." });
    }
};