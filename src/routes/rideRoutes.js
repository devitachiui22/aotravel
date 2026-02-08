const express = require('express');
const router = express.Router();
const controller = require('../controllers/rideController');
const { authenticateToken } = require('../middleware/auth');

router.post('/request', authenticateToken, controller.requestRide);
router.post('/accept', authenticateToken, controller.acceptRide);
router.post('/start', authenticateToken, controller.startRide);
router.post('/complete', authenticateToken, controller.completeRide);
router.post('/cancel', authenticateToken, controller.cancelRide);
router.get('/history', authenticateToken, controller.getHistory);
router.get('/:id', authenticateToken, controller.getDetails);

module.exports = router;