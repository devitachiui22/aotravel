/**
 * =================================================================================================
 * ⚙️ AOTRAVEL SERVER PRO - GLOBAL APPLICATION CONFIGURATION
 * =================================================================================================
 *
 * ARQUIVO: src/config/appConfig.js
 * DESCRIÇÃO: Centralização de todas as constantes, configurações de sistema, limites e
 *            regras de negócio financeiras extraídas do 'server.js' e 'wallet.js'.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const SYSTEM_CONFIG = {
    // Identidade da Aplicação
    APP_NAME: "AOtravel Titanium Wallet",
    VERSION: "11.0.0-GOLD-ARMORED", // Sincronizado com wallet.js original
    SERVER_VERSION: "2026.02.10",    // Sincronizado com server.js original

    // Configurações Regionais
    CURRENCY: "AOA", // Kwanza Angolano
    LOCALE: "pt-AO",
    TIMEZONE: "Africa/Luanda",

    // Configurações de Servidor e Upload (Mapeado do server.js)
    SERVER: {
        PORT: process.env.PORT || 3000,
        BODY_LIMIT: '100mb', // Limite crítico para upload de fotos base64
        UPLOAD_DIR: 'uploads',
        CORS_ORIGIN: '*',    // Permite acesso total para Mobile e Web
    },

    // Configurações do Socket.IO (Mapeado do server.js)
    // Ajustado com Ping/Pong agressivo para redes móveis instáveis (3G/4G Angola)
    SOCKET: {
        PING_TIMEOUT: 20000,    // Aguarda 20s antes de considerar desconectado
        PING_INTERVAL: 25000,   // Envia pacote de vida a cada 25s
        TRANSPORTS: ['websocket', 'polling'] // Tenta WebSocket, falha para Polling se necessário
    },

    // Limites Operacionais Financeiros (Compliance BNA - Banco Nacional de Angola)
    // Extraído integralmente do wallet.js
    WALLET_LIMITS: {
        DAILY_MAX_TIER_1: 500000.00,   // Limite Padrão (500k Kz)
        DAILY_MAX_TIER_2: 5000000.00,  // Limite Verificado (5M Kz)
        TRANSACTION_MIN: 50.00,        // Mínimo por transação
        TRANSACTION_MAX: 2000000.00,   // Máximo por transação única
        MIN_DEPOSIT: 100.00,           // Depósito mínimo
        MIN_WITHDRAW: 2000.00,         // Saque mínimo
        MAX_ACCOUNTS: 5,               // Máximo de contas bancárias vinculadas
        MAX_CARDS: 10,                 // Máximo de cartões virtuais
        MAX_PIN_ATTEMPTS: 3            // Tentativas de PIN antes do bloqueio temporário
    },

    // Estrutura de Taxas e Tarifários (Revenue Model)
    // Extraído integralmente do wallet.js
    WALLET_FEES: {
        INTERNAL_TRANSFER: 0.00,       // Grátis entre usuários da plataforma
        BANK_WITHDRAWAL_PCT: 0.015,    // 1.5% de taxa de saque bancário
        BANK_WITHDRAWAL_MIN: 500.00,   // Mínimo de 500 Kz de taxa
        SERVICE_PAYMENT_FIXED: 50.00,  // Taxa fixa por pagamento de serviço
        CARD_ISSUANCE: 1000.00,        // Custo de emissão de cartão virtual
        TOPUP_FEE_PCT: 0.00            // Taxa de depósito (Subsidiada)
    },

    // Configurações de Segurança e Criptografia
    SECURITY: {
        BCRYPT_ROUNDS: 12,             // Custo de processamento do hash (Aumentado para segurança)
        PIN_LENGTH: 4,                 // Tamanho do PIN numérico
        TOKEN_EXPIRY: '15m',           // Expiração de tokens temporários
        LOCK_DURATION_MINUTES: 30,     // Duração do bloqueio por tentativas falhas
        SESSION_TIMEOUT: 900,          // 15 minutos de inatividade
        SESSION_EXPIRY_DAYS: 365       // 1 ano de validade para sessão persistente (App Mobile)
    },

    // Semente Matemática (PI Seed) para gerar números de conta únicos e verificáveis
    // Crítico para a lógica de geração de contas virtuais no wallet.js
    ACCOUNT_SEED: "31415926535897932384626433832795"
};

/**
 * EXPORTAÇÃO DA CONFIGURAÇÃO
 *
 * Este objeto é imutável e deve ser usado em toda a aplicação para garantir
 * consistência nas regras de negócio e configurações de infraestrutura.
 */
module.exports = SYSTEM_CONFIG;