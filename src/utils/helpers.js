/**
 * =================================================================================================
 * 🛠️ AOTRAVEL SERVER PRO - UTILITY HELPER FUNCTIONS
 * =================================================================================================
 *
 * ARQUIVO: src/utils/helpers.js
 * DESCRIÇÃO: Biblioteca de funções utilitárias puras e helpers de banco de dados.
 *            Consolida lógica de formatação, cálculo geográfico, geração de códigos
 *            e queries complexas de agregação de dados (Rich Payloads).
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const crypto = require('crypto');
const pool = require('../config/db');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. SISTEMA DE LOGS E FORMATAÇÃO
// =================================================================================================

/**
 * Logger do Sistema com Timestamp Nativo (Angola Time)
 * Usado para registrar eventos operacionais normais.
 */
function logSystem(tag, message) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false });
    console.log(`[${timeString}] ℹ️ [${tag}] ${message}`);
}

/**
 * Logger de Erros com Timestamp Nativo (Angola Time)
 * Usado para registrar exceções e falhas críticas.
 */
function logError(tag, error) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false });
    console.error(`[${timeString}] ❌ [${tag}] ERRO:`, error.message || error);
}

// =================================================================================================
// 2. UTILITÁRIOS MATEMÁTICOS E GEOGRÁFICOS
// =================================================================================================

/**
 * Cálculo de Distância Geográfica (Fórmula de Haversine)
 * Retorna a distância em Kilômetros entre dois pontos (Lat/Lng).
 * Retorna 99999 se as coordenadas forem inválidas.
 */
function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 99999;
    if ((lat1 == lat2) && (lon1 == lon2)) return 0;

    const R = 6371; // Raio da Terra em KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// =================================================================================================
// 3. GERADORES DE CÓDIGOS E IDENTIFICADORES
// =================================================================================================

/**
 * Gerar código numérico aleatório para verificações (OTP, etc).
 * Padrão: 6 dígitos.
 */
function generateCode(length = 6) {
    return Math.floor(Math.random() * Math.pow(10, length)).toString().padStart(length, '0');
}

/**
 * Gera uma referência única legível para transações financeiras.
 * Formato: PREF-YYYYMMDD-HEX (Ex: TRF-20260210-A1B2C3)
 * Extraído do wallet.js.
 */
function generateRef(prefix) {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}-${dateStr}-${rand}`;
}

/**
 * Gera número de conta "Titanium" (21 dígitos) baseado no telefone.
 * Algoritmo Determinístico: 9 dig (tel) + 4 dig (ano) + 8 dig (seed)
 * Extraído do wallet.js.
 */
function generateAccountNumber(phone) {
    if (!phone) return null;
    const cleanPhone = phone.replace(/\D/g, '').slice(-9); // Garante os últimos 9 dígitos
    const year = new Date().getFullYear().toString();
    const seed = SYSTEM_CONFIG.ACCOUNT_SEED.slice(0, 8);
    return `${cleanPhone}${year}${seed}`;
}

// =================================================================================================
// 4. VALIDAÇÕES E SEGURANÇA DE DADOS
// =================================================================================================

/**
 * Valida se um valor monetário é seguro para processamento financeiro.
 * Impede NaN, Infinity, valores negativos e zero (onde não permitido).
 */
function isValidAmount(amount) {
    return amount && !isNaN(amount) && parseFloat(amount) > 0 && isFinite(amount);
}

/**
 * Valida IBAN Angolano (Formato Simplificado AO06).
 * Verifica prefixo e comprimento.
 */
function isValidAOIBAN(iban) {
    if (!iban) return false;
    const cleanIban = iban.replace(/\s/g, '').toUpperCase();
    // Regex para AO06 + 21 dígitos numéricos = 25 chars
    return /^AO06[0-9]{21}$/.test(cleanIban) && cleanIban.length === 25;
}

/**
 * Mascara dados sensíveis para exibição em logs e recibos.
 * Ex: 12345678 -> ****5678
 */
function maskData(data, visibleEnd = 4) {
    if (!data) return '';
    if (data.length <= visibleEnd) return data;
    return '*'.repeat(data.length - visibleEnd) + data.slice(-visibleEnd);
}

// =================================================================================================
// 5. HELPERS DE BANCO DE DADOS (QUERIES COMPLEXAS)
// =================================================================================================

/**
 * Função SQL Robusta para buscar dados completos da corrida (Rich Payload).
 * Utilizada para enviar objetos completos para o Frontend via Socket ou API.
 * Realiza JOINs com tabelas de usuários para trazer fotos, avaliações e detalhes do veículo.
 */
async function getFullRideDetails(rideId) {
    const query = `
        SELECT
            r.id, r.passenger_id, r.driver_id, r.status,
            r.origin_name, r.dest_name,
            r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng,
            r.initial_price,
            COALESCE(r.final_price, r.initial_price) as final_price,
            r.ride_type, r.distance_km, r.created_at,
            r.rating, r.feedback,
            r.completed_at,

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
                    'bi_front', d.bi_front,
                    'bi_back', d.bi_back
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
                'bi_front', p.bi_front,
                'bi_back', p.bi_back
            ) as passenger_data

        FROM rides r
        LEFT JOIN users d ON r.driver_id = d.id
        LEFT JOIN users p ON r.passenger_id = p.id
        WHERE r.id = $1
    `;

    try {
        const res = await pool.query(query, [rideId]);
        return res.rows[0];
    } catch (e) {
        logError('DB_FETCH_RIDE', e);
        return null;
    }
}

/**
 * Função para buscar dados completos do usuário, incluindo configurações e status.
 */
async function getUserFullDetails(userId) {
    const query = `
        SELECT id, name, email, phone, photo, role, balance, bonus_points,
               vehicle_details, bi_front, bi_back, is_online, rating,
               fcm_token, created_at,
               settings, privacy_settings, notification_preferences,
               wallet_account_number, wallet_status, daily_limit, account_tier,
               wallet_pin_hash IS NOT NULL as has_pin,
               is_verified, is_blocked
        FROM users
        WHERE id = $1
    `;

    try {
        const res = await pool.query(query, [userId]);
        return res.rows[0];
    } catch (e) {
        logError('USER_FETCH', e);
        return null;
    }
}

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