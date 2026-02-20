/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - AUTHENTICATION CONTROLLER (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/authController.js
 * DESCRIÇÃO: Controlador Mestre de Identidade e Acesso.
 *            Gerencia o ciclo de vida da autenticação.
 *
 * ✅ CORREÇÕES APLICADAS:
 * 1. ✅ Tratamento de erros melhorado
 * 2. ✅ Logs detalhados para diagnóstico
 * 3. ✅ Validação de email corrigida
 * 4. ✅ Migração de senhas funcionando
 * 5. ✅ Sessões persistentes
 *
 * STATUS: PRODUCTION READY - CORRIGIDO
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

/**
 * Validação de email usando regex robusto
 */
const isValidEmail = (email) => {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return re.test(email);
};

/**
 * Sanitiza número de telefone para padrão Angola (9 dígitos)
 */
const sanitizePhone = (phone) => {
    if (!phone) return null;
    let clean = phone.replace(/\D/g, '');

    // Remove código de Angola (+244) se presente
    if (clean.startsWith('244') && clean.length > 9) clean = clean.substring(3);
    // Remove zero inicial se presente
    if (clean.startsWith('0') && clean.length > 9) clean = clean.substring(1);

    // Valida se tem exatamente 9 dígitos
    if (clean.length !== 9) return null;

    return clean;
};

/**
 * Cria uma sessão persistente para o usuário
 */
async function createPersistentSession(userId, deviceInfo = {}, ipAddress = null, fcmToken = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (SYSTEM_CONFIG.SECURITY.SESSION_EXPIRY_DAYS || 365));

        // Insere a sessão
        await client.query(
            `INSERT INTO user_sessions (user_id, session_token, device_info, ip_address, fcm_token, expires_at, is_active, created_at, last_activity)
             VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())`,
            [userId, sessionToken, deviceInfo || {}, ipAddress, fcmToken, expiresAt]
        );

        // Atualiza o usuário com o token da sessão atual
        await client.query(
            `UPDATE users SET 
                session_token = $1, 
                session_expiry = $2, 
                last_login = NOW(), 
                is_online = true, 
                updated_at = NOW() 
             WHERE id = $3`,
            [sessionToken, expiresAt, userId]
        );

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
// 1. LOGIN (AUTHENTICATION GATEWAY) - CORRIGIDO COM LOGS DETALHADOS
// =================================================================================================

exports.login = async (req, res) => {
    const { email, password, device_info, fcm_token } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    console.log(`🔐 [LOGIN] Tentativa de login para email: ${email}`);

    if (!email || !password) {
        console.log(`❌ [LOGIN] Credenciais faltando`);
        return res.status(400).json({ error: "Email e senha são obrigatórios.", code: "MISSING_CREDENTIALS" });
    }

    const cleanEmail = email.toLowerCase().trim();

    try {
        console.log(`🔍 [LOGIN] Buscando usuário: ${cleanEmail}`);
        
        const result = await pool.query(
            `SELECT id, email, password, role, name, is_blocked, wallet_status, is_verified, photo, phone, rating, balance
             FROM users WHERE email = $1`,
            [cleanEmail]
        );

        if (result.rows.length === 0) {
            console.log(`❌ [LOGIN] Usuário não encontrado: ${cleanEmail}`);
            // Delay anti-bruteforce
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
            return res.status(401).json({ error: "Credenciais incorretas.", code: "AUTH_FAILED" });
        }

        const user = result.rows[0];
        console.log(`✅ [LOGIN] Usuário encontrado: ${user.id} - ${user.name}`);

        let isMatch = false;
        let migrationNeeded = false;

        // Tenta bcrypt primeiro
        try {
            isMatch = await bcrypt.compare(password, user.password);
            console.log(`🔐 [LOGIN] Verificação bcrypt: ${isMatch ? 'sucesso' : 'falha'}`);
        } catch (bcryptError) {
            console.log(`⚠️ [LOGIN] Erro no bcrypt, tentando comparação direta: ${bcryptError.message}`);
        }

        // Se falhar, verifica se é senha em texto puro (migração)
        if (!isMatch) {
            if (user.password === password) {
                isMatch = true;
                migrationNeeded = true;
                console.log(`⚠️ [LOGIN] Senha em texto puro detectada, migração necessária`);
            }
        }

        if (!isMatch) {
            console.log(`❌ [LOGIN] Senha incorreta para usuário: ${user.id}`);
            logSystem('AUTH_FAIL', `Login falhou: ${cleanEmail} (IP: ${ipAddress})`);
            return res.status(401).json({ error: "Credenciais incorretas.", code: "AUTH_FAILED" });
        }

        if (user.is_blocked) {
            console.log(`🚫 [LOGIN] Usuário bloqueado: ${user.id}`);
            return res.status(403).json({ error: "Sua conta foi bloqueada por segurança. Contacte o suporte.", code: "ACCOUNT_BLOCKED" });
        }

        // Migração de senha se necessário
        if (migrationNeeded) {
            try {
                const newHash = await bcrypt.hash(password, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);
                await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, user.id]);
                console.log(`✅ [LOGIN] Senha migrada com sucesso para bcrypt`);
            } catch (err) {
                logError('AUTH_MIGRATE_ERROR', err);
                console.log(`❌ [LOGIN] Falha na migração de senha: ${err.message}`);
                // Não interrompe o fluxo se a migração falhar
            }
        }

        // Cria sessão
        console.log(`🔑 [LOGIN] Criando sessão para usuário: ${user.id}`);
        const session = await createPersistentSession(user.id, device_info || {}, ipAddress, fcm_token);

        // Busca dados completos do usuário
        const fullUser = await getUserFullDetails(user.id);
        if (!fullUser) throw new Error("Erro de integridade ao buscar perfil.");

        // Remove dados sensíveis
        delete fullUser.password;
        delete fullUser.wallet_pin_hash;

        // Busca últimas transações
        const txQuery = `
            SELECT t.*, CASE WHEN t.sender_id = $1 THEN 'debit' ELSE 'credit' END as direction,
                   s.name as sender_name, r.name as receiver_name
            FROM wallet_transactions t
            LEFT JOIN users s ON t.sender_id = s.id
            LEFT JOIN users r ON t.receiver_id = r.id
            WHERE (t.user_id = $1 OR t.sender_id = $1 OR t.receiver_id = $1) AND t.is_hidden = FALSE
            ORDER BY t.created_at DESC LIMIT 5
        `;
        const txResult = await pool.query(txQuery, [user.id]);

        fullUser.transactions = txResult.rows;
        fullUser.session = session;

        console.log(`🎉 [LOGIN] Login bem-sucedido para: ${user.email}`);
        logSystem('LOGIN_SUCCESS', `Usuário ${user.email} logado (${user.role}).`);
        res.json(fullUser);

    } catch (e) {
        console.error(`❌ [LOGIN_CRITICAL] Erro fatal:`, e);
        logError('LOGIN_CRITICAL', e);
        res.status(500).json({ error: "Erro interno no servidor de autenticação.", details: e.message });
    }
};

