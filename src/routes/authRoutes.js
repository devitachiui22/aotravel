/**
 * =================================================================================================
 * 🔐 AOTRAVEL SERVER PRO - AUTH ROUTES (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/routes/authRoutes.js
 * DESCRIÇÃO: Rotas públicas e protegidas para autenticação.
 *            Gerencia Login, Cadastro, Logout e Validação de Sessão.
 *
 * MAPA DE ENDPOINTS:
 * - Public: /login, /signup
 * - Protected: /logout, /session
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

// =================================================================================================
// ROTAS PÚBLICAS (OPEN ACCESS)
// =================================================================================================

// POST /api/auth/login - Autenticação via Email/Senha (com migração de hash)
router.post('/login', authController.login);

// POST /api/auth/signup - Cadastro de Usuário e Criação de Wallet
router.post('/signup', authController.signup);

// =================================================================================================
// ROTAS PROTEGIDAS (TOKEN REQUIRED)
// =================================================================================================

// POST /api/auth/logout - Encerramento seguro de sessão
router.post('/logout', authenticateToken, authController.logout);

// GET /api/auth/session - Validação de token no Boot do App (Splash Screen)
router.get('/session', authenticateToken, authController.checkSession);

module.exports = router;
