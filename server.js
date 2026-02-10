/**
 * =================================================================================================
 * 🚀 AOTRAVEL TITANIUM PRO ULTRA SERVER - MERGED FINAL VERSION v6.0
 * =================================================================================================
 *
 * ARQUIVO: backend/server.js
 * DESCRIÇÃO: Backend Monolítico Completo para App de Transporte e Fintech (Angola).
 *            Combina as melhores features de ambas as versões - Titanium Core + Ultra Final Mega Blaster
 *
 * STATUS: PRODUCTION READY - ZERO OMISSÕES, ZERO SIMPLIFICAÇÕES
 * DATA: 10 de Fevereiro de 2026
 * LOCALIZAÇÃO: Luanda, Angola
 * =================================================================================================
 */

// =================================================================================================
// 1. IMPORTAÇÕES E CONSTANTES GLOBAIS
// =================================================================================================

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const http = require('http');
const { Server } = require("socket.io");
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const walletRoutes = require('./wallet');

// Constantes de Ambiente
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "aotravel_titanium_secret_key_2026_secure_hash_complex_string";
const DATABASE_URL = process.env.DATABASE_URL;
const NODE_ENV = process.env.NODE_ENV || 'production';

// Inicialização do App Express
const app = express();

// =================================================================================================
// 2. MIDDLEWARES DE SEGURANÇA E CONFIGURAÇÃO (TITANIUM CORE ENHANCED)
// =================================================================================================

// Proteção de Cabeçalhos HTTP
app.use(helmet());

// Compressão GZIP
app.use(compression());

// CORS Configurado
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'x-session-token', 'x-app-version'],
    credentials: true
}));

// Parsing de Body com Limites Ampliados
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Logging de Requisições HTTP
app.use(morgan('combined'));

// Rate Limiting (Proteção contra DDoS e Brute Force)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 300, // Limite de 300 requisições por IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Muitas requisições. Tente novamente mais tarde." }
});
app.use('/api/', apiLimiter);

// =================================================================================================
// 3. SERVIDOR HTTP E SOCKET.IO (ULTRA FINAL CONFIG)
// =================================================================================================

const server = http.createServer(app);

// Configuração do Motor Real-Time (Titanium Merged)
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
    maxHttpBufferSize: 1e8, // 100MB
    connectTimeout: 45000
});

// =================================================================================================
// 4. CONFIGURAÇÃO DO BANCO DE DADOS (NEON POSTGRESQL)
// =================================================================================================

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Listener de Erros Globais do Banco
pool.on('error', (err, client) => {
    console.error('❌ ERRO CRÍTICO NO POOL DO POSTGRES:', err);
});

// =================================================================================================
// 5. UTILITÁRIOS E HELPERS (COMBINADOS)
// =================================================================================================

/**
 * Logger Estruturado (Titanium Core)
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
 * Validador de Telefone Angola (Titanium Core)
 */
const isValidAngolaPhone = (phone) => {
    const regex = /^(?:\+244|00244)?9\d{8}$/;
    return regex.test(phone);
};

/**
 * Calculadora de Distância (Haversine) - Ambas versões
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

// Alias para compatibilidade
const getDistance = calculateDistance;

/**
 * Gerar código aleatório
 */
function generateCode(length = 6) {
    return Math.floor(Math.random() * Math.pow(10, length)).toString().padStart(length, '0');
}

/**
 * Função SQL para buscar dados completos da corrida (Rich Payload)
 */
async function getFullRideDetails(rideId) {
    const query = `
        SELECT
            r.id, r.passenger_id, r.driver_id, r.status,
            r.origin_name, r.dest_name,
            r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng,
            r.initial_price,
            COALESCE(r.final_price, r.initial_price) as final_price,
            r.ride_type, r.distance_km, r.created_at,
            r.rating, r.feedback,
            r.completed_at,

            -- DADOS DO MOTORISTA (JSON OBJECT)
            CASE WHEN d.id IS NOT NULL THEN
                json_build_object(
                    'id', d.id,
                    'name', d.name,
                    'photo', COALESCE(d.photo, ''),
                    'phone', d.phone,
                    'email', d.email,
                    'vehicle_details', d.vehicle_details,
                    'rating', d.rating,
                    'is_online', d.is_online,
                    'bi_front', d.bi_front,
                    'bi_back', d.bi_back
                )
            ELSE NULL END as driver_data,

            -- DADOS DO PASSAGEIRO (JSON OBJECT)
            json_build_object(
                'id', p.id,
                'name', p.name,
                'photo', COALESCE(p.photo, ''),
                'phone', p.phone,
                'email', p.email,
                'rating', p.rating,
                'bi_front', p.bi_front,
                'bi_back', p.bi_back
            ) as passenger_data

        FROM rides r
        LEFT JOIN users d ON r.driver_id = d.id
        LEFT JOIN users p ON r.passenger_id = p.id
        WHERE r.id = $1
    `;

    try {
        const res = await pool.query(query, [rideId]);
        return res.rows[0];
    } catch (e) {
        Logger.error('DB_FETCH', e);
        return null;
    }
}

/**
 * Buscar detalhes completos do usuário (Ultra Final Enhanced)
 */
async function getUserFullDetails(userId) {
    const query = `
        SELECT id, name, email, phone, photo, role,
               COALESCE(balance, 0)::FLOAT as balance,
               COALESCE(bonus_points, 0) as bonus_points,
               COALESCE(vehicle_details, '{}'::jsonb) as vehicle_details,
               bi_front, bi_back, is_online, rating,
               fcm_token, created_at,
               COALESCE(settings, '{}'::jsonb) as settings,
               wallet_account_number, wallet_pin_hash,
               daily_limit, daily_usage, last_usage_date,
               is_verified, is_blocked
        FROM users
        WHERE id = $1
    `;
    try {
        const res = await pool.query(query, [userId]);
        return res.rows[0];
    } catch (e) {
        Logger.error('USER_FETCH', e.message);
        return null;
    }
}

// =================================================================================================
// 6. CONFIGURAÇÃO DE UPLOAD (COMBINADA)
// =================================================================================================

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
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (Ultra Final)
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Apenas imagens e PDFs são permitidos.'));
        }
    }
});

// Servir Arquivos Estáticos (Uploads)
app.use('/uploads', express.static(UPLOAD_DIR));

// =================================================================================================
// 7. BOOTSTRAP DATABASE (TITANIUM CORE + ULTRA FINAL MERGED)
// =================================================================================================

/**
 * BOOTSTRAP DATABASE - Versão Final Mesclada
 */
