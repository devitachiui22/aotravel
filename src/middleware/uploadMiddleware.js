/**
 * =================================================================================================
 * 📸 AOTRAVEL SERVER PRO - UPLOAD MIDDLEWARE (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/middleware/uploadMiddleware.js
 * DESCRIÇÃO: Configuração robusta do Multer para upload de arquivos.
 *            Gerencia armazenamento em disco, validação de tipos (MIME),
 *            limites de tamanho e sanitização de nomes de arquivo.
 *
 * REGRAS DE SEGURANÇA:
 * 1. Sanitização de nome de arquivo (previne Path Traversal).
 * 2. Validação estrita de Mimetype (apenas imagens e PDFs).
 * 3. Criação automática de diretórios recursivos.
 * 4. Limite de tamanho de arquivo sincronizado com appConfig.
 * 5. Armazenamento organizado por tipo de documento (KYC, avatars, etc).
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.03.07
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. CONFIGURAÇÃO DE DIRETÓRIOS E STORAGE
// =================================================================================================

// Define o diretório base (padrão 'uploads' se não configurado)
const UPLOAD_BASE_DIR = SYSTEM_CONFIG.SERVER?.UPLOAD_DIR || 'uploads';

// Subdiretórios organizados por tipo de conteúdo
const UPLOAD_SUBDIRS = {
    documents: 'documents',
    avatars: 'avatars',
    rides: 'rides',
    receipts: 'receipts'
};

// Garante que os diretórios existem na inicialização (Boot Check)
try {
    // Cria diretório base
    if (!fs.existsSync(UPLOAD_BASE_DIR)) {
        fs.mkdirSync(UPLOAD_BASE_DIR, { recursive: true });
        console.log(`[FILESYSTEM] Diretório de uploads criado: ${path.resolve(UPLOAD_BASE_DIR)}`);
    }

    // Cria subdiretórios
    Object.values(UPLOAD_SUBDIRS).forEach(subdir => {
        const fullPath = path.join(UPLOAD_BASE_DIR, subdir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
            console.log(`[FILESYSTEM] Subdiretório criado: ${fullPath}`);
        }
    });
} catch (err) {
    console.error(`[FILESYSTEM] ERRO CRÍTICO: Não foi possível criar diretório de uploads.`, err);
    // Não damos exit(1) aqui para permitir que o servidor tente rodar, mas uploads falharão.
}

/**
 * Determina o subdiretório baseado no tipo de upload
 * @param {Object} req - Requisição Express
 * @param {string} uploadType - Tipo de upload ('documents', 'avatars', 'rides', 'receipts')
 * @returns {string} - Caminho completo do diretório
 */
function getUploadDirectory(req, uploadType = 'documents') {
    const subdir = UPLOAD_SUBDIRS[uploadType] || UPLOAD_SUBDIRS.documents;
    const fullPath = path.join(UPLOAD_BASE_DIR, subdir);

    // Garante que o diretório existe a cada request
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }

    return fullPath;
}

/**
 * Storage Engine do Multer
 * Define ONDE e COMO os arquivos são salvos.
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Determina o tipo de upload baseado no campo ou na rota
        let uploadType = 'documents';

        if (req.uploadType) {
            uploadType = req.uploadType;
        } else if (file.fieldname === 'avatar' || file.fieldname === 'photo') {
            uploadType = 'avatars';
        } else if (file.fieldname === 'ride_proof' || file.fieldname === 'receipt') {
            uploadType = 'receipts';
        } else if (file.fieldname === 'evidence' || file.fieldname === 'incident') {
            uploadType = 'rides';
        }

        const destinationPath = getUploadDirectory(req, uploadType);
        cb(null, destinationPath);
    },

    filename: (req, file, cb) => {
        // 1. Extração da extensão original
        const ext = path.extname(file.originalname).toLowerCase();

        // 2. Sanitização do nome original (Remove caracteres perigosos e espaços)
        // Substitui tudo que não for alfanumérico, ponto ou traço por '_'
        const rawName = path.basename(file.originalname, ext);
        const safeName = rawName
            .replace(/[^a-z0-9\-_]/gi, '_')
            .substring(0, 50); // Limita a 50 chars

        // 3. Identificador do usuário (se disponível)
        let userId = 'anonymous';
        if (req.user && req.user.id) {
            userId = req.user.id;
        } else if (req.body && req.body.user_id) {
            userId = req.body.user_id;
        }

        // 4. Timestamp de alta precisão + Random sufixo para evitar colisão
        const timestamp = Date.now();
        const random = Math.round(Math.random() * 1E9);

        // 5. Tipo de documento (se for KYC)
        let docType = '';
        if (file.fieldname === 'bi_front') docType = 'bi_front';
        else if (file.fieldname === 'bi_back') docType = 'bi_back';
        else if (file.fieldname === 'driving_license_front') docType = 'license_front';
        else if (file.fieldname === 'driving_license_back') docType = 'license_back';
        else if (file.fieldname === 'vehicle_title') docType = 'title';
        else if (file.fieldname === 'vehicle_insurance') docType = 'insurance';
        else if (file.fieldname === 'tax_document') docType = 'tax';

        // Formato final: 1700000000000-987654321-userId-docType-safeName.jpg
        let filename = `${timestamp}-${random}`;

        if (userId !== 'anonymous') {
            filename += `-${userId}`;
        }

        if (docType) {
            filename += `-${docType}`;
        }

        if (safeName && safeName !== '_') {
            filename += `-${safeName}`;
        }

        cb(null, `${filename}${ext}`);
    }
});

// =================================================================================================
// 2. FILTROS E LIMITES (SECURITY)
// =================================================================================================

/**
 * Filtro de Arquivos
 * Rejeita arquivos que não sejam imagens ou PDFs.
 */
