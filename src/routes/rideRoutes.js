/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE ROUTES (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/routes/rideRoutes.js
 * DESCRIÇÃO: Rotas do ciclo de vida das corridas.
 *            Gerencia desde a solicitação até a finalização e avaliação.
 *
 * MAPA DE ENDPOINTS:
 * - Ciclo: /request, /accept, /start, /update-status, /complete, /cancel
 * - Leitura: /history, /:id
 * - Motorista: /driver/performance-stats
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { authenticateToken, requireDriver } = require('../middleware/authMiddleware');

// =================================================================================================
// MIDDLEWARE GLOBAL
// =================================================================================================
router.use(authenticateToken);

// =================================================================================================
// ROTAS DE MOTORISTA (ESPECÍFICAS)
// =================================================================================================
// IMPORTANTE: Definir antes de /:id para evitar conflito de rota
// GET /api/rides/driver/performance-stats - Dashboard financeiro do motorista
router.get('/driver/performance-stats', requireDriver, rideController.getDriverPerformance);

// =================================================================================================
// ROTAS TRANSACIONAIS (CICLO DE VIDA)
// =================================================================================================

// POST /api/rides/request - Solicitar nova corrida (Passageiro)
router.post('/request', rideController.requestRide);

// POST /api/rides/accept - Aceitar corrida (Motorista)
router.post('/accept', requireDriver, rideController.acceptRide);

// POST /api/rides/update-status - Atualizações intermediárias (Chegou, Embarcou)
router.post('/update-status', requireDriver, rideController.updateStatus);

// POST /api/rides/start - Iniciar viagem efetivamente
router.post('/start', requireDriver, rideController.startRide);

// POST /api/rides/complete - Finalizar viagem e cobrar
router.post('/complete', requireDriver, rideController.completeRide);

// POST /api/rides/cancel - Cancelar corrida (Ambos)
router.post('/cancel', rideController.cancelRide);

// =================================================================================================
// ROTAS DE LEITURA (HISTÓRICO E DETALHES)
// =================================================================================================

// GET /api/rides/history - Histórico paginado de corridas
router.get('/history', rideController.getHistory);

// GET /api/rides/:id - Detalhes completos de uma corrida específica
router.get('/:id', rideController.getRideDetails);

module.exports = router;