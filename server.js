/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - TITANIUM ENTRY POINT (REVISÃO 2026.02.10)
 * =================================================================================================
 * 
 * ARQUIVO: server.js
 * DESCRIÇÃO: Inicializador do ecossistema. Orquestra Banco de Dados, Express e Sockets.
 */
require('dotenv').config();
const http = require('http');
const { Server } = require("socket.io");
const app = require('./src/app');
const initializeSocket = require('./src/socket/socketManager');
const bootstrapDatabase = require('./src/scripts/bootstrap');
const { logSystem } = require('./src/utils/logger');

// 1. Criar Servidor HTTP
const server = http.createServer(app);

// 2. Configurar Socket.io (Configurações Titanium para Angola 3G/4G)
const io = new Server(server, {
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"], 
        credentials: true 
    },
    pingTimeout: 20000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    maxHttpBufferSize: 1e8 // 100MB para fotos de BI no Chat
});

// 3. Injetar IO globalmente para uso em Controllers
app.set('io', io);
global.io = io; 

logSystem('SYSTEM', 'Iniciando sequência de boot Titanium...');

// 4. Executar Boot Orquestrado
bootstrapDatabase().then(() => {
    
    // Inicializar o Gerenciador de Sockets
    initializeSocket(io);
    logSystem('SOCKET', 'Motor Real-time ativado.');

    // Iniciar escuta na porta definida
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`
        ============================================================
        🚀 AOTRAVEL SERVER (MODULAR EDITION) IS LIVE
        ------------------------------------------------------------
        📅 Build Date: 2026.02.10
        📡 Port: ${PORT}
        💾 Database: Connected (NeonDB SSL)
        🔌 Socket.io: Active (Titanium Sync)
        📦 Status: 100% OPERACIONAL - ZERO ERRORS
        ============================================================
        `);
    });

}).catch(err => {
    console.error('🛑 FALHA CRÍTICA NO STARTUP DO SERVIDOR:', err.message);
    process.exit(1); 
});
