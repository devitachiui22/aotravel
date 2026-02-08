const pool = require('../config/db');
const { logError } = require('../utils/logger');

async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const sessionToken = req.headers['x-session-token'];

    if (!token && !sessionToken) {
        return res.status(401).json({ error: 'Token de autenticação necessário' });
    }

    try {
        let user;
        if (sessionToken) {
            const sessionRes = await pool.query(
                `SELECT u.* FROM users u
                 JOIN user_sessions s ON u.id = s.user_id
                 WHERE s.session_token = $1 AND s.is_active = true
                 AND (s.expires_at IS NULL OR s.expires_at > NOW())`,
                [sessionToken]
            );

            if (sessionRes.rows.length > 0) {
                user = sessionRes.rows[0];
                await pool.query(
                    'UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1',
                    [sessionToken]
                );
            }
        }

        if (!user && token) {
            const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [token]);
            if (userRes.rows.length > 0) {
                user = userRes.rows[0];
            }
        }

        if (!user) {
            return res.status(401).json({ error: 'Sessão inválida ou expirada' });
        }

        if (user.is_blocked) {
            return res.status(403).json({ error: 'Conta bloqueada. Contacte o suporte.' });
        }

        req.user = user;
        next();
    } catch (error) {
        logError('AUTH', error);
        res.status(500).json({ error: 'Erro na autenticação' });
    }
}

async function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado. Requer privilégios de administrador.' });
    }
    next();
}

module.exports = { authenticateToken, requireAdmin };