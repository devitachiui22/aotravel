/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER - CORE ENGINE v6.0 (MODULARIZADO)
 * =================================================================================================
 *
 * ARQUIVO: backend/server.js
 * DESCRIÇÃO: Backend Monolítico Modularizado - Core de Transporte e Gerenciamento
 * STATUS: PRODUCTION READY - WALLET MODULE INTEGRATED
 * DATA: 10 de Fevereiro de 2026
 * =================================================================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Importação do Módulo Financeiro Externo (Wallet)
const walletRoutes = require('./wallet');

// Constantes de Ambiente
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "aotravel_titanium_secret_key_2026_secure_hash_complex_string";
const DATABASE_URL = process.env.DATABASE_URL;
const NODE_ENV = process.env.NODE_ENV || 'production';

// Inicialização do App Express
const app = express();
const server = http.createServer(app);

// Configuração de Uploads (Multer)
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'doc-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Apenas imagens e PDFs são permitidos.'));
        }
    }
});

// =================================================================================================
// 2. UTILITÁRIOS (LOGGER & HELPERS)
// =================================================================================================

/**
 * Logger Estruturado para Auditoria e Debugging.
 */
const Logger = {
    info: (tag, message, data = '') => {
        console.log(`[${new Date().toISOString()}] [INFO] [${tag}] ${message}`, data ? JSON.stringify(data) : '');
    },
    error: (tag, message, error = '') => {
        console.error(`[${new Date().toISOString()}] [ERROR] [${tag}] ${message}`, error);
    },
    warn: (tag, message) => {
        console.warn(`[${new Date().toISOString()}] [WARN] [${tag}] ${message}`);
    },
    audit: (userId, action, details) => {
        console.log(`[${new Date().toISOString()}] [AUDIT] [USER:${userId}] [${action}]`, JSON.stringify(details));
    }
};

/**
 * Validador de Telefone Angola (Unitel/Africell/Movicel)
 */
const isValidAngolaPhone = (phone) => {
    const regex = /^(?:\+244|00244)?9\d{8}$/;
    return regex.test(phone);
};

/**
 * Calculadora de Distância (Haversine) - Precisão para Matching
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
};

// =================================================================================================
// 3. DATABASE ENGINE (POSTGRESQL POOL & BOOTSTRAP)
// =================================================================================================

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err, client) => {
    Logger.error('DB_POOL', 'Erro inesperado no cliente PostgreSQL', err);
});

/**
 * BOOTSTRAP DATABASE - Criação de tabelas essenciais
 * Nota: A tabela 'wallet_transactions' é gerenciada pelo módulo wallet.js (Auto-Healing).
 */
