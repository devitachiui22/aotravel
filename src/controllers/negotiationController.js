/**
 * =================================================================================================
 * 💬 AOTRAVEL SERVER PRO - NEGOTIATION CONTROLLER (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/negotiationController.js
 * DESCRIÇÃO: Controlador para negociação de preço entre passageiro e motorista.
 *            Permite que o motorista proponha um novo preço e o passageiro aceite/rejeite.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const { logSystem, logError, generateRef } = require('../utils/helpers');

/**
 * PROPOR NOVO PREÇO (Motorista)
 * Rota: POST /api/rides/:ride_id/negotiate/propose
 * Descrição: Motorista propõe um novo preço para a corrida.
 */
exports.proposePrice = async (req, res) => {
    const { ride_id } = req.params;
    const { proposed_price, reason } = req.body;
    const driverId = req.user.id;

    if (!proposed_price || proposed_price < 100) {
        return res.status(400).json({ error: "Preço proposto inválido." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar se a corrida existe e se o motorista é o responsável
        const rideRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (ride.driver_id !== driverId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Apenas o motorista responsável pode propor novo preço." });
        }

        if (ride.status !== 'accepted' && ride.status !== 'ongoing') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Não é possível negociar o preço nesta fase da corrida." });
        }

        // Registrar proposta no histórico de negociação
        const negotiationEntry = {
            proposed_by: 'driver',
            proposed_at: new Date().toISOString(),
            original_price: parseFloat(ride.initial_price),
            proposed_price: parseFloat(proposed_price),
            reason: reason || 'Ajuste de tarifa',
            status: 'pending'
        };

        const currentHistory = ride.negotiation_history || [];
        currentHistory.push(negotiationEntry);

        await client.query(
            "UPDATE rides SET negotiation_history = $1 WHERE id = $2",
            [JSON.stringify(currentHistory), ride_id]
        );

        await client.query('COMMIT');

        // Notificar passageiro via socket
        if (req.io) {
            req.io.to(`user_${ride.passenger_id}`).emit('price_proposal', {
                ride_id: ride_id,
                proposal: negotiationEntry,
                message: 'O motorista propôs um novo preço.'
            });
        }

        logSystem('NEGOTIATION', `Motorista ${driverId} propôs novo preço para corrida ${ride_id}: ${proposed_price} Kz`);

        res.json({
            success: true,
            message: "Proposta enviada ao passageiro.",
            proposal: negotiationEntry
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('NEGOTIATION_PROPOSE', e);
        res.status(500).json({ error: "Erro ao processar proposta." });
    } finally {
        client.release();
    }
};

/**
 * RESPONDER A PROPOSTA (Passageiro)
 * Rota: POST /api/rides/:ride_id/negotiate/respond
 * Descrição: Passageiro aceita ou rejeita a proposta de preço do motorista.
 */
exports.respondToProposal = async (req, res) => {
    const { ride_id } = req.params;
    const { accept, reason } = req.body; // accept: boolean
    const passengerId = req.user.id;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const rideRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (ride.passenger_id !== passengerId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Apenas o passageiro pode responder à proposta." });
        }

        const history = ride.negotiation_history || [];
        const pendingProposals = history.filter(p => p.status === 'pending');

        if (pendingProposals.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Nenhuma proposta pendente encontrada." });
        }

        // Pega a proposta mais recente
        const latestProposal = pendingProposals[pendingProposals.length - 1];
        latestProposal.status = accept ? 'accepted' : 'rejected';
        latestProposal.responded_at = new Date().toISOString();
        latestProposal.response_reason = reason || (accept ? 'Aceito pelo passageiro' : 'Rejeitado pelo passageiro');

        if (accept) {
            // Atualizar o preço da corrida
            await client.query(
                "UPDATE rides SET final_price = $1, negotiation_history = $2 WHERE id = $3",
                [latestProposal.proposed_price, JSON.stringify(history), ride_id]
            );
        } else {
            await client.query(
                "UPDATE rides SET negotiation_history = $1 WHERE id = $2",
                [JSON.stringify(history), ride_id]
            );
        }

        await client.query('COMMIT');

        // Notificar motorista via socket
        if (req.io) {
            req.io.to(`user_${ride.driver_id}`).emit('price_proposal_response', {
                ride_id: ride_id,
                accepted: accept,
                proposal: latestProposal,
                message: accept ? 'Passageiro aceitou a proposta.' : 'Passageiro rejeitou a proposta.'
            });
        }

        logSystem('NEGOTIATION', `Passageiro ${passengerId} ${accept ? 'aceitou' : 'rejeitou'} proposta para corrida ${ride_id}`);

        res.json({
            success: true,
            message: accept ? "Proposta aceita. Novo preço atualizado." : "Proposta rejeitada.",
            new_price: accept ? latestProposal.proposed_price : ride.initial_price
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('NEGOTIATION_RESPOND', e);
        res.status(500).json({ error: "Erro ao processar resposta." });
    } finally {
        client.release();
    }
};

/**
 * OBTER HISTÓRICO DE NEGOCIAÇÃO
 * Rota: GET /api/rides/:ride_id/negotiate/history
 * Descrição: Retorna o histórico completo de negociações da corrida.
 */
exports.getNegotiationHistory = async (req, res) => {
    const { ride_id } = req.params;
    const userId = req.user.id;

    try {
        const result = await pool.query(
            "SELECT negotiation_history FROM rides WHERE id = $1",
            [ride_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = result.rows[0];

        // Verificar se o usuário é participante da corrida
        const participantCheck = await pool.query(
            "SELECT passenger_id, driver_id FROM rides WHERE id = $1",
            [ride_id]
        );

        const participants = participantCheck.rows[0];
        if (participants.passenger_id !== userId && participants.driver_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Acesso negado." });
        }

        res.json({
            success: true,
            history: ride.negotiation_history || []
        });

    } catch (e) {
        logError('NEGOTIATION_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar histórico de negociação." });
    }
};

module.exports = exports;
