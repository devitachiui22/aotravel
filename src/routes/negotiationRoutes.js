/**
 * =================================================================================================
 * 💬 AOTRAVEL SERVER PRO - NEGOTIATION ROUTES (VERSÃO FINAL)
 * =================================================================================================
 *
 * ARQUIVO: src/routes/negotiationRoutes.js
 * DESCRIÇÃO: Rotas para negociação de preço entre passageiro e motorista.
 *
 * ✅ CORREÇÕES:
 * 1. ✅ Importação correta do controller
 * 2. ✅ Todas as rotas funcionando
 *
 * STATUS: 🔥 PRODUCTION READY
 * =================================================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const negotiationController = require('../controllers/negotiationController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Todas as rotas de negociação exigem autenticação
router.use(authenticateToken);

// POST /api/rides/:ride_id/negotiate/propose - Motorista propõe novo preço
router.post('/propose', negotiationController.proposePrice);

// POST /api/rides/:ride_id/negotiate/respond - Passageiro responde à proposta
router.post('/respond', negotiationController.respondToProposal);

// GET /api/rides/:ride_id/negotiate/history - Histórico de negociações
router.get('/history', negotiationController.getNegotiationHistory);

module.exports = router;
