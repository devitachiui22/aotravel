const express = require('express');
const router = express.Router();
const controller = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, controller.getNotifications);
router.put('/:id/read', authenticateToken, controller.markAsRead);
router.post('/read-all', authenticateToken, controller.markAllAsRead);

module.exports = router;