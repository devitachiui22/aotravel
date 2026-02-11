/**
 * =================================================================================================
 * ⚙️ AOTRAVEL SERVER PRO - GLOBAL APPLICATION CONFIGURATION (TITANIUM CONFIG)
 * =================================================================================================
 *
 * ARQUIVO: src/config/appConfig.js
 * DESCRIÇÃO: Centralização de todas as constantes, configurações de sistema, limites operacionais e
 *            regras de negócio financeiras. Este arquivo garante que não existam "Magic Numbers"
 *            espalhados pelo código.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

require('dotenv').config();

const SYSTEM_CONFIG = {
    // =============================================================================================
    // 1. IDENTIDADE DA APLICAÇÃO
    // =============================================================================================
    APP_NAME: "AOtravel Titanium Wallet",
    VERSION: "11.0.0-GOLD-ARMORED", // Versão do Core Lógico
    SERVER_VERSION: "2026.02.11",    // Versão do Build do Servidor

    // Configurações Regionais (Angola)
    CURRENCY: "AOA",           // Kwanza Angolano
    LOCALE: "pt-AO",           // Formatação de Datas e Moeda
    TIMEZONE: "Africa/Luanda", // Fuso Horário Mandatório

    // =============================================================================================
    // 2. INFRAESTRUTURA DE SERVIDOR E REDE
    // =============================================================================================
    SERVER: {
        PORT: process.env.PORT || 3000,

        // Limite crítico para upload de fotos em Base64 ou Multipart
        // Aumentado para 100mb para suportar documentos de alta resolução (KYC)
        BODY_LIMIT: '100mb',

        // Diretório de persistência de uploads
        UPLOAD_DIR: 'uploads',

        // Política de CORS (Permissiva para Mobile Apps)
        CORS_ORIGIN: '*',
    },

    // Configurações do Socket.IO (Real-Time Engine)
    // Ajustado com Ping/Pong agressivo para redes móveis instáveis (Unitel/Africell)
    SOCKET: {
        PING_TIMEOUT: 20000,    // 20s: Aguarda antes de considerar desconectado (High Latency Tolerance)
        PING_INTERVAL: 25000,   // 25s: Envia pacote de vida (Keep-Alive)
        TRANSPORTS: ['websocket', 'polling'] // Fallback para Polling se WebSocket falhar
    },

    // =============================================================================================
    // 3. REGRAS FINANCEIRAS & COMPLIANCE (WALLET)
    // Sincronizado com as colunas NUMERIC(15,2) do Banco de Dados
    // =============================================================================================

    // Limites Operacionais (Baseados em Regulação BNA - Banco Nacional de Angola)
    WALLET_LIMITS: {
        // TIER 1: Usuários não verificados ou verificação básica
        DAILY_MAX_TIER_1: 500000.00,   // 500k Kz Diários

        // TIER 2: Usuários com KYC Completo (BI + Reconhecimento Facial)
        DAILY_MAX_TIER_2: 5000000.00,  // 5 Milhões Kz Diários

        // Limites Transacionais
        TRANSACTION_MIN: 50.00,        // Mínimo por transação (evita spam)
        TRANSACTION_MAX: 2000000.00,   // Máximo por transação única (Segurança)

        // Limites de Movimentação Externa
        MIN_DEPOSIT: 100.00,           // Depósito mínimo
        MIN_WITHDRAW: 2000.00,         // Saque mínimo para conta bancária

        // Limites de Recursos
        MAX_ACCOUNTS: 5,               // Máximo de contas bancárias vinculadas
        MAX_CARDS: 10,                 // Máximo de cartões virtuais gerados
        MAX_PIN_ATTEMPTS: 3            // Tentativas de PIN antes do bloqueio temporário (30 min)
    },

    // Estrutura de Taxas e Tarifários (Revenue Model)
    WALLET_FEES: {
        INTERNAL_TRANSFER: 0.00,       // Grátis entre usuários da plataforma (P2P)

        // Saques Bancários
        BANK_WITHDRAWAL_PCT: 0.015,    // 1.5% de taxa variável
        BANK_WITHDRAWAL_MIN: 500.00,   // Mínimo de 500 Kz de taxa (Floor)

        // Pagamento de Serviços
        SERVICE_PAYMENT_FIXED: 50.00,  // Taxa fixa por pagamento (ENDE, EPAL, etc.)

        // Cartões
        CARD_ISSUANCE: 1000.00,        // Custo de emissão de cartão virtual

        // Depósitos
        TOPUP_FEE_PCT: 0.00            // Taxa de depósito (Subsidiada pela plataforma)
    },

    // Semente Matemática (PI Seed) para gerar números de conta únicos e verificáveis.
    // ATENÇÃO: Nunca alterar este valor em produção, ou as contas geradas mudarão.
    ACCOUNT_SEED: "20269359953368462643383279531415",

    // =============================================================================================
    // 4. SEGURANÇA E CRIPTOGRAFIA
    // =============================================================================================
    SECURITY: {
        // Custo de processamento do hash de senha (12 é padrão indústria, >14 fica lento)
        BCRYPT_ROUNDS: 12,

        // Tamanho do PIN numérico financeiro
        PIN_LENGTH: 4,

        // Expiração de tokens temporários (Email verification, Password reset)
        TOKEN_EXPIRY: '15m',

        // Duração do bloqueio por tentativas falhas (Brute-force protection)
        LOCK_DURATION_MINUTES: 30,

        // Timeouts de Sessão
        SESSION_TIMEOUT: 900,          // 15 minutos de inatividade (Web)
        SESSION_EXPIRY_DAYS: 365       // 1 ano de validade para sessão persistente (App Mobile)
    },

    // =============================================================================================
    // 5. CONFIGURAÇÕES DE NEGÓCIO (RIDES & DRIVERS)
    // =============================================================================================
    RIDES: {
        // Raio máximo para busca de motoristas (km)
        MAX_RADIUS_KM: 15,

        // Tempo para motorista aceitar a corrida antes de passar para o próximo (segundos)
        DRIVER_ACCEPTANCE_TIMEOUT: 45,

        // Taxas de Cancelamento
        CANCELLATION_FEE: 500.00,
        GRACE_PERIOD_MINUTES: 2 // Tempo grátis para cancelar após pedir
    }
};

/**
 * EXPORTAÇÃO DA CONFIGURAÇÃO
 *
 * Este objeto é imutável e deve ser usado em toda a aplicação para garantir
 * consistência nas regras de negócio e configurações de infraestrutura.
 */
module.exports = SYSTEM_CONFIG;
