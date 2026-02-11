/**
 * =================================================================================================
 * 🚨 AOTRAVEL SERVER PRO - GLOBAL ERROR & 404 HANDLER
 * =================================================================================================
 *
 * ARQUIVO: src/middleware/errorMiddleware.js
 * DESCRIÇÃO: Captura de exceções e tratamento de rotas não encontradas.
 * STATUS: PRODUCTION READY - FULL VERSION (Sem omissões)
 * =================================================================================================
 */

const { logError } = require('../utils/helpers');
const multer = require('multer');

/**
 * 1. GLOBAL ERROR HANDLER
 * Captura qualquer erro lançado nas rotas (try/catch) ou middlewares anteriores.
 */
function globalErrorHandler(err, req, res, next) {
    // Log detalhado no console para o desenvolvedor
    console.error(`[${new Date().toISOString()}] ❌ ERRO GLOBAL:`, err.message);

    // Tenta usar o helper de log se ele existir, senão ignora
    if (typeof logError === 'function') {
        logError('GLOBAL_ERROR_HANDLER', err);
    }

    // Tratamento específico para erros de Upload (Multer)
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Arquivo muito grande. O limite máximo permitido é 100MB.'
            });
        }
        return res.status(400).json({
            success: false,
            error: `Erro no processamento do arquivo: ${err.message}`
        });
    }

    // Tratamento para erros de JSON malformado (Body Parser / Express JSON)
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            success: false,
            error: 'JSON inválido na requisição. Verifique a sintaxe dos dados enviados.'
        });
    }

    // Status code padrão (500 se não especificado)
    const statusCode = err.statusCode || 500;

    // Resposta de segurança para o cliente
    const response = {
        success: false,
        error: "Erro interno do servidor.",
        message: err.message || "Ocorreu uma falha inesperada no processamento."
    };

    // Em ambiente de desenvolvimento, mostramos o erro completo (Stack Trace)
    if (process.env.NODE_ENV === 'development') {
        response.stack = err.stack;
        response.details = err;
    }

    res.status(statusCode).json(response);
}

/**
 * 2. NOT FOUND HANDLER (404)
 * Captura requisições para rotas que não foram definidas no roteador.
 */
function notFoundHandler(req, res, next) {
    res.status(404).json({
        success: false,
        error: "Recurso não encontrado.",
        message: `A rota [${req.method}] ${req.originalUrl} não existe neste servidor.`
    });
}

// Exportação múltipla para coincidir com a desestruturação no server.js
module.exports = {
    globalErrorHandler,
    notFoundHandler
};