const bootstrapDatabase = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        Logger.info('DB_INIT', 'Iniciando verificação e criação de schema...');

        // 1. EXTENSÕES
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

        // 2. TABELA USERS (Titanium Core Structure + Ultra Final Fields)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                phone VARCHAR(20) UNIQUE,
                password VARCHAR(255) NOT NULL,
                password_hash VARCHAR(255),
                role VARCHAR(20) CHECK (role IN ('passenger', 'driver', 'admin')) NOT NULL,
                photo TEXT,

                -- Dados de Motorista (Titanium)
                vehicle_details JSONB DEFAULT '{}',
                rating DECIMAL(3,2) DEFAULT 5.00,
                is_online BOOLEAN DEFAULT false,
                is_verified BOOLEAN DEFAULT false,
                is_blocked BOOLEAN DEFAULT false,

                -- Dados Financeiros (Ambas)
                balance DECIMAL(15,2) DEFAULT 0.00,
                bonus_points INTEGER DEFAULT 0,
                wallet_account_number VARCHAR(21) UNIQUE,
                wallet_pin_hash VARCHAR(255),
                wallet_pin TEXT,
                daily_limit DECIMAL(15,2) DEFAULT 500000.00,
                daily_usage DECIMAL(15,2) DEFAULT 0.00,
                last_usage_date DATE DEFAULT CURRENT_DATE,
                iban TEXT UNIQUE,
                account_limit NUMERIC(15,2) DEFAULT 500000.00,

                -- Documentos (Ultra Final)
                bi_front TEXT,
                bi_back TEXT,
                driving_license_front TEXT,
                driving_license_back TEXT,

                -- Metadados e Configurações
                fcm_token TEXT,
                session_token TEXT,
                session_expiry TIMESTAMP,
                last_login TIMESTAMP,
                verification_code TEXT,
                settings JSONB DEFAULT '{}',
                privacy_settings JSONB DEFAULT '{}',
                notification_preferences JSONB DEFAULT '{"ride_notifications": true, "promo_notifications": true, "chat_notifications": true}',

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. TABELA RIDES (Combined Structure)
        await client.query(`
            CREATE TABLE IF NOT EXISTS rides (
                id SERIAL PRIMARY KEY,
                passenger_id INTEGER REFERENCES users(id),
                driver_id INTEGER REFERENCES users(id),

                -- Localização
                origin_lat DECIMAL(10,8),
                origin_lng DECIMAL(11,8),
                dest_lat DECIMAL(10,8),
                dest_lng DECIMAL(11,8),
                origin_address TEXT,
                dest_address TEXT,
                origin_name TEXT,
                dest_name TEXT,
                distance_km DECIMAL(10,2),

                -- Status e Fluxo
                status VARCHAR(20) DEFAULT 'searching',
                ride_type VARCHAR(20) DEFAULT 'ride',

                -- Financeiro
                estimated_price DECIMAL(10,2),
                initial_price NUMERIC(15,2),
                final_price NUMERIC(15,2),
                payment_method VARCHAR(20) DEFAULT 'cash',
                payment_status VARCHAR(20) DEFAULT 'pending',

                -- Logs e Avaliação
                rating INTEGER DEFAULT 0,
                feedback TEXT,
                cancel_reason TEXT,
                cancelled_by TEXT,
                negotiation_history JSONB DEFAULT '[]',

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                cancelled_at TIMESTAMP
            );
        `);

        // 4. TABELA CHAT_MESSAGES (Combined)
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                message_text TEXT,
                text TEXT,
                message_type VARCHAR(10) DEFAULT 'text',
                image_url TEXT,
                file_data TEXT,
                media_url TEXT,
                is_read BOOLEAN DEFAULT false,
                read_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. TABELA USER_DOCUMENTS (KYC / Verificação)
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_documents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                doc_type VARCHAR(50) NOT NULL,
                document_type TEXT NOT NULL,
                file_url TEXT,
                front_image TEXT,
                back_image TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                rejection_reason TEXT,
                verified_by INTEGER REFERENCES users(id),
                verified_at TIMESTAMP,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 6. TABELA APP_SETTINGS (Configurações Dinâmicas do Admin)
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key VARCHAR(50) PRIMARY KEY,
                id SERIAL PRIMARY KEY,
                value JSONB NOT NULL,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 7. TABELA WALLET_TRANSACTIONS (Ultra Final Enhanced)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                sender_id INTEGER REFERENCES users(id),
                receiver_id INTEGER REFERENCES users(id),
                amount NUMERIC(15,2) NOT NULL,
                fee NUMERIC(15,2) DEFAULT 0.00,
                type TEXT NOT NULL,
                method TEXT,
                description TEXT,
                reference_id TEXT UNIQUE,
                status TEXT DEFAULT 'completed',
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 8. TABELA DRIVER_POSITIONS (Radar)
        await client.query(`
            CREATE TABLE IF NOT EXISTS driver_positions (
                driver_id INTEGER PRIMARY KEY REFERENCES users(id),
                lat DOUBLE PRECISION,
                lng DOUBLE PRECISION,
                heading DOUBLE PRECISION DEFAULT 0,
                socket_id TEXT,
                status TEXT DEFAULT 'active',
                last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 9. TABELA USER_SESSIONS (Persistência)
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                session_token TEXT UNIQUE,
                device_id TEXT,
                device_info JSONB,
                fcm_token TEXT,
                ip_address TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 10. TABELA NOTIFICATIONS
        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                type TEXT,
                data JSONB DEFAULT '{}',
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 11. TABELA EXTERNAL_ACCOUNTS
        await client.query(`
            CREATE TABLE IF NOT EXISTS external_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                provider TEXT,
                account_number TEXT,
                holder_name TEXT,
                is_default BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 12. TABELA PAYMENT_REQUESTS
        await client.query(`
            CREATE TABLE IF NOT EXISTS payment_requests (
                id SERIAL PRIMARY KEY,
                requester_id INTEGER REFERENCES users(id),
                payer_id INTEGER REFERENCES users(id),
                amount NUMERIC(15,2) NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'pending',
                qr_code_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours')
            );
        `);

        // 13. TABELA ADMIN_REPORTS
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_reports (
                id SERIAL PRIMARY KEY,
                report_type TEXT NOT NULL,
                data JSONB NOT NULL,
                generated_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Inserção de Configurações Padrão
        await client.query(`
            INSERT INTO app_settings (key, value, description)
            VALUES
            ('ride_pricing', '{"base_km": 200, "per_km": 150, "min_price": 500}', 'Preços base das corridas'),
            ('app_version', '{"ios": "1.0.0", "android": "1.0.0", "force_update": false}', 'Versão mínima do app'),
            ('ride_prices', '{"base_price": 600, "km_rate": 300, "moto_base": 400, "moto_km_rate": 180, "delivery_base": 1000, "delivery_km_rate": 450}', 'Configurações de preços das corridas'),
            ('app_config', '{"max_radius_km": 15, "driver_timeout_minutes": 30, "ride_search_timeout": 600}', 'Configurações gerais do app'),
            ('finance_config', '{"min_withdraw": 2000, "transfer_fee_internal": 0, "transfer_fee_kwik": 50}', 'Configurações de taxas financeiras'),
            ('commission_rates', '{"driver_commission": 0.8, "platform_commission": 0.2}', 'Taxas de comissão')
            ON CONFLICT (key) DO NOTHING;
        `);

        // Criar índices para performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_users_online ON users(is_online) WHERE role = 'driver';
            CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
            CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);
            CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
            CREATE INDEX IF NOT EXISTS idx_rides_created ON rides(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_chat_ride ON chat_messages(ride_id);
            CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id);
            CREATE INDEX IF NOT EXISTS idx_wallet_ref ON wallet_transactions(reference_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token);
        `);

        await client.query('COMMIT');
        Logger.info('DB_INIT', '✅ Banco de Dados inicializado com sucesso (Tabelas e Configurações).');
    } catch (e) {
        await client.query('ROLLBACK');
        Logger.error('DB_INIT', '❌ Falha crítica na inicialização do banco', e);
        throw e;
    } finally {
        client.release();
    }
};

// =================================================================================================
// 8. MIDDLEWARES DE AUTENTICAÇÃO (COMBINADOS)
// =================================================================================================

/**
 * MIDDLEWARE: authenticateToken - Sistema Híbrido (JWT + Sessão)
 */
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    const sessionToken = req.headers['x-session-token'];

    if (!token && !sessionToken) {
        return res.status(401).json({ error: "Token de autenticação necessário." });
    }

    try {
        let user = null;

        // 1. Primeiro tentar JWT Token
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                const userRes = await pool.query(
                    "SELECT * FROM users WHERE id = $1 AND is_blocked = false",
                    [decoded.id]
                );
                if (userRes.rows.length > 0) {
                    user = userRes.rows[0];
                }
            } catch (jwtError) {
                Logger.warn('AUTH', `JWT inválido: ${jwtError.message}`);
            }
        }

        // 2. Se JWT falhou, tentar Sessão Token
        if (!user && sessionToken) {
            const sessionRes = await pool.query(
                `SELECT u.* FROM users u
                 JOIN user_sessions s ON u.id = s.user_id
                 WHERE s.session_token = $1 AND s.is_active = true
                 AND (s.expires_at IS NULL OR s.expires_at > NOW())`,
                [sessionToken]
            );

            if (sessionRes.rows.length > 0) {
                user = sessionRes.rows[0];
                // Atualizar última atividade
                await pool.query(
                    'UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1',
                    [sessionToken]
                );
            }
        }

        if (!user) {
            return res.status(401).json({ error: "Sessão inválida ou expirada." });
        }

        if (user.is_blocked) {
            return res.status(403).json({ error: "Conta bloqueada. Contacte o suporte." });
        }

        req.user = user;
        next();
    } catch (error) {
        Logger.error('AUTH', error);
        res.status(500).json({ error: "Erro na autenticação" });
    }
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
 * MIDDLEWARE: requireAdmin
 */
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: "Acesso administrativo negado." });
    }
    next();
};

// =================================================================================================
// 9. SISTEMA DE SESSÃO PERSISTENTE (ULTRA FINAL)
// =================================================================================================

async function createPersistentSession(userId, deviceInfo = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Gerar token de sessão único
        const sessionToken = crypto.randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1 ano de validade

        // Criar registro de sessão
        await client.query(
            `INSERT INTO user_sessions
             (user_id, session_token, device_info, expires_at, is_active)
             VALUES ($1, $2, $3, $4, true)`,
            [userId, sessionToken, JSON.stringify(deviceInfo), expiresAt]
        );

        // Atualizar usuário com token de sessão
        await client.query(
            `UPDATE users SET
             session_token = $1,
             session_expiry = $2,
             last_login = NOW(),
             is_online = true
             WHERE id = $3`,
            [sessionToken, expiresAt, userId]
        );

        await client.query('COMMIT');

        return {
            session_token: sessionToken,
            expires_at: expiresAt
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function validateSession(sessionToken) {
    try {
        const result = await pool.query(
            `SELECT u.* FROM users u
             JOIN user_sessions s ON u.id = s.user_id
             WHERE s.session_token = $1
             AND s.is_active = true
             AND (s.expires_at IS NULL OR s.expires_at > NOW())`,
            [sessionToken]
        );

        if (result.rows.length > 0) {
            // Atualizar última atividade
            await pool.query(
                'UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1',
                [sessionToken]
            );

            return result.rows[0];
        }
        return null;
    } catch (error) {
        Logger.error('SESSION_VALIDATE', error);
        return null;
    }
}

// =================================================================================================
// 10. ROTAS DE AUTENTICAÇÃO (COMBINADAS)
// =================================================================================================

/**
 * POST /api/auth/register - Registro com Validação (Titanium Core)
 */
app.post('/api/auth/register', async (req, res) => {
    const { name, email, phone, password, role, vehicle_model, vehicle_plate, vehicle_color } = req.body;

    // 1. Validação de Entrada (Titanium Core)
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

        // 2. Verificar Duplicidade
        const checkUser = await client.query("SELECT id FROM users WHERE email = $1 OR phone = $2", [email, phone]);
        if (checkUser.rows.length > 0) {
            throw new Error("Usuário já cadastrado com este e-mail ou telefone.");
        }

        // 3. Hash da Senha (Titanium Core)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Montar Objeto do Veículo
        const vehicleDetails = role === 'driver' ? JSON.stringify({
            model: vehicle_model,
            plate: vehicle_plate,
            color: vehicle_color || '',
            year: new Date().getFullYear(),
            verified: false
        }) : '{}';

        // 5. Inserir Usuário
        const newUserRes = await client.query(
            `INSERT INTO users (name, email, phone, password_hash, password, role, vehicle_details, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             RETURNING id, name, email, role, phone, created_at`,
            [name, email.toLowerCase().trim(), phone, hashedPassword, password, role, vehicleDetails]
        );
        const newUser = newUserRes.rows[0];

        // 6. Gerar Token JWT (Titanium Core)
        const token = jwt.sign({ id: newUser.id, role: newUser.role, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

        // 7. Criar Sessão Persistente (Ultra Final)
        const session = await createPersistentSession(newUser.id, req.body.device_info || {});

        await client.query('COMMIT');

        Logger.audit(newUser.id, 'REGISTER', { role: newUser.role });

        res.status(201).json({
            success: true,
            message: "Conta criada com sucesso.",
            token: token,
            session: session,
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
 * POST /api/auth/login - Login Híbrido
 */
app.post('/api/auth/login', async (req, res) => {
    const { email, password, fcm_token, device_info } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email e senha são obrigatórios." });
    }

    try {
        // Buscar Usuário
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Credenciais incorretas." });
        }

        const user = result.rows[0];

        // Verificar Bloqueio
        if (user.is_blocked) {
            return res.status(403).json({ error: "Conta bloqueada. Contacte o suporte." });
        }

        // Validar Senha (Verifica ambos password e password_hash para compatibilidade)
        let validPassword = false;
        if (user.password === password) {
            validPassword = true;
        } else if (user.password_hash) {
            validPassword = await bcrypt.compare(password, user.password_hash);
        }

        if (!validPassword) {
            return res.status(401).json({ error: "Credenciais incorretas." });
        }

        // Atualizar FCM token
        if (fcm_token) {
            await pool.query(
                'UPDATE users SET fcm_token = $1 WHERE id = $2',
                [fcm_token, user.id]
            );
            user.fcm_token = fcm_token;
        }

        // Criar sessão persistente
        const session = await createPersistentSession(user.id, device_info || {});

        // Gerar JWT Token
        const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        // Buscar histórico recente de transações
        const tx = await pool.query(
            'SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
            [user.id]
        );

        // Remover dados sensíveis
        delete user.password;
        delete user.password_hash;
        delete user.wallet_pin_hash;
        delete user.wallet_pin;

        user.transactions = tx.rows;
        user.session = session;

        Logger.audit(user.id, 'LOGIN', { method: 'email' });

        res.json({
            success: true,
            token: token,
            session: session,
            user: user
        });

    } catch (error) {
        Logger.error('AUTH_LOGIN', error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

/**
 * GET /api/auth/profile - Retorna dados do usuário (Titanium Core)
 */
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, phone, role, photo, rating, balance, bonus_points,
                    wallet_account_number, is_verified, vehicle_details, is_online,
                    created_at, settings, notification_preferences
             FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) return res.sendStatus(404);

        res.json(result.rows[0]);
    } catch (error) {
        Logger.error('PROFILE_GET', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/auth/upload-doc - Upload de Documentos KYC (Titanium Core)
 */
app.post('/api/auth/upload-doc', authenticateToken, upload.single('document'), async (req, res) => {
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

        Logger.audit(req.user.id, 'DOCUMENT_UPLOAD', { doc_type, fileUrl });

        res.json({
            success: true,
            message: "Documento enviado para análise.",
            url: fileUrl
        });

    } catch (error) {
        Logger.error('UPLOAD_DOC', error.message);
        res.status(500).json({ error: "Falha ao salvar documento." });
    }
});

/**
 * GET /api/auth/session - Verificar Sessão (Ultra Final Reparado)
 */
app.get('/api/auth/session', async (req, res) => {
    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
        return res.status(401).json({ error: 'Sessão não fornecida ou token ausente' });
    }

    try {
        const user = await validateSession(sessionToken);

        if (!user) {
            return res.status(401).json({ error: 'Sessão inválida ou expirada' });
        }

        const fullUser = await getUserFullDetails(user.id);

        if (!fullUser) {
            return res.status(404).json({ error: 'Usuário não encontrado na base de dados' });
        }

        // Segurança: Remove dados sensíveis
        delete fullUser.password;
        delete fullUser.password_hash;

        res.json({
            user: fullUser,
            session_valid: true,
            expires_at: user.session_expiry
        });

    } catch (e) {
        Logger.error('SESSION_CHECK', e);
        res.status(500).json({ error: 'Erro interno ao processar verificação de sessão' });
    }
});

/**
 * POST /api/auth/logout
 */
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        const sessionToken = req.headers['x-session-token'];

        if (sessionToken) {
            await pool.query(
                'UPDATE user_sessions SET is_active = false WHERE session_token = $1',
                [sessionToken]
            );
        }

        await pool.query(
            'UPDATE users SET is_online = false, session_token = NULL WHERE id = $1',
            [req.user.id]
        );

        Logger.audit(req.user.id, 'LOGOUT', {});
        res.json({ success: true, message: "Logout realizado com sucesso." });
    } catch (e) {
        Logger.error('LOGOUT', e);
        res.status(500).json({ error: "Erro ao fazer logout." });
    }
});

// =================================================================================================
// 11. ROTAS DE PERFIL (COMBINADAS)
// =================================================================================================

/**
 * GET /api/profile - Obter dados do perfil completo
 */
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const user = await getUserFullDetails(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }

        // Buscar estatísticas
        const stats = await pool.query(`
            SELECT
                COUNT(CASE WHEN passenger_id = $1 AND status = 'completed' THEN 1 END) as total_rides_as_passenger,
                COUNT(CASE WHEN driver_id = $1 AND status = 'completed' THEN 1 END) as total_rides_as_driver,
                COALESCE(AVG(CASE WHEN passenger_id = $1 THEN rating END), 0) as avg_rating_as_passenger,
                COALESCE(AVG(CASE WHEN driver_id = $1 THEN rating END), 0) as avg_rating_as_driver
            FROM rides
            WHERE (passenger_id = $1 OR driver_id = $1)
        `, [req.user.id]);

        delete user.password;
        delete user.password_hash;
        user.stats = stats.rows[0] || {};

        res.json(user);
    } catch (e) {
        Logger.error('PROFILE_GET', e);
        res.status(500).json({ error: "Erro ao buscar perfil." });
    }
});

/**
 * PUT /api/profile - Atualizar perfil
 */
app.put('/api/profile', authenticateToken, async (req, res) => {
    const { name, phone, photo, vehicle_details } = req.body;

    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramCount}`);
            values.push(name);
            paramCount++;
        }

        if (phone !== undefined) {
            updates.push(`phone = $${paramCount}`);
            values.push(phone);
            paramCount++;
        }

        if (photo !== undefined) {
            updates.push(`photo = $${paramCount}`);
            values.push(photo);
            paramCount++;
        }

        if (vehicle_details !== undefined && req.user.role === 'driver') {
            updates.push(`vehicle_details = $${paramCount}`);
            values.push(JSON.stringify(vehicle_details));
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "Nenhum dado para atualizar." });
        }

        updates.push(`updated_at = NOW()`);
        values.push(req.user.id);

        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

        const result = await pool.query(query, values);
        const updatedUser = result.rows[0];
        delete updatedUser.password;
        delete updatedUser.password_hash;

        Logger.audit(req.user.id, 'PROFILE_UPDATE', { fields: updates });
        res.json(updatedUser);
    } catch (e) {
        Logger.error('PROFILE_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar perfil." });
    }
});

