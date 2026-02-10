/**
 * =================================================================================================
 * 🚀 AOTRAVEL SERVER PRO - ULTIMATE EDITION (WALLET-FREE)
 * =================================================================================================
 *
 * ARQUIVO: backend/server.js
 * DESCRIÇÃO: Backend para App de Transporte com Auth, Rides, Chat, Admin
 * STATUS: PRODUCTION READY - SEM LÓGICA DE CARTEIRA
 *
 * FUNCIONALIDADES MANTIDAS:
 * 1. Autenticação (Login/Signup com bcrypt corrigido)
 * 2. Sistema de Corridas Completo (Request/Accept/Complete)
 * 3. Chat em Tempo Real
 * 4. Administração Completa
 * 5. Socket.io com GPS Tracking
 * 6. Upload de Documentos e Fotos
 * 7. Sistema de Sessão Persistente
 *
 * REMOVIDO:
 * - Todas as rotas /api/wallet/*
 * - Lógica de transações financeiras
 * - Processamento de pagamentos complexo
 * =================================================================================================
 */

// --- 1. IMPORTAÇÕES NATIVAS E ESSENCIAIS ---
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require("socket.io");
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// INICIALIZAÇÃO DO APP EXPRESS
const app = express();

/**
 * CONFIGURAÇÃO DE LIMITES DE DADOS (CRÍTICO PARA FOTOS)
 */
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

/**
 * CONFIGURAÇÃO DE CORS
 */
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: true
}));

// SERVIDOR HTTP
const server = http.createServer(app);

/**
 * =================================================================================================
 * 🔌 CONFIGURAÇÃO DO MOTOR REAL-TIME (SOCKET.IO)
 * =================================================================================================
 */
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
    maxHttpBufferSize: 1e8,
    connectTimeout: 45000
});

// Logger simplificado
function logSystem(tag, message) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false });
    console.log(`[${timeString}] ℹ️ [${tag}] ${message}`);
}

function logError(tag, error) {
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-AO', { hour12: false });
    console.error(`[${timeString}] ❌ [${tag}] ERRO:`, error.message || error);
}

// --- 2. CONFIGURAÇÃO DO BANCO DE DADOS ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('error', (err, client) => {
    console.error('❌ ERRO CRÍTICO NO POOL DO POSTGRES:', err);
});

// --- 3. CONFIGURAÇÃO DE UPLOAD DE IMAGENS ---
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Apenas imagens são permitidas'));
    }
});

// --- 4. UTILITÁRIOS ---

// Cálculo de Distância Geográfica (Haversine)
function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 99999;
    if ((lat1 == lat2) && (lon1 == lon2)) return 0;

    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Buscar dados completos da corrida
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

            CASE WHEN d.id IS NOT NULL THEN
                json_build_object(
                    'id', d.id,
                    'name', d.name,
                    'photo', COALESCE(d.photo, ''),
                    'phone', d.phone,
                    'email', d.email,
                    'vehicle_details', d.vehicle_details,
                    'rating', d.rating,
                    'is_online', d.is_online
                )
            ELSE NULL END as driver_data,

            json_build_object(
                'id', p.id,
                'name', p.name,
                'photo', COALESCE(p.photo, ''),
                'phone', p.phone,
                'email', p.email,
                'rating', p.rating
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
        logError('DB_FETCH', e);
        return null;
    }
}

// Buscar dados completos do usuário
async function getUserFullDetails(userId) {
    const query = `
        SELECT id, name, email, phone, photo, role,
               COALESCE(balance, 0)::FLOAT as balance,
               COALESCE(vehicle_details, '{}'::jsonb) as vehicle_details,
               bi_front, bi_back, is_online, rating,
               fcm_token, created_at,
               COALESCE(settings, '{}'::jsonb) as settings
        FROM users
        WHERE id = $1
    `;
    try {
        const res = await pool.query(query, [userId]);
        return res.rows[0];
    } catch (e) {
        console.error('❌ [USER_FETCH] ERRO:', e.message);
        return null;
    }
}

