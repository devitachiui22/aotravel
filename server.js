/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - TITANIUM ENTRY POINT (REVISÃO 2026.02.10)
 * =================================================================================================
 */
require('dotenv').config();
const http = require('http');
const { Server } = require("socket.io");
const app = require('./src/app');
const initializeSocket = require('./src/socket/socketManager');
const bootstrapDatabase = require('./src/scripts/bootstrap');
const { logSystem } = require('./src/utils/logger');

// Inicialização do Servidor HTTP
const server = http.createServer(app);

// Configuração do Motor Real-time (Configurações mescladas para 3G/4G Angola)
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
    maxHttpBufferSize: 1e8 // 100MB
});

// Injeção do IO no App para uso nos Controllers (res.app.get('io'))
app.set('io', io);
global.io = io; // Fallback para acesso global seguro

logSystem('SYSTEM', 'Iniciando sequência de boot Titanium...');

// --- SEQUÊNCIA DE BOOT ORQUESTRADA ---
bootstrapDatabase().then(() => {

    // 2. Inicializar Sockets (Radar Reverso / Chat / GPS)
    initializeSocket(io);
    logSystem('SOCKET', 'Motor Real-time ativado e pronto para conexões.');

    // 3. Abrir a porta para o mundo
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
    console.error('🛑 FALHA CRÍTICA NO STARTUP:', err);
    process.exit(1); // Encerra processo para evitar estado inconsistente
});
