const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// Middleware global para todas as rotas de admin
router.use(authenticateToken, requireAdmin);

router.get('/stats', adminController.getStats);
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserDetails);
router.put('/users/:id', adminController.updateUser);
router.post('/documents/:id/verify', adminController.verifyDocument);
router.post('/reports', adminController.generateReport);
router.get('/settings', adminController.getSettings);
router.put('/settings/:key', adminController.updateSetting);

module.exports = router;