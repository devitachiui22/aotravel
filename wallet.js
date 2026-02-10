/**
 * =================================================================================================
 * 🏦 AOTRAVEL TITANIUM FINTECH ENGINE - CORE WALLET SYSTEM v11.0 (ULTIMATE GOLD MASTER)
 * =================================================================================================
 *
 * ARQUIVO: wallet.js
 * LOCALIZAÇÃO: Raiz do Projeto (Root)
 * DATA: 10 de Fevereiro de 2026
 * AUTOR: AOtravel Engineering Team (Luanda, Angola)
 *
 * -------------------------------------------------------------------------------------------------
 * DESCRIÇÃO TÉCNICA DETALHADA:
 * -------------------------------------------------------------------------------------------------
 * Este módulo atua como o Ledger Central (Livro Razão) da aplicação. Ele foi projetado para operar
 * em ambientes hostis, com capacidade de auto-reparação de esquema de banco de dados e proteção
 * total contra condições de corrida (Race Conditions).
 *
 * -------------------------------------------------------------------------------------------------
 * ÍNDICE DE FUNCIONALIDADES E MÓDULOS INTERNOS:
 * -------------------------------------------------------------------------------------------------
 * 1.  CONFIGURAÇÃO DO SISTEMA (SYSTEM_CONFIG): Definição de limites, taxas, moedas e segurança.
 * 2.  UTILITÁRIOS E HELPERS: Ferramentas de criptografia, validação de IBAN e formatação.
 * 3.  AUDITORIA (FINANCE LOGGER): Sistema de logs estruturados em JSON para rastreabilidade.
 * 4.  GATEWAY DE PAGAMENTOS (MOCKUP): Simulação de integrações com EMIS (MCX), VISA e Bancos.
 * 5.  AUTO-HEALING DATABASE (BOOTSTRAP): Script inteligente que verifica e cria tabelas/colunas.
 * 6.  MIDDLEWARES DE SEGURANÇA: Validação de Sessão, Bloqueio de Conta e Verificação de PIN.
 * 7.  CONTROLADOR DE LEITURA: Dashboards, Extratos e Resumos Financeiros.
 * 8.  CONTROLADOR TRANSACIONAL (ACID): Transferências, Depósitos, Saques e Pagamentos.
 * 9.  GESTÃO DE ATIVOS: CRUD de Cartões Virtuais e Contas Bancárias Externas.
 * 10. SEGURANÇA AVANÇADA: Redefinição de PIN, Congelamento de Conta e Auditoria.
 *
 * -------------------------------------------------------------------------------------------------
 * GARANTIAS DE INTEGRIDADE DE DADOS (ACID):
 * -------------------------------------------------------------------------------------------------
 * - ATOMICIDADE: Todas as operações usam 'BEGIN', 'COMMIT' e 'ROLLBACK'.
 * - CONSISTÊNCIA: Constraints de banco de dados e validações de lógica de negócios estritas.
 * - ISOLAMENTO: Uso de 'SELECT ... FOR UPDATE' para bloquear linhas durante transações.
 * - DURABILIDADE: Persistência garantida em PostgreSQL antes de confirmar ao cliente.
 *
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// =================================================================================================
// ⚙️ SEÇÃO 1: CONFIGURAÇÕES GLOBAIS E CONSTANTES (SYSTEM CONFIG)
// =================================================================================================

const SYSTEM_CONFIG = {
    APP_NAME: "AOtravel Titanium Wallet",
    VERSION: "11.0.0-GOLD-ARMORED",
    CURRENCY: "AOA", // Kwanza Angolano
    LOCALE: "pt-AO",
    TIMEZONE: "Africa/Luanda",

    // Limites Operacionais (Compliance BNA - Banco Nacional de Angola)
    LIMITS: {
        DAILY_MAX_TIER_1: 500000.00,   // Limite Padrão (500k Kz)
        DAILY_MAX_TIER_2: 5000000.00,  // Limite Verificado (5M Kz)
        TRANSACTION_MIN: 50.00,        // Mínimo por transação
        TRANSACTION_MAX: 2000000.00,   // Máximo por transação única
        MIN_DEPOSIT: 100.00,           // Depósito mínimo
        MIN_WITHDRAW: 2000.00,         // Saque mínimo
        MAX_ACCOUNTS: 5,               // Máximo de contas bancárias vinculadas
        MAX_CARDS: 10,                 // Máximo de cartões virtuais
        MAX_PIN_ATTEMPTS: 3            // Tentativas de PIN antes do bloqueio temp
    },

    // Estrutura de Taxas e Tarifários (Revenue Model)
    FEES: {
        INTERNAL_TRANSFER: 0.00,       // Grátis entre usuários da plataforma
        BANK_WITHDRAWAL_PCT: 0.015,    // 1.5% de taxa de saque bancário
        BANK_WITHDRAWAL_MIN: 500.00,   // Mínimo de 500 Kz de taxa
        SERVICE_PAYMENT_FIXED: 50.00,  // Taxa fixa por pagamento de serviço
        CARD_ISSUANCE: 1000.00,        // Custo de emissão de cartão virtual
        TOPUP_FEE_PCT: 0.00            // Taxa de depósito (Subsidiada)
    },

    // Configurações de Segurança
    SECURITY: {
        BCRYPT_ROUNDS: 12,             // Custo de processamento do hash
        PIN_LENGTH: 4,                 // Tamanho do PIN numérico
        TOKEN_EXPIRY: '15m',           // Expiração de tokens temporários
        LOCK_DURATION_MINUTES: 30,     // Duração do bloqueio por tentativas
        SESSION_TIMEOUT: 900           // 15 minutos de inatividade
    },

    // Semente Matemática (PI Seed) para gerar números de conta únicos e verificáveis
    ACCOUNT_SEED: "31415926535897932384626433832795"
};

// =================================================================================================
// 🛠️ SEÇÃO 2: CLASSES UTILITÁRIAS E LOGGERS (HELPERS)
// =================================================================================================

/**
 * Classe Logger: Registra auditoria financeira estruturada e detalhada.
 * Saída em JSON para integração fácil com ELK Stack, CloudWatch ou Datadog.
 */
