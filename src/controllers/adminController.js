/**
 * =================================================================================================
 * 👑 AOTRAVEL SERVER PRO - ADMIN CONTROLLER (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/adminController.js
 * DESCRIÇÃO: Controlador Mestre do Painel Administrativo.
 *            Este arquivo concentra toda a lógica de superusuário, incluindo:
 *            - Dashboard Analítico em Tempo Real (KPIs, Crescimento).
 *            - Gestão Completa de Usuários (CRUD, Bloqueios, Redefinição de Senha).
 *            - Auditoria de Documentos KYC (Compliance).
 *            - Gestão Financeira Administrativa (Ajustes de Saldo, Estornos).
 *            - Configurações Dinâmicas do Sistema (Hot-Reload).
 *            - Geração de Relatórios Complexos.
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * INTEGRAÇÃO:
 * - Database: PostgreSQL (Neon) via pool (src/config/db.js).
 * - Helpers: Utils globais para logs e formatação.
 * - Security: Bcrypt para redefinição de senhas administrativas.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const { logSystem, logError, getUserFullDetails, generateRef } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 0. HELPERS PRIVADOS DO CONTROLADOR (INTERNAL UTILS)
// =================================================================================================

/**
 * Valida se uma data é válida para filtros de relatórios.
 * @param {string} dateString - Data em formato YYYY-MM-DD
 * @returns {boolean}
 */
const isValidDate = (dateString) => {
    const regEx = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateString.match(regEx)) return false;
    const d = new Date(dateString);
    const dNum = d.getTime();
    if (!dNum && dNum !== 0) return false;
    return d.toISOString().slice(0, 10) === dateString;
};

/**
 * Calcula a porcentagem de crescimento entre dois valores.
 * Usado nos KPIs do Dashboard.
 * @param {number} current - Valor atual
 * @param {number} previous - Valor anterior
 * @returns {number} - Porcentagem de variação
 */
const calculateGrowth = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return parseFloat((((current - previous) / previous) * 100).toFixed(2));
};

/**
 * Sanitiza objetos de query para evitar injeção em filtros dinâmicos.
 * @param {string} input - Texto de busca
 * @returns {string} - Texto limpo
 */
const sanitizeSearch = (input) => {
    if (!input) return '';
    return input.replace(/[%_]/g, '\\$&'); // Escapa caracteres curinga do SQL LIKE
};

// =================================================================================================
// 1. DASHBOARD E ESTATÍSTICAS (ANALYTICS ENGINE)
// =================================================================================================

/**
 * GET STATS (DASHBOARD MASTER)
 * Rota: GET /api/admin/stats
 * Descrição: Retorna um panorama completo da saúde do sistema.
 *            Inclui métricas financeiras, operacionais e de crescimento.
 */