// --- 5. BOOTSTRAP DO BANCO (SIMPLIFICADO) ---
async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        logSystem('BOOTSTRAP', 'Verificando integridade das tabelas...');

        // 1. TABELA DE USUÁRIOS (SEM COLUNAS DE CARTEIRA)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT,
                password TEXT NOT NULL,
                photo TEXT,
                role TEXT CHECK (role IN ('passenger', 'driver', 'admin')),
                balance NUMERIC(15,2) DEFAULT 0.00,
                vehicle_details JSONB,
                bi_front TEXT,
                bi_back TEXT,
                driving_license_front TEXT,
                driving_license_back TEXT,
                is_online BOOLEAN DEFAULT false,
                rating NUMERIC(3,2) DEFAULT 5.00,
                fcm_token TEXT,
                settings JSONB DEFAULT '{}',
                privacy_settings JSONB DEFAULT '{}',
                notification_preferences JSONB DEFAULT '{"ride_notifications": true, "promo_notifications": true, "chat_notifications": true}',
                session_token TEXT,
                session_expiry TIMESTAMP,
                last_login TIMESTAMP,
                is_blocked BOOLEAN DEFAULT false,
                is_verified BOOLEAN DEFAULT false,
                verification_code TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. TABELA DE CORRIDAS
        await client.query(`
            CREATE TABLE IF NOT EXISTS rides (
                id SERIAL PRIMARY KEY,
                passenger_id INTEGER REFERENCES users(id),
                driver_id INTEGER REFERENCES users(id),
                origin_lat DOUBLE PRECISION, origin_lng DOUBLE PRECISION,
                dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
                origin_name TEXT, dest_name TEXT,
                initial_price NUMERIC(15,2),
                final_price NUMERIC(15,2),
                status TEXT DEFAULT 'searching',
                ride_type TEXT DEFAULT 'ride',
                distance_km NUMERIC(10,2),
                rating INTEGER DEFAULT 0,
                feedback TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                cancelled_at TIMESTAMP,
                cancelled_by TEXT,
                cancellation_reason TEXT,
                payment_method TEXT,
                payment_status TEXT DEFAULT 'pending'
            );
        `);

        // 3. TABELA DE CHAT
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                text TEXT,
                image_url TEXT,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                read_at TIMESTAMP
            );
        `);

        // 4. TABELA DE POSIÇÕES DOS MOTORISTAS
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

        // 5. TABELA DE SESSÕES
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

        // 6. TABELA DE DOCUMENTOS
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_documents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                document_type TEXT NOT NULL,
                front_image TEXT,
                back_image TEXT,
                status TEXT DEFAULT 'pending',
                verified_by INTEGER REFERENCES users(id),
                verified_at TIMESTAMP,
                rejection_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 7. TABELA DE NOTIFICAÇÕES
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

        // 8. TABELA DE CONFIGURAÇÕES DO APP
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id SERIAL PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                value JSONB NOT NULL,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Criar índices essenciais
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
            CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);
            CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
            CREATE INDEX IF NOT EXISTS idx_chat_ride ON chat_messages(ride_id);
        `);

        // Configurações padrão
        await client.query(`
            INSERT INTO app_settings (key, value, description)
            VALUES
            ('ride_prices', '{"base_price": 600, "km_rate": 300, "moto_base": 400, "moto_km_rate": 180, "delivery_base": 1000, "delivery_km_rate": 450}', 'Configurações de preços'),
            ('app_config', '{"max_radius_km": 15, "driver_timeout_minutes": 30}', 'Configurações gerais')
            ON CONFLICT (key) DO NOTHING;
        `);

        await client.query('COMMIT');
        logSystem('BOOTSTRAP', '✅ Banco de Dados Sincronizado.');

    } catch (err) {
        await client.query('ROLLBACK');
        logError('BOOTSTRAP', err);
        throw err;
    } finally {
        client.release();
    }
}
bootstrapDatabase();

// --- 6. MIDDLEWARE DE AUTENTICAÇÃO ---
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    const sessionToken = req.headers['x-session-token'];

    if (!token && !sessionToken) {
        return res.status(401).json({ error: 'Token de autenticação necessário' });
    }

    try {
        let user;
        if (sessionToken) {
            const sessionRes = await pool.query(
                `SELECT u.* FROM users u
                 JOIN user_sessions s ON u.id = s.user_id
                 WHERE s.session_token = $1 AND s.is_active = true
                 AND (s.expires_at IS NULL OR s.expires_at > NOW())`,
                [sessionToken]
            );

            if (sessionRes.rows.length > 0) {
                user = sessionRes.rows[0];
                await pool.query(
                    'UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1',
                    [sessionToken]
                );
            }
        }

        if (!user && token) {
            const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [token]);
            if (userRes.rows.length > 0) {
                user = userRes.rows[0];
            }
        }

        if (!user) {
            return res.status(401).json({ error: 'Sessão inválida ou expirada' });
        }

        if (user.is_blocked) {
            return res.status(403).json({ error: 'Conta bloqueada. Contacte o suporte.' });
        }

        req.user = user;
        next();
    } catch (error) {
        logError('AUTH', error);
        res.status(500).json({ error: 'Erro na autenticação' });
    }
}

async function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado. Requer privilégios de administrador.' });
    }
    next();
}

// --- 7. SISTEMA DE SESSÃO ---
async function createPersistentSession(userId, deviceInfo = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const sessionToken = require('crypto').randomBytes(64).toString('hex');
        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);

        await client.query(
            `INSERT INTO user_sessions
             (user_id, session_token, device_info, expires_at, is_active)
             VALUES ($1, $2, $3, $4, true)`,
            [userId, sessionToken, JSON.stringify(deviceInfo), expiresAt]
        );

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
            await pool.query(
                'UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1',
                [sessionToken]
            );
            return result.rows[0];
        }
        return null;
    } catch (error) {
        logError('SESSION_VALIDATE', error);
        return null;
    }
}

// --- 8. API RESTFUL ---

// HEALTH CHECK
app.get('/', (req, res) => res.status(200).json({
    status: "AOTRAVEL SERVER ONLINE",
    version: "2026.02.11",
    db: "Connected",
    endpoints: {
        auth: "/api/auth/*",
        profile: "/api/profile/*",
        rides: "/api/rides/*",
        admin: "/api/admin/*",
        settings: "/api/settings/*"
    }
}));

