/**
 * =================================================================================================
 * 💬 AOTRAVEL SERVER PRO - CHAT CONTROLLER
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/chatController.js
 * DESCRIÇÃO: Controlador responsável pelo histórico de mensagens.
 *            A lógica de envio em tempo real é gerenciada pelo SocketService,
 *            mas este endpoint permite recuperar o histórico ao abrir a tela.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const { logError } = require('../utils/helpers');

/**
 * GET CHAT HISTORY
 * Rota: GET /api/chat/:ride_id
 * Retorna: Lista de mensagens ordenadas por data.
 * Segurança: Apenas participantes da corrida ou administradores podem acessar.
 */
exports.getChatHistory = async (req, res) => {
    const { ride_id } = req.params;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    try {
        // 1. Verificação de Segurança (Access Control)
        // Verifica se o usuário logado é o passageiro, motorista ou admin.
        const rideCheck = await pool.query(
            'SELECT passenger_id, driver_id FROM rides WHERE id = $1',
            [ride_id]
        );

        if (rideCheck.rows.length === 0) {
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideCheck.rows[0];
        const isParticipant = (req.user.id === ride.passenger_id) || (req.user.id === ride.driver_id);
        const isAdmin = req.user.role === 'admin';

        if (!isParticipant && !isAdmin) {
            return res.status(403).json({ error: "Acesso negado ao histórico deste chat." });
        }

        // 2. Busca de Mensagens com Dados do Remetente
        // Realiza um JOIN para trazer nome e foto, facilitando a exibição no Frontend.
        const messages = await pool.query(
            `SELECT
                cm.id, cm.ride_id, cm.sender_id, cm.text, cm.image_url,
                cm.is_read, cm.created_at, cm.read_at,
                u.name as sender_name, u.photo as sender_photo
             FROM chat_messages cm
             JOIN users u ON cm.sender_id = u.id
             WHERE cm.ride_id = $1
             ORDER BY cm.created_at ASC`,
            [ride_id]
        );

        // 3. Marcar mensagens como lidas (se o visualizador não for o remetente)
        // Isso é opcional em GET, mas útil para limpar contadores de notificação.
        // Executado em background para não bloquear a resposta.
        if (isParticipant) {
            pool.query(
                `UPDATE chat_messages SET is_read = true, read_at = NOW()
                 WHERE ride_id = $1 AND sender_id != $2 AND is_read = false`,
                [ride_id, req.user.id]
            ).catch(err => console.error("Erro ao marcar mensagens como lidas:", err));
        }

        res.json(messages.rows);

    } catch (e) {
        logError('CHAT_HISTORY_ERROR', e);
        res.status(500).json({ error: "Erro ao buscar histórico de mensagens." });
    }
};