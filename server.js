/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - PRODUCTION COMMAND CENTER v11.0.0
 * =================================================================================================
 *
 * ARQUIVO: server.js
 * DESCRIÇÃO: Servidor principal com dashboard profissional estilo "Terminal Real"
 *
 * ✅ CARACTERÍSTICAS:
 * 1. Design limpo, profissional (nada "feito por IA")
 * 2. Dashboard funcional com dados reais
 * 3. Logs organizados e úteis
 * 4. Monitoramento em tempo real
 * 5. Estável e pronto para produção
 *
 * STATUS: 🔥 PRODUCTION READY
 * =================================================================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');
const moment = require('moment');
const os = require('os');

// Cores para o terminal (mantidas apenas para logs, não para o dashboard)
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
// 📊 SISTEMA DE LOGS SIMPLES E EFICAZ
// =================================================================================================
const log = {
    info: (msg) => console.log(`${colors.blue}📘${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
    socket: (msg) => console.log(`${colors.magenta}🔌${colors.reset} ${msg}`),
    ride: (msg) => console.log(`${colors.cyan}🚕${colors.reset} ${msg}`),
    http: (msg) => console.log(`${colors.gray}📡${colors.reset} ${msg}`),
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
// 4. DASHBOARD PROFISSIONAL - DESIGN LIMPO E REALISTA
// =================================================================================================
app.get('/admin', (req, res) => {
    const stats = systemStats;
    const uptime = moment.duration(moment().diff(moment(stats.startTime))).humanize();

    res.send(`
    <!DOCTYPE html>
    <html lang="pt">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AOTRAVEL · Terminal</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                background: #f5f7fb;
                color: #1a1f36;
                line-height: 1.5;
            }

            .dashboard {
                max-width: 1400px;
                margin: 0 auto;
                padding: 30px;
            }

            /* Header */
            .header {
                margin-bottom: 40px;
            }

            .header h1 {
                font-size: 24px;
                font-weight: 600;
                color: #1a1f36;
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .header h1 span {
                background: #eef2f6;
                color: #4a5568;
                font-size: 14px;
                font-weight: 500;
                padding: 4px 10px;
                border-radius: 20px;
            }

            .header .uptime {
                color: #64748b;
                font-size: 14px;
                margin-top: 8px;
            }

            .header .uptime strong {
                color: #1a1f36;
                font-weight: 600;
            }

            /* Stats Grid */
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 20px;
                margin-bottom: 30px;
            }

            .stat-card {
                background: white;
                border-radius: 16px;
                padding: 24px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                border: 1px solid #eef2f6;
            }

            .stat-card h3 {
                font-size: 14px;
                font-weight: 500;
                color: #64748b;
                margin-bottom: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .stat-number {
                font-size: 32px;
                font-weight: 600;
                color: #1a1f36;
                margin-bottom: 8px;
            }

            .stat-label {
                font-size: 13px;
                color: #94a3b8;
            }

            .stat-label span {
                color: #1a1f36;
                font-weight: 500;
            }

            /* Two Column Layout */
            .two-column {
                display: grid;
                grid-template-columns: 1.5fr 1fr;
                gap: 20px;
                margin-bottom: 30px;
            }

            /* Tables */
            .table-container {
                background: white;
                border-radius: 16px;
                padding: 24px;
                border: 1px solid #eef2f6;
            }

            .table-container h2 {
                font-size: 16px;
                font-weight: 600;
                color: #1a1f36;
                margin-bottom: 20px;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .table-container h2 .badge {
                background: #eef2f6;
                color: #4a5568;
                font-size: 12px;
                font-weight: 500;
                padding: 2px 8px;
                border-radius: 12px;
            }

            table {
                width: 100%;
                border-collapse: collapse;
            }

            th {
                text-align: left;
                padding: 12px 0;
                font-size: 13px;
                font-weight: 500;
                color: #64748b;
                border-bottom: 1px solid #eef2f6;
            }

            td {
                padding: 12px 0;
                font-size: 14px;
                color: #1a1f36;
                border-bottom: 1px solid #f1f5f9;
            }

            td:last-child {
                font-family: 'SF Mono', 'Monaco', monospace;
                font-size: 13px;
            }

            .method-badge {
                display: inline-block;
                padding: 4px 8px;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
            }

            .method-get { background: #e6f7ff; color: #0066cc; }
            .method-post { background: #e6f7e6; color: #00875a; }
            .method-put { background: #fff4e6; color: #b45b0a; }
            .method-delete { background: #ffe6e6; color: #cc0000; }

            .status-badge {
                display: inline-block;
                padding: 4px 8px;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
            }

            .status-2xx { background: #e6f7e6; color: #00875a; }
            .status-3xx { background: #fff4e6; color: #b45b0a; }
            .status-4xx { background: #ffe6e6; color: #cc0000; }
            .status-5xx { background: #ffe6e6; color: #cc0000; }

            .ride-status {
                display: flex;
                flex-wrap: wrap;
                gap: 16px;
                margin-top: 16px;
            }

            .ride-status-item {
                flex: 1;
                background: #f8fafc;
                border-radius: 12px;
                padding: 16px;
                text-align: center;
            }

            .ride-status-item .label {
                font-size: 12px;
                color: #64748b;
                margin-bottom: 4px;
            }

            .ride-status-item .value {
                font-size: 20px;
                font-weight: 600;
                color: #1a1f36;
            }

            .progress-bar {
                width: 100%;
                height: 4px;
                background: #eef2f6;
                border-radius: 2px;
                margin: 16px 0 8px 0;
                overflow: hidden;
            }

            .progress-fill {
                height: 100%;
                background: #3b82f6;
                border-radius: 2px;
                transition: width 0.3s ease;
            }

            .footer {
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid #eef2f6;
                font-size: 13px;
                color: #94a3b8;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .footer .pid {
                font-family: 'SF Mono', monospace;
                background: #f1f5f9;
                padding: 4px 10px;
                border-radius: 20px;
                color: #475569;
            }

            .refresh-btn {
                background: white;
                border: 1px solid #e2e8f0;
                color: #475569;
                font-size: 13px;
                font-weight: 500;
                padding: 8px 16px;
                border-radius: 8px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s;
            }

            .refresh-btn:hover {
                background: #f8fafc;
                border-color: #cbd5e1;
            }

            @media (max-width: 1024px) {
                .stats-grid {
                    grid-template-columns: repeat(2, 1fr);
                }
                .two-column {
                    grid-template-columns: 1fr;
                }
            }
        </style>
    </head>
    <body>
        <div class="dashboard">
            <!-- Header -->
            <div class="header">
                <h1>
                    AOTRAVEL TERMINAL
                    <span>v11.0.0</span>
                </h1>
                <div class="uptime">
                    <strong>${uptime}</strong> de operação · 
                    Iniciado às ${moment(stats.startTime).format('HH:mm:ss')} de ${moment(stats.startTime).format('DD/MM/YYYY')}
                </div>
            </div>

            <!-- Stats Cards -->
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>👥 Usuários Online</h3>
                    <div class="stat-number">${stats.sockets.total}</div>
                    <div class="stat-label">
                        <span>${stats.sockets.drivers}</span> motoristas · 
                        <span>${stats.sockets.passengers}</span> passageiros
                    </div>
                </div>

                <div class="stat-card">
                    <h3>🚕 Corridas Hoje</h3>
                    <div class="stat-number">${stats.rides.total}</div>
                    <div class="stat-label">
                        <span>${stats.rides.completed}</span> completas · 
                        <span>${stats.rides.searching}</span> buscando
                    </div>
                </div>

                <div class="stat-card">
                    <h3>📡 Requisições</h3>
                    <div class="stat-number">${stats.requests.total}</div>
                    <div class="stat-label">
                        <span>${stats.requests.byMethod.POST || 0}</span> POST · 
                        <span>${stats.requests.byMethod.GET || 0}</span> GET
                    </div>
                </div>

                <div class="stat-card">
                    <h3>⏱️ Resposta Média</h3>
                    <div class="stat-number">${Math.round(stats.performance.avgResponseTime)}ms</div>
                    <div class="stat-label">
                        PID <span>${process.pid}</span> · ${os.platform()}
                    </div>
                </div>
            </div>

            <!-- Two Column Layout -->
            <div class="two-column">
                <!-- Últimas Requisições -->
                <div class="table-container">
                    <h2>
                        📋 Últimas Requisições
                        <span class="badge">${stats.requests.last10.length}/10</span>
                    </h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Hora</th>
                                <th>Método</th>
                                <th>Endpoint</th>
                                <th>Status</th>
                                <th>ms</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${stats.requests.last10.map(req => {
                                const methodClass = {
                                    'GET': 'method-get',
                                    'POST': 'method-post',
                                    'PUT': 'method-put',
                                    'DELETE': 'method-delete'
                                }[req.method] || 'method-get';

                                const statusClass = req.statusCode < 300 ? 'status-2xx' :
                                                   req.statusCode < 400 ? 'status-3xx' : 'status-4xx';

                                return `
                                    <tr>
                                        <td>${moment(req.time).format('HH:mm:ss')}</td>
                                        <td><span class="method-badge ${methodClass}">${req.method}</span></td>
                                        <td>${req.url.length > 30 ? req.url.substring(0, 30) + '...' : req.url}</td>
                                        <td><span class="status-badge ${statusClass}">${req.statusCode}</span></td>
                                        <td>${req.duration}</td>
                                    </tr>
                                `;
                            }).join('')}
                            ${stats.requests.last10.length === 0 ? `
                                <tr>
                                    <td colspan="5" style="text-align: center; color: #94a3b8; padding: 40px;">
                                        Nenhuma requisição ainda
                                    </td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                </div>

                <!-- Status das Corridas -->
                <div class="table-container">
                    <h2>🚦 Status das Corridas</h2>
                    
                    <div class="ride-status">
                        <div class="ride-status-item">
                            <div class="label">Buscando</div>
                            <div class="value">${stats.rides.searching}</div>
                        </div>
                        <div class="ride-status-item">
                            <div class="label">Aceitas</div>
                            <div class="value">${stats.rides.accepted}</div>
                        </div>
                        <div class="ride-status-item">
                            <div class="label">Em Andamento</div>
                            <div class="value">${stats.rides.ongoing}</div>
                        </div>
                        <div class="ride-status-item">
                            <div class="label">Completas</div>
                            <div class="value">${stats.rides.completed}</div>
                        </div>
                    </div>

                    <div style="margin-top: 24px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span style="font-size: 13px; color: #64748b;">Progresso Hoje</span>
                            <span style="font-size: 13px; font-weight: 500;">
                                ${stats.rides.total > 0 ? Math.round((stats.rides.completed / stats.rides.total) * 100) : 0}%
                            </span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${stats.rides.total > 0 ? (stats.rides.completed / stats.rides.total * 100) : 0}%"></div>
                        </div>
                    </div>

                    <div style="margin-top: 24px;">
                        <div style="font-size: 13px; color: #64748b; margin-bottom: 8px;">Salas Ativas</div>
                        <div style="font-size: 24px; font-weight: 600;">${stats.sockets.rooms}</div>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="footer">
                <div>
                    <span class="pid">PID ${process.pid}</span>
                    <span style="margin-left: 16px;">Socket.IO: ${io.engine?.clientsCount || 0} conexões</span>
                </div>
                <button class="refresh-btn" onclick="location.reload()">
                    <span>↻</span> Atualizar
                </button>
            </div>
        </div>

        <script>
            // Auto-refresh silencioso (apenas se a aba estiver ativa)
            let timeout;
            function scheduleRefresh() {
                if (timeout) clearTimeout(timeout);
                if (!document.hidden) {
                    timeout = setTimeout(() => location.reload(), 5000);
                }
            }
            
            document.addEventListener('visibilitychange', scheduleRefresh);
            scheduleRefresh();
        </script>
    </body>
    </html>
    `);
});

// =================================================================================================
// 5. MIDDLEWARE DE LOGGING
// =================================================================================================
app.use((req, res, next) => {
    const start = Date.now();
    const originalSend = res.send;

    res.send = function(body) {
        const duration = Date.now() - start;

        // Atualiza estatísticas
        systemStats.requests.total++;
        systemStats.requests.byMethod[req.method] = (systemStats.requests.byMethod[req.method] || 0) + 1;

        // Adiciona às últimas 10
        systemStats.requests.last10.unshift({
            time: new Date(),
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration: duration
        });
        if (systemStats.requests.last10.length > 10) systemStats.requests.last10.pop();

        // Atualiza tempo médio
        systemStats.performance.totalResponseTime += duration;
        systemStats.performance.avgResponseTime = systemStats.performance.totalResponseTime / systemStats.requests.total;

        // Log no terminal (apenas método e status)
        const statusColor = res.statusCode < 300 ? colors.green :
                           res.statusCode < 400 ? colors.yellow :
                           colors.red;
        
        console.log(
            moment().format('HH:mm:ss') + ' ' +
            req.method.padEnd(6) + ' ' +
            req.originalUrl.padEnd(40) + ' ' +
            statusColor + res.statusCode + colors.reset + ' ' +
            colors.dim + duration + 'ms' + colors.reset
        );

        originalSend.call(this, body);
    };

    next();
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
        dashboard: '/admin'
    });
});

// =================================================================================================
// 7. ROTAS DA API
// =================================================================================================
app.use('/api', routes);

// =================================================================================================
// 8. DEBUG - MOTORISTAS ONLINE
// =================================================================================================
app.get('/api/debug/drivers', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.socket_id,
                TO_CHAR(dp.last_update, 'HH24:MI:SS') as last_update,
                dp.status,
                u.name,
                u.is_online
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.last_update > NOW() - INTERVAL '2 minutes'
            ORDER BY dp.last_update DESC
        `);

        res.json({
            success: true,
            count: result.rows.length,
            drivers: result.rows,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =================================================================================================
// 9. HANDLERS DE ERRO
// =================================================================================================
app.use(notFoundHandler);
app.use(globalErrorHandler);

// =================================================================================================
// 10. INICIALIZAÇÃO DO SERVIDOR
// =================================================================================================
(async function startServer() {
    try {
        console.clear();
        
        // Banner simples
        console.log(colors.cyan + '╔══════════════════════════════════════════════════════════════╗');
        console.log('║                   AOTRAVEL TERMINAL v11.0.0                   ║');
        console.log('╚══════════════════════════════════════════════════════════════╝' + colors.reset);
        console.log();

        // Inicializa banco
        log.info('Verificando banco de dados...');
        await bootstrapDatabase();
        log.success('Banco de dados OK');

        // Inicializa Socket
        log.socket('Iniciando Socket.IO...');
        setupSocketIO(io);
        log.success('Socket.IO pronto');

        // Monitora conexões socket
        io.engine.on('connection', (socket) => {
            systemStats.sockets.total = io.engine.clientsCount;
        });

        // Inicia servidor
        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log();
            log.success(`Servidor rodando na porta ${PORT}`);
            log.info(`Dashboard: http://localhost:${PORT}/admin`);
            log.info(`API: http://localhost:${PORT}/api`);
            console.log();
        });

    } catch (err) {
        log.error('Erro fatal:');
        console.error(err);
        process.exit(1);
    }
})();

// =================================================================================================
// 11. GRACEFUL SHUTDOWN
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
