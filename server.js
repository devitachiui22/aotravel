/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - TITANIUM COMMAND CENTER (DASHBOARD VISUAL)
 * =================================================================================================
 *
 * ARQUIVO: server.js
 * DESCRIÇÃO: Ponto de entrada com DASHBOARD VISUAL EM TEMPO REAL.
 *            Mostra TODAS as requisições, rotas, eventos socket e estado do sistema.
 *
 * NOVIDADES:
 * 1. ✅ DASHBOARD WEB bonito em http://localhost:3000/admin
 * 2. ✅ LOGS COLORIDOS e ORGANIZADOS no terminal
 * 3. ✅ CONTADORES de requisições, corridas, motoristas online
 * 4. ✅ HISTÓRICO de todas as requisições em tempo real
 * 5. ✅ STATUS dos motoristas e passageiros conectados
 * 6. ✅ MONITORAMENTO de eventos Socket.IO
 *
 * STATUS: 🔥 PRODUCTION READY - SUPREME VERSION
 * =================================================================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');
const chalk = require('chalk');
const Table = require('cli-table3');
const moment = require('moment');
const os = require('os');

// =================================================================================================
// 📊 SISTEMA DE LOGGING PREMIUM
// =================================================================================================
const log = {
    info: (msg) => console.log(chalk.blue('📘 [INFO]'), msg),
    success: (msg) => console.log(chalk.green('✅ [OK]'), msg),
    warn: (msg) => console.log(chalk.yellow('⚠️ [WARN]'), msg),
    error: (msg) => console.log(chalk.red('❌ [ERROR]'), msg),
    socket: (msg) => console.log(chalk.magenta('🔌 [SOCKET]'), msg),
    ride: (msg) => console.log(chalk.cyan('🚕 [RIDE]'), msg),
    payment: (msg) => console.log(chalk.yellow('💰 [PAYMENT]'), msg),
    http: (msg) => console.log(chalk.gray('📡 [HTTP]'), msg),
    db: (msg) => console.log(chalk.cyan('💾 [DB]'), msg),
    divider: () => console.log(chalk.gray('─'.repeat(80))),
    title: (msg) => {
        console.log('\n' + chalk.bgBlue.white.bold(` ${msg} `));
        console.log(chalk.blue('═'.repeat(msg.length + 2)));
    }
};

// =================================================================================================
// 📊 ESTADO GLOBAL DO SISTEMA (DASHBOARD)
// =================================================================================================
const systemStats = {
    startTime: new Date(),
    requests: {
        total: 0,
        byMethod: { GET: 0, POST: 0, PUT: 0, DELETE: 0 },
        byEndpoint: {},
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
        admins: 0,
        rooms: 0
    },
    users: {
        online: 0,
        drivers: 0,
        passengers: 0
    },
    performance: {
        avgResponseTime: 0,
        totalResponseTime: 0
    }
};

// =================================================================================================
// 1. IMPORTAÇÃO DE CONFIGURAÇÕES E BANCO
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
// 2. CONFIGURAÇÃO DO SOCKET.IO COM MONITORAMENTO
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

// INJETAR io NAS REQUISIÇÕES (CRÍTICO PARA NOTIFICAÇÕES!)
app.use((req, res, next) => {
    req.io = io;
    req.systemStats = systemStats;
    next();
});

app.set('io', io);
app.set('systemStats', systemStats);

// =================================================================================================
// 3. MIDDLEWARES GLOBAIS COM LOGGING PREMIUM
// =================================================================================================

// CORS
app.use(cors({ origin: '*' }));

