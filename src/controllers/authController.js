const { pool } = require('../config/db'); // CORREÇÃO: Desestruturação obrigatória
const { logSystem, logError } = require('../utils/logger');
const { getUserFullDetails } = require('../utils/queries');
const crypto = require('crypto');

// Helpers de sessão locais
async function createPersistentSession(userId, deviceInfo = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);

        await client.query(
            `INSERT INTO user_sessions (user_id, session_token, device_info, expires_at, is_active)
             VALUES ($1, $2, $3, $4, true)`,
            [userId, sessionToken, JSON.stringify(deviceInfo), expiresAt]
        );

        await client.query(
            `UPDATE users SET session_token = $1, session_expiry = $2, last_login = NOW(), is_online = true WHERE id = $3`,
            [sessionToken, expiresAt, userId]
        );

        await client.query('COMMIT');
        return { session_token: sessionToken, expires_at: expiresAt };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function validateSession(sessionToken) {
    try {
        const result = await pool.query(
            `SELECT u.* FROM users u
             JOIN user_sessions s ON u.id = s.user_id
             WHERE s.session_token = $1 AND s.is_active = true AND (s.expires_at IS NULL OR s.expires_at > NOW())`,
            [sessionToken]
        );
        if (result.rows.length > 0) {
            await pool.query('UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1', [sessionToken]);
            return result.rows[0];
        }
        return null;
    } catch (error) {
        logError('SESSION_VALIDATE', error);
        return null;
    }
}

exports.login = async (req, res) => {
    const { email, password, device_info, fcm_token } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email e senha são obrigatórios." });

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (result.rows.length === 0) return res.status(401).json({ error: "Credenciais incorretas." });

        const user = result.rows[0];
        if (user.password !== password) return res.status(401).json({ error: "Credenciais incorretas." });
        if (user.is_blocked) return res.status(403).json({ error: "Conta bloqueada. Contacte o suporte." });

        const session = await createPersistentSession(user.id, device_info || {});

        if (fcm_token) {
            await pool.query('UPDATE users SET fcm_token = $1 WHERE id = $2', [fcm_token, user.id]);
            user.fcm_token = fcm_token;
        }

        const tx = await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5', [user.id]);
        delete user.password;
        user.transactions = tx.rows;
        user.session = session;

        logSystem('LOGIN', `Usuário ${user.email} fez login com sucesso.`);
        res.json(user);
    } catch (e) {
        logError('LOGIN', e);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
};

exports.signup = async (req, res) => {
    const { name, email, phone, password, role, vehicleModel, vehiclePlate, vehicleColor, photo } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: "Nome, email, senha e tipo de conta são obrigatórios." });

    try {
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) return res.status(400).json({ error: "Este email já está em uso." });

        let vehicleDetails = null;
        if (role === 'driver') {
            if (!vehicleModel || !vehiclePlate) return res.status(400).json({ error: "Modelo e matrícula do veículo são obrigatórios para motoristas." });
            vehicleDetails = JSON.stringify({ model: vehicleModel, plate: vehiclePlate, color: vehicleColor || '', year: new Date().getFullYear() });
        }

        const hashedPassword = password; 
        const result = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, photo, vehicle_details, balance, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00, NOW())
             RETURNING id, name, email, phone, role, photo, vehicle_details, balance, created_at`,
            [name, email.toLowerCase().trim(), phone, hashedPassword, role, photo, vehicleDetails]
        );

        const newUser = result.rows[0];
        const session = await createPersistentSession(newUser.id, req.body.device_info || {});
        logSystem('SIGNUP', `Novo usuário cadastrado: ${name} (${role})`);
        newUser.session = session;
        res.status(201).json(newUser);
    } catch (e) {
        logError('SIGNUP', e);
        res.status(500).json({ error: "Erro ao criar conta." });
    }
};

exports.logout = async (req, res) => {
    try {
        const sessionToken = req.headers['x-session-token'];
        if (sessionToken) await pool.query('UPDATE user_sessions SET is_active = false WHERE session_token = $1', [sessionToken]);
        await pool.query('UPDATE users SET is_online = false, session_token = NULL WHERE id = $1', [req.user.id]);
        logSystem('LOGOUT', `Usuário ${req.user.email} fez logout.`);
        res.json({ success: true, message: "Logout realizado com sucesso." });
    } catch (e) {
        logError('LOGOUT', e);
        res.status(500).json({ error: "Erro ao fazer logout." });
    }
};

exports.checkSession = async (req, res) => {
    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) return res.status(401).json({ error: 'Sessão não fornecida ou token ausente' });

    try {
        const user = await validateSession(sessionToken);
        if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada' });
        const fullUser = await getUserFullDetails(user.id);
        if (!fullUser) return res.status(404).json({ error: 'Usuário não encontrado na base de dados' });
        if (fullUser.password) delete fullUser.password;
        res.json({ user: fullUser, session_valid: true, expires_at: user.session_expiry });
    } catch (e) {
        console.error('❌ [SESSION_CHECK] ERRO CRÍTICO:', e.message);
        res.status(500).json({ error: 'Erro interno ao processar verificação de sessão' });
    }
};