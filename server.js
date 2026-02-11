/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - CORE ENGINE (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: server.js (Localizado na Raiz do projeto /backend)
 * DESCRIÇÃO: Ponto de entrada da aplicação.
 *            Responsável por orquestrar a inicialização de todos os serviços críticos:
 *            1. Database (Pool + Bootstrap/Migrations).
 *            2. Real-Time Engine (Socket.IO).
 *            3. Middleware Chain (Security, Parsing, Logging).
 *            4. HTTP Server.
 *
 * RESILIÊNCIA:
 * - Implementa "Graceful Shutdown" para não corromper dados ao reiniciar no Render.
 * - Garante que o servidor só abre a porta HTTP após o Banco de Dados estar 100% pronto.
 * - Tratamento global de exceções não capturadas (uncaughtException).
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * STATUS: PRODUCTION READY - SEM OMISSÕES
 * =================================================================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');

// 1. IMPORTAÇÃO DE CONFIGURAÇÕES E BANCO
// O db.js exporta o 'pool' direto
const db = require('./src/config/db');
// O appConfig exporta o objeto SYSTEM_CONFIG direto
const appConfig = require('./src/config/appConfig');

// 2. IMPORTAÇÃO DE UTILITÁRIOS E BOOTSTRAP
const { bootstrapDatabase } = require('./src/utils/dbBootstrap');

// 3. IMPORTAÇÃO DE MIDDLEWARES
const { globalErrorHandler, notFoundHandler } = require('./src/middleware/errorMiddleware');

// 4. IMPORTAÇÃO DE ROTAS E SERVIÇOS
const routes = require('./src/routes'); // Carrega index.js automaticamente
const { setupSocketIO } = require('./src/services/socketService');

// Inicialização das Instâncias
const app = express();
const server = http.createServer(app);

// =================================================================================================
// CONFIGURAÇÃO DO SOCKET.IO (REAL-TIME)
// =================================================================================================
const io = new Server(server, {
    cors: {
        origin: appConfig.SERVER?.CORS_ORIGIN || "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    // Configurações agressivas de Ping para redes móveis instáveis (Angola)
    pingTimeout: appConfig.SOCKET?.PING_TIMEOUT || 20000,
    pingInterval: appConfig.SOCKET?.PING_INTERVAL || 25000,
    transports: appConfig.SOCKET?.TRANSPORTS || ['websocket', 'polling']
});

// Injeção de dependência: Permite que req.app.get('io') seja usado nos controllers
app.set('io', io);

// =================================================================================================
// MIDDLEWARES GLOBAIS (PIPELINE)
// =================================================================================================

// 1. Segurança e CORS
app.use(cors({ origin: '*' }));

// 2. Parsing de Corpo (JSON/UrlEncoded) com limites aumentados para Uploads
app.use(express.json({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb' }));
app.use(express.urlencoded({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb', extended: true }));

// 3. Servir Arquivos Estáticos (Uploads)
// Mapeia /uploads na URL para a pasta física no disco
const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadPath)));

// 4. Logging Básico de Requisições (Debug Mode Only)
if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        console.log(`[HTTP] ${req.method} ${req.originalUrl}`);
        next();
    });
}

// 5. Health Check do Render (Ping raiz)
app.get('/', (req, res) => {
    res.status(200).send('AOtravel Backend is Running (Titanium Core)');
});

// =================================================================================================
// MAPEAMENTO DE ROTAS (API V1)
// =================================================================================================
app.use('/api', routes);

// =================================================================================================
// HANDLERS DE ERRO (FINAL DA CADEIA)
// =================================================================================================
app.use(notFoundHandler);     // Captura 404
app.use(globalErrorHandler);  // Captura erros 500

// =================================================================================================
// PROCESSO DE BOOT (INICIALIZAÇÃO SEGURA)
// =================================================================================================
(async function startServer() {
    try {
        console.log("\n==================================================");
        console.log(`🚀 INICIANDO ${appConfig.APP_NAME || 'AOTRAVEL SERVER'}`);
        console.log(`   Versão: ${appConfig.SERVER_VERSION}`);
        console.log("==================================================\n");

        // 1. Sincroniza Banco de Dados e Migrações (Bloqueante)
        // O servidor não sobe se isso falhar, prevenindo inconsistências.
        console.log("⏳ [BOOT] Verificando integridade do Banco de Dados...");
        await bootstrapDatabase();
        console.log("✅ [BOOT] Banco de Dados sincronizado com sucesso.");

        // 2. Inicializa lógica de Sockets
        setupSocketIO(io);
        console.log("✅ [BOOT] Motor Socket.IO inicializado.");

        // 3. Liga o Servidor HTTP
        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log("\n--------------------------------------------------");
            console.log(`🌍 SERVIDOR ONLINE NA PORTA: ${PORT}`);
            console.log(`📡 Endpoint API: http://0.0.0.0:${PORT}/api`);
            console.log("--------------------------------------------------\n");
        });

    } catch (err) {
        console.error("\n❌ [FATAL] ERRO CRÍTICO NO BOOT:");
        console.error(err.message);
        if (err.stack) console.error(err.stack);
        process.exit(1); // Encerra o processo com erro
    }
})();

// =================================================================================================
// GRACEFUL SHUTDOWN (SEGURANÇA DE PROCESSO)
// =================================================================================================
const shutdown = (signal) => {
    console.log(`\n🛑 Recebido sinal ${signal}. Iniciando desligamento gracioso...`);

    server.close(() => {
        console.log('   [HTTP] Servidor fechado.');

        // Fecha conexão com o banco
        db.end(() => {
            console.log('   [DB] Pool de conexões encerrado.');
            process.exit(0);
        });
    });

    // Força o encerramento se demorar mais de 10s
    setTimeout(() => {
        console.error('   [TIMEOUT] Forçando encerramento imediato.');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Captura exceções não tratadas para evitar estado zumbi
process.on('uncaughtException', (err) => {
    console.error('❌ [UNCAUGHT EXCEPTION]', err);
    // Em produção, talvez queiramos reiniciar, mas aqui logamos forte.
});

// Exportação para testes
module.exports = { app, server, io };