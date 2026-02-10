/**
 * =================================================================================================
 * 🏦 AOTRAVEL TITANIUM FINANCIAL ENGINE - CORE WALLET SYSTEM v6.0 (FINAL PRODUCTION RELEASE)
 * =================================================================================================
 *
 * ARQUIVO: backend/wallet.js
 * LOCALIZAÇÃO: Luanda, Angola
 * DATA: 10 de Fevereiro de 2026
 *
 * DESCRIÇÃO:
 * Este é o motor financeiro central da plataforma AOtravel. Ele gerencia todo o ciclo de vida
 * financeiro do usuário, desde a criação da conta virtual (Titanium Account) até transações
 * complexas, integrações bancárias (BAI, BFA, BIC), Multicaixa Express e gestão de cartões.
 *
 * --- RECURSOS DO SISTEMA ---
 * 1.  ACID Compliance: Uso estrito de transações de banco de dados (BEGIN/COMMIT/ROLLBACK).
 * 2.  Race Condition Proof: Bloqueio de linhas (ROW LOCKING) para impedir gasto duplo.
 * 3.  Security: Hashing de PIN com Bcrypt, validação de sessão, proteção contra injeção SQL.
 * 4.  Audit: Log financeiro imutável e detalhado.
 * 5.  Gateway Integration: Camada de abstração para EMIS, VISA e Bancos Locais.
 * 6.  Auto-Healing: Verificação e criação automática de tabelas e índices.
 *
 * --- DEPENDÊNCIAS ESPERADAS ---
 * - pg (PostgreSQL Client)
 * - express (Router)
 * - bcrypt (Hashing)
 * - crypto (Randomização segura)
 * - socket.io (Notificações Real-Time)
 *
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// =================================================================================================
// ⚙️ CONSTANTES E CONFIGURAÇÕES DO SISTEMA (SYSTEM CONFIG)
// =================================================================================================

const SYSTEM_CONFIG = {
    APP_NAME: "AOtravel Titanium Wallet",
    VERSION: "6.0.2-STABLE",
    CURRENCY: "AOA",
    LOCALE: "pt-AO",
    TIMEZONE: "Africa/Luanda",
    
    // Limites Financeiros (Regras de Negócio / Compliance BNA)
    LIMITS: {
        DAILY_MAX: 500000.00,       // Limite padrão diário (500k Kz)
        TRANSACTION_MAX: 250000.00, // Limite por transação única
        MIN_DEPOSIT: 100.00,        // Depósito mínimo
        MIN_WITHDRAW: 2000.00,      // Saque mínimo
        MAX_ACCOUNTS: 5,            // Máximo de contas bancárias vinculadas
        MAX_CARDS: 10               // Máximo de cartões virtuais
    },

    // Taxas (Revenue Model)
    FEES: {
        INTERNAL_TRANSFER: 0.00,    // Grátis entre usuários AOtravel
        WITHDRAWAL: 0.01,           // 1% de taxa de saque (Simulação)
        SERVICE_PAYMENT: 50.00      // 50 Kz por pagamento de serviço
    },

    // Segurança
    SECURITY: {
        BCRYPT_ROUNDS: 12,          // Custo de processamento do hash
        PIN_LENGTH: 4,
        LOCK_DURATION_MS: 3000,     // Latência simulada para segurança
        MAX_PIN_ATTEMPTS: 3
    },

    // Semente para Geração de Contas (Baseado em PI para unicidade matemática)
    ACCOUNT_SEED: "14159265358979323846"
};

// =================================================================================================
// 🛠️ UTILITÁRIOS E HELPERS (TOOLKIT)
// =================================================================================================

/**
 * Classe de Log Especializado para Auditoria Financeira
 */
class FinanceLogger {
    static log(level, userId, action, details) {
        const timestamp = new Date().toISOString();
        const payload = {
            ts: timestamp,
            lvl: level,
            uid: userId,
            act: action,
            dat: details
        };
        // Em produção, isso iria para ElasticSearch ou Datadog
        console.log(`[${level}] [WALLET_CORE] ${JSON.stringify(payload)}`);
    }

    static info(userId, action, details) { this.log('INFO', userId, action, details); }
    static warn(userId, action, details) { this.log('WARN', userId, action, details); }
    static error(userId, action, details) { this.log('ERROR', userId, action, details); }
}

/**
 * Utilitários de Formatação e Validação
 */
