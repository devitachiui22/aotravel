/**
 * =================================================================================================
 * 💬 AOTRAVEL SERVER PRO - CHAT ROUTES (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/routes/chatRoutes.js
 * DESCRIÇÃO: Rotas para recuperação de histórico de mensagens e gestão de estado de leitura.
 *            Todas as rotas validam se o usuário é participante da corrida.
 *
 * MAPA DE ENDPOINTS:
 * - Histórico: /:ride_id
 * - Leitura: /:ride_id/read
 * - Badges: /unread/count
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Middleware de autenticação para todo o módulo de chat
router.use(authenticateToken);

// =================================================================================================
// ROTAS DE CHAT
// =================================================================================================

// GET /api/chat/unread/count - Contagem global de mensagens não lidas (Badges)
// IMPORTANTE: Deve vir ANTES de /:ride_id para evitar conflito de rota
router.get('/unread/count', chatController.getUnreadCount);

// GET /api/chat/:ride_id - Recuperar histórico completo de uma corrida
router.get('/:ride_id', chatController.getChatHistory);

// POST /api/chat/:ride_id/read - Marcar mensagens da corrida como lidas explicitamente
router.post('/:ride_id/read', chatController.markAsRead);

module.exports = router;