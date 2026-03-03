/**
 * =================================================================================================
 * 🛣️ AOTRAVEL SERVER PRO - SMART HUB ROUTES
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const hubController = require('../controllers/hubController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.use(authenticateToken);

// Agendamentos
router.post('/schedule', hubController.scheduleRide);
router.get('/schedule/history', hubController.getScheduledHistory);

// Viagens em Grupo
router.post('/group', hubController.createGroupRide);
router.get('/group/history', hubController.getGroupHistory);

// Logística / Entregas
router.post('/delivery', hubController.createDelivery);
router.get('/delivery/history', hubController.getDeliveryHistory);

module.exports = router;