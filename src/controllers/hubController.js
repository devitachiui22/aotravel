/**
 * =================================================================================================
 * 🎯 AOTRAVEL SERVER PRO - HUB CONTROLLER (TITANIUM PREMIUM)
 * =================================================================================================
 * DESCRIÇÃO: Controlador centralizado para Agendamentos, Viagens em Grupo e Entregas.
 * STATUS: PRODUCTION READY - FULL FILE - TODAS AS FUNCIONALIDADES IMPLEMENTADAS
 * =================================================================================================
 */

const pool = require('../config/db');

// =================================================================================================
// 📅 1. MÓDULO DE AGENDAMENTO (SCHEDULES)
// =================================================================================================

/**
 * Criar um novo agendamento (passageiro)
 */
exports.createSchedule = async (req, res) => {
    const { origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, scheduled_time, proposed_price } = req.body;
    const userId = req.user.id;

    if (proposed_price < 2000) return res.status(400).json({ error: "O valor mínimo para agendamento é 2000 Kz." });

    try {
        const result = await pool.query(
            `INSERT INTO hub_schedules
            (passenger_id, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, scheduled_time, proposed_price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [userId, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, scheduled_time, proposed_price]
        );

        const schedule = result.rows[0];

        // Emitir para os motoristas no Socket
        if (req.io) req.io.to('drivers').emit('hub_new_schedule', schedule);

        res.status(201).json({ success: true, data: schedule });
    } catch (e) {
        console.error('❌ Erro ao criar agendamento:', e);
        res.status(500).json({ error: "Erro ao criar agendamento." });
    }
};

/**
 * Listar agendamentos (passageiro vê seus agendamentos, motorista vê pendentes + seus)
 */
exports.getSchedules = async (req, res) => {
    const userId = req.user.id;
    const role = req.user.role;

    try {
        let query;
        let params;

        if (role === 'driver') {
            query = "SELECT * FROM hub_schedules WHERE driver_id = $1 OR status = 'pending' ORDER BY scheduled_time ASC";
            params = [userId];
        } else {
            query = "SELECT * FROM hub_schedules WHERE passenger_id = $1 ORDER BY scheduled_time ASC";
            params = [userId];
        }

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('❌ Erro ao buscar agendamentos:', e);
        res.status(500).json({ error: "Erro ao buscar agendamentos." });
    }
};

/**
 * Aceitar um agendamento (motorista)
 */
exports.acceptSchedule = async (req, res) => {
    const { scheduleId } = req.params;
    const driverId = req.user.id;

    try {
        const result = await pool.query(
            `UPDATE hub_schedules SET driver_id = $1, status = 'accepted', updated_at = NOW()
             WHERE id = $2 AND status = 'pending' RETURNING *`,
            [driverId, scheduleId]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Agendamento não disponível ou já aceito." });
        }

        const schedule = result.rows[0];

        // Notificar o passageiro
        if (req.io) req.io.to(`user_${schedule.passenger_id}`).emit('hub_schedule_accepted', schedule);

        res.json({ success: true, data: schedule });
    } catch (e) {
        console.error('❌ Erro ao aceitar agendamento:', e);
        res.status(500).json({ error: "Erro ao aceitar agendamento." });
    }
};

/**
 * Cancelar um agendamento (passageiro ou motorista)
 */
exports.cancelSchedule = async (req, res) => {
    const { scheduleId } = req.params;
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `UPDATE hub_schedules SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2) RETURNING *`,
            [scheduleId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Agendamento não encontrado ou não autorizado." });
        }

        const schedule = result.rows[0];

        // Notificar a outra parte
        const notifyUserId = schedule.passenger_id === userId ? schedule.driver_id : schedule.passenger_id;
        if (req.io && notifyUserId) {
            req.io.to(`user_${notifyUserId}`).emit('hub_schedule_cancelled', schedule);
        }

        res.json({ success: true, data: schedule });
    } catch (e) {
        console.error('❌ Erro ao cancelar agendamento:', e);
        res.status(500).json({ error: "Erro ao cancelar agendamento." });
    }
};

// =================================================================================================
// 👥 2. MÓDULO DE VIAGEM EM GRUPO (GROUP RIDES)
// =================================================================================================

/**
 * Criar uma nova viagem em grupo (passageiro)
 */
exports.createGroupRide = async (req, res) => {
    const { origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, departure_time, price_per_seat, total_seats } = req.body;
    const userId = req.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(
            `INSERT INTO hub_groups
            (creator_id, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, departure_time, price_per_seat, total_seats, available_seats)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [userId, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, departure_time, price_per_seat, total_seats, total_seats - 1]
        );

        const group = result.rows[0];

        // Criador entra no grupo automaticamente
        await client.query(
            `INSERT INTO hub_group_participants (group_id, user_id) VALUES ($1, $2)`,
            [group.id, userId]
        );

        await client.query('COMMIT');

        // Notificar todos (motoristas e passageiros)
        if (req.io) req.io.emit('hub_group_created', group);

        res.status(201).json({ success: true, data: group });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Erro ao criar grupo:', e);
        res.status(500).json({ error: "Erro ao criar grupo." });
    } finally {
        client.release();
    }
};