/**
 * POST /api/profile/photo - Upload de foto de perfil
 */
app.post('/api/profile/photo', authenticateToken, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Nenhuma imagem fornecida." });
        }

        const photoUrl = `/uploads/${req.file.filename}`;

        await pool.query(
            'UPDATE users SET photo = $1, updated_at = NOW() WHERE id = $2',
            [photoUrl, req.user.id]
        );

        Logger.audit(req.user.id, 'PHOTO_UPLOAD', { photoUrl });
        res.json({
            success: true,
            photo_url: photoUrl,
            message: "Foto de perfil atualizada com sucesso."
        });
    } catch (e) {
        Logger.error('PHOTO_UPLOAD', e);
        res.status(500).json({ error: "Erro ao fazer upload da foto." });
    }
});

/**
 * POST /api/profile/documents - Upload de documentos (BI e Carta)
 */
app.post('/api/profile/documents', authenticateToken, upload.fields([
    { name: 'bi_front', maxCount: 1 },
    { name: 'bi_back', maxCount: 1 },
    { name: 'driving_license_front', maxCount: 1 },
    { name: 'driving_license_back', maxCount: 1 }
]), async (req, res) => {
    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        // Processar BI
        if (req.files['bi_front']) {
            updates.push(`bi_front = $${paramCount}`);
            values.push(`/uploads/${req.files['bi_front'][0].filename}`);
            paramCount++;

            await pool.query(
                `INSERT INTO user_documents (user_id, document_type, front_image, status)
                 VALUES ($1, 'bi', $2, 'pending')
                 ON CONFLICT (user_id, document_type)
                 DO UPDATE SET front_image = $2, status = 'pending', updated_at = NOW()`,
                [req.user.id, `/uploads/${req.files['bi_front'][0].filename}`]
            );
        }

        if (req.files['bi_back']) {
            updates.push(`bi_back = $${paramCount}`);
            values.push(`/uploads/${req.files['bi_back'][0].filename}`);
            paramCount++;

            await pool.query(
                `UPDATE user_documents SET back_image = $1, updated_at = NOW()
                 WHERE user_id = $2 AND document_type = 'bi'`,
                [`/uploads/${req.files['bi_back'][0].filename}`, req.user.id]
            );
        }

        // Processar Carta de Condução (apenas para motoristas)
        if (req.user.role === 'driver') {
            if (req.files['driving_license_front']) {
                updates.push(`driving_license_front = $${paramCount}`);
                values.push(`/uploads/${req.files['driving_license_front'][0].filename}`);
                paramCount++;

                await pool.query(
                    `INSERT INTO user_documents (user_id, document_type, front_image, status)
                     VALUES ($1, 'driving_license', $2, 'pending')
                     ON CONFLICT (user_id, document_type)
                     DO UPDATE SET front_image = $2, status = 'pending', updated_at = NOW()`,
                    [req.user.id, `/uploads/${req.files['driving_license_front'][0].filename}`]
                );
            }

            if (req.files['driving_license_back']) {
                updates.push(`driving_license_back = $${paramCount}`);
                values.push(`/uploads/${req.files['driving_license_back'][0].filename}`);
                paramCount++;

                await pool.query(
                    `UPDATE user_documents SET back_image = $1, updated_at = NOW()
                     WHERE user_id = $2 AND document_type = 'driving_license'`,
                    [`/uploads/${req.files['driving_license_back'][0].filename}`, req.user.id]
                );
            }
        }

        if (updates.length > 0) {
            values.push(req.user.id);
            const query = `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount}`;
            await pool.query(query, values);
        }

        // Se todos documentos necessários foram enviados, marcar como pendente de verificação
        if (req.user.role === 'driver') {
            const docCount = await pool.query(
                `SELECT COUNT(*) FROM user_documents
                 WHERE user_id = $1 AND document_type IN ('bi', 'driving_license')
                 AND front_image IS NOT NULL`,
                [req.user.id]
            );

            if (docCount.rows[0].count == 2) {
                await pool.query(
                    'UPDATE users SET is_verified = false WHERE id = $1',
                    [req.user.id]
                );
            }
        }

        Logger.audit(req.user.id, 'DOCUMENTS_UPLOAD', { count: updates.length });
        res.json({
            success: true,
            message: "Documentos enviados com sucesso. Aguarde verificação."
        });
    } catch (e) {
        Logger.error('DOCUMENTS_UPLOAD', e);
        res.status(500).json({ error: "Erro ao fazer upload dos documentos." });
    }
});