exports.getStats = async (req, res) => {
    const client = await pool.connect();

    try {
        logSystem('ADMIN_ACCESS', `Admin ${req.user.id} acessou o Dashboard Master.`);

        // -----------------------------------------------------------------------------------------
        // A. KPIs Principais (Single Shot Query para Performance)
        // -----------------------------------------------------------------------------------------
        const kpiQuery = `
            SELECT
                -- Usuários
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'driver') as total_drivers,
                (SELECT COUNT(*) FROM users WHERE role = 'passenger') as total_passengers,
                (SELECT COUNT(*) FROM users WHERE is_online = true) as online_users,
                (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '24 hours') as new_users_24h,

                -- Corridas
                (SELECT COUNT(*) FROM rides) as total_rides,
                (SELECT COUNT(*) FROM rides WHERE status = 'completed') as completed_rides,
                (SELECT COUNT(*) FROM rides WHERE status = 'cancelled') as cancelled_rides,
                (SELECT COUNT(*) FROM rides WHERE status = 'ongoing') as active_rides,
                (SELECT COUNT(*) FROM rides WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '24 hours') as rides_24h,

                -- Financeiro (Revenue)
                (SELECT COALESCE(SUM(final_price), 0) FROM rides WHERE status = 'completed') as total_revenue_lifetime,
                (SELECT COALESCE(SUM(final_price), 0) FROM rides WHERE status = 'completed' AND completed_at >= CURRENT_DATE) as revenue_today,
                (SELECT COALESCE(SUM(final_price), 0) FROM rides WHERE status = 'completed' AND completed_at >= DATE_TRUNC('month', CURRENT_DATE)) as revenue_month,

                -- Wallet (Passivo do Sistema)
                (SELECT COALESCE(SUM(balance), 0) FROM users WHERE balance > 0) as total_user_liability
        `;

        const kpiResult = await client.query(kpiQuery);
        const kpi = kpiResult.rows[0];

        // -----------------------------------------------------------------------------------------
        // B. Gráfico de Receita (Últimos 7 dias)
        // -----------------------------------------------------------------------------------------
        const chartQuery = `
            SELECT
                TO_CHAR(DATE(completed_at), 'YYYY-MM-DD') as date,
                COUNT(*) as ride_count,
                COALESCE(SUM(final_price), 0) as revenue
            FROM rides
            WHERE status = 'completed'
              AND completed_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(completed_at)
            ORDER BY date ASC
        `;
        const chartResult = await client.query(chartQuery);

        // -----------------------------------------------------------------------------------------
        // C. Feed de Atividades Recentes (Live Feed)
        // -----------------------------------------------------------------------------------------
        // Corridas Recentes
        const recentRides = await client.query(`
            SELECT r.id, r.status, r.created_at, r.final_price,
                   p.name as passenger_name, d.name as driver_name
            FROM rides r
            LEFT JOIN users p ON r.passenger_id = p.id
            LEFT JOIN users d ON r.driver_id = d.id
            ORDER BY r.created_at DESC LIMIT 8
        `);

        // Novos Usuários
        const recentUsers = await client.query(`
            SELECT id, name, email, role, created_at, photo
            FROM users
            ORDER BY created_at DESC LIMIT 8
        `);

        // Transações de Carteira Recentes (Acima de 5000 Kz)
        const recentTrans = await client.query(`
            SELECT t.id, t.amount, t.type, t.created_at, u.name as user_name
            FROM wallet_transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.amount > 5000
            ORDER BY t.created_at DESC LIMIT 5
        `);

        // -----------------------------------------------------------------------------------------
        // D. Cálculo de Saúde do Sistema (Health Score)
        // -----------------------------------------------------------------------------------------
        const conversionRate = kpi.total_rides > 0
            ? ((kpi.completed_rides / kpi.total_rides) * 100).toFixed(1)
            : 0;

        const cancellationRate = kpi.total_rides > 0
            ? ((kpi.cancelled_rides / kpi.total_rides) * 100).toFixed(1)
            : 0;

        // Montagem do Payload Final
        res.json({
            meta: {
                generated_at: new Date().toISOString(),
                admin_user: req.user.name
            },
            kpi: {
                users: {
                    total: parseInt(kpi.total_users),
                    drivers: parseInt(kpi.total_drivers),
                    passengers: parseInt(kpi.total_passengers),
                    online: parseInt(kpi.online_users),
                    new_24h: parseInt(kpi.new_users_24h)
                },
                rides: {
                    total: parseInt(kpi.total_rides),
                    completed: parseInt(kpi.completed_rides),
                    cancelled: parseInt(kpi.cancelled_rides),
                    active: parseInt(kpi.active_rides),
                    today: parseInt(kpi.rides_24h),
                    conversion_rate: `${conversionRate}%`,
                    cancellation_rate: `${cancellationRate}%`
                },
                financial: {
                    total_revenue: parseFloat(kpi.total_revenue_lifetime),
                    revenue_today: parseFloat(kpi.revenue_today),
                    revenue_month: parseFloat(kpi.revenue_month),
                    system_liability: parseFloat(kpi.total_user_liability) // Quanto o sistema "deve" aos usuários
                }
            },
            charts: {
                revenue_7d: chartResult.rows
            },
            live_feed: {
                rides: recentRides.rows,
                users: recentUsers.rows,
                high_value_transactions: recentTrans.rows
            }
        });

    } catch (e) {
        logError('ADMIN_STATS_FATAL', e);
        res.status(500).json({
            error: "Erro crítico ao gerar estatísticas do dashboard.",
            details: process.env.NODE_ENV === 'development' ? e.message : undefined
        });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 2. GESTÃO DE USUÁRIOS (USER MANAGEMENT MODULE)
// =================================================================================================

/**
 * LIST USERS (ADVANCED SEARCH)
 * Rota: GET /api/admin/users
 * Descrição: Listagem paginada com filtros múltiplos.
 */
exports.getUsers = async (req, res) => {
    const {
        role,
        is_online,
        is_blocked,
        is_verified,
        search,
        sort_by = 'created_at',
        order = 'DESC',
        limit = 50,
        offset = 0
    } = req.query;

    try {
        let query = `
            SELECT
                id, name, email, phone, role, photo,
                balance, wallet_status, account_tier,
                is_online, rating, is_blocked, is_verified,
                created_at, last_login,
                (SELECT COUNT(*) FROM rides WHERE driver_id = users.id AND status = 'completed') as rides_driven,
                (SELECT COUNT(*) FROM rides WHERE passenger_id = users.id AND status = 'completed') as rides_taken
            FROM users
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        // --- Filtros Dinâmicos ---

        if (role && ['admin', 'driver', 'passenger'].includes(role)) {
            query += ` AND role = $${paramCount}`;
            params.push(role);
            paramCount++;
        }

        if (is_online !== undefined) {
            query += ` AND is_online = $${paramCount}`;
            params.push(is_online === 'true');
            paramCount++;
        }

        if (is_blocked !== undefined) {
            query += ` AND is_blocked = $${paramCount}`;
            params.push(is_blocked === 'true');
            paramCount++;
        }

        if (is_verified !== undefined) {
            query += ` AND is_verified = $${paramCount}`;
            params.push(is_verified === 'true');
            paramCount++;
        }

        if (search) {
            const cleanSearch = sanitizeSearch(search);
            query += ` AND (
                name ILIKE $${paramCount} OR
                email ILIKE $${paramCount} OR
                phone ILIKE $${paramCount} OR
                wallet_account_number ILIKE $${paramCount}
            )`;
            params.push(`%${cleanSearch}%`);
            paramCount++;
        }

        // --- Ordenação Segura ---
        const allowedSorts = ['created_at', 'balance', 'rating', 'name', 'last_login'];
        const safeSort = allowedSorts.includes(sort_by) ? sort_by : 'created_at';
        const safeOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        query += ` ORDER BY ${safeSort} ${safeOrder}`;

        // --- Paginação ---
        query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        // Execução
        const result = await pool.query(query, params);

        // Contagem Total (para Frontend Pagination)
        // Remove LIMIT/OFFSET e ORDER BY para contar
        const countQueryBase = query.split('ORDER BY')[0];
        // Substitui o SELECT ... por SELECT COUNT(*)
        const countQuery = `SELECT COUNT(*) FROM (${countQueryBase}) as total`;
        // Remove os 2 últimos params (limit, offset)
        const countResult = await pool.query(countQuery, params.slice(0, -2));

        res.json({
            data: result.rows,
            pagination: {
                total: parseInt(countResult.rows[0].count),
                limit: parseInt(limit),
                offset: parseInt(offset),
                pages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit))
            }
        });

    } catch (e) {
        logError('ADMIN_USERS_LIST', e);
        res.status(500).json({ error: "Erro ao listar usuários." });
    }
};

/**
 * GET USER DETAILS (DEEP DIVE)
 * Rota: GET /api/admin/users/:id
 * Descrição: Retorna uma visão 360º do usuário (Perfil, Wallet, Docs, Histórico).
 */
exports.getUserDetails = async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Perfil Base (Helper Padronizado)
        const user = await getUserFullDetails(id);
        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        // Remover dados sensíveis residuais
        delete user.password;
        delete user.wallet_pin_hash;

        // 2. Histórico de Corridas (Últimas 50)
        const ridesQuery = `
            SELECT r.*,
                CASE WHEN r.passenger_id = $1 THEN 'passenger' ELSE 'driver' END as participation_role
            FROM rides r
            WHERE r.passenger_id = $1 OR r.driver_id = $1
            ORDER BY r.created_at DESC
            LIMIT 50
        `;
        const rides = await pool.query(ridesQuery, [id]);

        // 3. Histórico Financeiro (Últimas 50)
        const transQuery = `
            SELECT t.*,
                CASE WHEN t.sender_id = $1 THEN 'debit' ELSE 'credit' END as direction
            FROM wallet_transactions t
            WHERE t.user_id = $1
            ORDER BY t.created_at DESC
            LIMIT 50
        `;
        const transactions = await pool.query(transQuery, [id]);

        // 4. Documentos KYC
        const docsQuery = `
            SELECT * FROM user_documents
            WHERE user_id = $1
            ORDER BY created_at DESC
        `;
        const documents = await pool.query(docsQuery, [id]);

        // 5. Sessões Ativas (Segurança)
        const sessionsQuery = `
            SELECT id, device_info, ip_address, created_at, last_activity, is_active
            FROM user_sessions
            WHERE user_id = $1 AND is_active = true
        `;
        const sessions = await pool.query(sessionsQuery, [id]);

        // Montagem da Resposta
        res.json({
            profile: user,
            financial: {
                current_balance: parseFloat(user.balance),
                transactions: transactions.rows
            },
            activity: {
                rides: rides.rows,
                total_rides: rides.rows.length // Apenas carregados
            },
            compliance: {
                documents: documents.rows,
                kyc_level: user.kyc_level
            },
            security: {
                active_sessions: sessions.rows
            }
        });

    } catch (e) {
        logError('ADMIN_USER_DETAILS', e);
        res.status(500).json({ error: "Erro ao buscar detalhes profundos do usuário." });
    }
};

/**
 * UPDATE USER (ADMIN OVERRIDE)
 * Rota: PUT /api/admin/users/:id
 * Descrição: Permite alteração forçada de dados, bloqueios e status de verificação.
 *            ATENÇÃO: Alterações de saldo devem usar a rota específica de ajuste financeiro.
 */
exports.updateUser = async (req, res) => {
    const { id } = req.params;
    const {
        name,
        email,
        phone,
        role,
        is_blocked,
        is_verified,
        wallet_status,
        account_tier,
        vehicle_details
    } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Verificar existência
        const check = await client.query("SELECT id, is_blocked, wallet_status FROM users WHERE id = $1 FOR UPDATE", [id]);
        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Usuário não encontrado." });
        }
        const currentUser = check.rows[0];

        const updates = [];
        const values = [];
        let paramCount = 1;

        // Construção dinâmica da Query
        if (name) { updates.push(`name = $${paramCount}`); values.push(name); paramCount++; }
        if (email) { updates.push(`email = $${paramCount}`); values.push(email); paramCount++; }
        if (phone) { updates.push(`phone = $${paramCount}`); values.push(phone); paramCount++; }
        if (role) { updates.push(`role = $${paramCount}`); values.push(role); paramCount++; }

        // Status Booleanos
        if (is_blocked !== undefined) {
            updates.push(`is_blocked = $${paramCount}`);
            values.push(is_blocked);
            paramCount++;

            // Se bloqueado, matar todas as sessões ativas
            if (is_blocked === true && currentUser.is_blocked === false) {
                await client.query("UPDATE user_sessions SET is_active = false WHERE user_id = $1", [id]);
                await client.query("UPDATE users SET is_online = false, session_token = NULL WHERE id = $1", [id]);
            }
        }

        if (is_verified !== undefined) {
            updates.push(`is_verified = $${paramCount}`);
            values.push(is_verified);
            paramCount++;
        }

        // Status Financeiros
        if (wallet_status) {
            updates.push(`wallet_status = $${paramCount}`);
            values.push(wallet_status);
            paramCount++;
        }

        if (account_tier) {
            updates.push(`account_tier = $${paramCount}`);
            values.push(account_tier);
            paramCount++;
        }

        // Detalhes Veículo
        if (vehicle_details) {
            updates.push(`vehicle_details = $${paramCount}`);
            values.push(JSON.stringify(vehicle_details));
            paramCount++;
        }

        if (updates.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Nenhum dado fornecido para atualização." });
        }

        // Adiciona timestamp
        updates.push(`updated_at = NOW()`);

        // Executa Update
        values.push(id);
        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        const result = await client.query(query, values);

        // Auditoria da Ação
        await client.query(
            "INSERT INTO wallet_security_logs (user_id, event_type, ip_address, device_info, details) VALUES ($1, 'ADMIN_UPDATE', $2, $3, $4)",
            [id, req.ip, `Admin ID: ${req.user.id}`, JSON.stringify(req.body)]
        );

        await client.query('COMMIT');

        const updatedUser = result.rows[0];
        delete updatedUser.password;

        logSystem('ADMIN_ACTION', `Admin ${req.user.id} atualizou perfil do usuário ${id}.`);
        res.json({ success: true, user: updatedUser });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('ADMIN_UPDATE_USER', e);
        res.status(500).json({ error: "Erro ao atualizar usuário." });
    } finally {
        client.release();
    }
};

/**
 * RESET USER PASSWORD (ADMIN OVERRIDE)
 * Rota: POST /api/admin/users/:id/reset-password
 * Descrição: Define uma nova senha temporária para o usuário.
 */
exports.resetUserPassword = async (req, res) => {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password || new_password.length < 6) {
        return res.status(400).json({ error: "A nova senha deve ter no mínimo 6 caracteres." });
    }

    try {
        const hash = await bcrypt.hash(new_password, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);

        await pool.query(
            "UPDATE users SET password = $1, session_token = NULL, is_online = false, updated_at = NOW() WHERE id = $2",
            [hash, id]
        );

        // Matar sessões para forçar login com nova senha
        await pool.query("UPDATE user_sessions SET is_active = false WHERE user_id = $1", [id]);

        logSystem('ADMIN_SEC', `Admin ${req.user.id} resetou a senha do usuário ${id}.`);
        res.json({ success: true, message: "Senha atualizada com sucesso. Usuário desconectado." });

    } catch (e) {
        logError('ADMIN_PASS_RESET', e);
        res.status(500).json({ error: "Erro ao resetar senha." });
    }
};

// =================================================================================================
// 3. GESTÃO DE DOCUMENTOS E COMPLIANCE (KYC MODULE)
// =================================================================================================

/**
 * GET PENDING DOCUMENTS
 * Rota: GET /api/admin/documents/pending
 * Descrição: Lista todos os documentos aguardando aprovação.
 */
exports.getPendingDocuments = async (req, res) => {
    try {
        const query = `
            SELECT d.*, u.name as user_name, u.email as user_email, u.role as user_role
            FROM user_documents d
            JOIN users u ON d.user_id = u.id
            WHERE d.status = 'pending'
            ORDER BY d.created_at ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar documentos pendentes." });
    }
};

/**
 * VERIFY DOCUMENT
 * Rota: POST /api/admin/documents/:id/verify
 * Descrição: Aprova ou Rejeita um documento específico.
 *            Se todos os docs forem aprovados, o usuário ganha status 'is_verified'.
 */
exports.verifyDocument = async (req, res) => {
    const { id } = req.params;
    const { status, rejection_reason } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: "Status inválido. Use 'approved' ou 'rejected'." });
    }

    if (status === 'rejected' && !rejection_reason) {
        return res.status(400).json({ error: "Motivo da rejeição é obrigatório." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Atualizar Documento
        const docResult = await client.query(
            `UPDATE user_documents SET
                status = $1,
                verified_by = $2,
                verified_at = NOW(),
                rejection_reason = $3,
                updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [status, req.user.id, rejection_reason || null, id]
        );

        if (docResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Documento não encontrado." });
        }

        const doc = docResult.rows[0];

        // 2. Verificar Status Global do Usuário (Auto-Approve)
        // Se o documento foi aprovado, verificamos se restam pendências
        if (status === 'approved') {
            const userId = doc.user_id;

            // Busca quais documentos são obrigatórios para o Role do usuário
            const userRes = await client.query("SELECT role FROM users WHERE id = $1", [userId]);
            const role = userRes.rows[0].role;

            const requiredTypes = ['bi'];
            if (role === 'driver') requiredTypes.push('driving_license');

            // Verifica documentos aprovados
            const approvedCountRes = await client.query(
                `SELECT COUNT(DISTINCT document_type)
                 FROM user_documents
                 WHERE user_id = $1 AND status = 'approved' AND document_type = ANY($2)`,
                [userId, requiredTypes]
            );

            const approvedCount = parseInt(approvedCountRes.rows[0].count);

            // Se tem todos os necessários aprovados
            if (approvedCount >= requiredTypes.length) {
                await client.query(
                    "UPDATE users SET is_verified = true, kyc_level = 2, updated_at = NOW() WHERE id = $1",
                    [userId]
                );
                logSystem('KYC_AUTO', `Usuário ${userId} promovido para Verificado (KYC Level 2).`);
            }
        } else {
            // Se rejeitado, garante que o usuário não está verificado
            await client.query(
                "UPDATE users SET is_verified = false, kyc_level = 1 WHERE id = $1",
                [doc.user_id]
            );
        }

        await client.query('COMMIT');

        // Notificar usuário (Futuro: Push Notification)
        // emitToUser(doc.user_id, 'doc_status_update', { status, type: doc.document_type });

        res.json({ success: true, document: doc });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('DOC_VERIFY_ERROR', e);
        res.status(500).json({ error: "Erro ao processar verificação de documento." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 4. GESTÃO FINANCEIRA ADMINISTRATIVA (FINANCIAL MODULE)
// =================================================================================================

/**
 * MANUAL WALLET ADJUSTMENT
 * Rota: POST /api/admin/wallet/adjust
 * Descrição: Adiciona ou remove saldo manualmente (Crédito/Débito) em caso de disputas.
 *            Gera log de auditoria rigoroso.
 */
exports.manualWalletAdjustment = async (req, res) => {
    const { user_id, amount, type, description } = req.body; // type: 'credit' or 'debit'

    if (!user_id || !amount || !type || !description) {
        return res.status(400).json({ error: "Todos os campos são obrigatórios: user_id, amount, type, description." });
    }

    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
        return res.status(400).json({ error: "Valor inválido." });
    }

    if (!['credit', 'debit'].includes(type)) {
        return res.status(400).json({ error: "Tipo deve ser 'credit' ou 'debit'." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Bloquear usuário para update seguro
        const userRes = await client.query("SELECT balance, name FROM users WHERE id = $1 FOR UPDATE", [user_id]);
        if (userRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const currentBalance = parseFloat(userRes.rows[0].balance);
        let newBalance = 0;
        let dbAmount = 0; // Valor que vai pro banco (negativo se débito)

        if (type === 'credit') {
            newBalance = currentBalance + val;
            dbAmount = val;
        } else {
            newBalance = currentBalance - val;
            dbAmount = -val; // Negativo para registro
            // Verifica se o saldo ficaria negativo (permitido em alguns casos, mas bom avisar)
            // Aqui permitimos, pois é admin override.
        }

        // Atualiza User
        await client.query(
            "UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2",
            [newBalance, user_id]
        );

        // Gera Referência
        const txRef = generateRef('ADM');

        // Registra Transação
        await client.query(
            `INSERT INTO wallet_transactions
             (reference_id, user_id, amount, type, method, status, description, balance_after, category, metadata)
             VALUES ($1, $2, $3, 'adjustment', 'admin_override', 'completed', $4, $5, 'admin', $6)`,
            [
                txRef,
                user_id,
                dbAmount,
                description,
                newBalance,
                JSON.stringify({ admin_id: req.user.id, reason: description })
            ]
        );

        // Auditoria
        await client.query(
            "INSERT INTO wallet_security_logs (user_id, event_type, ip_address, details) VALUES ($1, 'ADMIN_MONEY_ADJUST', $2, $3)",
            [user_id, req.ip, JSON.stringify({ amount: dbAmount, admin: req.user.id, ref: txRef })]
        );

        await client.query('COMMIT');

        logSystem('ADMIN_FINANCE', `Admin ${req.user.id} ajustou saldo do User ${user_id}: ${type.toUpperCase()} ${val} Kz.`);

        res.json({
            success: true,
            message: "Ajuste financeiro realizado com sucesso.",
            transaction: {
                reference: txRef,
                user: userRes.rows[0].name,
                old_balance: currentBalance,
                new_balance: newBalance,
                amount: dbAmount
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('ADMIN_WALLET_ADJUST', e);
        res.status(500).json({ error: "Erro crítico ao ajustar saldo." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 5. RELATÓRIOS E EXPORTAÇÃO (REPORTING ENGINE)
// =================================================================================================

/**
 * GENERATE REPORT
 * Rota: POST /api/admin/reports
 * Descrição: Gera datasets complexos para análise (Financeiro, Operacional).
 */
exports.generateReport = async (req, res) => {
    const { report_type, date_from, date_to } = req.body;

    // Validação de Datas
    const dFrom = isValidDate(date_from) ? date_from : '1970-01-01';
    const dTo = isValidDate(date_to) ? date_to : '2100-12-31';

    try {
        let reportData = {};
        let query = '';

        switch (report_type) {
            case 'financial_daily':
                query = `
                    SELECT
                        TO_CHAR(DATE(created_at), 'YYYY-MM-DD') as date,
                        COUNT(*) as total_transactions,
                        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_inflow,
                        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as total_outflow,
                        SUM(fee) as total_fees_collected
                    FROM wallet_transactions
                    WHERE status = 'completed' AND created_at BETWEEN $1 AND $2
                    GROUP BY DATE(created_at)
                    ORDER BY date DESC
                `;
                break;

            case 'rides_performance':
                query = `
                    SELECT
                        ride_type,
                        COUNT(*) as total_rides,
                        AVG(final_price) as avg_ticket,
                        SUM(final_price) as total_revenue,
                        AVG(distance_km) as avg_distance
                    FROM rides
                    WHERE status = 'completed' AND created_at BETWEEN $1 AND $2
                    GROUP BY ride_type
                `;
                break;

            case 'user_growth':
                query = `
                    SELECT
                        TO_CHAR(DATE(created_at), 'YYYY-MM-DD') as date,
                        COUNT(*) as new_users,
                        SUM(CASE WHEN role='driver' THEN 1 ELSE 0 END) as new_drivers
                    FROM users
                    WHERE created_at BETWEEN $1 AND $2
                    GROUP BY DATE(created_at)
                    ORDER BY date ASC
                `;
                break;

            default:
                return res.status(400).json({ error: "Tipo de relatório inválido. Tipos: financial_daily, rides_performance, user_growth" });
        }

        // Executar Query Selecionada
        const result = await pool.query(query, [`${dFrom} 00:00:00`, `${dTo} 23:59:59`]);
        reportData = result.rows;

        // Persistir o histórico de que o relatório foi gerado
        const reportLog = await pool.query(
            "INSERT INTO admin_reports (report_type, data, generated_by, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id",
            [report_type, JSON.stringify({ params: req.body, summary_count: reportData.length }), req.user.id]
        );

        res.json({
            success: true,
            report_id: reportLog.rows[0].id,
            meta: {
                type: report_type,
                period: { from: dFrom, to: dTo },
                rows: reportData.length
            },
            data: reportData
        });

    } catch (e) {
        logError('REPORT_GEN', e);
        res.status(500).json({ error: "Erro ao gerar relatório." });
    }
};

// =================================================================================================
// 6. CONFIGURAÇÕES DO SISTEMA (SYSTEM SETTINGS)
// =================================================================================================

/**
 * GET SETTINGS
 * Rota: GET /api/admin/settings
 * Descrição: Retorna todas as chaves de configuração do app.
 */
exports.getSettings = async (req, res) => {
    try {
        const settings = await pool.query("SELECT * FROM app_settings ORDER BY key ASC");
        res.json(settings.rows);
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar configurações." });
    }
};

/**
 * UPDATE SETTING
 * Rota: PUT /api/admin/settings/:key
 * Descrição: Atualiza uma chave de configuração (ex: Preços, Taxas).
 *            Afeta o comportamento do sistema em tempo real.
 */
exports.updateSetting = async (req, res) => {
    const { key } = req.params;
    const { value, description } = req.body;

    if (!value) {
        return res.status(400).json({ error: "O valor (value) é obrigatório." });
    }

    try {
        // Upsert (Insert or Update)
        const result = await pool.query(
            `INSERT INTO app_settings (key, value, description, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (key) DO UPDATE SET
                value = $2,
                description = COALESCE($3, app_settings.description),
                updated_at = NOW()
             RETURNING *`,
            [key, JSON.stringify(value), description] // value deve ser JSON
        );

        logSystem('CONFIG_CHANGE', `Admin ${req.user.id} alterou a configuração '${key}'.`);

        res.json({
            success: true,
            message: "Configuração atualizada com sucesso.",
            setting: result.rows[0]
        });

    } catch (e) {
        logError('CONFIG_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar configuração. Verifique se o valor é um JSON válido." });
    }
};

/**
 * =================================================================================================
 * FIM DO ARQUIVO - ADMIN CONTROLLER
 * =================================================================================================
 */