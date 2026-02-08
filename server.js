/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - MODULAR EDITION (2026.02.10)
 * =================================================================================================
 */
require('dotenv').config();
const http = require('http');
const { Server } = require("socket.io");
const app = require('./src/app');
const initializeSocket = require('./src/socket/socketManager');
const bootstrapDatabase = require('./src/scripts/bootstrap');
const { logSystem } = require('./src/utils/logger');

// Inicialização
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    pingTimeout: 20000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    maxHttpBufferSize: 1e8,
    connectTimeout: 45000
});

// Disponibilizar IO globalmente no App Express (para Controllers)
app.set('io', io);

// Inicializar Módulos
logSystem('SYSTEM', 'Inicializando módulos do servidor...');

// 1. Banco de Dados
bootstrapDatabase().then(() => {
    // 2. Socket.io
    initializeSocket(io);
    logSystem('SOCKET', 'Motor Real-time inicializado.');

    // 3. Start Server
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`
        ============================================================
        🚀 AOTRAVEL SERVER (MODULAR) IS RUNNING
        ------------------------------------------------------------
        📅 Build Date: 2026.02.10
        📡 Port: ${PORT}
        💾 Database: Connected (NeonDB SSL)
        🔌 Socket.io: Active
        📦 Architecture: Clean/Layered
        ============================================================
        `);
    });
}).catch(err => {
    console.error('CRITICAL STARTUP ERROR:', err);
    process.exit(1);
});