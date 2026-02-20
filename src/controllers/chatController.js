/**
 * =================================================================================================
 * 💬 AOTRAVEL SERVER PRO - CHAT CONTROLLER (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/chatController.js
 * DESCRIÇÃO: Controlador responsável pela persistência e recuperação do histórico de comunicação.
 *            Garante que o histórico seja recuperável, auditável e que o estado de leitura
 *            (Read Receipts) seja gerido de forma atômica no banco de dados.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const { logError, logSystem } = require('../utils/helpers');

// =================================================================================================
// 0. HELPERS PRIVADOS (SECURITY)
// =================================================================================================

/**
 * Verifica se o usuário tem permissão para acessar o chat da corrida.
 * Previne que usuários tentem ler chats de corridas que não lhes pertencem.
 */
async function checkChatAccess(client, rideId, userId, userRole) {
    // Admins têm acesso de auditoria irrestrito
    if (userRole === 'admin') return true;

    const query = 'SELECT passenger_id, driver_id FROM rides WHERE id = $1';
    const result = await client.query(query,);

    if (result.rows.length === 0) return false;

    const ride = result.rows;
    return (ride.passenger_id === userId || ride.driver_id === userId);
}

// =================================================================================================
// 1. RECUPERAÇÃO DE HISTÓRICO (CORE)
// =================================================================================================

exports.getChatHistory = async (req, res) => {
    const { ride_id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Verificação de Acesso (Security Check)
        const hasAccess = await checkChatAccess(client, ride_id, userId, userRole);

        if (!hasAccess) {
            await client.query('ROLLBACK');
            logSystem('CHAT_ACCESS_DENIED', `User ${userId} tentou espionar o chat da corrida ${ride_id}.`);
            return res.status(403).json({
                error: "Acesso negado. Você não é participante desta corrida.",
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
                u.name as sender_name,
                u.photo as sender_photo,
                u.role as sender_role
            FROM chat_messages cm
            JOIN users u ON cm.sender_id = u.id
            WHERE cm.ride_id = $1
            ORDER BY cm.created_at ASC
        `;

        const result = await client.query(query,);
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

    if (!ride_id) return res.status(400).json({ error: "Ride ID necessário." });

    try {
        const result = await pool.query(
            `UPDATE chat_messages
             SET is_read = true, read_at = NOW()
             WHERE ride_id = $1
               AND sender_id != $2
               AND is_read = false
             RETURNING id`,
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

exports.getUnreadCount = async (req, res) => {
    const userId = req.user.id;

    try {
        // Conta mensagens onde:
        // 1. O usuário é participante da corrida
        // 2. A mensagem NÃO foi enviada por ele
        // 3. is_read é false
        const query = `
            SELECT COUNT(*) as unread_total
            FROM chat_messages cm
            JOIN rides r ON cm.ride_id = r.id
            WHERE (r.passenger_id = $1 OR r.driver_id = $1)
              AND cm.sender_id != $1
              AND cm.is_read = false
        `;

        const result = await pool.query(query,);
        const total = parseInt(result.rows.unread_total);

        res.json({
            success: true,
            unread_count: total
        });

    } catch (e) {
        logError('CHAT_UNREAD_COUNT', e);
        res.status(500).json({ error: "Erro ao buscar contagem de mensagens." });
    }
};

module.exports = exports;