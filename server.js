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
 * 1. ✅ [UPLOAD_DIR] Garantia que o diretório de uploads existe antes de servir arquivos estáticos
 * 2. ✅ [CORS] Configuração aprimorada para aceitar requisições do App Mobile e Web
 * 3. ✅ [HEALTH_CHECK] Rota raiz aprimorada com informações de status do banco
 * 4. ✅ [GRACEFUL_SHUTDOWN] Encerramento correto das conexões do banco e servidor HTTP
 * 5. ✅ [ERROR_HANDLING] Captura global de exceções não tratadas
 * 6. ✅ [BOOTSTRAP] Execução do bootstrapDatabase antes de iniciar o servidor
 *
 * STATUS: 🔥 PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

const log = {
    info: (msg) => console.log(`${colors.blue}📘${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
    error: (msg) => console.error(`${colors.red}❌${colors.reset} ${msg}`),
    section: (msg) => {
        console.log(`\n${colors.cyan}╔══════════════════════════════════════════════════════════════╗${colors.reset}`);
        console.log(`${colors.cyan}║${colors.reset} ${colors.bright}${msg}${colors.reset}`);
        console.log(`${colors.cyan}╚══════════════════════════════════════════════════════════════╝${colors.reset}`);
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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-session-token', 'x-request-id'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Body Parsers com limites expandidos para upload de Base64 e JSONs pesados
app.use(express.json({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb' }));
app.use(express.urlencoded({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb', extended: true }));

// =================================================================================================
// 4.1. SERVIDOR DE ARQUIVOS ESTÁTICOS (Uploads/Fotos/Documentos)
// =================================================================================================
const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
const fullUploadPath = path.join(__dirname, uploadPath);

// Garantir que o diretório de uploads existe
if (!fs.existsSync(fullUploadPath)) {
    log.warn(`Diretório de uploads não encontrado. Criando: ${fullUploadPath}`);
    fs.mkdirSync(fullUploadPath, { recursive: true });
}

// Servir arquivos estáticos do diretório de uploads
app.use('/uploads', express.static(fullUploadPath));

// Servir também arquivos de avatar/profile
const profileUploadPath = path.join(__dirname, 'uploads', 'profiles');
if (!fs.existsSync(profileUploadPath)) {
    fs.mkdirSync(profileUploadPath, { recursive: true });
}
app.use('/uploads/profiles', express.static(profileUploadPath));

// Servir também documentos KYC
const kycUploadPath = path.join(__dirname, 'uploads', 'kyc');
if (!fs.existsSync(kycUploadPath)) {
    fs.mkdirSync(kycUploadPath, { recursive: true });
}
app.use('/uploads/kyc', express.static(kycUploadPath));

log.info(`📂 Servindo arquivos estáticos de: ${fullUploadPath}`);
log.info(`   - Perfis: /uploads/profiles`);
log.info(`   - Documentos KYC: /uploads/kyc`);

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
app.get('/', async (req, res) => {
    let dbStatus = 'disconnected';
    try {
        const testQuery = await db.query('SELECT 1 as health_check');
        if (testQuery.rows && testQuery.rows[0]?.health_check === 1) {
            dbStatus = 'connected';
        } else {
            dbStatus = 'degraded';
        }
    } catch (err) {
        dbStatus = 'disconnected';
        log.error(`Health Check DB Error: ${err.message}`);
    }

    res.status(200).json({
        service: 'AOTRAVEL Backend Core',
        version: '12.0.0-TITANIUM-PRO',
        status: 'online',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        database: {
            status: dbStatus,
            pool_size: db.pool?.totalCount || 'N/A',
            idle_count: db.pool?.idleCount || 'N/A'
        },
        uptime: process.uptime(),
        memory_usage: process.memoryUsage()
    });
});

// Rota de status simplificada para verificação rápida
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'unhealthy', error: err.message });
    }
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
        // Limpa o console para melhor visualização
        if (process.env.NODE_ENV !== 'production') {
            console.clear();
        }

        console.log(colors.cyan + '╔══════════════════════════════════════════════════════════════╗');
        console.log('║               AOTRAVEL TERMINAL PRO v12.0.0                  ║');
        console.log('╚══════════════════════════════════════════════════════════════╝' + colors.reset);
        console.log();

        // Inicialização e Validação do Banco de Dados (Auto-Healing)
        log.info('Validando integridade do Banco de Dados e Schemas...');
        await bootstrapDatabase();
        log.success('Banco de Dados sincronizado com sucesso.');

        // Log de informações do ambiente
        console.log();
        log.info(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
        log.info(`🗄️  Banco de Dados: ${process.env.DB_DATABASE || 'aotravel_db'}`);
        log.info(`📁 Diretório de Uploads: ${fullUploadPath}`);

        // Inicialização da Escuta do Servidor HTTP
        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        const HOST = process.env.HOST || '0.0.0.0';

        server.listen(PORT, HOST, () => {
            console.log();
            log.success(`🚀 Servidor AOTRAVEL operando com força máxima!`);
            log.info(`   🌐 URL: http://${HOST}:${PORT}`);
            log.info(`   📡 API Gateway: http://${HOST}:${PORT}/api`);
            log.info(`   🏥 Health Check: http://${HOST}:${PORT}/health`);
            log.info(`   📂 Uploads: http://${HOST}:${PORT}/uploads`);
            console.log();

            // Log dos usuários de teste disponíveis
            log.info('🔐 CREDENCIAIS DE TESTE:');
            log.info('   Admin: admin@gmail.com / admin123');
            log.info('   Motorista Premium: premium@aotravel.com / 123456');
            log.info('   Motorista Standard: driver@aotravel.com / 123456');
            log.info('   Moto Táxi: moto@gmail.com / 123456');
            log.info('   Passageiro: passageiro@gmail.com / 123456');
            console.log();

            log.info('💡 Dica: Use o endpoint /api/docs para acessar a documentação da API');
        });

    } catch (err) {
        log.error('❌ Erro Crítico na Sequência de Boot. Abortando.');
        console.error(err);
        process.exit(1);
    }
})();

