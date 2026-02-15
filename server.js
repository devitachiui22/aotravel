/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - PRODUCTION COMMAND CENTER v11.0.0
 * =================================================================================================
 *
 * ARQUIVO: server.js
 * DESCRIÇÃO: Servidor principal com dashboard profissional
 *
 * ✅ CORREÇÕES:
 * 1. ✅ Rota de debug movida para cá (estava no socketService.js causando erro)
 * 2. ✅ Todas as rotas organizadas corretamente
 * 3. ✅ Logs detalhados
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');
const moment = require('moment');
const os = require('os');

// Cores para o terminal
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
};

// =================================================================================================
// 📊 SISTEMA DE LOGS
// =================================================================================================
const log = {
    info: (msg) => console.log(`${colors.blue}📘${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
    socket: (msg) => console.log(`${colors.magenta}🔌${colors.reset} ${msg}`),
    ride: (msg) => console.log(`${colors.cyan}🚕${colors.reset} ${msg}`),
    divider: () => console.log(colors.gray + '─'.repeat(60) + colors.reset)
};

// =================================================================================================
// 📊 ESTADO GLOBAL DO SISTEMA
// =================================================================================================
const systemStats = {
    startTime: new Date(),
    requests: {
        total: 0,
        byMethod: { GET: 0, POST: 0, PUT: 0, DELETE: 0 },
        last10: []
    },
    rides: {
        total: 0,
        searching: 0,
        accepted: 0,
        ongoing: 0,
        completed: 0,
        cancelled: 0
    },
    sockets: {
        total: 0,
        drivers: 0,
        passengers: 0,
        rooms: 0
    },
    performance: {
        avgResponseTime: 0,
        totalResponseTime: 0
    }
};

// =================================================================================================
// 1. IMPORTAÇÕES
// =================================================================================================
const db = require('./src/config/db');
const appConfig = require('./src/config/appConfig');
const { bootstrapDatabase } = require('./src/utils/dbBootstrap');
const { globalErrorHandler, notFoundHandler } = require('./src/middleware/errorMiddleware');
const routes = require('./src/routes');
const { setupSocketIO } = require('./src/services/socketService');

const app = express();
const server = http.createServer(app);

// =================================================================================================
// 2. CONFIGURAÇÃO DO SOCKET.IO
// =================================================================================================
const io = new Server(server, {
    cors: {
        origin: appConfig.SERVER?.CORS_ORIGIN || "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    pingTimeout: appConfig.SOCKET?.PING_TIMEOUT || 20000,
    pingInterval: appConfig.SOCKET?.PING_INTERVAL || 25000,
    transports: appConfig.SOCKET?.TRANSPORTS || ['websocket', 'polling']
});

// Injetar io nas requisições
app.use((req, res, next) => {
    req.io = io;
    req.systemStats = systemStats;
    next();
});

app.set('io', io);
app.set('systemStats', systemStats);

// =================================================================================================
// 3. MIDDLEWARES
// =================================================================================================

// CORS
app.use(cors({ origin: '*' }));

// Parsing
app.use(express.json({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb' }));
app.use(express.urlencoded({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb', extended: true }));

// Arquivos estáticos
const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadPath)));

// =================================================================================================
// 4. DASHBOARD ADMIN
// =================================================================================================
app.get('/admin', (req, res) => {
    const stats = systemStats;
    const uptime = moment.duration(moment().diff(moment(stats.startTime))).humanize();

    res.send(`<!DOCTYPE html>
    <html>
    <head>
        <title>AOTRAVEL Dashboard</title>
        <style>
            body { font-family: Arial; padding: 20px; background: #f5f5f5; }
            .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
            .card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .number { font-size: 32px; font-weight: bold; color: #333; }
            .label { color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <h1>AOTRAVEL Terminal</h1>
        <p>Uptime: ${uptime}</p>
        <div class="stats">
            <div class="card">
                <div class="number">${stats.sockets.total}</div>
                <div class="label">Usuários Online</div>
            </div>
            <div class="card">
                <div class="number">${stats.rides.total}</div>
                <div class="label">Corridas Hoje</div>
            </div>
            <div class="card">
                <div class="number">${stats.requests.total}</div>
                <div class="label">Requisições</div>
            </div>
            <div class="card">
                <div class="number">${Math.round(stats.performance.avgResponseTime)}ms</div>
                <div class="label">Resposta Média</div>
            </div>
        </div>
    </body>
    </html>`);
});

// =================================================================================================
// 5. 🚨 ROTA DE DEBUG - MOTORISTAS ONLINE (AQUI É O LOCAL CORRETO!)
// =================================================================================================
app.get('/api/debug/drivers-detailed', async (req, res) => {
    try {
        const pool = require('./src/config/db');

        // 1. Verificar todos os registros
        const all = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.socket_id,
                TO_CHAR(dp.last_update, 'YYYY-MM-DD HH24:MI:SS') as last_update,
                EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago,
                dp.status,
                u.name,
                u.is_online,
                u.is_blocked,
                u.role
            FROM driver_positions dp
            RIGHT JOIN users u ON dp.driver_id = u.id
            WHERE u.role = 'driver'
            ORDER BY dp.last_update DESC NULLS LAST
        `);

        // 2. Verificar motoristas online (critérios do rideController)
        const online = await pool.query(`
            SELECT
                dp.driver_id,
                u.name,
                dp.last_update,
                EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.status = 'online'
                AND dp.last_update > NOW() - INTERVAL '2 minutes'
                AND u.is_online = true
                AND u.is_blocked = false
                AND u.role = 'driver'
                AND dp.socket_id IS NOT NULL
                AND (dp.lat != 0 OR dp.lng != 0)
        `);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            stats: {
                total_drivers: all.rows.length,
                online_by_criteria: online.rows.length
            },
            all_drivers: all.rows,
            online_drivers: online.rows,
            queries: {
                all: all.rows.map(r => ({
                    id: r.driver_id,
                    name: r.name,
                    last_update: r.last_update,
                    seconds_ago: Math.round(r.seconds_ago),
                    status: r.status,
                    socket: r.socket_id ? 'OK' : 'NULO',
                    gps: r.lat && r.lng ? `(${r.lat}, ${r.lng})` : 'NULO',
                    is_online: r.is_online,
                    is_blocked: r.is_blocked
                }))
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =================================================================================================
// 6. HEALTH CHECK
// =================================================================================================
app.get('/', (req, res) => {
    res.json({
        service: 'AOTRAVEL Backend',
        version: '11.0.0',
        status: 'online',
        timestamp: new Date().toISOString(),
        dashboard: '/admin',
        debug: '/api/debug/drivers-detailed'
    });
});

// =================================================================================================
// 7. ROTAS DA API
// =================================================================================================
app.use('/api', routes);

// =================================================================================================
// 8. HANDLERS DE ERRO
// =================================================================================================
app.use(notFoundHandler);
app.use(globalErrorHandler);

// =================================================================================================
// 9. INICIALIZAÇÃO DO SERVIDOR
// =================================================================================================
(async function startServer() {
    try {
        console.clear();

        console.log(colors.cyan + '╔══════════════════════════════════════════════════════════════╗');
        console.log('║                   AOTRAVEL TERMINAL v11.0.0                   ║');
        console.log('╚══════════════════════════════════════════════════════════════╝' + colors.reset);
        console.log();

        log.info('Verificando banco de dados...');
        await bootstrapDatabase();
        log.success('Banco de dados OK');

        log.socket('Iniciando Socket.IO...');
        setupSocketIO(io);
        log.success('Socket.IO pronto');

        // Monitora conexões socket
        io.engine.on('connection', (socket) => {
            systemStats.sockets.total = io.engine.clientsCount;
        });

        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log();
            log.success(`Servidor rodando na porta ${PORT}`);
            log.info(`Dashboard: http://localhost:${PORT}/admin`);
            log.info(`API: http://localhost:${PORT}/api`);
            log.info(`Debug: http://localhost:${PORT}/api/debug/drivers-detailed`);
            console.log();
        });

    } catch (err) {
        log.error('Erro fatal:');
        console.error(err);
        process.exit(1);
    }
})();

// GET /api/debug/socket-status
app.get('/api/debug/socket-status', async (req, res) => {
  try {
    const drivers = await pool.query(`
      SELECT
        dp.driver_id,
        u.name,
        dp.status,
        dp.socket_id,
        TO_CHAR(dp.last_update, 'HH24:MI:SS') as last_update,
        dp.lat,
        dp.lng,
        EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago
      FROM driver_positions dp
      JOIN users u ON dp.driver_id = u.id
      WHERE dp.last_update > NOW() - INTERVAL '5 minutes'
      ORDER BY dp.last_update DESC
    `);

    res.json({
      success: true,
      online_drivers: drivers.rows.length,
      drivers: drivers.rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =================================================================================================
// 10. GRACEFUL SHUTDOWN
// =================================================================================================
const shutdown = (signal) => {
    console.log();
    log.warn(`Recebido sinal ${signal}. Encerrando...`);

    server.close(() => {
        log.success('Servidor HTTP fechado');
        db.end(() => {
            log.success('Conexões com banco fechadas');
            process.exit(0);
        });
    });

    setTimeout(() => {
        log.error('Timeout - Forçando encerramento');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    log.error('Exceção não capturada:');
    console.error(err);
});

module.exports = { app, server, io };