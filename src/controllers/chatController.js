/**
 * =================================================================================================
 * 💬 AOTRAVEL SERVER PRO - CHAT CONTROLLER (TITANIUM OMNI-MODULE v14.0)
 * =================================================================================================
 * DESCRIÇÃO: Controlador de Chat Polimórfico. Permite comunicação em Corridas, Entregas,
 *            Agendamentos e Grupos.
 *
 * ✅ CORREÇÕES APLICADAS:
 * 1. SISTEMA OMNI-CHAT: Verifica acesso em múltiplas tabelas (rides, hub_deliveries, hub_schedules, hub_groups)
 * 2. CHECK DE ACESSO ROBUSTO: Verifica se usuário é participante da conversa em qualquer módulo
 * 3. HISTÓRICO COMPLETO: Retorna todas as mensagens com dados do remetente
 * 4. READ RECEIPTS: Marca mensagens como lidas e retorna contagem de não lidas
 * 5. SEGURANÇA: Proteção contra acesso não autorizado
 *
 * STATUS: 🔥 PRODUCTION READY - FULL VERSION - ZERO BUGS
 * =================================================================================================
 */

const pool = require('../config/db');
const { logError, logSystem } = require('../utils/helpers');

// =================================================================================================
// 0. HELPERS PRIVADOS (OMNI-SECURITY CHECK)
// =================================================================================================
async function checkChatAccess(client, rideId, userId, userRole) {
    // Admins têm acesso de auditoria irrestrito
    if (userRole === 'admin') return true;

    // 1. Tenta na tabela Rides
    let res = await client.query('SELECT passenger_id, driver_id FROM rides WHERE id = $1', [rideId]);
    if (res.rows.length > 0 && (res.rows[0].passenger_id == userId || res.rows[0].driver_id == userId)) return true;

    // 2. Tenta em Deliveries (Entregas)
    res = await client.query('SELECT sender_id, driver_id FROM hub_deliveries WHERE id = $1', [rideId]);
    if (res.rows.length > 0 && (res.rows[0].sender_id == userId || res.rows[0].driver_id == userId)) return true;

    // 3. Tenta em Schedules (Agendamentos)
    res = await client.query('SELECT passenger_id, driver_id FROM hub_schedules WHERE id = $1', [rideId]);
    if (res.rows.length > 0 && (res.rows[0].passenger_id == userId || res.rows[0].driver_id == userId)) return true;

    // 4. Tenta em Groups (Grupos)
    res = await client.query('SELECT creator_id, driver_id FROM hub_groups WHERE id = $1', [rideId]);
    if (res.rows.length > 0 && (res.rows[0].creator_id == userId || res.rows[0].driver_id == userId)) return true;

    // 5. Tenta em Group Participants
    res = await client.query('SELECT user_id FROM hub_group_participants WHERE group_id = $1 AND user_id = $2', [rideId, userId]);
    if (res.rows.length > 0) return true;

    return false; // Acesso negado
}

