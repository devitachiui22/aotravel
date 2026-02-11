/**
 * =================================================================================================
 * 👤 AOTRAVEL SERVER PRO - PROFILE ROUTES (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/routes/profileRoutes.js
 * DESCRIÇÃO: Rotas para gestão de dados do usuário, configurações e KYC.
 *            Integra o middleware de Upload (Multer) para fotos e documentos.
 *
 * MAPA DE ENDPOINTS:
 * - Dados: GET /, PUT /
 * - Config: PUT /settings
 * - Segurança: POST /change-password
 * - Mídia: POST /photo
 * - Compliance: POST /documents (KYC)
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { authenticateToken } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

// =================================================================================================
// MIDDLEWARE GLOBAL
// =================================================================================================
// Todas as rotas de perfil exigem autenticação
router.use(authenticateToken);

// =================================================================================================
// ROTAS DE DADOS BÁSICOS
// =================================================================================================

// GET /api/profile - Obter dados do perfil, estatísticas e status financeiro
router.get('/', profileController.getProfile);

// PUT /api/profile - Atualizar Nome, Telefone e Dados do Veículo
router.put('/', profileController.updateProfile);

// =================================================================================================
// ROTAS DE CONFIGURAÇÃO E SEGURANÇA
// =================================================================================================

// PUT /api/profile/settings - Atualizar preferências do App (JSON)
router.put('/settings', profileController.updateSettings);

// POST /api/profile/change-password - Alterar senha (requer senha atual)
router.post('/change-password', profileController.changePassword);

// =================================================================================================
// ROTAS DE UPLOAD (MÍDIA E DOCUMENTOS)
// =================================================================================================

// POST /api/profile/photo - Upload de foto de perfil (Avatar)
// Middleware: upload.single('photo') processa o arquivo antes do controller
router.post('/photo', upload.single('photo'), profileController.uploadPhoto);

// POST /api/profile/documents - Upload de documentos para Verificação (KYC)
// Middleware: upload.fields processa múltiplos arquivos com chaves específicas
router.post('/documents', upload.fields([
    { name: 'bi_front', maxCount: 1 },
    { name: 'bi_back', maxCount: 1 },
    { name: 'driving_license_front', maxCount: 1 },
    { name: 'driving_license_back', maxCount: 1 }
]), profileController.uploadDocuments);

module.exports = router;