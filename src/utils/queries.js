const pool = require('../config/db');
const { logError } = require('./logger');

// Função SQL Robusta para buscar dados completos da corrida
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
        logError('DB_FETCH', e);
        return null;
    }
}

async function getUserFullDetails(userId) {
    const query = `
        SELECT id, name, email, phone, photo, role,
               COALESCE(balance, 0)::FLOAT as balance,
               COALESCE(bonus_points, 0) as bonus_points,
               COALESCE(vehicle_details, '{}'::jsonb) as vehicle_details,
               bi_front, bi_back, is_online, rating,
               fcm_token, created_at,
               COALESCE(settings, '{}'::jsonb) as settings
        FROM users
        WHERE id = $1
    `;
    try {
        const res = await pool.query(query, [userId]);
        return res.rows[0];
    } catch (e) {
        console.error('❌ [USER_FETCH] ERRO:', e.message);
        return null;
    }
}

module.exports = { getFullRideDetails, getUserFullDetails };