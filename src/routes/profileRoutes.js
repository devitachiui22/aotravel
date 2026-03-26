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
 * - Mídia: POST /photo, POST /photo/upload
 * - Compliance: POST /documents (KYC via Base64)
 * - Upload Multipart: POST /documents/upload (CORREÇÃO CRÍTICA)
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { authenticateToken } = require('../middleware/authMiddleware');

// ✅ CORREÇÃO: Importação direta do multer (agora exporta a instância)
const upload = require('../middleware/uploadMiddleware');

// =================================================================================================
// MIDDLEWARE GLOBAL
// =================================================================================================
// Todas as rotas de perfil exigem autenticação
router.use(authenticateToken);

// =================================================================================================
// ROTAS DE DADOS BÁSICOS
// =================================================================================================

/**
 * @route   GET /api/profile
 * @desc    Obter dados do perfil, estatísticas e status financeiro
 * @access  Private
 */
router.get('/', profileController.getProfile);

/**
 * @route   PUT /api/profile
 * @desc    Atualizar Nome, Telefone e Dados do Veículo
 * @access  Private
 */
router.put('/', profileController.updateProfile);

// =================================================================================================
// ROTAS DE CONFIGURAÇÃO E SEGURANÇA
// =================================================================================================

/**
 * @route   PUT /api/profile/settings
 * @desc    Atualizar preferências do App (JSON)
 * @access  Private
 */
router.put('/settings', profileController.updateSettings);

/**
 * @route   POST /api/profile/change-password
 * @desc    Alterar senha (requer senha atual)
 * @access  Private
 */
router.post('/change-password', profileController.changePassword);

// =================================================================================================
// ROTAS DE UPLOAD (MÍDIA E DOCUMENTOS)
// =================================================================================================

/**
 * @route   POST /api/profile/photo
 * @desc    Upload de foto de perfil via Base64 (Avatar)
 * @access  Private
 */
router.post('/photo', profileController.uploadPhoto);

/**
 * @route   POST /api/profile/photo/upload
 * @desc    Upload de foto de perfil via Multipart (form-data)
 * @access  Private
 */
router.post('/photo/upload', upload.single('photo'), profileController.uploadPhotoMultipart);

/**
 * @route   POST /api/profile/documents
 * @desc    Upload de documentos para Verificação (KYC) via Base64
 * @access  Private
 */
router.post('/documents', profileController.uploadDocuments);

// =================================================================================================
// 🚀 ROTA CRÍTICA: UPLOAD DE DOCUMENTOS VIA MULTIPART/FORM-DATA
// =================================================================================================
/**
 * @route   POST /api/profile/documents/upload
 * @desc    Upload de documentos para Verificação (KYC) via MULTIPART
 *          CORREÇÃO DEFINITIVA PARA O ERRO DE UPLOAD NO APP BUILT
 * @access  Private
 */
router.post(
    '/documents/upload',
    upload.fields([
        { name: 'profile_photo', maxCount: 1 },
        { name: 'bi_front', maxCount: 1 },
        { name: 'bi_back', maxCount: 1 },
        { name: 'driving_license_front', maxCount: 1 },
        { name: 'driving_license_back', maxCount: 1 },
        { name: 'vehicle_title', maxCount: 1 },
        { name: 'vehicle_insurance', maxCount: 1 },
        { name: 'tax_document', maxCount: 1 }
    ]),
    profileController.uploadDocumentsMultipart
);

module.exports = router;
