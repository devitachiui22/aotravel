/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - AUTHENTICATION CONTROLLER
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/authController.js
 * DESCRIÇÃO: Gerencia o ciclo de vida da identidade do usuário.
 *            Inclui Login, Cadastro (Signup), Logout e Validação de Sessão.
 *            Implementa hashing seguro (Bcrypt) e Sessões Persistentes (1 ano).
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { logSystem, logError, getUserFullDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// HELPERS INTERNOS DE SESSÃO
// =================================================================================================

/**
 * Cria uma sessão persistente no banco de dados.
 * Gera um token único e define a validade (padrão: 1 ano para mobile).
 */
async function createPersistentSession(userId, deviceInfo = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Gerar token de sessão criptograficamente seguro
        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + SYSTEM_CONFIG.SECURITY.SESSION_EXPIRY_DAYS);

        // Criar registro na tabela de sessões
        await client.query(
            `INSERT INTO user_sessions
             (user_id, session_token, device_info, expires_at, is_active)
             VALUES ($1, $2, $3, $4, true)`,
            [userId, sessionToken, JSON.stringify(deviceInfo), expiresAt]
        );

        // Atualizar usuário com o token da sessão atual (para referência rápida)
        await client.query(
            `UPDATE users SET
             session_token = $1,
             session_expiry = $2,
             last_login = NOW(),
             is_online = true
             WHERE id = $3`,
            [sessionToken, expiresAt, userId]
        );

        await client.query('COMMIT');

        return {
            session_token: sessionToken,
            expires_at: expiresAt
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// =================================================================================================
// CONTROLADORES EXPORTADOS
// =================================================================================================

/**
 * LOGIN
 * Rota: POST /api/auth/login
 * Lógica: Verifica credenciais, status de bloqueio, gera sessão e retorna perfil + transações recentes.
 */
exports.login = async (req, res) => {
    const { email, password, device_info, fcm_token } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email e senha são obrigatórios." });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Credenciais incorretas." });
        }

        const user = result.rows[0];

        // 1. Verificação de Senha (Suporta Migração de Texto Plano -> Bcrypt)
        const isBcryptMatch = await bcrypt.compare(password, user.password);
        const isPlainMatch = user.password === password; // Suporte legado temporário

        if (!isBcryptMatch && !isPlainMatch) {
            return res.status(401).json({ error: "Credenciais incorretas." });
        }

        // Se a senha estava em texto plano e o login foi bem sucedido, atualizamos para Hash
        if (isPlainMatch && !isBcryptMatch) {
            const newHash = await bcrypt.hash(password, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);
            await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, user.id]);
            logSystem('AUTH', `Senha do usuário ${user.id} migrada para Bcrypt com sucesso.`);
        }

        // 2. Verificação de Bloqueio
        if (user.is_blocked) {
            return res.status(403).json({ error: "Conta bloqueada. Contacte o suporte." });
        }

        // 3. Criação de Sessão
        const session = await createPersistentSession(user.id, device_info || {});

        // 4. Atualização de Token FCM (Push Notifications)
        if (fcm_token) {
            await pool.query(
                'UPDATE users SET fcm_token = $1 WHERE id = $2',
                [fcm_token, user.id]
            );
            user.fcm_token = fcm_token;
        }

        // 5. Buscar dados financeiros recentes (Requisito do Frontend: Dashboard Home)
        const tx = await pool.query(
            'SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
            [user.id]
        );

        // Preparar resposta
        delete user.password; // Segurança: Nunca retornar a senha/hash
        user.transactions = tx.rows;
        user.session = session;

        logSystem('LOGIN', `Login realizado: ${user.email} (${user.role})`);
        res.json(user);

    } catch (e) {
        logError('LOGIN_ERROR', e);
        res.status(500).json({ error: "Erro interno no servidor de autenticação." });
    }
};

/**
 * SIGNUP (CADASTRO)
 * Rota: POST /api/auth/signup
 * Lógica: Cria usuário, veículo (se motorista), carteira virtual e sessão inicial.
 */
