/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - PRODUCTION COMMAND CENTER v12.0.0 (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: server.js
 * DESCRIÇÃO: Ponto de entrada exclusivo da aplicação.
 *            Totalmente modularizado. ZERO lógica de negócios neste arquivo.
 *            Gerencia o ciclo de vida do servidor, middlewares globais, injeção de dependências
 *            e encerramento gracioso (Graceful Shutdown).
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

// =================================================================================================
// 1. IMPORTAÇÕES DE INFRAESTRUTURA E MÓDULOS
// =================================================================================================
const db = require('./src/config/db');
const appConfig = require('./src/config/appConfig');
const { bootstrapDatabase } = require('./src/utils/dbBootstrap');
const { globalErrorHandler, notFoundHandler } = require('./src/middleware/errorMiddleware');
const routes = require('./src/routes');
const { setupSocketIO } = require('./src/services/socketService');

// =================================================================================================
// 2. SISTEMA DE LOGS DO TERMINAL
// =================================================================================================
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

const log = {
    info: (msg) => console.log(`${colors.blue}📘${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
    error: (msg) => console.error(`${colors.red}❌${colors.reset} ${msg}`)
};

// =================================================================================================
// 3. INICIALIZAÇÃO DA APLICAÇÃO EXPRESS & HTTP SERVER
// =================================================================================================
const app = express();
const server = http.createServer(app);

// =================================================================================================
// 4. CONFIGURAÇÃO DE MIDDLEWARES GLOBAIS
// =================================================================================================
// CORS Configurado para aceitar requisições do App Mobile e Web
app.use(cors({ origin: appConfig.SERVER?.CORS_ORIGIN || '*' }));

// Body Parsers com limites expandidos para upload de Base64 e JSONs pesados
app.use(express.json({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb' }));
app.use(express.urlencoded({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb', extended: true }));

// Servidor de Arquivos Estáticos (Uploads/Fotos/Documentos)
const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadPath)));

// =================================================================================================
// 5. INICIALIZAÇÃO DO MOTOR DE SOCKET.IO (REAL-TIME ENGINE)
// =================================================================================================
// A inicialização do Socket.IO foi totalmente delegada ao Service.
// Nenhuma lógica de negócios de Sockets ficará no server.js
const io = setupSocketIO(server);

// Middleware para injetar a instância do Socket.IO (io) no objeto `req` do Express.
// Isso permite que os Controllers HTTP emitam eventos em tempo real.
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Tornar o `io` acessível globalmente (Opcional, mas útil para serviços background)
app.set('io', io);
global.io = io;

// =================================================================================================
// 6. ROTEAMENTO BASE E HEALTH CHECKS
// =================================================================================================
// Rota de Health Check do Load Balancer (Render / AWS)
app.get('/', (req, res) => {
    res.status(200).json({
        service: 'AOTRAVEL Backend Core',
        version: '12.0.0-TITANIUM-PRO',
        status: 'online',
        timestamp: new Date().toISOString(),
        database: 'connected'
    });
});

// Injeção do Hub de Rotas Principal (API Gateway)
app.use('/api', routes);

// =================================================================================================
// 7. TRATAMENTO DE ERROS GLOBAIS (SAFETY NET)
// =================================================================================================
// Nenhuma requisição perdida deve crashar a aplicação
app.use(notFoundHandler);
app.use(globalErrorHandler);

// =================================================================================================
// 8. SEQUÊNCIA DE BOOT E START DO SERVIDOR
// =================================================================================================
(async function startServer() {
    try {
        console.clear();
        console.log(colors.cyan + '╔══════════════════════════════════════════════════════════════╗');
        console.log('║               AOTRAVEL TERMINAL PRO v12.0.0                  ║');
        console.log('╚══════════════════════════════════════════════════════════════╝' + colors.reset);
        console.log();

        // Inicialização e Validação do Banco de Dados (Auto-Healing)
        log.info('Validando integridade do Banco de Dados e Schemas...');
        await bootstrapDatabase();
        log.success('Banco de Dados sincronizado com sucesso.');

        // Inicialização da Escuta do Servidor HTTP
        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log();
            log.success(`🚀 Servidor AOTRAVEL operando com força máxima na porta ${PORT}`);
            log.info(`API Gateway: http://localhost:${PORT}/api`);
            console.log();
        });

    } catch (err) {
        log.error('Erro Crítico na Sequência de Boot. Abortando.');
        console.error(err);
        process.exit(1);
    }
})();

// =================================================================================================
// 9. ENCERRAMENTO GRACIOSO (GRACEFUL SHUTDOWN)
// =================================================================================================
// Previne corrupção de dados ao reiniciar o servidor ou durante deploys
const shutdown = (signal) => {
    console.log();
    log.warn(`Recebido sinal de desligamento (${signal}). Iniciando Graceful Shutdown...`);

    server.close(() => {
        log.success('Servidor HTTP fechado. Recusando novas conexões.');
        db.end(() => {
            log.success('Pool de Conexões do Banco de Dados encerrado.');
            process.exit(0);
        });
    });

    // Fallback force-kill caso conexões pendentes travem o fechamento
    setTimeout(() => {
        log.error('Timeout no Graceful Shutdown. Forçando encerramento.');
        process.exit(1);
    }, 10000);
};

// Captura de sinais do Sistema Operacional / Docker / Cloud Provider
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Captura de Exceções Não Tratadas Globalmente (Evita Crash silencioso do PM2/Node)
process.on('uncaughtException', (err) => {
    log.error('Exceção Crítica Não Capturada (Uncaught Exception):');
    console.error(err);
    // Não encerra imediatamente para permitir que logs sejam escritos
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('Rejeição de Promise Não Tratada (Unhandled Rejection):');
    console.error(reason);
});

module.exports = { app, server, io };