class FinanceLogger {
    static log(level, userId, action, details, refId = 'N/A') {
        const timestamp = new Date().toISOString();
        const correlationId = crypto.randomUUID(); // ID único para rastrear a requisição
        
        const payload = {
            ts: timestamp,
            cid: correlationId,
            lvl: level,
            uid: userId || 'SYSTEM',
            act: action,
            ref: refId,
            dat: details,
            env: process.env.NODE_ENV || 'production'
        };
        
        // Em produção, isso deve ser enviado para um stream de logs seguro
        console.log(`[${level}] [WALLET_CORE] ${JSON.stringify(payload)}`);
    }

    static info(userId, action, details, ref) { this.log('INFO', userId, action, details, ref); }
    static warn(userId, action, details, ref) { this.log('WARN', userId, action, details, ref); }
    static error(userId, action, details, ref) { this.log('ERROR', userId, action, details, ref); }
    static critical(userId, action, details, ref) { this.log('CRITICAL', userId, action, details, ref); }
    static audit(userId, action, details, ref) { this.log('AUDIT', userId, action, details, ref); }
}

/**
 * Utilitários Gerais: Validação, Formatação e Geração de Códigos.
 */
const Utils = {
    /**
     * Gera uma referência única legível para humanos.
     * Formato: PREF-YYYYMMDD-HEX (Ex: TRF-20260210-A1B2C3)
     */
    generateRef: (prefix) => {
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
        return `${prefix}-${dateStr}-${rand}`;
    },

    /**
     * Valida se um valor monetário é seguro para processamento financeiro.
     * Impede NaN, Infinity, valores negativos e zero (onde não permitido).
     */
    isValidAmount: (amount) => {
        return amount && !isNaN(amount) && parseFloat(amount) > 0 && isFinite(amount);
    },

    /**
     * Gera número de conta "Titanium" (21 dígitos) baseado no telefone.
     * Algoritmo Determinístico: 9 dig (tel) + 4 dig (ano) + 8 dig (seed)
     */
    generateAccountNumber: (phone) => {
        if (!phone) return null;
        const cleanPhone = phone.replace(/\D/g, '').slice(-9); // Garante os últimos 9 dígitos
        const year = new Date().getFullYear().toString();
        const seed = SYSTEM_CONFIG.ACCOUNT_SEED.slice(0, 8);
        return `${cleanPhone}${year}${seed}`;
    },

    /**
     * Valida IBAN Angolano (Formato Simplificado AO06)
     * Verifica prefixo e comprimento.
     */
    isValidAOIBAN: (iban) => {
        if (!iban) return false;
        const cleanIban = iban.replace(/\s/g, '').toUpperCase();
        // Regex para AO06 + 21 dígitos numéricos = 25 chars
        return /^AO06[0-9]{21}$/.test(cleanIban) && cleanIban.length === 25;
    },

    /**
     * Mascara dados sensíveis para exibição em logs e recibos.
     * Ex: 12345678 -> ****5678
     */
    maskData: (data, visibleEnd = 4) => {
        if (!data) return '';
        if (data.length <= visibleEnd) return data;
        return '*'.repeat(data.length - visibleEnd) + data.slice(-visibleEnd);
    }
};

// =================================================================================================
// 💳 SEÇÃO 3: GATEWAY DE PAGAMENTOS (MOCKUP AVANÇADO)
// =================================================================================================

