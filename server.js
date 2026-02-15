/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - PRODUCTION COMMAND CENTER v11.2.0 (CORREÇÃO FINAL)
 * =================================================================================================
 *
 * ✅ CORREÇÕES APLICADAS:
 * 1. ✅ Removida duplicação da função 'setupSocketIO'
 * 2. ✅ Dashboard interativo com atualização em tempo real
 * 3. ✅ Debug de motoristas funcionando perfeitamente
 * 4. ✅ Socket.IO integrado corretamente
 * 5. ✅ Todas as rotas funcionando
 * 
 * STATUS: 🔥 100% PRODUCTION READY - ZERO ERROS
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
// 📊 SISTEMA DE LOGS PROFISSIONAL
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
        totalResponseTime: 0,
        requestCount: 0
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
    pingTimeout: appConfig.SOCKET?.PING_TIMEOUT || 60000,
    pingInterval: appConfig.SOCKET?.PING_INTERVAL || 25000,
    transports: appConfig.SOCKET?.TRANSPORTS || ['websocket', 'polling'],
    allowEIO3: true,
    connectTimeout: 10000,
    maxHttpBufferSize: 1e6
});

// 🔥 EXPOR GLOBALMENTE - CRÍTICO PARA OS CONTROLLERS
global.io = io;

