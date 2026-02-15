/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - PRODUCTION COMMAND CENTER v11.1.0 (FULLY UPDATED - CORRIGIDO)
 * =================================================================================================
 *
 * ✅ CORREÇÕES APLICADAS:
 * 1. ✅ Removida duplicação da importação do setupSocketIO
 * 2. ✅ Exposição global do `io` para ser acessível em controllers e serviços
 * 3. ✅ Middleware para injetar `io` em todas as requisições
 * 4. ✅ Rotas de debug detalhadas para monitoramento
 * 5. ✅ Sistema de shutdown gracefull
 * 6. ✅ Dashboard profissional com estatísticas em tempo real
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
// 1. IMPORTAÇÕES E INICIALIZAÇÃO
// =================================================================================================
const db = require('./src/config/db');
const appConfig = require('./src/config/appConfig');
const { bootstrapDatabase } = require('./src/utils/dbBootstrap');
const { globalErrorHandler, notFoundHandler } = require('./src/middleware/errorMiddleware');
const routes = require('./src/routes');
const { setupSocketIO } = require('./src/services/socketService'); // ✅ APENAS UMA VEZ

const app = express();
const server = http.createServer(app);

// =================================================================================================
// 2. CONFIGURAÇÃO DO SOCKET.IO (COM EXPOSIÇÃO GLOBAL)
// =================================================================================================
const io = new Server(server, {
    cors: {
        origin: appConfig.SERVER?.CORS_ORIGIN || "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    pingTimeout: appConfig.SOCKET?.PING_TIMEOUT || 60000,
    pingInterval: appConfig.SOCKET?.PING_INTERVAL || 25000,
    transports: appConfig.SOCKET?.TRANSPORTS || ['websocket', 'polling']
});

// 🔥 EXPOR GLOBALMENTE - CRÍTICO PARA OS CONTROLLERS
global.io = io;

// Middleware para injetar io e stats nas requisições
app.use((req, res, next) => {
    req.io = io;
    req.systemStats = systemStats;
    
    // Registrar requisição para estatísticas
    systemStats.requests.total++;
    systemStats.requests.byMethod[req.method] = (systemStats.requests.byMethod[req.method] || 0) + 1;
    
    // Medir tempo de resposta
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        systemStats.performance.totalResponseTime += duration;
        systemStats.performance.avgResponseTime = 
            systemStats.performance.totalResponseTime / systemStats.requests.total;
        
        // Manter últimas 10 requisições
        systemStats.requests.last10.unshift({
            method: req.method,
            url: req.url,
            duration,
            timestamp: new Date().toISOString()
        });
        if (systemStats.requests.last10.length > 10) {
            systemStats.requests.last10.pop();
        }
    });
    
    next();
});

app.set('io', io);
app.set('systemStats', systemStats);

// =================================================================================================
// 3. MIDDLEWARES
// =================================================================================================
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb' }));
app.use(express.urlencoded({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb', extended: true }));

const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadPath)));

