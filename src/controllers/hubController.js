/**
 * =================================================================================================
 * 🧠 AOTRAVEL SERVER PRO - SMART HUB CONTROLLER (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/hubController.js
 * DESCRIÇÃO: Controlador mestre para Agendamentos, Viagens em Grupo e Logística (Entregas).
 *            Integração ACID com Banco de Dados e Eventos WebSocket.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const { generateCode, logError, logSystem } = require('../utils/helpers');

// =================================================================================================
// 📅 MÓDULO 1: AGENDAMENTO DE VIAGEM (SCHEDULED RIDES)
// =================================================================================================

exports.scheduleRide = async (req, res) => {
    const { origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, proposed_price, date, time } = req.body;
    const passengerId = req.user.id;
    const chatRoomId = `schedule_${generateCode(8)}`;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO scheduled_rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, proposed_price, scheduled_date, scheduled_time, chat_room_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *
        `;

        const result = await client.query(insertQuery, [
            passengerId, origin_lat, origin_lng, dest_lat, dest_lng,
            origin_name, dest_name, proposed_price, date, time, chatRoomId
        ]);

        await client.query('COMMIT');

        // Notifica Motoristas Disponíveis Globalmente
        if (req.io) req.io.to('drivers').emit('new_scheduled_ride', result.rows[0]);

        res.status(201).json({ success: true, mission: result.rows[0] });
    } catch (e) {
        await client.query('ROLLBACK');
        logError('SCHEDULE_RIDE', e);
        res.status(500).json({ error: "Erro ao agendar viagem." });
    } finally {
        client.release();
    }
};

exports.getScheduledHistory = async (req, res) => {
    try {
        const query = `
            SELECT s.*, d.name as driver_name, d.photo as driver_photo
            FROM scheduled_rides s
            LEFT JOIN users d ON s.driver_id = d.id
            WHERE s.passenger_id = $1 OR s.driver_id = $1
            ORDER BY s.scheduled_date DESC, s.scheduled_time DESC
        `;
        const result = await pool.query(query, [req.user.id]);
        res.json({ success: true, history: result.rows });
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar agendamentos." });
    }
};

// =================================================================================================
// 👥 MÓDULO 2: VIAGEM EM GRUPO (CARPOOLING)
// =================================================================================================

exports.createGroupRide = async (req, res) => {
    const { origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, departure_time, price_per_seat, total_seats } = req.body;
    const creatorId = req.user.id;
    const chatRoomId = `group_${generateCode(8)}`;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO group_rides (
                creator_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name,
                departure_time, price_per_seat, total_seats, available_seats, chat_room_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11) RETURNING *
        `;

        const result = await client.query(insertQuery, [
            creatorId, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name,
            departure_time, price_per_seat, total_seats, chatRoomId
        ]);

        // Criador automaticamente entra no grupo
        await client.query(
            `INSERT INTO group_ride_passengers (group_ride_id, passenger_id) VALUES ($1, $2)`,
            [result.rows[0].id, creatorId]
        );

        await client.query(`UPDATE group_rides SET available_seats = available_seats - 1 WHERE id = $1`, [result.rows[0].id]);

        await client.query('COMMIT');

        // Broadcast local para outros passageiros
        if (req.io) req.io.emit('new_group_ride', result.rows[0]);

        res.status(201).json({ success: true, group: result.rows[0] });
    } catch (e) {
        await client.query('ROLLBACK');
        logError('CREATE_GROUP_RIDE', e);
        res.status(500).json({ error: "Erro ao criar viagem em grupo." });
    } finally {
        client.release();
    }
};

exports.getGroupHistory = async (req, res) => {
    try {
        const query = `
            SELECT g.*
            FROM group_rides g
            JOIN group_ride_passengers gp ON g.id = gp.group_ride_id
            WHERE gp.passenger_id = $1 OR g.driver_id = $1
            ORDER BY g.created_at DESC
        `;
        const result = await pool.query(query, [req.user.id]);
        res.json({ success: true, history: result.rows });
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar histórico de grupos." });
    }
};

// =================================================================================================
// 📦 MÓDULO 3: ENTREGAS COM RASTREIO REAL (DELIVERY)
// =================================================================================================

exports.createDelivery = async (req, res) => {
    const { origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, receiver_name, receiver_phone, package_details, weight_category, price } = req.body;
    const senderId = req.user.id;
    const trackingCode = `AOT-${generateCode(10)}`;
    const chatRoomId = `delivery_${generateCode(8)}`;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertQuery = `
            INSERT INTO deliveries (
                sender_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name,
                receiver_name, receiver_phone, package_details, weight_category, price, tracking_code, chat_room_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *
        `;

        const result = await client.query(insertQuery, [
            senderId, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name,
            receiver_name, receiver_phone, package_details, weight_category, price, trackingCode, chatRoomId
        ]);

        await client.query('COMMIT');

        if (req.io) req.io.to('drivers').emit('new_delivery_mission', result.rows[0]);

        res.status(201).json({ success: true, delivery: result.rows[0] });
    } catch (e) {
        await client.query('ROLLBACK');
        logError('CREATE_DELIVERY', e);
        res.status(500).json({ error: "Erro ao criar envio de pacote." });
    } finally {
        client.release();
    }
};

exports.getDeliveryHistory = async (req, res) => {
    try {
        const query = `
            SELECT * FROM deliveries
            WHERE sender_id = $1 OR driver_id = $1
            ORDER BY created_at DESC
        `;
        const result = await pool.query(query, [req.user.id]);
        res.json({ success: true, history: result.rows });
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar histórico de entregas." });
    }
};