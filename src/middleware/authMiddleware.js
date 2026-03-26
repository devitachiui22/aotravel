/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - SECURITY GUARD (AUTH MIDDLEWARE)
 * =================================================================================================
 *
 * ARQUIVO: src/middleware/authMiddleware.js
 * DESCRIÇÃO: Middleware de proteção de rotas.
 *            1. Valida tokens de sessão persistentes (Banco de Dados).
 *            2. Implementa RBAC (Role-Based Access Control).
 *            3. Garante compliance financeiro (Bloqueio/Congelamento).
 *            4. Suporte total a tokens JWT e sessões persistentes.
 *
 * ESTRATÉGIA:
 * - Prioriza 'x-session-token' (Header Mobile Seguro).
 * - Fallback para 'Authorization: Bearer' (Header Padrão Web).
 * - Suporte a JWT tokens para compatibilidade com sistemas existentes.
 * - Verifica integridade da conta em TEMPO REAL (não confia apenas no token).
 *
 * STATUS: PRODUCTION READY - FULL VERSION WITH JWT SUPPORT
 * =================================================================================================
 */

const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { logError, logSystem } = require('../utils/helpers');

/**
 * =================================================================================================
 * 1. AUTHENTICATE TOKEN (GATEKEEPER)
 * =================================================================================================
 * Valida a identidade do usuário e anexa o objeto `req.user`.
 * Suporte a dois métodos de autenticação:
 * - Sessões persistentes (x-session-token)
 * - JWT tokens (Authorization: Bearer)
 */
async function authenticateToken(req, res, next) {
    // 1. Extração dos Tokens dos Headers
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.split(' ')[1]; // Formato "Bearer <token>"
    const sessionToken = req.headers['x-session-token']; // Header customizado seguro

    // Se nenhum token for fornecido, nega acesso imediatamente (Fail Fast)
    if (!bearerToken && !sessionToken) {
        return res.status(401).json({
            error: 'Autenticação necessária.',
            code: 'AUTH_REQUIRED'
        });
    }

    const client = await pool.connect();

    try {
        let user = null;
        let usedToken = null;
        let tokenType = null;

        // ---------------------------------------------------------------------
        // ESTRATÉGIA A: Sessão Persistente (Tabela user_sessions) - PREFERENCIAL
        // ---------------------------------------------------------------------
        if (sessionToken) {
            usedToken = sessionToken;
            tokenType = 'session';

            // Query Otimizada: Busca usuário E valida sessão num único tiro
            const query = `
                SELECT u.*, s.device_info, s.last_activity as session_last_activity
                FROM users u
                JOIN user_sessions s ON u.id = s.user_id
                WHERE s.session_token = $1
                  AND s.is_active = true
                  AND (s.expires_at IS NULL OR s.expires_at > NOW())
            `;

            const result = await client.query(query, [sessionToken]);

            if (result.rows.length > 0) {
                user = result.rows[0];

                // Heartbeat: Atualiza última atividade em background (Fire & Forget)
                // Não usamos 'await' aqui para não atrasar a resposta da API
                client.query(
                    'UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1',
                    [sessionToken]
                ).catch(err => console.error('[AUTH_HEARTBEAT_FAIL]', err.message));
            }
        }

        // ---------------------------------------------------------------------
        // ESTRATÉGIA B: JWT Token (Authorization Bearer) - COMPATIBILIDADE
        // ---------------------------------------------------------------------
        if (!user && bearerToken) {
            usedToken = bearerToken;
            tokenType = 'jwt';

            try {
                // Decodifica o JWT token
                const decoded = jwt.verify(bearerToken, process.env.JWT_SECRET || 'TITANIUM_SECRET_2026');

                // Busca o usuário no banco
                const query = `
                    SELECT id, name, email, phone, role, is_verified, is_blocked,
                           kyc_level, vehicle_category, balance, wallet_status,
                           created_at, updated_at
                    FROM users
                    WHERE id = $1
                `;

                const result = await client.query(query, [decoded.id]);

                if (result.rows.length > 0) {
                    user = result.rows[0];

                    // Se o usuário existe, verifica se tem uma sessão ativa no banco
                    // (opcional: pode exigir que o JWT tenha uma sessão correspondente)
                    const sessionCheck = await client.query(
                        'SELECT id FROM user_sessions WHERE user_id = $1 AND is_active = true',
                        [user.id]
                    );

                    // Se não há sessão ativa, o JWT ainda é válido mas pode ser revogado
                    // Em sistemas mais seguros, você pode negar acesso aqui
                }
            } catch (jwtError) {
                // JWT inválido ou expirado
                if (jwtError.name === 'TokenExpiredError') {
                    return res.status(401).json({
                        error: 'Token expirado. Faça login novamente.',
                        code: 'TOKEN_EXPIRED'
                    });
                } else if (jwtError.name === 'JsonWebTokenError') {
                    return res.status(401).json({
                        error: 'Token inválido.',
                        code: 'INVALID_TOKEN'
                    });
                } else {
                    // Outros erros de JWT
                    console.error('[JWT_VERIFY_ERROR]', jwtError.message);
                }
            }
        }

        // ---------------------------------------------------------------------
        // VALIDAÇÕES FINAIS DE SEGURANÇA
        // ---------------------------------------------------------------------

        if (!user) {
            return res.status(401).json({
                error: 'Sessão inválida ou expirada. Faça login novamente.',
                code: 'SESSION_EXPIRED'
            });
        }

        // Kill Switch: Bloqueio Administrativo
        if (user.is_blocked) {
            logSystem('AUTH_REJECT', `Acesso negado para usuário bloqueado: ${user.email || user.id}`);
            return res.status(403).json({
                error: 'Sua conta foi bloqueada administrativamente. Entre em contato com o suporte.',
                code: 'ACCOUNT_BLOCKED'
            });
        }

        // Verificação de KYC para acesso completo (opcional, depende da rota)
        // Esta é uma validação geral, mas rotas específicas podem ter requisitos diferentes
        // Não bloqueamos aqui, apenas adicionamos flag para uso nas rotas

        // Sucesso: Anexa usuário à requisição
        // Removemos dados sensíveis para segurança interna
        delete user.password;
        delete user.wallet_pin_hash;

        // Adiciona metadados do token
        user.token_type = tokenType;
        user.token_used = usedToken;

        req.user = user;
        req.token = usedToken;
        req.tokenType = tokenType;

        next();

    } catch (error) {
        logError('AUTH_MIDDLEWARE_CRITICAL', error);
        res.status(500).json({ error: 'Erro interno no servidor de autenticação.' });
    } finally {
        client.release();
    }
}

