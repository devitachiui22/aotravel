/**
 * =================================================================================================
 * 🛠️ AOTRAVEL SERVER PRO - UTILITY HELPER FUNCTIONS (TITANIUM CORE)
 * =================================================================================================
 *
 * ARQUIVO: src/utils/helpers.js
 * DESCRIÇÃO: Biblioteca de funções utilitárias puras e helpers de acesso a dados.
 *            Consolida lógica de formatação, cálculo geográfico, geração de códigos
 *            e queries complexas (Rich Payloads) para alimentar a API e Sockets.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const crypto = require('crypto');
const pool = require('../config/db');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. SISTEMA DE LOGS E FORMATAÇÃO (ANGOLA TIMEZONE)
// =================================================================================================

/**
 * Logger do Sistema com Timestamp Nativo (Angola Time)
 * Usado para registrar eventos operacionais (Info).
 */
function logSystem(tag, message) {
    const now = new Date();
    // Força o locale pt-AO para garantir formato 24h correto
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false, timeZone: 'Africa/Luanda' });
    console.log(`[${timeString}] ℹ️ [${tag}] ${message}`);
}

/**
 * Logger de Erros com Timestamp Nativo (Angola Time)
 * Registra stack traces e mensagens de erro críticas.
 */
function logError(tag, error) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false, timeZone: 'Africa/Luanda' });
    const msg = error.message || error;
    console.error(`[${timeString}] ❌ [${tag}] ERRO CRÍTICO:`, msg);

    // Em desenvolvimento, imprime o stack para debug
    if (process.env.NODE_ENV !== 'production' && error.stack) {
        console.error(error.stack);
    }
}

// =================================================================================================
// 2. UTILITÁRIOS MATEMÁTICOS E GEOGRÁFICOS
// =================================================================================================

/**
 * Cálculo de Distância Geográfica (Fórmula de Haversine)
 * Retorna a distância em Kilômetros entre dois pontos (Lat/Lng).
 * Retorna 99999 se as coordenadas forem inválidas (Fail-safe).
 */
