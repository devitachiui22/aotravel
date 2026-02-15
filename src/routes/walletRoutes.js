/**
 * =================================================================================================
 * 🏦 AOTRAVEL SERVER PRO - WALLET ROUTES (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/routes/walletRoutes.js
 * DESCRIÇÃO: Rotas para operações financeiras e gestão de ativos.
 *            Utiliza o middleware `requireActiveWallet` para proteger transações monetárias
 *            contra fraudes ou contas bloqueadas.
 *
 * MAPA DE ENDPOINTS:
 * - Dashboard: GET /
 * - Transações: /transfer/internal, /topup, /withdraw, /pay-service
 * - Segurança: /set-pin, /verify-pin
 * - Ativos: /cards/*, /accounts/*
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authenticateToken, requireActiveWallet } = require('../middleware/authMiddleware');

// =================================================================================================
// MIDDLEWARE GLOBAL
// =================================================================================================
router.use(authenticateToken);

// =================================================================================================
// ROTAS DE LEITURA (DASHBOARD)
// =================================================================================================
// GET /api/wallet - Saldo, Extrato, Limites e Status
// Não exige carteira ativa para permitir que o usuário veja por que está bloqueado
router.get('/', walletController.getWalletData);

// =================================================================================================
// ROTAS TRANSACIONAIS (REQUIRE ACTIVE WALLET)
// =================================================================================================
// Estas rotas movimentam dinheiro e exigem status 'active' e 'unblocked'

// POST /api/wallet/transfer/internal - Transferência P2P
router.post('/transfer/internal', requireActiveWallet, walletController.internalTransfer);

// POST /api/wallet/topup - Recarga de Saldo
router.post('/topup', requireActiveWallet, walletController.topup);

// POST /api/wallet/withdraw - Saque Bancário
router.post('/withdraw', requireActiveWallet, walletController.withdraw);

// POST /api/wallet/pay-service - Pagamento de Contas
router.post('/pay-service', requireActiveWallet, walletController.payService);

// =================================================================================================
// ROTAS DE SEGURANÇA (PIN)
// =================================================================================================

// POST /api/wallet/set-pin - Definir ou Alterar PIN de transação
router.post('/set-pin', walletController.setPin);

// POST /api/wallet/verify-pin - Validar PIN antes de ação sensível (Pré-check UI)
router.post('/verify-pin', walletController.verifyPin);

// =================================================================================================
// ROTAS DE GESTÃO DE ATIVOS (CARTÕES E CONTAS)
// =================================================================================================

// --- Cartões Virtuais/Físicos ---
// POST /api/wallet/cards/add - Vincular novo cartão
router.post('/cards/add', walletController.addCard);

// DELETE /api/wallet/cards/:id - Remover cartão
router.delete('/cards/:id', walletController.deleteCard);

// --- Contas Bancárias Externas ---
// POST /api/wallet/accounts/add - Vincular conta bancária
router.post('/accounts/add', walletController.addAccount);

// DELETE /api/wallet/accounts/:id - Remover conta bancária
router.delete('/accounts/:id', walletController.deleteAccount);

module.exports = router;