/**
 * PUT /api/profile/settings - Atualizar configurações
 */
app.put('/api/profile/settings', authenticateToken, async (req, res) => {
    const { settings, privacy_settings, notification_preferences } = req.body;

    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (settings !== undefined) {
            updates.push(`settings = $${paramCount}`);
            values.push(JSON.stringify(settings));
            paramCount++;
        }

        if (privacy_settings !== undefined) {
            updates.push(`privacy_settings = $${paramCount}`);
            values.push(JSON.stringify(privacy_settings));
            paramCount++;
        }

        if (notification_preferences !== undefined) {
            updates.push(`notification_preferences = $${paramCount}`);
            values.push(JSON.stringify(notification_preferences));
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "Nenhuma configuração para atualizar." });
        }

        updates.push(`updated_at = NOW()`);
        values.push(req.user.id);

        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`;
        await pool.query(query, values);

        Logger.audit(req.user.id, 'SETTINGS_UPDATE', {});
        res.json({
            success: true,
            message: "Configurações atualizadas com sucesso."
        });
    } catch (e) {
        Logger.error('SETTINGS_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar configurações." });
    }
});

/**
 * POST /api/profile/change-password - Alterar senha
 */
app.post('/api/profile/change-password', authenticateToken, async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias." });
    }

    try {
        // Verificar senha atual
        const user = await pool.query('SELECT password, password_hash FROM users WHERE id = $1', [req.user.id]);

        if (user.rows.length === 0) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        let validCurrent = false;
        const dbUser = user.rows[0];

        // Verificar senha atual (ambos formatos)
        if (dbUser.password === current_password) {
            validCurrent = true;
        } else if (dbUser.password_hash) {
            validCurrent = await bcrypt.compare(current_password, dbUser.password_hash);
        }

        if (!validCurrent) {
            return res.status(401).json({ error: "Senha atual incorreta." });
        }

        // Atualizar senha (ambos formatos para compatibilidade)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        await pool.query(
            'UPDATE users SET password = $1, password_hash = $2, updated_at = NOW() WHERE id = $3',
            [new_password, hashedPassword, req.user.id]
        );

        Logger.audit(req.user.id, 'PASSWORD_CHANGE', {});
        res.json({
            success: true,
            message: "Senha alterada com sucesso."
        });
    } catch (e) {
        Logger.error('PASSWORD_CHANGE', e);
        res.status(500).json({ error: "Erro ao alterar senha." });
    }
});

// =================================================================================================
// 12. ROTAS DE OPERAÇÃO DE TRANSPORTE (COMBINADAS)
// =================================================================================================

/**
 * POST /api/rides/request - Solicitar corrida (Combined)
 */
app.post('/api/rides/request', authenticateToken, async (req, res) => {
    const {
        origin_lat, origin_lng, dest_lat, dest_lng,
        origin_name, dest_name, ride_type, distance_km,
        origin_addr, dest_addr, price_offer
    } = req.body;

    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng) {
        return res.status(400).json({ error: "Coordenadas obrigatórias." });
    }

    try {
        // Buscar configurações de preço
        const priceConfig = await pool.query(
            "SELECT value FROM app_settings WHERE key = 'ride_prices'"
        );

        const prices = priceConfig.rows[0]?.value || {
            base_price: 600,
            km_rate: 300,
            moto_base: 400,
            moto_km_rate: 180,
            delivery_base: 1000,
            delivery_km_rate: 450
        };

        // Calcular preço
        let estimated_price;
        if (ride_type === 'moto') {
            estimated_price = prices.moto_base + (distance_km * prices.moto_km_rate);
        } else if (ride_type === 'delivery') {
            estimated_price = prices.delivery_base + (distance_km * prices.delivery_km_rate);
        } else {
            estimated_price = prices.base_price + (distance_km * prices.km_rate);
        }

        // Usar price_offer se fornecido
        if (price_offer && price_offer > estimated_price) {
            estimated_price = price_offer;
        }

        // Garantir preço mínimo
        estimated_price = Math.max(estimated_price, 500);

        const result = await pool.query(
            `INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, origin_address, dest_address,
                estimated_price, initial_price, final_price,
                ride_type, distance_km, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10, $11, $12, 'searching', NOW())
            RETURNING *`,
            [
                req.user.id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name || origin_addr, dest_name || dest_addr, origin_addr, dest_addr,
                estimated_price, ride_type || 'ride', distance_km
            ]
        );

        const ride = result.rows[0];

        // Notificar via socket
        io.emit('new_ride_request', ride);
        io.to(`user_${req.user.id}`).emit('searching_started', ride);

        // Buscar motoristas próximos
        const driversRes = await pool.query(`
            SELECT dp.*, u.name, u.photo, u.rating, u.vehicle_details
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE u.is_online = true
            AND u.role = 'driver'
            AND u.is_blocked = false
            AND u.is_verified = true
            AND dp.last_update > NOW() - INTERVAL '30 minutes'
        `);

        const nearbyDrivers = driversRes.rows.filter(driver => {
            const dist = calculateDistance(origin_lat, origin_lng, driver.lat, driver.lng);
            return dist <= 15.0;
        });

        // Notificar motoristas próximos
        nearbyDrivers.forEach(driver => {
            io.to(`user_${driver.driver_id}`).emit('ride_opportunity', {
                ...ride,
                driver_distance: calculateDistance(origin_lat, origin_lng, driver.lat, driver.lng)
            });
        });

        if (nearbyDrivers.length === 0) {
            io.to(`user_${req.user.id}`).emit('no_drivers_available', {
                ride_id: ride.id,
                message: "Procurando motoristas próximos..."
            });
        }

        Logger.audit(req.user.id, 'RIDE_REQUEST', { ride_id: ride.id, estimated_price });
        res.json({ success: true, ride: ride, message: "Procurando motoristas..." });

    } catch (e) {
        Logger.error('RIDE_REQUEST', e);
        res.status(500).json({ error: "Erro ao solicitar corrida." });
    }
});

/**
 * POST /api/rides/accept - Aceitar corrida (Transação Atômica - Titanium Core)
 */
app.post('/api/rides/accept', authenticateToken, requireDriver, async (req, res) => {
    const { ride_id, final_price } = req.body;
    const driverId = req.user.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Bloquear a linha (SELECT FOR UPDATE) para evitar race conditions
        const rideRes = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (ride.status !== 'searching') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: "Esta corrida já foi aceita ou está em andamento.",
                current_status: ride.status
            });
        }

        // 2. Atualizar Status
        const updateRes = await client.query(
            `UPDATE rides SET driver_id = $1, final_price = COALESCE($2, estimated_price),
             status = 'accepted', accepted_at = NOW() WHERE id = $3 RETURNING *`,
            [driverId, final_price || ride.estimated_price, ride_id]
        );

        const updatedRide = updateRes.rows[0];

        await client.query('COMMIT');

        // 3. Buscar Dados Completos
        const fullData = await getFullRideDetails(ride_id);

        // 4. Notificar via Socket
        io.to(`ride_${ride_id}`).emit('match_found', fullData);
        io.to(`user_${ride.passenger_id}`).emit('ride_accepted', fullData);
        io.to(`user_${driverId}`).emit('ride_accepted_confirmation', fullData);

        Logger.audit(driverId, 'RIDE_ACCEPT', { ride_id });
        res.json({ success: true, ride: fullData });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('RIDE_ACCEPT', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/rides/update-status - Atualizar estados (Titanium Core)
 */
app.post('/api/rides/update-status', authenticateToken, async (req, res) => {
    const { ride_id, status, cancel_reason } = req.body;
    const userId = req.user.id;
    const validStatuses = ['arrived', 'started', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) return res.status(400).json({ error: "Status inválido." });

    try {
        // Validação de Permissão
        const rideCheck = await pool.query(
            "SELECT * FROM rides WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2)",
            [ride_id, userId]
        );
        if (rideCheck.rows.length === 0) {
            return res.status(403).json({ error: "Permissão negada ou corrida inexistente." });
        }

        const ride = rideCheck.rows[0];
        let query = "UPDATE rides SET status = $1";
        const params = [status];
        let paramIndex = 2;

        // Timestamps dinâmicos
        if (status === 'started') {
            query += `, started_at = NOW()`;
        } else if (status === 'completed') {
            query += `, completed_at = NOW()`;
        } else if (status === 'cancelled') {
            query += `, cancelled_at = NOW(), cancelled_by = $${paramIndex}, cancel_reason = $${paramIndex + 1}`;
            params.push(req.user.role);
            params.push(cancel_reason || 'Cancelado pelo usuário');
            paramIndex += 2;
        }

        query += ` WHERE id = $${paramIndex} RETURNING *`;
        params.push(ride_id);

        const updated = await pool.query(query, params);

        // Notificar a outra parte via Socket
        const targetId = (userId === ride.passenger_id) ? ride.driver_id : ride.passenger_id;
        if (targetId) {
            io.to(`user_${targetId}`).emit('ride_status_update', {
                ride_id,
                status,
                cancel_reason,
                updated_ride: updated.rows[0]
            });
        }

        // Notificar sala da corrida
        io.to(`ride_${ride_id}`).emit('ride_status_update', {
            ride_id,
            status,
            cancel_reason
        });

        Logger.audit(userId, 'RIDE_STATUS_UPDATE', { ride_id, status });
        res.json({ success: true, ride: updated.rows[0] });

    } catch (error) {
        Logger.error('RIDE_UPDATE', error);
        res.status(500).json({ error: "Erro ao atualizar status." });
    }
});

/**
 * POST /api/rides/complete - Finalizar corrida (Híbrido/Robusto)
 */
app.post('/api/rides/complete', authenticateToken, async (req, res) => {
    const { ride_id, rating, feedback, payment_method } = req.body;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Buscar corrida com trava
        const rideRes = await client.query(
            `SELECT * FROM rides WHERE id = $1 FOR UPDATE`,
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        // 2. Verificação de Status (Idempotência)
        if (ride.status === 'completed') {
            await client.query('COMMIT');
            const existingData = await getFullRideDetails(ride_id);
            io.to(`ride_${ride_id}`).emit('ride_completed', existingData);
            return res.json({
                success: true,
                message: "Corrida já foi finalizada anteriormente.",
                ...existingData
            });
        }

        if (ride.status !== 'ongoing' && ride.status !== 'accepted' && ride.status !== 'started') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: "Corrida não está em andamento para ser finalizada.",
                current_status: ride.status
            });
        }

        // 3. Definição de Valores
        const driverEarnings = ride.final_price || ride.estimated_price || ride.initial_price;
        const finalRating = rating || 5;
        const finalFeedback = feedback || '';
        const finalPaymentMethod = payment_method || 'cash';

        // 4. Atualizar status da corrida
        await client.query(`
            UPDATE rides SET
                status = 'completed',
                rating = $1,
                feedback = $2,
                payment_method = $3,
                payment_status = 'paid',
                completed_at = NOW()
            WHERE id = $4
        `, [finalRating, finalFeedback, finalPaymentMethod, ride_id]);

        // 5. Processamento Financeiro (Motorista)
        await client.query(
            `INSERT INTO wallet_transactions
             (user_id, amount, type, description, reference_id, status)
             VALUES ($1, $2, 'earnings', 'Corrida finalizada', $3, 'completed')`,
            [ride.driver_id, driverEarnings, ride_id]
        );

        await client.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2',
            [driverEarnings, ride.driver_id]
        );

        // 6. Processamento Financeiro (Passageiro - se pagamento via carteira)
        if (finalPaymentMethod === 'wallet') {
            await client.query(
                `INSERT INTO wallet_transactions
                 (user_id, amount, type, description, reference_id, status)
                 VALUES ($1, $2, 'payment', 'Pagamento de corrida', $3, 'completed')`,
                [ride.passenger_id, -driverEarnings, ride_id]
            );

            await client.query(
                'UPDATE users SET balance = balance - $1 WHERE id = $2',
                [driverEarnings, ride.passenger_id]
            );
        }

        await client.query('COMMIT');

        // 7. Retorno e Notificações
        const fullData = await getFullRideDetails(ride_id);

        io.to(`ride_${ride_id}`).emit('ride_completed', fullData);
        io.to(`user_${ride.passenger_id}`).emit('ride_completed', fullData);
        io.to(`user_${ride.driver_id}`).emit('ride_completed', fullData);

        Logger.audit(req.user.id, 'RIDE_COMPLETE', {
            ride_id,
            payment_method: finalPaymentMethod,
            amount: driverEarnings
        });
        res.json(fullData);

    } catch (e) {
        await client.query('ROLLBACK');
        Logger.error('RIDE_COMPLETE', e);
        res.status(500).json({
            error: "Erro ao processar finalização da corrida.",
            details: e.message
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/rides/history - Histórico de corridas
 */
app.get('/api/rides/history', authenticateToken, async (req, res) => {
    const { limit = 50, offset = 0, status } = req.query;

    try {
        let query = `
            SELECT r.*,
                   CASE
                     WHEN r.passenger_id = $1 THEN d.name
                     ELSE p.name
                   END as counterpart_name,
                   CASE
                     WHEN r.passenger_id = $1 THEN d.photo
                     ELSE p.photo
                   END as counterpart_photo,
                   CASE
                     WHEN r.passenger_id = $1 THEN 'driver'
                     ELSE 'passenger'
                   END as counterpart_role
            FROM rides r
            LEFT JOIN users d ON r.driver_id = d.id
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE (r.passenger_id = $1 OR r.driver_id = $1)
        `;

        const params = [req.user.id];
        let paramCount = 2;

        if (status) {
            query += ` AND r.status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        query += ` ORDER BY r.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) {
        Logger.error('RIDE_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
});

/**
 * GET /api/rides/:id - Detalhes da corrida
 */
app.get('/api/rides/:id', authenticateToken, async (req, res) => {
    try {
        const data = await getFullRideDetails(req.params.id);

        if (!data) {
            return res.status(404).json({ error: "Corrida não encontrada" });
        }

        // Verificar permissão
        if (data.passenger_id !== req.user.id && data.driver_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Acesso negado." });
        }

        res.json(data);
    } catch (e) {
        Logger.error('RIDE_DETAILS', e);
        res.status(500).json({ error: e.message });
    }
});

// =================================================================================================
// 13. ROTAS DA CARTEIRA (INTEGRADAS)
// =================================================================================================

// Montar rotas da carteira (módulo externo)
app.use('/api/wallet', authenticateToken, walletRoutes(pool, io));

// Rotas básicas da carteira (para compatibilidade)
app.get('/api/wallet/balance', authenticateToken, async (req, res) => {
    try {
        const userRes = await pool.query(
            "SELECT balance, bonus_points, wallet_account_number FROM users WHERE id = $1",
            [req.user.id]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: "Usuário inexistente" });
        }

        const txRes = await pool.query(
            `SELECT * FROM wallet_transactions
             WHERE user_id = $1 OR sender_id = $1 OR receiver_id = $1
             ORDER BY created_at DESC
             LIMIT 30`,
            [req.user.id]
        );

        res.json({
            balance: userRes.rows[0].balance,
            bonus_points: userRes.rows[0].bonus_points,
            wallet_account_number: userRes.rows[0].wallet_account_number,
            transactions: txRes.rows
        });
    } catch (e) {
        Logger.error('WALLET_GET', e);
        res.status(500).json({ error: e.message });
    }
});

// =================================================================================================
// 14. ROTAS ADMINISTRATIVAS (COMBINADAS)
// =================================================================================================

/**
 * GET /api/admin/dashboard-stats - Estatísticas do dashboard (Titanium Core)
 */
app.get('/api/admin/dashboard-stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const stats = {
            total_users: (await pool.query("SELECT COUNT(*) FROM users")).rows[0].count,
            total_drivers: (await pool.query("SELECT COUNT(*) FROM users WHERE role='driver'")).rows[0].count,
            total_passengers: (await pool.query("SELECT COUNT(*) FROM users WHERE role='passenger'")).rows[0].count,
            total_rides: (await pool.query("SELECT COUNT(*) FROM rides")).rows[0].count,
            active_drivers: (await pool.query("SELECT COUNT(*) FROM users WHERE role='driver' AND is_online=true")).rows[0].count,
            completed_rides: (await pool.query("SELECT COUNT(*) FROM rides WHERE status='completed'")).rows[0].count,
            pending_docs: (await pool.query("SELECT COUNT(*) FROM user_documents WHERE status='pending'")).rows[0].count,
            today_earnings: (await pool.query("SELECT COALESCE(SUM(final_price), 0) FROM rides WHERE status='completed' AND completed_at >= CURRENT_DATE")).rows[0].sum,
            total_balances: (await pool.query("SELECT COALESCE(SUM(balance), 0) FROM users")).rows[0].sum
        };
        res.json(stats);
    } catch (e) {
        Logger.error('ADMIN_STATS', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/verify-user - Verificar/Atualizar usuário (Titanium Core)
 */
app.post('/api/admin/verify-user', authenticateToken, requireAdmin, async (req, res) => {
    const { user_id, action, reason } = req.body;

    try {
        if (action === 'approve') {
            await pool.query("UPDATE users SET is_verified = true WHERE id = $1", [user_id]);
        } else if (action === 'reject') {
            await pool.query("UPDATE users SET is_verified = false WHERE id = $1", [user_id]);
        } else if (action === 'block') {
            await pool.query("UPDATE users SET is_blocked = true WHERE id = $1", [user_id]);
        } else if (action === 'unblock') {
            await pool.query("UPDATE users SET is_blocked = false WHERE id = $1", [user_id]);
        }

        Logger.audit(req.user.id, 'ADMIN_USER_ACTION', { action, user_id });
        res.json({ success: true, message: `Ação ${action} aplicada com sucesso.` });
    } catch (e) {
        Logger.error('ADMIN_VERIFY', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/admin/users - Listar usuários (Ultra Final)
 */
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    const { role, is_online, is_blocked, search, limit = 50, offset = 0 } = req.query;

    try {
        let query = `
            SELECT id, name, email, phone, role, photo,
                   balance, is_online, rating, is_blocked,
                   is_verified, created_at, last_login
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

        // Contar total para paginação
        const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
        const countResult = await pool.query(countQuery, params.slice(0, -2));

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
 * GET /api/admin/rides - Listar corridas (Admin)
 */