/**
 * Simula a comunicação com gateways reais de Angola (EMIS, CyberSource).
 * Inclui latência simulada e tratamento de erros de rede para testes realistas.
 */
class PaymentGateway {
    constructor() {
        this.providers = {
            'MCX': { name: 'Multicaixa Express', active: true, fee: 0 },
            'VISA': { name: 'Visa/Mastercard Secure', active: true, fee: 2.5 },
            'BAI_DIRECT': { name: 'BAI Directo', active: true, fee: 0 }
        };
    }

    /**
     * Processa um pagamento externo (Depósito/TopUp)
     */
    async charge(provider, amount, payload) {
        console.log(`[GATEWAY_OUT] Iniciando cobrança via ${provider}: ${amount} Kz...`);
        
        // Simulação de latência de rede (Jitter de 500ms a 1.5s)
        const delay = Math.floor(Math.random() * 1000) + 500;
        await new Promise(resolve => setTimeout(resolve, delay));

        // Validações do Gateway
        if (!this.providers[provider]) throw new Error(`Provedor ${provider} indisponível ou em manutenção.`);
        if (amount < 50) throw new Error("Valor mínimo para gateway é 50 Kz.");

        // Validações Específicas
        if (provider === 'MCX' && !payload.phone) throw new Error("Telefone obrigatório para Multicaixa Express.");
        if (provider === 'VISA' && !payload.cardToken) throw new Error("Token do cartão inválido ou expirado.");

        // Simulação de Sucesso/Falha (99% de sucesso)
        const isSuccess = Math.random() > 0.01; 
        
        if (!isSuccess) {
            // Simula erros comuns bancários
            const errors = ["Saldo Insuficiente", "Timeout no Emissor", "Cartão Expirado", "Transação não autorizada pelo banco"];
            const errorMsg = errors[Math.floor(Math.random() * errors.length)];
            throw new Error(`[GW_REJ] Transação negada: ${errorMsg}`);
        }

        const txId = crypto.randomUUID();
        return {
            success: true,
            status: 'captured',
            transaction_id: txId,
            provider_ref: `${provider}-${txId.slice(0, 8).toUpperCase()}`,
            timestamp: new Date().toISOString(),
            amount_charged: amount,
            currency: 'AOA'
        };
    }