/**
 * Entrar em uma viagem em grupo (passageiro)
 */
exports.joinGroupRide = async (req, res) => {
    const { groupId } = req.params;
    const userId = req.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Bloquear a linha para evitar race conditions
        const groupRes = await client.query(
            "SELECT available_seats, status, total_seats, creator_id FROM hub_groups WHERE id = $1 FOR UPDATE",
            [groupId]
        );

        if (groupRes.rows.length === 0) throw new Error("Grupo não encontrado.");

        const group = groupRes.rows[0];

        // Verificar se o grupo está disponível
        if (group.status !== 'gathering') throw new Error("Grupo não está mais aceitando participantes.");
        if (group.available_seats <= 0) throw new Error("Grupo lotado.");

        // Verificar se o usuário já está no grupo
        const participantCheck = await client.query(
            "SELECT * FROM hub_group_participants WHERE group_id = $1 AND user_id = $2",
            [groupId, userId]
        );

        if (participantCheck.rows.length > 0) throw new Error("Você já está neste grupo.");

        // Adicionar participante
        await client.query(
            "INSERT INTO hub_group_participants (group_id, user_id) VALUES ($1, $2)",
            [groupId, userId]
        );

        const newAvailable = group.available_seats - 1;
        const newStatus = newAvailable === 0 ? 'full' : 'gathering';

        // Atualizar vagas disponíveis
        await client.query(
            "UPDATE hub_groups SET available_seats = $1, status = $2 WHERE id = $3",
            [newAvailable, newStatus, groupId]
        );

        await client.query('COMMIT');

        // Notificar via Socket (atualização em tempo real)
        if (req.io) {
            req.io.emit('hub_group_updated', {
                group_id: groupId,
                available_seats: newAvailable,
                status: newStatus
            });

            // Se o grupo lotou, notificar motoristas
            if (newStatus === 'full') {
                req.io.to('drivers').emit('hub_group_ready', {
                    group_id: groupId,
                    group_data: group
                });
            }
        }

        res.json({
            success: true,
            message: "Entrou no grupo com sucesso.",
            data: { available_seats: newAvailable, status: newStatus }
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Erro ao entrar no grupo:', e);
        res.status(400).json({ error: e.message });
    } finally {
        client.release();
    }
};

/**
 * Listar grupos disponíveis
 */
exports.getGroups = async (req, res) => {
    const userId = req.user.id;
    const role = req.user.role;

    try {
        let query;
        let params;

        if (role === 'driver') {
            // Motorista vê grupos lotados ou que já aceitou
            query = `
                SELECT g.*,
                       (SELECT COUNT(*) FROM hub_group_participants WHERE group_id = g.id) as participants_count
                FROM hub_groups g
                WHERE g.status = 'full' OR g.driver_id = $1
                ORDER BY g.departure_time ASC
            `;
            params = [userId];
        } else {
            // Passageiro vê todos os grupos em formação
            query = `
                SELECT g.*,
                       (SELECT COUNT(*) FROM hub_group_participants WHERE group_id = g.id) as participants_count,
                       CASE WHEN p.user_id IS NOT NULL THEN true ELSE false END as is_participant
                FROM hub_groups g
                LEFT JOIN hub_group_participants p ON p.group_id = g.id AND p.user_id = $1
                WHERE g.status IN ('gathering', 'full')
                ORDER BY g.departure_time ASC
            `;
            params = [userId];
        }

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('❌ Erro ao buscar grupos:', e);
        res.status(500).json({ error: "Erro ao buscar grupos." });
    }
};

/**
 * Motorista aceita levar um grupo lotado
 */
exports.acceptGroup = async (req, res) => {
    const { groupId } = req.params;
    const driverId = req.user.id;

    try {
        const result = await pool.query(
            `UPDATE hub_groups
             SET driver_id = $1, status = 'active', updated_at = NOW()
             WHERE id = $2 AND status = 'full' AND driver_id IS NULL
             RETURNING *`,
            [driverId, groupId]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Grupo não disponível ou já aceito por outro motorista." });
        }

        const group = result.rows[0];

        // Notificar todos os participantes
        if (req.io) {
            // Buscar todos os participantes
            const participants = await pool.query(
                "SELECT user_id FROM hub_group_participants WHERE group_id = $1",
                [groupId]
            );

            participants.rows.forEach(p => {
                req.io.to(`user_${p.user_id}`).emit('hub_group_accepted', group);
            });
        }

        res.json({ success: true, data: group });
    } catch (e) {
        console.error('❌ Erro ao aceitar grupo:', e);
        res.status(500).json({ error: "Erro ao aceitar grupo." });
    }
};

/**
 * Sair de um grupo (passageiro)
 */
exports.leaveGroup = async (req, res) => {
    const { groupId } = req.params;
    const userId = req.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verificar se o usuário é o criador (não pode sair, apenas cancelar o grupo)
        const groupCheck = await client.query(
            "SELECT creator_id, status, available_seats FROM hub_groups WHERE id = $1 FOR UPDATE",
            [groupId]
        );

        if (groupCheck.rows.length === 0) throw new Error("Grupo não encontrado.");

        const group = groupCheck.rows[0];

        if (group.creator_id === userId) {
            throw new Error("O criador não pode sair do grupo. Cancele o grupo se desejar.");
        }

        // Remover participante
        const result = await client.query(
            "DELETE FROM hub_group_participants WHERE group_id = $1 AND user_id = $2 RETURNING *",
            [groupId, userId]
        );

        if (result.rows.length === 0) throw new Error("Você não está neste grupo.");

        // Atualizar vagas disponíveis
        const newAvailable = group.available_seats + 1;
        const newStatus = 'gathering';

        await client.query(
            "UPDATE hub_groups SET available_seats = $1, status = $2 WHERE id = $3",
            [newAvailable, newStatus, groupId]
        );

        await client.query('COMMIT');

        if (req.io) {
            req.io.emit('hub_group_updated', {
                group_id: groupId,
                available_seats: newAvailable,
                status: newStatus
            });
        }

        res.json({ success: true, message: "Saída do grupo realizada com sucesso." });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Erro ao sair do grupo:', e);
        res.status(400).json({ error: e.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 📦 3. MÓDULO DE ENTREGAS (DELIVERIES)
// =================================================================================================

/**
 * Criar uma nova entrega (passageiro)
 */
exports.createDelivery = async (req, res) => {
    const {
        pickup_name, pickup_lat, pickup_lng,
        dropoff_name, dropoff_lat, dropoff_lng,
        recipient_name, recipient_phone, package_details, price
    } = req.body;

    const userId = req.user.id;

    try {
        const result = await pool.query(
            `INSERT INTO hub_deliveries
            (sender_id, pickup_name, pickup_lat, pickup_lng, dropoff_name, dropoff_lat, dropoff_lng,
             recipient_name, recipient_phone, package_details, price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [userId, pickup_name, pickup_lat, pickup_lng, dropoff_name, dropoff_lat, dropoff_lng,
             recipient_name, recipient_phone, package_details, price]
        );

        const delivery = result.rows[0];

        // Notificar motoristas
        if (req.io) req.io.to('drivers').emit('hub_new_delivery', delivery);

        res.status(201).json({ success: true, data: delivery });
    } catch (e) {
        console.error('❌ Erro ao criar entrega:', e);
        res.status(500).json({ error: "Erro ao criar entrega." });
    }
};

/**
 * Listar entregas (passageiro vê suas entregas, motorista vê disponíveis + suas)
 */
exports.getDeliveries = async (req, res) => {
    const userId = req.user.id;
    const role = req.user.role;

    try {
        let query;
        let params;

        if (role === 'driver') {
            query = `
                SELECT * FROM hub_deliveries
                WHERE status = 'searching' OR driver_id = $1
                ORDER BY
                    CASE WHEN status = 'searching' THEN 0 ELSE 1 END,
                    created_at DESC
            `;
            params = [userId];
        } else {
            query = "SELECT * FROM hub_deliveries WHERE sender_id = $1 ORDER BY created_at DESC";
            params = [userId];
        }

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('❌ Erro ao buscar entregas:', e);
        res.status(500).json({ error: "Erro ao buscar entregas." });
    }
};

/**
 * Aceitar uma entrega (motorista)
 */
exports.acceptDelivery = async (req, res) => {
    const { deliveryId } = req.params;
    const driverId = req.user.id;

    try {
        const result = await pool.query(
            `UPDATE hub_deliveries
             SET driver_id = $1, status = 'accepted', updated_at = NOW()
             WHERE id = $2 AND status = 'searching'
             RETURNING *`,
            [driverId, deliveryId]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Entrega não disponível ou já aceita por outro motorista." });
        }

        const delivery = result.rows[0];

        // Notificar o remetente
        if (req.io) {
            req.io.to(`user_${delivery.sender_id}`).emit('hub_delivery_accepted', delivery);
        }

        res.json({ success: true, data: delivery });
    } catch (e) {
        console.error('❌ Erro ao aceitar entrega:', e);
        res.status(500).json({ error: "Erro ao aceitar entrega." });
    }
};

/**
 * Atualizar status da entrega (motorista)
 */
exports.updateDeliveryStatus = async (req, res) => {
    const { deliveryId } = req.params;
    const { status, lat, lng } = req.body; // status: picked_up, in_transit, delivered
    const driverId = req.user.id;

    // Validar status permitidos
    const allowedStatuses = ['picked_up', 'in_transit', 'delivered'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: "Status inválido." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Atualizar status da entrega
        const result = await client.query(
            `UPDATE hub_deliveries
             SET status = $1, updated_at = NOW()
             WHERE id = $2 AND driver_id = $3
             RETURNING *`,
            [status, deliveryId, driverId]
        );

        if (result.rows.length === 0) {
            throw new Error("Entrega não encontrada ou não autorizada.");
        }

        const delivery = result.rows[0];

        // Se veio localização, registrar no tracking
        if (lat && lng) {
            await client.query(
                `INSERT INTO hub_delivery_tracking (delivery_id, lat, lng, status_at_time)
                 VALUES ($1, $2, $3, $4)`,
                [deliveryId, lat, lng, status]
            );
        }

        await client.query('COMMIT');

        // Notificar o remetente
        if (req.io) {
            req.io.to(`user_${delivery.sender_id}`).emit('hub_delivery_update', {
                delivery_id: deliveryId,
                status,
                lat,
                lng,
                updated_at: new Date()
            });
        }

        res.json({ success: true, data: delivery });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Erro ao atualizar status da entrega:', e);
        res.status(500).json({ error: e.message || "Erro ao atualizar status." });
    } finally {
        client.release();
    }
};

/**
 * Cancelar uma entrega (remetente ou motorista)
 */
exports.cancelDelivery = async (req, res) => {
    const { deliveryId } = req.params;
    const userId = req.user.id;

    try {
        // Verificar se a entrega pode ser cancelada (status inicial)
        const checkResult = await pool.query(
            "SELECT status, sender_id, driver_id FROM hub_deliveries WHERE id = $1",
            [deliveryId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: "Entrega não encontrada." });
        }

        const delivery = checkResult.rows[0];

        // Só pode cancelar se estiver em 'searching' ou 'accepted'
        if (!['searching', 'accepted'].includes(delivery.status)) {
            return res.status(400).json({ error: "Não é possível cancelar esta entrega neste momento." });
        }

        // Verificar permissão
        if (delivery.sender_id !== userId && delivery.driver_id !== userId) {
            return res.status(403).json({ error: "Sem permissão para cancelar esta entrega." });
        }

        const result = await pool.query(
            `UPDATE hub_deliveries
             SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [deliveryId]
        );

        const cancelledDelivery = result.rows[0];

        // Notificar as partes envolvidas
        if (req.io) {
            if (delivery.sender_id === userId && delivery.driver_id) {
                req.io.to(`user_${delivery.driver_id}`).emit('hub_delivery_cancelled', cancelledDelivery);
            } else if (delivery.driver_id === userId) {
                req.io.to(`user_${delivery.sender_id}`).emit('hub_delivery_cancelled', cancelledDelivery);
            }
        }

        res.json({ success: true, data: cancelledDelivery });
    } catch (e) {
        console.error('❌ Erro ao cancelar entrega:', e);
        res.status(500).json({ error: "Erro ao cancelar entrega." });
    }
};

/**
 * Obter histórico de rastreio de uma entrega
 */
exports.getDeliveryTracking = async (req, res) => {
    const { deliveryId } = req.params;
    const userId = req.user.id;

    try {
        // Verificar se o usuário tem permissão (remetente ou motorista)
        const checkResult = await pool.query(
            "SELECT sender_id, driver_id FROM hub_deliveries WHERE id = $1",
            [deliveryId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: "Entrega não encontrada." });
        }

        const delivery = checkResult.rows[0];

        if (delivery.sender_id !== userId && delivery.driver_id !== userId) {
            return res.status(403).json({ error: "Sem permissão para acessar este rastreio." });
        }

        const result = await pool.query(
            "SELECT * FROM hub_delivery_tracking WHERE delivery_id = $1 ORDER BY recorded_at ASC",
            [deliveryId]
        );

        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('❌ Erro ao buscar tracking:', e);
        res.status(500).json({ error: "Erro ao buscar histórico de rastreio." });
    }
};