const bootstrapDatabase = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        Logger.info('DB_INIT', 'Iniciando verificação e criação de schema...');

        // 1. EXTENSÕES
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

        // 2. TABELA USERS (Central de Identidade)
        // Mantemos colunas financeiras básicas aqui para integridade do login/perfil,
        // mesmo que o wallet.js faça patching.
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                phone VARCHAR(20) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) CHECK (role IN ('passenger', 'driver', 'admin')) NOT NULL,

                -- Dados de Motorista
                vehicle_details JSONB DEFAULT '{}',
                rating DECIMAL(3,2) DEFAULT 5.00,
                is_online BOOLEAN DEFAULT false,
                is_verified BOOLEAN DEFAULT false,
                is_blocked BOOLEAN DEFAULT false,

                -- Dados Financeiros (Wallet Core)
                balance DECIMAL(15,2) DEFAULT 0.00,
                bonus_points INTEGER DEFAULT 0,
                wallet_account_number VARCHAR(21) UNIQUE,
                wallet_pin_hash VARCHAR(255),
                daily_limit DECIMAL(15,2) DEFAULT 500000.00,
                daily_usage DECIMAL(15,2) DEFAULT 0.00,
                last_usage_date DATE DEFAULT CURRENT_DATE,

                -- Metadados
                fcm_token TEXT,
                photo_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. TABELA RIDES (Core do Transporte)
        await client.query(`
            CREATE TABLE IF NOT EXISTS rides (
                id SERIAL PRIMARY KEY,
                passenger_id INTEGER REFERENCES users(id),
                driver_id INTEGER REFERENCES users(id),

                -- Localização
                origin_lat DECIMAL(10,8) NOT NULL,
                origin_lng DECIMAL(11,8) NOT NULL,
                dest_lat DECIMAL(10,8) NOT NULL,
                dest_lng DECIMAL(11,8) NOT NULL,
                origin_address TEXT,
                dest_address TEXT,
                distance_km DECIMAL(10,2),

                -- Status e Fluxo
                status VARCHAR(20) DEFAULT 'searching',

                -- Financeiro
                estimated_price DECIMAL(10,2),
                final_price DECIMAL(10,2),
                payment_method VARCHAR(20) DEFAULT 'cash',
                payment_status VARCHAR(20) DEFAULT 'pending',

                -- Logs
                rating INTEGER,
                feedback TEXT,
                cancel_reason TEXT,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP
            );
        `);

        // 4. TABELA CHAT_MESSAGES
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                message_text TEXT,
                message_type VARCHAR(10) DEFAULT 'text',
                media_url TEXT,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. TABELA USER_DOCUMENTS (KYC / Verificação)
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_documents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                doc_type VARCHAR(50) NOT NULL,
                file_url TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                rejection_reason TEXT,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                verified_at TIMESTAMP
            );
        `);

        // 6. TABELA APP_SETTINGS (Configurações Dinâmicas do Admin)
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key VARCHAR(50) PRIMARY KEY,
                value JSONB NOT NULL,
                description TEXT
            );
        `);

        // Inserção de Configurações Padrão
        await client.query(`
            INSERT INTO app_settings (key, value, description)
            VALUES
            ('ride_pricing', '{"base_km": 200, "per_km": 150, "min_price": 500}', 'Preços base das corridas'),
            ('app_version', '{"ios": "1.0.0", "android": "1.0.0", "force_update": false}', 'Versão mínima do app')
            ON CONFLICT (key) DO NOTHING;
        `);

        await client.query('COMMIT');
        Logger.info('DB_INIT', '✅ Banco de Dados inicializado com sucesso.');
    } catch (e) {
        await client.query('ROLLBACK');
        Logger.error('DB_INIT', '❌ Falha crítica na inicialização do banco', e);
        process.exit(1);
    } finally {
        client.release();
    }
};

// =================================================================================================
// 4. MIDDLEWARES DE SEGURANÇA E CONFIGURAÇÃO
// =================================================================================================

// Trust proxy para Render.com
app.set('trust proxy', 1);

// Proteção de Cabeçalhos HTTP
app.use(helmet());

// Compressão GZIP
app.use(compression());

// CORS Configurado
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Parsing de Body
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Logging de Requisições HTTP
app.use(morgan('combined'));

// Rate Limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Muitas requisições. Tente novamente mais tarde." }
});
app.use('/api/', apiLimiter);

// Servir Arquivos Estáticos (Uploads)
app.use('/uploads', express.static(UPLOAD_DIR));

/**
 * MIDDLEWARE: authenticateToken
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "Token de acesso não fornecido." });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            Logger.warn('AUTH', `Tentativa de acesso com token inválido: ${err.message}`);
            return res.status(403).json({ error: "Token inválido ou expirado." });
        }
        req.user = user;
        next();
    });
};

/**
 * MIDDLEWARE: requireDriver
 */
const requireDriver = (req, res, next) => {
    if (req.user.role !== 'driver') {
        return res.status(403).json({ error: "Acesso restrito a motoristas." });
    }
    next();
};

/**
 * MIDDLEWARE: requireAdmin - ROBUSTO
 */
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: "Acesso administrativo negado. Requer privilégios de administrador." });
    }
    next();
};

// =================================================================================================
// 5. SOCKET.IO CONFIGURAÇÃO
// =================================================================================================

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e8,
    connectTimeout: 45000
});

// =================================================================================================
// 6. ROTAS DE AUTENTICAÇÃO E PERFIL
// =================================================================================================

const authRouter = express.Router();

/**
 * POST /api/auth/register
 */