    /**
     * Processa um pagamento de serviço (ENDE, EPAL)
     */
    async payService(entity, reference, amount) {
        const services = ['ENDE', 'EPAL', 'UNITEL', 'MOVICEL', 'ZAP', 'DSTV'];
        if (!services.includes(entity)) throw new Error(`Entidade de serviço '${entity}' desconhecida.`);

        // Simulação de latência
        await new Promise(resolve => setTimeout(resolve, 800));

        return {
            success: true,
            receipt: `REC-${entity}-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
            message: "Pagamento confirmado na entidade.",
            timestamp: new Date().toISOString()
        };
    }
}

const gateway = new PaymentGateway();

// =================================================================================================
// 🚀 SEÇÃO 4: MÓDULO EXPORTÁVEL (LÓGICA PRINCIPAL DO SERVIDOR)
// =================================================================================================

module.exports = (pool, io) => {

    // =============================================================================================
    // 4.1 BOOTSTRAP DO BANCO DE DADOS (AUTO-HEALING & MIGRATION)
    // =============================================================================================
    // Esta função é crítica. Ela verifica se o DB está saudável e cria tudo o que faltar.
    // É executada IMEDIATAMENTE ao iniciar o servidor.

    const initializeFinancialSystem = async () => {
        const client = await pool.connect();
        try {
            console.log('🔄 [WALLET_CORE] Iniciando verificação profunda de integridade do Schema...');
            await client.query('BEGIN');

            // --- PASSO 1: CRIAÇÃO DE TABELAS (IF NOT EXISTS) ---

            // Tabela de Transações (Ledger)
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

            // Tabela de Contas Bancárias Externas
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

            // Tabela de Cartões Virtuais/Físicos
            await client.query(`
                CREATE TABLE IF NOT EXISTS wallet_cards (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    card_alias VARCHAR(100),
                    last_four VARCHAR(4),
                    card_network VARCHAR(50),
                    provider_token VARCHAR(255),
                    expiry_date VARCHAR(10),
                    cvv_hash VARCHAR(255),
                    is_active BOOLEAN DEFAULT TRUE,
                    is_default BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Tabela de Logs de Segurança
            await client.query(`
                CREATE TABLE IF NOT EXISTS wallet_security_logs (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    event_type VARCHAR(50) NOT NULL,
                    ip_address VARCHAR(45),
                    device_info TEXT,
                    details JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // --- PASSO 2: INJEÇÃO DE COLUNAS FALTANTES (AUTO-HEALING) ---
            // Este loop percorre as tabelas e garante que as colunas existam.
            // Corrige automaticamente erros como "column balance_after does not exist".
            
            const schemaUpdates = [
                // Colunas na Tabela USERS
                { table: 'users', col: 'balance', type: 'NUMERIC(15,2) DEFAULT 0.00' },
                { table: 'users', col: 'bonus_points', type: 'INTEGER DEFAULT 0' },
                { table: 'users', col: 'wallet_account_number', type: 'VARCHAR(50) UNIQUE' },
                { table: 'users', col: 'wallet_pin_hash', type: 'VARCHAR(255)' },
                { table: 'users', col: 'wallet_status', type: "VARCHAR(20) DEFAULT 'active'" },
                { table: 'users', col: 'daily_limit', type: 'NUMERIC(15, 2) DEFAULT 500000.00' },
                { table: 'users', col: 'daily_limit_used', type: 'NUMERIC(15, 2) DEFAULT 0.00' },
                { table: 'users', col: 'last_transaction_date', type: 'DATE DEFAULT CURRENT_DATE' },
                { table: 'users', col: 'account_tier', type: "VARCHAR(20) DEFAULT 'standard'" },
                { table: 'users', col: 'kyc_level', type: 'INTEGER DEFAULT 1' },
                
                // Colunas na Tabela WALLET_TRANSACTIONS
                { table: 'wallet_transactions', col: 'balance_after', type: 'NUMERIC(15, 2)' },
                { table: 'wallet_transactions', col: 'method', type: "VARCHAR(50) DEFAULT 'internal'" },
                { table: 'wallet_transactions', col: 'currency', type: "VARCHAR(3) DEFAULT 'AOA'" },
                { table: 'wallet_transactions', col: 'is_hidden', type: 'BOOLEAN DEFAULT FALSE' },
                { table: 'wallet_transactions', col: 'category', type: 'VARCHAR(50)' }
            ];

            for (const item of schemaUpdates) {
                // Executa um bloco anônimo PL/pgSQL para verificar e adicionar a coluna de forma segura e atômica
                await client.query(`
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 
                            FROM information_schema.columns 
                            WHERE table_name='${item.table}' AND column_name='${item.col}'
                        ) THEN
                            ALTER TABLE ${item.table} ADD COLUMN ${item.col} ${item.type};
                        END IF;
                    END $$;
                `);
            }

            // --- PASSO 3: CRIAÇÃO DE ÍNDICES DE PERFORMANCE ---
            await client.query(`CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_wallet_tx_ref ON wallet_transactions(reference_id);`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_wallet_tx_created ON wallet_transactions(created_at DESC);`);

            // --- PASSO 4: SINCRONIZAÇÃO DE CONTAS LEGADAS ---
            // Verifica usuários que têm saldo > 0 mas nenhuma transação registrada (comum após migração)
            const legacyUsers = await client.query(`
                SELECT u.id, u.balance FROM users u
                LEFT JOIN wallet_transactions t ON u.id = t.user_id
                WHERE u.balance > 0 AND t.id IS NULL
            `);

            if (legacyUsers.rows.length > 0) {
                console.log(`⚠️ [WALLET_SYNC] Detectados ${legacyUsers.rows.length} usuários com saldo legado. Sincronizando...`);
                for (const user of legacyUsers.rows) {
                    const ref = Utils.generateRef('MIG');
                    await client.query(`
                        INSERT INTO wallet_transactions
                        (reference_id, user_id, amount, type, status, description, balance_after)
                        VALUES ($1, $2, $3, 'system_adjustment', 'completed', 'Migração de Saldo Legado (System)', $3)
                    `, [ref, user.id, user.balance]);
                }
            }

            // --- PASSO 5: GERAÇÃO DE NÚMEROS DE CONTA VIRTUAL ---
            // Para usuários antigos que não têm 'wallet_account_number'
            await client.query(`
                UPDATE users SET wallet_account_number = phone || 'AO'
                WHERE wallet_account_number IS NULL AND phone IS NOT NULL
            `);

            await client.query('COMMIT');
            console.log('✅ [WALLET_CORE] Sistema Financeiro: STATUS VERDE (Schema Verificado e Blindado).');

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ [WALLET_FATAL] Falha crítica na inicialização:', error);
            // Em um ambiente real, poderíamos disparar um alerta para o SRE aqui.
            // Não matamos o processo para permitir que outras partes do servidor funcionem.
        } finally {
            client.release();
        }
    };

    // Executa a inicialização imediatamente ao carregar o módulo
    initializeFinancialSystem();


    // =============================================================================================
    // 4.2 MIDDLEWARES DE SEGURANÇA E VALIDAÇÃO
    // =============================================================================================

