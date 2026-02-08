const express = require('express');
const router = express.Router();
const controller = require('../controllers/chatController');
const { authenticateToken } = require('../middleware/auth');

router.get('/:ride_id', authenticateToken, controller.getHistory);

module.exports = router;