exports.signup = async (req, res) => {
    const { name, email, phone, password, role, vehicleModel, vehiclePlate, vehicleColor, photo, device_info } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({ error: "Nome, email, senha e tipo de conta são obrigatórios." });
    }

    try {
        // 1. Verificar duplicidade de email
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) {
            return res.status(400).json({ error: "Este email já está em uso." });
        }

        // 2. Preparar detalhes do veículo (Apenas Motoristas)
        let vehicleDetails = null;
        if (role === 'driver') {
            if (!vehicleModel || !vehiclePlate) {
                return res.status(400).json({ error: "Modelo e matrícula do veículo são obrigatórios para motoristas." });
            }
            vehicleDetails = JSON.stringify({
                model: vehicleModel,
                plate: vehiclePlate,
                color: vehicleColor || '',
                year: new Date().getFullYear()
            });
        }

        // 3. Hashing da Senha
        const hashedPassword = await bcrypt.hash(password, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);

        // 4. Gerar número de conta virtual (ex: 923456789AO)
        const walletAccount = phone ? (phone.replace(/\D/g, '') + 'AO') : null;

        // 5. Inserção no Banco
        const result = await pool.query(
            `INSERT INTO users (
                name, email, phone, password, role, photo,
                vehicle_details, balance, wallet_account_number,
                created_at, wallet_status, is_verified
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00, $8, NOW(), 'active', false)
             RETURNING id, name, email, phone, role, photo, vehicle_details, balance, wallet_account_number, created_at`,
            [name, email.toLowerCase().trim(), phone, hashedPassword, role, photo, vehicleDetails, walletAccount]
        );

        const newUser = result.rows[0];

        // 6. Criar sessão automática (Auto-Login após cadastro)
        const session = await createPersistentSession(newUser.id, device_info || {});

        logSystem('SIGNUP', `Novo usuário cadastrado: ${name} (${role})`);

        newUser.session = session;
        res.status(201).json(newUser);

    } catch (e) {
        logError('SIGNUP_ERROR', e);
        res.status(500).json({ error: "Erro ao criar conta. Verifique os dados." });
    }
};

/**
 * LOGOUT
 * Rota: POST /api/auth/logout
 * Lógica: Invalida a sessão atual e marca o usuário como offline.
 */
exports.logout = async (req, res) => {
    try {
        const sessionToken = req.headers['x-session-token'];

        if (sessionToken) {
            await pool.query(
                'UPDATE user_sessions SET is_active = false WHERE session_token = $1',
                [sessionToken]
            );
        }

        await pool.query(
            'UPDATE users SET is_online = false, session_token = NULL WHERE id = $1',
            [req.user.id]
        );

        logSystem('LOGOUT', `Usuário ${req.user.email} desconectado.`);
        res.json({ success: true, message: "Logout realizado com sucesso." });
    } catch (e) {
        logError('LOGOUT_ERROR', e);
        res.status(500).json({ error: "Erro ao processar logout." });
    }
};

/**
 * CHECK SESSION
 * Rota: GET /api/auth/session
 * Lógica: Verifica se o token de sessão é válido e retorna dados atualizados do usuário.
 *         (Middleware já valida a existência, aqui retornamos o payload).
 */
exports.checkSession = async (req, res) => {
    // O middleware 'authenticateToken' já garantiu que req.user existe e é válido.
    try {
        const user = await getUserFullDetails(req.user.id);

        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        delete user.password; // Redundância de segurança

        // Buscar dados de sessão para retornar expiry atualizado
        const sessionRes = await pool.query(
            'SELECT expires_at FROM user_sessions WHERE session_token = $1',
            [req.headers['x-session-token']]
        );

        res.json({
            user: user,
            session_valid: true,
            expires_at: sessionRes.rows[0]?.expires_at || null
        });
    } catch (e) {
        logError('SESSION_CHECK', e);
        res.status(500).json({ error: "Erro ao recuperar dados da sessão." });
    }
};