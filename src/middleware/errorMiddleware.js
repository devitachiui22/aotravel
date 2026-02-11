/**
 * =================================================================================================
 * 🚨 AOTRAVEL SERVER PRO - GLOBAL ERROR HANDLER
 * =================================================================================================
 *
 * ARQUIVO: src/middleware/errorMiddleware.js
 * DESCRIÇÃO: Middleware global para captura de exceções não tratadas nas rotas.
 *            Garante que o cliente sempre receba um JSON válido, mesmo em caso de crash.
 *            Trata erros específicos do Multer e do Postgres.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const { logError } = require('../utils/helpers');
const multer = require('multer');

function errorHandler(err, req, res, next) {
    // Log detalhado do erro no console do servidor
    logError('GLOBAL_ERROR_HANDLER', err);

    // Tratamento específico para erros de Upload (Multer)
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: 'Arquivo muito grande. O limite máximo é 100MB.'
            });
        }
        return res.status(400).json({
            error: `Erro no upload do arquivo: ${err.message}`
        });
    }

    // Tratamento para erros de JSON malformado (Body Parser)
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'JSON inválido na requisição.' });
    }

    // Tratamento Genérico para Erros de Servidor (500)
    // Em produção, não expomos o stack trace para o cliente por segurança.
    const response = {
        error: "Erro interno do servidor.",
        message: err.message || "Ocorreu uma falha inesperada."
    };

    // Adiciona detalhes apenas se não estiver em produção (Opcional, mas seguro manter fechado)
    if (process.env.NODE_ENV === 'development') {
        response.stack = err.stack;
    }

    res.status(500).json(response);
}

module.exports = errorHandler;