const express = require('express');
const router = express.Router();
const controller = require('../controllers/walletController');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, controller.getWallet);
router.post('/topup', authenticateToken, controller.topup);
router.post('/withdraw', authenticateToken, controller.withdraw);

module.exports = router;