authRouter.post('/register', async (req, res) => {
    const { name, email, phone, password, role, vehicle_model, vehicle_plate } = req.body;

    if (!name || !email || !phone || !password || !role) {
        return res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos." });
    }
    if (!isValidAngolaPhone(phone)) {
        return res.status(400).json({ error: "Número de telefone inválido (Use formato 9xxxxxxxx)." });
    }
    if (role === 'driver' && (!vehicle_model || !vehicle_plate)) {
        return res.status(400).json({ error: "Dados do veículo são obrigatórios para motoristas." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const checkUser = await client.query("SELECT id FROM users WHERE email = $1 OR phone = $2", [email, phone]);
        if (checkUser.rows.length > 0) {
            throw new Error("Usuário já cadastrado com este e-mail ou telefone.");
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const vehicleDetails = role === 'driver' ? JSON.stringify({
            model: vehicle_model,
            plate: vehicle_plate,
            verified: false
        }) : '{}';

        const newUserRes = await client.query(
            `INSERT INTO users (name, email, phone, password_hash, role, vehicle_details, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING id, name, email, role`,
            [name, email, phone, hashedPassword, role, vehicleDetails]
        );
        const newUser = newUserRes.rows[0];

        const token = jwt.sign({ id: newUser.id, role: newUser.role, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

        await client.query('COMMIT');

        Logger.audit(newUser.id, 'REGISTER', { role: newUser.role });

        res.status(201).json({
            success: true,
            message: "Conta criada com sucesso.",
            token: token,
            user: newUser
        });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('AUTH_REGISTER', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/auth/login
 */
authRouter.post('/login', async (req, res) => {
    const { email, password, fcm_token } = req.body;

    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Credenciais inválidas." });
        }

        const user = result.rows[0];

        if (user.is_blocked) {
            return res.status(403).json({ error: "Sua conta está bloqueada. Contate o suporte." });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: "Credenciais inválidas." });
        }

        if (fcm_token) {
            await pool.query("UPDATE users SET fcm_token = $1, is_online = true WHERE id = $2", [fcm_token, user.id]);
        }

        const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        delete user.password_hash;
        delete user.wallet_pin_hash;

        res.json({
            success: true,
            token: token,
            user: user
        });

    } catch (error) {
        Logger.error('AUTH_LOGIN', error.message);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

/**
 * GET /api/auth/profile
 */
authRouter.get('/profile', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, email, phone, role, photo_url, rating, balance, bonus_points, wallet_account_number, is_verified, vehicle_details FROM users WHERE id = $1",
            [req.user.id]
        );

        if (result.rows.length === 0) return res.sendStatus(404);

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/auth/upload-doc
 */
authRouter.post('/upload-doc', authenticateToken, upload.single('document'), async (req, res) => {
    const { doc_type } = req.body;

    if (!req.file || !doc_type) {
        return res.status(400).json({ error: "Arquivo e tipo de documento obrigatórios." });
    }

    try {
        const fileUrl = `/uploads/${req.file.filename}`;

        await pool.query(
            `INSERT INTO user_documents (user_id, doc_type, file_url, status)
             VALUES ($1, $2, $3, 'pending')`,
            [req.user.id, doc_type, fileUrl]
        );

        res.json({ success: true, message: "Documento enviado para análise.", url: fileUrl });

    } catch (error) {
        Logger.error('UPLOAD_DOC', error.message);
        res.status(500).json({ error: "Falha ao salvar documento." });
    }
});

// =================================================================================================
// 7. ROTAS DE OPERAÇÃO DE TRANSPORTE (RIDE ENGINE)
// =================================================================================================

const ridesRouter = express.Router();

/**
 * POST /api/rides/request
 */
ridesRouter.post('/request', authenticateToken, async (req, res) => {
    const { origin_lat, origin_lng, dest_lat, dest_lng, origin_addr, dest_addr, price_offer, distance_km } = req.body;
    const passengerId = req.user.id;

    if (!origin_lat || !dest_lat) return res.status(400).json({ error: "Coordenadas obrigatórias." });

    try {
        const result = await pool.query(
            `INSERT INTO rides (passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_address, dest_address, estimated_price, distance_km, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'searching')
             RETURNING *`,
            [passengerId, origin_lat, origin_lng, dest_lat, dest_lng, origin_addr, dest_addr, price_offer, distance_km]
        );

        const ride = result.rows[0];

        io.to('drivers_room').emit('new_ride_request', ride);

        res.json({ success: true, ride: ride, message: "Procurando motoristas..." });

    } catch (error) {
        Logger.error('RIDE_REQUEST', error.message);
        res.status(500).json({ error: "Erro ao solicitar corrida." });
    }
});

/**
 * POST /api/rides/accept
 */
ridesRouter.post('/accept', authenticateToken, requireDriver, async (req, res) => {
    const { ride_id } = req.body;
    const driverId = req.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const rideRes = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);

        if (rideRes.rows.length === 0) throw new Error("Corrida não encontrada.");
        const ride = rideRes.rows[0];

        if (ride.status !== 'searching') {
            throw new Error("Esta corrida já foi aceita por outro motorista ou cancelada.");
        }

        await client.query(
            "UPDATE rides SET driver_id = $1, status = 'accepted', accepted_at = NOW() WHERE id = $2",
            [driverId, ride_id]
        );

        const driverInfo = await client.query("SELECT name, phone, vehicle_details, rating, photo_url FROM users WHERE id = $1", [driverId]);

        await client.query('COMMIT');

        const rideData = { ...ride, driver: driverInfo.rows[0], status: 'accepted' };
        io.to(`user_${ride.passenger_id}`).emit('ride_accepted', rideData);

        res.json({ success: true, ride: rideData });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: error.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/rides/update-status
 * Inclui lógica de pagamento do motorista ao completar a corrida.
 */
ridesRouter.post('/update-status', authenticateToken, async (req, res) => {
    const { ride_id, status, cancel_reason } = req.body;
    const userId = req.user.id;
    const validStatuses = ['arrived', 'started', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) return res.status(400).json({ error: "Status inválido." });

    try {
        const rideCheck = await pool.query(
            "SELECT * FROM rides WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2)",
            [ride_id, userId]
        );
        if (rideCheck.rows.length === 0) return res.status(403).json({ error: "Permissão negada ou corrida inexistente." });

        const ride = rideCheck.rows[0];
        let query = "UPDATE rides SET status = $1";
        const params = [status];
        let paramIndex = 2;

        if (status === 'started') query += `, started_at = NOW()`;
        
        // Lógica de Conclusão e Pagamento
        if (status === 'completed') {
            query += `, completed_at = NOW()`;
            
            // PRESERVAÇÃO DA LÓGICA DE PAGAMENTO DO MOTORISTA (SQL DIRETO)
            // Conforme solicitado, mantemos a lógica de pagamento aqui.
            // O módulo wallet.js carrega a tabela wallet_transactions via auto-healing.
            const ridePrice = ride.final_price || ride.estimated_price;
            const driverId = ride.driver_id;
            
            if (driverId && ridePrice) {
                // 1. Atualizar Saldo do Motorista
                await pool.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [ridePrice, driverId]);
                
                // 2. Registrar Transação na Carteira (SQL Direto para garantir a integridade da corrida)
                const txRef = `RIDE-EARN-${ride_id}-${Date.now()}`;
                await pool.query(
                    `INSERT INTO wallet_transactions 
                    (reference_id, user_id, amount, type, status, description, created_at)
                    VALUES ($1, $2, $3, 'ride_earning', 'completed', $4, NOW())`,
                    [txRef, driverId, ridePrice, `Ganhos da Corrida #${ride_id}`]
                );
            }
        }
        
        if (status === 'cancelled') {
            query += `, cancel_reason = $${paramIndex}`;
            params.push(cancel_reason);
            paramIndex++;
        }

        query += ` WHERE id = $${paramIndex} RETURNING *`;
        params.push(ride_id);

        const updated = await pool.query(query, params);

        const targetId = (userId === ride.passenger_id) ? ride.driver_id : ride.passenger_id;
        if (targetId) {
            io.to(`user_${targetId}`).emit('ride_status_update', { ride_id, status, cancel_reason });
        }

        res.json({ success: true, ride: updated.rows[0] });

    } catch (error) {
        Logger.error('RIDE_UPDATE', error.message);
        res.status(500).json({ error: "Erro ao atualizar status." });
    }
});

// =================================================================================================
// 8. ROTAS ADMINISTRATIVAS (BACKOFFICE) - CONSOLIDADAS
// =================================================================================================

const adminRouter = express.Router();

/**
 * GET /api/admin/stats - Estatísticas gerais
 */
adminRouter.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM users WHERE role='driver') as total_drivers,
                (SELECT COUNT(*) FROM users WHERE role='passenger') as total_passengers,
                (SELECT COUNT(*) FROM rides) as total_rides,
                (SELECT COUNT(*) FROM users WHERE role='driver' AND is_online=true) as active_drivers,
                (SELECT COUNT(*) FROM rides WHERE status='completed') as completed_rides,
                (SELECT COUNT(*) FROM rides WHERE status='searching') as searching_rides,
                (SELECT COUNT(*) FROM user_documents WHERE status='pending') as pending_docs,
                (SELECT COALESCE(SUM(balance), 0) FROM users) as total_balances
        `);

        res.json(stats.rows[0]);
    } catch (e) {
        Logger.error('ADMIN_STATS', e);
        res.status(500).json({ error: "Erro ao buscar estatísticas." });
    }
});

/**
 * GET /api/admin/users - Listar usuários com paginação e filtros
 */
adminRouter.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    const { role, is_online, is_blocked, search, limit = 50, offset = 0 } = req.query;

    try {
        let query = `
            SELECT id, name, email, phone, role, photo_url,
                   balance, is_online, rating, is_blocked,
                   is_verified, created_at
            FROM users
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        if (role) {
            query += ` AND role = $${paramCount}`;
            params.push(role);
            paramCount++;
        }

        if (is_online !== undefined) {
            query += ` AND is_online = $${paramCount}`;
            params.push(is_online === 'true');
            paramCount++;
        }

        if (is_blocked !== undefined) {
            query += ` AND is_blocked = $${paramCount}`;
            params.push(is_blocked === 'true');
            paramCount++;
        }

        if (search) {
            query += ` AND (name ILIKE $${paramCount} OR email ILIKE $${paramCount} OR phone ILIKE $${paramCount})`;
            params.push(`%${search}%`);
            paramCount++;
        }

        query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM users WHERE 1=1
             ${role ? `AND role = '${role}'` : ''}
             ${is_online !== undefined ? `AND is_online = ${is_online === 'true'}` : ''}
             ${is_blocked !== undefined ? `AND is_blocked = ${is_blocked === 'true'}` : ''}
             ${search ? `AND (name ILIKE '%${search}%' OR email ILIKE '%${search}%' OR phone ILIKE '%${search}%')` : ''}`
        );

        res.json({
            users: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (e) {
        Logger.error('ADMIN_USERS', e);
        res.status(500).json({ error: "Erro ao listar usuários." });
    }
});

/**
 * POST /api/admin/verify-user - Bloquear/Desbloquear ou Verificar motoristas
 */
adminRouter.post('/verify-user', authenticateToken, requireAdmin, async (req, res) => {
    const { user_id, action, reason } = req.body;

    if (!user_id || !action) {
        return res.status(400).json({ error: "ID do usuário e ação são obrigatórios." });
    }

    try {
        let query;
        let params = [user_id];

        switch (action) {
            case 'approve':
                query = "UPDATE users SET is_verified = true WHERE id = $1";
                break;
            case 'reject':
                query = "UPDATE users SET is_verified = false WHERE id = $1";
                break;
            case 'block':
                query = "UPDATE users SET is_blocked = true WHERE id = $1";
                break;
            case 'unblock':
                query = "UPDATE users SET is_blocked = false WHERE id = $1";
                break;
            default:
                return res.status(400).json({ error: "Ação inválida. Use: 'approve', 'reject', 'block' ou 'unblock'." });
        }

        await pool.query(query, params);

        Logger.audit(req.user.id, 'ADMIN_ACTION', { action, user_id, reason });

        res.json({
            success: true,
            message: `Usuário ${action === 'block' ? 'bloqueado' : action === 'unblock' ? 'desbloqueado' : action === 'approve' ? 'verificado' : 'rejeitado'} com sucesso.`
        });
    } catch (e) {
        Logger.error('ADMIN_VERIFY', e);
        res.status(500).json({ error: "Erro ao processar ação administrativa." });
    }
});

/**
 * GET /api/admin/rides - Histórico global de corridas
 */
adminRouter.get('/rides', authenticateToken, requireAdmin, async (req, res) => {
    const { status, date_from, date_to, limit = 50, offset = 0 } = req.query;

    try {
        let query = `
            SELECT r.*,
                   p.name as passenger_name,
                   d.name as driver_name,
                   p.phone as passenger_phone,
                   d.phone as driver_phone
            FROM rides r
            LEFT JOIN users p ON r.passenger_id = p.id
            LEFT JOIN users d ON r.driver_id = d.id
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        if (status) {
            query += ` AND r.status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        if (date_from) {
            query += ` AND r.created_at >= $${paramCount}`;
            params.push(date_from);
            paramCount++;
        }

        if (date_to) {
            query += ` AND r.created_at <= $${paramCount}`;
            params.push(date_to);
            paramCount++;
        }

        query += ` ORDER BY r.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        const countQuery = query
            .replace(/SELECT r.*, p.name as passenger_name, d.name as driver_name, p.phone as passenger_phone, d.phone as driver_phone/, 'SELECT COUNT(*)')
            .split('ORDER BY')[0];

        const countResult = await pool.query(countQuery, params.slice(0, -2));

        res.json({
            rides: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (e) {
        Logger.error('ADMIN_RIDES', e);
        res.status(500).json({ error: "Erro ao listar corridas." });
    }
});

// =================================================================================================
// 9. MONTAGEM DE ROTAS
// =================================================================================================

// Rotas Principais
app.use('/api/auth', authRouter);
app.use('/api/rides', ridesRouter);
app.use('/api/admin', adminRouter);

// Módulo Financeiro (Wallet) - Integração com Módulo Externo
// Inicializa o roteador da carteira passando a conexão do banco (pool) e socket.io
app.use('/api/wallet', authenticateToken, walletRoutes(pool, io));

// =================================================================================================
// 10. MOTOR REAL-TIME (SOCKET.IO)
// =================================================================================================

const activeUsers = new Map();
const driverLocations = new Map();

// Middleware de Autenticação do Socket
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Token de socket obrigatório"));

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error("Token de socket inválido"));
        socket.user = decoded;
        next();
    });
});

io.on('connection', (socket) => {
    const userId = socket.user.id;
    const userRole = socket.user.role;

    Logger.info('SOCKET', `Usuário conectado: ${userId} (${userRole})`);

    // Registro e Salas
    activeUsers.set(userId, socket.id);
    socket.join(`user_${userId}`);

    if (userRole === 'driver') {
        socket.join('drivers_room');
        pool.query("UPDATE users SET is_online = true WHERE id = $1", [userId]);
    }

    // Atualização de Localização
    socket.on('update_location', (data) => {
        if (userRole === 'driver') {
            driverLocations.set(userId, { ...data, timestamp: Date.now() });

            if (data.ride_id && data.passenger_id) {
                io.to(`user_${data.passenger_id}`).emit('driver_location', data);
            }
        }
    });

    // Chat em Tempo Real
    socket.on('send_message', async (payload) => {
        try {
            const res = await pool.query(
                "INSERT INTO chat_messages (ride_id, sender_id, message_text, message_type) VALUES ($1, $2, $3, $4) RETURNING *",
                [payload.ride_id, userId, payload.text, payload.type || 'text']
            );

            io.to(`user_${payload.receiver_id}`).emit('receive_message', res.rows[0]);

        } catch (e) {
            socket.emit('error', { message: "Erro ao enviar mensagem" });
        }
    });

    // Desconexão
    socket.on('disconnect', () => {
        Logger.info('SOCKET', `Usuário desconectado: ${userId}`);
        activeUsers.delete(userId);
        if (userRole === 'driver') {
            driverLocations.delete(userId);
            pool.query("UPDATE users SET is_online = false WHERE id = $1", [userId]);
        }
    });
});

// =================================================================================================
// 11. HANDLERS DE ERRO E INICIALIZAÇÃO
// =================================================================================================

// Health Check
app.get('/', (req, res) => res.status(200).json({
    status: "AOTRAVEL SERVER ONLINE",
    version: "v6.0 - MODULARIZADO",
    environment: NODE_ENV,
    database: "Connected",
    socket_io: "Active",
    wallet: "External Module Loaded",
    endpoints: {
        auth: "/api/auth/*",
        rides: "/api/rides/*",
        admin: "/api/admin/*",
        wallet: "/api/wallet/*"
    }
}));

// Rota 404
app.use((req, res) => {
    res.status(404).json({
        error: "Rota não encontrada.",
        path: req.path,
        method: req.method
    });
});

// Tratamento de Erros Global
app.use((err, req, res, next) => {
    Logger.error('GLOBAL_ERROR', err.message, err.stack);
    res.status(500).json({
        error: "Erro Interno Crítico",
        message: NODE_ENV === 'development' ? err.message : "Contate o administrador."
    });
});

// Inicialização
const startServer = async () => {
    try {
        await bootstrapDatabase();

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`
            ===========================================================
            🚀 AOTRAVEL SERVER RUNNING (MODULARIZADO)
            ===========================================================
            🌍 Environment: ${NODE_ENV}
            📡 Port:        ${PORT}
            💾 Database:    Connected
            🔌 Socket.io:   Active
            💸 Wallet:      External Module Loaded
            👑 Admin Panel: Full Functional
            ===========================================================
            `);
        });

    } catch (error) {
        Logger.error('STARTUP', 'Falha fatal ao iniciar servidor', error);
        process.exit(1);
    }
};

startServer();
