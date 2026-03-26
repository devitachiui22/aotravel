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
 * ✅ CORREÇÕES APLICADAS:
 * 1. Servidor de arquivos estáticos configurado corretamente para pasta 'uploads'
 * 2. Socket.IO integrado e rodando junto com Express
 * 3. Middleware de injeção do Socket.IO nos controllers
 * 4. Rotas centralizadas e organizadas
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
    error: (msg) => console.error(`${colors.red}❌${colors.reset} ${msg}`),
    section: (msg) => {
        console.log(`\n${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);
        console.log(`${colors.cyan}   ${msg}${colors.reset}`);
        console.log(`${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}\n`);
    }
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
const corsOptions = {
    origin: appConfig.SERVER?.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-session-token'],
    credentials: true
};
app.use(cors(corsOptions));

// Body Parsers com limites expandidos para upload de Base64 e JSONs pesados
app.use(express.json({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb' }));
app.use(express.urlencoded({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb', extended: true }));

// =================================================================================================
// 5. SERVIDOR DE ARQUIVOS ESTÁTICOS (UPLOADS/FOTOS/DOCUMENTOS)
// =================================================================================================
// Crucial para visualização de documentos KYC e fotos de perfil no Admin
const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
const uploadsAbsolutePath = path.join(__dirname, uploadPath);

// Servir arquivos estáticos da pasta uploads
app.use('/uploads', express.static(uploadsAbsolutePath));
log.info(`📁 Servindo arquivos estáticos de: ${uploadsAbsolutePath}`);

// Também serve a pasta raiz de uploads para compatibilidade
app.use('/files', express.static(uploadsAbsolutePath));

// =================================================================================================
// 6. INICIALIZAÇÃO DO MOTOR DE SOCKET.IO (REAL-TIME ENGINE)
// =================================================================================================
// A inicialização do Socket.IO foi totalmente delegada ao Service.
// Nenhuma lógica de negócios de Sockets ficará no server.js
log.info('🔌 Inicializando Socket.IO...');
const io = setupSocketIO(server);
log.success('✅ Socket.IO inicializado com sucesso');

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
// 7. ROTEAMENTO BASE E HEALTH CHECKS
// =================================================================================================
// Rota de Health Check do Load Balancer (Render / AWS / Railway)
app.get('/', (req, res) => {
    res.status(200).json({
        service: 'AOTRAVEL Backend Core',
        version: '12.0.0-TITANIUM-PRO',
        status: 'online',
        timestamp: new Date().toISOString(),
        database: 'connected',
        socket: io ? 'active' : 'inactive'
    });
});

// Health check mais detalhado para monitoramento
app.get('/health', async (req, res) => {
    try {
        // Verifica conexão com o banco de dados
        await db.query('SELECT 1');
        res.status(200).json({
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            services: {
                database: 'connected',
                socket: io ? 'active' : 'inactive'
            }
        });
    } catch (err) {
        res.status(503).json({
            status: 'unhealthy',
            error: 'Database connection failed',
            timestamp: new Date().toISOString()
        });
    }
});

// Injeção do Hub de Rotas Principal (API Gateway)
// Todas as rotas são organizadas no arquivo routes/index.js
app.use('/api', routes);

// Rota de debug para verificar rotas disponíveis (apenas em desenvolvimento)
if (process.env.NODE_ENV !== 'production') {
    app.get('/api/routes', (req, res) => {
        const routesList = [];
        const stack = app._router.stack;
        stack.forEach(layer => {
            if (layer.route) {
                const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
                routesList.push({
                    path: layer.route.path,
                    methods: methods
                });
            }
        });
        res.json(routesList);
    });
}

// =================================================================================================
// 8. TRATAMENTO DE ERROS GLOBAIS (SAFETY NET)
// =================================================================================================
// Nenhuma requisição perdida deve crashar a aplicação
app.use(notFoundHandler);
app.use(globalErrorHandler);

// =================================================================================================
// 9. SEQUÊNCIA DE BOOT E START DO SERVIDOR
// =================================================================================================
(async function startServer() {
    try {
        console.clear();
        console.log(colors.cyan + '╔══════════════════════════════════════════════════════════════╗');
        console.log('║               AOTRAVEL TERMINAL PRO v12.0.0                  ║');
        console.log('║                   TITANIUM EDITION                            ║');
        console.log('╚══════════════════════════════════════════════════════════════╝' + colors.reset);
        console.log();

        // Inicialização e Validação do Banco de Dados (Auto-Healing)
        log.section('🔧 VALIDAÇÃO DO BANCO DE DADOS');
        log.info('Validando integridade do Banco de Dados e Schemas...');
        await bootstrapDatabase();
        log.success('Banco de Dados sincronizado com sucesso.');

        // Verifica se a pasta de uploads existe, se não, cria
        const fs = require('fs');
        if (!fs.existsSync(uploadsAbsolutePath)) {
            fs.mkdirSync(uploadsAbsolutePath, { recursive: true });
            log.info(`📁 Pasta de uploads criada: ${uploadsAbsolutePath}`);
        }

        // Cria subpastas para organizar os uploads
        const subfolders = ['documents', 'avatars', 'rides', 'receipts'];
        subfolders.forEach(subfolder => {
            const subfolderPath = path.join(uploadsAbsolutePath, subfolder);
            if (!fs.existsSync(subfolderPath)) {
                fs.mkdirSync(subfolderPath, { recursive: true });
                log.info(`📁 Subpasta criada: ${subfolderPath}`);
            }
        });

        // Inicialização da Escuta do Servidor HTTP
        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log();
            log.success(`🚀 Servidor AOTRAVEL operando com força máxima na porta ${PORT}`);
            log.info(`🌐 API Gateway: http://localhost:${PORT}/api`);
            log.info(`📁 Arquivos estáticos: http://localhost:${PORT}/uploads`);
            log.info(`🔌 WebSocket: ws://localhost:${PORT}`);
            console.log();

            // Log das rotas disponíveis em desenvolvimento
            if (process.env.NODE_ENV !== 'production') {
                log.info('📋 Rotas principais disponíveis:');
                log.info(`   POST   /api/auth/login`);
                log.info(`   POST   /api/auth/signup`);
                log.info(`   GET    /api/wallet/balance`);
                log.info(`   POST   /api/wallet/transfer`);
                log.info(`   POST   /api/rides/request`);
                log.info(`   POST   /api/rides/accept`);
                log.info(`   GET    /api/admin/stats`);
                console.log();
            }
        });

    } catch (err) {
        log.error('❌ Erro Crítico na Sequência de Boot. Abortando.');
        console.error(err);
        process.exit(1);
    }
})();