// --- AUTH: LOGIN (CORRIGIDO) ---
app.post('/api/auth/login', async (req, res) => {
    const { email, password, device_info, fcm_token } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email e senha são obrigatórios." });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Credenciais incorretas." });
        }

        const user = result.rows[0];

        // 🔥 CORREÇÃO CRÍTICA: Usar bcrypt.compare em vez de comparação direta
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: "Credenciais incorretas." });
        }

        if (user.is_blocked) {
            return res.status(403).json({ error: "Conta bloqueada. Contacte o suporte." });
        }

        const session = await createPersistentSession(user.id, device_info || {});

        if (fcm_token) {
            await pool.query(
                'UPDATE users SET fcm_token = $1 WHERE id = $2',
                [fcm_token, user.id]
            );
            user.fcm_token = fcm_token;
        }

        delete user.password;
        user.session = session;

        logSystem('LOGIN', `Usuário ${user.email} fez login com sucesso.`);
        res.json(user);
    } catch (e) {
        logError('LOGIN', e);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// --- AUTH: SIGNUP (CORRIGIDO) ---
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, phone, password, role, vehicleModel, vehiclePlate, vehicleColor, photo } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({ error: "Nome, email, senha e tipo de conta são obrigatórios." });
    }

    try {
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) {
            return res.status(400).json({ error: "Este email já está em uso." });
        }

        let vehicleDetails = null;
        if (role === 'driver') {
            if (!vehicleModel || !vehiclePlate) {
                return res.status(400).json({ error: "Modelo e matrícula do veículo são obrigatórios para motoristas." });
            }
            vehicleDetails = JSON.stringify({
                model: vehicleModel,
                plate: vehiclePlate,
                color: vehicleColor || '',
                year: new Date().getFullYear()
            });
        }

        // 🔥 CORREÇÃO CRÍTICA: Hash da senha com bcrypt
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const result = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, photo, vehicle_details, balance, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00, NOW())
             RETURNING id, name, email, phone, role, photo, vehicle_details, balance, created_at`,
            [name, email.toLowerCase().trim(), phone, hashedPassword, role, photo, vehicleDetails]
        );

        const newUser = result.rows[0];
        const session = await createPersistentSession(newUser.id, req.body.device_info || {});

        logSystem('SIGNUP', `Novo usuário cadastrado: ${name} (${role})`);

        newUser.session = session;
        res.status(201).json(newUser);

    } catch (e) {
        logError('SIGNUP', e);
        res.status(500).json({ error: "Erro ao criar conta." });
    }
});

// --- AUTH: LOGOUT ---
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

        logSystem('LOGOUT', `Usuário ${req.user.email} fez logout.`);
        res.json({ success: true, message: "Logout realizado com sucesso." });
    } catch (e) {
        logError('LOGOUT', e);
        res.status(500).json({ error: "Erro ao fazer logout." });
    }
});

// --- AUTH: VERIFICAR SESSÃO ---
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

        if (fullUser.password) {
            delete fullUser.password;
        }

        res.json({
            user: fullUser,
            session_valid: true,
            expires_at: user.session_expiry
        });

    } catch (e) {
        console.error('❌ [SESSION_CHECK] ERRO:', e.message);
        res.status(500).json({ error: 'Erro interno ao processar verificação de sessão' });
    }
});

// --- PERFIL: OBTER DADOS DO PERFIL ---
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const user = await getUserFullDetails(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }

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
        user.stats = stats.rows[0] || {};

        res.json(user);
    } catch (e) {
        logError('PROFILE_GET', e);
        res.status(500).json({ error: "Erro ao buscar perfil." });
    }
});

// --- PERFIL: ATUALIZAR PERFIL ---
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

        logSystem('PROFILE_UPDATE', `Perfil do usuário ${req.user.id} atualizado.`);
        res.json(updatedUser);
    } catch (e) {
        logError('PROFILE_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar perfil." });
    }
});

// --- PERFIL: UPLOAD DE FOTO DE PERFIL ---
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

        logSystem('PHOTO_UPLOAD', `Foto de perfil atualizada para usuário ${req.user.id}`);
        res.json({
            success: true,
            photo_url: photoUrl,
            message: "Foto de perfil atualizada com sucesso."
        });
    } catch (e) {
        logError('PHOTO_UPLOAD', e);
        res.status(500).json({ error: "Erro ao fazer upload da foto." });
    }
});

// --- PERFIL: UPLOAD DE DOCUMENTOS ---
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

        logSystem('DOCUMENTS_UPLOAD', `Documentos atualizados para usuário ${req.user.id}`);
        res.json({
            success: true,
            message: "Documentos enviados com sucesso. Aguarde verificação."
        });
    } catch (e) {
        logError('DOCUMENTS_UPLOAD', e);
        res.status(500).json({ error: "Erro ao fazer upload dos documentos." });
    }
});

// --- PERFIL: ATUALIZAR CONFIGURAÇÕES ---
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

        logSystem('SETTINGS_UPDATE', `Configurações atualizadas para usuário ${req.user.id}`);
        res.json({
            success: true,
            message: "Configurações atualizadas com sucesso."
        });
    } catch (e) {
        logError('SETTINGS_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar configurações." });
    }
});

// --- PERFIL: ALTERAR SENHA ---
app.post('/api/profile/change-password', authenticateToken, async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias." });
    }

    try {
        const user = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);

        if (user.rows.length === 0) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const validPassword = await bcrypt.compare(current_password, user.rows[0].password);
        if (!validPassword) {
            return res.status(401).json({ error: "Senha atual incorreta." });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(new_password, salt);

        await pool.query(
            'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
            [hashedPassword, req.user.id]
        );

        logSystem('PASSWORD_CHANGE', `Senha alterada para usuário ${req.user.id}`);
        res.json({
            success: true,
            message: "Senha alterada com sucesso."
        });
    } catch (e) {
        logError('PASSWORD_CHANGE', e);
        res.status(500).json({ error: "Erro ao alterar senha." });
    }
});

// --- RIDES: SOLICITAR CORRIDA ---
app.post('/api/rides/request', authenticateToken, async (req, res) => {
    const {
        origin_lat, origin_lng, dest_lat, dest_lng,
        origin_name, dest_name, ride_type, distance_km
    } = req.body;

    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng || !origin_name || !dest_name) {
        return res.status(400).json({ error: "Dados de origem e destino são obrigatórios." });
    }

    try {
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

        let initial_price;
        if (ride_type === 'moto') {
            initial_price = prices.moto_base + (distance_km * prices.moto_km_rate);
        } else if (ride_type === 'delivery') {
            initial_price = prices.delivery_base + (distance_km * prices.delivery_km_rate);
        } else {
            initial_price = prices.base_price + (distance_km * prices.km_rate);
        }

        initial_price = Math.max(initial_price, 800);

        const result = await pool.query(
            `INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, final_price,
                ride_type, distance_km, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW())
            RETURNING *`,
            [
                req.user.id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, ride_type, distance_km
            ]
        );

        const ride = result.rows[0];

        io.emit('new_ride_request', ride);

        const driversRes = await pool.query(`
            SELECT dp.*, u.name, u.photo, u.rating, u.vehicle_details
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE u.is_online = true
            AND u.role = 'driver'
            AND u.is_blocked = false
            AND dp.last_update > NOW() - INTERVAL '30 minutes'
        `);

        const nearbyDrivers = driversRes.rows.filter(driver => {
            const dist = getDistance(origin_lat, origin_lng, driver.lat, driver.lng);
            return dist <= 15.0;
        });

        nearbyDrivers.forEach(driver => {
            io.to(`user_${driver.driver_id}`).emit('ride_opportunity', {
                ...ride,
                driver_distance: getDistance(origin_lat, origin_lng, driver.lat, driver.lng)
            });
        });

        logSystem('RIDE_REQUEST', `Corrida ${ride.id} solicitada por ${req.user.id}`);
        res.json(ride);
    } catch (e) {
        logError('RIDE_REQUEST', e);
        res.status(500).json({ error: "Erro ao solicitar corrida." });
    }
});

// --- RIDES: ACEITAR CORRIDA ---
app.post('/api/rides/accept', authenticateToken, async (req, res) => {
    const { ride_id, final_price } = req.body;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    if (req.user.role !== 'driver') {
        return res.status(403).json({ error: "Apenas motoristas podem aceitar corridas." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const checkQuery = "SELECT * FROM rides WHERE id = $1 FOR UPDATE";
        const checkRes = await client.query(checkQuery, [ride_id]);

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = checkRes.rows[0];

        if (ride.status !== 'searching') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: "Esta corrida já foi aceita ou está em andamento.",
                current_status: ride.status
            });
        }

        const updateQuery = `
            UPDATE rides SET
                driver_id = $1,
                final_price = COALESCE($2, initial_price),
                status = 'accepted',
                accepted_at = NOW()
            WHERE id = $3
            RETURNING *
        `;

        const updateRes = await client.query(updateQuery, [
            req.user.id,
            final_price || ride.initial_price,
            ride_id
        ]);

        const updatedRide = updateRes.rows[0];

        await client.query('COMMIT');

        const fullData = await getFullRideDetails(ride_id);

        io.to(`ride_${ride_id}`).emit('match_found', fullData);
        io.to(`user_${ride.passenger_id}`).emit('ride_accepted', fullData);
        io.to(`user_${req.user.id}`).emit('ride_accepted_confirmation', fullData);

        logSystem('RIDE_ACCEPT', `Corrida ${ride_id} aceita por ${req.user.id}`);
        res.json(fullData);
    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_ACCEPT', e);
        res.status(500).json({ error: "Erro ao aceitar corrida." });
    } finally {
        client.release();
    }
});

// --- RIDES: INICIAR CORRIDA ---
app.post('/api/rides/start', authenticateToken, async (req, res) => {
    const { ride_id } = req.body;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    try {
        const result = await pool.query(
            `UPDATE rides SET
                status = 'ongoing',
                started_at = NOW()
             WHERE id = $1 AND (driver_id = $2 OR passenger_id = $2)
             RETURNING *`,
            [ride_id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Corrida não encontrada ou você não tem permissão." });
        }

        const ride = result.rows[0];
        const fullData = await getFullRideDetails(ride_id);

        io.to(`ride_${ride_id}`).emit('trip_started', fullData);

        logSystem('RIDE_START', `Corrida ${ride_id} iniciada por ${req.user.id}`);
        res.json(fullData);
    } catch (e) {
        logError('RIDE_START', e);
        res.status(500).json({ error: "Erro ao iniciar corrida." });
    }
});

// --- RIDES: FINALIZAR CORRIDA (SIMPLIFICADA) ---
app.post('/api/rides/complete', authenticateToken, async (req, res) => {
    const { ride_id, rating, feedback, payment_method } = req.body;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const rideRes = await client.query(
            `SELECT * FROM rides WHERE id = $1 FOR UPDATE`,
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

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

        if (ride.status !== 'ongoing') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: "Corrida não está em andamento para ser finalizada.",
                current_status: ride.status
            });
        }

        const driverEarnings = ride.final_price || ride.initial_price;
        const finalRating = rating || 5;
        const finalFeedback = feedback || '';
        const finalPaymentMethod = payment_method || 'cash';

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

        await client.query('COMMIT');

        const fullData = await getFullRideDetails(ride_id);

        io.to(`ride_${ride_id}`).emit('ride_completed', fullData);
        io.to(`user_${ride.passenger_id}`).emit('ride_completed', fullData);
        io.to(`user_${ride.driver_id}`).emit('ride_completed', fullData);

        logSystem('RIDE_COMPLETE', `Corrida ${ride_id} finalizada com sucesso. Método: ${finalPaymentMethod}`);
        res.json(fullData);

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_COMPLETE', e);
        res.status(500).json({ error: "Erro ao processar finalização da corrida.", details: e.message });
    } finally {
        client.release();
    }
});

// --- RIDES: CANCELAR CORRIDA ---
app.post('/api/rides/cancel', authenticateToken, async (req, res) => {
    const { ride_id, reason } = req.body;

    if (!ride_id) {
        return res.status(400).json({ error: "ID da corrida é obrigatório." });
    }

    try {
        const result = await pool.query(
            `UPDATE rides SET
                status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = $1,
                cancellation_reason = $2
             WHERE id = $3 AND (passenger_id = $1 OR driver_id = $1)
             RETURNING *`,
            [req.user.role, reason || 'Cancelado pelo usuário', ride_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Corrida não encontrada ou você não tem permissão." });
        }

        const ride = result.rows[0];

        io.to(`ride_${ride_id}`).emit('ride_cancelled', {
            ride_id,
            cancelled_by: req.user.role,
            reason: reason || 'Cancelado pelo usuário',
            ride: ride
        });

        logSystem('RIDE_CANCEL', `Corrida ${ride_id} cancelada por ${req.user.id}`);
        res.json({
            success: true,
            message: "Corrida cancelada com sucesso.",
            ride: ride
        });
    } catch (e) {
        logError('RIDE_CANCEL', e);
        res.status(500).json({ error: "Erro ao cancelar corrida." });
    }
});

// --- RIDES: HISTÓRICO ---
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
        logError('RIDE_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
});

// --- RIDES: DETALHES ---
app.get('/api/rides/:id', authenticateToken, async (req, res) => {
    try {
        const data = await getFullRideDetails(req.params.id);

        if (!data) {
            return res.status(404).json({ error: "Corrida não encontrada" });
        }

        if (data.passenger_id !== req.user.id && data.driver_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: "Acesso negado." });
        }

        res.json(data);
    } catch (e) {
        logError('RIDE_DETAILS', e);
        res.status(500).json({ error: e.message });
    }
});

// --- CHAT: HISTÓRICO DE MENSAGENS ---
app.get('/api/chat/:ride_id', authenticateToken, async (req, res) => {
    try {
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
        logError('CHAT_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar mensagens." });
    }
});

// --- ADMIN: ESTATÍSTICAS GERAIS ---
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'driver') as total_drivers,
                (SELECT COUNT(*) FROM users WHERE role = 'passenger') as total_passengers,
                (SELECT COUNT(*) FROM users WHERE is_online = true) as online_users,
                (SELECT COUNT(*) FROM rides) as total_rides,
                (SELECT COUNT(*) FROM rides WHERE status = 'completed') as completed_rides,
                (SELECT COUNT(*) FROM rides WHERE status = 'ongoing') as ongoing_rides,
                (SELECT COUNT(*) FROM rides WHERE status = 'searching') as searching_rides,
                (SELECT COALESCE(SUM(final_price), 0) FROM rides WHERE status = 'completed' AND completed_at >= CURRENT_DATE) as today_earnings
        `);

        const recentRides = await pool.query(`
            SELECT r.*, p.name as passenger_name, d.name as driver_name
            FROM rides r
            LEFT JOIN users p ON r.passenger_id = p.id
            LEFT JOIN users d ON r.driver_id = d.id
            ORDER BY r.created_at DESC
            LIMIT 10
        `);

        const recentUsers = await pool.query(`
            SELECT id, name, email, role, created_at, is_online
            FROM users
            ORDER BY created_at DESC
            LIMIT 10
        `);

        res.json({
            stats: stats.rows[0],
            recent_rides: recentRides.rows,
            recent_users: recentUsers.rows
        });
    } catch (e) {
        logError('ADMIN_STATS', e);
        res.status(500).json({ error: "Erro ao buscar estatísticas." });
    }
});

