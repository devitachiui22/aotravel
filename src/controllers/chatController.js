const pool = require('../config/db');
const { logError } = require('../utils/logger');

exports.getHistory = async (req, res) => {
    try {
        const rideCheck = await pool.query('SELECT * FROM rides WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2)', [req.params.ride_id, req.user.id]);
        if (rideCheck.rows.length === 0 && req.user.role !== 'admin') return res.status(403).json({ error: "Acesso negado." });

        const messages = await pool.query(
            `SELECT cm.*, u.name as sender_name, u.photo as sender_photo FROM chat_messages cm JOIN users u ON cm.sender_id = u.id WHERE cm.ride_id = $1 ORDER BY cm.created_at ASC`,
            [req.params.ride_id]
        );
        res.json(messages.rows);
    } catch (e) {
        logError('CHAT_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar mensagens." });
    }
};