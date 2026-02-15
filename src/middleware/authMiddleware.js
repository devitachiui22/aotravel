/**
 * =================================================================================================
 * 🛡️ AUTH MIDDLEWARE - VERSÃO FINAL ROBUSTA
 * =================================================================================================
 * 
 * ✅ FUNCIONALIDADES:
 * 1. Autenticação via token de sessão
 * 2. Verificação de bloqueio de conta
 * 3. Role-based access control (RBAC)
 * 4. Logs detalhados de acesso
 * 
 * STATUS: 🔥 PRODUCTION READY
 */

const pool = require('../config/db');

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

const log = {
    info: (msg) => console.log(`${colors.blue}📘 [AUTH-MIDDLEWARE]${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅ [AUTH-MIDDLEWARE]${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️ [AUTH-MIDDLEWARE]${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}❌ [AUTH-MIDDLEWARE]${colors.reset} ${msg}`)
};

// =================================================================================================
// 1. AUTHENTICATE TOKEN - MIDDLEWARE PRINCIPAL
// =================================================================================================
async function authenticateToken(req, res, next) {
    const sessionToken = req.headers['x-session-token'];
    const path = req.path;

    log.info(`Verificando autenticação para ${req.method} ${path}`);

    // Rotas públicas que não precisam de autenticação
    const publicRoutes = [
        '/api/auth/login',
        '/api/auth/signup',
        '/api/auth/forgot-password',
        '/api/debug/',
        '/admin',
        '/'
    ];

    // Verificar se é rota pública
    const isPublicRoute = publicRoutes.some(route => path.startsWith(route));
    if (isPublicRoute) {
        log.info(`Rota pública: ${path} - acesso liberado`);
        return next();
    }

    // Rotas protegidas precisam de token
    if (!sessionToken) {
        log.warn(`Acesso negado: token não fornecido para ${path}`);
        return res.status(401).json({
            error: 'Autenticação necessária.',
            code: 'AUTH_REQUIRED'
        });
    }

    try {
        // Buscar usuário pelo token de sessão
        const result = await pool.query(
            `SELECT 
                id, 
                name, 
                email, 
                role, 
                is_blocked,
                session_expiry
            FROM users 
            WHERE session_token = $1`,
            [sessionToken]
        );

        // Token inválido
        if (result.rows.length === 0) {
            log.warn(`Acesso negado: token inválido para ${path}`);
            return res.status(401).json({
                error: 'Sessão inválida. Faça login novamente.',
                code: 'INVALID_SESSION'
            });
        }

        const user = result.rows[0];

        // Verificar se a sessão expirou
        if (user.session_expiry && new Date(user.session_expiry) < new Date()) {
            log.warn(`Acesso negado: sessão expirada para usuário ${user.id}`);
            
            // Limpar token expirado
            await pool.query(
                'UPDATE users SET session_token = NULL, is_online = false WHERE id = $1',
                [user.id]
            );
            
            return res.status(401).json({
                error: 'Sessão expirada. Faça login novamente.',
                code: 'SESSION_EXPIRED'
            });
        }

        // Verificar se usuário está bloqueado
        if (user.is_blocked) {
            log.warn(`Acesso negado: usuário ${user.id} está bloqueado`);
            return res.status(403).json({
                error: 'Sua conta foi bloqueada. Entre em contato com o suporte.',
                code: 'ACCOUNT_BLOCKED'
            });
        }

        // Atualizar última atividade
        await pool.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
        ).catch(err => log.error(`Erro ao atualizar last_login: ${err.message}`));

        // Anexar usuário à requisição
        req.user = user;
        
        log.success(`Usuário autenticado: ${user.name} (${user.role}) - ${path}`);
        
        next();

    } catch (error) {
        log.error(`Erro na autenticação: ${error.message}`);
        console.error(error.stack);
        res.status(500).json({ 
            error: 'Erro interno no servidor de autenticação.',
            code: 'INTERNAL_ERROR'
        });
    }
}

// =================================================================================================
// 2. REQUIRE DRIVER - APENAS MOTORISTAS
// =================================================================================================
function requireDriver(req, res, next) {
    if (!req.user) {
        log.warn('Acesso negado: usuário não autenticado');
        return res.status(401).json({
            error: 'Autenticação necessária.',
            code: 'AUTH_REQUIRED'
        });
    }

    if (req.user.role !== 'driver') {
        log.warn(`Acesso negado: usuário ${req.user.id} (${req.user.role}) não é motorista`);
        return res.status(403).json({
            error: 'Acesso restrito a motoristas.',
            code: 'FORBIDDEN_DRIVER'
        });
    }

    log.success(`Acesso permitido para motorista: ${req.user.name}`);
    next();
}

// =================================================================================================
// 3. REQUIRE PASSENGER - APENAS PASSAGEIROS
// =================================================================================================
function requirePassenger(req, res, next) {
    if (!req.user) {
        log.warn('Acesso negado: usuário não autenticado');
        return res.status(401).json({
            error: 'Autenticação necessária.',
            code: 'AUTH_REQUIRED'
        });
    }

    if (req.user.role !== 'passenger') {
        log.warn(`Acesso negado: usuário ${req.user.id} (${req.user.role}) não é passageiro`);
        return res.status(403).json({
            error: 'Acesso restrito a passageiros.',
            code: 'FORBIDDEN_PASSENGER'
        });
    }

    log.success(`Acesso permitido para passageiro: ${req.user.name}`);
    next();
}

// =================================================================================================
// 4. REQUIRE ADMIN - APENAS ADMINISTRADORES
// =================================================================================================
function requireAdmin(req, res, next) {
    if (!req.user) {
        log.warn('Acesso negado: usuário não autenticado');
        return res.status(401).json({
            error: 'Autenticação necessária.',
            code: 'AUTH_REQUIRED'
        });
    }

    if (req.user.role !== 'admin') {
        log.warn(`Acesso negado: usuário ${req.user.id} (${req.user.role}) não é admin`);
        return res.status(403).json({
            error: 'Acesso restrito a administradores.',
            code: 'FORBIDDEN_ADMIN'
        });
    }

    log.success(`Acesso permitido para admin: ${req.user.name}`);
    next();
}

// =================================================================================================
// 5. OPTIONAL AUTH - AUTENTICAÇÃO OPCIONAL
// =================================================================================================
async function optionalAuth(req, res, next) {
    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
        req.user = null;
        return next();
    }

    try {
        const result = await pool.query(
            'SELECT id, name, email, role FROM users WHERE session_token = $1',
            [sessionToken]
        );

        if (result.rows.length > 0) {
            req.user = result.rows[0];
            log.info(`Usuário opcional autenticado: ${req.user.name}`);
        } else {
            req.user = null;
        }

        next();

    } catch (error) {
        log.error(`Erro no optionalAuth: ${error.message}`);
        req.user = null;
        next();
    }
}

// =================================================================================================
// 6. EXPORTS
// =================================================================================================
module.exports = {
    authenticateToken,
    requireDriver,
    requirePassenger,
    requireAdmin,
    optionalAuth
};
