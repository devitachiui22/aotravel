/**
 * =================================================================================================
 * 💬 AOTRAVEL SERVER PRO - NEGOTIATION CONTROLLER (TITANIUM EDITION) - VERSÃO FINAL
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/negotiationController.js
 * DESCRIÇÃO: Controlador para negociação de preço entre passageiro e motorista.
 *
 * ✅ CORREÇÕES:
 * 1. ✅ Todos os métodos exportados corretamente
 * 2. ✅ Tratamento de erros completo
 * 3. ✅ Transações ACID
 * 4. ✅ Notificações em tempo real
 *
 * STATUS: 🔥 PRODUCTION READY
 * =================================================================================================
 */

const pool = require('../config/db');
const { logSystem, logError, generateRef } = require('../utils/helpers');

/**
 * PROPOR NOVO PREÇO (Motorista)
 * Rota: POST /api/rides/:ride_id/negotiate/propose
 */
const proposePrice = async (req, res) => {
    const { ride_id } = req.params;
    const { proposed_price, reason } = req.body;
    const driverId = req.user.id;

    // Validação básica
    if (!proposed_price || proposed_price < 100) {
        return res.status(400).json({ 
            success: false,
            error: "Preço proposto inválido. Mínimo: 100 Kz." 
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Buscar a corrida com lock
        const rideRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false,
                error: "Corrida não encontrada." 
            });
        }

        const ride = rideRes.rows[0];

        // Verificar permissão (apenas o motorista da corrida)
        if (ride.driver_id !== driverId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ 
                success: false,
                error: "Apenas o motorista responsável pode propor novo preço." 
            });
        }

        // Verificar status da corrida
        if (ride.status !== 'accepted' && ride.status !== 'ongoing') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false,
                error: "Não é possível negociar o preço nesta fase da corrida." 
            });
        }

        // Criar entrada de negociação
        const negotiationEntry = {
            id: generateRef('NEG'),
            proposed_by: 'driver',
            proposed_at: new Date().toISOString(),
            original_price: parseFloat(ride.initial_price),
            proposed_price: parseFloat(proposed_price),
            reason: reason || 'Ajuste de tarifa',
            status: 'pending'
        };

        // Atualizar histórico
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

        logSystem('NEGOTIATION', `Motorista ${driverId} propôs ${proposed_price} Kz para corrida ${ride_id}`);

        res.json({
            success: true,
            message: "Proposta enviada ao passageiro.",
            proposal: negotiationEntry
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('NEGOTIATION_PROPOSE', e);
        res.status(500).json({ 
            success: false,
            error: "Erro ao processar proposta." 
        });
    } finally {
        client.release();
    }
};

/**
 * RESPONDER A PROPOSTA (Passageiro)
 * Rota: POST /api/rides/:ride_id/negotiate/respond
 */
const respondToProposal = async (req, res) => {
    const { ride_id } = req.params;
    const { accept, reason } = req.body;
    const passengerId = req.user.id;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Buscar a corrida com lock
        const rideRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false,
                error: "Corrida não encontrada." 
            });
        }

        const ride = rideRes.rows[0];

        // Verificar permissão (apenas o passageiro da corrida)
        if (ride.passenger_id !== passengerId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ 
                success: false,
                error: "Apenas o passageiro pode responder à proposta." 
            });
        }

        // Buscar propostas pendentes
        const history = ride.negotiation_history || [];
        const pendingProposals = history.filter(p => p.status === 'pending');

        if (pendingProposals.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                success: false,
                error: "Nenhuma proposta pendente encontrada." 
            });
        }

        // Pegar a proposta mais recente
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
            // Apenas atualizar o histórico
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
        res.status(500).json({ 
            success: false,
            error: "Erro ao processar resposta." 
        });
    } finally {
        client.release();
    }
};

/**
 * OBTER HISTÓRICO DE NEGOCIAÇÃO
 * Rota: GET /api/rides/:ride_id/negotiate/history
 */
const getNegotiationHistory = async (req, res) => {
    const { ride_id } = req.params;
    const userId = req.user.id;

    try {
        const result = await pool.query(
            "SELECT negotiation_history FROM rides WHERE id = $1",
            [ride_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false,
                error: "Corrida não encontrada." 
            });
        }

        // Verificar se o usuário é participante da corrida
        const participantCheck = await pool.query(
            "SELECT passenger_id, driver_id FROM rides WHERE id = $1",
            [ride_id]
        );

        const participants = participantCheck.rows[0];
        if (participants.passenger_id !== userId && 
            participants.driver_id !== userId && 
            req.user.role !== 'admin') {
            return res.status(403).json({ 
                success: false,
                error: "Acesso negado." 
            });
        }

        res.json({
            success: true,
            history: result.rows[0].negotiation_history || []
        });

    } catch (e) {
        logError('NEGOTIATION_HISTORY', e);
        res.status(500).json({ 
            success: false,
            error: "Erro ao buscar histórico de negociação." 
        });
    }
};

// ✅ EXPORTAÇÃO CORRETA - TODOS OS MÉTODOS
module.exports = {
    proposePrice,
    respondToProposal,
    getNegotiationHistory
};