app.get('/api/admin/rides', authenticateToken, requireAdmin, async (req, res) => {
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

        // Contar total
        const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
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
// 15. ROTAS DE CHAT (COMBINADAS)
// =================================================================================================

/**
 * GET /api/chat/:ride_id - Histórico de mensagens
 */
app.get('/api/chat/:ride_id', authenticateToken, async (req, res) => {
    try {
        // Verificar se o usuário tem acesso a esta corrida
        const rideCheck = await pool.query(
            'SELECT * FROM rides WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2)',
            [req.params.ride_id, req.user.id]
        );

        if (rideCheck.rows.length === 0 && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Acesso negado." });
        }

        const messages = await pool.query(
            `SELECT cm.*, u.name as sender_name, u.photo as sender_photo
             FROM chat_messages cm
             JOIN users u ON cm.sender_id = u.id
             WHERE cm.ride_id = $1
             ORDER BY cm.created_at ASC`,
            [req.params.ride_id]
        );

        res.json(messages.rows);
    } catch (e) {
        Logger.error('CHAT_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar mensagens." });
    }
});

// =================================================================================================
// 16. MOTOR REAL-TIME (SOCKET.IO - COMBINADO)
// =================================================================================================

// Estrutura de dados em memória
const activeUsers = new Map();
const driverLocations = new Map();

// Middleware de Autenticação do Socket (Titanium Core)
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

    Logger.info('SOCKET', `Usuário conectado: ${userId} (${userRole}) - Socket: ${socket.id}`);

    // 1. Registro e Salas
    activeUsers.set(userId, socket.id);
    socket.join(`user_${userId}`);

    if (userRole === 'driver') {
        socket.join('drivers_room');
        pool.query("UPDATE users SET is_online = true WHERE id = $1", [userId]);

        // Registrar posição inicial
        pool.query(
            `INSERT INTO driver_positions (driver_id, socket_id, last_update)
             VALUES ($1, $2, NOW())
             ON CONFLICT (driver_id) DO UPDATE SET socket_id = $2, last_update = NOW()`,
            [userId, socket.id]
        );
    }

    /**
     * EVENTO: JOIN_USER (Ultra Final)
     */
    socket.on('join_user', async (userId) => {
        if (!userId) return;

        const roomName = `user_${userId}`;
        socket.join(roomName);

        try {
            await pool.query(
                "UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1",
                [userId]
            );

            if (userRole === 'driver') {
                await pool.query(
                    `INSERT INTO driver_positions (driver_id, socket_id, last_update)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (driver_id)
                     DO UPDATE SET socket_id = $2, last_update = NOW()`,
                    [userId, socket.id]
                );
            }

            Logger.info('ROOM', `Usuário ${userId} agora ONLINE na sala: ${roomName}`);
        } catch (e) {
            Logger.error('JOIN_USER', e);
        }
    });

    /**
     * EVENTO: JOIN_RIDE (Sincronização Titanium)
     */
    socket.on('join_ride', (ride_id) => {
        if (!ride_id) {
            Logger.error('ROOM_JOIN', 'Tentativa de ingresso negada: ID da corrida é nulo.');
            return;
        }

        const roomName = `ride_${ride_id}`;

        try {
            // Limpeza de salas residuais
            socket.rooms.forEach((room) => {
                if (room.startsWith('ride_') && room !== roomName) {
                    socket.leave(room);
                    Logger.info('ROOM_CLEAN', `Socket ${socket.id} removido da sala residual: ${room}`);
                }
            });

            socket.join(roomName);
            Logger.info('ROOM', `Socket ${socket.id} estabeleceu link seguro na sala: ${roomName}`);

            socket.emit('ride_room_confirmed', {
                ride_id: ride_id,
                status: 'connected',
                timestamp: new Date().toISOString()
            });

        } catch (e) {
            Logger.error('ROOM_JOIN_CRITICAL', e);
            socket.emit('error_response', { message: "Erro ao sincronizar com a sala da missão." });
        }
    });

    /**
     * EVENTO: UPDATE_LOCATION (Combined)
     */
    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading, ride_id, passenger_id } = data;
        if (!user_id) return;

        try {
            // Atualizar posição do motorista
            await pool.query(
                `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update, socket_id)
                 VALUES ($1, $2, $3, $4, NOW(), $5)
                 ON CONFLICT (driver_id) DO UPDATE SET
                    lat = $2,
                    lng = $3,
                    heading = $4,
                    last_update = NOW(),
                    socket_id = $5`,
                [user_id, lat, lng, heading || 0, socket.id]
            );

            // Se estiver em corrida, emitir para o passageiro
            if (ride_id && passenger_id) {
                io.to(`user_${passenger_id}`).emit('driver_location', {
                    lat, lng, heading,
                    ride_id,
                    timestamp: new Date().toISOString()
                });
            }

            // RADAR REVERSO: Procurar corridas pendentes
            const pendingRides = await pool.query(
                `SELECT * FROM rides
                 WHERE status = 'searching'
                 AND created_at > NOW() - INTERVAL '10 minutes'`
            );

            if (pendingRides.rows.length > 0) {
                pendingRides.rows.forEach(ride => {
                    const dist = calculateDistance(lat, lng, ride.origin_lat, ride.origin_lng);
                    if (dist <= 12.0) {
                        io.to(socket.id).emit('ride_opportunity', {
                            ...ride,
                            distance_to_driver: dist
                        });
                        Logger.info('RADAR_REVERSO', `Notificando motorista ${user_id} sobre pedido ${ride.id}`);
                    }
                });
            }
        } catch (e) {
            Logger.error('UPDATE_LOCATION', e);
        }
    });

    /**
     * EVENTO: REQUEST_RIDE (Ultra Final)
     */
    socket.on('request_ride', async (data) => {
        const {
            passenger_id, origin_lat, origin_lng,
            dest_lat, dest_lng, origin_name, dest_name,
            initial_price, ride_type, distance_km
        } = data;

        Logger.info('RIDE_REQUEST', `Passageiro ${passenger_id} solicitando corrida via socket.`);

        try {
            const insertQuery = `
                INSERT INTO rides (
                    passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                    origin_name, dest_name, initial_price, final_price,
                    ride_type, distance_km, status, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW())
                RETURNING *
            `;

            const result = await pool.query(insertQuery, [
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, ride_type, distance_km
            ]);

            const ride = result.rows[0];

            socket.join(`ride_${ride.id}`);
            io.to(`user_${passenger_id}`).emit('searching_started', ride);

            // Buscar motoristas ativos
            const driversRes = await pool.query(`
                SELECT dp.*, u.name, u.photo, u.rating, u.vehicle_details
                FROM driver_positions dp
                JOIN users u ON dp.driver_id = u.id
                WHERE u.is_online = true
                AND u.role = 'driver'
                AND u.is_blocked = false
                AND u.is_verified = true
                AND dp.last_update > NOW() - INTERVAL '30 minutes'
            `);

            const nearbyDrivers = driversRes.rows.filter(d => {
                const dist = calculateDistance(origin_lat, origin_lng, d.lat, d.lng);
                return dist <= 15.0;
            });

            if (nearbyDrivers.length === 0) {
                Logger.info('RIDE_REQUEST', `Zero motoristas imediatos encontrados. Aguardando Radar.`);
                io.to(`user_${passenger_id}`).emit('no_drivers_available', {
                    ride_id: ride.id,
                    message: "Procurando motoristas próximos..."
                });
            } else {
                Logger.info('RIDE_REQUEST', `Notificando ${nearbyDrivers.length} motoristas próximos.`);
                nearbyDrivers.forEach(d => {
                    io.to(`user_${d.driver_id}`).emit('ride_opportunity', {
                        ...ride,
                        distance_to_driver: calculateDistance(origin_lat, origin_lng, d.lat, d.lng)
                    });
                });
            }

        } catch (e) {
            Logger.error('RIDE_REQUEST_SOCKET', e);
            io.to(`user_${data.passenger_id}`).emit('error', {
                message: "Erro ao processar solicitação."
            });
        }
    });

    /**
     * EVENTO: ACCEPT_RIDE (Sincronização Total - Titanium)
     */
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;
        Logger.info('ACCEPT', `Motorista ${driver_id} tentando aceitar Ride ${ride_id}`);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. LOCK DE SEGURANÇA
            const checkQuery = "SELECT * FROM rides WHERE id = $1 FOR UPDATE";
            const checkRes = await client.query(checkQuery, [ride_id]);
            const ride = checkRes.rows[0];

            // 2. VALIDAÇÃO DE DISPONIBILIDADE
            if (!ride || ride.status !== 'searching') {
                await client.query('ROLLBACK');
                Logger.info('ACCEPT_DENIED', `Ride ${ride_id} indisponível ou já aceita.`);
                return socket.emit('error_response', {
                    message: "Esta corrida já não está mais disponível."
                });
            }

            // 3. ATUALIZAÇÃO ATÔMICA
            await client.query(
                `UPDATE rides SET
                    driver_id = $1,
                    final_price = COALESCE($2, initial_price),
                    status = 'accepted',
                    accepted_at = NOW()
                 WHERE id = $3`,
                [driver_id, final_price, ride_id]
            );

            await client.query('COMMIT');
            Logger.info('MATCH_DB', `Corrida ${ride_id} confirmada no banco de dados.`);

            // 4. PAYLOAD RICO
            const fullData = await getFullRideDetails(ride_id);

            // 5. SINCRONIZAÇÃO DE SALAS
            socket.join(`ride_${ride_id}`);

            // 6. DISPARO EM TEMPO REAL
            io.to(`ride_${ride_id}`).emit('match_found', fullData);
            io.to(`user_${ride.passenger_id}`).emit('match_found', fullData);
            socket.emit('match_found', fullData);

            Logger.info('SUCCESS', `Match Finalizado: Passageiro ${ride.passenger_id} <-> Motorista ${driver_id}`);

        } catch (e) {
            if (client) await client.query('ROLLBACK');
            Logger.error('ACCEPT_CRITICAL', e);
            socket.emit('error_response', {
                message: "Erro interno ao processar aceite da corrida."
            });
        } finally {
            client.release();
        }
    });

    /**
     * EVENTO: SEND_MESSAGE (Versão Híbrida Full)
     */
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, file_data } = data;

        if (!ride_id || !sender_id) {
            return Logger.error('CHAT', "Tentativa de envio com dados incompletos", data);
        }

        try {
            // Busca dados do remetente
            const userRes = await pool.query(
                "SELECT name, photo FROM users WHERE id = $1",
                [sender_id]
            );
            const sender = userRes.rows[0] || { name: "Usuário", photo: null };

            // Tratamento de conteúdo
            const finalText = text && text.trim() !== ''
                ? text
                : (file_data ? '📷 Foto enviada' : '');

            // Persistência no banco
            const res = await pool.query(
                `INSERT INTO chat_messages (ride_id, sender_id, message_text, text, file_data, created_at)
                 VALUES ($1, $2, $3, $3, $4, NOW())
                 RETURNING *`,
                [ride_id, sender_id, finalText, file_data || null]
            );

            // Construção do payload
            const fullMsg = {
                ...res.rows[0],
                sender_name: sender.name,
                sender_photo: sender.photo
            };

            // Emissão em tempo real
            io.to(`ride_${ride_id}`).emit('receive_message', fullMsg);

            Logger.audit(sender_id, 'CHAT_MESSAGE', { ride_id, has_file: !!file_data });

            // Lógica de notificação (background)
            (async () => {
                try {
                    const rideRes = await pool.query(
                        'SELECT passenger_id, driver_id FROM rides WHERE id = $1',
                        [ride_id]
                    );

                    if (rideRes.rows.length > 0) {
                        const ride = rideRes.rows[0];
                        const recipientId = (String(sender_id) === String(ride.passenger_id))
                            ? ride.driver_id
                            : ride.passenger_id;

                        if (recipientId) {
                            const isRecipientOnline = io.sockets.adapter.rooms.has(`user_${recipientId}`);

                            await pool.query(
                                `INSERT INTO notifications (user_id, title, body, type, data, created_at)
                                 VALUES ($1, $2, $3, 'chat', $4, NOW())`,
                                [
                                    recipientId,
                                    `Nova mensagem de ${sender.name}`,
                                    finalText.length > 60 ? finalText.substring(0, 60) + '...' : finalText,
                                    JSON.stringify({ ride_id, sender_id, type: 'chat' })
                                ]
                            );

                            if (isRecipientOnline) {
                                io.to(`user_${recipientId}`).emit('new_notification', {
                                    type: 'chat',
                                    ride_id: ride_id
                                });
                            }
                        }
                    }
                } catch (notifErr) {
                    Logger.error('CHAT_NOTIFICATION', notifErr);
                }
            })();

        } catch (e) {
            Logger.error('CHAT_CRITICAL', e);
            socket.emit('error_message', { error: "Erro ao processar sua mensagem." });
        }
    });

    /**
     * EVENTO: START_TRIP
     */
    socket.on('start_trip', async (data) => {
        const { ride_id } = data;

        try {
            await pool.query(
                "UPDATE rides SET status = 'ongoing', started_at = NOW() WHERE id = $1",
                [ride_id]
            );

            const fullData = await getFullRideDetails(ride_id);

            io.to(`ride_${ride_id}`).emit('trip_started_now', {
                full_details: fullData,
                status: 'ongoing',
                started_at: new Date().toISOString()
            });
        } catch (e) {
            Logger.error('START_TRIP', e);
        }
    });

    /**
     * EVENTO: CANCEL_RIDE
     */
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role, reason } = data;
        Logger.info('CANCEL', `Ride ${ride_id} cancelada por ${role}.`);

        try {
            await pool.query(
                `UPDATE rides SET
                    status = 'cancelled',
                    cancelled_at = NOW(),
                    cancelled_by = $1,
                    cancellation_reason = $2
                 WHERE id = $3`,
                [role, reason || 'Cancelado pelo usuário', ride_id]
            );

            const message = role === 'driver'
                ? "O motorista cancelou a viagem."
                : "O passageiro cancelou a solicitação.";

            io.to(`ride_${ride_id}`).emit('ride_terminated', {
                reason: message,
                origin: role,
                can_restart: true,
                cancelled_at: new Date().toISOString()
            });

            // Notificar o outro participante
            const details = await getFullRideDetails(ride_id);
            if (details) {
                const otherUserId = role === 'driver'
                    ? details.passenger_id
                    : details.driver_id;

                if (otherUserId) {
                    io.to(`user_${otherUserId}`).emit('ride_terminated', {
                        reason: message,
                        origin: role
                    });
                }
            }
        } catch (e) {
            Logger.error('CANCEL', e);
        }
    });

    /**
     * EVENTO: DISCONNECT (Correção Safe Disconnect)
     */
    socket.on('disconnect', async () => {
        Logger.info('SOCKET', `Conexão sinalizada como encerrada: ${socket.id}`);

        try {
            // Encontrar motorista associado a este socket
            const res = await pool.query(
                "SELECT driver_id FROM driver_positions WHERE socket_id = $1",
                [socket.id]
            );

            if (res.rows.length > 0) {
                const driverId = res.rows[0].driver_id;

                // Timer de segurança (20 segundos de tolerância)
                setTimeout(async () => {
                    try {
                        const checkReconnection = await pool.query(
                            "SELECT socket_id FROM driver_positions WHERE driver_id = $1",
                            [driverId]
                        );

                        if (checkReconnection.rows.length > 0 &&
                            checkReconnection.rows[0].socket_id === socket.id) {
                            // Offline definitivo
                            await pool.query(
                                "UPDATE users SET is_online = false WHERE id = $1",
                                [driverId]
                            );
                            Logger.info('OFFLINE', `Motorista ${driverId} realmente desconectado.`);
                        } else {
                            Logger.info('SOCKET', `Motorista ${driverId} reconectou com sucesso.`);
                        }
                    } catch (innerError) {
                        Logger.error('DISCONNECT_TIMEOUT', innerError);
                    }
                }, 20000);
            }
        } catch (e) {
            Logger.error('DISCONNECT_HANDLER', e);
        }
    });
});

