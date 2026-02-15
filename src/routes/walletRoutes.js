/**
 * =================================================================================================
 * 🏦 AOTRAVEL SERVER PRO - WALLET ROUTES (TITANIUM EDITION) - CORRIGIDO
 * =================================================================================================
 *
 * ARQUIVO: src/routes/walletRoutes.js
 * DESCRIÇÃO: Rotas para operações financeiras e gestão de ativos.
 *            ✅ CORREÇÃO: Todas as funções do controller verificadas e existentes
 *
 * STATUS: 🔥 PRODUCTION READY - ZERO ERROS
 */

const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authenticateToken } = require('../middleware/authMiddleware');

// =================================================================================================
// MIDDLEWARE GLOBAL
// =================================================================================================
router.use(authenticateToken);

// =================================================================================================
// ROTAS DE LEITURA (DASHBOARD)
// =================================================================================================
router.get('/', walletController.getWalletData);
router.get('/balance', walletController.getBalance);
router.get('/transactions', walletController.getTransactions);
router.get('/accounts', walletController.listAccounts);

// =================================================================================================
// ROTAS DE PERFORMANCE DO MOTORISTA
// =================================================================================================
router.get('/driver/performance', walletController.getDriverPerformance);

// =================================================================================================
// ROTAS TRANSACIONAIS
// =================================================================================================
router.post('/transfer/internal', walletController.internalTransfer);
router.post('/topup', walletController.topup);
router.post('/withdraw', walletController.withdraw);
router.post('/pay-service', walletController.payService);

// =================================================================================================
// ROTAS DE SEGURANÇA (PIN)
// =================================================================================================
router.post('/set-pin', walletController.setPin);
router.post('/verify-pin', walletController.verifyPin);

// =================================================================================================
// ROTAS DE GESTÃO DE CONTAS BANCÁRIAS
// =================================================================================================
router.post('/accounts/add', walletController.addAccount);
router.delete('/accounts/:id', walletController.deleteAccount);
router.put('/accounts/:id/default', walletController.setDefaultAccount);

// =================================================================================================
// ROTAS DE GESTÃO DE CARTÕES
// =================================================================================================
router.post('/cards/add', walletController.addCard);
router.delete('/cards/:id', walletController.deleteCard);

module.exports = router;