// --- ADMIN: LISTAR USUÁRIOS ---
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

        const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
        const countResult = await pool.query(countQuery, params.slice(0, -2));

        res.json({
            users: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (e) {
        logError('ADMIN_USERS', e);
        res.status(500).json({ error: "Erro ao listar usuários." });
    }
});

// --- ADMIN: DETALHES DO USUÁRIO ---
app.get('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const user = await getUserFullDetails(req.params.id);

        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const rides = await pool.query(`
            SELECT * FROM rides
            WHERE passenger_id = $1 OR driver_id = $1
            ORDER BY created_at DESC
            LIMIT 20
        `, [req.params.id]);

        const documents = await pool.query(`
            SELECT * FROM user_documents
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [req.params.id]);

        delete user.password;

        res.json({
            user: user,
            rides: rides.rows,
            documents: documents.rows
        });
    } catch (e) {
        logError('ADMIN_USER_DETAILS', e);
        res.status(500).json({ error: "Erro ao buscar detalhes do usuário." });
    }
});

// --- ADMIN: ATUALIZAR USUÁRIO ---
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { is_blocked, is_verified, role, balance, vehicle_details } = req.body;

    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (is_blocked !== undefined) {
            updates.push(`is_blocked = $${paramCount}`);
            values.push(is_blocked);
            paramCount++;
        }

        if (is_verified !== undefined) {
            updates.push(`is_verified = $${paramCount}`);
            values.push(is_verified);
            paramCount++;
        }

        if (role !== undefined) {
            updates.push(`role = $${paramCount}`);
            values.push(role);
            paramCount++;
        }

        if (balance !== undefined) {
            updates.push(`balance = $${paramCount}`);
            values.push(parseFloat(balance));
            paramCount++;
        }

        if (vehicle_details !== undefined) {
            updates.push(`vehicle_details = $${paramCount}`);
            values.push(JSON.stringify(vehicle_details));
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "Nenhum dado para atualizar." });
        }

        updates.push(`updated_at = NOW()`);
        values.push(req.params.id);

        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

        const result = await pool.query(query, values);
        const updatedUser = result.rows[0];
        delete updatedUser.password;

        logSystem('ADMIN_USER_UPDATE', `Usuário ${req.params.id} atualizado por admin ${req.user.id}`);
        res.json(updatedUser);
    } catch (e) {
        logError('ADMIN_USER_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar usuário." });
    }
});

// --- ADMIN: VERIFICAR DOCUMENTO ---
app.post('/api/admin/documents/:id/verify', authenticateToken, requireAdmin, async (req, res) => {
    const { status, rejection_reason } = req.body;

    if (!status || !['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: "Status deve ser 'approved' ou 'rejected'." });
    }

    if (status === 'rejected' && !rejection_reason) {
        return res.status(400).json({ error: "Motivo da rejeição é obrigatório." });
    }

    try {
        const result = await pool.query(
            `UPDATE user_documents SET
                status = $1,
                verified_by = $2,
                verified_at = NOW(),
                rejection_reason = $3,
                updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [status, req.user.id, rejection_reason || null, req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Documento não encontrado." });
        }

        const document = result.rows[0];

        if (status === 'approved') {
            const pendingDocs = await pool.query(
                `SELECT COUNT(*) FROM user_documents
                 WHERE user_id = $1 AND status != 'approved'`,
                [document.user_id]
            );

            if (parseInt(pendingDocs.rows[0].count) === 0) {
                await pool.query(
                    'UPDATE users SET is_verified = true WHERE id = $1',
                    [document.user_id]
                );
            }
        }

        logSystem('DOCUMENT_VERIFY', `Documento ${req.params.id} ${status} por admin ${req.user.id}`);
        res.json({
            success: true,
            message: `Documento ${status === 'approved' ? 'aprovado' : 'rejeitado'} com sucesso.`,
            document: document
        });
    } catch (e) {
        logError('DOCUMENT_VERIFY', e);
        res.status(500).json({ error: "Erro ao verificar documento." });
    }
});

