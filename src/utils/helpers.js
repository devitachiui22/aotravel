/**
 * =================================================================================================
 * 🛠️ AOTRAVEL SERVER PRO - UTILITY HELPER FUNCTIONS (TITANIUM CORE)
 * =================================================================================================
 *
 * ARQUIVO: src/utils/helpers.js
 * DESCRIÇÃO: Biblioteca de funções utilitárias.
 *
 * ✅ CORREÇÃO KYC STRICT: Adicionado vehicle_title, vehicle_insurance, tax_document e
 *    cartas de condução ao helper de detalhes do usuário.
 *
 * ✅ FUNCIONALIDADES:
 * 1. ✅ Sistema de logs com timestamp (Luanda/Africa)
 * 2. ✅ Cálculo de distância geográfica (Haversine)
 * 3. ✅ Geradores de códigos e referências
 * 4. ✅ Validações de segurança
 * 5. ✅ Helpers de banco de dados com todos os campos KYC
 * 6. ✅ formatFileUrl - Injeção de URL base para arquivos estáticos
 *
 * STATUS: 🔥 PRODUCTION READY - 100% BLINDADO
 * =================================================================================================
 */

const crypto = require('crypto');
const pool = require('../config/db');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. SISTEMA DE LOGS E FORMATAÇÃO
// =================================================================================================

/**
 * Log de sistema com timestamp (Luanda)
 * @param {string} tag - Tag identificadora
 * @param {string} message - Mensagem a ser logada
 */
function logSystem(tag, message) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false, timeZone: 'Africa/Luanda' });
    console.log(`[${timeString}] ℹ️ [${tag}] ${message}`);
}

/**
 * Log de erro com stack trace (apenas em desenvolvimento)
 * @param {string} tag - Tag identificadora
 * @param {Error} error - Objeto de erro
 */
function logError(tag, error) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false, timeZone: 'Africa/Luanda' });
    const msg = error.message || error;
    console.error(`[${timeString}] ❌ [${tag}] ERRO CRÍTICO:`, msg);
    if (process.env.NODE_ENV !== 'production' && error.stack) {
        console.error(error.stack);
    }
}

// =================================================================================================
// 2. UTILITÁRIOS DE FORMATAÇÃO DE URL
// =================================================================================================

/**
 * Função para injetar a URL base do servidor nos caminhos de arquivos
 * @param {string} filePath - Caminho do arquivo (relativo ou absoluto)
 * @param {Object} req - Objeto de requisição Express
 * @returns {string} URL completa do arquivo
 */
function formatFileUrl(filePath, req) {
    if (!filePath || filePath.startsWith('http') || filePath.startsWith('data:')) return filePath;
    const protocol = req.protocol;
    const host = req.get('host');
    // Garante que o caminho comece com /
    const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    return `${protocol}://${host}${cleanPath}`;
}

// =================================================================================================
// 3. UTILITÁRIOS MATEMÁTICOS E GEOGRÁFICOS
// =================================================================================================

/**
 * Calcula distância entre duas coordenadas (Fórmula de Haversine)
 * @param {number} lat1 - Latitude do ponto 1
 * @param {number} lon1 - Longitude do ponto 1
 * @param {number} lat2 - Latitude do ponto 2
 * @param {number} lon2 - Longitude do ponto 2
 * @returns {number} Distância em quilômetros
 */