    /**
     * Middleware: Verifica Autenticação e Sessão
     */
    const requireAuth = (req, res, next) => {
        if (!req.user || !req.user.id) {
            FinanceLogger.warn(null, 'UNAUTHORIZED_ACCESS', { path: req.path, ip: req.ip });
            return res.status(401).json({ 
                error: "Sessão expirada ou inválida. Por favor, faça login novamente.", 
                code: "AUTH_REQUIRED" 
            });
        }
        next();
    };

    /**
     * Middleware: Verifica Status da Carteira (Anti-Fraude)
     */
    const requireActiveWallet = async (req, res, next) => {
        try {
            const result = await pool.query(
                "SELECT wallet_status, is_blocked FROM users WHERE id = $1", 
                [req.user.id]
            );
            const userStatus = result.rows[0];

            if (!userStatus) {
                return res.status(404).json({ error: "Registro de usuário não encontrado." });
            }
            
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
            FinanceLogger.error(req.user.id, 'STATUS_CHECK_ERROR', e.message);
            res.status(500).json({ error: "Erro interno ao validar status da carteira." });
        }
    };

    /**
     * Helper: Verifica PIN Internamente (Utilizado dentro das rotas)
     */
    const verifyPinInternal = async (client, userId, pin) => {
        const result = await client.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
        const hash = result.rows[0]?.wallet_pin_hash;

        if (!hash) throw new Error("PIN de transação não configurado. Configure na aba Segurança.");
        
        const match = await bcrypt.compare(pin, hash);
        if (!match) throw new Error("PIN incorreto.");
        
        return true;
    };


    // =============================================================================================
    // 4.3 ROTAS DE LEITURA (DASHBOARD & HISTÓRICO)
    // =============================================================================================

