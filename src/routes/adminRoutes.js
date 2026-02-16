/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - ADMIN ROUTES (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/routes/adminRoutes.js
 * DESCRIÇÃO: Definição de rotas do Painel Administrativo.
 *            Todas as rotas são protegidas por dupla camada de segurança:
 *            1. Autenticação (Token válido).
 *            2. Autorização (Role 'admin' obrigatória).
 *
 * MAPA DE ENDPOINTS:
 * - Dashboard: /stats
 * - Usuários: /users (CRUD, Bloqueio, Reset Senha)
 * - Documentos: /documents (Fila de Aprovação, Verificação)
 * - Financeiro: /wallet/adjust (Estornos, Créditos Manuais)
 * - Relatórios: /reports (Geração de CSV/JSON)
 * - Configurações: /settings (Hot-Reload de variáveis)
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// =================================================================================================
// MIDDLEWARE DE SEGURANÇA GLOBAL
// =================================================================================================
// Aplica verificação de Token e Role Admin para TODAS as rotas abaixo.
// Nenhuma requisição passa daqui se não for admin.
router.use(authenticateToken, requireAdmin);

// =================================================================================================
// 1. DASHBOARD E ESTATÍSTICAS
// =================================================================================================
// GET /api/admin/stats - KPIs, Gráficos e Feed em Tempo Real
router.get('/stats', adminController.getStats);

// =================================================================================================
// 2. GESTÃO DE USUÁRIOS
// =================================================================================================
// GET /api/admin/users - Listagem com filtros avançados e paginação
router.get('/users', adminController.getUsers);

// GET /api/admin/users/:id - Detalhes profundos (Perfil, Wallet, Rides, Logs)
router.get('/users/:id', adminController.getUserDetails);

// PUT /api/admin/users/:id - Atualização forçada de dados e bloqueio
router.put('/users/:id', adminController.updateUser);

// POST /api/admin/users/:id/reset-password - Redefinição de senha emergencial
router.post('/users/:id/reset-password', adminController.resetUserPassword);

// =================================================================================================
// 3. GESTÃO DE DOCUMENTOS (KYC)
// =================================================================================================
// GET /api/admin/documents/pending - Fila de documentos aguardando análise
router.get('/documents/pending', adminController.getPendingDocuments);

// POST /api/admin/documents/:id/verify - Aprovar ou Rejeitar documento
router.post('/documents/:id/verify', adminController.verifyDocument);

// =================================================================================================
// 4. GESTÃO FINANCEIRA (WALLET ADMIN)
// =================================================================================================
// POST /api/admin/wallet/adjust - Ajuste manual de saldo (Crédito/Débito/Estorno)
router.post('/wallet/adjust', adminController.manualWalletAdjustment);

// =================================================================================================
// 5. RELATÓRIOS E ANALYTICS
// =================================================================================================
// POST /api/admin/reports - Gerar relatórios complexos (Financeiro, Operacional)
router.post('/reports', adminController.generateReport);

// =================================================================================================
// 6. CONFIGURAÇÕES DO SISTEMA
// =================================================================================================
// GET /api/admin/settings - Listar configurações globais
router.get('/settings', adminController.getSettings);

// PUT /api/admin/settings/:key - Atualizar configuração (Hot-Reload)
router.put('/settings/:key', adminController.updateSetting);

module.exports = router;