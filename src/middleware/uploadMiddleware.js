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
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
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
const UPLOAD_BASE_DIR = SYSTEM_CONFIG.SERVER.UPLOAD_DIR || 'uploads';

// Garante que o diretório existe na inicialização (Boot Check)
try {
    if (!fs.existsSync(UPLOAD_BASE_DIR)) {
        fs.mkdirSync(UPLOAD_BASE_DIR, { recursive: true });
        console.log(`[FILESYSTEM] Diretório de uploads criado: ${path.resolve(UPLOAD_BASE_DIR)}`);
    }
} catch (err) {
    console.error(`[FILESYSTEM] ERRO CRÍTICO: Não foi possível criar diretório de uploads.`, err);
    // Não damos exit(1) aqui para permitir que o servidor tente rodar, mas uploads falharão.
}

/**
 * Storage Engine do Multer
 * Define ONDE e COMO os arquivos são salvos.
 */
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Garante que o diretório existe a cada request (caso tenha sido apagado em runtime)
        if (!fs.existsSync(UPLOAD_BASE_DIR)) {
            fs.mkdirSync(UPLOAD_BASE_DIR, { recursive: true });
        }
        cb(null, UPLOAD_BASE_DIR);
    },

    filename: (req, file, cb) => {
        // 1. Extração da extensão original
        const ext = path.extname(file.originalname).toLowerCase();

        // 2. Sanitização do nome original (Remove caracteres perigosos e espaços)
        // Substitui tudo que não for alfanumérico, ponto ou traço por 'x'
        const rawName = path.basename(file.originalname, ext);
        const safeName = rawName.replace(/[^a-z0-9\-_]/gi, '_').substring(0, 50); // Limita a 50 chars

        // 3. Timestamp de alta precisão + Random sufixo para evitar colisão
        const timestamp = Date.now();
        const random = Math.round(Math.random() * 1E9);

        // Formato final: 1700000000000-987654321-meu_arquivo.jpg
        cb(null, `${timestamp}-${random}-${safeName}${ext}`);
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
        'application/pdf' // Permitido para documentos
    ];

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        // Cria um erro customizado para o middleware de erro capturar
        const err = new Error(`Tipo de arquivo não suportado: ${file.mimetype}. Apenas imagens (JPG, PNG, WEBP) e PDF são permitidos.`);
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
// 3. INSTÂNCIA FINAL
// =================================================================================================

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: parseSizeLimit(SYSTEM_CONFIG.SERVER.BODY_LIMIT), // 100MB
        files: 5 // Máximo de 5 arquivos por request (segurança contra DoS)
    }
});

module.exports = upload;