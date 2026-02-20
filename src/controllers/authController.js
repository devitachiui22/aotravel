/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - AUTHENTICATION CONTROLLER (VERSÃO FINAL CORRIGIDA)
 * =================================================================================================
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// =================================================================================================
// 1. LOGIN - VERSÃO SIMPLIFICADA E ROBUSTA
// =================================================================================================

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Log da tentativa
        console.log(`[LOGIN] Tentativa para: ${email}`);

        // Validação básica
        if (!email || !password) {
            console.log('[LOGIN] Campos obrigatórios faltando');
            return res.status(400).json({ 
                success: false,
                error: "Email e senha são obrigatórios" 
            });
        }

        const cleanEmail = email.toLowerCase().trim();

        // Buscar usuário - query SIMPLES sem JOINs complexos
        const userResult = await pool.query(
            `SELECT 
                id, name, email, password, role, photo, phone, 
                is_verified, is_blocked, rating, balance,
                wallet_account_number, wallet_status, account_tier,
                (wallet_pin_hash IS NOT NULL) as has_pin,
                created_at, last_login
            FROM users 
            WHERE email = $1`,
            [cleanEmail]
        );

        if (userResult.rows.length === 0) {
            console.log('[LOGIN] Usuário não encontrado');
            return res.status(401).json({ 
                success: false,
                error: "Credenciais inválidas" 
            });
        }

        const user = userResult.rows[0];
        console.log(`[LOGIN] Usuário encontrado: ${user.id} - ${user.name}`);

        // Verificar se está bloqueado
        if (user.is_blocked) {
            console.log('[LOGIN] Usuário bloqueado');
            return res.status(403).json({ 
                success: false,
                error: "Conta bloqueada" 
            });
        }

        // Verificar senha
        let passwordValid = false;
        
        try {
            // Tenta bcrypt primeiro
            passwordValid = await bcrypt.compare(password, user.password);
            console.log(`[LOGIN] Bcrypt compare: ${passwordValid}`);
        } catch (bcryptError) {
            console.log('[LOGIN] Erro no bcrypt, tentando comparação direta');
            // Fallback para senha em texto puro
            passwordValid = (user.password === password);
            
            // Se for texto puro, migra para bcrypt
            if (passwordValid) {
                try {
                    const hash = await bcrypt.hash(password, 10);
                    await pool.query(
                        'UPDATE users SET password = $1 WHERE id = $2',
                        [hash, user.id]
                    );
                    console.log('[LOGIN] Senha migrada para bcrypt');
                } catch (migrateError) {
                    console.error('[LOGIN] Erro na migração:', migrateError);
                }
            }
        }

        if (!passwordValid) {
            console.log('[LOGIN] Senha inválida');
            return res.status(401).json({ 
                success: false,
                error: "Credenciais inválidas" 
            });
        }

        // Criar sessão
        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 365); // 1 ano

        // Salvar sessão
        await pool.query(
            `INSERT INTO user_sessions 
             (user_id, session_token, expires_at, is_active, created_at, last_activity)
             VALUES ($1, $2, $3, true, NOW(), NOW())`,
            [user.id, sessionToken, expiresAt]
        );

        // Atualizar último login
        await pool.query(
            'UPDATE users SET last_login = NOW(), is_online = true WHERE id = $1',
            [user.id]
        );

        // Remover dados sensíveis
        delete user.password;

        // Buscar transações recentes
        const transactions = await pool.query(
            `SELECT * FROM wallet_transactions 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT 5`,
            [user.id]
        );

        // Montar resposta
        const response = {
            ...user,
            transactions: transactions.rows,
            session: {
                session_token: sessionToken,
                expires_at: expiresAt
            },
            session_token: sessionToken,
            session_expiry: expiresAt
        };

        console.log(`[LOGIN] Sucesso para: ${user.email}`);
        
        res.status(200).json(response);

    } catch (error) {
        console.error('[LOGIN] ERRO FATAL:', error);
        console.error(error.stack);
        res.status(500).json({ 
            success: false,
            error: "Erro interno no servidor de autenticação",
            details: error.message
        });
    }
};

// =================================================================================================
// 2. SIGNUP - VERSÃO SIMPLIFICADA
// =================================================================================================