function getDistance(lat1, lon1, lat2, lon2) {
    const pLat1 = parseFloat(lat1);
    const pLon1 = parseFloat(lon1);
    const pLat2 = parseFloat(lat2);
    const pLon2 = parseFloat(lon2);

    if (isNaN(pLat1) || isNaN(pLon1) || isNaN(pLat2) || isNaN(pLon2)) return 99999;
    if ((pLat1 === pLat2) && (pLon1 === pLon2)) return 0;

    const R = 6371; // Raio da Terra em km
    const dLat = (pLat2 - pLat1) * Math.PI / 180;
    const dLon = (pLon2 - pLon1) * Math.PI / 180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(pLat1 * Math.PI / 180) * Math.cos(pLat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return parseFloat((R * c).toFixed(2));
}

// =================================================================================================
// 4. GERADORES DE CÓDIGOS, REFS E CONTAS
// =================================================================================================

/**
 * Gera código numérico aleatório
 * @param {number} length - Tamanho do código (padrão: 6)
 * @returns {string} Código gerado
 */
function generateCode(length = 6) {
    if (length <= 0) length = 6;
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

/**
 * Gera referência única para transações
 * @param {string} prefix - Prefixo da referência (ex: 'RIDE', 'PAY')
 * @returns {string} Referência única
 */
function generateRef(prefix) {
    const safePrefix = (prefix || 'TX').toUpperCase().substring(0, 4);
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${safePrefix}-${dateStr}-${rand}`;
}

/**
 * Gera número de conta baseado no telefone
 * @param {string} phone - Número de telefone
 * @returns {string|null} Número de conta ou null
 */
function generateAccountNumber(phone) {
    if (!phone) return null;
    const cleanPhone = phone.replace(/\D/g, '').slice(-9);
    if (cleanPhone.length < 9) return null;
    const year = new Date().getFullYear().toString();
    const seedConfig = SYSTEM_CONFIG.ACCOUNT_SEED || "20269359953368462643383279531415";
    const seed = seedConfig.slice(0, 8);
    return `${cleanPhone}${year}${seed}`;
}

// =================================================================================================
// 5. VALIDAÇÕES E SEGURANÇA
// =================================================================================================

/**
 * Verifica se um valor é um montante válido
 * @param {any} amount - Valor a verificar
 * @returns {boolean} true se for válido
 */
function isValidAmount(amount) {
    if (amount === null || amount === undefined) return false;
    const val = parseFloat(amount);
    return !isNaN(val) && isFinite(val) && val > 0.00;
}

/**
 * Valida IBAN angolano (AO06 + 21 dígitos)
 * @param {string} iban - IBAN a validar
 * @returns {boolean} true se for válido
 */
function isValidAOIBAN(iban) {
    if (!iban) return false;
    const cleanIban = iban.replace(/\s/g, '').toUpperCase();
    return /^AO06[0-9]{21}$/.test(cleanIban) && cleanIban.length === 25;
}

/**
 * Mascara dados sensíveis (ex: cartão, telefone)
 * @param {string} data - Dado a mascarar
 * @param {number} visibleEnd - Quantos caracteres visíveis no final
 * @returns {string} Dado mascarado
 */
function maskData(data, visibleEnd = 4) {
    if (!data) return '';
    const str = String(data);
    if (str.length <= visibleEnd) return str;
    return '*'.repeat(str.length - visibleEnd) + str.slice(-visibleEnd);
}

// =================================================================================================
// 6. HELPERS DE BANCO DE DADOS (KYC STRICT)
// =================================================================================================

/**
 * Busca detalhes completos de uma corrida
 * @param {number} rideId - ID da corrida
 * @returns {Object|null} Detalhes da corrida ou null
 */
async function getFullRideDetails(rideId) {
    console.log(`🔍 [HELPER] Buscando detalhes completos da corrida ${rideId}...`);

    const query = `
        SELECT
            r.id, r.passenger_id, r.driver_id, r.status,
            r.origin_name, r.dest_name,
            r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng,
            r.initial_price,
            COALESCE(r.final_price, r.initial_price) as final_price,
            r.ride_type, r.distance_km,
            r.created_at, r.accepted_at, r.started_at, r.completed_at,
            r.cancelled_at, r.cancelled_by, r.cancellation_reason,
            r.rating, r.feedback,
            r.payment_method, r.payment_status,

            -- DADOS DO MOTORISTA (JSON OBJECT) - KYC COMPLETO
            CASE WHEN d.id IS NOT NULL THEN
                json_build_object(
                    'id', d.id,
                    'name', d.name,
                    'photo', COALESCE(d.photo, ''),
                    'phone', d.phone,
                    'email', d.email,
                    'vehicle_details', d.vehicle_details,
                    'vehicle_title', COALESCE(d.vehicle_title, ''),
                    'vehicle_insurance', COALESCE(d.vehicle_insurance, ''),
                    'tax_document', COALESCE(d.tax_document, ''),
                    'driving_license_front', COALESCE(d.driving_license_front, ''),
                    'driving_license_back', COALESCE(d.driving_license_back, ''),
                    'rating', d.rating,
                    'is_online', d.is_online,
                    'is_verified', d.is_verified,
                    'bi_front', COALESCE(d.bi_front, ''),
                    'bi_back', COALESCE(d.bi_back, '')
                )
            ELSE NULL END as driver_data,

            -- DADOS DO PASSAGEIRO (JSON OBJECT)
            json_build_object(
                'id', p.id,
                'name', p.name,
                'photo', COALESCE(p.photo, ''),
                'phone', p.phone,
                'email', p.email,
                'rating', p.rating,
                'is_verified', p.is_verified,
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

        if (res.rows.length === 0) {
            console.log(`❌ [HELPER] Corrida ${rideId} não encontrada`);
            return null;
        }

        console.log(`✅ [HELPER] Dados da corrida ${rideId} obtidos com sucesso`);
        return res.rows[0];

    } catch (e) {
        logError('DB_FETCH_RIDE', e);
        console.error(`❌ [HELPER] Erro ao buscar corrida ${rideId}:`, e.message);
        return null;
    }
}

/**
 * Busca detalhes completos de um usuário (KYC COMPLETO)
 * @param {number} userId - ID do usuário
 * @param {Object} req - Objeto de requisição Express (opcional, para formatar URLs)
 * @returns {Object|null} Detalhes do usuário ou null
 */
async function getUserFullDetails(userId, req = null) {
    console.log(`🔍 [HELPER] Buscando detalhes completos do usuário ${userId}...`);

    const query = `
        SELECT
            id, name, email, phone, photo, role,
            balance, bonus_points, wallet_account_number, wallet_status,
            daily_limit, account_tier, is_online, is_verified, is_blocked,
            kyc_level, vehicle_category, vehicle_details,
            -- DOCUMENTOS KYC (Colunas Explicitamente Mapeadas)
            bi_front, bi_back,
            driving_license_front, driving_license_back,
            vehicle_title, vehicle_insurance, tax_document,
            rating, fcm_token, settings, privacy_settings, notification_preferences,
            last_login, created_at, updated_at
        FROM users
        WHERE id = $1
    `;

    try {
        const res = await pool.query(query, [userId]);

        if (res.rows.length === 0) {
            console.log(`❌ [HELPER] Usuário ${userId} não encontrado`);
            return null;
        }

        const user = res.rows[0];

        // Se o objeto 'req' for passado, formatamos as URLs para o Admin/App
        if (req) {
            const docFields = [
                'photo', 'bi_front', 'bi_back',
                'driving_license_front', 'driving_license_back',
                'vehicle_title', 'vehicle_insurance', 'tax_document'
            ];

            docFields.forEach(field => {
                if (user[field]) {
                    user[field] = formatFileUrl(user[field], req);
                }
            });
        }

        console.log(`✅ [HELPER] Dados do usuário ${userId} obtidos com sucesso`);
        return user;

    } catch (e) {
        logError('USER_FETCH', e);
        console.error(`❌ [HELPER] Erro ao buscar usuário ${userId}:`, e.message);
        return null;
    }
}

// =================================================================================================
// 7. EXPORTAÇÃO UNIFICADA
// =================================================================================================
module.exports = {
    logSystem,
    logError,
    formatFileUrl,
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
