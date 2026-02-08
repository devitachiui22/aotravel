const express = require('express');
const router = express.Router();
const controller = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

router.post('/login', controller.login);
router.post('/signup', controller.signup);
router.post('/logout', authenticateToken, controller.logout);
router.get('/session', controller.checkSession);

module.exports = router;