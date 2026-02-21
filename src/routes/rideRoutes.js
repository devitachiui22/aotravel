/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE ROUTES (VERSÃO FINAL)
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { authenticateToken, requireDriver } = require('../middleware/authMiddleware');

// ✅ Importar as rotas de negociação (como router, não como controller)
const negotiationRoutes = require('./negotiationRoutes');

// Middleware de autenticação para todas as rotas
router.use(authenticateToken);

// Rotas específicas de motorista
router.get('/driver/performance-stats', requireDriver, rideController.getDriverPerformance);

// Rotas transacionais
router.post('/request', rideController.requestRide);
router.post('/accept', requireDriver, rideController.acceptRide);
router.post('/update-status', requireDriver, rideController.updateStatus);
router.post('/start', requireDriver, rideController.startRide);
router.post('/complete', requireDriver, rideController.completeRide);
router.post('/cancel', rideController.cancelRide);

// ✅ Sub-rotas de negociação - DEVE VIR ANTES DAS ROTAS COM :id
router.use('/:ride_id/negotiate', negotiationRoutes);

// Rotas de leitura
router.get('/history', rideController.getHistory);
router.get('/:id', rideController.getRideDetails);

module.exports = router;
