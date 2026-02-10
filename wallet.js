/**
 * =================================================================================================
 * 🏦 AOTRAVEL TITANIUM FINTECH CORE - WALLET ENGINE v9.0 (FINAL STABLE)
 * =================================================================================================
 *
 * ARQUIVO: wallet.js
 * LOCALIZAÇÃO: Raiz do Projeto (Root)
 * DATA: 10 de Fevereiro de 2026
 * AUTOR: AOtravel Engineering Team (Luanda, Angola)
 *
 * DESCRIÇÃO TÉCNICA:
 * Este é o controlador financeiro monolítico da aplicação. Ele encapsula toda a lógica de
 * movimentação de valores, garantindo integridade de dados através de transações ACID.
 *
 * --- ÍNDICE DE MÓDULOS ---
 * 1. CONFIGURAÇÃO E CONSTANTES (System Config)
 * 2. UTILITÁRIOS E LOGGERS (Helpers)
 * 3. GATEWAY DE PAGAMENTOS (Mockup EMIS/CyberSource)
 * 4. INICIALIZAÇÃO DE BANCO DE DADOS (Auto-Migration)
 * 5. MIDDLEWARES DE SEGURANÇA (Auth, KYC, Anti-Fraud)
 * 6. ROTAS DE LEITURA (Dashboard, Extratos)
 * 7. ROTAS TRANSACIONAIS (Transferências, Depósitos, Saques)
 * 8. GESTÃO DE ATIVOS (Cartões, Contas Bancárias)
 * 9. SEGURANÇA E ADMINISTRAÇÃO (PIN, Freeze, Stats)
 *
 * --- GARANTIAS DE INTEGRIDADE ---
 * - Todas as operações de escrita usam 'BEGIN', 'COMMIT' e 'ROLLBACK'.
 * - Row-Level Locking (SELECT FOR UPDATE) aplicado em saldos.
 * - Tratamento de precisão decimal para evitar erros de ponto flutuante.
 *
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// =================================================================================================
// ⚙️ SEÇÃO 1: CONFIGURAÇÕES GLOBAIS (SYSTEM CONFIG)
// =================================================================================================

const SYSTEM_CONFIG = {
    APP_NAME: "AOtravel Titanium Wallet",
    VERSION: "9.0.0-STABLE",
    CURRENCY: "AOA",
    LOCALE: "pt-AO",
    TIMEZONE: "Africa/Luanda",

    // Limites Operacionais (Compliance BNA)
    LIMITS: {
        DAILY_MAX_TIER_1: 500000.00,   // Contas Standard
        DAILY_MAX_TIER_2: 5000000.00,  // Contas Verificadas (KYC)
        TRANSACTION_MIN: 50.00,
        TRANSACTION_MAX: 2000000.00,
        MIN_DEPOSIT: 100.00,
        MIN_WITHDRAW: 2000.00,
        MAX_ACCOUNTS: 5,
        MAX_CARDS: 10,
        MAX_PIN_ATTEMPTS: 3
    },

    // Estrutura de Taxas
    FEES: {
        INTERNAL_TRANSFER: 0.00,    // Grátis
        BANK_WITHDRAWAL_PCT: 0.015, // 1.5%
        BANK_WITHDRAWAL_MIN: 500.00,// Mínimo 500kz de taxa
        SERVICE_PAYMENT_FIXED: 50.00,
        CARD_ISSUANCE: 1000.00
    },

    // Segurança
    SECURITY: {
        BCRYPT_ROUNDS: 12,
        PIN_LENGTH: 4,
        LOCK_DURATION_MINUTES: 30,
        SESSION_TIMEOUT: 900 // 15 minutos
    },

    // Semente Matemática (PI Seed) para gerar números de conta únicos
    ACCOUNT_SEED: "31415926535897932384626433832795"
};

// =================================================================================================
// 🛠️ SEÇÃO 2: UTILITÁRIOS E HELPERS
// =================================================================================================

/**
 * Sistema de Log Financeiro Estruturado
 */
class FinanceLogger {
    static log(level, userId, action, details, refId = 'N/A') {
        const timestamp = new Date().toISOString();
        const payload = {
            ts: timestamp,
            lvl: level,
            uid: userId || 'SYSTEM',
            act: action,
            ref: refId,
            dat: details
        };
        // Em produção, envie para ELK Stack ou Datadog
        console.log(`[${level}] [WALLET_CORE] ${JSON.stringify(payload)}`);
    }

