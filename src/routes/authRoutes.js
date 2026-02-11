const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

router.post('/login', authController.login);
router.post('/signup', authController.signup);
router.post('/logout', authenticateToken, authController.logout);
router.get('/session', authenticateToken, authController.checkSession); // Validação de token no Frontend

module.exports = router;