// =================================================================================================
// 4. DASHBOARD ADMIN PROFISSIONAL
// =================================================================================================
app.get('/admin', (req, res) => {
    const stats = systemStats;
    const uptime = moment.duration(moment().diff(moment(stats.startTime))).humanize();
    const memory = process.memoryUsage();
    const cpu = os.loadavg();

    res.send(`<!DOCTYPE html>
    <html>
    <head>
        <title>AOTRAVEL Dashboard</title>
        <meta http-equiv="refresh" content="5">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                background: #0f172a;
                color: #e2e8f0;
                padding: 20px;
            }
            .container { max-width: 1400px; margin: 0 auto; }
            h1 { 
                font-size: 28px; 
                margin-bottom: 20px;
                background: linear-gradient(135deg, #60a5fa, #a78bfa);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .header {
                background: #1e293b;
                padding: 20px;
                border-radius: 12px;
                margin-bottom: 20px;
                border: 1px solid #334155;
            }
            .stats-grid { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
                gap: 20px; 
                margin-bottom: 20px;
            }
            .card { 
                background: #1e293b; 
                padding: 24px; 
                border-radius: 12px; 
                border: 1px solid #334155;
                transition: transform 0.2s;
            }
            .card:hover { transform: translateY(-2px); border-color: #4b5563; }
            .card h3 { 
                font-size: 14px; 
                color: #94a3b8; 
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .number { 
                font-size: 42px; 
                font-weight: bold; 
                color: #f0f9ff;
                line-height: 1.2;
            }
            .label { color: #94a3b8; font-size: 14px; margin-top: 4px; }
            .progress-bar {
                width: 100%;
                height: 8px;
                background: #334155;
                border-radius: 4px;
                margin-top: 16px;
            }
            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6);
                border-radius: 4px;
                width: 75%;
            }
            .grid-2 { 
                display: grid; 
                grid-template-columns: 1fr 1fr; 
                gap: 20px; 
                margin-bottom: 20px;
            }
            .table {
                background: #1e293b;
                border-radius: 12px;
                border: 1px solid #334155;
                overflow: hidden;
            }
            .table-header {
                padding: 16px;
                background: #2d3a4f;
                font-weight: 600;
                color: #f0f9ff;
            }
            .table-row {
                padding: 12px 16px;
                border-top: 1px solid #334155;
                display: grid;
                grid-template-columns: 1fr 1fr 1fr 1fr;
                font-size: 14px;
            }
            .table-row:hover { background: #2d3a4f; }
            .badge {
                padding: 4px 8px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 600;
            }
            .badge-success { background: #065f46; color: #d1fae5; }
            .badge-warning { background: #92400e; color: #fef3c7; }
            .badge-info { background: #1e3a8a; color: #dbeafe; }
            .footer {
                margin-top: 40px;
                text-align: center;
                color: #64748b;
                font-size: 12px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>AOTRAVEL Terminal v11.1.0</h1>
            
            <div class="header">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="color: #4ade80;">●</span> Online
                        <span style="margin-left: 20px;">Uptime: ${uptime}</span>
                    </div>
                    <div>${new Date().toLocaleString()}</div>
                </div>
            </div>

            <div class="stats-grid">
                <div class="card">
                    <h3>Usuários Online</h3>
                    <div class="number">${stats.sockets.total}</div>
                    <div class="label">${stats.sockets.drivers} motoristas • ${stats.sockets.passengers} passageiros</div>
                </div>
                
                <div class="card">
                    <h3>Corridas Hoje</h3>
                    <div class="number">${stats.rides.total}</div>
                    <div class="label">${stats.rides.ongoing} em andamento</div>
                </div>
                
                <div class="card">
                    <h3>Requisições</h3>
                    <div class="number">${stats.requests.total}</div>
                    <div class="label">${Math.round(stats.performance.avgResponseTime)}ms média</div>
                </div>
                
                <div class="card">
                    <h3>Memória</h3>
                    <div class="number">${Math.round(memory.heapUsed / 1024 / 1024)}MB</div>
                    <div class="label">CPU: ${cpu[0].toFixed(2)}%</div>
                </div>
            </div>

            <div class="grid-2">
                <div class="table">
                    <div class="table-header">Últimas Requisições</div>
                    ${stats.requests.last10.map(req => `
                        <div class="table-row">
                            <span><span class="badge badge-info">${req.method}</span></span>
                            <span>${req.url.substring(0, 30)}</span>
                            <span>${req.duration}ms</span>
                            <span>${new Date(req.timestamp).toLocaleTimeString()}</span>
                        </div>
                    `).join('')}
                </div>

                <div class="table">
                    <div class="table-header">Status das Corridas</div>
                    <div style="padding: 16px;">
                        <div style="margin-bottom: 12px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Buscando</span>
                                <span>${stats.rides.searching}</span>
                            </div>
                            <div class="progress-bar"><div class="progress-fill" style="width: ${(stats.rides.searching / (stats.rides.total || 1)) * 100}%"></div></div>
                        </div>
                        <div style="margin-bottom: 12px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Aceitas</span>
                                <span>${stats.rides.accepted}</span>
                            </div>
                            <div class="progress-bar"><div class="progress-fill" style="width: ${(stats.rides.accepted / (stats.rides.total || 1)) * 100}%"></div></div>
                        </div>
                        <div style="margin-bottom: 12px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Em Andamento</span>
                                <span>${stats.rides.ongoing}</span>
                            </div>
                            <div class="progress-bar"><div class="progress-fill" style="width: ${(stats.rides.ongoing / (stats.rides.total || 1)) * 100}%"></div></div>
                        </div>
                        <div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Concluídas</span>
                                <span>${stats.rides.completed}</span>
                            </div>
                            <div class="progress-bar"><div class="progress-fill" style="width: ${(stats.rides.completed / (stats.rides.total || 1)) * 100}%"></div></div>
                        </div>
                    </div>
                </div>
            </div>

            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <a href="/api/debug/drivers-detailed" style="background: #1e293b; color: #94a3b8; padding: 8px 16px; border-radius: 8px; text-decoration: none; border: 1px solid #334155;">🔍 Debug Motoristas</a>
                <a href="/api/debug/socket-status" style="background: #1e293b; color: #94a3b8; padding: 8px 16px; border-radius: 8px; text-decoration: none; border: 1px solid #334155;">🔌 Status Socket</a>
                <a href="/api/health" style="background: #1e293b; color: #94a3b8; padding: 8px 16px; border-radius: 8px; text-decoration: none; border: 1px solid #334155;">❤️ Health Check</a>
            </div>

            <div class="footer">
                AOTRAVEL Server v11.1.0 • Atualizado a cada 5 segundos
            </div>
        </div>
    </body>
    </html>`);
});

