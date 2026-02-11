/**
 * =================================================================================================
 * 📸 AOTRAVEL SERVER PRO - UPLOAD MIDDLEWARE
 * =================================================================================================
 *
 * ARQUIVO: src/middleware/uploadMiddleware.js
 * DESCRIÇÃO: Configuração do Multer para upload de imagens (Perfil, Documentos, Chat).
 *            Implementa limites de tamanho (100MB) para suportar fotos em alta resolução
 *            e validação de tipo MIME.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const SYSTEM_CONFIG = require('../config/appConfig');

// Garante que o diretório de uploads existe na inicialização
const uploadDir = SYSTEM_CONFIG.SERVER.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) {
    try {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`[FILESYSTEM] Diretório '${uploadDir}' criado com sucesso.`);
    } catch (err) {
        console.error(`[FILESYSTEM] Erro crítico ao criar diretório '${uploadDir}':`, err);
    }
}

// Configuração do Armazenamento em Disco
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Sanitiza o nome do arquivo para evitar problemas com caracteres especiais
        const sanitizedName = file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_]/g, '');
        // Adiciona timestamp para unicidade
        cb(null, Date.now() + '-' + sanitizedName);
    }
});

// Filtro de Arquivos (Apenas Imagens)
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Apenas arquivos de imagem são permitidos!'), false);
    }
};

// Instância do Multer Configurada
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // Limite de 100MB (Conforme requisito do server.js original)
    },
    fileFilter: fileFilter
});

module.exports = upload;