function getDistance(lat1, lon1, lat2, lon2) {
    // Validação estrita de tipos para evitar NaN
    const pLat1 = parseFloat(lat1);
    const pLon1 = parseFloat(lon1);
    const pLat2 = parseFloat(lat2);
    const pLon2 = parseFloat(lon2);

    if (isNaN(pLat1) || isNaN(pLon1) || isNaN(pLat2) || isNaN(pLon2)) return 99999;

    // Se forem idênticos, distância é 0
    if ((pLat1 === pLat2) && (pLon1 === pLon2)) return 0;

    const R = 6371; // Raio da Terra em KM
    const dLat = (pLat2 - pLat1) * Math.PI / 180;
    const dLon = (pLon2 - pLon1) * Math.PI / 180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(pLat1 * Math.PI / 180) * Math.cos(pLat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;

    // Retorna com 2 casas decimais de precisão
    return parseFloat(distance.toFixed(2));
}

// =================================================================================================
// 3. GERADORES DE CÓDIGOS, REFS E CONTAS (WALLET LOGIC)
// =================================================================================================

/**
 * Gerar código numérico aleatório para verificações (OTP, 2FA).
 * Ex: generateCode(6) -> "492813"
 */
function generateCode(length = 6) {
    if (length <= 0) length = 6;
    // Math.random é suficiente para OTPs curtos não criptográficos
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

/**
 * Gera uma referência única legível para transações financeiras.
 * Formato: PREF-YYYYMMDD-HEX (Ex: TRF-20260211-A1B2C3)
 * Garante unicidade e rastreabilidade visual.
 */
function generateRef(prefix) {
    const safePrefix = (prefix || 'TX').toUpperCase().substring(0, 4);
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ''); // 20260211
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars hex
    return `${safePrefix}-${dateStr}-${rand}`;
}

/**
 * Gera número de conta "Titanium" (21 dígitos) baseado no telefone.
 * Algoritmo Determinístico: 9 dig (tel) + 4 dig (ano) + 8 dig (seed)
 * Isso garante que o mesmo telefone sempre gere a mesma conta base,
 * facilitando a recuperação de contas.
 */
function generateAccountNumber(phone) {
    if (!phone) return null;

    // Sanitização: remove tudo que não for número e pega os últimos 9 (padrão Angola)
    const cleanPhone = phone.replace(/\D/g, '').slice(-9);

    if (cleanPhone.length < 9) return null; // Telefone inválido

    const year = new Date().getFullYear().toString();

    // Pega a seed do config ou usa fallback seguro
    const seedConfig = SYSTEM_CONFIG.ACCOUNT_SEED || "20269359953368462643383279531415";
    const seed = seedConfig.slice(0, 8);

    return `${cleanPhone}${year}${seed}`;
}

// =================================================================================================
// 4. VALIDAÇÕES E SEGURANÇA DE DADOS
// =================================================================================================

/**
 * Valida se um valor monetário é seguro para processamento financeiro (ACID).
 * Impede NaN, Infinity, valores negativos e zero (onde não permitido).
 */
function isValidAmount(amount) {
    if (amount === null || amount === undefined) return false;
    const val = parseFloat(amount);
    // Deve ser número, finito e maior que 0.00
    return !isNaN(val) && isFinite(val) && val > 0.00;
}

/**
 * Valida IBAN Angolano (Formato Simplificado AO06).
 * Verifica prefixo e comprimento exato.
 */
function isValidAOIBAN(iban) {
    if (!iban) return false;
    const cleanIban = iban.replace(/\s/g, '').toUpperCase();
    // Regex para AO06 + 21 dígitos numéricos = 25 chars
    // Ex: AO06 0000 0000 0000 0000 0000 0
    return /^AO06[0-9]{21}$/.test(cleanIban) && cleanIban.length === 25;
}

/**
 * Mascara dados sensíveis para exibição em logs e recibos.
 * Ex: 12345678 -> ****5678
 */
function maskData(data, visibleEnd = 4) {
    if (!data) return '';
    const str = String(data);
    if (str.length <= visibleEnd) return str;
    return '*'.repeat(str.length - visibleEnd) + str.slice(-visibleEnd);
}

// =================================================================================================
// 5. HELPERS DE BANCO DE DADOS (QUERIES COMPLEXAS / RICH PAYLOADS)
// =================================================================================================

/**
 * Busca dados COMPLETOS da corrida (Rich Payload).
 * Utilizada para enviar objetos para o Frontend via Socket ou API.
 * Realiza JOINs robustos e trata nulos com COALESCE.
 *
 * @param {number} rideId - ID da corrida
 * @returns {Object|null} - Objeto da corrida ou null
 */
async function getFullRideDetails(rideId) {
    const query = `
        SELECT
            r.id, r.passenger_id, r.driver_id, r.status,
            r.origin_name, r.dest_name,
            r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng,

            -- Valores Monetários
            r.initial_price,
            COALESCE(r.final_price, r.initial_price) as final_price,

            r.ride_type, r.distance_km,

            -- Timestamps
            r.created_at, r.accepted_at, r.started_at, r.completed_at,
            r.cancelled_at, r.cancelled_by, r.cancellation_reason,

            -- Avaliação e Pagamento
            r.rating, r.feedback,
            r.payment_method, r.payment_status,

            -- DADOS DO MOTORISTA (JSON OBJECT)
            -- Retorna NULL se não houver motorista atribuído
            CASE WHEN d.id IS NOT NULL THEN
                json_build_object(
                    'id', d.id,
                    'name', d.name,
                    'photo', COALESCE(d.photo, ''),
                    'phone', d.phone,
                    'email', d.email,
                    'vehicle_details', d.vehicle_details, -- JSONB no banco
                    'rating', d.rating,
                    'is_online', d.is_online,
                    'bi_front', COALESCE(d.bi_front, ''),
                    'bi_back', COALESCE(d.bi_back, '')
                )
            ELSE NULL END as driver_data,

            -- DADOS DO PASSAGEIRO (JSON OBJECT)
            -- Sempre deve existir
            json_build_object(
                'id', p.id,
                'name', p.name,
                'photo', COALESCE(p.photo, ''),
                'phone', p.phone,
                'email', p.email,
                'rating', p.rating,
                'bi_front', COALESCE(p.bi_front, ''),
                'bi_back', COALESCE(p.bi_back, '')
            ) as passenger_data

        FROM rides r
        LEFT JOIN users d ON r.driver_id = d.id
        LEFT JOIN users p ON r.passenger_id = p.id
        WHERE r.id = $1
    `;

    try {
        const res = await pool.query(query, [rideId]);
        return res.rows[0] || null;
    } catch (e) {
        logError('DB_FETCH_RIDE', e);
        return null;
    }
}

/**
 * Busca dados COMPLETOS do usuário para Perfil e Auth.
 * Remove dados sensíveis (senha) mas inclui metadados de Wallet e Segurança.
 *
 * @param {number} userId - ID do usuário
 * @returns {Object|null} - Objeto do usuário
 */
async function getUserFullDetails(userId) {
    const query = `
        SELECT
            -- Dados Básicos
            id, name, email, phone, photo, role,

            -- Financeiro (Wallet)
            balance, bonus_points,
            wallet_account_number,
            wallet_status,
            daily_limit,
            account_tier,

            -- Verifica se tem PIN definido (sem retornar o hash)
            (wallet_pin_hash IS NOT NULL) as has_pin,

            -- Dados Motorista
            vehicle_details,
            rating,
            is_online,

            -- Documentação (KYC)
            bi_front, bi_back,
            driving_license_front, driving_license_back,
            is_verified,

            -- Segurança e Config
            is_blocked,
            fcm_token,
            settings,
            privacy_settings,
            notification_preferences,

            -- Timestamps
            created_at,
            last_login

        FROM users
        WHERE id = $1
    `;

    try {
        const res = await pool.query(query, [userId]);
        return res.rows[0] || null;
    } catch (e) {
        logError('USER_FETCH', e);
        return null;
    }
}

// =================================================================================================
// EXPORTAÇÃO UNIFICADA
// =================================================================================================
module.exports = {
    logSystem,
    logError,
    getDistance,
    generateCode,
    generateRef,
    generateAccountNumber,
    isValidAmount,
    isValidAOIBAN,
    maskData,
    getFullRideDetails,
    getUserFullDetails
};