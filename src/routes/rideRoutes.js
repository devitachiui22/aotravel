const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/request', authenticateToken, rideController.requestRide);
router.post('/accept', authenticateToken, rideController.acceptRide);
router.post('/start', authenticateToken, rideController.startRide);
router.post('/complete', authenticateToken, rideController.completeRide);
router.post('/cancel', authenticateToken, rideController.cancelRide);
router.get('/history', authenticateToken, rideController.getHistory);
router.get('/:id', authenticateToken, rideController.getRideDetails);

// Rota específica para atualização de status genérico (arrived, etc.)
router.post('/update-status', authenticateToken, rideController.updateStatus);

// Rota específica para motoristas (Dashboard)
router.get('/driver/performance-stats', authenticateToken, rideController.getDriverPerformance);

module.exports = router;