// Parsing de Corpo
app.use(express.json({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb' }));
app.use(express.urlencoded({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb', extended: true }));

// Arquivos Estáticos
const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadPath)));

// =================================================================================================
// 4. 🎨 DASHBOARD VISUAL EM TEMPO REAL (HTML + CSS + JS)
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
        <title>🚀 AOTRAVEL TITANIUM COMMAND CENTER</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 30px;
                color: #fff;
            }
            .container {
                max-width: 1400px;
                margin: 0 auto;
            }
            .header {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 30px;
                margin-bottom: 30px;
                border: 1px solid rgba(255,255,255,0.2);
                box-shadow: 0 20px 40px rgba(0,0,0,0.2);
            }
            .header h1 {
                font-size: 2.5em;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 15px;
            }
            .header h1 span {
                background: rgba(255,255,255,0.2);
                padding: 5px 15px;
                border-radius: 50px;
                font-size: 0.5em;
                font-weight: normal;
            }
            .stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                gap: 25px;
                margin-bottom: 30px;
            }
            .stat-card {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 25px;
                border: 1px solid rgba(255,255,255,0.2);
                transition: transform 0.3s ease;
            }
            .stat-card:hover {
                transform: translateY(-5px);
                background: rgba(255,255,255,0.15);
            }
            .stat-card h3 {
                font-size: 1.1em;
                opacity: 0.9;
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .stat-number {
                font-size: 2.8em;
                font-weight: bold;
                margin-bottom: 10px;
            }
            .stat-label {
                font-size: 0.9em;
                opacity: 0.8;
            }
            .progress-bar {
                width: 100%;
                height: 8px;
                background: rgba(255,255,255,0.1);
                border-radius: 4px;
                margin-top: 15px;
                overflow: hidden;
            }
            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #00d2ff, #3a7bd5);
                border-radius: 4px;
                transition: width 0.3s ease;
            }
            .table-container {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 25px;
                border: 1px solid rgba(255,255,255,0.2);
                margin-top: 30px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
            }
            th {
                text-align: left;
                padding: 12px;
                font-weight: 600;
                border-bottom: 2px solid rgba(255,255,255,0.2);
            }
            td {
                padding: 12px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .badge {
                display: inline-block;
                padding: 4px 12px;
                border-radius: 50px;
                font-size: 0.85em;
                font-weight: 600;
            }
            .badge-success { background: #10b981; color: white; }
            .badge-warning { background: #f59e0b; color: white; }
            .badge-danger { background: #ef4444; color: white; }
            .badge-info { background: #3b82f6; color: white; }
            .refresh-btn {
                background: rgba(255,255,255,0.2);
                color: white;
                border: 1px solid rgba(255,255,255,0.3);
                padding: 10px 25px;
                border-radius: 50px;
                cursor: pointer;
                font-size: 1em;
                transition: all 0.3s ease;
            }
            .refresh-btn:hover {
                background: rgba(255,255,255,0.3);
                transform: scale(1.05);
            }
            .footer {
                text-align: center;
                margin-top: 50px;
                opacity: 0.7;
                font-size: 0.9em;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>
                    🚀 AOTRAVEL TITANIUM COMMAND CENTER
                    <span>v11.0.0</span>
                </h1>
                <p style="font-size: 1.2em; opacity: 0.9;">${uptime} de operação contínua</p>
                <button class="refresh-btn" onclick="location.reload()">🔄 Atualizar Agora</button>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <h3>👥 USUÁRIOS ONLINE</h3>
                    <div class="stat-number">${stats.sockets.total}</div>
                    <div class="stat-label">
                        🚗 Motoristas: ${stats.sockets.drivers} |
                        👤 Passageiros: ${stats.sockets.passengers}
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${Math.min((stats.sockets.total / 100) * 100, 100)}%"></div>
                    </div>
                </div>

                <div class="stat-card">
                    <h3>🚕 CORRIDAS HOJE</h3>
                    <div class="stat-number">${stats.rides.total}</div>
                    <div class="stat-label">
                        ✅ Completas: ${stats.rides.completed} |
                        🔍 Buscando: ${stats.rides.searching}
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${stats.rides.completed > 0 ? (stats.rides.completed / stats.rides.total * 100) : 0}%"></div>
                    </div>
                </div>

                <div class="stat-card">
                    <h3>📡 REQUISIÇÕES</h3>
                    <div class="stat-number">${stats.requests.total}</div>
                    <div class="stat-label">
                        📤 POST: ${stats.requests.byMethod.POST} |
                        📥 GET: ${stats.requests.byMethod.GET}
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: 100%"></div>
                    </div>
                </div>

                <div class="stat-card">
                    <h3>💾 SISTEMA</h3>
                    <div class="stat-number">${process.pid}</div>
                    <div class="stat-label">
                        🖥️ PID | ${os.platform()} | ${os.arch()}
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${(process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100).toFixed(1)}%"></div>
                    </div>
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card">
                    <h3>💰 TRANSAÇÕES</h3>
                    <div class="stat-number">${stats.rides.completed}</div>
                    <div class="stat-label">Pagamentos processados</div>
                </div>
                <div class="stat-card">
                    <h3>🔌 SOCKETS ATIVOS</h3>
                    <div class="stat-number">${stats.sockets.rooms}</div>
                    <div class="stat-label">Salas de corrida ativas</div>
                </div>
                <div class="stat-card">
                    <h3>⏱️ RESPOSTA MÉDIA</h3>
                    <div class="stat-number">${stats.performance.avgResponseTime.toFixed(0)}ms</div>
                    <div class="stat-label">Latência da API</div>
                </div>
                <div class="stat-card">
                    <h3>📅 INICIADO</h3>
                    <div class="stat-number">${moment(stats.startTime).format('HH:mm:ss')}</div>
                    <div class="stat-label">${moment(stats.startTime).format('DD/MM/YYYY')}</div>
                </div>
            </div>

            <div class="table-container">
                <h2 style="margin-bottom: 20px;">📋 ÚLTIMAS 10 REQUISIÇÕES</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Hora</th>
                            <th>Método</th>
                            <th>Endpoint</th>
                            <th>Status</th>
                            <th>Tempo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.requests.last10.map(req => `
                            <tr>
                                <td>${moment(req.time).format('HH:mm:ss')}</td>
                                <td><span class="badge ${req.method === 'POST' ? 'badge-success' : req.method === 'GET' ? 'badge-info' : 'badge-warning'}">${req.method}</span></td>
                                <td>${req.url}</td>
                                <td><span class="badge ${req.statusCode < 300 ? 'badge-success' : req.statusCode < 400 ? 'badge-warning' : 'badge-danger'}">${req.statusCode}</span></td>
                                <td>${req.duration}ms</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="footer">
                <p>⚡ AOTRAVEL TITANIUM CORE | Socket.IO: ${io.engine?.clientsCount || 0} conexões ativas</p>
                <p style="margin-top: 10px;">🛡️ Desenvolvido por Augusto Neves • Engenharia de Precisão</p>
            </div>
        </div>
        <script>
            // Auto-refresh a cada 5 segundos
            setTimeout(() => location.reload(), 5000);
        </script>
    </body>
    </html>
    `);
});

// =================================================================================================
// 5. MIDDLEWARE DE LOGGING PREMIUM (CAPTURA TODAS AS REQUISIÇÕES)
// =================================================================================================
app.use((req, res, next) => {
    const start = Date.now();
    const originalSend = res.send;

    // Intercepta o send para capturar status code
    res.send = function(body) {
        const duration = Date.now() - start;

        // Atualiza estatísticas
        systemStats.requests.total++;
        systemStats.requests.byMethod[req.method] = (systemStats.requests.byMethod[req.method] || 0) + 1;

        const endpoint = req.originalUrl.split('?')[0];
        systemStats.requests.byEndpoint[endpoint] = (systemStats.requests.byEndpoint[endpoint] || 0) + 1;

        // Adiciona às últimas 10 requisições
        systemStats.requests.last10.unshift({
            time: new Date(),
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration: duration
        });
        if (systemStats.requests.last10.length > 10) systemStats.requests.last10.pop();

        // Atualiza tempo médio de resposta
        systemStats.performance.totalResponseTime += duration;
        systemStats.performance.avgResponseTime = systemStats.performance.totalResponseTime / systemStats.requests.total;

        // LOG PREMIUM COLORIDO
        const methodColor = {
            'GET': chalk.green,
            'POST': chalk.blue,
            'PUT': chalk.yellow,
            'DELETE': chalk.red
        }[req.method] || chalk.white;

        const statusColor = res.statusCode < 300 ? chalk.green :
                           res.statusCode < 400 ? chalk.yellow :
                           chalk.red;

        console.log(
            chalk.gray(moment().format('HH:mm:ss')) + ' ' +
            methodColor(req.method.padEnd(6)) + ' ' +
            chalk.white(req.originalUrl.padEnd(40)) + ' ' +
            statusColor(res.statusCode.toString()) + ' ' +
            chalk.gray(`${duration}ms`)
        );

        // Log especial para endpoints de corrida
        if (req.originalUrl.includes('/rides/')) {
            if (req.originalUrl.includes('/request')) log.ride(`NOVA CORRIDA solicitada`);
            if (req.originalUrl.includes('/accept')) log.ride(`CORRIDA ACEITA`);
            if (req.originalUrl.includes('/complete')) log.ride(`CORRIDA FINALIZADA`);
        }

        originalSend.call(this, body);
    };

    next();
});

// =================================================================================================
// 6. HEALTH CHECK
// =================================================================================================
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>AOTRAVEL Titanium Core</title></head>
            <body style="font-family: system-ui; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                    <h1 style="font-size: 3em; margin-bottom: 20px;">🚀 AOtravel Backend</h1>
                    <p style="font-size: 1.2em; opacity: 0.9;">Titanium Core • v11.0.0</p>
                    <div style="margin-top: 40px;">
                        <a href="/admin" style="background: rgba(255,255,255,0.2); color: white; padding: 15px 30px; border-radius: 50px; text-decoration: none; font-weight: bold;">📊 ACESSAR COMMAND CENTER</a>
                    </div>
                </div>
            </body>
        </html>
    `);
});

// =================================================================================================
// 7. MAPEAMENTO DE ROTAS
// =================================================================================================
app.use('/api', routes);

// =================================================================================================
// 8. HANDLERS DE ERRO
// =================================================================================================
app.use(notFoundHandler);
app.use(globalErrorHandler);

// =================================================================================================
// 🚨 ROTA DE TESTE - VERIFICAR MOTORISTAS ONLINE
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
                dp.last_update,
                dp.status,
                u.name,
                u.phone,
                u.is_online
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.last_update > NOW() - INTERVAL '2 minutes'
            ORDER BY dp.last_update DESC
        `);

        console.log(`🚨 [DEBUG] Motoristas online: ${result.rows.length}`);
        res.json({
            success: true,
            count: result.rows.length,
            drivers: result.rows,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ [DEBUG] Erro:', error);
        res.status(500).json({ error: error.message });
    }
});

// =================================================================================================
// 9. PROCESSO DE BOOT COM DASHBOARD NO TERMINAL
// =================================================================================================
(async function startServer() {
    try {
        console.clear();
        console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   █████╗  ██████╗ ████████╗██████╗  █████╗ ██╗   ██╗███████╗██╗             ║
║  ██╔══██╗██╔═══██╗╚══██╔══╝██╔══██╗██╔══██╗██║   ██║██╔════╝██║             ║
║  ███████║██║   ██║   ██║   ██████╔╝███████║██║   ██║█████╗  ██║             ║
║  ██╔══██║██║   ██║   ██║   ██╔══██╗██╔══██║╚██╗ ██╔╝██╔══╝  ██║             ║
║  ██║  ██║╚██████╔╝   ██║   ██║  ██║██║  ██║ ╚████╔╝ ███████╗███████╗        ║
║  ╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚══════╝        ║
║                                                                              ║
║                    🚀 TITANIUM COMMAND CENTER v11.0.0                       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
        `));

        console.log(chalk.blue.bold('\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓'));
        console.log(chalk.blue.bold('┃                    🚀 INICIANDO SERVIDOR                         ┃'));
        console.log(chalk.blue.bold('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n'));

        // 1. Banco de Dados
        log.db('Verificando integridade do banco de dados...');
        await bootstrapDatabase();
        log.success('Banco de Dados sincronizado com sucesso.');

        // 2. Socket.IO
        log.socket('Inicializando motor de tempo real...');
        setupSocketIO(io);

        // Monitoramento de sockets
        io.engine.on('connection', (socket) => {
            systemStats.sockets.total = io.engine.clientsCount;
        });

        log.success('Socket.IO inicializado com monitoramento em tempo real.');

        // 3. Servidor HTTP
        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log(chalk.green('\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓'));
            console.log(chalk.green('┃                    ✅ SERVIDOR ONLINE                             ┃'));
            console.log(chalk.green('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n'));

            // Tabela de endpoints
            const table = new Table({
                head: [chalk.white('🌐 ENDPOINT'), chalk.white('📡 MÉTODO'), chalk.white('📝 DESCRIÇÃO')],
                colWidths: [50, 15, 40],
                style: { head: ['cyan'], border: ['gray'] }
            });

            table.push(
                ['/', 'GET', 'Health Check'],
                ['/admin', 'GET', 'Dashboard Visual em Tempo Real'],
                ['/api/rides/request', 'POST', 'Solicitar nova corrida'],
                ['/api/rides/accept', 'POST', 'Aceitar corrida (motorista)'],
                ['/api/rides/start', 'POST', 'Iniciar viagem'],
                ['/api/rides/complete', 'POST', 'Finalizar corrida'],
                ['/api/rides/cancel', 'POST', 'Cancelar corrida'],
                ['/api/rides/history', 'GET', 'Histórico do usuário'],
                ['/api/rides/driver/performance-stats', 'GET', 'Dashboard do motorista'],
                ['/api/chat/unread/count', 'GET', 'Contagem de mensagens não lidas'],
                ['/api/chat/:ride_id', 'GET', 'Histórico do chat'],
                ['/uploads/*', 'GET', 'Arquivos estáticos']
            );

            console.log(table.toString());

            console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
            console.log(chalk.white.bold(`   📡 API:         http://localhost:${PORT}/api`));
            console.log(chalk.white.bold(`   📊 DASHBOARD:   http://localhost:${PORT}/admin`));
            console.log(chalk.white.bold(`   🔌 SOCKET:      ws://localhost:${PORT}`));
            console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

            log.success(`Servidor rodando na porta ${PORT}`);
            log.info(`Acesse o dashboard: ${chalk.underline.blue(`http://localhost:${PORT}/admin`)}`);
        });

    } catch (err) {
        log.error('ERRO CRÍTICO NO BOOT:');
        console.error(chalk.red(err.stack));
        process.exit(1);
    }
})();

// =================================================================================================
// 10. GRACEFUL SHUTDOWN
// =================================================================================================
const shutdown = (signal) => {
    log.warn(`\nRecebido sinal ${signal}. Iniciando desligamento gracioso...`);

    server.close(() => {
        log.success('Servidor HTTP fechado.');

        db.end(() => {
            log.success('Pool de conexões encerrado.');
            console.log(chalk.yellow('\n👋 Servidor finalizado com segurança. Até logo!\n'));
            process.exit(0);
        });
    });

    setTimeout(() => {
        log.error('Timeout - Forçando encerramento imediato.');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    log.error('EXCEÇÃO NÃO CAPTURADA:');
    console.error(chalk.red(err.stack));
});

module.exports = { app, server, io };