exports.signup = async (req, res) => {
    try {
        const { name, email, phone, password, role } = req.body;
        
        console.log(`[SIGNUP] Tentativa: ${email}`);

        // Validações básicas
        if (!name || !email || !phone || !password || !role) {
            return res.status(400).json({ 
                success: false,
                error: "Todos os campos são obrigatórios" 
            });
        }

        // Validar email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false,
                error: "Email inválido" 
            });
        }

        // Validar senha
        if (password.length < 6) {
            return res.status(400).json({ 
                success: false,
                error: "Senha deve ter no mínimo 6 caracteres" 
            });
        }

        // Validar telefone (9 dígitos)
        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length !== 9) {
            return res.status(400).json({ 
                success: false,
                error: "Telefone deve ter 9 dígitos" 
            });
        }

        // Validar role
        if (!['passenger', 'driver'].includes(role)) {
            return res.status(400).json({ 
                success: false,
                error: "Tipo de conta inválido" 
            });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verificar duplicidade
            const existing = await client.query(
                'SELECT email, phone FROM users WHERE email = $1 OR phone = $2',
                [email.toLowerCase().trim(), cleanPhone]
            );

            if (existing.rows.length > 0) {
                await client.query('ROLLBACK');
                const existingUser = existing.rows[0];
                if (existingUser.email === email.toLowerCase().trim()) {
                    return res.status(409).json({ 
                        success: false,
                        error: "Email já cadastrado" 
                    });
                }
                if (existingUser.phone === cleanPhone) {
                    return res.status(409).json({ 
                        success: false,
                        error: "Telefone já cadastrado" 
                    });
                }
            }

            // Hash da senha
            const hashedPassword = await bcrypt.hash(password, 10);

            // Inserir usuário
            const insertResult = await client.query(
                `INSERT INTO users 
                 (name, email, phone, password, role, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                 RETURNING id, name, email, role, created_at`,
                [name, email.toLowerCase().trim(), cleanPhone, hashedPassword, role]
            );

            const newUser = insertResult.rows[0];
            console.log(`[SIGNUP] Usuário criado: ${newUser.id}`);

            // Criar sessão
            const sessionToken = crypto.randomBytes(64).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 365);

            await client.query(
                `INSERT INTO user_sessions 
                 (user_id, session_token, expires_at, is_active, created_at, last_activity)
                 VALUES ($1, $2, $3, true, NOW(), NOW())`,
                [newUser.id, sessionToken, expiresAt]
            );

            // Atualizar número da conta
            await client.query(
                `UPDATE users SET 
                 wallet_account_number = 'AOT' || LPAD(id::TEXT, 8, '0')
                 WHERE id = $1`,
                [newUser.id]
            );

            await client.query('COMMIT');

            const response = {
                ...newUser,
                session: {
                    session_token: sessionToken,
                    expires_at: expiresAt
                },
                session_token: sessionToken,
                session_expiry: expiresAt,
                balance: 0,
                transactions: [],
                wallet_account_number: 'AOT' + newUser.id.toString().padStart(8, '0')
            };

            console.log(`[SIGNUP] Sucesso: ${newUser.email}`);
            res.status(201).json(response);

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('[SIGNUP] ERRO FATAL:', error);
        res.status(500).json({ 
            success: false,
            error: "Erro interno no servidor",
            details: error.message
        });
    }
};

// =================================================================================================
// 3. LOGOUT
// =================================================================================================

exports.logout = async (req, res) => {
    try {
        const sessionToken = req.headers['x-session-token'];
        
        if (sessionToken) {
            await pool.query(
                'UPDATE user_sessions SET is_active = false WHERE session_token = $1',
                [sessionToken]
            );
        }

        if (req.user && req.user.id) {
            await pool.query(
                'UPDATE users SET is_online = false WHERE id = $1',
                [req.user.id]
            );
        }

        res.json({ success: true, message: "Logout realizado" });

    } catch (error) {
        console.error('[LOGOUT] Erro:', error);
        res.json({ success: true, message: "Logout realizado" });
    }
};

// =================================================================================================
// 4. CHECK SESSION
// =================================================================================================

exports.checkSession = async (req, res) => {
    try {
        const userId = req.user.id;
        
        const userResult = await pool.query(
            `SELECT 
                id, name, email, role, photo, phone, is_verified,
                balance, wallet_account_number, wallet_status,
                created_at, last_login
            FROM users 
            WHERE id = $1`,
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }

        const user = userResult.rows[0];

        // Buscar transações
        const transactions = await pool.query(
            `SELECT * FROM wallet_transactions 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT 5`,
            [userId]
        );

        user.transactions = transactions.rows;

        res.json(user);

    } catch (error) {
        console.error('[SESSION] Erro:', error);
        res.status(500).json({ error: "Erro ao validar sessão" });
    }
};