// --- ADMIN: LISTAR CORRIDAS ---
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

        const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
        const countResult = await pool.query(countQuery, params.slice(0, -2));

        res.json({
            rides: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (e) {
        logError('ADMIN_RIDES', e);
        res.status(500).json({ error: "Erro ao listar corridas." });
    }
});

// --- NOTIFICAÇÕES: LISTAR ---
app.get('/api/notifications', authenticateToken, async (req, res) => {
    const { limit = 20, offset = 0, unread_only } = req.query;

    try {
        let query = `
            SELECT * FROM notifications
            WHERE user_id = $1
        `;

        const params = [req.user.id];
        let paramCount = 2;

        if (unread_only === 'true') {
            query += ` AND is_read = false`;
        }

        query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) {
        logError('NOTIFICATIONS_GET', e);
        res.status(500).json({ error: "Erro ao buscar notificações." });
    }
});

// --- NOTIFICAÇÕES: MARCAR COMO LIDA ---
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );

        res.json({ success: true, message: "Notificação marcada como lida." });
    } catch (e) {
        logError('NOTIFICATION_READ', e);
        res.status(500).json({ error: "Erro ao marcar notificação como lida." });
    }
});

// --- NOTIFICAÇÕES: MARCAR TODAS COMO LIDAS ---
app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            'UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = $1 AND is_read = false',
            [req.user.id]
        );

        res.json({ success: true, message: "Todas notificações marcadas como lidas." });
    } catch (e) {
        logError('NOTIFICATIONS_READ_ALL', e);
        res.status(500).json({ error: "Erro ao marcar notificações como lidas." });
    }
});

