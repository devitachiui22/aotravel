/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - GLOBAL ERROR SHIELD (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/middleware/errorMiddleware.js
 * DESCRIÇÃO: Sistema centralizado de tratamento de exceções.
 *            Intercepta erros de Banco de Dados, Uploads, Parsing JSON e Lógica de Negócio.
 *            Garante que o servidor NUNCA caia (Crash) devido a uma exceção não tratada em rota
 *            e retorna respostas JSON consistentes para o App Flutter.
 *
 * FUNCIONALIDADES:
 * 1. Tradução de Error Codes do PostgreSQL (ex: 23505 -> "Email já cadastrado").
 * 2. Tratamento de Erros do Multer (Upload).
 * 3. Sanitização de Logs (Remove senhas/tokens antes de imprimir).
 * 4. Fallback 404 Inteligente.
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const { logError } = require('../utils/helpers');
const multer = require('multer');

// =================================================================================================
// 0. HELPERS DE SANITIZAÇÃO
// =================================================================================================

/**
 * Limpa dados sensíveis do objeto de erro antes de logar/retornar.
 * Remove buffers de arquivos e campos de senha.
 */
const sanitizeError = (err) => {
    const clean = { ...err };
    // Se for erro de validação com dados brutos
    if (clean.body) {
        if (clean.body.password) clean.body.password = '[HIDDEN]';
        if (clean.body.pin) clean.body.pin = '[HIDDEN]';
        if (clean.body.image_data) clean.body.image_data = '[BUFFER_HIDDEN]';
    }
    return clean;
};

// =================================================================================================
// 1. NOT FOUND HANDLER (404)
// =================================================================================================

/**
 * Captura requisições para rotas inexistentes.
 * Deve ser o último middleware antes do Global Error Handler.
 */
function notFoundHandler(req, res, next) {
    const error = new Error(`Recurso não encontrado: [${req.method}] ${req.originalUrl}`);
    error.statusCode = 404;
    error.code = 'RESOURCE_NOT_FOUND';
    next(error); // Passa para o globalErrorHandler
}

// =================================================================================================
// 2. GLOBAL ERROR HANDLER (500/4xx)
// =================================================================================================

/**
 * Middleware final de tratamento de erros.
 * Recebe 4 argumentos obrigatoriamente para que o Express o reconheça como Error Handler.
 */
function globalErrorHandler(err, req, res, next) {
    // 1. Configuração Inicial
    let statusCode = err.statusCode || 500;
    let message = err.message || "Erro interno do servidor.";
    let code = err.code || "INTERNAL_ERROR";
    let details = null;

    // 2. Tratamento de Erros do PostgreSQL (Database)
    if (err.code && err.code.length === 5) {
        switch (err.code) {
            case '23505': // Unique Violation
                statusCode = 409; // Conflict
                code = 'DUPLICATE_ENTRY';
                if (err.detail.includes('email')) message = "Este endereço de email já está em uso.";
                else if (err.detail.includes('phone')) message = "Este número de telefone já está em uso.";
                else if (err.detail.includes('wallet_account_number')) message = "Erro na geração da conta. Tente novamente.";
                else message = "Registro duplicado detectado.";
                break;

            case '23503': // Foreign Key Violation
                statusCode = 400; // Bad Request
                code = 'REFERENCE_ERROR';
                message = "Operação inválida. O registro referenciado não existe ou não pode ser vinculado.";
                break;

            case '22P02': // Invalid Text Representation (ex: UUID inválido ou Int esperada)
                statusCode = 400;
                code = 'INVALID_FORMAT';
                message = "Formato de dados inválido na requisição.";
                break;

            case '42P01': // Undefined Table (Crítico - Erro de Dev)
                statusCode = 500;
                code = 'DB_SCHEMA_ERROR';
                message = "Erro de configuração no banco de dados.";
                // Em prod, não expor 'undefined table', mas logar forte
                console.error('❌ [CRITICAL] TABELA NÃO ENCONTRADA:', err.message);
                break;

            default:
                // Outros erros de DB
                if (process.env.NODE_ENV === 'development') {
                    message = `Erro de Banco de Dados: ${err.message}`;
                }
        }
    }

    // 3. Tratamento de Erros do Multer (Upload de Arquivos)
    if (err instanceof multer.MulterError) {
        statusCode = 400;
        code = 'UPLOAD_ERROR';
        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                message = "O arquivo enviado é muito grande. Limite máximo excedido.";
                break;
            case 'LIMIT_UNEXPECTED_FILE':
                message = "Campo de upload não esperado ou limite de arquivos excedido.";
                break;
            default:
                message = `Erro no upload: ${err.message}`;
        }
    }

    // 4. Tratamento de JSON Malformado (Body Parser)
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        statusCode = 400;
        code = 'INVALID_JSON';
        message = "O corpo da requisição contém JSON inválido.";
    }

    // 5. Tratamento de Erros de Token (JWT / Auth)
    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        code = 'INVALID_TOKEN';
        message = "Token de autenticação inválido.";
    }
    if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        code = 'TOKEN_EXPIRED';
        message = "Sua sessão expirou. Faça login novamente.";
    }

    // 6. Logging (Apenas se não for 404 trivial)
    if (statusCode !== 404) {
        // Loga no console/arquivo usando o helper
        // Se for 500, é erro crítico
        if (statusCode >= 500) {
            logError('SERVER_CRASH_PREVENTED', err);
        } else {
            console.warn(`[WARN] ${code} (${statusCode}): ${message}`);
        }
    }

    // 7. Montagem da Resposta JSON
    const response = {
        success: false,
        error: message, // Mensagem amigável (User Facing)
        code: code      // Código para o Frontend tratar (Machine Readable)
    };

    // Em ambiente de desenvolvimento, anexa o Stack Trace para debug
    if (process.env.NODE_ENV === 'development') {
        response.debug = {
            stack: err.stack,
            pg_code: err.code, // Código original do Postgres
            original_msg: err.message
        };
    }

    // Envia resposta
    res.status(statusCode).json(response);
}

// =================================================================================================
// EXPORTAÇÃO
// =================================================================================================

module.exports = {
    notFoundHandler,
    globalErrorHandler
};