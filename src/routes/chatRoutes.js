const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.get('/:ride_id', authenticateToken, chatController.getChatHistory);

module.exports = router;