const Utils = {
    /**
     * Gera referência única legível: TIPO-TIMESTAMP-HEX
     */
    generateRef: (prefix) => {
        const ts = Date.now().toString().slice(-8);
        const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
        return `${prefix}-${ts}-${rand}`;
    },

    /**
     * Valida formato monetário seguro
     */
    isValidAmount: (amount) => {
        return amount && !isNaN(amount) && parseFloat(amount) > 0;
    },

    /**
     * Gera número de conta Titanium (21 dígitos)
     * Formato: 9 dig (tel) + 4 dig (ano) + 8 dig (seed)
     */
    generateAccountNumber: (phone) => {
        if (!phone) return null;
        const cleanPhone = phone.replace(/\D/g, '').slice(-9); // Garante 9 dígitos
        const year = new Date().getFullYear().toString();
        const seed = SYSTEM_CONFIG.ACCOUNT_SEED.slice(0, 8);
        return `${cleanPhone}${year}${seed}`;
    },

    /**
     * Valida IBAN Angolano (Formato Simplificado AO06)
     */
    isValidAOIBAN: (iban) => {
        // Validação básica de regex para IBAN de Angola
        // Ex: AO06 0000 0000 0000 0000 0000 0
        const cleanIban = iban.replace(/\s/g, '').toUpperCase();
        return /^AO06[0-9]{21}$/.test(cleanIban);
    }
};

// =================================================================================================
// 💳 GATEWAY DE PAGAMENTOS (MOCKUP PRODUCTION READY)
// =================================================================================================

/**
 * Simula a comunicação com gateways reais como EMIS (Multicaixa),
 * CyberSource (Visa/Master) e APIs bancárias locais.
 */
class PaymentGateway {
    constructor() {
        this.providers = {
            'MCX': { name: 'Multicaixa Express', active: true },
            'VISA': { name: 'Visa/Mastercard Secure', active: true },
            'BAI_DIRECT': { name: 'BAI Directo', active: true }
        };
    }

    async processPayment(provider, amount, payload) {
        // Simulação de delay de rede (Network Latency)
        const delay = Math.floor(Math.random() * 800) + 200;
        await new Promise(resolve => setTimeout(resolve, delay));

        if (!this.providers[provider]) {
            throw new Error(`Provedor de pagamento ${provider} não suportado.`);
        }

        // Validações Específicas
        if (provider === 'MCX' && !payload.phone) throw new Error("Telefone obrigatório para MCX.");
        if (provider === 'VISA' && !payload.cardToken) throw new Error("Token do cartão inválido.");

        // Simulação de Sucesso/Falha (99% de sucesso)
        const isSuccess = Math.random() > 0.01; 

        if (!isSuccess) {
            throw new Error(`[GW_REJ] Transação recusada pelo emissor (${provider}). Saldo insuficiente ou timeout.`);
        }

        return {
            success: true,
            status: 'captured',
            provider_ref: `${provider}-${crypto.randomUUID()}`,
            timestamp: new Date().toISOString(),
            fee_applied: 0.00
        };
    }
}

const gateway = new PaymentGateway();

// =================================================================================================
// 🚀 MÓDULO EXPORTÁVEL (ROUTER & LOGIC)
// =================================================================================================

