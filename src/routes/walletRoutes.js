const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authenticateToken, requireActiveWallet } = require('../middleware/authMiddleware');

// Rotas de leitura
router.get('/', authenticateToken, walletController.getWalletData);

// Rotas transacionais (Protegidas por requireActiveWallet)
router.post('/transfer/internal', authenticateToken, requireActiveWallet, walletController.internalTransfer);
router.post('/topup', authenticateToken, requireActiveWallet, walletController.topup);
router.post('/withdraw', authenticateToken, requireActiveWallet, walletController.withdraw);
router.post('/pay-service', authenticateToken, requireActiveWallet, walletController.payService);

// Gestão e Segurança
router.post('/set-pin', authenticateToken, walletController.setPin);
router.post('/verify-pin', authenticateToken, walletController.verifyPin);
router.post('/cards/add', authenticateToken, walletController.addCard);
router.delete('/cards/:id', authenticateToken, walletController.deleteCard);
router.post('/accounts/add', authenticateToken, walletController.addAccount);
router.delete('/accounts/:id', authenticateToken, walletController.deleteAccount);

module.exports = router;