// =================================================================================================
// 5. 🚨 ROTAS DE DEBUG DETALHADAS
// =================================================================================================

// Rota detalhada de motoristas online
app.get('/api/debug/drivers-detailed', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        
        // Todos os motoristas
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

        // Motoristas online por critério
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

        // Contagem via Socket.IO
        const socketDrivers = [];
        if (global.io) {
            const sockets = await global.io.fetchSockets();
            sockets.forEach(socket => {
                if (socket.data?.user?.role === 'driver') {
                    socketDrivers.push({
                        id: socket.data.user.id,
                        name: socket.data.user.name,
                        socketId: socket.id,
                        rooms: Array.from(socket.rooms)
                    });
                }
            });
        }

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            stats: {
                total_drivers: all.rows.length,
                online_by_criteria: online.rows.length,
                socket_connected: socketDrivers.length
            },
            all_drivers: all.rows,
            online_drivers: online.rows,
            socket_drivers: socketDrivers,
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

// Rota de status do Socket
app.get('/api/debug/socket-status', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        
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

        // Informações do Socket.IO
        const socketInfo = {
            connected: global.io?.engine?.clientsCount || 0,
            rooms: [],
            drivers: []
        };

        if (global.io) {
            const sockets = await global.io.fetchSockets();
            socketInfo.drivers = sockets
                .filter(s => s.data?.user?.role === 'driver')
                .map(s => ({
                    id: s.data.user.id,
                    name: s.data.user.name,
                    socketId: s.id,
                    rooms: Array.from(s.rooms)
                }));
        }

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            stats: {
                db_drivers: drivers.rows.length,
                socket_connected: socketInfo.drivers.length
            },
            db_drivers: drivers.rows,
            socket_drivers: socketInfo.drivers
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health Check completo
app.get('/api/health', (req, res) => {
    res.json({
        service: 'AOTRAVEL Backend',
        version: '11.1.0',
        status: 'online',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        stats: {
            requests: systemStats.requests.total,
            sockets: systemStats.sockets.total,
            avgResponse: Math.round(systemStats.performance.avgResponseTime) + 'ms'
        },
        endpoints: {
            dashboard: '/admin',
            debug_drivers: '/api/debug/drivers-detailed',
            debug_socket: '/api/debug/socket-status',
            health: '/api/health'
        }
    });
});

// Rota raiz
app.get('/', (req, res) => {
    res.redirect('/admin');
});

// =================================================================================================
// 6. ROTAS DA API
// =================================================================================================
app.use('/api', routes);

// =================================================================================================
// 7. HANDLERS DE ERRO
// =================================================================================================
app.use(notFoundHandler);
app.use(globalErrorHandler);

// =================================================================================================
// 8. INICIALIZAÇÃO DO SOCKET SERVICE (CHAMADA ÚNICA)
// =================================================================================================
setupSocketIO(io); // ✅ APENAS UMA CHAMADA

// Monitorar conexões socket para estatísticas
io.engine.on('connection', (socket) => {
    systemStats.sockets.total = io.engine.clientsCount;
});

io.on('connection', (socket) => {
    // Atualizar contagem por role quando o usuário se autenticar
    socket.on('authenticated', (user) => {
        if (user.role === 'driver') {
            systemStats.sockets.drivers++;
        } else if (user.role === 'passenger') {
            systemStats.sockets.passengers++;
        }
    });

    socket.on('disconnect', () => {
        systemStats.sockets.total = io.engine.clientsCount;
        // Recalcular roles (simplificado - poderia ser mais preciso)
        systemStats.sockets.drivers = 0;
        systemStats.sockets.passengers = 0;
    });
});

// =================================================================================================
// 9. INICIALIZAÇÃO DO SERVIDOR
// =================================================================================================
(async function startServer() {
    try {
        console.clear();
        
        console.log(colors.cyan + '╔══════════════════════════════════════════════════════════════╗');
        console.log('║              AOTRAVEL TERMINAL v11.1.0 (FULLY UPDATED)         ║');
        console.log('╚══════════════════════════════════════════════════════════════╝' + colors.reset);
        console.log();

        log.info('Verificando banco de dados...');
        await bootstrapDatabase();
        log.success('Banco de dados OK');

        log.socket('Iniciando Socket.IO...');
        log.success('Socket.IO pronto com exposição global');

        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log();
            log.success(`Servidor rodando na porta ${PORT}`);
            log.info(`📊 Dashboard: http://localhost:${PORT}/admin`);
            log.info(`🔍 Debug Motoristas: http://localhost:${PORT}/api/debug/drivers-detailed`);
            log.info(`🔌 Debug Socket: http://localhost:${PORT}/api/debug/socket-status`);
            log.info(`❤️  Health Check: http://localhost:${PORT}/api/health`);
            console.log();
            
            log.divider();
            log.info('Sistema pronto para receber conexões');
            log.divider();
        });

    } catch (err) {
        log.error('Erro fatal:');
        console.error(err);
        process.exit(1);
    }
})();

// =================================================================================================
// 10. GRACEFUL SHUTDOWN
// =================================================================================================
const shutdown = (signal) => {
    console.log();
    log.warn(`Recebido sinal ${signal}. Encerrando...`);
    
    // Fechar todas as conexões socket
    if (global.io) {
        log.info('Fechando conexões Socket.IO...');
        global.io.close();
    }

    server.close(() => {
        log.success('Servidor HTTP fechado');
        db.end(() => {
            log.success('Conexões com banco fechadas');
            log.success('Encerramento completo');
            process.exit(0);
        });
    });

    setTimeout(() => {
        log.error('Timeout - Forçando encerramento');
        process.exit(1);
    }, 10000);
};

// Handlers de processo
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    log.error('Exceção não capturada:');
    console.error(err);
    shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    log.error('Promise rejeitada não tratada:');
    console.error(reason);
});

// =================================================================================================
// EXPORTAÇÕES
// =================================================================================================
module.exports = { app, server, io, systemStats };