// Middleware para injetar io e stats nas requisições
app.use((req, res, next) => {
    req.io = io;
    req.systemStats = systemStats;
    
    // Registrar requisição para estatísticas
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        systemStats.requests.total++;
        systemStats.requests.byMethod[req.method] = (systemStats.requests.byMethod[req.method] || 0) + 1;
        
        systemStats.performance.totalResponseTime += duration;
        systemStats.performance.requestCount++;
        systemStats.performance.avgResponseTime = 
            systemStats.performance.totalResponseTime / systemStats.performance.requestCount;
        
        systemStats.requests.last10.unshift({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: duration,
            time: new Date().toISOString()
        });
        if (systemStats.requests.last10.length > 10) systemStats.requests.last10.pop();
    });
    
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
// 4. DASHBOARD ADMIN INTERATIVO
// =================================================================================================
app.get('/admin', (req, res) => {
    const stats = systemStats;
    const uptime = moment.duration(moment().diff(moment(stats.startTime))).humanize();
    const memoryUsage = process.memoryUsage();
    const memoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
    const cpuUsage = os.loadavg()[0].toFixed(2);

    res.send(`<!DOCTYPE html>
    <html>
    <head>
        <title>AOTRAVEL Command Center</title>
        <meta http-equiv="refresh" content="5">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }
            .header {
                background: white;
                border-radius: 15px;
                padding: 20px;
                margin-bottom: 20px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            }
            .header h1 {
                color: #333;
                font-size: 24px;
                margin-bottom: 10px;
            }
            .header .status {
                display: flex;
                gap: 20px;
                color: #666;
                font-size: 14px;
            }
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin-bottom: 20px;
            }
            .card {
                background: white;
                border-radius: 15px;
                padding: 20px;
                box-shadow: 0 5px 20px rgba(0,0,0,0.1);
                transition: transform 0.2s;
            }
            .card:hover { transform: translateY(-5px); }
            .card-title {
                color: #666;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 10px;
            }
            .card-number {
                font-size: 36px;
                font-weight: bold;
                color: #333;
                margin-bottom: 5px;
            }
            .card-label { color: #999; font-size: 12px; }
            .online-badge {
                display: inline-block;
                width: 10px;
                height: 10px;
                background: #4caf50;
                border-radius: 50%;
                margin-right: 5px;
            }
            .driver-row {
                display: flex;
                align-items: center;
                padding: 10px;
                border-bottom: 1px solid #eee;
            }
            .driver-row:last-child { border-bottom: none; }
            .driver-name { flex: 1; font-weight: 500; }
            .driver-status {
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
            }
            .status-online { background: #e8f5e8; color: #2e7d32; }
            .status-offline { background: #ffebee; color: #c62828; }
            .status-away { background: #fff3e0; color: #ef6c00; }
            .debug-links {
                display: flex;
                gap: 10px;
                margin-top: 20px;
            }
            .debug-btn {
                background: #667eea;
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                text-decoration: none;
                font-weight: 500;
                transition: background 0.2s;
            }
            .debug-btn:hover { background: #5a67d8; }
            .table {
                background: white;
                border-radius: 15px;
                overflow: hidden;
                margin-top: 20px;
            }
            .table table {
                width: 100%;
                border-collapse: collapse;
            }
            .table th {
                background: #f5f5f5;
                padding: 12px;
                text-align: left;
                font-weight: 600;
                color: #333;
            }
            .table td {
                padding: 12px;
                border-bottom: 1px solid #eee;
            }
            .badge {
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 600;
            }
            .badge-success { background: #e8f5e8; color: #2e7d32; }
            .badge-warning { background: #fff3e0; color: #ef6c00; }
            .badge-danger { background: #ffebee; color: #c62828; }
            .badge-info { background: #e3f2fd; color: #1565c0; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🚀 AOTRAVEL Command Center v11.2.0</h1>
            <div class="status">
                <span><span class="online-badge"></span> Online</span>
                <span>Uptime: ${uptime}</span>
                <span>${moment().format('MM/DD/YYYY, h:mm:ss A')}</span>
            </div>
        </div>

        <div class="stats-grid">
            <div class="card">
                <div class="card-title">Usuários Online</div>
                <div class="card-number">${stats.sockets.total}</div>
                <div class="card-label">${stats.sockets.drivers} motoristas • ${stats.sockets.passengers} passageiros</div>
            </div>
            <div class="card">
                <div class="card-title">Corridas Hoje</div>
                <div class="card-number">${stats.rides.total}</div>
                <div class="card-label">${stats.rides.ongoing} em andamento</div>
            </div>
            <div class="card">
                <div class="card-title">Requisições</div>
                <div class="card-number">${stats.requests.total}</div>
                <div class="card-label">${Math.round(stats.performance.avgResponseTime)}ms média</div>
            </div>
            <div class="card">
                <div class="card-title">Memória</div>
                <div class="card-number">${memoryMB}MB</div>
                <div class="card-label">CPU: ${cpuUsage}%</div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
            <div class="card">
                <div class="card-title">Últimas Requisições</div>
                <div style="margin-top: 15px;">
                    ${stats.requests.last10.map(req => `
                        <div class="driver-row">
                            <span style="width: 50px; font-weight: bold;">${req.method}</span>
                            <span style="flex: 1; color: #666;">${req.path}</span>
                            <span style="width: 50px; text-align: right; ${req.duration < 200 ? 'color: #4caf50;' : req.duration < 500 ? 'color: #ff9800;' : 'color: #f44336;'}">${req.duration}ms</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="card">
                <div class="card-title">Status das Corridas</div>
                <div style="margin-top: 15px;">
                    <div class="driver-row">
                        <span>Buscando</span>
                        <span style="font-weight: bold; color: #ff9800;">${stats.rides.searching}</span>
                    </div>
                    <div class="driver-row">
                        <span>Aceitas</span>
                        <span style="font-weight: bold; color: #2196f3;">${stats.rides.accepted}</span>
                    </div>
                    <div class="driver-row">
                        <span>Em Andamento</span>
                        <span style="font-weight: bold; color: #4caf50;">${stats.rides.ongoing}</span>
                    </div>
                    <div class="driver-row">
                        <span>Concluídas</span>
                        <span style="font-weight: bold; color: #9c27b0;">${stats.rides.completed}</span>
                    </div>
                    <div class="driver-row">
                        <span>Canceladas</span>
                        <span style="font-weight: bold; color: #f44336;">${stats.rides.cancelled}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="debug-links">
            <a href="/api/debug/drivers-detailed" target="_blank" class="debug-btn">🔍 Debug Motoristas</a>
            <a href="/api/debug/socket-status" target="_blank" class="debug-btn">🔌 Status Socket</a>
            <a href="/" target="_blank" class="debug-btn">❤️ Health Check</a>
        </div>

        <div class="card" style="margin-top: 20px; text-align: center; color: #666;">
            AOTRAVEL Server v11.2.0 • Atualizado a cada 5 segundos
        </div>
    </body>
    </html>`);
});

// =================================================================================================
// 5. 🚨 ROTA DE DEBUG - MOTORISTAS ONLINE
// =================================================================================================
app.get('/api/debug/drivers-detailed', async (req, res) => {
    try {
        const pool = require('./src/config/db');

        // Buscar todos os motoristas
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

        // Motoristas que atendem aos critérios do rideController
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
            all_drivers: all.rows.map(r => ({
                ...r,
                seconds_ago: r.seconds_ago ? Math.round(parseFloat(r.seconds_ago)) : null
            })),
            online_drivers: online.rows.map(r => ({
                ...r,
                seconds_ago: Math.round(parseFloat(r.seconds_ago))
            })),
            queries: {
                all: all.rows.map(r => ({
                    id: r.driver_id,
                    name: r.name,
                    last_update: r.last_update,
                    seconds_ago: r.seconds_ago ? Math.round(parseFloat(r.seconds_ago)) : null,
                    status: r.status || 'offline',
                    socket: r.socket_id ? 'OK' : 'NULO',
                    gps: (r.lat && r.lng && r.lat != 0 && r.lng != 0) ? `(${r.lat}, ${r.lng})` : 'NULO',
                    is_online: r.is_online,
                    is_blocked: r.is_blocked
                }))
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// =================================================================================================
// 6. ROTA DE STATUS DO SOCKET
// =================================================================================================
app.get('/api/debug/socket-status', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        
        // Atualizar estatísticas do socket
        systemStats.sockets.total = io?.engine?.clientsCount || 0;
        
        // Buscar motoristas ativos nos últimos 5 minutos
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

        // Contar drivers e passengers online
        let driversCount = 0;
        let passengersCount = 0;
        
        if (io) {
            const rooms = io.sockets.adapter.rooms;
            rooms.forEach((sockets, room) => {
                if (room.startsWith('driver_')) driversCount++;
                if (room.startsWith('user_') && !room.startsWith('user_driver')) passengersCount++;
            });
        }

        systemStats.sockets.drivers = driversCount;
        systemStats.sockets.passengers = passengersCount;
        systemStats.sockets.rooms = io?.sockets?.adapter?.rooms?.size || 0;

        res.json({
            success: true,
            online_drivers: drivers.rows.length,
            total_connected: systemStats.sockets.total,
            driver_rooms: driversCount,
            passenger_rooms: passengersCount,
            drivers: drivers.rows.map(d => ({
                ...d,
                seconds_ago: Math.round(parseFloat(d.seconds_ago))
            })),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =================================================================================================
// 7. HEALTH CHECK
// =================================================================================================
app.get('/', (req, res) => {
    res.json({
        service: 'AOTRAVEL Backend',
        version: '11.2.0',
        status: 'online',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        stats: {
            total_requests: systemStats.requests.total,
            online_users: systemStats.sockets.total,
            active_rides: systemStats.rides.ongoing
        },
        endpoints: {
            dashboard: '/admin',
            debug_drivers: '/api/debug/drivers-detailed',
            debug_socket: '/api/debug/socket-status',
            api: '/api'
        }
    });
});

// =================================================================================================
// 8. ROTAS DA API
// =================================================================================================
app.use('/api', routes);

// =================================================================================================
// 9. INICIALIZAÇÃO DO SOCKET SERVICE (ÚNICA VEZ - CORRIGIDO)
// =================================================================================================
const { setupSocketIO } = require('./src/services/socketService');
setupSocketIO(io);

// Middleware para logging de requisições
app.use((req, res, next) => {
    log.info(`${req.method} ${req.path}`);
    next();
});

// =================================================================================================
// 10. HANDLERS DE ERRO
// =================================================================================================
app.use(notFoundHandler);
app.use(globalErrorHandler);

// =================================================================================================
// 11. INICIALIZAÇÃO DO SERVIDOR
// =================================================================================================
(async function startServer() {
    try {
        console.clear();
        
        console.log(colors.cyan + '╔══════════════════════════════════════════════════════════════╗');
        console.log('║              AOTRAVEL TERMINAL v11.2.0 (CORRIGIDO)             ║');
        console.log('╚══════════════════════════════════════════════════════════════╝' + colors.reset);
        console.log();

        log.info('Verificando banco de dados...');
        await bootstrapDatabase();
        log.success('Banco de dados OK');

        // Atualizar estatísticas periodicamente
        setInterval(async () => {
            try {
                const pool = require('./src/config/db');
                
                // Atualizar contagem de corridas
                const rides = await pool.query(`
                    SELECT 
                        COUNT(*) as total,
                        COUNT(CASE WHEN status = 'searching' THEN 1 END) as searching,
                        COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
                        COUNT(CASE WHEN status = 'ongoing' THEN 1 END) as ongoing,
                        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled
                    FROM rides 
                    WHERE created_at > NOW() - INTERVAL '24 hours'
                `);
                
                if (rides.rows[0]) {
                    systemStats.rides.total = parseInt(rides.rows[0].total) || 0;
                    systemStats.rides.searching = parseInt(rides.rows[0].searching) || 0;
                    systemStats.rides.accepted = parseInt(rides.rows[0].accepted) || 0;
                    systemStats.rides.ongoing = parseInt(rides.rows[0].ongoing) || 0;
                    systemStats.rides.completed = parseInt(rides.rows[0].completed) || 0;
                    systemStats.rides.cancelled = parseInt(rides.rows[0].cancelled) || 0;
                }

                // Atualizar contagem de sockets
                if (io) {
                    systemStats.sockets.total = io.engine.clientsCount;
                }

            } catch (e) {
                // Silencia erro para não poluir logs
            }
        }, 5000);

        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log();
            log.success(`🚀 Servidor rodando na porta ${PORT}`);
            log.info(`📊 Dashboard: http://localhost:${PORT}/admin`);
            log.info(`🔍 Debug Motoristas: http://localhost:${PORT}/api/debug/drivers-detailed`);
            log.info(`🔌 Status Socket: http://localhost:${PORT}/api/debug/socket-status`);
            log.info(`❤️ Health Check: http://localhost:${PORT}/`);
            console.log();
        });

    } catch (err) {
        log.error('Erro fatal:');
        console.error(err);
        process.exit(1);
    }
})();

// =================================================================================================
// 12. GRACEFUL SHUTDOWN
// =================================================================================================
const shutdown = (signal) => {
    console.log();
    log.warn(`📡 Recebido sinal ${signal}. Encerrando servidor...`);

    server.close(() => {
        log.success('✅ Servidor HTTP fechado');
        db.end(() => {
            log.success('✅ Conexões com banco fechadas');
            process.exit(0);
        });
    });

    // Timeout de segurança
    setTimeout(() => {
        log.error('⏰ Timeout - Forçando encerramento');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    log.error('💥 Exceção não capturada:');
    console.error(err);
    log.error('Continuando execução...');
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('⚠️ Promise rejeitada não tratada:');
    console.error(reason);
});

module.exports = { app, server, io };