/**
 * =================================================================================================
 * 2. ROLE BASED ACCESS CONTROL (RBAC)
 * =================================================================================================
 */

/**
 * Exige privilégios de ADMINISTRADOR.
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    if (req.user.role !== 'admin') {
        logSystem('RBAC_VIOLATION', `Usuário ${req.user.id} tentou acessar rota de Admin.`);
        return res.status(403).json({
            error: 'Acesso negado. Requer privilégios de administrador.',
            code: 'FORBIDDEN_ADMIN'
        });
    }

    next();
}

/**
 * Exige privilégios de MOTORISTA.
 */
function requireDriver(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    if (req.user.role !== 'driver') {
        return res.status(403).json({
            error: 'Apenas motoristas podem acessar este recurso.',
            code: 'FORBIDDEN_DRIVER'
        });
    }
    next();
}

/**
 * Exige privilégios de PASSAGEIRO.
 */
function requirePassenger(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    if (req.user.role !== 'passenger') {
        return res.status(403).json({
            error: 'Apenas passageiros podem acessar este recurso.',
            code: 'FORBIDDEN_PASSENGER'
        });
    }
    next();
}

/**
 * Permite acesso a MOTORISTAS ou ADMINISTRADORES.
 */
function requireDriverOrAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    if (req.user.role !== 'driver' && req.user.role !== 'admin') {
        return res.status(403).json({
            error: 'Acesso negado. Requer privilégios de motorista ou administrador.',
            code: 'FORBIDDEN_DRIVER_OR_ADMIN'
        });
    }
    next();
}

/**
 * Permite acesso a PASSAGEIROS ou ADMINISTRADORES.
 */
function requirePassengerOrAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    if (req.user.role !== 'passenger' && req.user.role !== 'admin') {
        return res.status(403).json({
            error: 'Acesso negado. Requer privilégios de passageiro ou administrador.',
            code: 'FORBIDDEN_PASSENGER_OR_ADMIN'
        });
    }
    next();
}

/**
 * Exige que o usuário tenha um nível KYC mínimo.
 * @param {number} minLevel - Nível mínimo de KYC exigido (1, 2, 3)
 */
function requireKYCLevel(minLevel) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Autenticação necessária.' });
        }

        const userKycLevel = req.user.kyc_level || 0;

        if (userKycLevel < minLevel) {
            return res.status(403).json({
                error: `Verificação KYC nível ${minLevel} necessária para acessar este recurso.`,
                code: 'KYC_REQUIRED',
                required_level: minLevel,
                current_level: userKycLevel
            });
        }

        next();
    };
}

/**
 * =================================================================================================
 * 3. WALLET SECURITY & COMPLIANCE
 * =================================================================================================
 */

/**
 * Verifica se a carteira está apta para transações financeiras.
 * Bloqueia se:
 * - Conta bloqueada
 * - Carteira congelada (Fraud detection)
 * - KYC Pendente (se configurado para exigir nível 2)
 * - Saldo insuficiente (opcional)
 */