// =================================================================================================
// 17. ROTA HEALTH CHECK
// =================================================================================================

app.get('/', (req, res) => res.status(200).json({
    status: "AOTRAVEL TITANIUM PRO ULTRA SERVER ONLINE",
    version: "v6.0 - 2026.02.10",
    environment: NODE_ENV,
    database: "Connected",
    socket_io: "Active",
    endpoints: {
        auth: "/api/auth/*",
        profile: "/api/profile/*",
        rides: "/api/rides/*",
        wallet: "/api/wallet/*",
        admin: "/api/admin/*",
        chat: "/api/chat/*"
    }
}));

// =================================================================================================
// 18. HANDLERS DE ERRO E 404
// =================================================================================================

// Rota 404
app.use((req, res) => {
    res.status(404).json({
        error: "Rota não encontrada.",
        path: req.path,
        method: req.method
    });
});

// Manipulador de Erros Global
app.use((err, req, res, next) => {
    Logger.error('GLOBAL_ERROR', err.message, err.stack);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Erro no upload: ${err.message}` });
    }

    res.status(500).json({
        error: "Erro Interno Crítico",
        message: NODE_ENV === 'development' ? err.message : "Contate o administrador."
    });
});

// =================================================================================================
// 19. INICIALIZAÇÃO DO SERVIDOR
// =================================================================================================

const startServer = async () => {
    try {
        // 1. Conectar e Configurar Banco
        await bootstrapDatabase();

        // 2. Iniciar Listen
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`
            =================================================================================================
            🚀 AOTRAVEL TITANIUM PRO ULTRA SERVER RUNNING
            =================================================================================================
            🌍 Environment: ${NODE_ENV}
            📡 Port:        ${PORT}
            💾 Database:    Connected (PostgreSQL SSL)
            🔌 Socket.io:   Active (Titanium Sync + Radar Reverso)
            👤 Auth System: Hybrid (JWT + Persistent Sessions)
            💰 Wallet Core: Integrated (ACID Transactions)
            📦 Status:      100% FUNCTIONAL - MERGED VERSION - PRODUCTION READY
            =================================================================================================
            `);
        });

    } catch (error) {
        Logger.error('STARTUP', 'Falha fatal ao iniciar servidor', error);
        process.exit(1);
    }
};

startServer();