// =================================================================================================
// 10. ENCERRAMENTO GRACIOSO (GRACEFUL SHUTDOWN)
// =================================================================================================
// Previne corrupção de dados ao reiniciar o servidor ou durante deploys
let isShuttingDown = false;

const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log();
    log.warn(`Recebido sinal de desligamento (${signal}). Iniciando Graceful Shutdown...`);

    // Fecha servidor HTTP primeiro (para não aceitar novas conexões)
    server.close(async () => {
        log.success('✅ Servidor HTTP fechado. Recusando novas conexões.');

        // Fecha conexões do Socket.IO
        if (io) {
            io.close(() => {
                log.success('✅ Socket.IO encerrado.');
            });
        }

        // Fecha pool de conexões do banco de dados
        try {
            await db.end();
            log.success('✅ Pool de Conexões do Banco de Dados encerrado.');
        } catch (err) {
            log.error(`❌ Erro ao fechar conexões do banco: ${err.message}`);
        }

        process.exit(0);
    });

    // Fallback force-kill caso conexões pendentes travem o fechamento
    setTimeout(() => {
        log.error('❌ Timeout no Graceful Shutdown. Forçando encerramento.');
        process.exit(1);
    }, 10000);
};

// Captura de sinais do Sistema Operacional / Docker / Cloud Provider
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Captura de Exceções Não Tratadas Globalmente (Evita Crash silencioso do PM2/Node)
process.on('uncaughtException', (err) => {
    log.error('💥 Exceção Crítica Não Capturada (Uncaught Exception):');
    console.error(err);
    // Não encerra imediatamente para permitir que logs sejam escritos
    // Em produção, você pode querer encerrar após log
    if (process.env.NODE_ENV === 'production') {
        shutdown('uncaughtException');
    }
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('💥 Rejeição de Promise Não Tratada (Unhandled Rejection):');
    console.error(reason);
    // Em produção, pode ser seguro continuar
});

// =================================================================================================
// 11. EXPORTAÇÃO PARA TESTES E INTEGRAÇÃO
// =================================================================================================
module.exports = { app, server, io };