const fileFilter = (req, file, cb) => {
    // Lista de tipos permitidos (Allowlist)
    const allowedMimes = [
        'image/jpeg',
        'image/pjpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
        'application/msword', // .doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
    ];

    // Permite tipos específicos baseado no campo
    const isAvatar = file.fieldname === 'avatar' || file.fieldname === 'photo';
    const isDocument = file.fieldname.includes('bi_') ||
                       file.fieldname.includes('license') ||
                       file.fieldname.includes('vehicle_') ||
                       file.fieldname === 'tax_document';

    if (allowedMimes.includes(file.mimetype)) {
        // Para avatares, apenas imagens
        if (isAvatar && !file.mimetype.startsWith('image/')) {
            const err = new Error(`Avatares devem ser imagens. Tipo enviado: ${file.mimetype}`);
            err.code = 'INVALID_AVATAR_TYPE';
            return cb(err, false);
        }

        // Para documentos KYC, PDF ou imagens
        if (isDocument && !file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
            const err = new Error(`Documentos devem ser imagens ou PDF. Tipo enviado: ${file.mimetype}`);
            err.code = 'INVALID_DOCUMENT_TYPE';
            return cb(err, false);
        }

        cb(null, true);
    } else {
        // Cria um erro customizado para o middleware de erro capturar
        const err = new Error(`Tipo de arquivo não suportado: ${file.mimetype}. Apenas imagens (JPG, PNG, WEBP, GIF) e documentos (PDF, DOC, DOCX) são permitidos.`);
        err.code = 'INVALID_FILE_TYPE';
        cb(err, false);
    }
};

/**
 * Parse do limite de tamanho
 * O config pode trazer '100mb' (string), precisamos converter para bytes (number)
 */
const parseSizeLimit = (limitStr) => {
    if (typeof limitStr === 'number') return limitStr;
    if (typeof limitStr === 'string') {
        const lower = limitStr.toLowerCase();
        if (lower.endsWith('mb')) return parseFloat(lower) * 1024 * 1024;
        if (lower.endsWith('kb')) return parseFloat(lower) * 1024;
        if (lower.endsWith('gb')) return parseFloat(lower) * 1024 * 1024 * 1024;
    }
    return 100 * 1024 * 1024; // Default 100MB
};

// =================================================================================================
// 3. MIDDLEWARE DE VALIDAÇÃO ADICIONAL
// =================================================================================================

/**
 * Valida se o usuário está autenticado antes do upload
 */
function requireAuthForUpload(req, res, next) {
    if (!req.user || !req.user.id) {
        return res.status(401).json({
            error: 'Autenticação necessária para upload de arquivos.',
            code: 'AUTH_REQUIRED'
        });
    }
    next();
}

/**
 * Middleware para upload de documentos KYC
 */
function uploadKYCDocuments() {
    return [
        requireAuthForUpload,
        upload.fields([
            { name: 'bi_front', maxCount: 1 },
            { name: 'bi_back', maxCount: 1 },
            { name: 'driving_license_front', maxCount: 1 },
            { name: 'driving_license_back', maxCount: 1 },
            { name: 'vehicle_title', maxCount: 1 },
            { name: 'vehicle_insurance', maxCount: 1 },
            { name: 'tax_document', maxCount: 1 }
        ])
    ];
}

/**
 * Middleware para upload de avatar
 */
function uploadAvatar() {
    return [
        requireAuthForUpload,
        upload.single('avatar')
    ];
}

/**
 * Middleware para upload de foto de perfil
 */
function uploadProfilePhoto() {
    return [
        requireAuthForUpload,
        upload.single('photo')
    ];
}

/**
 * Middleware para upload de evidências de corrida
 */
function uploadRideEvidence() {
    return [
        requireAuthForUpload,
        upload.array('evidence', 10) // Máximo 10 arquivos
    ];
}

/**
 * Middleware para upload de comprovantes de pagamento
 */
function uploadPaymentReceipt() {
    return [
        requireAuthForUpload,
        upload.single('receipt')
    ];
}

// =================================================================================================
// 4. INSTÂNCIA FINAL
// =================================================================================================

// Instância principal do Multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: parseSizeLimit(SYSTEM_CONFIG.SERVER?.BODY_LIMIT || '100mb'),
        files: 10 // Máximo de 10 arquivos por request (segurança contra DoS)
    }
});

// Exporta o middleware principal e os helpers
module.exports = {
    // Instância principal
    upload,

    // Middlewares especializados
    uploadKYCDocuments,
    uploadAvatar,
    uploadProfilePhoto,
    uploadRideEvidence,
    uploadPaymentReceipt,

    // Helpers e configurações
    requireAuthForUpload,
    getUploadDirectory,
    UPLOAD_SUBDIRS,

    // Configurações exportadas para uso externo
    config: {
        baseDir: UPLOAD_BASE_DIR,
        subdirs: UPLOAD_SUBDIRS,
        allowedMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'],
        maxFileSize: parseSizeLimit(SYSTEM_CONFIG.SERVER?.BODY_LIMIT || '100mb'),
        maxFiles: 10
    }
};
