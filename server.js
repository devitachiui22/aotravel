/**
 * =================================================================================================
 * 🚀 NEXUS CORE TITANIUM - SERVER COMMAND CENTER v12.0.1
 * =================================================================================================
 * 
 * ✅ CORREÇÃO: Removido caracteres de template string inválidos
 * ✅ PRODUCTION READY: Totalmente compatível com Node.js
 * ✅ HOTFIX: Sintaxe corrigida para logs e socket
 * 
 * SISTEMA COMPLETO DE GESTÃO DE SERVIDOR COM DASHBOARD VISUAL
 * =================================================================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const chalk = require('chalk');
const Table = require('cli-table3');
const moment = require('moment');
const os = require('os');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// =================================================================================================
// 📊 CONFIGURAÇÕES GLOBAIS
// =================================================================================================
const CONFIG = {
    PORT: process.env.PORT || 3000,
    JWT_SECRET: process.env.JWT_SECRET || 'nexus-titanium-super-secret-key-2026',
    JWT_EXPIRE: '7d',
    BCRYPT_ROUNDS: 12,
    UPLOAD_DIR: 'uploads',
    MAX_FILE_SIZE: '100mb',
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    SOCKET_PING_TIMEOUT: 20000,
    SOCKET_PING_INTERVAL: 25000,
    RATE_LIMIT_WINDOW: 15 * 60 * 1000,
    RATE_LIMIT_MAX: 1000
};

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
    admin: (msg) => console.log(chalk.bgRed.white('👑 [ADMIN]'), msg),
    divider: () => console.log(chalk.gray('─'.repeat(80))),
    title: (msg) => {
        console.log('\n' + chalk.bgBlue.white.bold(` ${msg} `));
        console.log(chalk.blue('═'.repeat(msg.length + 2)));
    }
};

// =================================================================================================
// 📊 BANCO DE DADOS EM MEMÓRIA (PERSISTENTE EM ARQUIVO)
// =================================================================================================
const DB = {
    users: [],
    rides: [],
    payments: [],
    wallets: [],
    messages: [],
    files: [],
    logs: [],
    settings: {}
};

// Carregar dados do arquivo se existir
const DB_PATH = path.join(__dirname, 'database.json');
try {
    if (fsSync.existsSync(DB_PATH)) {
        const saved = JSON.parse(fsSync.readFileSync(DB_PATH, 'utf8'));
        Object.assign(DB, saved);
        log.success('Banco de dados carregado do arquivo');
    }
} catch (err) {
    log.warn('Nenhum banco de dados existente, criando novo');
}

// Função para salvar dados
async function saveDB() {
    try {
        await fs.writeFile(DB_PATH, JSON.stringify(DB, null, 2));
        return true;
    } catch (err) {
        log.error('Erro ao salvar DB: ' + err.message);
        return false;
    }
}

// =================================================================================================
// 📊 ESTADO GLOBAL DO SISTEMA
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
        total: 0,
        online: 0,
        drivers: 0,
        passengers: 0,
        admins: 0,
        banned: 0
    },
    performance: {
        avgResponseTime: 0,
        totalResponseTime: 0,
        cpuUsage: 0,
        memoryUsage: 0
    },
    wallet: {
        totalBalance: 0,
        totalTransactions: 0,
        pendingWithdrawals: 0
    }
};

// =================================================================================================
// 🚀 INICIALIZAÇÃO DO EXPRESS
// =================================================================================================
const app = express();
const server = http.createServer(app);

// =================================================================================================
// 🔌 CONFIGURAÇÃO DO SOCKET.IO
// =================================================================================================
const io = new Server(server, {
    cors: {
        origin: CONFIG.CORS_ORIGIN,
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    pingTimeout: CONFIG.SOCKET_PING_TIMEOUT,
    pingInterval: CONFIG.SOCKET_PING_INTERVAL,
    transports: ['websocket', 'polling']
});

// Injetar io e DB nas requisições
app.use((req, res, next) => {
    req.io = io;
    req.DB = DB;
    req.systemStats = systemStats;
    req.saveDB = saveDB;
    next();
});

app.set('io', io);
app.set('DB', DB);
app.set('systemStats', systemStats);

// =================================================================================================
// 🛡️ MIDDLEWARES DE SEGURANÇA E PERFORMANCE
// =================================================================================================
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cors({ origin: CONFIG.CORS_ORIGIN, credentials: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: CONFIG.RATE_LIMIT_WINDOW,
    max: CONFIG.RATE_LIMIT_MAX,
    message: 'Muitas requisições, tente novamente mais tarde.'
});
app.use('/api/', limiter);

// Parsing
app.use(express.json({ limit: CONFIG.MAX_FILE_SIZE }));
app.use(express.urlencoded({ limit: CONFIG.MAX_FILE_SIZE, extended: true }));

// Arquivos estáticos
app.use('/uploads', express.static(path.join(__dirname, CONFIG.UPLOAD_DIR)));

// =================================================================================================
// 📝 MIDDLEWARE DE LOGGING E ESTATÍSTICAS
// =================================================================================================
app.use((req, res, next) => {
    const start = Date.now();
    const originalSend = res.send;

    res.send = function(body) {
        const duration = Date.now() - start;

        systemStats.requests.total++;
        systemStats.requests.byMethod[req.method] = (systemStats.requests.byMethod[req.method] || 0) + 1;
        
        const endpoint = req.originalUrl.split('?')[0];
        systemStats.requests.byEndpoint[endpoint] = (systemStats.requests.byEndpoint[endpoint] || 0) + 1;

        systemStats.requests.last10.unshift({
            time: new Date(),
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration: duration,
            ip: req.ip
        });
        if (systemStats.requests.last10.length > 10) systemStats.requests.last10.pop();

        systemStats.performance.totalResponseTime += duration;
        systemStats.performance.avgResponseTime = 
            systemStats.requests.total > 0 ? systemStats.performance.totalResponseTime / systemStats.requests.total : 0;
        
        systemStats.performance.cpuUsage = os.loadavg()[0] * 100;
        systemStats.performance.memoryUsage = 
            process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100;

        const methodColor = {
            'GET': chalk.green, 'POST': chalk.blue,
            'PUT': chalk.yellow, 'DELETE': chalk.red
        }[req.method] || chalk.white;

        console.log(
            chalk.gray(moment().format('HH:mm:ss')) + ' ' +
            methodColor(req.method.padEnd(6)) + ' ' +
            chalk.white(req.originalUrl.padEnd(45)) + ' ' +
            (res.statusCode < 300 ? chalk.green : res.statusCode < 400 ? chalk.yellow : chalk.red)(res.statusCode) + ' ' +
            chalk.gray(duration + 'ms')
        );

        originalSend.call(this, body);
    };
    next();
});

// =================================================================================================
// 🔐 MIDDLEWARE DE AUTENTICAÇÃO
// =================================================================================================
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : null;
    
    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    try {
        const decoded = jwt.verify(token, CONFIG.JWT_SECRET);
        const user = DB.users.find(u => u.id === decoded.id);
        
        if (!user) {
            return res.status(401).json({ error: 'Usuário não encontrado' });
        }
        
        if (user.banned) {
            return res.status(403).json({ error: 'Usuário banido' });
        }

        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido' });
    }
};

const adminMiddleware = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }
    next();
};

// =================================================================================================
// 📁 API DE GESTÃO DE ARQUIVOS - EDITOR AO VIVO
// =================================================================================================
app.get('/api/files', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const baseDir = __dirname;
        const files = [
            { name: 'server.js', path: 'server.js', type: 'javascript' },
            { name: 'package.json', path: 'package.json', type: 'json' },
            { name: 'database.json', path: 'database.json', type: 'json' }
        ];

        const srcPath = path.join(baseDir, 'src');
        if (fsSync.existsSync(srcPath)) {
            const srcFiles = await fs.readdir(srcPath);
            srcFiles.forEach(file => {
                if (file.endsWith('.js') || file.endsWith('.json')) {
                    files.push({
                        name: 'src/' + file,
                        path: 'src/' + file,
                        type: file.endsWith('.js') ? 'javascript' : 'json'
                    });
                }
            });
        }

        res.json({ files });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/files/content', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const file = req.query.file;
        if (!file) {
            return res.status(400).json({ error: 'Arquivo não especificado' });
        }

        const filePath = path.join(__dirname, file);
        
        if (!fsSync.existsSync(filePath)) {
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }

        const content = await fs.readFile(filePath, 'utf8');
        const stats = await fs.stat(filePath);

        res.json({
            content,
            name: path.basename(file),
            path: file,
            size: stats.size,
            modified: stats.mtime
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/files/save', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const file = req.body.file;
        const content = req.body.content;
        
        if (!file || content === undefined) {
            return res.status(400).json({ error: 'Arquivo e conteúdo são obrigatórios' });
        }

        const filePath = path.join(__dirname, file);
        
        if (fsSync.existsSync(filePath)) {
            const backupDir = path.join(__dirname, 'backups');
            await fs.mkdir(backupDir, { recursive: true });
            const backupPath = path.join(backupDir, path.basename(file) + '.' + Date.now() + '.bak');
            await fs.copyFile(filePath, backupPath);
        }

        await fs.writeFile(filePath, content, 'utf8');
        
        DB.logs.push({
            id: Date.now(),
            type: 'file_edit',
            user: req.user.username,
            file: file,
            timestamp: new Date(),
            ip: req.ip
        });

        log.admin('Arquivo ' + file + ' editado por ' + req.user.username);
        
        io.to('admins').emit('file:updated', {
            file: file,
            editor: req.user.username,
            timestamp: new Date()
        });

        await saveDB();
        res.json({ success: true, message: 'Arquivo salvo com sucesso' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================================================================================================
// 👥 API DE GESTÃO DE USUÁRIOS - COMPLETA
// =================================================================================================
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const role = req.query.role || '';
    const status = req.query.status || '';
    
    let users = [...DB.users];
    
    if (search) {
        users = users.filter(u => 
            (u.username && u.username.toLowerCase().includes(search.toLowerCase())) ||
            (u.email && u.email.toLowerCase().includes(search.toLowerCase())) ||
            (u.phone && u.phone.includes(search))
        );
    }
    
    if (role) {
        users = users.filter(u => u.role === role);
    }
    
    if (status === 'banned') {
        users = users.filter(u => u.banned);
    } else if (status === 'active') {
        users = users.filter(u => !u.banned);
    }

    const start = (page - 1) * limit;
    const paginatedUsers = users.slice(start, start + limit);

    res.json({
        users: paginatedUsers.map(u => ({
            id: u.id,
            username: u.username,
            email: u.email,
            phone: u.phone,
            role: u.role,
            balance: u.balance || 0,
            createdAt: u.createdAt,
            lastLogin: u.lastLogin,
            banned: u.banned || false,
            totalRides: u.totalRides || 0,
            rating: u.rating || 5.0
        })),
        total: users.length,
        page: page,
        totalPages: Math.ceil(users.length / limit)
    });
});

app.post('/api/admin/users/create', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const username = req.body.username;
        const email = req.body.email;
        const phone = req.body.phone;
        const password = req.body.password;
        const role = req.body.role || 'passenger';

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Campos obrigatórios faltando' });
        }

        if (DB.users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'Email já cadastrado' });
        }

        const hashedPassword = await bcrypt.hash(password, CONFIG.BCRYPT_ROUNDS);
        
        const newUser = {
            id: Date.now(),
            username: username,
            email: email,
            phone: phone,
            password: hashedPassword,
            role: role,
            balance: 0,
            createdAt: new Date(),
            lastLogin: null,
            banned: false,
            totalRides: 0,
            rating: 5.0,
            wallet: {
                balance: 0,
                transactions: []
            }
        };

        DB.users.push(newUser);
        
        DB.wallets.push({
            userId: newUser.id,
            balance: 0,
            transactions: [],
            createdAt: new Date()
        });

        await saveDB();
        log.admin('Usuário ' + username + ' criado por admin');
        
        const userResponse = { ...newUser };
        delete userResponse.password;
        
        res.status(201).json({ 
            success: true, 
            message: 'Usuário criado com sucesso',
            user: userResponse
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const username = req.body.username;
        const email = req.body.email;
        const phone = req.body.phone;
        const role = req.body.role;
        const balance = req.body.balance;
        const banned = req.body.banned;
        
        const user = DB.users.find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        if (username) user.username = username;
        if (email) user.email = email;
        if (phone) user.phone = phone;
        if (role) user.role = role;
        if (balance !== undefined) user.balance = balance;
        if (banned !== undefined) user.banned = banned;

        await saveDB();
        log.admin('Usuário ' + user.username + ' atualizado');
        
        const userResponse = { ...user };
        delete userResponse.password;
        
        res.json({ 
            success: true, 
            message: 'Usuário atualizado',
            user: userResponse
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const userIndex = DB.users.findIndex(u => u.id === userId);
        
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const user = DB.users[userIndex];
        DB.users.splice(userIndex, 1);
        
        const walletIndex = DB.wallets.findIndex(w => w.userId === userId);
        if (walletIndex !== -1) DB.wallets.splice(walletIndex, 1);

        await saveDB();
        log.admin('Usuário ' + user.username + ' removido');
        
        res.json({ success: true, message: 'Usuário removido com sucesso' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================================================================================================
// 💰 API DE WALLET E PAGAMENTOS
// =================================================================================================
app.get('/api/admin/wallet/stats', authMiddleware, adminMiddleware, async (req, res) => {
    const totalBalance = DB.wallets.reduce((sum, w) => sum + (w.balance || 0), 0);
    const totalTransactions = DB.wallets.reduce((sum, w) => sum + (w.transactions ? w.transactions.length : 0), 0);
    
    systemStats.wallet.totalBalance = totalBalance;
    systemStats.wallet.totalTransactions = totalTransactions;
    systemStats.wallet.pendingWithdrawals = DB.payments ? DB.payments.filter(p => p.status === 'pending').length : 0;
    
    res.json({
        totalBalance: totalBalance,
        totalTransactions: totalTransactions,
        pendingWithdrawals: DB.payments ? DB.payments.filter(p => p.status === 'pending').length : 0,
        activeWallets: DB.wallets.length
    });
});

app.get('/api/admin/wallet/transactions', authMiddleware, adminMiddleware, async (req, res) => {
    const allTransactions = DB.wallets.flatMap(w => {
        const transactions = w.transactions || [];
        return transactions.map(t => ({
            ...t,
            userId: w.userId,
            username: DB.users.find(u => u.id === w.userId) ? DB.users.find(u => u.id === w.userId).username : null
        }));
    }).sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    res.json({ transactions: allTransactions.slice(0, 50) });
});

app.post('/api/admin/wallet/adjust', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const userId = req.body.userId;
        const amount = req.body.amount;
        const type = req.body.type;
        const description = req.body.description || 'Ajuste administrativo';
        
        const wallet = DB.wallets.find(w => w.userId === userId);
        if (!wallet) {
            return res.status(404).json({ error: 'Carteira não encontrada' });
        }

        if (type === 'credit') {
            wallet.balance = (wallet.balance || 0) + amount;
        } else if (type === 'debit') {
            if ((wallet.balance || 0) < amount) {
                return res.status(400).json({ error: 'Saldo insuficiente' });
            }
            wallet.balance = (wallet.balance || 0) - amount;
        }

        if (!wallet.transactions) wallet.transactions = [];
        wallet.transactions.push({
            id: Date.now(),
            type: type,
            amount: amount,
            description: description,
            timestamp: new Date(),
            admin: req.user.username
        });

        await saveDB();
        log.admin('Saldo ajustado: ' + type + ' R$' + amount + ' usuário ' + userId);
        
        res.json({ 
            success: true, 
            newBalance: wallet.balance,
            message: 'Saldo ajustado com sucesso'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =================================================================================================
// 🚕 API DE GESTÃO DE CORRIDAS
// =================================================================================================
app.get('/api/admin/rides', authMiddleware, adminMiddleware, async (req, res) => {
    const status = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    let rides = [...DB.rides];
    
    if (status) {
        rides = rides.filter(r => r.status === status);
    }

    const start = (page - 1) * limit;
    const paginatedRides = rides.slice(start, start + limit).map(ride => ({
        ...ride,
        passengerName: DB.users.find(u => u.id === ride.passengerId) ? DB.users.find(u => u.id === ride.passengerId).username : null,
        driverName: DB.users.find(u => u.id === ride.driverId) ? DB.users.find(u => u.id === ride.driverId).username : null
    }));

    res.json({
        rides: paginatedRides,
        total: rides.length,
        stats: {
            total: DB.rides.length,
            active: DB.rides.filter(r => ['searching', 'accepted', 'ongoing'].includes(r.status)).length,
            completed: DB.rides.filter(r => r.status === 'completed').length,
            cancelled: DB.rides.filter(r => r.status === 'cancelled').length
        }
    });
});

// =================================================================================================
// 📊 API DE ESTATÍSTICAS DO SISTEMA
// =================================================================================================
app.get('/api/stats', (req, res) => {
    systemStats.users = {
        total: DB.users.length,
        online: systemStats.sockets.total,
        drivers: DB.users.filter(u => u.role === 'driver' && !u.banned).length,
        passengers: DB.users.filter(u => u.role === 'passenger' && !u.banned).length,
        admins: DB.users.filter(u => u.role === 'admin' && !u.banned).length,
        banned: DB.users.filter(u => u.banned).length
    };

    systemStats.rides.total = DB.rides.length;
    systemStats.rides.completed = DB.rides.filter(r => r.status === 'completed').length;
    systemStats.rides.cancelled = DB.rides.filter(r => r.status === 'cancelled').length;
    systemStats.rides.searching = DB.rides.filter(r => r.status === 'searching').length;

    systemStats.wallet.totalBalance = DB.wallets.reduce((sum, w) => sum + (w.balance || 0), 0);
    systemStats.wallet.totalTransactions = DB.wallets.reduce((sum, w) => sum + (w.transactions ? w.transactions.length : 0), 0);
    systemStats.wallet.pendingWithdrawals = DB.payments ? DB.payments.filter(p => p.status === 'pending').length : 0;

    res.json(systemStats);
});

// =================================================================================================
// 🏠 ROTA PRINCIPAL
// =================================================================================================
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>NEXUS CORE TITANIUM</title></head>
            <body style="font-family: system-ui; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                    <h1 style="font-size: 3em; margin-bottom: 20px;">⚡ NEXUS CORE</h1>
                    <p style="font-size: 1.2em; opacity: 0.9;">Sistema de Gestão de Servidor • Titanium Edition</p>
                    <div style="margin-top: 40px;">
                        <a href="/admin" style="background: rgba(255,255,255,0.2); color: white; padding: 15px 30px; border-radius: 50px; text-decoration: none; font-weight: bold;">📊 ACESSAR COMMAND CENTER</a>
                    </div>
                </div>
            </body>
        </html>
    `);
});

// =================================================================================================
// 🛠️ SOCKET.IO - CONFIGURAÇÃO DE EVENTOS
// =================================================================================================
io.on('connection', (socket) => {
    log.socket('Nova conexão: ' + socket.id);
    
    systemStats.sockets.total = io.engine.clientsCount;
    
    socket.on('join-admin-room', () => {
        socket.join('admins');
        systemStats.sockets.admins++;
    });

    socket.on('disconnect', () => {
        log.socket('Conexão encerrada: ' + socket.id);
        systemStats.sockets.total = io.engine.clientsCount;
        systemStats.sockets.admins--;
    });
});

// =================================================================================================
// 📊 DASHBOARD VISUAL - NEXUS COMMAND CENTER
// =================================================================================================
app.get('/admin', (req, res) => {
    const dashboardHTML = `<!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>✦ NEXUS CORE TITANIUM — Command Center</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                background: radial-gradient(circle at 20% 20%, #0a0f1e, #03050a);
                color: #fff;
                line-height: 1.6;
                min-height: 100vh;
                padding: 24px;
                position: relative;
                overflow-x: hidden;
            }
            body::before {
                content: '';
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-image: linear-gradient(rgba(0,255,255,0.02) 1px, transparent 1px),
                                  linear-gradient(90deg, rgba(0,255,255,0.02) 1px, transparent 1px);
                background-size: 40px 40px;
                pointer-events: none;
                z-index: 0;
            }
            .container {
                max-width: 1600px;
                margin: 0 auto;
                position: relative;
                z-index: 2;
            }
            .glass-panel {
                background: rgba(12,20,35,0.75);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(64,224,255,0.15);
                border-radius: 32px;
                box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.05);
            }
            .header {
                padding: 32px 36px;
                margin-bottom: 28px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 20px;
                position: relative;
                overflow: hidden;
            }
            .header::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 4px;
                background: linear-gradient(90deg, #00f7ff, #a742ff, #00f7ff);
                background-size: 200% 100%;
                animation: gradientMove 6s ease infinite;
            }
            @keyframes gradientMove {
                0% { background-position: 0% 0%; }
                50% { background-position: 100% 0%; }
                100% { background-position: 0% 0%; }
            }
            .logo-area { display: flex; align-items: center; gap: 20px; }
            .nexus-icon {
                font-size: 44px;
                background: linear-gradient(135deg, #00f2fe, #4facfe);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                filter: drop-shadow(0 0 20px rgba(0,242,254,0.4));
            }
            .title h1 {
                font-weight: 700;
                font-size: 2.2rem;
                letter-spacing: -0.02em;
                background: linear-gradient(to right, #ffffff, #b0e0ff);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                margin-bottom: 6px;
            }
            .badge-core {
                background: rgba(0,247,255,0.12);
                padding: 6px 16px;
                border-radius: 100px;
                font-size: 0.85rem;
                font-weight: 600;
                border: 1px solid rgba(0,247,255,0.3);
                color: #a0f0ff;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .status-pulse { display: flex; align-items: center; gap: 12px; }
            .pulse-dot {
                width: 12px;
                height: 12px;
                background: #00ff88;
                border-radius: 50%;
                box-shadow: 0 0 15px #00ff88;
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.6; transform: scale(1.2); }
                100% { opacity: 1; transform: scale(1); }
            }
            .refresh-btn {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                color: white;
                padding: 12px 28px;
                border-radius: 40px;
                font-weight: 600;
                font-size: 0.95rem;
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                transition: all 0.25s;
                backdrop-filter: blur(10px);
            }
            .refresh-btn:hover {
                background: rgba(0,247,255,0.15);
                border-color: rgba(0,247,255,0.5);
                transform: translateY(-2px);
                box-shadow: 0 12px 25px -8px rgba(0,247,255,0.3);
            }
            .kpi-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                gap: 24px;
                margin-bottom: 28px;
            }
            .kpi-card {
                background: rgba(18,28,45,0.7);
                backdrop-filter: blur(16px);
                border: 1px solid rgba(79,172,254,0.2);
                border-radius: 28px;
                padding: 26px;
                transition: all 0.3s ease;
                position: relative;
                overflow: hidden;
            }
            .kpi-card:hover {
                border-color: rgba(0,247,255,0.5);
                background: rgba(25,40,60,0.8);
                transform: translateY(-4px);
                box-shadow: 0 20px 35px -10px rgba(0,180,255,0.25);
            }
            .kpi-icon {
                font-size: 26px;
                width: 52px;
                height: 52px;
                background: linear-gradient(145deg, rgba(0,247,255,0.1), rgba(167,66,255,0.1));
                border-radius: 18px;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 20px;
                color: #7ad0ff;
                border: 1px solid rgba(0,247,255,0.2);
            }
            .kpi-label {
                font-size: 0.9rem;
                text-transform: uppercase;
                letter-spacing: 1.5px;
                font-weight: 600;
                color: #a0c0e0;
                margin-bottom: 8px;
            }
            .kpi-value {
                font-size: 3.2rem;
                font-weight: 700;
                line-height: 1;
                margin-bottom: 12px;
                font-family: 'JetBrains Mono', monospace;
                background: linear-gradient(135deg, #fff, #c0e0ff);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .kpi-sub {
                display: flex;
                justify-content: space-between;
                color: #99badd;
                font-size: 0.9rem;
                font-weight: 500;
            }
            .progress-track {
                width: 100%;
                height: 6px;
                background: rgba(255,255,255,0.08);
                border-radius: 6px;
                margin-top: 18px;
                overflow: hidden;
            }
            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #00e0ff, #8a2be2);
                border-radius: 6px;
                width: 0%;
                transition: width 0.8s;
                position: relative;
                box-shadow: 0 0 10px #00a6ff;
            }
            .tab-nav {
                display: flex;
                gap: 8px;
                margin-bottom: 28px;
                background: rgba(12,20,35,0.5);
                padding: 8px;
                border-radius: 48px;
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.05);
                flex-wrap: wrap;
            }
            .tab-btn {
                padding: 12px 28px;
                border-radius: 40px;
                font-weight: 600;
                background: transparent;
                border: none;
                color: #a0c0e0;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 0.95rem;
            }
            .tab-btn.active {
                background: rgba(0,247,255,0.15);
                color: white;
                border: 1px solid rgba(0,247,255,0.3);
            }
            .tab-btn:hover {
                background: rgba(255,255,255,0.05);
                color: white;
            }
            .panel {
                display: none;
                background: rgba(12,20,35,0.6);
                backdrop-filter: blur(16px);
                border: 1px solid rgba(79,172,254,0.15);
                border-radius: 28px;
                padding: 28px;
                margin-bottom: 28px;
            }
            .panel.active {
                display: block;
            }
            .panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 24px;
            }
            .panel-header h3 {
                font-weight: 600;
                font-size: 1.2rem;
                display: flex;
                align-items: center;
                gap: 12px;
                color: #e0f0ff;
            }
            .data-table {
                width: 100%;
                border-collapse: collapse;
            }
            .data-table th {
                text-align: left;
                padding: 14px 8px;
                font-weight: 600;
                color: #8ab0e0;
                font-size: 0.8rem;
                letter-spacing: 1px;
                text-transform: uppercase;
                border-bottom: 1px solid rgba(255,255,255,0.08);
            }
            .data-table td {
                padding: 14px 8px;
                border-bottom: 1px solid rgba(255,255,255,0.04);
                font-size: 0.9rem;
                color: #d0e0f0;
            }
            .badge {
                display: inline-block;
                padding: 4px 12px;
                border-radius: 40px;
                font-weight: 600;
                font-size: 0.75rem;
            }
            .badge-success { background: rgba(0,255,100,0.2); color: #a0ffc0; border: 1px solid rgba(0,255,100,0.3); }
            .badge-warning { background: rgba(255,200,0,0.2); color: #ffe090; border: 1px solid rgba(255,200,0,0.3); }
            .badge-danger { background: rgba(255,70,70,0.2); color: #ffb0b0; border: 1px solid rgba(255,70,70,0.3); }
            .badge-info { background: rgba(0,200,255,0.2); color: #a0e0ff; border: 1px solid rgba(0,200,255,0.3); }
            .code-editor-container {
                background: #0a0e1a;
                border-radius: 20px;
                padding: 20px;
                border: 1px solid #1e2a3a;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.85rem;
                line-height: 1.6;
                color: #e0e6f0;
            }
            .code-editor {
                width: 100%;
                min-height: 400px;
                background: #0a0e1a;
                border: none;
                color: #e0f0ff;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.85rem;
                line-height: 1.6;
                resize: vertical;
                outline: none;
                padding: 0px;
            }
            .editor-actions {
                display: flex;
                justify-content: flex-end;
                gap: 16px;
                margin-top: 20px;
            }
            .btn-primary {
                background: linear-gradient(145deg, #0066cc, #0055aa);
                border: none;
                padding: 12px 32px;
                border-radius: 40px;
                font-weight: 600;
                color: white;
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                transition: all 0.2s;
                border: 1px solid rgba(255,255,255,0.2);
            }
            .btn-primary:hover {
                background: linear-gradient(145deg, #1a7fe5, #0066cc);
                box-shadow: 0 10px 20px -5px #0066cc80;
                transform: translateY(-2px);
            }
            .btn-secondary {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                padding: 12px 28px;
                border-radius: 40px;
                font-weight: 500;
                color: #d0e0ff;
                display: flex;
                align-items: center;
                gap: 10px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .btn-secondary:hover {
                background: rgba(255,255,255,0.1);
            }
            .modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.8);
                backdrop-filter: blur(10px);
                z-index: 1000;
                align-items: center;
                justify-content: center;
            }
            .modal.active {
                display: flex;
            }
            .modal-content {
                background: rgba(18,28,45,0.95);
                border: 1px solid rgba(0,247,255,0.3);
                border-radius: 32px;
                padding: 32px;
                max-width: 600px;
                width: 90%;
                max-height: 80vh;
                overflow-y: auto;
            }
            .form-group {
                margin-bottom: 20px;
            }
            .form-group label {
                display: block;
                margin-bottom: 8px;
                color: #a0c0e0;
                font-weight: 500;
            }
            .form-control {
                width: 100%;
                padding: 14px 18px;
                background: rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 16px;
                color: white;
                font-size: 1rem;
                transition: all 0.2s;
            }
            .form-control:focus {
                border-color: #00a6ff;
                outline: none;
                box-shadow: 0 0 0 3px rgba(0,166,255,0.2);
            }
            .log-container {
                background: rgba(0,0,0,0.35);
                border-radius: 20px;
                padding: 20px;
                max-height: 200px;
                overflow-y: auto;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.75rem;
                border: 1px solid #1e2e4e;
            }
            .log-entry {
                padding: 6px 0;
                border-bottom: 1px dashed rgba(255,255,255,0.03);
                color: #a0c0e0;
                display: flex;
                gap: 12px;
            }
            .log-time { color: #70c0ff; }
            .footer {
                margin-top: 40px;
                padding: 24px;
                text-align: center;
                color: #a0b8d0;
                font-size: 0.85rem;
                border-top: 1px solid rgba(255,255,255,0.05);
            }
            @media (max-width: 700px) {
                .header { flex-direction: column; align-items: flex-start; }
                .kpi-value { font-size: 2.4rem; }
                .tab-nav { border-radius: 20px; }
                .tab-btn { flex: 1; padding: 10px; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="glass-panel header">
                <div class="logo-area">
                    <div class="nexus-icon"><i class="fas fa-microchip"></i></div>
                    <div class="title">
                        <h1>NEXUS CORE TITANIUM</h1>
                        <div class="badge-core">
                            <i class="fas fa-shield-alt"></i> PRODUÇÃO • v12.0.1
                        </div>
                    </div>
                </div>
                <div class="status-pulse">
                    <div class="pulse-dot"></div>
                    <span style="color: #c0f0ff; font-weight: 500;" id="connectionStatus">ONLINE • 0 CONEXÕES</span>
                    <button class="refresh-btn" id="forceRefresh">
                        <i class="fas fa-sync-alt"></i> SINCRONIZAR
                    </button>
                </div>
            </div>

            <div class="kpi-grid" id="kpiGrid"></div>

            <div class="tab-nav">
                <button class="tab-btn active" data-tab="dashboard"><i class="fas fa-chart-line"></i> DASHBOARD</button>
                <button class="tab-btn" data-tab="users"><i class="fas fa-users"></i> USUÁRIOS</button>
                <button class="tab-btn" data-tab="wallet"><i class="fas fa-wallet"></i> CARTEIRAS</button>
                <button class="tab-btn" data-tab="rides"><i class="fas fa-route"></i> CORRIDAS</button>
                <button class="tab-btn" data-tab="files"><i class="fas fa-file-code"></i> EDITOR</button>
                <button class="tab-btn" data-tab="logs"><i class="fas fa-history"></i> LOGS</button>
            </div>

            <div id="panel-dashboard" class="panel active">
                <div class="panel-header">
                    <h3><i class="fas fa-chart-bar"></i> MÉTRICAS DO SISTEMA</h3>
                    <span style="color: #80b0ff;">Atualizado em tempo real via Socket.IO</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                    <div class="glass-panel" style="padding: 24px;">
                        <h4 style="margin-bottom: 16px;">📊 PERFORMANCE</h4>
                        <div style="display: flex; flex-direction: column; gap: 16px;">
                            <div style="display: flex; justify-content: space-between;">
                                <span>CPU Usage</span>
                                <span style="font-family: monospace;" id="cpuUsage">0%</span>
                            </div>
                            <div class="progress-track"><div class="progress-fill" id="cpuProgress" style="width: 0%;"></div></div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>RAM Usage</span>
                                <span style="font-family: monospace;" id="ramUsage">0%</span>
                            </div>
                            <div class="progress-track"><div class="progress-fill" id="ramProgress" style="width: 0%;"></div></div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Response Time</span>
                                <span style="font-family: monospace;" id="avgResponse">0ms</span>
                            </div>
                        </div>
                    </div>
                    <div class="glass-panel" style="padding: 24px;">
                        <h4 style="margin-bottom: 16px;">🔄 REQUISIÇÕES</h4>
                        <div style="display: flex; flex-direction: column; gap: 16px;">
                            <div style="display: flex; justify-content: space-between;">
                                <span>Total</span>
                                <span style="font-family: monospace;" id="totalRequests">0</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>GET / POST</span>
                                <span style="font-family: monospace;" id="getPostRatio">0 / 0</span>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>Erros 4xx/5xx</span>
                                <span style="font-family: monospace; color: #ff9caa;" id="errorRate">0%</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="margin-top: 28px;">
                    <h4 style="margin-bottom: 16px;">📋 ÚLTIMAS REQUISIÇÕES</h4>
                    <table class="data-table" id="requestsTable">
                        <thead>
                            <tr><th>Hora</th><th>Método</th><th>Endpoint</th><th>Status</th><th>Tempo</th></tr>
                        </thead>
                        <tbody id="requestsTableBody"></tbody>
                    </table>
                </div>
            </div>

            <div id="panel-users" class="panel">
                <div class="panel-header">
                    <h3><i class="fas fa-user-cog"></i> GESTÃO DE USUÁRIOS</h3>
                    <button class="btn-primary" id="createUserBtn"><i class="fas fa-plus"></i> NOVO USUÁRIO</button>
                </div>
                <div style="margin-bottom: 20px; display: flex; gap: 12px;">
                    <input type="text" id="userSearch" placeholder="Buscar usuário..." class="form-control" style="max-width: 300px;">
                    <select id="userRoleFilter" class="form-control" style="max-width: 150px;">
                        <option value="">Todos os perfis</option>
                        <option value="admin">Admin</option>
                        <option value="driver">Motorista</option>
                        <option value="passenger">Passageiro</option>
                    </select>
                    <select id="userStatusFilter" class="form-control" style="max-width: 150px;">
                        <option value="">Todos os status</option>
                        <option value="active">Ativos</option>
                        <option value="banned">Banidos</option>
                    </select>
                </div>
                <table class="data-table">
                    <thead>
                        <tr><th>ID</th><th>Usuário</th><th>Email</th><th>Perfil</th><th>Saldo</th><th>Status</th><th>Corridas</th><th>Ações</th></tr>
                    </thead>
                    <tbody id="usersTableBody"></tbody>
                </table>
            </div>

            <div id="panel-wallet" class="panel">
                <div class="panel-header">
                    <h3><i class="fas fa-coins"></i> CARTEIRA DIGITAL</h3>
                    <span style="color: #8affc1;" id="walletTotalBalance">Saldo total: R$ 0,00</span>
                </div>
                <div class="kpi-grid" style="margin-bottom: 24px;">
                    <div class="kpi-card">
                        <div class="kpi-icon"><i class="fas fa-wallet"></i></div>
                        <div class="kpi-label">SALDO TOTAL</div>
                        <div class="kpi-value" id="totalBalanceValue">R$ 0</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-icon"><i class="fas fa-exchange-alt"></i></div>
                        <div class="kpi-label">TRANSAÇÕES</div>
                        <div class="kpi-value" id="totalTransactions">0</div>
                    </div>
                    <div class="kpi-card">
                        <div class="kpi-icon"><i class="fas fa-clock"></i></div>
                        <div class="kpi-label">PENDENTES</div>
                        <div class="kpi-value" id="pendingWithdrawals">0</div>
                    </div>
                </div>
                <h4 style="margin-bottom: 16px;">ÚLTIMAS TRANSAÇÕES</h4>
                <table class="data-table">
                    <thead>
                        <tr><th>Data</th><th>Usuário</th><th>Tipo</th><th>Valor</th><th>Descrição</th></tr>
                    </thead>
                    <tbody id="transactionsTableBody"></tbody>
                </table>
                <div style="margin-top: 24px;">
                    <button class="btn-primary" id="adjustBalanceBtn"><i class="fas fa-coins"></i> AJUSTAR SALDO</button>
                </div>
            </div>

            <div id="panel-rides" class="panel">
                <div class="panel-header">
                    <h3><i class="fas fa-car"></i> CORRIDAS EM TEMPO REAL</h3>
                    <span id="activeRidesCount">0 ativas</span>
                </div>
                <table class="data-table">
                    <thead>
                        <tr><th>ID</th><th>Passageiro</th><th>Motorista</th><th>Origem</th><th>Destino</th><th>Status</th><th>Valor</th><th>Ações</th></tr>
                    </thead>
                    <tbody id="ridesTableBody"></tbody>
                </table>
            </div>

            <div id="panel-files" class="panel">
                <div class="panel-header">
                    <h3><i class="fas fa-code"></i> EDITOR DE ARQUIVOS</h3>
                    <div style="display: flex; gap: 12px;" id="fileSelector"></div>
                </div>
                <div class="code-editor-container">
                    <textarea id="codeEditor" class="code-editor" spellcheck="false">// Selecione um arquivo para editar</textarea>
                </div>
                <div class="editor-actions">
                    <button class="btn-secondary" id="reloadFileBtn"><i class="fas fa-undo-alt"></i> RECARREGAR</button>
                    <button class="btn-primary" id="saveFileBtn"><i class="fas fa-save"></i> SALVAR NO SERVIDOR</button>
                </div>
            </div>

            <div id="panel-logs" class="panel">
                <div class="panel-header">
                    <h3><i class="fas fa-terminal"></i> LOGS DO SISTEMA</h3>
                </div>
                <div class="log-container" id="systemLogs"></div>
            </div>

            <div id="createUserModal" class="modal">
                <div class="modal-content">
                    <h3 style="margin-bottom: 24px;"><i class="fas fa-user-plus"></i> Criar Novo Usuário</h3>
                    <form id="createUserForm">
                        <div class="form-group">
                            <label>Nome de usuário</label>
                            <input type="text" class="form-control" id="newUsername" required>
                        </div>
                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" class="form-control" id="newEmail" required>
                        </div>
                        <div class="form-group">
                            <label>Telefone</label>
                            <input type="text" class="form-control" id="newPhone">
                        </div>
                        <div class="form-group">
                            <label>Senha</label>
                            <input type="password" class="form-control" id="newPassword" required>
                        </div>
                        <div class="form-group">
                            <label>Perfil</label>
                            <select class="form-control" id="newRole">
                                <option value="passenger">Passageiro</option>
                                <option value="driver">Motorista</option>
                                <option value="admin">Administrador</option>
                            </select>
                        </div>
                        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                            <button type="button" class="btn-secondary" id="cancelCreateUser">Cancelar</button>
                            <button type="submit" class="btn-primary">Criar Usuário</button>
                        </div>
                    </form>
                </div>
            </div>

            <div id="adjustBalanceModal" class="modal">
                <div class="modal-content">
                    <h3 style="margin-bottom: 24px;"><i class="fas fa-coins"></i> Ajustar Saldo</h3>
                    <form id="adjustBalanceForm">
                        <div class="form-group">
                            <label>ID do Usuário</label>
                            <input type="number" class="form-control" id="adjustUserId" required>
                        </div>
                        <div class="form-group">
                            <label>Tipo</label>
                            <select class="form-control" id="adjustType">
                                <option value="credit">Creditar (adicionar)</option>
                                <option value="debit">Debitar (remover)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Valor (R$)</label>
                            <input type="number" class="form-control" id="adjustAmount" step="0.01" required>
                        </div>
                        <div class="form-group">
                            <label>Descrição</label>
                            <input type="text" class="form-control" id="adjustDescription" placeholder="Ajuste administrativo">
                        </div>
                        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                            <button type="button" class="btn-secondary" id="cancelAdjustBalance">Cancelar</button>
                            <button type="submit" class="btn-primary">Confirmar Ajuste</button>
                        </div>
                    </form>
                </div>
            </div>

            <div class="footer">
                <span style="display: flex; justify-content: center; gap: 40px; flex-wrap: wrap;">
                    <span><i class="fas fa-database"></i> <span id="dbSize">0</span> registros</span>
                    <span><i class="fas fa-microchip"></i> <span id="serverUptime">0</span></span>
                    <span><i class="fas fa-tachometer-alt"></i> <span id="serverLoad">0%</span></span>
                </span>
                <p style="margin-top: 24px;">✦ NEXUS CORE TITANIUM — COMMAND CENTER • Gestão Completa do Servidor ✦</p>
                <p style="margin-top: 16px; opacity: 0.5;">Editor de código em tempo real • Gestão de usuários • Carteira digital • Corridas • Socket.IO</p>
            </div>
        </div>

        <script>
            let authToken = localStorage.getItem('adminToken') || 'demo-token';
            let currentFile = 'server.js';
            let socket = null;
            let DB = { logs: [] };

            async function fetchAPI(endpoint, options = {}) {
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken,
                    ...options.headers
                };

                const response = await fetch(endpoint, {
                    ...options,
                    headers
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({ error: 'Erro na requisição' }));
                    throw new Error(error.error || 'Erro na requisição');
                }

                return await response.json();
            }

            function addLog(message) {
                const time = new Date().toLocaleTimeString('pt-BR');
                const logsContainer = document.getElementById('systemLogs');
                const entry = document.createElement('div');
                entry.className = 'log-entry';
                entry.innerHTML = '<span class="log-time">[' + time + ']</span> ' + message;
                logsContainer.prepend(entry);
                if (logsContainer.children.length > 100) {
                    logsContainer.removeChild(logsContainer.lastChild);
                }
            }

            async function loadDashboardData() {
                try {
                    const stats = await fetchAPI('/api/stats');
                    
                    document.getElementById('totalRequests').innerHTML = stats.requests?.total || 0;
                    document.getElementById('getPostRatio').innerHTML = (stats.requests?.byMethod?.GET || 0) + ' / ' + (stats.requests?.byMethod?.POST || 0);
                    document.getElementById('avgResponse').innerHTML = Math.round(stats.performance?.avgResponseTime || 0) + 'ms';
                    document.getElementById('cpuUsage').innerHTML = Math.round(stats.performance?.cpuUsage || 0) + '%';
                    document.getElementById('ramUsage').innerHTML = Math.round(stats.performance?.memoryUsage || 0) + '%';
                    
                    document.getElementById('cpuProgress').style.width = Math.min(stats.performance?.cpuUsage || 0, 100) + '%';
                    document.getElementById('ramProgress').style.width = Math.min(stats.performance?.memoryUsage || 0, 100) + '%';

                    const requestsTbody = document.getElementById('requestsTableBody');
                    if (stats.requests?.last10) {
                        requestsTbody.innerHTML = stats.requests.last10.map(req => {
                            let statusClass = 'badge-success';
                            if (req.statusCode >= 400) statusClass = 'badge-danger';
                            else if (req.statusCode >= 300) statusClass = 'badge-warning';
                            
                            return '<tr>' +
                                '<td>' + new Date(req.time).toLocaleTimeString('pt-BR') + '</td>' +
                                '<td><span class="badge badge-' + (req.method === 'GET' ? 'info' : req.method === 'POST' ? 'success' : 'warning') + '">' + req.method + '</span></td>' +
                                '<td style="font-family: monospace;">' + req.url + '</td>' +
                                '<td><span class="badge ' + statusClass + '">' + req.statusCode + '</span></td>' +
                                '<td>' + req.duration + 'ms</td>' +
                            '</tr>';
                        }).join('');
                    }

                    const kpiGrid = document.getElementById('kpiGrid');
                    kpiGrid.innerHTML = 
                        '<div class="kpi-card">' +
                            '<div class="kpi-icon"><i class="fas fa-users"></i></div>' +
                            '<div class="kpi-label">CONEXÕES ATIVAS</div>' +
                            '<div class="kpi-value">' + (stats.sockets?.total || 0) + '</div>' +
                            '<div class="kpi-sub">' +
                                '<span>🚗 ' + (stats.sockets?.drivers || 0) + ' motoristas</span>' +
                                '<span>👤 ' + (stats.sockets?.passengers || 0) + ' passageiros</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="kpi-card">' +
                            '<div class="kpi-icon"><i class="fas fa-route"></i></div>' +
                            '<div class="kpi-label">CORRIDAS HOJE</div>' +
                            '<div class="kpi-value">' + (stats.rides?.total || 0) + '</div>' +
                            '<div class="kpi-sub">' +
                                '<span>✅ ' + (stats.rides?.completed || 0) + ' completas</span>' +
                                '<span>🔍 ' + (stats.rides?.searching || 0) + ' buscando</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="kpi-card">' +
                            '<div class="kpi-icon"><i class="fas fa-wallet"></i></div>' +
                            '<div class="kpi-label">SALDO TOTAL</div>' +
                            '<div class="kpi-value">R$ ' + (stats.wallet?.totalBalance || 0).toFixed(2) + '</div>' +
                            '<div class="kpi-sub">' +
                                '<span>💰 ' + (stats.wallet?.totalTransactions || 0) + ' transações</span>' +
                                '<span>⏳ ' + (stats.wallet?.pendingWithdrawals || 0) + ' pendentes</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="kpi-card">' +
                            '<div class="kpi-icon"><i class="fas fa-users-cog"></i></div>' +
                            '<div class="kpi-label">USUÁRIOS</div>' +
                            '<div class="kpi-value">' + (stats.users?.total || 0) + '</div>' +
                            '<div class="kpi-sub">' +
                                '<span>👑 ' + (stats.users?.admins || 0) + ' admins</span>' +
                                '<span>🚗 ' + (stats.users?.drivers || 0) + ' motoristas</span>' +
                            '</div>' +
                        '</div>';
                    
                    addLog('📊 Dados do dashboard atualizados');
                } catch (err) {
                    addLog('🔴 Erro ao carregar dados: ' + err.message);
                }
            }

            async function loadUsers() {
                try {
                    const search = document.getElementById('userSearch')?.value || '';
                    const role = document.getElementById('userRoleFilter')?.value || '';
                    const status = document.getElementById('userStatusFilter')?.value || '';
                    
                    const url = '/api/admin/users?limit=50' + 
                        (search ? '&search=' + encodeURIComponent(search) : '') +
                        (role ? '&role=' + role : '') +
                        (status ? '&status=' + status : '');
                    
                    const data = await fetchAPI(url);
                    const tbody = document.getElementById('usersTableBody');
                    
                    tbody.innerHTML = data.users.map(user => {
                        let roleClass = 'badge-info';
                        if (user.role === 'admin') roleClass = 'badge-warning';
                        if (user.role === 'driver') roleClass = 'badge-info';
                        if (user.role === 'passenger') roleClass = 'badge-success';
                        
                        let statusClass = user.banned ? 'badge-danger' : 'badge-success';
                        let statusText = user.banned ? 'Banido' : 'Ativo';
                        
                        return '<tr>' +
                            '<td style="font-family: monospace;">#' + user.id + '</td>' +
                            '<td>' + (user.username || '') + '</td>' +
                            '<td>' + (user.email || '') + '</td>' +
                            '<td><span class="badge ' + roleClass + '">' + (user.role || 'passenger') + '</span></td>' +
                            '<td>R$ ' + (user.balance || 0).toFixed(2) + '</td>' +
                            '<td><span class="badge ' + statusClass + '">' + statusText + '</span></td>' +
                            '<td>' + (user.totalRides || 0) + '</td>' +
                            '<td>' +
                                '<button class="btn-secondary" style="padding: 6px 12px;" onclick="editUser(' + user.id + ')"><i class="fas fa-edit"></i></button> ' +
                                '<button class="btn-secondary" style="padding: 6px 12px;" onclick="toggleBanUser(' + user.id + ')"><i class="fas fa-ban"></i></button> ' +
                                '<button class="btn-secondary" style="padding: 6px 12px;" onclick="deleteUser(' + user.id + ')"><i class="fas fa-trash"></i></button>' +
                            '</td>' +
                        '</tr>';
                    }).join('');

                    document.getElementById('dbSize').innerHTML = data.total + ' usuários';
                } catch (err) {
                    addLog('🔴 Erro ao carregar usuários: ' + err.message);
                }
            }

            async function loadTransactions() {
                try {
                    const data = await fetchAPI('/api/admin/wallet/transactions');
                    const tbody = document.getElementById('transactionsTableBody');
                    
                    tbody.innerHTML = data.transactions.map(t => {
                        let typeClass = t.type === 'credit' ? 'badge-success' : 'badge-danger';
                        let typeText = t.type === 'credit' ? 'Crédito' : 'Débito';
                        
                        return '<tr>' +
                            '<td>' + new Date(t.timestamp).toLocaleString('pt-BR') + '</td>' +
                            '<td>' + (t.username || '#' + t.userId) + '</td>' +
                            '<td><span class="badge ' + typeClass + '">' + typeText + '</span></td>' +
                            '<td>R$ ' + (t.amount || 0).toFixed(2) + '</td>' +
                            '<td>' + (t.description || '-') + '</td>' +
                        '</tr>';
                    }).join('');

                    const walletStats = await fetchAPI('/api/admin/wallet/stats');
                    document.getElementById('walletTotalBalance').innerHTML = 'Saldo total: R$ ' + walletStats.totalBalance.toFixed(2);
                    document.getElementById('totalBalanceValue').innerHTML = 'R$ ' + Math.round(walletStats.totalBalance);
                    document.getElementById('totalTransactions').innerHTML = walletStats.totalTransactions;
                    document.getElementById('pendingWithdrawals').innerHTML = walletStats.pendingWithdrawals;
                } catch (err) {
                    addLog('🔴 Erro ao carregar transações: ' + err.message);
                }
            }

            async function loadRides() {
                try {
                    const data = await fetchAPI('/api/admin/rides?limit=20');
                    const tbody = document.getElementById('ridesTableBody');
                    
                    tbody.innerHTML = data.rides.map(ride => {
                        let statusClass = 'badge-warning';
                        if (ride.status === 'completed') statusClass = 'badge-success';
                        if (ride.status === 'cancelled') statusClass = 'badge-danger';
                        
                        return '<tr>' +
                            '<td>#' + (ride.id || '') + '</td>' +
                            '<td>' + (ride.passengerName || ride.passengerId || '-') + '</td>' +
                            '<td>' + (ride.driverName || 'Buscando...') + '</td>' +
                            '<td>' + (ride.origin || '-') + '</td>' +
                            '<td>' + (ride.destination || '-') + '</td>' +
                            '<td><span class="badge ' + statusClass + '">' + (ride.status || 'unknown') + '</span></td>' +
                            '<td>R$ ' + (ride.price || '0,00') + '</td>' +
                            '<td><button class="btn-secondary" style="padding: 6px 12px;"><i class="fas fa-eye"></i></button></td>' +
                        '</tr>';
                    }).join('');

                    document.getElementById('activeRidesCount').innerHTML = (data.stats?.active || 0) + ' ativas';
                } catch (err) {
                    addLog('🔴 Erro ao carregar corridas: ' + err.message);
                }
            }

            async function loadFiles() {
                try {
                    const data = await fetchAPI('/api/files');
                    const fileSelector = document.getElementById('fileSelector');
                    
                    fileSelector.innerHTML = data.files.map(file => {
                        return '<button class="btn-secondary file-btn' + (file.path === currentFile ? ' active' : '') + '" onclick="loadFile(\'' + file.path + '\', this)">' +
                            '<i class="fas fa-file-code"></i> ' + file.name +
                        '</button>';
                    }).join('');
                    
                    await loadFile(currentFile);
                } catch (err) {
                    addLog('🔴 Erro ao carregar arquivos: ' + err.message);
                }
            }

            window.loadFile = async function(filePath, btn) {
                try {
                    currentFile = filePath;
                    const data = await fetchAPI('/api/files/content?file=' + encodeURIComponent(filePath));
                    document.getElementById('codeEditor').value = data.content;
                    
                    document.querySelectorAll('.file-btn').forEach(b => b.classList.remove('active'));
                    if (btn) btn.classList.add('active');
                    
                    addLog('📁 Arquivo ' + filePath + ' carregado (' + (data.size / 1024).toFixed(2) + ' KB)');
                } catch (err) {
                    addLog('🔴 Erro ao carregar arquivo: ' + err.message);
                }
            };

            async function saveFile() {
                try {
                    const content = document.getElementById('codeEditor').value;
                    await fetchAPI('/api/files/save', {
                        method: 'POST',
                        body: JSON.stringify({
                            file: currentFile,
                            content: content
                        })
                    });
                    
                    addLog('💾 Arquivo salvo com sucesso no servidor');
                    
                    const btn = document.getElementById('saveFileBtn');
                    btn.innerHTML = '<i class="fas fa-check"></i> SALVO!';
                    btn.style.background = 'linear-gradient(145deg, #00a86b, #00804b)';
                    setTimeout(() => {
                        btn.innerHTML = '<i class="fas fa-save"></i> SALVAR NO SERVIDOR';
                        btn.style.background = 'linear-gradient(145deg, #0066cc, #0055aa)';
                    }, 2000);
                } catch (err) {
                    addLog('🔴 Erro ao salvar arquivo: ' + err.message);
                }
            }

            window.editUser = async function(userId) {
                addLog('✏️ Editando usuário #' + userId);
            };

            window.toggleBanUser = async function(userId) {
                try {
                    await fetchAPI('/api/admin/users/' + userId, {
                        method: 'PUT',
                        body: JSON.stringify({ banned: true })
                    });
                    loadUsers();
                    addLog('🚫 Usuário #' + userId + ' status alterado');
                } catch (err) {
                    addLog('🔴 Erro ao banir usuário: ' + err.message);
                }
            };

            window.deleteUser = async function(userId) {
                if (confirm('Tem certeza que deseja remover este usuário?')) {
                    try {
                        await fetchAPI('/api/admin/users/' + userId, {
                            method: 'DELETE'
                        });
                        loadUsers();
                        addLog('🗑️ Usuário #' + userId + ' removido');
                    } catch (err) {
                        addLog('🔴 Erro ao remover usuário: ' + err.message);
                    }
                }
            };

            function connectSocket() {
                socket = io();
                
                socket.on('connect', function() {
                    document.getElementById('connectionStatus').innerHTML = 'ONLINE • ' + socket.connected + ' CONEXÕES';
                    addLog('🟢 Conectado ao servidor em tempo real');
                });

                socket.on('stats:update', function(stats) {
                    loadDashboardData();
                });

                socket.on('file:updated', function(data) {
                    addLog('📁 Arquivo ' + data.file + ' editado por ' + data.editor);
                });
            }

            function setupEventListeners() {
                document.querySelectorAll('.tab-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
                        
                        this.classList.add('active');
                        const tabName = this.dataset.tab;
                        document.getElementById('panel-' + tabName).classList.add('active');
                    });
                });

                document.getElementById('forceRefresh').addEventListener('click', function() {
                    loadDashboardData();
                    loadUsers();
                    loadTransactions();
                    loadRides();
                });

                document.getElementById('saveFileBtn').addEventListener('click', saveFile);
                document.getElementById('reloadFileBtn').addEventListener('click', function() {
                    loadFile(currentFile);
                });

                document.getElementById('createUserBtn').addEventListener('click', function() {
                    document.getElementById('createUserModal').classList.add('active');
                });

                document.getElementById('cancelCreateUser').addEventListener('click', function() {
                    document.getElementById('createUserModal').classList.remove('active');
                });

                document.getElementById('createUserForm').addEventListener('submit', async function(e) {
                    e.preventDefault();
                    try {
                        const userData = {
                            username: document.getElementById('newUsername').value,
                            email: document.getElementById('newEmail').value,
                            phone: document.getElementById('newPhone').value,
                            password: document.getElementById('newPassword').value,
                            role: document.getElementById('newRole').value
                        };

                        await fetchAPI('/api/admin/users/create', {
                            method: 'POST',
                            body: JSON.stringify(userData)
                        });

                        document.getElementById('createUserModal').classList.remove('active');
                        document.getElementById('createUserForm').reset();
                        loadUsers();
                        addLog('👤 Usuário criado com sucesso');
                    } catch (err) {
                        addLog('🔴 Erro ao criar usuário: ' + err.message);
                    }
                });

                document.getElementById('adjustBalanceBtn').addEventListener('click', function() {
                    document.getElementById('adjustBalanceModal').classList.add('active');
                });

                document.getElementById('cancelAdjustBalance').addEventListener('click', function() {
                    document.getElementById('adjustBalanceModal').classList.remove('active');
                });

                document.getElementById('adjustBalanceForm').addEventListener('submit', async function(e) {
                    e.preventDefault();
                    try {
                        const adjustData = {
                            userId: parseInt(document.getElementById('adjustUserId').value),
                            type: document.getElementById('adjustType').value,
                            amount: parseFloat(document.getElementById('adjustAmount').value),
                            description: document.getElementById('adjustDescription').value || 'Ajuste administrativo'
                        };

                        await fetchAPI('/api/admin/wallet/adjust', {
                            method: 'POST',
                            body: JSON.stringify(adjustData)
                        });

                        document.getElementById('adjustBalanceModal').classList.remove('active');
                        document.getElementById('adjustBalanceForm').reset();
                        loadTransactions();
                        loadUsers();
                        addLog('💰 Saldo ajustado com sucesso');
                    } catch (err) {
                        addLog('🔴 Erro ao ajustar saldo: ' + err.message);
                    }
                });

                document.getElementById('userSearch').addEventListener('input', debounce(loadUsers, 500));
                document.getElementById('userRoleFilter').addEventListener('change', loadUsers);
                document.getElementById('userStatusFilter').addEventListener('change', loadUsers);
            }

            function debounce(func, wait) {
                let timeout;
                return function() {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func.apply(this, arguments), wait);
                };
            }

            function init() {
                connectSocket();
                loadDashboardData();
                loadUsers();
                loadTransactions();
                loadRides();
                loadFiles();
                setupEventListeners();
                
                setInterval(loadDashboardData, 30000);
                setInterval(loadTransactions, 60000);
            }

            document.addEventListener('DOMContentLoaded', init);
        </script>
    </body>
    </html>`;
    
    res.send(dashboardHTML);
});

// =================================================================================================
// 🚀 INICIALIZAÇÃO DO SERVIDOR
// =================================================================================================
async function startServer() {
    try {
        console.clear();
        console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗    ██████╗ ██████╗ ██████╗ ███████╗
║   ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝   ██╔════╝██╔═══██╗██╔══██╗██╔════╝
║   ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗   ██║     ██║   ██║██████╔╝█████╗  
║   ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║   ██║     ██║   ██║██╔══██╗██╔══╝  
║   ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║   ╚██████╗╚██████╔╝██║  ██║███████╗
║   ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝    ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝
║                                                                              ║
║                    🚀 TITANIUM COMMAND CENTER v12.0.1                       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
        `));

        if (DB.users.length === 0) {
            const adminPassword = await bcrypt.hash('admin123', CONFIG.BCRYPT_ROUNDS);
            DB.users.push({
                id: 1,
                username: 'admin',
                email: 'admin@nexus.com',
                password: adminPassword,
                role: 'admin',
                balance: 0,
                createdAt: new Date(),
                banned: false,
                totalRides: 0,
                rating: 5.0
            });
            
            DB.wallets.push({
                userId: 1,
                balance: 0,
                transactions: [],
                createdAt: new Date()
            });
            
            await saveDB();
            log.success('Usuário admin criado (admin@nexus.com / admin123)');
        }

        await fs.mkdir(path.join(__dirname, 'backups'), { recursive: true });
        await fs.mkdir(path.join(__dirname, 'uploads'), { recursive: true });

        server.listen(CONFIG.PORT, '0.0.0.0', () => {
            log.success('🚀 Servidor rodando na porta ' + CONFIG.PORT);
            log.info('📊 Dashboard: http://localhost:' + CONFIG.PORT + '/admin');
            log.info('🔌 Socket.IO: ws://localhost:' + CONFIG.PORT);
            log.info('👑 Admin: admin@nexus.com / admin123');
            
            const table = new Table({
                head: [chalk.white('🌐 ENDPOINT'), chalk.white('📡 MÉTODO'), chalk.white('📝 DESCRIÇÃO')],
                colWidths: [45, 15, 40],
                style: { head: ['cyan'], border: ['gray'] }
            });

            table.push(
                ['/', 'GET', 'Página inicial'],
                ['/admin', 'GET', 'Dashboard Titanium'],
                ['/api/stats', 'GET', 'Estatísticas do sistema'],
                ['/api/files', 'GET', 'Lista arquivos (admin)'],
                ['/api/files/content', 'GET', 'Conteúdo do arquivo'],
                ['/api/files/save', 'POST', 'Salvar arquivo'],
                ['/api/admin/users', 'GET', 'Lista usuários'],
                ['/api/admin/users/create', 'POST', 'Criar usuário'],
                ['/api/admin/wallet/stats', 'GET', 'Estatísticas carteira'],
                ['/api/admin/wallet/adjust', 'POST', 'Ajustar saldo']
            );

            console.log(table.toString());
        });

    } catch (err) {
        log.error('ERRO CRÍTICO:');
        console.error(chalk.red(err.stack));
        process.exit(1);
    }
}

process.on('SIGTERM', () => {
    log.warn('Recebido SIGTERM, encerrando servidor...');
    server.close(() => {
        saveDB().then(() => {
            log.success('Dados salvos. Servidor encerrado.');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    log.warn('Recebido SIGINT, encerrando servidor...');
    server.close(() => {
        saveDB().then(() => {
            log.success('Dados salvos. Servidor encerrado.');
            process.exit(0);
        });
    });
});

process.on('uncaughtException', (err) => {
    log.error('Exceção não capturada:');
    console.error(chalk.red(err.stack));
    saveDB().then(() => process.exit(1));
});

module.exports = { app, server, io, DB };

startServer();