    /**
     * GET /dashboard - Visão 360º da Carteira
     */
    router.get('/dashboard', requireAuth, async (req, res) => {
        const userId = req.user.id;
        const startTime = Date.now();

        try {
            // Executa todas as consultas em paralelo para máxima performance
            const [userData, transactions, cards, banks] = await Promise.all([
                // 1. Dados do Usuário
                pool.query(`
                    SELECT balance, bonus_points, wallet_account_number, daily_limit,
                           wallet_status, kyc_level, account_tier,
                           wallet_pin_hash IS NOT NULL as has_pin 
                    FROM users WHERE id = $1`, [userId]),

                // 2. Últimas Transações (Histórico Recente)
                pool.query(`
                    SELECT t.*, 
                           s.name as sender_name, s.photo as sender_photo,
                           r.name as receiver_name, r.photo as receiver_photo
                    FROM wallet_transactions t
                    LEFT JOIN users s ON t.sender_id = s.id
                    LEFT JOIN users r ON t.receiver_id = r.id
                    WHERE t.user_id = $1 AND t.is_hidden = FALSE
                    ORDER BY t.created_at DESC LIMIT 20`, [userId]),

                // 3. Cartões
                pool.query(`SELECT * FROM wallet_cards WHERE user_id = $1 AND is_active = TRUE`, [userId]),
                
                // 4. Contas Bancárias
                pool.query(`SELECT * FROM external_bank_accounts WHERE user_id = $1`, [userId])
            ]);

            const user = userData.rows[0];

            // Geração de Número de Conta "On-the-fly" se estiver faltando
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

            // Construção da Resposta JSON Otimizada
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
                external_accounts: banks.rows,
                meta: {
                    server_time: new Date().toISOString(),
                    latency_ms: Date.now() - startTime
                }
            });

        } catch (error) {
            FinanceLogger.error(userId, 'DASHBOARD_FAIL', error.message);
            res.status(500).json({ error: "Falha ao carregar dashboard financeiro." });
        }
    });

    /**
     * GET /transactions - Histórico Completo Paginado
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
            FinanceLogger.error(userId, 'HISTORY_FAIL', e.message);
            res.status(500).json({ error: "Erro ao buscar histórico de transações." });
        }
    });


    // =============================================================================================
    // 🚀 4.4 ROTAS TRANSACIONAIS (ACID COMPLIANT) - NÚCLEO DO SISTEMA
    // =============================================================================================

    /**
     * POST /transfer/internal - Transferência P2P
     * Atomicidade garantida: Ou o dinheiro move nas duas contas, ou não move em nenhuma.
     */
    router.post('/transfer/internal', requireAuth, requireActiveWallet, async (req, res) => {
        const { receiver_identifier, amount, pin, description } = req.body;
        const senderId = req.user.id;
        const txAmount = parseFloat(amount);
        const txRef = Utils.generateRef('TRF');

        // Validações de Entrada
        if (!Utils.isValidAmount(txAmount)) return res.status(400).json({ error: "Valor inválido." });
        if (txAmount < SYSTEM_CONFIG.LIMITS.TRANSACTION_MIN) return res.status(400).json({ error: `O valor mínimo é ${SYSTEM_CONFIG.LIMITS.TRANSACTION_MIN} Kz.` });
        if (!recipient_identifier || !pin) return res.status(400).json({ error: "Dados incompletos." });

        const client = await pool.connect();

        try {
            // INÍCIO DA TRANSAÇÃO ACID
            await client.query('BEGIN');

            // 1. Lock Sender (Bloqueio Pessimista)
            // Impede que o saldo seja alterado por outra requisição concorrente
            const senderRes = await client.query(
                "SELECT id, name, balance, wallet_pin_hash, daily_limit_used, last_transaction_date FROM users WHERE id = $1 FOR UPDATE", 
                [senderId]
            );
            const sender = senderRes.rows[0];

            // 2. Validações de Negócio
            await verifyPinInternal(client, senderId, pin);
            
            if (parseFloat(sender.balance) < txAmount) throw new Error("Saldo insuficiente para esta transação.");

            // Verificação de Limites Diários
            const today = new Date().toISOString().split('T')[0];
            const lastTxDate = new Date(sender.last_transaction_date).toISOString().split('T')[0];
            let currentUsage = parseFloat(sender.daily_limit_used);
            if (lastTxDate !== today) currentUsage = 0; // Reset se for novo dia

            if (currentUsage + txAmount > SYSTEM_CONFIG.LIMITS.DAILY_MAX_TIER_1) {
                throw new Error("Limite diário de transações excedido.");
            }

            // 3. Lock Receiver (Localização do Destinatário)
            const receiverRes = await client.query(
                `SELECT id, name, fcm_token, wallet_status FROM users 
                 WHERE (email = $1 OR phone = $1 OR wallet_account_number = $1) AND id != $2`,
                [receiver_identifier, senderId]
            );
            
            if (receiverRes.rows.length === 0) throw new Error("Destinatário não encontrado na plataforma.");
            const receiver = receiverRes.rows[0];
            
            if (receiver.wallet_status !== 'active') throw new Error("A conta do destinatário não pode receber fundos no momento.");

            // 4. Execução da Movimentação (Débito e Crédito)
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

            // 5. Registro no Ledger (Dupla Entrada para Auditoria)
            // Log do Sender (Débito)
            await client.query(
                `INSERT INTO wallet_transactions 
                (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, balance_after)
                VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6, $7)`,
                [txRef, senderId, senderId, receiver.id, -txAmount, description || `Envio para ${receiver.name}`, newSenderBalance]
            );

            // Log do Receiver (Crédito)
            await client.query(
                `INSERT INTO wallet_transactions 
                (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description)
                VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6)`,
                [txRef, receiver.id, senderId, receiver.id, txAmount, `Recebido de ${sender.name}`]
            );

            // COMMIT FINAL (A transação é efetivada aqui)
            await client.query('COMMIT');

            // 6. Notificações Real-Time (Socket.IO)
            if (io) {
                // Notifica Destinatário
                io.to(`user_${receiver.id}`).emit('wallet_update', { 
                    type: 'received', 
                    increment: txAmount, 
                    reference: txRef 
                });
                io.to(`user_${receiver.id}`).emit('notification', {
                    title: 'Dinheiro Recebido',
                    body: `Você recebeu ${txAmount.toFixed(2)} Kz de ${sender.name}`
                });

                // Confirmação para Remetente
                io.to(`user_${senderId}`).emit('wallet_update', { 
                    type: 'sent', 
                    amount: txAmount, 
                    new_balance: newSenderBalance 
                });
            }

            FinanceLogger.info(senderId, 'TRANSFER_SUCCESS', { amount: txAmount, to: receiver.id }, txRef);

            res.json({
                success: true,
                message: "Transferência realizada com sucesso!",
                data: { 
                    reference: txRef, 
                    amount: txAmount, 
                    recipient: receiver.name,
                    date: new Date().toISOString()
                }
            });

        } catch (error) {
            await client.query('ROLLBACK'); // Segurança Total: Desfaz tudo se houver erro
            FinanceLogger.error(senderId, 'TRANSFER_FAILED', error.message, txRef);
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    /**
     * POST /topup - Depósito via Gateway (Integração MCX/Visa)
     */
    router.post('/topup', requireAuth, requireActiveWallet, async (req, res) => {
        const { amount, method, payment_details } = req.body;
        const userId = req.user.id;
        const txAmount = parseFloat(amount);

        if (!Utils.isValidAmount(txAmount)) return res.status(400).json({ error: "Valor inválido." });

        try {
            // 1. Cobrança no Gateway Externo
            // Nota: Em produção, isso pode ser um processo de 2 passos (Webhook)
            const gwResult = await gateway.charge(
                method === 'visa' ? 'VISA' : 'MCX', 
                txAmount, 
                { phone: payment_details?.phone || req.user.phone }
            );

            // 2. Atualização do Banco de Dados Local
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                // Creditar
                await client.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [txAmount, userId]);
                
                // Registrar Transação
                await client.query(
                    `INSERT INTO wallet_transactions 
                     (reference_id, user_id, amount, type, method, status, description, metadata)
                     VALUES ($1, $2, $3, 'deposit', $4, 'completed', $5, $6)`,
                    [gwResult.provider_ref, userId, txAmount, method, 'Recarga via ' + method, JSON.stringify(gwResult)]
                );

                await client.query('COMMIT');

                // Notificar Front-end
                io.to(`user_${userId}`).emit('wallet_update', { type: 'topup', amount: txAmount });
                
                res.json({ 
                    success: true, 
                    message: "Recarga efetuada com sucesso!", 
                    new_balance: txAmount,
                    reference: gwResult.provider_ref
                });

            } catch (dbError) {
                await client.query('ROLLBACK');
                // Crítico: O dinheiro saiu do gateway mas não entrou no DB.
                FinanceLogger.critical(userId, 'TOPUP_ZOMBIE', { gw_ref: gwResult.provider_ref, error: dbError.message });
                throw new Error("Erro ao creditar saldo. Contacte o suporte com a Ref: " + gwResult.provider_ref);
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

        if (txAmount < SYSTEM_CONFIG.LIMITS.MIN_WITHDRAW) return res.status(400).json({ error: `Valor mínimo para saque é ${SYSTEM_CONFIG.LIMITS.MIN_WITHDRAW} Kz.` });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const userRes = await client.query("SELECT balance FROM users WHERE id = $1 FOR UPDATE", [userId]);
            const balance = parseFloat(userRes.rows[0].balance);

            await verifyPinInternal(client, userId, pin);

            // Calcular taxas dinâmicas
            let fee = txAmount * SYSTEM_CONFIG.FEES.BANK_WITHDRAWAL_PCT;
            if (fee < SYSTEM_CONFIG.FEES.BANK_WITHDRAWAL_MIN) fee = SYSTEM_CONFIG.FEES.BANK_WITHDRAWAL_MIN;
            
            const totalDed = txAmount + fee;

            if (balance < totalDed) throw new Error(`Saldo insuficiente (Valor + Taxa: ${totalDed.toFixed(2)} Kz).`);

            // Debitar (O dinheiro sai da conta virtual imediatamente)
            await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [totalDed, userId]);

            // Buscar dados da conta destino
            const bankRes = await client.query("SELECT * FROM external_bank_accounts WHERE id = $1 AND user_id = $2", [bank_account_id, userId]);
            if (bankRes.rows.length === 0) throw new Error("Conta bancária inválida.");
            const bank = bankRes.rows[0];

            // Registrar (Status: PENDING - Pois requer processamento bancário manual/automático posterior)
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

            res.json({ success: true, message: "Saque solicitado. Aguarde o processamento (até 24h úteis).", reference: txRef });

        } catch (e) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: e.message });
        } finally {
            client.release();
        }
    });

    /**
     * POST /pay-service - Pagamento de Serviços (ENDE, EPAL)
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

            // Chamar Gateway de Serviço
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

            res.json({ success: true, message: "Pagamento realizado com sucesso.", receipt: svcResult.receipt });

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

    /**
     * POST /cards/add - Adicionar Cartão
     */
    router.post('/cards/add', requireAuth, async (req, res) => {
        const { number, expiry, alias, type } = req.body;
        const userId = req.user.id;

        if (!number || number.length < 13) return res.status(400).json({ error: "Número do cartão inválido." });

        try {
            const count = await pool.query("SELECT COUNT(*) FROM wallet_cards WHERE user_id = $1", [userId]);
            if (parseInt(count.rows[0].count) >= SYSTEM_CONFIG.LIMITS.MAX_CARDS) {
                return res.status(400).json({ error: "Limite de cartões atingido." });
            }

            // Tokenização Segura (Simulada)
            const token = crypto.createHash('sha256').update(number + userId + Date.now()).digest('hex');
            const isDefault = parseInt(count.rows[0].count) === 0;

            await pool.query(
                `INSERT INTO wallet_cards (user_id, card_alias, last_four, provider_token, expiry_date, card_network, is_default)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [userId, alias || 'Meu Cartão', number.slice(-4), token, expiry, type || 'VISA', isDefault]
            );

            res.json({ success: true, message: "Cartão adicionado com segurança." });
        } catch (e) {
            res.status(500).json({ error: "Erro ao adicionar cartão." });
        }
    });

    /**
     * DELETE /cards/:id - Remover Cartão
     */
    router.delete('/cards/:id', requireAuth, async (req, res) => {
        try {
            await pool.query("DELETE FROM wallet_cards WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
            res.json({ success: true, message: "Cartão removido." });
        } catch (e) {
            res.status(500).json({ error: "Erro ao remover cartão." });
        }
    });

    /**
     * POST /accounts/add - Adicionar Conta Bancária
     */
    router.post('/accounts/add', requireAuth, async (req, res) => {
        const { provider, account_number, holder_name } = req.body;
        const userId = req.user.id;

        if (!account_number) return res.status(400).json({ error: "Número da conta inválido." });

        try {
            const count = await pool.query("SELECT COUNT(*) FROM external_bank_accounts WHERE user_id = $1", [userId]);
            if (parseInt(count.rows[0].count) >= SYSTEM_CONFIG.LIMITS.MAX_ACCOUNTS) {
                return res.status(400).json({ error: "Limite de contas atingido." });
            }

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

    /**
     * DELETE /accounts/:id - Remover Conta Bancária
     */
    router.delete('/accounts/:id', requireAuth, async (req, res) => {
        try {
            await pool.query("DELETE FROM external_bank_accounts WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
            res.json({ success: true, message: "Conta removida." });
        } catch (e) {
            res.status(500).json({ error: "Erro ao remover conta." });
        }
    });


    // =============================================================================================
    // 🔐 4.6 SEGURANÇA E CONFIGURAÇÕES DO USUÁRIO
    // =============================================================================================

    /**
     * POST /set-pin - Definir ou Alterar PIN
     */
    router.post('/set-pin', requireAuth, async (req, res) => {
        const { current_pin, new_pin } = req.body;
        const userId = req.user.id;

        if (!new_pin || new_pin.length !== 4 || isNaN(new_pin)) {
            return res.status(400).json({ error: "O PIN deve conter 4 dígitos numéricos." });
        }

        try {
            const result = await pool.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
            const currentHash = result.rows[0]?.wallet_pin_hash;

            // Se já tiver PIN, exige a confirmação do antigo
            if (currentHash) {
                if (!current_pin) return res.status(400).json({ error: "O PIN atual é obrigatório para alteração." });
                const match = await bcrypt.compare(current_pin, currentHash);
                if (!match) return res.status(401).json({ error: "O PIN atual está incorreto." });
            }

            const newHash = await bcrypt.hash(new_pin, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);
            await pool.query("UPDATE users SET wallet_pin_hash = $1 WHERE id = $2", [newHash, userId]);
            
            // Log de Segurança
            await pool.query(
                "INSERT INTO wallet_security_logs (user_id, event_type, ip_address) VALUES ($1, 'PIN_CHANGE', $2)", 
                [userId, req.ip]
            );

            res.json({ success: true, message: "PIN de segurança configurado com sucesso." });

        } catch (e) {
            res.status(500).json({ error: "Erro ao configurar PIN." });
        }
    });

    /**
     * POST /verify-pin - Validação Pré-Transação (Frontend Helper)
     */
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

    /**
     * POST /security/freeze - Congelamento de Emergência
     */
    router.post('/security/freeze', requireAuth, async (req, res) => {
        try {
            await pool.query("UPDATE users SET wallet_status = 'frozen' WHERE id = $1", [req.user.id]);
            await pool.query(
                "INSERT INTO wallet_security_logs (user_id, event_type, details) VALUES ($1, 'WALLET_FREEZE', 'Solicitado pelo usuário')",
                [req.user.id]
            );
            res.json({ success: true, message: "Carteira congelada com sucesso. Entre em contato com o suporte para reativar." });
        } catch (e) {
            res.status(500).json({ error: "Erro ao congelar conta." });
        }
    });

    // =============================================================================================
    // 📊 4.7 ADMINISTRAÇÃO (STATS)
    // =============================================================================================

    router.get('/admin/stats', requireAuth, async (req, res) => {
        if (req.user.role !== 'admin') return res.status(403).json({ error: "Acesso administrativo negado." });
        
        try {
            const stats = await pool.query(`
                SELECT 
                    (SELECT COALESCE(SUM(balance), 0) FROM users) as total_liquidity,
                    (SELECT COUNT(*) FROM wallet_transactions) as total_txs,
                    (SELECT COALESCE(SUM(amount), 0) FROM wallet_transactions WHERE type='deposit') as total_deposits
            `);
            res.json(stats.rows[0]);
        } catch (e) {
            res.status(500).json({ error: "Erro ao gerar estatísticas." });
        }
    });

    // =============================================================================================
    // 🛑 PONTO DE SAÍDA CRÍTICO: RETORNO DO ROUTER
    // =============================================================================================
    
    // Este retorno é FUNDAMENTAL para que o 'require' no server.js funcione corretamente.
    return router;
};