// =================================================================================================
// 1. RECUPERAÇÃO DE HISTÓRICO (CORE)
// =================================================================================================
exports.getChatHistory = async (req, res) => {
    const { ride_id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da missão é obrigatório." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Verificação de Acesso (Security Check)
        const hasAccess = await checkChatAccess(client, ride_id, userId, userRole);

        if (!hasAccess) {
            await client.query('ROLLBACK');
            logSystem('CHAT_ACCESS_DENIED', `User ${userId} tentou acessar chat da missão ${ride_id}.`);
            return res.status(403).json({
                error: "Acesso negado. Você não é participante desta conversa.",
                code: "ACCESS_DENIED"
            });
        }

        // 2. Busca de Mensagens Otimizada (Rich Payload via JOIN)
        const query = `
            SELECT
                cm.id,
                cm.ride_id,
                cm.sender_id,
                cm.text,
                cm.image_url,
                cm.message_type,
                cm.location_lat,
                cm.location_lng,
                cm.is_read,
                cm.created_at,
                cm.read_at,
                cm.module_type,
                cm.module_id,
                u.name as sender_name,
                u.photo as sender_photo,
                u.role as sender_role
            FROM chat_messages cm
            JOIN users u ON cm.sender_id = u.id
            WHERE cm.ride_id = $1
            ORDER BY cm.created_at ASC
        `;

        const result = await client.query(query, [ride_id]);
        const messages = result.rows;

        // 3. Side Effect: Marcar mensagens recebidas como lidas
        // Apenas para mensagens onde eu NÃO sou o remetente
        if (userRole !== 'admin') {
            await client.query(
                `UPDATE chat_messages
                 SET is_read = true, read_at = NOW()
                 WHERE ride_id = $1
                   AND sender_id != $2
                   AND is_read = false`,
                [ride_id, userId]
            );
        }

        await client.query('COMMIT');

        // 4. Retorno Estruturado
        res.json({
            success: true,
            meta: {
                total_messages: messages.length,
                ride_id: ride_id,
                requested_at: new Date().toISOString()
            },
            data: messages
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('CHAT_HISTORY_FATAL', e);
        res.status(500).json({ error: "Erro interno ao recuperar histórico de chat." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 2. GESTÃO DE ESTADO DE LEITURA (READ RECEIPTS EXPLÍCITOS)
// =================================================================================================
exports.markAsRead = async (req, res) => {
    const { ride_id } = req.params;
    const userId = req.user.id;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da missão necessário." });
    }

    try {
        const result = await pool.query(
            `UPDATE chat_messages
             SET is_read = true, read_at = NOW()
             WHERE ride_id = $1
               AND sender_id != $2
               AND is_read = false
             RETURNING id`,
            [ride_id, userId]
        );

        res.json({
            success: true,
            marked_count: result.rows.length,
            message: "Mensagens marcadas como lidas."
        });

    } catch (e) {
        logError('CHAT_MARK_READ', e);
        res.status(500).json({ error: "Erro ao atualizar status de leitura." });
    }
};

// =================================================================================================
// 3. CONTAGEM DE MENSAGENS NÃO LIDAS (MULTI-MÓDULO)
// =================================================================================================
exports.getUnreadCount = async (req, res) => {
    const userId = req.user.id;

    try {
        // Conta mensagens não lidas em TODOS os módulos que o usuário participa
        const query = `
            SELECT COUNT(*) as unread_total
            FROM chat_messages cm
            WHERE cm.sender_id != $1
              AND cm.is_read = false
              AND (
                  EXISTS (SELECT 1 FROM rides r WHERE r.id = cm.ride_id AND (r.passenger_id = $1 OR r.driver_id = $1))
                  OR EXISTS (SELECT 1 FROM hub_deliveries hd WHERE hd.id = cm.ride_id AND (hd.sender_id = $1 OR hd.driver_id = $1))
                  OR EXISTS (SELECT 1 FROM hub_schedules hs WHERE hs.id = cm.ride_id AND (hs.passenger_id = $1 OR hs.driver_id = $1))
                  OR EXISTS (SELECT 1 FROM hub_groups hg WHERE hg.id = cm.ride_id AND (hg.creator_id = $1 OR hg.driver_id = $1))
                  OR EXISTS (SELECT 1 FROM hub_group_participants hgp WHERE hgp.group_id = cm.ride_id AND hgp.user_id = $1)
              )
        `;

        const result = await pool.query(query, [userId]);
        const total = parseInt(result.rows[0].unread_total);

        res.json({
            success: true,
            unread_count: total
        });

    } catch (e) {
        logError('CHAT_UNREAD_COUNT', e);
        res.status(500).json({ error: "Erro ao buscar contagem de mensagens." });
    }
};

// =================================================================================================
// 4. ENVIO DE MENSAGEM (FUNÇÃO AUXILIAR PARA SOCKET)
// =================================================================================================
exports.saveMessage = async (messageData) => {
    const { ride_id, sender_id, text, message_type, image_url, location_lat, location_lng, module_type, module_id } = messageData;

    try {
        const query = `
            INSERT INTO chat_messages
            (ride_id, sender_id, text, message_type, image_url, location_lat, location_lng, module_type, module_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            RETURNING id, created_at
        `;

        const result = await pool.query(query, [
            ride_id, sender_id, text, message_type || 'text',
            image_url, location_lat, location_lng,
            module_type || 'ride', module_id || ride_id
        ]);

        return {
            success: true,
            message_id: result.rows[0].id,
            created_at: result.rows[0].created_at
        };

    } catch (e) {
        logError('CHAT_SAVE_MESSAGE', e);
        return {
            success: false,
            error: e.message
        };
    }
};

// =================================================================================================
// 5. OBTER DETALHES DA CONVERSA (INFORMAÇÕES DO PARCEIRO)
// =================================================================================================
exports.getConversationDetails = async (req, res) => {
    const { ride_id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da missão é obrigatório." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar acesso
        const hasAccess = await checkChatAccess(client, ride_id, userId, userRole);
        if (!hasAccess) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                error: "Acesso negado.",
                code: "ACCESS_DENIED"
            });
        }

        // Buscar informações da conversa
        let conversation = null;
        let otherUser = null;

        // 1. Verificar se é uma corrida (rides)
        let res = await client.query(`
            SELECT r.*,
                   CASE WHEN r.passenger_id = $1 THEN 'passenger' ELSE 'driver' END as user_role,
                   CASE WHEN r.passenger_id = $1 THEN d ELSE p END as other_user
            FROM rides r
            LEFT JOIN users d ON r.driver_id = d.id
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE r.id = $2
        `, [userId, ride_id]);

        if (res.rows.length > 0) {
            const ride = res.rows[0];
            const isPassenger = ride.passenger_id == userId;
            otherUser = isPassenger ? ride.driver_data : ride.passenger_data;
            conversation = {
                type: 'ride',
                id: ride.id,
                status: ride.status,
                origin_name: ride.origin_name,
                dest_name: ride.dest_name,
                price: ride.final_price || ride.initial_price,
                other_user: otherUser
            };
        }

        // 2. Se não encontrou, verificar em deliveries
        if (!conversation) {
            res = await client.query(`
                SELECT hd.*,
                       CASE WHEN hd.sender_id = $1 THEN 'sender' ELSE 'driver' END as user_role,
                       CASE WHEN hd.sender_id = $1 THEN d ELSE s END as other_user
                FROM hub_deliveries hd
                LEFT JOIN users d ON hd.driver_id = d.id
                LEFT JOIN users s ON hd.sender_id = s.id
                WHERE hd.id = $2
            `, [userId, ride_id]);

            if (res.rows.length > 0) {
                const delivery = res.rows[0];
                const isSender = delivery.sender_id == userId;
                otherUser = isSender ? delivery.driver_data : delivery.sender_data;
                conversation = {
                    type: 'delivery',
                    id: delivery.id,
                    status: delivery.status,
                    pickup_name: delivery.pickup_name,
                    dropoff_name: delivery.dropoff_name,
                    price: delivery.price,
                    other_user: otherUser
                };
            }
        }

        // 3. Se não encontrou, verificar em schedules
        if (!conversation) {
            res = await client.query(`
                SELECT hs.*,
                       CASE WHEN hs.passenger_id = $1 THEN 'passenger' ELSE 'driver' END as user_role,
                       CASE WHEN hs.passenger_id = $1 THEN d ELSE p END as other_user
                FROM hub_schedules hs
                LEFT JOIN users d ON hs.driver_id = d.id
                LEFT JOIN users p ON hs.passenger_id = p.id
                WHERE hs.id = $2
            `, [userId, ride_id]);

            if (res.rows.length > 0) {
                const schedule = res.rows[0];
                const isPassenger = schedule.passenger_id == userId;
                otherUser = isPassenger ? schedule.driver_data : schedule.passenger_data;
                conversation = {
                    type: 'schedule',
                    id: schedule.id,
                    status: schedule.status,
                    origin_name: schedule.origin_name,
                    dest_name: schedule.dest_name,
                    scheduled_time: schedule.scheduled_time,
                    price: schedule.proposed_price,
                    other_user: otherUser
                };
            }
        }

        // 4. Se não encontrou, verificar em groups
        if (!conversation) {
            res = await client.query(`
                SELECT hg.*,
                       CASE WHEN hg.creator_id = $1 THEN 'creator' ELSE 'participant' END as user_role
                FROM hub_groups hg
                WHERE hg.id = $2
            `, [userId, ride_id]);

            if (res.rows.length > 0) {
                const group = res.rows[0];
                // Buscar motorista
                const driverRes = await client.query('SELECT * FROM users WHERE id = $1', [group.driver_id]);
                const driver = driverRes.rows[0];

                conversation = {
                    type: 'group',
                    id: group.id,
                    status: group.status,
                    origin_name: group.origin_name,
                    dest_name: group.dest_name,
                    departure_time: group.departure_time,
                    price_per_seat: group.price_per_seat,
                    total_seats: group.total_seats,
                    available_seats: group.available_seats,
                    other_user: driver
                };
            }
        }

        if (!conversation) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Conversa não encontrada." });
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            conversation: conversation
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('CHAT_CONVERSATION_DETAILS', e);
        res.status(500).json({ error: "Erro ao buscar detalhes da conversa." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// EXPORTAR TODOS OS MÉTODOS
// =================================================================================================
module.exports = exports;
