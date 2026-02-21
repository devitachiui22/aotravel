/**
 * =================================================================================================
 * 🛠️ AOTRAVEL SERVER PRO - UTILITY HELPER FUNCTIONS (TITANIUM CORE)
 * =================================================================================================
 *
 * ARQUIVO: src/utils/helpers.js
 * DESCRIÇÃO: Biblioteca de funções utilitárias - VERSÃO CORRIGIDA
 *
 * ✅ CORREÇÕES:
 * 1. ✅ Função getFullRideDetails corrigida para retornar TODOS os dados
 * 2. ✅ Tratamento de erros melhorado
 * 3. ✅ Logs detalhados para debug
 *
 * STATUS: 🔥 PRODUCTION READY
 * =================================================================================================
 */

const crypto = require('crypto');
const pool = require('../config/db');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. SISTEMA DE LOGS E FORMATAÇÃO
// =================================================================================================

function logSystem(tag, message) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false, timeZone: 'Africa/Luanda' });
    console.log(`[${timeString}] ℹ️ [${tag}] ${message}`);
}

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
// 2. UTILITÁRIOS MATEMÁTICOS E GEOGRÁFICOS
// =================================================================================================

function getDistance(lat1, lon1, lat2, lon2) {
    const pLat1 = parseFloat(lat1);
    const pLon1 = parseFloat(lon1);
    const pLat2 = parseFloat(lat2);
    const pLon2 = parseFloat(lon2);

    if (isNaN(pLat1) || isNaN(pLon1) || isNaN(pLat2) || isNaN(pLon2)) return 99999;
    if ((pLat1 === pLat2) && (pLon1 === pLon2)) return 0;

    const R = 6371;
    const dLat = (pLat2 - pLat1) * Math.PI / 180;
    const dLon = (pLon2 - pLon1) * Math.PI / 180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(pLat1 * Math.PI / 180) * Math.cos(pLat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return parseFloat((R * c).toFixed(2));
}

// =================================================================================================
// 3. GERADORES DE CÓDIGOS, REFS E CONTAS
// =================================================================================================

function generateCode(length = 6) {
    if (length <= 0) length = 6;
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
}

function generateRef(prefix) {
    const safePrefix = (prefix || 'TX').toUpperCase().substring(0, 4);
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${safePrefix}-${dateStr}-${rand}`;
}

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
// 4. VALIDAÇÕES E SEGURANÇA
// =================================================================================================

function isValidAmount(amount) {
    if (amount === null || amount === undefined) return false;
    const val = parseFloat(amount);
    return !isNaN(val) && isFinite(val) && val > 0.00;
}

function isValidAOIBAN(iban) {
    if (!iban) return false;
    const cleanIban = iban.replace(/\s/g, '').toUpperCase();
    return /^AO06[0-9]{21}$/.test(cleanIban) && cleanIban.length === 25;
}

function maskData(data, visibleEnd = 4) {
    if (!data) return '';
    const str = String(data);
    if (str.length <= visibleEnd) return str;
    return '*'.repeat(str.length - visibleEnd) + str.slice(-visibleEnd);
}

// =================================================================================================
// 5. HELPERS DE BANCO DE DADOS (VERSÃO CORRIGIDA)
// =================================================================================================

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

            -- DADOS DO MOTORISTA (JSON OBJECT)
            CASE WHEN d.id IS NOT NULL THEN
                json_build_object(
                    'id', d.id,
                    'name', d.name,
                    'photo', COALESCE(d.photo, ''),
                    'phone', d.phone,
                    'email', d.email,
                    'vehicle_details', d.vehicle_details,
                    'rating', d.rating,
                    'is_online', d.is_online,
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

async function getUserFullDetails(userId) {
    const query = `
        SELECT
            id, name, email, phone, photo, role,
            balance, bonus_points,
            wallet_account_number,
            wallet_status,
            daily_limit,
            account_tier,
            (wallet_pin_hash IS NOT NULL) as has_pin,
            vehicle_details,
            rating,
            is_online,
            bi_front, bi_back,
            driving_license_front, driving_license_back,
            is_verified,
            is_blocked,
            fcm_token,
            settings,
            privacy_settings,
            notification_preferences,
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
