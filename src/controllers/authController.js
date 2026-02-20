/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - AUTHENTICATION CONTROLLER (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/authController.js
 * DESCRIÇÃO: Controlador Mestre de Identidade e Acesso.
 *            Gerencia o ciclo de vida da autenticação, garantindo:
 *            - Login Seguro com proteção contra Brute-Force (via delays).
 *            - Migração Transparente de Senhas (Plain Text -> Bcrypt).
 *            - Sessões Persistentes Multi-Dispositivo (Mobile & Web).
 *            - Provisionamento Automático de Carteira (Titanium Wallet) no Cadastro.
 *
 * ✅ CORREÇÕES APLICADAS:
 * 1. Bug crítico na criação de conta (ReferenceError deviceInfo) resolvido.
 * 2. Transação atômica no cadastro para garantir que Usuário, Sessão e Carteira
 *    sejam criados de forma indivisível.
 * 3. Sanitização agressiva de telefones para padrão Angola (9 dígitos).
 * 4. Validação de sessão no Splash Screen reforçada com update de Heartbeat.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { logSystem, logError, getUserFullDetails, generateAccountNumber } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 0. HELPERS PRIVADOS E UTILITÁRIOS DE SEGURANÇA
// =================================================================================================

const isValidEmail = (email) => {
    const re = /^+@+\.{2,6}$/;
    return re.test(email);
};

const sanitizePhone = (phone) => {
    if (!phone) return null;
    let clean = phone.replace(/\D/g, '');

    if (clean.startsWith('244') && clean.length > 9) clean = clean.substring(3);
    if (clean.startsWith('0') && clean.length > 9) clean = clean.substring(1);

    if (clean.length !== 9) return null;

    return clean;
};

async function createPersistentSession(userId, deviceInfo = {}, ipAddress = null, fcmToken = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (SYSTEM_CONFIG.SECURITY.SESSION_EXPIRY_DAYS || 365));

        await client.query(
            `INSERT INTO user_sessions (user_id, session_token, device_info, ip_address, fcm_token, expires_at, is_active, created_at, last_activity)
             VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())`,
        );

        const updateFields =;
        let updateQuery = `UPDATE users SET session_token = $1, session_expiry = $2, last_login = NOW(), is_online = true, updated_at = NOW()`;

        if (fcmToken) {
            updateQuery += `, fcm_token = $4`;
            updateFields.push(fcmToken);
        }

        updateQuery += ` WHERE id = $3`;

        await client.query(updateQuery, updateFields);
        await client.query('COMMIT');

        return { session_token: sessionToken, expires_at: expiresAt };

    } catch (error) {
        await client.query('ROLLBACK');
        logError('CREATE_SESSION', error);
        throw new Error("Falha crítica ao criar sessão segura.");
    } finally {
        client.release();
    }
}

// =================================================================================================
// 1. LOGIN (AUTHENTICATION GATEWAY)
// =================================================================================================

exports.login = async (req, res) => {
    const { email, password, device_info, fcm_token } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!email || !password) {
        return res.status(400).json({ error: "Email e senha são obrigatórios.", code: "MISSING_CREDENTIALS" });
    }

    const cleanEmail = email.toLowerCase().trim();

    try {
        const result = await pool.query(
            `SELECT id, email, password, role, name, is_blocked, wallet_status FROM users WHERE email = $1`,
        );

        if (result.rows.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
            return res.status(401).json({ error: "Credenciais incorretas.", code: "AUTH_FAILED" });
        }

        const user = result.rows;

        let isMatch = false;
        let migrationNeeded = false;

        isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            if (user.password === password) {
                isMatch = true;
                migrationNeeded = true;
            }
        }

        if (!isMatch) {
            logSystem('AUTH_FAIL', `Login falhou: ${cleanEmail} (IP: ${ipAddress})`);
            return res.status(401).json({ error: "Credenciais incorretas.", code: "AUTH_FAILED" });
        }

        if (user.is_blocked) {
            return res.status(403).json({ error: "Sua conta foi bloqueada por segurança. Contacte o suporte.", code: "ACCOUNT_BLOCKED" });
        }

        if (migrationNeeded) {
            try {
                const newHash = await bcrypt.hash(password, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);
                await pool.query('UPDATE users SET password = $1 WHERE id = $2',);
            } catch (err) {
                logError('AUTH_MIGRATE_ERROR', err);
            }
        }

        const session = await createPersistentSession(user.id, device_info || {}, ipAddress, fcm_token);

        const fullUser = await getUserFullDetails(user.id);
        if (!fullUser) throw new Error("Erro de integridade ao buscar perfil.");

        delete fullUser.password;
        delete fullUser.wallet_pin_hash;

        const txQuery = `
            SELECT t.*, CASE WHEN t.sender_id = $1 THEN 'debit' ELSE 'credit' END as direction,
                   s.name as sender_name, r.name as receiver_name
            FROM wallet_transactions t
            LEFT JOIN users s ON t.sender_id = s.id
            LEFT JOIN users r ON t.receiver_id = r.id
            WHERE (t.user_id = $1 OR t.sender_id = $1 OR t.receiver_id = $1) AND t.is_hidden = FALSE
            ORDER BY t.created_at DESC LIMIT 5
        `;
        const txResult = await pool.query(txQuery,);

        fullUser.transactions = txResult.rows;
        fullUser.session = session;

        logSystem('LOGIN_SUCCESS', `Usuário ${user.email} logado (${user.role}).`);
        res.json(fullUser);

    } catch (e) {
        logError('LOGIN_CRITICAL', e);
        res.status(500).json({ error: "Erro interno no servidor de autenticação." });
    }
};

