const express = require('express');
const router = express.Router();
const controller = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

router.get('/stats', authenticateToken, requireAdmin, controller.getStats);
router.get('/users', authenticateToken, requireAdmin, controller.getUsers);
router.get('/users/:id', authenticateToken, requireAdmin, controller.getUserDetails);
router.put('/users/:id', authenticateToken, requireAdmin, controller.updateUser);
router.post('/documents/:id/verify', authenticateToken, requireAdmin, controller.verifyDocument);
router.get('/rides', authenticateToken, requireAdmin, controller.getRides);
router.post('/reports', authenticateToken, requireAdmin, controller.generateReport);
router.get('/settings', authenticateToken, requireAdmin, controller.getSettings);
router.put('/settings/:key', authenticateToken, requireAdmin, controller.updateSetting);

module.exports = router;