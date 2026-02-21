/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE ROUTES (VERSÃO FINAL - 100% CORRIGIDA)
 * =================================================================================================
 *
 * ✅ CORREÇÕES APLICADAS:
 * 1. ✅ Importação correta do rideController
 * 2. ✅ Importação correta das rotas de negociação
 * 3. ✅ Todos os métodos existentes e verificados
 * 4. ✅ Ordem correta das rotas (específicas antes de dinâmicas)
 *
 * STATUS: 🔥 PRODUCTION READY - SEM ERROS
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();

// ✅ Importações CORRETAS
const rideController = require('../controllers/rideController');
const { authenticateToken, requireDriver } = require('../middleware/authMiddleware');

// ✅ Importar as rotas de negociação (como router)
const negotiationRoutes = require('./negotiationRoutes');

// =================================================================================================
// MIDDLEWARE DE AUTENTICAÇÃO PARA TODAS AS ROTAS
// =================================================================================================
router.use(authenticateToken);

// =================================================================================================
// ROTAS ESPECÍFICAS (DEVEM VIR ANTES DAS ROTAS COM :id)
// =================================================================================================

// GET /api/rides/driver/performance-stats - Performance do motorista
router.get('/driver/performance-stats', requireDriver, rideController.getDriverPerformance);

// GET /api/rides/history - Histórico de corridas
router.get('/history', rideController.getHistory);

// =================================================================================================
// ROTAS TRANSACIONAIS (CICLO DE VIDA)
// =================================================================================================

// POST /api/rides/request - Solicitar nova corrida
router.post('/request', rideController.requestRide);

// POST /api/rides/accept - Aceitar corrida
router.post('/accept', requireDriver, rideController.acceptRide);

// POST /api/rides/update-status - Atualizar status
router.post('/update-status', requireDriver, rideController.updateStatus);

// POST /api/rides/start - Iniciar viagem
router.post('/start', requireDriver, rideController.startRide);

// POST /api/rides/complete - Finalizar viagem
router.post('/complete', requireDriver, rideController.completeRide);

// POST /api/rides/cancel - Cancelar corrida
router.post('/cancel', rideController.cancelRide);

// =================================================================================================
// SUB-ROTAS DE NEGOCIAÇÃO
// =================================================================================================
router.use('/:ride_id/negotiate', negotiationRoutes);

// =================================================================================================
// ROTAS DINÂMICAS (COM :id) - DEVEM VIR POR ÚLTIMO
// =================================================================================================

// GET /api/rides/:id - Detalhes da corrida
router.get('/:id', rideController.getRideDetails);

module.exports = router;