async function requireActiveWallet(req, res, next) {
    try {
        // Busca status atualizado direto do banco para evitar Race Conditions com o cache do req.user
        // Ex: O admin bloqueou a carteira há 1 segundo atrás.
        const result = await pool.query(
            "SELECT wallet_status, is_blocked, kyc_level, balance, daily_limit, daily_limit_used, last_transaction_date FROM users WHERE id = $1",
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const status = result.rows[0];

        // Bloqueio Geral
        if (status.is_blocked) {
            return res.status(403).json({
                error: "Conta bloqueada. Transações financeiras suspensas.",
                code: "ACCOUNT_BLOCKED"
            });
        }

        // Bloqueio Específico de Carteira (Compliance)
        if (status.wallet_status === 'frozen') {
            logSystem('WALLET_REJECT', `Tentativa de transação em carteira congelada: User ${req.user.id}`);
            return res.status(403).json({
                error: "Sua carteira está temporariamente congelada por motivos de segurança.",
                code: "WALLET_FROZEN"
            });
        }

        if (status.wallet_status === 'inactive') {
            return res.status(403).json({
                error: "Carteira inativa. Ative sua conta primeiro.",
                code: "WALLET_INACTIVE"
            });
        }

        // Adiciona informações da carteira ao req para uso nas rotas
        req.wallet = {
            balance: parseFloat(status.balance) || 0,
            daily_limit: parseFloat(status.daily_limit) || 0,
            daily_limit_used: parseFloat(status.daily_limit_used) || 0,
            last_transaction_date: status.last_transaction_date
        };

        next();

    } catch (e) {
        logError('WALLET_CHECK_MIDDLEWARE', e);
        res.status(500).json({ error: "Erro ao validar status da carteira." });
    }
}

/**
 * Verifica se o saldo da carteira é suficiente para um valor especificado.
 * @param {number} requiredAmount - Valor mínimo necessário
 */
function requireSufficientBalance(requiredAmount) {
    return async (req, res, next) => {
        try {
            // Se o valor não foi passado como parâmetro, tenta extrair do body
            let amount = requiredAmount;
            if (typeof requiredAmount === 'function') {
                amount = requiredAmount(req);
            } else if (requiredAmount === undefined && req.body.amount) {
                amount = parseFloat(req.body.amount);
            }

            if (!amount || amount <= 0) {
                return res.status(400).json({ error: "Valor inválido para verificação de saldo." });
            }

            const result = await pool.query(
                "SELECT balance FROM users WHERE id = $1",
                [req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Usuário não encontrado." });
            }

            const balance = parseFloat(result.rows[0].balance) || 0;

            if (balance < amount) {
                return res.status(402).json({
                    error: "Saldo insuficiente para realizar esta operação.",
                    code: "INSUFFICIENT_BALANCE",
                    required: amount,
                    available: balance
                });
            }

            req.requiredBalance = amount;
            next();

        } catch (e) {
            logError('BALANCE_CHECK_MIDDLEWARE', e);
            res.status(500).json({ error: "Erro ao verificar saldo." });
        }
    };
}

/**
 * Verifica se o limite diário não foi excedido.
 */
async function requireDailyLimit(req, res, next) {
    try {
        const amount = req.body.amount ? parseFloat(req.body.amount) : 0;

        if (amount <= 0) {
            return next();
        }

        const result = await pool.query(
            `SELECT daily_limit, daily_limit_used, last_transaction_date
             FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const { daily_limit, daily_limit_used, last_transaction_date } = result.rows[0];
        const today = new Date().toISOString().split('T')[0];
        const lastTxDate = last_transaction_date ? last_transaction_date.toISOString().split('T')[0] : null;

        let currentUsed = parseFloat(daily_limit_used) || 0;

        // Se a última transação não foi hoje, reseta o contador
        if (lastTxDate !== today) {
            currentUsed = 0;
            // Opcional: atualizar o contador no banco
            await pool.query(
                "UPDATE users SET daily_limit_used = 0, last_transaction_date = CURRENT_DATE WHERE id = $1",
                [req.user.id]
            );
        }

        const limit = parseFloat(daily_limit) || 500000;

        if (currentUsed + amount > limit) {
            return res.status(403).json({
                error: "Limite diário de transações excedido.",
                code: "DAILY_LIMIT_EXCEEDED",
                limit: limit,
                used: currentUsed,
                requested: amount,
                remaining: limit - currentUsed
            });
        }

        req.dailyLimitInfo = {
            limit,
            used: currentUsed,
            remaining: limit - currentUsed,
            requested: amount
        };

        next();

    } catch (e) {
        logError('DAILY_LIMIT_CHECK_MIDDLEWARE', e);
        res.status(500).json({ error: "Erro ao verificar limite diário." });
    }
}

/**
 * =================================================================================================
 * 4. VALIDAÇÕES ADICIONAIS
 * =================================================================================================
 */

/**
 * Verifica se o usuário está verificado (KYC completo).
 */
function requireVerified(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    if (!req.user.is_verified) {
        return res.status(403).json({
            error: 'Conta não verificada. Complete o processo de verificação.',
            code: 'ACCOUNT_NOT_VERIFIED'
        });
    }

    next();
}

/**
 * Verifica se o usuário está online (para motoristas).
 */
function requireDriverOnline(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    if (req.user.role !== 'driver') {
        return res.status(403).json({ error: 'Apenas motoristas podem acessar este recurso.' });
    }

    // Busca status do motorista
    pool.query(
        'SELECT status FROM driver_positions WHERE driver_id = $1',
        [req.user.id]
    ).then(result => {
        if (result.rows.length === 0 || result.rows[0].status !== 'online') {
            return res.status(403).json({
                error: 'Motorista offline. Ative o status online para continuar.',
                code: 'DRIVER_OFFLINE'
            });
        }
        next();
    }).catch(error => {
        logError('DRIVER_ONLINE_CHECK', error);
        res.status(500).json({ error: "Erro ao verificar status do motorista." });
    });
}

/**
 * Verifica se o usuário é o proprietário do recurso.
 * @param {Function} getResourceUserId - Função que retorna o ID do usuário dono do recurso
 */
function requireResourceOwner(getResourceUserId) {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Autenticação necessária.' });
        }

        try {
            const resourceUserId = await getResourceUserId(req);

            if (req.user.id !== resourceUserId && req.user.role !== 'admin') {
                return res.status(403).json({
                    error: 'Acesso negado. Você não é o proprietário deste recurso.',
                    code: 'NOT_RESOURCE_OWNER'
                });
            }

            next();
        } catch (error) {
            logError('RESOURCE_OWNER_CHECK', error);
            res.status(500).json({ error: "Erro ao verificar propriedade do recurso." });
        }
    };
}

// Exportação dos Middlewares
module.exports = {
    // Core authentication
    authenticateToken,

    // RBAC middlewares
    requireAdmin,
    requireDriver,
    requirePassenger,
    requireDriverOrAdmin,
    requirePassengerOrAdmin,
    requireKYCLevel,

    // Wallet security
    requireActiveWallet,
    requireSufficientBalance,
    requireDailyLimit,

    // Additional validations
    requireVerified,
    requireDriverOnline,
    requireResourceOwner
};