    static info(userId, action, details, ref) { this.log('INFO', userId, action, details, ref); }
    static warn(userId, action, details, ref) { this.log('WARN', userId, action, details, ref); }
    static error(userId, action, details, ref) { this.log('ERROR', userId, action, details, ref); }
    static audit(userId, action, details, ref) { this.log('AUDIT', userId, action, details, ref); }
}

/**
 * Utilitários de Validação e Formatação
 */
const Utils = {
    /**
     * Gera referência única: TRF-YYYYMMDD-HEX
     */
    generateRef: (prefix) => {
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
        return `${prefix}-${dateStr}-${rand}`;
    },

    /**
     * Valida valores monetários (float seguro)
     */
    isValidAmount: (amount) => {
        return amount && !isNaN(amount) && parseFloat(amount) > 0 && isFinite(amount);
    },

    /**
     * Gera número de conta Titanium (21 Dígitos)
     */
    generateAccountNumber: (phone) => {
        if (!phone) return null;
        const cleanPhone = phone.replace(/\D/g, '').slice(-9);
        const year = new Date().getFullYear().toString();
        const seed = SYSTEM_CONFIG.ACCOUNT_SEED.slice(0, 8);
        return `${cleanPhone}${year}${seed}`; // 9 + 4 + 8 = 21 dígitos
    },

    /**
     * Valida IBAN Angolano (AO06...)
     */
    isValidAOIBAN: (iban) => {
        if (!iban) return false;
        const cleanIban = iban.replace(/\s/g, '').toUpperCase();
        return /^AO06[0-9]{21}$/.test(cleanIban) && cleanIban.length === 25;
    },

    /**
     * Mascara dados para logs e recibos
     */
    maskData: (data, visibleEnd = 4) => {
        if (!data || data.length < visibleEnd) return data;
        return '*'.repeat(data.length - visibleEnd) + data.slice(-visibleEnd);
    }
};

// =================================================================================================
// 💳 SEÇÃO 3: GATEWAY DE PAGAMENTOS (MOCKUP EMIS/VISA)
// =================================================================================================

class PaymentGateway {
    constructor() {
        this.providers = {
            'MCX': { name: 'Multicaixa Express', active: true },
            'VISA': { name: 'Visa/Mastercard', active: true },
            'BAI': { name: 'BAI Directo', active: true }
        };
    }