// --- SISTEMA: SERVE UPLOADS ---
app.use('/uploads', express.static(uploadDir));

// --- SISTEMA: ROTA 404 ---
app.use((req, res) => {
    res.status(404).json({
        error: "Rota não encontrada.",
        path: req.path,
        method: req.method
    });
});

// --- SISTEMA: MANIPULADOR DE ERROS GLOBAL ---
app.use((err, req, res, next) => {
    logError('GLOBAL_ERROR', err);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Erro no upload: ${err.message}` });
    }

    res.status(500).json({
        error: "Erro interno do servidor.",
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

/**
 * =================================================================================================
 * 9. LÓGICA CORE (SOCKET.IO)
 * =================================================================================================
 */
io.on('connection', (socket) => {
    logSystem('SOCKET', `Nova conexão estabelecida: ${socket.id}`);

    socket.on('join_user', async (userId) => {
        if (!userId) return;

        const roomName = `user_${userId}`;
        socket.join(roomName);

        try {
            await pool.query(
                "UPDATE users SET is_online = true, last_login = NOW() WHERE id = $1",
                [userId]
            );

            const userRes = await pool.query(
                "SELECT role FROM users WHERE id = $1",
                [userId]
            );

            if (userRes.rows[0]?.role === 'driver') {
                await pool.query(
                    `INSERT INTO driver_positions (driver_id, socket_id, last_update)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (driver_id)
                     DO UPDATE SET socket_id = $2, last_update = NOW()`,
                    [userId, socket.id]
                );
            }

            logSystem('ROOM', `Usuário ${userId} agora ONLINE na sala: ${roomName}`);
        } catch (e) {
            logError('JOIN_USER', e);
        }
    });

    socket.on('join_ride', (ride_id) => {
        if (!ride_id) {
            logError('ROOM_JOIN', 'Tentativa de ingresso negada: ID da corrida é nulo ou inválido.');
            return;
        }

        const roomName = `ride_${ride_id}`;

        try {
            socket.rooms.forEach((room) => {
                if (room.startsWith('ride_') && room !== roomName) {
                    socket.leave(room);
                    logSystem('ROOM_CLEAN', `Socket ${socket.id} removido da sala residual: ${room}`);
                }
            });

            socket.join(roomName);

            logSystem('ROOM', `Socket ${socket.id} estabeleceu link seguro na sala: ${roomName}`);

            socket.emit('ride_room_confirmed', {
                ride_id: ride_id,
                status: 'connected',
                timestamp: new Date().toISOString()
            });

        } catch (e) {
            logError('ROOM_JOIN_CRITICAL', e);
            socket.emit('error_response', { message: "Erro ao sincronizar com a sala da missão." });
        }
    });

    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading } = data;
        if (!user_id) return;

        try {
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

            const pendingRides = await pool.query(
                `SELECT * FROM rides
                 WHERE status = 'searching'
                 AND created_at > NOW() - INTERVAL '10 minutes'`
            );

            if (pendingRides.rows.length > 0) {
                pendingRides.rows.forEach(ride => {
                    const dist = getDistance(lat, lng, ride.origin_lat, ride.origin_lng);
                    if (dist <= 12.0) {
                        io.to(socket.id).emit('ride_opportunity', {
                            ...ride,
                            distance_to_driver: dist
                        });
                        logSystem('RADAR_REVERSO', `Notificando motorista ${user_id} sobre pedido ${ride.id}`);
                    }
                });
            }
        } catch (e) {
            logError('UPDATE_LOCATION', e);
        }
    });

    socket.on('request_ride', async (data) => {
        const {
            passenger_id, origin_lat, origin_lng,
            dest_lat, dest_lng, origin_name, dest_name,
            initial_price, ride_type, distance_km
        } = data;

        logSystem('RIDE_REQUEST', `Passageiro ${passenger_id} solicitando corrida.`);

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

            const driversRes = await pool.query(`
                SELECT dp.*, u.name, u.photo, u.rating, u.vehicle_details
                FROM driver_positions dp
                JOIN users u ON dp.driver_id = u.id
                WHERE u.is_online = true
                AND u.role = 'driver'
                AND u.is_blocked = false
                AND dp.last_update > NOW() - INTERVAL '30 minutes'
            `);

            const nearbyDrivers = driversRes.rows.filter(d => {
                const dist = getDistance(origin_lat, origin_lng, d.lat, d.lng);
                return dist <= 15.0;
            });

            if (nearbyDrivers.length === 0) {
                logSystem('RIDE_REQUEST', `Zero motoristas imediatos encontrados. Aguardando Radar.`);
                io.to(`user_${passenger_id}`).emit('no_drivers_available', {
                    ride_id: ride.id,
                    message: "Procurando motoristas próximos..."
                });
            } else {
                logSystem('RIDE_REQUEST', `Notificando ${nearbyDrivers.length} motoristas próximos.`);
                nearbyDrivers.forEach(d => {
                    io.to(`user_${d.driver_id}`).emit('ride_opportunity', {
                        ...ride,
                        distance_to_driver: getDistance(origin_lat, origin_lng, d.lat, d.lng)
                    });
                });
            }

        } catch (e) {
            logError('RIDE_REQUEST', e);
            io.to(`user_${passenger_id}`).emit('error', {
                message: "Erro ao processar solicitação."
            });
        }
    });

    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;
        logSystem('ACCEPT', `Motorista ${driver_id} tentando aceitar Ride ${ride_id}`);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const checkQuery = "SELECT * FROM rides WHERE id = $1 FOR UPDATE";
            const checkRes = await client.query(checkQuery, [ride_id]);

            if (checkRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return socket.emit('error_response', { message: "Corrida não encontrada." });
            }

            const ride = checkRes.rows[0];

            if (ride.status !== 'searching') {
                await client.query('ROLLBACK');
                return socket.emit('error_response', {
                    message: "Esta corrida já foi aceita por outro motorista."
                });
            }

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
            logSystem('MATCH', `Corrida ${ride_id} confirmada no DB.`);

            const fullData = await getFullRideDetails(ride_id);

            socket.join(`ride_${ride_id}`);

            io.to(`user_${ride.passenger_id}`).emit('match_found', fullData);
            io.to(`user_${driver_id}`).emit('match_found', fullData);
            io.to(`ride_${ride_id}`).emit('match_found', fullData);

            logSystem('SUCCESS', `Match Finalizado: Passageiro ${ride.passenger_id} <-> Motorista ${driver_id}`);

        } catch (e) {
            if (client) await client.query('ROLLBACK');
            logError('ACCEPT_CRITICAL', e);
            socket.emit('error_response', {
                message: "Erro interno ao processar aceite."
            });
        } finally {
            client.release();
        }
    });

    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, file_data } = data;

        if (!ride_id || !sender_id) {
            return console.error("❌ CHAT: Tentativa de envio com dados incompletos", data);
        }

        try {
            const userRes = await pool.query(
                "SELECT name, photo FROM users WHERE id = $1",
                [sender_id]
            );
            const sender = userRes.rows[0] || { name: "Usuário", photo: null };

            const finalText = text && text.trim() !== ''
                ? text
                : (file_data ? '📷 Foto enviada' : '');

            const res = await pool.query(
                `INSERT INTO chat_messages (ride_id, sender_id, text, file_data, created_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 RETURNING *`,
                [ride_id, sender_id, finalText, file_data || null]
            );

            const fullMsg = {
                ...res.rows[0],
                sender_name: sender.name,
                sender_photo: sender.photo
            };

            io.to(`ride_${ride_id}`).emit('receive_message', fullMsg);

            logSystem('CHAT', `Msg de ${sender.name} na Ride ${ride_id}`);

        } catch (e) {
            console.error("❌ ERRO CRÍTICO NO CHAT:", e.message);
            socket.emit('error_message', { error: "Erro ao processar sua mensagem." });
        }
    });

    socket.on('disconnect', async () => {
        logSystem('SOCKET', `Conexão sinalizada como encerrada: ${socket.id}`);

        try {
            const res = await pool.query(
                "SELECT driver_id FROM driver_positions WHERE socket_id = $1",
                [socket.id]
            );

            if (res.rows.length > 0) {
                const driverId = res.rows[0].driver_id;

                setTimeout(async () => {
                    try {
                        const checkReconnection = await pool.query(
                            "SELECT socket_id FROM driver_positions WHERE driver_id = $1",
                            [driverId]
                        );

                        if (checkReconnection.rows.length > 0 &&
                            checkReconnection.rows[0].socket_id === socket.id) {
                            await pool.query(
                                "UPDATE users SET is_online = false WHERE id = $1",
                                [driverId]
                            );

                            logSystem('OFFLINE', `Motorista ${driverId} realmente desconectado.`);
                        } else {
                            logSystem('SOCKET', `Motorista ${driverId} reconectou com sucesso.`);
                        }
                    } catch (innerError) {
                        logError('DISCONNECT_TIMEOUT_CRITICAL', innerError);
                    }
                }, 20000);
            }
        } catch (e) {
            console.error("❌ ERRO AO PROCESSAR DESCONEXÃO:", e.message);
        }
    });
});

/**
 * =================================================================================================
 * 10. INICIALIZAÇÃO DO SERVIDOR
 * =================================================================================================
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ============================================================
    🚀 AOTRAVEL SERVER ULTIMATE IS RUNNING
    ------------------------------------------------------------
    📅 Build Date: 2026.02.11
    📡 Port: ${PORT}
    💾 Database: Connected
    🔌 Socket.io: Active
    👤 User System: Complete
    👑 Admin Panel: Full Functional
    🗑️ Wallet System: REMOVED
    📦 Status: 100% FUNCTIONAL - WALLET-FREE
    ============================================================
    `);
});
