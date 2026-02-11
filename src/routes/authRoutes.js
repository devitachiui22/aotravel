/**
 * =================================================================================================
 * 🔐 AOTRAVEL SERVER PRO - AUTHENTICATION ROUTES (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/routes/authRoutes.js
 * DESCRIÇÃO: Definição das rotas de autenticação, autorização e gestão de sessão.
 *            Implementa padrão Híbrido para suportar clientes Legacy e Titanium.
 *
 * VERSÃO: 11.0.2-TITANIUM
 * DATA: 2026.02.11
 * AUTOR: Equipe de Engenharia AOtravel
 *
 * STATUS: PRODUCTION READY - FULL SOURCE
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();

// Importação dos Controladores
// O authController contém a lógica de negócio para Login, Cadastro e Gestão de Sessão.
const authController = require('../controllers/authController');

// Importação de Middlewares de Segurança
// authenticateToken: Valida o JWT ou Session Token no header Authorization/x-session-token.
const { authenticateToken } = require('../middleware/authMiddleware');

// Importação de Middlewares de Validação (Opcional, mas recomendado para integridade)
const { validateLogin, validateSignup } = require('../middleware/validationMiddleware');

// =================================================================================================
// 1. ROTAS DE AUTENTICAÇÃO PÚBLICA (OPEN ACCESS)
// =================================================================================================

/**
 * @route   POST /api/auth/login
 * @desc    Autentica o usuário via Email/Senha e retorna Token + Dados do Usuário.
 * @access  Public
 */
router.post('/login', validateLogin, authController.login);

/**
 * @route   POST /api/auth/signup
 * @desc    Registra um novo usuário (Passageiro ou Motorista).
 *          Rota padrão utilizada pela Web e versões Legacy do App.
 * @access  Public
 */
router.post('/signup', validateSignup, authController.signup);

/**
 * @route   POST /api/auth/register
 * @desc    [TITANIUM HYBRID FIX] Alias para a rota de cadastro.
 *          Adicionado para suportar o payload do Frontend Flutter v3.x que chama '/register'.
 *          Aponta para o mesmo controller 'signup' para garantir consistência de dados.
 * @access  Public
 */
router.post('/register', validateSignup, authController.signup);

// =================================================================================================
// 2. ROTAS DE RECUPERAÇÃO DE CONTA (PASSWORD RECOVERY)
// =================================================================================================

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Inicia o fluxo de recuperação. Envia OTP ou Link para o email/sms do usuário.
 * @access  Public
 */
router.post('/forgot-password', authController.forgotPassword);

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Valida o código de 6 dígitos enviado para o dispositivo.
 * @access  Public
 */
router.post('/verify-otp', authController.verifyOTP);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Define uma nova senha após validação do OTP/Token.
 * @access  Public
 */
router.post('/reset-password', authController.resetPassword);

// =================================================================================================
// 3. ROTAS PROTEGIDAS (REQUIRES AUTHENTICATION)
// =================================================================================================

/*
 * A partir deste ponto, todas as rotas exigem um token válido.
 * O middleware 'authenticateToken' injeta 'req.user' na requisição.
 */

/**
 * @route   POST /api/auth/logout
 * @desc    Encerra a sessão do usuário no servidor e invalida o token.
 *          Atualiza o status 'is_online' para false.
 * @access  Private
 */
router.post('/logout', authenticateToken, authController.logout);

/**
 * @route   GET /api/auth/session
 * @desc    [TITANIUM SYNC] Verifica a validade da sessão atual.
 *          Utilizado pelo Splash Screen do Flutter para 'Auto-Login'.
 *          Retorna o perfil atualizado do usuário e estado da carteira.
 * @access  Private
 */
router.get('/session', authenticateToken, authController.checkSession);

/**
 * @route   POST /api/auth/refresh-token
 * @desc    Renova o Access Token usando um Refresh Token válido (se implementado arquitetura Dual-Token).
 *          Mantido para extensibilidade futura.
 * @access  Private
 */
router.post('/refresh-token', authController.refreshToken);

/**
 * @route   POST /api/auth/change-password
 * @desc    Permite que um usuário logado altere sua senha atual.
 * @access  Private
 */
router.post('/change-password', authenticateToken, authController.changePassword);

/**
 * @route   POST /api/auth/biometric-setup
 * @desc    Registra chave pública para autenticação biométrica (FaceID/TouchID).
 * @access  Private (Mobile Only)
 */
router.post('/biometric-setup', authenticateToken, authController.registerBiometrics);

// =================================================================================================
// 4. ROTAS DE ADMINISTRAÇÃO DE ACESSO (ROLE BASED)
// =================================================================================================

/**
 * @route   POST /api/auth/block-user
 * @desc    Bloqueia o acesso de um usuário (apenas Admin).
 * @access  Private (Admin)
 */
// router.post('/block-user', authenticateToken, requireAdmin, authController.blockUser);
// Comentado propositalmente: esta rota geralmente fica em adminRoutes.js,
// mas mantemos a referência aqui caso a arquitetura exija centralização de Auth.

module.exports = router;