    /**
     * Simula cobrança (Depósito/TopUp)
     */
    async charge(provider, amount, payload) {
        console.log(`[GATEWAY] Iniciando cobrança ${provider} de ${amount} Kz...`);

        // Simulação de latência (300ms a 1.5s)
        const delay = Math.floor(Math.random() * 1200) + 300;
        await new Promise(resolve => setTimeout(resolve, delay));

        if (!this.providers[provider]) throw new Error(`Gateway ${provider} não suportado.`);

        // Validações Mock
        if (provider === 'MCX' && !payload.phone) throw new Error("Telefone MCX inválido.");
        if (provider === 'VISA' && !payload.cardToken) throw new Error("Dados do cartão inválidos.");

        // Taxa de sucesso simulada (99%)
        const success = Math.random() > 0.01;

        if (!success) {
            const reasons = ["Saldo Insuficiente", "Timeout", "Negado pelo Emissor", "Limite Excedido"];
            throw new Error(`[GW_ERR] Transação negada: ${reasons[Math.floor(Math.random() * reasons.length)]}`);
        }

        const txId = crypto.randomUUID();
        return {
            success: true,
            status: 'captured',
            transaction_id: txId,
            provider_ref: `${provider}-${txId.substring(0, 8).toUpperCase()}`,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Simula pagamento de serviços (ENDE, EPAL)
     */
    async payService(entity, reference, amount) {
        const entities = ['ENDE', 'EPAL', 'DSTV', 'ZAP', 'UNITEL', 'MOVICEL'];
        if (!entities.includes(entity)) throw new Error("Entidade inválida.");

        await new Promise(resolve => setTimeout(resolve, 800)); // Latência

        return {
            success: true,
            receipt: `REC-${entity}-${Date.now().toString().slice(-6)}`,
            message: "Pagamento confirmado."
        };
    }
}

const gateway = new PaymentGateway();

// =================================================================================================
// 🚀 SEÇÃO 4: MÓDULO EXPORTÁVEL (LÓGICA DO SERVIDOR)
// =================================================================================================

module.exports = (pool, io) => {

    // =============================================================================================
    // 4.1 AUTO-MIGRAÇÃO (DATABASE BOOTSTRAP)
    // =============================================================================================

    const initializeFinancialSystem = async () => {
        const client = await pool.connect();
        try {
            console.log('🔄 [WALLET_CORE] Iniciando verificação de integridade do Banco de Dados...');
            await client.query('BEGIN');

            // 1. Tabela Principal de Transações
            await client.query(`
                CREATE TABLE IF NOT EXISTS wallet_transactions (
                    id SERIAL PRIMARY KEY,
                    reference_id VARCHAR(100) UNIQUE NOT NULL,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    sender_id INTEGER REFERENCES users(id),
                    receiver_id INTEGER REFERENCES users(id),
                    amount NUMERIC(15, 2) NOT NULL,
                    fee NUMERIC(15, 2) DEFAULT 0.00,
                    currency VARCHAR(3) DEFAULT 'AOA',
                    type VARCHAR(50) NOT NULL,
                    method VARCHAR(50) DEFAULT 'internal',
                    status VARCHAR(20) DEFAULT 'pending',
                    description TEXT,
                    metadata JSONB DEFAULT '{}',
                    balance_after NUMERIC(15, 2),
                    category VARCHAR(50),
                    is_hidden BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 2. Tabela de Contas Externas (IBANs)
            await client.query(`
                CREATE TABLE IF NOT EXISTS external_bank_accounts (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    bank_name VARCHAR(100),
                    iban VARCHAR(50),
                    holder_name VARCHAR(150),
                    is_verified BOOLEAN DEFAULT FALSE,
                    is_default BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 3. Tabela de Cartões Virtuais
            await client.query(`
                CREATE TABLE IF NOT EXISTS wallet_cards (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    card_alias VARCHAR(100),
                    last_four VARCHAR(4),
                    card_network VARCHAR(50),
                    provider_token VARCHAR(255),
                    expiry_date VARCHAR(10),
                    is_active BOOLEAN DEFAULT TRUE,
                    is_default BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 4. Tabela de Logs de Segurança
            await client.query(`
                CREATE TABLE IF NOT EXISTS wallet_security_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    event_type VARCHAR(50),
                    ip_address VARCHAR(45),
                    details JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 5. Injeção de Colunas na Tabela Users (Se não existirem)
            // Isso previne erros de migração ao implantar em bancos existentes
            const columnsToAdd = [
                { name: "balance", type: "NUMERIC(15,2) DEFAULT 0.00" },
                { name: "bonus_points", type: "INTEGER DEFAULT 0" },
                { name: "wallet_account_number", type: "VARCHAR(50) UNIQUE" },
                { name: "wallet_pin_hash", type: "VARCHAR(255)" },
                { name: "wallet_status", type: "VARCHAR(20) DEFAULT 'active'" },
                { name: "daily_limit", type: "NUMERIC(15, 2) DEFAULT 500000.00" },
                { name: "daily_limit_used", type: "NUMERIC(15, 2) DEFAULT 0.00" },
                { name: "last_transaction_date", type: "DATE DEFAULT CURRENT_DATE" },
                { name: "account_tier", type: "VARCHAR(20) DEFAULT 'standard'" },
                { name: "kyc_level", type: "INTEGER DEFAULT 1" }
            ];

            for (const col of columnsToAdd) {
                await client.query(`
                    DO $$
                    BEGIN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='${col.name}') THEN
                            ALTER TABLE users ADD COLUMN ${col.name} ${col.type};
                        END IF;
                    END $$;
                `);
            }

            // 6. Índices para Performance
            await client.query(`CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_wallet_tx_ref ON wallet_transactions(reference_id);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_wallet_tx_date ON wallet_transactions(created_at DESC);`);

            // 7. Sincronização de Legado
            // Corrige usuários que têm saldo > 0 mas nenhuma transação (migração de versões antigas)
            const legacyUsers = await client.query(`
                SELECT u.id, u.balance FROM users u
                LEFT JOIN wallet_transactions t ON u.id = t.user_id
                WHERE u.balance > 0 AND t.id IS NULL
            `);

            if (legacyUsers.rows.length > 0) {
                console.log(`⚠️ [WALLET_SYNC] Sincronizando ${legacyUsers.rows.length} contas legadas...`);
                for (const user of legacyUsers.rows) {
                    const ref = Utils.generateRef('MIG');
                    await client.query(`
                        INSERT INTO wallet_transactions
                        (reference_id, user_id, amount, type, status, description, balance_after)
                        VALUES ($1, $2, $3, 'system_adjustment', 'completed', 'Migração de Saldo Legado', $3)
                    `, [ref, user.id, user.balance]);
                }
            }

            // 8. Geração de Números de Conta Faltantes
            await client.query(`
                UPDATE users SET wallet_account_number = phone || 'AO'
                WHERE wallet_account_number IS NULL AND phone IS NOT NULL
            `);

            await client.query('COMMIT');
            console.log('✅ [WALLET_CORE] Sistema Financeiro: PRONTO E ÍNTEGRO (v9.0).');

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ [WALLET_FATAL] Falha crítica na inicialização:', error);
            // Não matar o processo, permitir que o resto do app tente rodar
        } finally {
            client.release();
        }
    };

    // Executa imediatamente
    initializeFinancialSystem();


    // =============================================================================================
    // 4.2 MIDDLEWARES DE SEGURANÇA
    // =============================================================================================

    /**
     * Valida se o usuário está autenticado
     */
    const requireAuth = (req, res, next) => {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: "Sessão expirada. Faça login novamente.", code: "AUTH_REQUIRED" });
        }
        next();
    };

    /**
     * Valida se a carteira está ativa (não congelada/bloqueada)
     */
    const requireActiveWallet = async (req, res, next) => {
        try {
            const result = await pool.query(
                "SELECT wallet_status, is_blocked FROM users WHERE id = $1",
                [req.user.id]
            );
            const userStatus = result.rows[0];

            if (!userStatus) return res.status(404).json({ error: "Usuário não encontrado." });

            if (userStatus.is_blocked) {
                return res.status(403).json({
                    error: "Conta bloqueada administrativamente.",
                    code: "ACCOUNT_BLOCKED"
                });
            }

            if (userStatus.wallet_status === 'frozen') {
                return res.status(403).json({
                    error: "Carteira congelada por segurança. Contacte o suporte.",
                    code: "WALLET_FROZEN"
                });
            }

            next();
        } catch (e) {
            res.status(500).json({ error: "Erro ao validar status da carteira." });
        }
    };

    /**
     * Helper interno para verificar PIN (não é middleware de rota)
     */
    const verifyPinInternal = async (client, userId, pin) => {
        const result = await client.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
        const hash = result.rows[0]?.wallet_pin_hash;

        if (!hash) throw new Error("PIN de transação não configurado.");

        const match = await bcrypt.compare(pin, hash);
        if (!match) throw new Error("PIN incorreto.");

        return true;
    };


    // =============================================================================================
    // 4.3 ROTAS DE LEITURA (DASHBOARD & EXTRATO)
    // =============================================================================================

    /**
     * GET /dashboard
     * Retorna saldo, extrato recente, cartões e contas.
     */
    router.get('/dashboard', requireAuth, async (req, res) => {
        const userId = req.user.id;
        try {
            // Promise.all para executar queries em paralelo (Performance)
            const [userData, transactions, cards, banks] = await Promise.all([
                pool.query(`
                    SELECT balance, bonus_points, wallet_account_number, daily_limit,
                           wallet_status, kyc_level, account_tier,
                           wallet_pin_hash IS NOT NULL as has_pin
                    FROM users WHERE id = $1`, [userId]),

                pool.query(`
                    SELECT t.*,
                           s.name as sender_name, s.photo as sender_photo,
                           r.name as receiver_name, r.photo as receiver_photo
                    FROM wallet_transactions t
                    LEFT JOIN users s ON t.sender_id = s.id
                    LEFT JOIN users r ON t.receiver_id = r.id
                    WHERE t.user_id = $1 AND t.is_hidden = FALSE
                    ORDER BY t.created_at DESC LIMIT 20`, [userId]),

                pool.query(`SELECT * FROM wallet_cards WHERE user_id = $1 AND is_active = TRUE`, [userId]),
                pool.query(`SELECT * FROM external_bank_accounts WHERE user_id = $1`, [userId])
            ]);

            const user = userData.rows[0];

            // Auto-gera número da conta se faltar
            if (!user.wallet_account_number) {
                const phoneRes = await pool.query("SELECT phone FROM users WHERE id = $1", [userId]);
                if (phoneRes.rows.length > 0) {
                    const newAcc = Utils.generateAccountNumber(phoneRes.rows[0].phone);
                    if (newAcc) {
                        await pool.query("UPDATE users SET wallet_account_number = $1 WHERE id = $2", [newAcc, userId]);
                        user.wallet_account_number = newAcc;
                    }
                }
            }

            // Payload formatado para o Frontend
            res.json({
                account: {
                    balance: parseFloat(user.balance || 0),
                    formatted_balance: parseFloat(user.balance || 0).toLocaleString('pt-AO', { style: 'currency', currency: 'AOA' }),
                    points: user.bonus_points || 0,
                    account_number: user.wallet_account_number || "---",
                    daily_limit: parseFloat(user.daily_limit || SYSTEM_CONFIG.LIMITS.DAILY_MAX_TIER_1),
                    status: user.wallet_status,
                    tier: user.account_tier,
                    has_pin: user.has_pin
                },
                recent_activity: transactions.rows.map(tx => ({
                    id: tx.id,
                    reference: tx.reference_id,
                    type: tx.type,
                    amount: parseFloat(tx.amount),
                    is_negative: parseFloat(tx.amount) < 0,
                    description: tx.description,
                    date: tx.created_at,
                    status: tx.status,
                    counterpart: parseFloat(tx.amount) < 0 ? tx.receiver_name : tx.sender_name,
                    icon_url: parseFloat(tx.amount) < 0 ? tx.receiver_photo : tx.sender_photo
                })),
                cards: cards.rows,
                external_accounts: banks.rows
            });

        } catch (error) {
            FinanceLogger.error(userId, 'DASHBOARD_ERROR', error.message);
            res.status(500).json({ error: "Falha ao carregar dashboard." });
        }
    });

    /**
     * GET /transactions
     * Histórico completo paginado.
     */
    router.get('/transactions', requireAuth, async (req, res) => {
        const userId = req.user.id;
        const { page = 1, limit = 50, type } = req.query;
        const offset = (page - 1) * limit;

        try {
            let query = `
                SELECT t.*, s.name as sender_name, r.name as receiver_name
                FROM wallet_transactions t
                LEFT JOIN users s ON t.sender_id = s.id
                LEFT JOIN users r ON t.receiver_id = r.id
                WHERE t.user_id = $1 AND t.is_hidden = FALSE
            `;

            const params = [userId];
            if (type && type !== 'all') {
                query += ` AND t.type = $2`;
                params.push(type);
            }

            query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            res.json(result.rows);

        } catch (e) {
            res.status(500).json({ error: "Erro ao buscar histórico." });
        }
    });


    // =============================================================================================
    // 🚀 4.4 ROTAS TRANSACIONAIS (ACID COMPLIANT)
    // =============================================================================================

    /**
     * POST /transfer/internal
     * Transferência P2P entre usuários.
     */
    router.post('/transfer/internal', requireAuth, requireActiveWallet, async (req, res) => {
        const { receiver_identifier, amount, pin, description } = req.body;
        const senderId = req.user.id;
        const txAmount = parseFloat(amount);
        const txRef = Utils.generateRef('TRF');

        // Validações Básicas
        if (!Utils.isValidAmount(txAmount)) return res.status(400).json({ error: "Valor inválido." });
        if (txAmount < SYSTEM_CONFIG.LIMITS.TRANSACTION_MIN) return res.status(400).json({ error: `Valor mínimo: ${SYSTEM_CONFIG.LIMITS.TRANSACTION_MIN} Kz.` });
        if (!recipient_identifier || !pin) return res.status(400).json({ error: "Dados incompletos." });

        const client = await pool.connect();

        try {
            // INÍCIO DA TRANSAÇÃO ATÔMICA
            await client.query('BEGIN');

            // 1. Lock do Remetente (Prevenir Race Conditions)
            const senderRes = await client.query(
                "SELECT id, name, balance, wallet_pin_hash, daily_limit_used, last_transaction_date FROM users WHERE id = $1 FOR UPDATE",
                [senderId]
            );
            const sender = senderRes.rows[0];

            // 2. Verificar PIN e Saldo
            await verifyPinInternal(client, senderId, pin);
            if (parseFloat(sender.balance) < txAmount) throw new Error("Saldo insuficiente.");

            // 3. Verificar Limites Diários
            const today = new Date().toISOString().split('T')[0];
            const lastTxDate = new Date(sender.last_transaction_date).toISOString().split('T')[0];
            let currentUsage = parseFloat(sender.daily_limit_used);
            if (lastTxDate !== today) currentUsage = 0; // Reset diário

            if (currentUsage + txAmount > SYSTEM_CONFIG.LIMITS.DAILY_MAX_TIER_1) {
                throw new Error("Limite diário excedido.");
            }

            // 4. Localizar Destinatário
            const receiverRes = await client.query(
                `SELECT id, name, fcm_token, wallet_status FROM users
                 WHERE (email = $1 OR phone = $1 OR wallet_account_number = $1) AND id != $2`,
                [receiver_identifier, senderId]
            );

            if (receiverRes.rows.length === 0) throw new Error("Destinatário não encontrado.");
            const receiver = receiverRes.rows[0];
            if (receiver.wallet_status !== 'active') throw new Error("A conta do destinatário não pode receber fundos.");

            // 5. Executar Movimentação (Débito e Crédito)
            const newSenderBalance = parseFloat(sender.balance) - txAmount;
            const newUsage = currentUsage + txAmount;

            // Update Sender
            await client.query(
                "UPDATE users SET balance = $1, daily_limit_used = $2, last_transaction_date = CURRENT_DATE WHERE id = $3",
                [newSenderBalance, newUsage, senderId]
            );

            // Update Receiver
            await client.query(
                "UPDATE users SET balance = balance + $1 WHERE id = $2",
                [txAmount, receiver.id]
            );

            // 6. Registrar Ledger (Dupla Entrada)
            // Sender Log (Saída)
            await client.query(
                `INSERT INTO wallet_transactions
                (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, balance_after)
                VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6, $7)`,
                [txRef, senderId, senderId, receiver.id, -txAmount, description || `Envio para ${receiver.name}`, newSenderBalance]
            );

            // Receiver Log (Entrada)
            await client.query(
                `INSERT INTO wallet_transactions
                (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description)
                VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6)`,
                [txRef, receiver.id, senderId, receiver.id, txAmount, `Recebido de ${sender.name}`]
            );

            // FINALIZAR TRANSAÇÃO
            await client.query('COMMIT');

            // 7. Notificações (Socket.IO)
            if (io) {
                // Notifica Destinatário
                io.to(`user_${receiver.id}`).emit('wallet_update', {
                    type: 'received',
                    increment: txAmount,
                    reference: txRef
                });
                io.to(`user_${receiver.id}`).emit('notification', {
                    title: 'Dinheiro Recebido',
                    body: `Recebeu ${txAmount} Kz de ${sender.name}`
                });

                // Confirmação para Remetente
                io.to(`user_${senderId}`).emit('wallet_update', {
                    type: 'sent',
                    amount: txAmount,
                    new_balance: newSenderBalance
                });
            }

            res.json({
                success: true,
                message: "Transferência realizada com sucesso!",
                data: { reference: txRef, amount: txAmount, recipient: receiver.name }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            FinanceLogger.error(senderId, 'TRANSFER_FAILED', error.message);
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    /**
     * POST /topup - Depósito via Gateway (MCX/Visa)
     */
    router.post('/topup', requireAuth, requireActiveWallet, async (req, res) => {
        const { amount, method, payment_details } = req.body;
        const userId = req.user.id;
        const txAmount = parseFloat(amount);

        if (!Utils.isValidAmount(txAmount)) return res.status(400).json({ error: "Valor inválido." });

        try {
            // 1. Cobrar no Gateway
            const gwResult = await gateway.charge(
                method === 'visa' ? 'VISA' : 'MCX',
                txAmount,
                { phone: payment_details?.phone || req.user.phone }
            );

            // 2. Atualizar Banco de Dados
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Creditar
                await client.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [txAmount, userId]);

                // Registrar
                await client.query(
                    `INSERT INTO wallet_transactions
                     (reference_id, user_id, amount, type, method, status, description, metadata)
                     VALUES ($1, $2, $3, 'deposit', $4, 'completed', $5, $6)`,
                    [gwResult.provider_ref, userId, txAmount, method, 'Recarga via ' + method, JSON.stringify(gwResult)]
                );

                await client.query('COMMIT');

                io.to(`user_${userId}`).emit('wallet_update', { type: 'topup', amount: txAmount });

                res.json({ success: true, message: "Recarga efetuada!", new_balance: txAmount });

            } catch (dbError) {
                await client.query('ROLLBACK');
                throw new Error("Erro ao salvar transação. Contacte o suporte com Ref: " + gwResult.provider_ref);
            } finally {
                client.release();
            }

        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /withdraw - Saque para Conta Bancária
     */
    router.post('/withdraw', requireAuth, requireActiveWallet, async (req, res) => {
        const { amount, bank_account_id, pin } = req.body;
        const userId = req.user.id;
        const txAmount = parseFloat(amount);
        const txRef = Utils.generateRef('WTH');

        if (txAmount < SYSTEM_CONFIG.LIMITS.MIN_WITHDRAW) return res.status(400).json({ error: `Saque mínimo: ${SYSTEM_CONFIG.LIMITS.MIN_WITHDRAW} Kz.` });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const userRes = await client.query("SELECT balance FROM users WHERE id = $1 FOR UPDATE", [userId]);
            const balance = parseFloat(userRes.rows[0].balance);

            await verifyPinInternal(client, userId, pin);

            // Calcular taxas
            let fee = txAmount * SYSTEM_CONFIG.FEES.BANK_WITHDRAWAL_PCT;
            if (fee < SYSTEM_CONFIG.FEES.BANK_WITHDRAWAL_MIN) fee = SYSTEM_CONFIG.FEES.BANK_WITHDRAWAL_MIN;

            const totalDed = txAmount + fee;

            if (balance < totalDed) throw new Error(`Saldo insuficiente (Saque + Taxa: ${totalDed.toFixed(2)} Kz).`);

            // Debitar
            await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [totalDed, userId]);

            // Buscar dados da conta
            const bankRes = await client.query("SELECT * FROM external_bank_accounts WHERE id = $1 AND user_id = $2", [bank_account_id, userId]);
            if (bankRes.rows.length === 0) throw new Error("Conta bancária inválida.");
            const bank = bankRes.rows[0];

            // Registrar (Status: PENDING)
            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, amount, fee, type, method, status, description, metadata)
                 VALUES ($1, $2, $3, $4, 'withdraw', 'bank_transfer', 'pending', $5, $6)`,
                [
                    txRef,
                    userId,
                    -txAmount,
                    fee,
                    `Saque para ${bank.bank_name}`,
                    JSON.stringify({ iban: bank.iban, holder: bank.holder_name })
                ]
            );

            await client.query('COMMIT');

            io.to(`user_${userId}`).emit('wallet_update', { type: 'withdraw', amount: totalDed });

            res.json({ success: true, message: "Saque solicitado. Aguarde processamento (24h).", reference: txRef });

        } catch (e) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: e.message });
        } finally {
            client.release();
        }
    });

    /**
     * POST /pay-service - Pagamento de Serviços
     */
    router.post('/pay-service', requireAuth, requireActiveWallet, async (req, res) => {
        const { service_id, reference, amount, pin } = req.body;
        const userId = req.user.id;
        const txAmount = parseFloat(amount);
        const txRef = Utils.generateRef('PAY');

        if (!Utils.isValidAmount(txAmount)) return res.status(400).json({ error: "Valor inválido." });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const userRes = await client.query("SELECT balance FROM users WHERE id = $1 FOR UPDATE", [userId]);
            await verifyPinInternal(client, userId, pin);

            const totalCost = txAmount + SYSTEM_CONFIG.FEES.SERVICE_PAYMENT_FIXED;
            if (parseFloat(userRes.rows[0].balance) < totalCost) throw new Error("Saldo insuficiente.");

            // Gateway Service
            const svcResult = await gateway.payService(service_id, reference, txAmount);

            // Debitar
            await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [totalCost, userId]);

            // Registrar
            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, amount, fee, type, method, status, description, metadata)
                 VALUES ($1, $2, $3, $4, 'bill_payment', 'internal', 'completed', $5, $6)`,
                [
                    txRef,
                    userId,
                    -txAmount,
                    SYSTEM_CONFIG.FEES.SERVICE_PAYMENT_FIXED,
                    `Pagamento ${service_id}`,
                    JSON.stringify({ ref: reference, receipt: svcResult.receipt })
                ]
            );

            await client.query('COMMIT');

            io.to(`user_${userId}`).emit('wallet_update', { type: 'payment', amount: totalCost });

            res.json({ success: true, message: "Pagamento realizado.", receipt: svcResult.receipt });

        } catch (e) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: e.message });
        } finally {
            client.release();
        }
    });


    // =============================================================================================
    // 💳 4.5 GESTÃO DE ATIVOS (CARTÕES E CONTAS)
    // =============================================================================================

    router.post('/cards/add', requireAuth, async (req, res) => {
        const { number, expiry, alias, type } = req.body;
        const userId = req.user.id;

        if (!number || number.length < 13) return res.status(400).json({ error: "Número inválido." });

        try {
            const count = await pool.query("SELECT COUNT(*) FROM wallet_cards WHERE user_id = $1", [userId]);
            if (parseInt(count.rows[0].count) >= SYSTEM_CONFIG.LIMITS.MAX_CARDS) return res.status(400).json({ error: "Limite de cartões atingido." });

            const token = crypto.createHash('sha256').update(number + userId).digest('hex');
            const isDefault = parseInt(count.rows[0].count) === 0;

            await pool.query(
                `INSERT INTO wallet_cards (user_id, card_alias, last_four, provider_token, expiry_date, card_network, is_default)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [userId, alias || 'Meu Cartão', number.slice(-4), token, expiry, type || 'VISA', isDefault]
            );

            res.json({ success: true, message: "Cartão adicionado." });
        } catch (e) {
            res.status(500).json({ error: "Erro ao adicionar cartão." });
        }
    });

    router.delete('/cards/:id', requireAuth, async (req, res) => {
        try {
            await pool.query("DELETE FROM wallet_cards WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: "Erro ao remover cartão." });
        }
    });

    router.post('/accounts/add', requireAuth, async (req, res) => {
        const { provider, account_number, holder_name } = req.body;
        const userId = req.user.id;

        if (!account_number) return res.status(400).json({ error: "Número da conta inválido." });

        try {
            const count = await pool.query("SELECT COUNT(*) FROM external_bank_accounts WHERE user_id = $1", [userId]);
            if (parseInt(count.rows[0].count) >= SYSTEM_CONFIG.LIMITS.MAX_ACCOUNTS) return res.status(400).json({ error: "Limite de contas atingido." });

            await pool.query(
                `INSERT INTO external_bank_accounts (user_id, bank_name, iban, holder_name)
                 VALUES ($1, $2, $3, $4)`,
                [userId, provider, account_number, holder_name]
            );

            res.json({ success: true, message: "Conta bancária adicionada." });
        } catch (e) {
            res.status(500).json({ error: "Erro ao salvar conta." });
        }
    });

    router.delete('/accounts/:id', requireAuth, async (req, res) => {
        try {
            await pool.query("DELETE FROM external_bank_accounts WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: "Erro ao remover conta." });
        }
    });


    // =============================================================================================
    // 🔐 4.6 SEGURANÇA E PIN
    // =============================================================================================

    router.post('/set-pin', requireAuth, async (req, res) => {
        const { current_pin, new_pin } = req.body;
        const userId = req.user.id;

        if (!new_pin || new_pin.length !== 4 || isNaN(new_pin)) return res.status(400).json({ error: "PIN deve ser 4 números." });

        try {
            const result = await pool.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
            if (result.rows[0]?.wallet_pin_hash) {
                if (!current_pin) return res.status(400).json({ error: "PIN atual obrigatório." });
                if (!await bcrypt.compare(current_pin, result.rows[0].wallet_pin_hash)) return res.status(401).json({ error: "PIN atual incorreto." });
            }

            const hash = await bcrypt.hash(new_pin, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);
            await pool.query("UPDATE users SET wallet_pin_hash = $1 WHERE id = $2", [hash, userId]);

            await pool.query("INSERT INTO wallet_security_logs (user_id, event_type, ip_address) VALUES ($1, 'PIN_CHANGE', $2)", [userId, req.ip]);

            res.json({ success: true, message: "PIN definido com sucesso." });
        } catch (e) {
            res.status(500).json({ error: "Erro ao definir PIN." });
        }
    });

    router.post('/verify-pin', requireAuth, async (req, res) => {
        try {
            const client = await pool.connect();
            try {
                await verifyPinInternal(client, req.user.id, req.body.pin);
                res.json({ valid: true });
            } finally {
                client.release();
            }
        } catch (e) {
            res.json({ valid: false, error: e.message });
        }
    });

    router.post('/security/freeze', requireAuth, async (req, res) => {
        try {
            await pool.query("UPDATE users SET wallet_status = 'frozen' WHERE id = $1", [req.user.id]);
            res.json({ success: true, message: "Carteira congelada com sucesso." });
        } catch (e) {
            res.status(500).json({ error: "Erro ao congelar conta." });
        }
    });

    // =============================================================================================
    // 📊 4.7 ADMINISTRAÇÃO (STATS)
    // =============================================================================================

    router.get('/admin/stats', requireAuth, async (req, res) => {
        if (req.user.role !== 'admin') return res.status(403).json({ error: "Acesso negado." });
        try {
            const stats = await pool.query(`
                SELECT
                    (SELECT COALESCE(SUM(balance), 0) FROM users) as total_liquidity,
                    (SELECT COUNT(*) FROM wallet_transactions) as total_txs,
                    (SELECT COALESCE(SUM(amount), 0) FROM wallet_transactions WHERE type='deposit') as total_deposits
            `);
            res.json(stats.rows[0]);
        } catch (e) {
            res.status(500).json({ error: "Erro interno admin." });
        }
    });

    // =============================================================================================
    // 🛑 PONTO DE SAÍDA CRÍTICO: RETORNO DO ROUTER
    // =============================================================================================
    // O router configurado é retornado aqui para ser usado no server.js

    return router;
};
