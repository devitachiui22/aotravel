/**
 * =================================================================================================
 * 💬 AOTRAVEL SERVER PRO - NEGOTIATION ROUTES (VERSÃO FINAL)
 * =================================================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

// ✅ Importação CORRETA
const negotiationController = require('../controllers/negotiationController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Todas as rotas exigem autenticação
router.use(authenticateToken);

// POST /api/rides/:ride_id/negotiate/propose - Motorista propõe preço
router.post('/propose', negotiationController.proposePrice);

// POST /api/rides/:ride_id/negotiate/respond - Passageiro responde
router.post('/respond', negotiationController.respondToProposal);

// GET /api/rides/:ride_id/negotiate/history - Histórico de negociações
router.get('/history', negotiationController.getNegotiationHistory);

module.exports = router;