// =================================================================================================
// 2. SIGNUP (USER REGISTRATION & WALLET PROVISIONING) - CORRIGIDO
// =================================================================================================

exports.signup = async (req, res) => {
    const { name, email, phone, password, role, vehicleModel, vehiclePlate, vehicleColor, photo, device_info } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    console.log(`📝 [SIGNUP] Tentativa de cadastro: ${email}`);

    // Validações básicas
    if (!name || !email || !password || !role || !phone) {
        console.log(`❌ [SIGNUP] Campos obrigatórios faltando`);
        return res.status(400).json({ error: "Preencha todos os campos obrigatórios." });
    }

    if (!isValidEmail(email)) {
        console.log(`❌ [SIGNUP] Email inválido: ${email}`);
        return res.status(400).json({ error: "Formato de email inválido." });
    }

    if (password.length < 6) {
        console.log(`❌ [SIGNUP] Senha muito curta`);
        return res.status(400).json({ error: "A senha deve ter no mínimo 6 caracteres." });
    }

    const cleanPhone = sanitizePhone(phone);
    if (!cleanPhone) {
        console.log(`❌ [SIGNUP] Telefone inválido: ${phone}`);
        return res.status(400).json({ error: "Telefone inválido. Use o padrão angolano (9 dígitos)." });
    }

    if (!['passenger', 'driver', 'admin'].includes(role)) {
        console.log(`❌ [SIGNUP] Role inválida: ${role}`);
        return res.status(400).json({ error: "Tipo de conta inválido." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verifica duplicidade de email ou telefone
        const checkResult = await client.query(
            `SELECT email, phone FROM users WHERE email = $1 OR phone = $2`,
            [email.toLowerCase().trim(), cleanPhone]
        );

        if (checkResult.rows.length > 0) {
            const existing = checkResult.rows[0];
            await client.query('ROLLBACK');
            if (existing.email === email.toLowerCase().trim()) {
                console.log(`❌ [SIGNUP] Email já cadastrado: ${email}`);
                return res.status(409).json({ error: "Email já cadastrado." });
            }
            if (existing.phone === cleanPhone) {
                console.log(`❌ [SIGNUP] Telefone já cadastrado: ${cleanPhone}`);
                return res.status(409).json({ error: "Telefone já cadastrado." });
            }
        }

        // Processa dados do veículo se for motorista
        let vehicleDetailsJson = null;
        if (role === 'driver') {
            if (!vehicleModel || !vehiclePlate) {
                await client.query('ROLLBACK');
                console.log(`❌ [SIGNUP] Dados do veículo incompletos`);
                return res.status(400).json({ error: "Motoristas devem informar Modelo e Matrícula." });
            }
            vehicleDetailsJson = JSON.stringify({
                model: vehicleModel,
                plate: vehiclePlate.toUpperCase(),
                color: vehicleColor || 'Indefinido',
                year: new Date().getFullYear(),
                registered_at: new Date().toISOString()
            });
        }

        // Hash da senha
        const hashedPassword = await bcrypt.hash(password, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);

        // Gera número da conta
        const walletAccountNumber = generateAccountNumber(cleanPhone);

        // Insere usuário
        const insertQuery = `
            INSERT INTO users (
                name, email, phone, password, role, photo, vehicle_details,
                balance, wallet_account_number, wallet_status, daily_limit, daily_limit_used,
                is_verified, account_tier, created_at, updated_at, is_online, bonus_points
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00, $8, 'active', 500000.00, 0.00, false, 'standard', NOW(), NOW(), false, 50)
            RETURNING id, name, email, role
        `;

        const insertResult = await client.query(insertQuery, [
            name,
            email.toLowerCase().trim(),
            cleanPhone,
            hashedPassword,
            role,
            photo || null,
            vehicleDetailsJson,
            walletAccountNumber
        ]);

        const newUser = insertResult.rows[0];
        console.log(`✅ [SIGNUP] Usuário criado: ${newUser.id}`);

        // Cria sessão
        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + SYSTEM_CONFIG.SECURITY.SESSION_EXPIRY_DAYS);

        // Insere sessão
        await client.query(
            `INSERT INTO user_sessions (user_id, session_token, device_info, ip_address, expires_at, is_active)
             VALUES ($1, $2, $3, $4, $5, true)`,
            [newUser.id, sessionToken, device_info || {}, ipAddress, expiresAt]
        );

        // Atualiza usuário com token da sessão
        await client.query(
            `UPDATE users SET session_token = $1, session_expiry = $2, last_login = NOW(), is_online = true WHERE id = $3`,
            [sessionToken, expiresAt, newUser.id]
        );

        await client.query('COMMIT');

        // Busca dados completos do usuário
        const fullUser = await getUserFullDetails(newUser.id);
        delete fullUser.password;
        delete fullUser.wallet_pin_hash;

        fullUser.session = { session_token: sessionToken, expires_at: expiresAt };
        fullUser.transactions = [];

        console.log(`🎉 [SIGNUP] Cadastro concluído: ${newUser.email}`);
        logSystem('SIGNUP_SUCCESS', `Novo ${role} registrado: ${name} - Wallet: ${walletAccountNumber}`);
        res.status(201).json(fullUser);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`❌ [SIGNUP_CRITICAL] Erro fatal:`, e);
        logError('SIGNUP_CRITICAL', e);
        res.status(500).json({ error: "Erro crítico ao processar cadastro.", details: e.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 3. LOGOUT E CHECK SESSION - CORRIGIDOS
// =================================================================================================

exports.logout = async (req, res) => {
    const userId = req.user ? req.user.id : null;
    const sessionToken = req.headers['x-session-token'];

    console.log(`🚪 [LOGOUT] Usuário: ${userId}`);

    try {
        if (sessionToken) {
            await pool.query('UPDATE user_sessions SET is_active = false WHERE session_token = $1', [sessionToken]);
        }

        if (userId) {
            await pool.query('UPDATE users SET is_online = false, session_token = NULL, last_login = NOW() WHERE id = $1', [userId]);
            if (req.user && req.user.role === 'driver') {
                await pool.query("UPDATE driver_positions SET status = 'offline' WHERE driver_id = $1", [userId]);
            }
        }
        res.json({ success: true, message: "Sessão encerrada com sucesso." });
    } catch (e) {
        console.error(`❌ [LOGOUT_ERROR]`, e);
        logError('LOGOUT_ERROR', e);
        res.json({ success: true, message: "Sessão encerrada localmente." });
    }
};

exports.checkSession = async (req, res) => {
    try {
        const userId = req.user.id;
        console.log(`🔍 [SESSION] Verificando sessão para usuário: ${userId}`);
        
        const user = await getUserFullDetails(userId);

        if (!user) {
            console.log(`❌ [SESSION] Usuário não encontrado: ${userId}`);
            return res.status(404).json({ error: "Conta não encontrada." });
        }

        delete user.password;
        delete user.wallet_pin_hash;

        const sessionToken = req.headers['x-session-token'];
        const sessionRes = await pool.query('SELECT expires_at FROM user_sessions WHERE session_token = $1', [sessionToken]);

        // Atualiza heartbeat
        await pool.query('UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1', [sessionToken]);
        await pool.query('UPDATE users SET is_online = true WHERE id = $1', [userId]);

        // Busca transações recentes
        const tx = await pool.query(
            'SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
            [userId]
        );

        user.transactions = tx.rows;
        user.session_valid = true;
        user.expires_at = sessionRes.rows[0]?.expires_at || null;

        console.log(`✅ [SESSION] Sessão válida para: ${userId}`);
        res.json(user);
    } catch (e) {
        console.error(`❌ [SESSION_CHECK] Erro:`, e);
        logError('SESSION_CHECK', e);
        res.status(500).json({ error: "Erro ao validar sessão." });
    }
};

/**
 * =================================================================================================
 * FIM DO ARQUIVO - AUTH CONTROLLER CORRIGIDO
 * =================================================================================================
 */