module.exports = (pool, io) => {

    // =============================================================================================
    // 1. BOOTSTRAP DO BANCO DE DADOS (AUTO-MIGRAÇÃO)
    // =============================================================================================
    
    const initializeDatabase = async () => {
        const client = await pool.connect();
        try {
            console.log('🔄 [WALLET_CORE] Inicializando esquema de banco de dados financeiro...');
            await client.query('BEGIN');

            // 1.1 Tabela Principal de Transações (Ledger)
            await client.query(`
                CREATE TABLE IF NOT EXISTS wallet_transactions (
                    id SERIAL PRIMARY KEY,
                    reference_id VARCHAR(50) UNIQUE NOT NULL,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    sender_id INTEGER REFERENCES users(id),
                    receiver_id INTEGER REFERENCES users(id),
                    amount NUMERIC(15, 2) NOT NULL,
                    fee NUMERIC(15, 2) DEFAULT 0.00,
                    currency VARCHAR(3) DEFAULT 'AOA',
                    type VARCHAR(20) NOT NULL, -- transfer, deposit, withdraw, payment, service
                    method VARCHAR(20) NOT NULL, -- internal, mcx, visa, iban
                    status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed, reversed
                    description TEXT,
                    metadata JSONB DEFAULT '{}',
                    balance_after NUMERIC(15, 2),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 1.2 Tabela de Contas Bancárias Externas
            await client.query(`
                CREATE TABLE IF NOT EXISTS external_bank_accounts (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    bank_name VARCHAR(50) NOT NULL, -- BAI, BFA, BIC...
                    iban VARCHAR(34) NOT NULL,
                    holder_name VARCHAR(100) NOT NULL,
                    is_verified BOOLEAN DEFAULT FALSE,
                    is_default BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 1.3 Tabela de Cartões Virtual/Físico
            await client.query(`
                CREATE TABLE IF NOT EXISTS wallet_cards (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    card_alias VARCHAR(50),
                    card_network VARCHAR(20), -- VISA, MASTERCARD
                    last_four VARCHAR(4) NOT NULL,
                    provider_token VARCHAR(255) NOT NULL, -- Token seguro, nunca o numero real
                    expiry_date VARCHAR(7), -- MM/YY
                    is_active BOOLEAN DEFAULT TRUE,
                    is_default BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 1.4 Tabela de Logs de Auditoria de Segurança
            await client.query(`
                CREATE TABLE IF NOT EXISTS wallet_security_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    event_type VARCHAR(50), -- PIN_CHANGE, LOGIN, BLOCK
                    ip_address VARCHAR(45),
                    details JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // 1.5 Atualização da Tabela de Usuários (Colunas Financeiras)
            // Verifica e adiciona colunas se não existirem (Idempotência)
            const userColumns = [
                "ADD COLUMN IF NOT EXISTS wallet_account_number VARCHAR(30) UNIQUE",
                "ADD COLUMN IF NOT EXISTS wallet_pin_hash VARCHAR(255)",
                "ADD COLUMN IF NOT EXISTS wallet_status VARCHAR(20) DEFAULT 'active'", -- active, frozen, blocked
                "ADD COLUMN IF NOT EXISTS daily_limit_used NUMERIC(15, 2) DEFAULT 0.00",
                "ADD COLUMN IF NOT EXISTS last_transaction_date DATE DEFAULT CURRENT_DATE",
                "ADD COLUMN IF NOT EXISTS kyc_level INTEGER DEFAULT 1"
            ];

            for (const col of userColumns) {
                await client.query(`ALTER TABLE users ${col};`);
            }

            // 1.6 Criação de Índices para Alta Performance
            await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_user ON wallet_transactions(user_id);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_ref ON wallet_transactions(reference_id);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_created ON wallet_transactions(created_at DESC);`);

            await client.query('COMMIT');
            console.log('✅ [WALLET_CORE] Banco de dados financeiro verificado e pronto.');

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ [WALLET_CORE] Falha crítica na inicialização do DB:', error);
            // Não matamos o processo, mas logamos erro crítico
        } finally {
            client.release();
        }
    };

    // Executar inicialização ao carregar
    initializeDatabase();

    // =============================================================================================
    // 2. MIDDLEWARES DE SEGURANÇA E VALIDAÇÃO
    // =============================================================================================

    /**
     * Middleware: Verifica se o usuário está autenticado
     * (Assume que um middleware anterior decodificou o JWT e populou req.user)
     */
    const requireAuth = (req, res, next) => {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
        }
        next();
    };

    /**
     * Middleware: Verifica se a carteira está ativa (Não bloqueada/congelada)
     */
    const requireActiveWallet = async (req, res, next) => {
        try {
            const result = await pool.query(
                "SELECT wallet_status FROM users WHERE id = $1", 
                [req.user.id]
            );
            
            const status = result.rows[0]?.wallet_status;

            if (status === 'blocked') {
                return res.status(403).json({ 
                    error: "Carteira bloqueada por segurança. Contacte o suporte.",
                    code: "WALLET_BLOCKED"
                });
            }
            
            if (status === 'frozen') {
                return res.status(403).json({ 
                    error: "Carteira congelada temporariamente.",
                    code: "WALLET_FROZEN"
                });
            }

            next();
        } catch (e) {
            res.status(500).json({ error: "Erro ao verificar status da carteira." });
        }
    };

    /**
     * Helper: Verifica PIN (Deve ser chamado dentro das rotas sensíveis)
     */
    const verifyPinInternal = async (userId, pin) => {
        const result = await pool.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
        const hash = result.rows[0]?.wallet_pin_hash;

        if (!hash) throw new Error("PIN não configurado na conta.");
        
        const match = await bcrypt.compare(pin, hash);
        if (!match) throw new Error("PIN de segurança incorreto.");
        
        return true;
    };

    // =============================================================================================
    // 3. ROTAS DE LEITURA (READ-ONLY / DASHBOARD)
    // =============================================================================================

    /**
     * GET /api/wallet/dashboard
     * Retorna o estado completo da carteira do usuário.
     */
    router.get('/dashboard', requireAuth, async (req, res) => {
        const userId = req.user.id;
        const startTime = Date.now();

        try {
            // Executa consultas em paralelo para máxima performance
            const [userRes, txRes, cardsRes, banksRes] = await Promise.all([
                // 1. Dados Vitais do Usuário
                pool.query(`
                    SELECT balance, bonus_points, wallet_account_number, iban, 
                           wallet_status, kyc_level, wallet_pin_hash IS NOT NULL as has_pin
                    FROM users WHERE id = $1`, [userId]),

                // 2. Últimas 10 Transações
                pool.query(`
                    SELECT t.*, 
                           s.name as sender_name, 
                           r.name as receiver_name 
                    FROM wallet_transactions t
                    LEFT JOIN users s ON t.sender_id = s.id
                    LEFT JOIN users r ON t.receiver_id = r.id
                    WHERE t.user_id = $1
                    ORDER BY t.created_at DESC LIMIT 10`, [userId]),

                // 3. Cartões
                pool.query(`
                    SELECT id, card_alias, last_four, card_network, is_default 
                    FROM wallet_cards WHERE user_id = $1 AND is_active = TRUE`, [userId]),

                // 4. Contas Bancárias
                pool.query(`
                    SELECT id, bank_name, iban, holder_name, is_default 
                    FROM external_bank_accounts WHERE user_id = $1`, [userId])
            ]);

            const user = userRes.rows[0];

            // Gera conta Titanium on-the-fly se não existir
            if (!user.wallet_account_number) {
                // Busca telefone se necessário (query extra raramente executada)
                const phoneRes = await pool.query("SELECT phone FROM users WHERE id = $1", [userId]);
                const newAccount = Utils.generateAccountNumber(phoneRes.rows[0].phone);
                
                if (newAccount) {
                    await pool.query("UPDATE users SET wallet_account_number = $1 WHERE id = $2", [newAccount, userId]);
                    user.wallet_account_number = newAccount;
                }
            }

            const responsePayload = {
                account: {
                    balance: parseFloat(user.balance || 0).toFixed(2),
                    points: user.bonus_points || 0,
                    number: user.wallet_account_number || "Gerando...",
                    status: user.wallet_status,
                    currency: SYSTEM_CONFIG.CURRENCY,
                    kyc_level: user.kyc_level,
                    has_pin: user.has_pin
                },
                recent_activity: txRes.rows.map(tx => ({
                    ...tx,
                    is_inbound: tx.receiver_id === userId || (tx.type === 'deposit'),
                    formatted_amount: `${parseFloat(tx.amount).toFixed(2)} Kz`
                })),
                cards: cardsRes.rows,
                banks: banksRes.rows,
                meta: {
                    server_time: new Date().toISOString(),
                    latency_ms: Date.now() - startTime
                }
            };

            res.json(responsePayload);

        } catch (error) {
            FinanceLogger.error(userId, 'DASHBOARD_ERROR', error.message);
            res.status(500).json({ error: "Não foi possível carregar o dashboard financeiro." });
        }
    });

    /**
     * GET /api/wallet/transactions
     * Histórico completo com paginação e filtros.
     */
    router.get('/transactions', requireAuth, async (req, res) => {
        const userId = req.user.id;
        const { page = 1, limit = 20, type, start_date, end_date } = req.query;
        const offset = (page - 1) * limit;

        try {
            let query = `
                SELECT t.*, s.name as sender_name, r.name as receiver_name 
                FROM wallet_transactions t
                LEFT JOIN users s ON t.sender_id = s.id
                LEFT JOIN users r ON t.receiver_id = r.id
                WHERE t.user_id = $1
            `;
            const params = [userId];
            let paramCount = 1;

            if (type) {
                paramCount++;
                query += ` AND t.type = $${paramCount}`;
                params.push(type);
            }

            if (start_date) {
                paramCount++;
                query += ` AND t.created_at >= $${paramCount}`;
                params.push(start_date);
            }

            if (end_date) {
                paramCount++;
                query += ` AND t.created_at <= $${paramCount}`;
                params.push(end_date);
            }

            query += ` ORDER BY t.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            res.json({ data: result.rows, page: parseInt(page), limit: parseInt(limit) });

        } catch (error) {
            res.status(500).json({ error: "Erro ao buscar histórico." });
        }
    });

    // =============================================================================================
    // 4. ROTAS TRANSACIONAIS (CORE ACID LOGIC)
    // =============================================================================================

    /**
     * POST /api/wallet/transfer
     * Transferência P2P Interna entre usuários AOtravel.
     * Esta é a função mais crítica do sistema.
     */
    router.post('/transfer', requireAuth, requireActiveWallet, async (req, res) => {
        const { recipient_identifier, amount, pin, description } = req.body;
        const senderId = req.user.id;
        const txRef = Utils.generateRef('TRF');

        // 1. Validações de Entrada (Input Sanitation)
        if (!Utils.isValidAmount(amount)) {
            return res.status(400).json({ error: "Valor de transferência inválido." });
        }
        if (!recipient_identifier) {
            return res.status(400).json({ error: "Identificador do destinatário obrigatório." });
        }
        if (!pin) {
            return res.status(400).json({ error: "PIN de segurança obrigatório." });
        }

        const client = await pool.connect();

        try {
            FinanceLogger.info(senderId, 'INIT_TRANSFER', { amount, target: recipient_identifier, ref: txRef });

            // INÍCIO DA TRANSAÇÃO ATÔMICA
            await client.query('BEGIN');

            // 2. Bloquear Remetente (FOR UPDATE)
            // Isso previne Race Conditions onde o usuário tenta gastar o saldo 2x ao mesmo tempo
            const senderRes = await client.query(
                `SELECT id, name, balance, wallet_pin_hash, daily_limit_used, last_transaction_date, wallet_status
                 FROM users WHERE id = $1 FOR UPDATE`,
                [senderId]
            );
            const sender = senderRes.rows[0];

            // 3. Verificações de Regra de Negócio (Business Rules)
            
            // 3.1 PIN Check
            if (!sender.wallet_pin_hash) throw new Error("PIN não configurado. Configure em Segurança.");
            const pinMatch = await bcrypt.compare(pin, sender.wallet_pin_hash);
            if (!pinMatch) throw new Error("PIN de segurança incorreto.");

            // 3.2 Saldo Check
            if (parseFloat(sender.balance) < parseFloat(amount)) {
                throw new Error("Saldo insuficiente para esta operação.");
            }

            // 3.3 Limite Diário Check
            const today = new Date().toISOString().split('T')[0];
            const lastTxDate = new Date(sender.last_transaction_date).toISOString().split('T')[0];
            let currentUsage = parseFloat(sender.daily_limit_used);

            // Reseta uso se for um novo dia
            if (lastTxDate !== today) currentUsage = 0;

            if ((currentUsage + parseFloat(amount)) > SYSTEM_CONFIG.LIMITS.DAILY_MAX) {
                throw new Error(`Limite diário excedido. Disponível: ${SYSTEM_CONFIG.LIMITS.DAILY_MAX - currentUsage} Kz`);
            }

            // 4. Localizar Destinatário (Pode ser Email, Phone, IBAN Interno ou Conta Titanium)
            const receiverRes = await client.query(
                `SELECT id, name, fcm_token, wallet_status 
                 FROM users 
                 WHERE (email = $1 OR phone = $1 OR wallet_account_number = $1) 
                 AND id != $2`, // Garante que não transfere para si mesmo
                [recipient_identifier, senderId]
            );

            if (receiverRes.rows.length === 0) {
                throw new Error("Destinatário não encontrado na plataforma.");
            }

            const receiver = receiverRes.rows[0];
            
            if (receiver.wallet_status !== 'active') {
                throw new Error("A conta do destinatário não pode receber fundos no momento.");
            }

            // 5. Execução Financeira (Update Balances)
            
            // 5.1 Débito Sender + Atualização de Limites
            await client.query(
                `UPDATE users 
                 SET balance = balance - $1, 
                     daily_limit_used = $2, 
                     last_transaction_date = CURRENT_DATE 
                 WHERE id = $3`,
                [amount, (lastTxDate !== today ? amount : currentUsage + parseFloat(amount)), senderId]
            );

            // 5.2 Crédito Receiver (Lock implícito pelo UPDATE)
            await client.query(
                "UPDATE users SET balance = balance + $1 WHERE id = $2",
                [amount, receiver.id]
            );

            // 6. Registro Contábil (Double Entry Ledger)
            // É essencial registrar a visão de ambos os lados.

            // 6.1 Registro para Remetente (Saída)
            await client.query(
                `INSERT INTO wallet_transactions 
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, balance_after)
                 VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6, $7)`,
                [
                    txRef, 
                    senderId, 
                    senderId, 
                    receiver.id, 
                    -Math.abs(amount), // Negativo
                    description || `Transferência para ${receiver.name}`,
                    parseFloat(sender.balance) - parseFloat(amount) // Snapshot do saldo pós
                ]
            );

            // 6.2 Registro para Destinatário (Entrada)
            await client.query(
                `INSERT INTO wallet_transactions 
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description)
                 VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6)`,
                [
                    txRef, // Mesma ref para rastreamento cruzado
                    receiver.id, 
                    senderId, 
                    receiver.id, 
                    Math.abs(amount), // Positivo
                    `Recebido de ${sender.name}`,
                ]
            );

            // 7. Commit Final
            await client.query('COMMIT');

            // 8. Notificações Real-Time (Fora da Transação DB)
            if (io) {
                // Notifica Receiver
                io.to(`user_${receiver.id}`).emit('notification', {
                    type: 'MONEY_RECEIVED',
                    title: 'Transferência Recebida',
                    message: `Você recebeu ${amount} Kz de ${sender.name}`,
                    data: { amount, ref: txRef, sender: sender.name }
                });
                
                // Atualiza Dashboard do Receiver em tempo real
                io.to(`user_${receiver.id}`).emit('wallet_update', { 
                    increment: amount 
                });
            }

            FinanceLogger.info(senderId, 'SUCCESS_TRANSFER', { ref: txRef, amount });

            res.json({
                success: true,
                message: "Transferência realizada com sucesso!",
                data: {
                    reference: txRef,
                    amount: amount,
                    recipient: receiver.name,
                    date: new Date().toISOString()
                }
            });

        } catch (error) {
            // Em caso de erro, desfaz TUDO. Dinheiro nunca é perdido.
            await client.query('ROLLBACK');
            FinanceLogger.error(senderId, 'FAILED_TRANSFER', error.message);
            res.status(400).json({ 
                error: error.message || "Falha na transferência.",
                code: "TX_FAILED"
            });
        } finally {
            client.release();
        }
    });

    /**
     * POST /api/wallet/topup
     * Recarga de Carteira via Gateway Externo (Multicaixa / Visa).
     */
    router.post('/topup', requireAuth, requireActiveWallet, async (req, res) => {
        const { amount, method, payment_details } = req.body;
        const userId = req.user.id;
        const tempRef = Utils.generateRef('DEP');

        if (!Utils.isValidAmount(amount)) return res.status(400).json({ error: "Valor inválido." });
        if (amount < SYSTEM_CONFIG.LIMITS.MIN_DEPOSIT) return res.status(400).json({ error: `Depósito mínimo: ${SYSTEM_CONFIG.LIMITS.MIN_DEPOSIT} Kz` });

        try {
            // 1. Processamento Externo (API Gateway)
            // Aqui chamamos o Multicaixa ou Visa. Se falhar aqui, nem tocamos no DB.
            const gatewayResult = await gateway.processPayment(
                method === 'visa' ? 'VISA' : 'MCX', 
                amount, 
                { 
                    phone: payment_details?.phone || req.user.phone, // Fallback
                    cardToken: payment_details?.token
                }
            );

            // 2. Se Gateway aprovou, persistimos no DB
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Credita User
                await client.query(
                    "UPDATE users SET balance = balance + $1 WHERE id = $2",
                    [amount, userId]
                );

                // Registra Depósito
                await client.query(
                    `INSERT INTO wallet_transactions 
                     (reference_id, user_id, amount, type, method, status, description, metadata)
                     VALUES ($1, $2, $3, 'deposit', $4, 'completed', $5, $6)`,
                    [
                        gatewayResult.provider_ref, // Usa a ref do gateway para conciliação
                        userId,
                        amount,
                        method,
                        'Recarga via ' + method.toUpperCase(),
                        JSON.stringify(gatewayResult)
                    ]
                );

                await client.query('COMMIT');

                // Notifica UI
                io.to(`user_${userId}`).emit('wallet_update', { type: 'topup', amount });

                res.json({
                    success: true,
                    message: "Recarga efetuada com sucesso!",
                    new_balance: amount, // O front deve somar ou recarregar
                    reference: gatewayResult.provider_ref
                });

            } catch (dbError) {
                await client.query('ROLLBACK');
                // Crítico: Dinheiro saiu do gateway mas falhou no DB. 
                // Deveria haver log para processo de estorno manual/automático.
                FinanceLogger.error(userId, 'CRITICAL_TOPUP_FAIL', { gw_ref: gatewayResult.provider_ref, error: dbError.message });
                throw new Error("Erro interno ao creditar saldo. Contacte suporte com REF: " + gatewayResult.provider_ref);
            } finally {
                client.release();
            }

        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/wallet/withdraw
     * Solicitação de Saque para Conta Bancária (Processo Assíncrono).
     */
    router.post('/withdraw', requireAuth, requireActiveWallet, async (req, res) => {
        const { amount, bank_account_id, pin } = req.body;
        const userId = req.user.id;
        const txRef = Utils.generateRef('WTH');

        if (amount < SYSTEM_CONFIG.LIMITS.MIN_WITHDRAW) {
            return res.status(400).json({ error: `Levantamento mínimo: ${SYSTEM_CONFIG.LIMITS.MIN_WITHDRAW} Kz` });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Validar Usuário e Saldo
            const userRes = await client.query(
                "SELECT balance, wallet_pin_hash FROM users WHERE id = $1 FOR UPDATE", 
                [userId]
            );
            const user = userRes.rows[0];

            if (!(await bcrypt.compare(pin, user.wallet_pin_hash))) {
                throw new Error("PIN incorreto.");
            }

            const totalDeduction = parseFloat(amount) + (parseFloat(amount) * SYSTEM_CONFIG.FEES.WITHDRAWAL);

            if (parseFloat(user.balance) < totalDeduction) {
                throw new Error(`Saldo insuficiente (Valor + Taxas: ${totalDeduction.toFixed(2)} Kz).`);
            }

            // 2. Validar Conta Bancária
            const bankRes = await client.query(
                "SELECT * FROM external_bank_accounts WHERE id = $1 AND user_id = $2",
                [bank_account_id, userId]
            );
            if (bankRes.rows.length === 0) throw new Error("Conta bancária inválida.");
            const bankAccount = bankRes.rows[0];

            // 3. Debitar Saldo (Imediatamente)
            await client.query(
                "UPDATE users SET balance = balance - $1 WHERE id = $2",
                [totalDeduction, userId]
            );

            // 4. Registrar Transação (Status: PENDING)
            // O Admin ou Cron Job processará o pagamento real via STCO/SPI
            await client.query(
                `INSERT INTO wallet_transactions 
                 (reference_id, user_id, amount, fee, type, method, status, description, metadata)
                 VALUES ($1, $2, $3, $4, 'withdraw', 'bank_transfer', 'pending', $5, $6)`,
                [
                    txRef,
                    userId,
                    -Math.abs(amount), // Valor líquido para o user
                    totalDeduction - amount, // Valor da taxa
                    `Levantamento para ${bankAccount.bank_name}`,
                    JSON.stringify({ iban: bankAccount.iban, holder: bankAccount.holder_name })
                ]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: "Solicitação de levantamento enviada. Processamento em até 24h.",
                reference: txRef
            });

        } catch (error) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    /**
     * POST /api/wallet/pay-service
     * Pagamento de Serviços (ENDE, EPAL, DSTV, UNITEL).
     */
    router.post('/pay-service', requireAuth, requireActiveWallet, async (req, res) => {
        const { service_id, reference_number, amount, pin } = req.body;
        const userId = req.user.id;
        const txRef = Utils.generateRef('PAY');

        // Serviços permitidos
        const ALLOWED_SERVICES = ['ENDE', 'EPAL', 'DSTV', 'ZAP', 'UNITEL', 'MOVICEL'];
        if (!ALLOWED_SERVICES.includes(service_id)) return res.status(400).json({ error: "Serviço inválido." });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const userRes = await client.query("SELECT balance, wallet_pin_hash FROM users WHERE id = $1 FOR UPDATE", [userId]);
            const user = userRes.rows[0];

            if (!(await bcrypt.compare(pin, user.wallet_pin_hash))) throw new Error("PIN incorreto.");
            if (parseFloat(user.balance) < amount) throw new Error("Saldo insuficiente.");

            // Deduz Saldo
            await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [amount, userId]);

            // Registra Pagamento
            await client.query(
                `INSERT INTO wallet_transactions 
                 (reference_id, user_id, amount, type, method, status, description, metadata)
                 VALUES ($1, $2, $3, 'service_payment', 'internal', 'completed', $4, $5)`,
                [
                    txRef,
                    userId,
                    -Math.abs(amount),
                    `Pagamento ${service_id} - Ref: ${reference_number}`,
                    JSON.stringify({ service: service_id, service_ref: reference_number })
                ]
            );

            await client.query('COMMIT');
            
            // Simula recibo
            res.json({
                success: true,
                message: `Pagamento ${service_id} efetuado com sucesso.`,
                receipt_id: txRef
            });

        } catch (error) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    // =============================================================================================
    // 5. GESTÃO DE CARTÕES E CONTAS BANCÁRIAS
    // =============================================================================================

    /**
     * POST /api/wallet/cards/add
     * Adiciona um cartão (Simulação de Tokenização).
     */
    router.post('/cards/add', requireAuth, async (req, res) => {
        const { number, expiry, alias, type } = req.body;
        const userId = req.user.id;

        // Validação simples (Luhn simplificado ou length check)
        if (!number || number.length < 13) return res.status(400).json({ error: "Número de cartão inválido." });

        try {
            const countRes = await pool.query("SELECT COUNT(*) FROM wallet_cards WHERE user_id = $1", [userId]);
            if (parseInt(countRes.rows[0].count) >= SYSTEM_CONFIG.LIMITS.MAX_CARDS) {
                return res.status(400).json({ error: "Limite de cartões atingido." });
            }

            // TOKENIZAÇÃO (Segurança Crítica: Nunca salvar PAN completo)
            // Em produção, isso viria da API da Visa/CyberSource
            const token = crypto.createHash('sha256').update(`${userId}-${number}-${Date.now()}`).digest('hex');
            const lastFour = number.slice(-4);
            const isDefault = parseInt(countRes.rows[0].count) === 0;

            await pool.query(
                `INSERT INTO wallet_cards (user_id, card_alias, card_network, last_four, provider_token, expiry_date, is_default)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [userId, alias || 'Meu Cartão', type || 'VISA', lastFour, token, expiry, isDefault]
            );

            res.json({ success: true, message: "Cartão adicionado com segurança." });

        } catch (error) {
            res.status(500).json({ error: "Erro ao salvar cartão." });
        }
    });

    /**
     * DELETE /api/wallet/cards/:id
     */
    router.delete('/cards/:id', requireAuth, async (req, res) => {
        try {
            await pool.query("DELETE FROM wallet_cards WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
            res.json({ success: true, message: "Cartão removido." });
        } catch (error) {
            res.status(500).json({ error: "Erro ao remover cartão." });
        }
    });

    /**
     * POST /api/wallet/banks/add
     * Adiciona conta bancária para saques.
     */
    router.post('/banks/add', requireAuth, async (req, res) => {
        const { bank_name, iban, holder_name } = req.body;
        const userId = req.user.id;

        if (!Utils.isValidAOIBAN(iban)) {
            return res.status(400).json({ error: "IBAN inválido. Certifique-se que começa com AO06 e tem 25 caracteres." });
        }

        try {
            const countRes = await pool.query("SELECT COUNT(*) FROM external_bank_accounts WHERE user_id = $1", [userId]);
            if (parseInt(countRes.rows[0].count) >= SYSTEM_CONFIG.LIMITS.MAX_ACCOUNTS) {
                return res.status(400).json({ error: "Limite de contas bancárias atingido." });
            }

            await pool.query(
                `INSERT INTO external_bank_accounts (user_id, bank_name, iban, holder_name)
                 VALUES ($1, $2, $3, $4)`,
                [userId, bank_name, iban, holder_name]
            );

            res.json({ success: true, message: "Conta bancária vinculada." });

        } catch (error) {
            res.status(500).json({ error: "Erro ao vincular conta." });
        }
    });

    /**
     * DELETE /api/wallet/banks/:id
     */
    router.delete('/banks/:id', requireAuth, async (req, res) => {
        try {
            await pool.query("DELETE FROM external_bank_accounts WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
            res.json({ success: true, message: "Conta desvinculada." });
        } catch (error) {
            res.status(500).json({ error: "Erro ao remover conta." });
        }
    });

    // =============================================================================================
    // 6. GESTÃO DE SEGURANÇA (PIN)
    // =============================================================================================

    /**
     * POST /api/wallet/security/set-pin
     * Define ou Altera o PIN de 4 dígitos.
     */
    router.post('/security/set-pin', requireAuth, async (req, res) => {
        const { current_pin, new_pin } = req.body;
        const userId = req.user.id;

        if (!new_pin || new_pin.length !== SYSTEM_CONFIG.SECURITY.PIN_LENGTH || isNaN(new_pin)) {
            return res.status(400).json({ error: "O novo PIN deve conter exatamente 4 números." });
        }

        try {
            const result = await pool.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
            const storedHash = result.rows[0]?.wallet_pin_hash;

            // Se já existe PIN, obriga a verificação do antigo
            if (storedHash) {
                if (!current_pin) return res.status(400).json({ error: "PIN atual necessário para alteração." });
                const match = await bcrypt.compare(current_pin, storedHash);
                if (!match) return res.status(401).json({ error: "PIN atual incorreto." });
            }

            // Hash do novo PIN
            const newHash = await bcrypt.hash(new_pin, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);
            
            await pool.query("UPDATE users SET wallet_pin_hash = $1 WHERE id = $2", [newHash, userId]);

            // Log de segurança
            await pool.query(
                `INSERT INTO wallet_security_logs (user_id, event_type, details) VALUES ($1, 'PIN_CHANGE', $2)`,
                [userId, JSON.stringify({ ip: req.ip })]
            );

            res.json({ success: true, message: "PIN de segurança configurado com sucesso." });

        } catch (error) {
            res.status(500).json({ error: "Erro ao configurar PIN." });
        }
    });

    /**
     * POST /api/wallet/security/verify
     * Rota utilitária para o Frontend validar PIN antes de abrir telas sensíveis
     */
    router.post('/security/verify', requireAuth, async (req, res) => {
        const { pin } = req.body;
        try {
            await verifyPinInternal(req.user.id, pin);
            res.json({ valid: true });
        } catch (error) {
            res.json({ valid: false, error: error.message });
        }
    });

    /**
     * POST /api/wallet/security/freeze
     * Permite ao usuário congelar sua própria conta em caso de suspeita de fraude.
     */
    router.post('/security/freeze', requireAuth, async (req, res) => {
        try {
            await pool.query("UPDATE users SET wallet_status = 'frozen' WHERE id = $1", [req.user.id]);
            res.json({ success: true, message: "Carteira congelada com sucesso. Nenhuma transação de saída será permitida." });
        } catch (error) {
            res.status(500).json({ error: "Erro ao congelar carteira." });
        }
    });

    return router;
};

// =================================================================================================
// FIM DO ARQUIVO - AOTRAVEL WALLET ENGINE
// =================================================================================================
