/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - CORE ENGINE
 * =================================================================================================
 * ARQUIVO: server.js (Localizado na Raiz do projeto /backend)
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
// O db.js exporta o 'pool' direto (sem chaves)
const db = require('./src/config/db');
// O appConfig exporta o objeto SYSTEM_CONFIG direto (sem chaves)
const appConfig = require('./src/config/appConfig');

// 2. IMPORTAÇÃO DE UTILITÁRIOS E BOOTSTRAP
// O dbBootstrap exporta { bootstrapDatabase } como objeto (com chaves)
const { bootstrapDatabase } = require('./src/utils/dbBootstrap');

// 3. IMPORTAÇÃO DE MIDDLEWARES
// O errorMiddleware exporta { globalErrorHandler, notFoundHandler } como objeto (com chaves)
const { globalErrorHandler, notFoundHandler } = require('./src/middleware/errorMiddleware');

// 4. IMPORTAÇÃO DE ROTAS E SERVIÇOS
// O index de routes exporta o 'router' direto (sem chaves)
const routes = require('./src/routes');
// O socketService exporta { setupSocketIO } como objeto (com chaves)
const { setupSocketIO } = require('./src/services/socketService');

const app = express();
const server = http.createServer(app);

// --- CONFIGURAÇÃO DO SOCKET.IO ---
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 20000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// Injeção de dependência para uso nos controllers via req.app.get('io')
app.set('io', io);

// --- MIDDLEWARES GLOBAIS ---
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Servir arquivos estáticos (Uploads) com fallback de segurança
const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadPath)));

// --- MAPEAMENTO DE ROTAS ---
app.use(routes);

// --- HANDLERS DE ERRO ---
app.use(notFoundHandler); // Captura 404
app.use(globalErrorHandler); // Captura erros 500

// --- INICIALIZAÇÃO (BOOT) ---
(async function startServer() {
    try {
        console.log("--- Iniciando Processo de Boot ---");

        // 1. Sincroniza Banco de Dados e Migrações
        await bootstrapDatabase();
        console.log("✅ Banco de Dados: Tabelas e Schemas verificados.");

        // 2. Inicializa lógica de Sockets
        // Agora o nome bate exatamente com o export do seu socketService.js
        setupSocketIO(io);
        console.log("✅ Socket.io: Eventos configurados.");

        // 3. Liga o Servidor
        const PORT = appConfig.SERVER?.PORT || process.env.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log("--------------------------------------------------");
            console.log(`🚀 SERVIDOR ONLINE NA PORTA: ${PORT}`);
            console.log(`🌍 URL: http://0.0.0.0:${PORT}`);
            console.log("--------------------------------------------------");
        });

    } catch (err) {
        console.error("❌ ERRO CRÍTICO NO BOOT:");
        console.error(err.message);
        process.exit(1);
    }
})();

// Exportação para testes
module.exports = { app, server, io };