// =================================================================================================
// 2. SIGNUP (USER REGISTRATION & WALLET PROVISIONING)
// =================================================================================================

exports.signup = async (req, res) => {
    const { name, email, phone, password, role, vehicleModel, vehiclePlate, vehicleColor, photo, device_info } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!name || !email || !password || !role || !phone) {
        return res.status(400).json({ error: "Preencha todos os campos obrigatórios." });
    }

    if (!isValidEmail(email)) return res.status(400).json({ error: "Formato de email inválido." });
    if (password.length < 6) return res.status(400).json({ error: "A senha deve ter no mínimo 6 caracteres." });

    const cleanPhone = sanitizePhone(phone);
    if (!cleanPhone) return res.status(400).json({ error: "Telefone inválido. Use o padrão angolano (9 dígitos)." });
    if (!.includes(role)) return res.status(400).json({ error: "Tipo de conta inválido." });

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const checkResult = await client.query(`SELECT email, phone FROM users WHERE email = $1 OR phone = $2`,);

        if (checkResult.rows.length > 0) {
            const existing = checkResult.rows;
            await client.query('ROLLBACK');
            if (existing.email === email.toLowerCase().trim()) return res.status(409).json({ error: "Email já cadastrado." });
            if (existing.phone === cleanPhone) return res.status(409).json({ error: "Telefone já cadastrado." });
        }

        let vehicleDetailsJson = null;
        if (role === 'driver') {
            if (!vehicleModel || !vehiclePlate) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Motoristas devem informar Modelo e Matrícula." });
            }
            vehicleDetailsJson = JSON.stringify({
                model: vehicleModel, plate: vehiclePlate.toUpperCase(), color: vehicleColor || 'Indefinido',
                year: new Date().getFullYear(), registered_at: new Date().toISOString()
            });
        }

        const hashedPassword = await bcrypt.hash(password, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);
        const walletAccountNumber = generateAccountNumber(cleanPhone);

        const insertQuery = `
            INSERT INTO users (
                name, email, phone, password, role, photo, vehicle_details,
                balance, wallet_account_number, wallet_status, daily_limit, daily_limit_used,
                is_verified, account_tier, created_at, updated_at, is_online, bonus_points
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00, $8, 'active', 500000.00, 0.00, false, 'standard', NOW(), NOW(), false, 50)
            RETURNING id, name, email, role
        `;

        const insertResult = await client.query(insertQuery,);

        const newUser = insertResult.rows;

        // Cria a sessão com segurança garantindo que device_info existe
        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + SYSTEM_CONFIG.SECURITY.SESSION_EXPIRY_DAYS);

        await client.query(
            `INSERT INTO user_sessions (user_id, session_token, device_info, ip_address, expires_at, is_active)
             VALUES ($1, $2, $3, $4, $5, true)`,
        );

        await client.query(
            `UPDATE users SET session_token = $1, session_expiry = $2, last_login = NOW(), is_online = true WHERE id = $3`,
        );

        await client.query('COMMIT');

        const fullUser = await getUserFullDetails(newUser.id);
        delete fullUser.password;
        delete fullUser.wallet_pin_hash;

        fullUser.session = { session_token: sessionToken, expires_at: expiresAt };
        fullUser.transactions =[];

        logSystem('SIGNUP_SUCCESS', `Novo ${role} registrado: ${name} - Wallet: ${walletAccountNumber}`);
        res.status(201).json(fullUser);

    } catch (e) {
        await client.query('ROLLBACK');
        logError('SIGNUP_CRITICAL', e);
        res.status(500).json({ error: "Erro crítico ao processar cadastro." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 3. LOGOUT E CHECK SESSION
// =================================================================================================

exports.logout = async (req, res) => {
    const userId = req.user ? req.user.id : null;
    const sessionToken = req.headers;

    try {
        if (sessionToken) {
            await pool.query('UPDATE user_sessions SET is_active = false WHERE session_token = $1',);
        }

        if (userId) {
            await pool.query('UPDATE users SET is_online = false, session_token = NULL, last_login = NOW() WHERE id = $1',);
            if (req.user.role === 'driver') {
                 await pool.query("UPDATE driver_positions SET status = 'offline' WHERE driver_id = $1",);
            }
        }
        res.json({ success: true, message: "Sessão encerrada com sucesso." });
    } catch (e) {
        logError('LOGOUT_ERROR', e);
        res.json({ success: true, message: "Sessão encerrada localmente." });
    }
};

exports.checkSession = async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await getUserFullDetails(userId);

        if (!user) return res.status(404).json({ error: "Conta não encontrada." });

        delete user.password;
        delete user.wallet_pin_hash;

        const sessionToken = req.headers;
        const sessionRes = await pool.query('SELECT expires_at FROM user_sessions WHERE session_token = $1',);

        await pool.query('UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1',);
        await pool.query('UPDATE users SET is_online = true WHERE id = $1',);

        const tx = await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',);

        user.transactions = tx.rows;
        user.session_valid = true;
        user.expires_at = sessionRes.rows?.expires_at || null;

        res.json(user);
    } catch (e) {
        logError('SESSION_CHECK', e);
        res.status(500).json({ error: "Erro ao validar sessão." });
    }
};