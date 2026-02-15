/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - PRODUCTION COMMAND CENTER v11.0.0 (CORREÇÃO RADICAL)
 * =================================================================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const moment = require('moment');

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
// 2. CONFIGURAÇÃO DO SOCKET.IO - ÚNICA INSTÂNCIA!
// =================================================================================================
const { Server } = require("socket.io");
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

// Configurar Socket.IO com handlers DIRETOS (sem setupSocketIO)
io.on('connection', (socket) => {
    console.log(`${colors.magenta}🔌 [SOCKET] Conectado: ${socket.id}${colors.reset}`);
    
    socket.on('join_driver_room', async (data) => {
        const driverId = data.driver_id || data.user_id;
        if (!driverId) return;
        
        console.log(`${colors.cyan}🚗 [DRIVER JOIN] ${driverId} - Socket: ${socket.id}${colors.reset}`);
        
        try {
            const pool = require('./src/config/db');
            
            await pool.query(`
                INSERT INTO driver_positions (driver_id, lat, lng, socket_id, status, last_update)
                VALUES ($1, -8.8399, 13.2894, $2, 'online', NOW())
                ON CONFLICT (driver_id) DO UPDATE SET
                    socket_id = $2,
                    status = 'online',
                    last_update = NOW()
            `, [driverId, socket.id]);
            
            await pool.query(`
                UPDATE users SET is_online = true, last_seen = NOW()
                WHERE id = $1
            `, [driverId]);
            
            console.log(`${colors.green}✅ [DB] Driver ${driverId} registrado${colors.reset}`);
            
            socket.emit('joined_ack', { success: true, driver_id: driverId });
        } catch (e) {
            console.error(`❌ Erro:`, e.message);
        }
    });
    
    socket.on('disconnect', async () => {
        try {
            const pool = require('./src/config/db');
            
            const result = await pool.query(
                'SELECT driver_id FROM driver_positions WHERE socket_id = $1',
                [socket.id]
            );
            
            if (result.rows.length > 0) {
                const driverId = result.rows[0].driver_id;
                
                await pool.query(`
                    UPDATE driver_positions 
                    SET status = 'offline', socket_id = NULL 
                    WHERE driver_id = $1
                `, [driverId]);
                
                await pool.query(`
                    UPDATE users SET is_online = false 
                    WHERE id = $1
                `, [driverId]);
                
                console.log(`${colors.yellow}🚫 Driver ${driverId} desconectado${colors.reset}`);
            }
        } catch (e) {
            console.error(`❌ Erro disconnect:`, e.message);
        }
    });
});

// Injetar io nas requisições
app.use((req, res, next) => {
    req.io = io;
    next();
});

app.set('io', io);

// =================================================================================================
// 3. MIDDLEWARES
// =================================================================================================

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb' }));
app.use(express.urlencoded({ limit: appConfig.SERVER?.BODY_LIMIT || '100mb', extended: true }));

const uploadPath = appConfig.SERVER?.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadPath)));

// =================================================================================================
// 4. ROTAS DE DIAGNÓSTICO E CORREÇÃO
// =================================================================================================

// CORREÇÃO RADICAL DO BANCO
app.get('/api/debug/fix-drivers', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        
        await pool.query('BEGIN');
        await pool.query('DELETE FROM driver_positions');
        await pool.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, status, last_update)
            SELECT id, -8.8399, 13.2894, 'offline', NOW() - INTERVAL '1 hour'
            FROM users WHERE role = 'driver'
        `);
        await pool.query('UPDATE users SET is_online = false WHERE role = 'driver'');
        await pool.query('COMMIT');
        
        res.json({ success: true, message: 'Banco resetado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DEBUG - Motoristas
app.get('/api/debug/drivers-detailed', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        
        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.socket_id,
                TO_CHAR(dp.last_update, 'YYYY-MM-DD HH24:MI:SS') as last_update,
                dp.status,
                u.name,
                u.is_online
            FROM driver_positions dp
            RIGHT JOIN users u ON dp.driver_id = u.id
            WHERE u.role = 'driver'
            ORDER BY dp.last_update DESC
        `);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            drivers: result.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =================================================================================================
// 5. ROTAS DA API
// =================================================================================================
app.get('/admin', (req, res) => {
    res.send('<h1>AOTRAVEL Dashboard</h1><p>Servidor online</p>');
});

app.get('/', (req, res) => {
    res.json({
        service: 'AOTRAVEL Backend',
        version: '11.0.0',
        status: 'online',
        timestamp: new Date().toISOString()
    });
});

app.use('/api', routes);

// =================================================================================================
// 6. HANDLERS DE ERRO
// =================================================================================================
app.use(notFoundHandler);
app.use(globalErrorHandler);

// =================================================================================================
// 7. INICIALIZAÇÃO DO SERVIDOR
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

        const PORT = process.env.PORT || appConfig.SERVER?.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log();
            log.success(`Servidor rodando na porta ${PORT}`);
            log.info(`Debug: http://localhost:${PORT}/api/debug/drivers-detailed`);
            console.log();
        });

    } catch (err) {
        log.error('Erro fatal:');
        console.error(err);
        process.exit(1);
    }
})();

// =================================================================================================
// 8. GRACEFUL SHUTDOWN
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
