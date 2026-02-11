/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - AUTHENTICATION MIDDLEWARE
 * =================================================================================================
 *
 * ARQUIVO: src/middleware/authMiddleware.js
 * DESCRIÇÃO: Middleware de proteção de rotas. Valida tokens de sessão persistentes,
 *            verifica o estado da conta (bloqueio/congelamento) e implementa RBAC (Role-Based Access Control).
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const { logError } = require('../utils/helpers');

/**
 * Middleware Principal de Autenticação
 * Verifica o Header 'Authorization' ou 'x-session-token'.
 * Recupera o usuário do banco e anexa ao objeto 'req'.
 */
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const sessionToken = req.headers['x-session-token'];

    // Se nenhum token for fornecido, nega acesso imediatamente.
    if (!token && !sessionToken) {
        return res.status(401).json({ error: 'Token de autenticação necessário' });
    }

    try {
        let user;

        // ESTRATÉGIA 1: Sessão Persistente (App Mobile)
        if (sessionToken) {
            // Busca usuário associado ao token de sessão ativo e não expirado
            const sessionRes = await pool.query(
                `SELECT u.* FROM users u
                 JOIN user_sessions s ON u.id = s.user_id
                 WHERE s.session_token = $1 AND s.is_active = true
                 AND (s.expires_at IS NULL OR s.expires_at > NOW())`,
                [sessionToken]
            );

            if (sessionRes.rows.length > 0) {
                user = sessionRes.rows[0];
                // Atualizar última atividade (Heartbeat da sessão) para manter vivo
                // Executado em background (sem await) para não bloquear a resposta
                pool.query(
                    'UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1',
                    [sessionToken]
                ).catch(err => console.error('Erro ao atualizar heartbeat de sessão:', err));
            }
        }

        // ESTRATÉGIA 2: Token Simples / Legacy (Fallback)
        // Usado se a estratégia de sessão falhar ou não for enviada, mas houver um Bearer token.
        // NOTA: Em produção ideal, isso seria um JWT. Aqui mantemos a compatibilidade com o legado (ID direto).
        if (!user && token) {
            const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [token]);
            if (userRes.rows.length > 0) {
                user = userRes.rows[0];
            }
        }

        // Se após as tentativas não houver usuário, a sessão é inválida.
        if (!user) {
            return res.status(401).json({ error: 'Sessão inválida ou expirada' });
        }

        // Verificação de Bloqueio Administrativo (Kill Switch para usuário)
        if (user.is_blocked) {
            return res.status(403).json({ error: 'Conta bloqueada. Contacte o suporte.' });
        }

        // Sucesso: Anexa o usuário à requisição e segue.
        req.user = user;
        next();

    } catch (error) {
        logError('AUTH_MIDDLEWARE', error);
        res.status(500).json({ error: 'Erro interno na autenticação' });
    }
}

/**
 * Middleware de Autorização Administrativa (RBAC)
 * Garante que apenas usuários com role 'admin' acessem a rota.
 */
async function requireAdmin(req, res, next) {
    // Assume que authenticateToken já rodou antes e popular req.user
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado. Requer privilégios de administrador.' });
    }
    next();
}

/**
 * Middleware de Segurança Financeira (Wallet)
 * Verifica se a carteira está ativa e não congelada antes de transações.
 */
async function requireActiveWallet(req, res, next) {
    try {
        // Busca status atualizado direto do banco (para evitar race conditions com req.user cacheado)
        const result = await pool.query(
            "SELECT wallet_status, is_blocked FROM users WHERE id = $1",
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const userStatus = result.rows[0];

        if (userStatus.is_blocked) {
            return res.status(403).json({
                error: "Conta bloqueada administrativamente. Contacte o suporte.",
                code: "ACCOUNT_BLOCKED"
            });
        }

        if (userStatus.wallet_status === 'frozen') {
            return res.status(403).json({
                error: "Carteira congelada por motivos de segurança.",
                code: "WALLET_FROZEN"
            });
        }

        next();
    } catch (e) {
        logError('WALLET_CHECK_MIDDLEWARE', e);
        res.status(500).json({ error: "Erro interno ao validar status da carteira." });
    }
}

module.exports = {
    authenticateToken,
    requireAdmin,
    requireActiveWallet
};