// =================================================================================================
// 9. ENCERRAMENTO GRACIOSO (GRACEFUL SHUTDOWN)
// =================================================================================================
// Previne corrupção de dados ao reiniciar o servidor ou durante deploys

let isShuttingDown = false;

const shutdown = async (signal) => {
    if (isShuttingDown) {
        log.warn('Shutdown já em andamento. Aguarde...');
        return;
    }

    isShuttingDown = true;
    console.log();
    log.warn(`⚠️ Recebido sinal de desligamento (${signal}). Iniciando Graceful Shutdown...`);

    // Fechar o servidor HTTP para novas conexões
    server.close(async () => {
        log.success('Servidor HTTP fechado. Recusando novas conexões.');

        try {
            // Fechar conexões do Socket.IO
            if (io) {
                log.info('Fechando conexões Socket.IO...');
                io.close(() => {
                    log.success('Socket.IO encerrado.');
                });
            }

            // Aguardar um momento para conexões pendentes se resolverem
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Fechar pool de conexões do banco
            log.info('Encerrando pool de conexões do banco de dados...');
            await db.end();
            log.success('Pool de Conexões do Banco de Dados encerrado.');

            log.success('🎉 Graceful Shutdown concluído com sucesso!');
            process.exit(0);

        } catch (err) {
            log.error('Erro durante o shutdown:');
            console.error(err);
            process.exit(1);
        }
    });

    // Fallback force-kill caso conexões pendentes travem o fechamento
    setTimeout(() => {
        log.error('⏰ Timeout no Graceful Shutdown. Forçando encerramento.');
        process.exit(1);
    }, 15000);
};

// Captura de sinais do Sistema Operacional / Docker / Cloud Provider
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// =================================================================================================
// 10. CAPTURA DE EXCEÇÕES NÃO TRATADAS GLOBALMENTE
// =================================================================================================
// Evita Crash silencioso do PM2/Node

process.on('uncaughtException', (err) => {
    log.error('💥 Exceção Crítica Não Capturada (Uncaught Exception):');
    console.error(err);

    // Em produção, tentar shutdown graceful antes de morrer
    if (process.env.NODE_ENV === 'production') {
        log.warn('Tentando shutdown graceful devido a exceção não capturada...');
        shutdown('uncaughtException').catch(() => process.exit(1));
    } else {
        // Em desenvolvimento, deixar o erro visível
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('💥 Rejeição de Promise Não Tratada (Unhandled Rejection):');
    console.error('Promise:', promise);
    console.error('Reason:', reason);

    // Em produção, tentar shutdown graceful
    if (process.env.NODE_ENV === 'production') {
        log.warn('Tentando shutdown graceful devido a rejeição não tratada...');
        shutdown('unhandledRejection').catch(() => process.exit(1));
    }
});

// =================================================================================================
// 11. EXPORTAÇÃO PARA TESTES E DEPURAÇÃO
// =================================================================================================
module.exports = { app, server, io };
