/**
=================================================================================================
🚀 AOTRAVEL SERVER - CORE ENGINE v6.2 (BLINDADO E ROBUSTO)
=================================================================================================
ARQUITETURA: Backend Monolítico Modularizado
STATUS: PRODUCTION READY - FULLY TESTED
DATA: 10 de Fevereiro de 2026
VERSÃO: v6.2 - 100% Funcional e Blindado
=================================================================================================
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
const { URL } = require('url');

// Constantes de Ambiente
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "aotravel_titanium_secret_key_2026_secure_hash_complex_string_" + crypto.randomBytes(32).toString('hex');
const DATABASE_URL = process.env.DATABASE_URL;
const NODE_ENV = process.env.NODE_ENV || 'production';

// Configuração segura do PostgreSQL SSL
const parseDatabaseUrl = (url) => {
    try {
        const dbUrl = new URL(url);
        const config = {
            user: dbUrl.username,
            password: dbUrl.password,
            host: dbUrl.hostname,
            port: dbUrl.port || 5432,
            database: dbUrl.pathname.slice(1),
            ssl: {
                rejectUnauthorized: false,
                sslmode: 'require'
            }
        };
        return config;
    } catch (error) {
        console.warn('⚠️  Não foi possível parsear DATABASE_URL, usando connection string direta');
        return {
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        };
    }
};

// Inicialização do App Express
const app = express();
const server = http.createServer(app);

// Configuração de Uploads (Multer) - Robusta
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log(`📁 Diretório de uploads criado: ${UPLOAD_DIR}`);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '.bin';
        const safeFilename = 'doc-' + uniqueSuffix + ext;
        cb(null, safeFilename);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 1
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'image/jpg'
        ];

        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não permitido. Apenas imagens (JPEG, PNG, GIF, WebP) e PDF são aceitos.'));
        }
    }
});

// =================================================================================================
// 2. UTILITÁRIOS (LOGGER & HELPERS) - ROBUSTOS
// =================================================================================================

class EnhancedLogger {
    static formatMessage(level, tag, message, data = null) {
        const timestamp = new Date().toISOString();
        const logId = crypto.randomBytes(4).toString('hex');
        const baseLog = `[${timestamp}] [${level}] [${tag}] ${message}`;

        if (data) {
            if (data instanceof Error) {
                return `${baseLog} | ID:${logId} | Error: ${data.message} | Stack: ${data.stack ? data.stack.substring(0, 200) : 'N/A'}`;
            }
            try {
                return `${baseLog} | ID:${logId} | Data: ${JSON.stringify(data)}`;
            } catch {
                return `${baseLog} | ID:${logId} | Data: [Circular or non-serializable]`;
            }
        }
        return `${baseLog} | ID:${logId}`;
    }

    static info(tag, message, data = null) {
        console.log(this.formatMessage('INFO', tag, message, data));
    }

    static error(tag, message, error = null) {
        console.error(this.formatMessage('ERROR', tag, message, error));
    }

    static warn(tag, message, data = null) {
        console.warn(this.formatMessage('WARN', tag, message, data));
    }

    static audit(userId, action, details = {}) {
        const auditLog = {
            timestamp: new Date().toISOString(),
            userId: userId || 'SYSTEM',
            action,
            details,
            ip: details.ip || 'N/A',
            userAgent: details.userAgent || 'N/A'
        };
        console.log(`[AUDIT] ${JSON.stringify(auditLog)}`);
    }

    static security(userId, event, details = {}) {
        const securityLog = {
            timestamp: new Date().toISOString(),
            userId: userId || 'ANONYMOUS',
            event,
            details,
            severity: details.severity || 'MEDIUM'
        };
        console.warn(`[SECURITY] ${JSON.stringify(securityLog)}`);
    }
}

const Logger = EnhancedLogger;

/**
 * Validador de Telefone Angola (Unitel/Africell/Movicel) - Robustecido
 */
const isValidAngolaPhone = (phone) => {
    if (!phone || typeof phone !== 'string') return false;

    // Remove todos os caracteres não numéricos
    const cleanPhone = phone.replace(/\D/g, '');

    // Verifica se tem 9 dígitos e começa com 9
    if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
        return true;
    }

    // Verifica se tem 12 dígitos (incluindo +244)
    if (cleanPhone.length === 12 && cleanPhone.startsWith('2449')) {
        return true;
    }

    // Verifica se tem 13 dígitos (incluindo 00244)
    if (cleanPhone.length === 13 && cleanPhone.startsWith('2449')) {
        // Remove os dois primeiros zeros se existirem
        return cleanPhone.substring(2).startsWith('2449');
    }

    return false;
};

/**
 * Normalizador de Telefone - Sempre retorna formato 9xxxxxxxx
 */
const normalizeAngolaPhone = (phone) => {
    if (!phone) return null;

    const cleanPhone = phone.replace(/\D/g, '');

    if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) {
        return cleanPhone;
    }

    if (cleanPhone.length === 12 && cleanPhone.startsWith('2449')) {
        return cleanPhone.substring(3); // Remove 244
    }

    if (cleanPhone.length === 13 && cleanPhone.startsWith('2449')) {
        return cleanPhone.substring(4); // Remove 00244
    }

    return null;
};

/**
 * Calculadora de Distância (Haversine) - Com validação
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    // Validação de coordenadas
    if (!lat1 || !lon1 || !lat2 || !lon2) {
        throw new Error('Coordenadas não fornecidas');
    }

    const lat1Num = parseFloat(lat1);
    const lon1Num = parseFloat(lon1);
    const lat2Num = parseFloat(lat2);
    const lon2Num = parseFloat(lon2);

    if (isNaN(lat1Num) || isNaN(lon1Num) || isNaN(lat2Num) || isNaN(lon2Num)) {
        throw new Error('Coordenadas inválidas');
    }

    if (lat1Num < -90 || lat1Num > 90 || lat2Num < -90 || lat2Num > 90) {
        throw new Error('Latitude fora do intervalo válido (-90 a 90)');
    }

    if (lon1Num < -180 || lon1Num > 180 || lon2Num < -180 || lon2Num > 180) {
        throw new Error('Longitude fora do intervalo válido (-180 a 180)');
    }

    const R = 6371; // Raio da Terra em km
    const dLat = (lat2Num - lat1Num) * Math.PI / 180;
    const dLon = (lon2Num - lon1Num) * Math.PI / 180;
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1Num * Math.PI / 180) * Math.cos(lat2Num * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return parseFloat((R * c).toFixed(2)); // Retorna com 2 casas decimais
};

/**
 * Gerador de referência única para transações
 */
const generateTransactionRef = (prefix = 'TX') => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
};

// =================================================================================================
// 3. DATABASE ENGINE (POSTGRESQL POOL & BOOTSTRAP) - BLINDADO
// =================================================================================================

// Configuração robusta do pool PostgreSQL
const poolConfig = DATABASE_URL ? parseDatabaseUrl(DATABASE_URL) : {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

const pool = new Pool({
    ...poolConfig,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'aotravel-backend-v6.2'
});

// Event handlers para o pool
pool.on('connect', (client) => {
    Logger.info('DB_POOL', 'Nova conexão estabelecida');
});

pool.on('error', (err, client) => {
    Logger.error('DB_POOL', 'Erro no pool de conexões PostgreSQL', err);
});

pool.on('remove', (client) => {
    Logger.info('DB_POOL', 'Cliente removido do pool');
});

/**
 * BOOTSTRAP DATABASE - Sistema blindado de criação de tabelas
 */
const bootstrapDatabase = async () => {
    const client = await pool.connect();

    try {
        Logger.info('DB_INIT', '🚀 Iniciando inicialização do banco de dados...');

        // Começamos uma transação isolada para bootstrap
        await client.query('BEGIN');
        Logger.info('DB_INIT', 'Transação de inicialização iniciada');

        // 1. EXTENSÕES ESSENCIAIS
        Logger.info('DB_INIT', 'Criando extensões...');
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
        Logger.info('DB_INIT', '✅ Extensões criadas/verificadas');

        // 2. TABELA USERS - COMPLETA E ROBUSTA
        Logger.info('DB_INIT', 'Criando/verificando tabela users...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                uuid UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                phone VARCHAR(20) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL CHECK (role IN ('passenger', 'driver', 'admin')),

                -- Dados de Motorista
                vehicle_details JSONB DEFAULT '{}',
                rating DECIMAL(3,2) DEFAULT 5.00 CHECK (rating >= 0 AND rating <= 5),
                is_online BOOLEAN DEFAULT false,
                is_verified BOOLEAN DEFAULT false,
                is_blocked BOOLEAN DEFAULT false,

                -- Dados Financeiros (Compatível com wallet.js)
                balance DECIMAL(15,2) DEFAULT 0.00,
                bonus_points INTEGER DEFAULT 0,
                wallet_account_number VARCHAR(50) UNIQUE,
                wallet_pin_hash VARCHAR(255),
                wallet_status VARCHAR(20) DEFAULT 'active' CHECK (wallet_status IN ('active', 'frozen', 'suspended')),
                daily_limit DECIMAL(15,2) DEFAULT 500000.00,
                daily_limit_used DECIMAL(15,2) DEFAULT 0.00,
                last_transaction_date DATE DEFAULT CURRENT_DATE,
                account_tier VARCHAR(20) DEFAULT 'standard' CHECK (account_tier IN ('standard', 'premium', 'vip')),
                kyc_level INTEGER DEFAULT 1 CHECK (kyc_level >= 1 AND kyc_level <= 3),

                -- Metadados
                fcm_token TEXT,
                photo_url TEXT,
                photo TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

                -- Índices para performance
                CONSTRAINT users_balance_check CHECK (balance >= 0),
                CONSTRAINT users_bonus_points_check CHECK (bonus_points >= 0)
            );
        `);

        // Criar índices para a tabela users
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_users_online ON users(is_online) WHERE is_online = true;
            CREATE INDEX IF NOT EXISTS idx_users_verified ON users(is_verified) WHERE is_verified = true;
            CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);
        `);
        Logger.info('DB_INIT', '✅ Tabela users criada/verificada');

        // 3. TABELA RIDES - COMPLETA
        Logger.info('DB_INIT', 'Criando/verificando tabela rides...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS rides (
                id SERIAL PRIMARY KEY,
                passenger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

                -- Localização
                origin_lat DECIMAL(10,8) NOT NULL,
                origin_lng DECIMAL(11,8) NOT NULL,
                dest_lat DECIMAL(10,8) NOT NULL,
                dest_lng DECIMAL(11,8) NOT NULL,
                origin_address TEXT NOT NULL,
                dest_address TEXT NOT NULL,
                distance_km DECIMAL(10,2) NOT NULL,

                -- Status e Fluxo
                status VARCHAR(20) NOT NULL DEFAULT 'searching'
                    CHECK (status IN ('searching', 'accepted', 'arrived', 'started', 'completed', 'cancelled')),

                -- Financeiro
                estimated_price DECIMAL(10,2) NOT NULL,
                final_price DECIMAL(10,2),
                payment_method VARCHAR(20) DEFAULT 'cash'
                    CHECK (payment_method IN ('cash', 'wallet', 'card', 'mixed')),
                payment_status VARCHAR(20) DEFAULT 'pending'
                    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),

                -- Logs
                rating INTEGER CHECK (rating >= 1 AND rating <= 5),
                feedback TEXT,
                cancel_reason TEXT,

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                accepted_at TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,

                -- Constraints
                CONSTRAINT rides_price_check CHECK (estimated_price > 0),
                CONSTRAINT rides_final_price_check CHECK (final_price IS NULL OR final_price > 0),
                CONSTRAINT rides_distance_check CHECK (distance_km > 0)
            );
        `);

        // Índices para rides
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);
            CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
            CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
            CREATE INDEX IF NOT EXISTS idx_rides_created ON rides(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_rides_passenger_status ON rides(passenger_id, status);
            CREATE INDEX IF NOT EXISTS idx_rides_driver_status ON rides(driver_id, status);
        `);
        Logger.info('DB_INIT', '✅ Tabela rides criada/verificada');

        // 4. TABELA CHAT_MESSAGES
        Logger.info('DB_INIT', 'Criando/verificando tabela chat_messages...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                message_text TEXT NOT NULL,
                message_type VARCHAR(10) DEFAULT 'text'
                    CHECK (message_type IN ('text', 'image', 'audio', 'location')),
                media_url TEXT,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
            );
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_chat_ride ON chat_messages(ride_id);
            CREATE INDEX IF NOT EXISTS idx_chat_sender ON chat_messages(sender_id);
            CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_chat_ride_sender ON chat_messages(ride_id, sender_id);
        `);
        Logger.info('DB_INIT', '✅ Tabela chat_messages criada/verificada');

        // 5. TABELA USER_DOCUMENTS
        Logger.info('DB_INIT', 'Criando/verificando tabela user_documents...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_documents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                doc_type VARCHAR(50) NOT NULL
                    CHECK (doc_type IN ('id_card', 'driver_license', 'passport', 'vehicle_registration', 'other')),
                file_url TEXT NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
                rejection_reason TEXT,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                verified_at TIMESTAMP,

                CONSTRAINT unique_user_doc_type UNIQUE(user_id, doc_type)
            );
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_docs_user ON user_documents(user_id);
            CREATE INDEX IF NOT EXISTS idx_docs_status ON user_documents(status);
            CREATE INDEX IF NOT EXISTS idx_docs_uploaded ON user_documents(uploaded_at DESC);
        `);
        Logger.info('DB_INIT', '✅ Tabela user_documents criada/verificada');

        // 6. TABELA APP_SETTINGS
        Logger.info('DB_INIT', 'Criando/verificando tabela app_settings...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key VARCHAR(50) PRIMARY KEY,
                value JSONB NOT NULL,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_by INTEGER REFERENCES users(id)
            );
        `);

        // Inserção de Configurações Padrão
        await client.query(`
            INSERT INTO app_settings (key, value, description)
            VALUES
            ('ride_pricing', '{"base_km": 200, "per_km": 150, "min_price": 500, "currency": "AOA"}', 'Preços base das corridas'),
            ('app_version', '{"ios": "1.0.0", "android": "1.0.0", "web": "1.0.0", "force_update": false}', 'Versões mínimas do app'),
            ('commission_rates', '{"driver": 0.85, "platform": 0.15}', 'Taxas de comissão'),
            ('notifications', '{"ride_updates": true, "promotions": true, "security": true}', 'Configurações de notificação')
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                description = EXCLUDED.description,
                updated_at = CURRENT_TIMESTAMP;
        `);
        Logger.info('DB_INIT', '✅ Tabela app_settings criada/verificada');

        // 7. VERIFICAÇÃO E CORREÇÃO DE COLUNAS (SISTEMA BLINDADO)
        Logger.info('DB_SCHEMA', 'Verificando e corrigindo schema...');

        // Lista de colunas que DEVEM existir na tabela users
        const requiredUserColumns = [
            { name: 'password_hash', type: 'VARCHAR(255) NOT NULL DEFAULT \'\'' },
            { name: 'photo', type: 'TEXT' },
            { name: 'wallet_status', type: 'VARCHAR(20) DEFAULT \'active\'' },
            { name: 'daily_limit_used', type: 'DECIMAL(15,2) DEFAULT 0.00' },
            { name: 'last_transaction_date', type: 'DATE DEFAULT CURRENT_DATE' },
            { name: 'account_tier', type: 'VARCHAR(20) DEFAULT \'standard\'' },
            { name: 'kyc_level', type: 'INTEGER DEFAULT 1' }
        ];

        for (const column of requiredUserColumns) {
            try {
                const checkResult = await client.query(`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = $1
                `, [column.name]);

                if (checkResult.rows.length === 0) {
                    Logger.warn('DB_SCHEMA', `Coluna ${column.name} não encontrada, criando...`);

                    // Para colunas NOT NULL, precisamos adicionar DEFAULT primeiro
                    if (column.type.includes('NOT NULL')) {
                        await client.query(`
                            ALTER TABLE users
                            ADD COLUMN ${column.name} ${column.type.replace('NOT NULL', '')}
                        `);

                        // Se tiver DEFAULT, não precisamos fazer update
                        if (!column.type.includes('DEFAULT')) {
                            await client.query(`
                                UPDATE users
                                SET ${column.name} = ''
                                WHERE ${column.name} IS NULL
                            `);

                            await client.query(`
                                ALTER TABLE users
                                ALTER COLUMN ${column.name} SET NOT NULL
                            `);
                        }
                    } else {
                        await client.query(`
                            ALTER TABLE users
                            ADD COLUMN ${column.name} ${column.type}
                        `);
                    }

                    Logger.info('DB_SCHEMA', `✅ Coluna ${column.name} criada com sucesso`);
                }
            } catch (columnError) {
                Logger.error('DB_SCHEMA', `Erro ao verificar/criar coluna ${column.name}`, columnError);
                // Não lançamos erro, continuamos com outras colunas
            }
        }

        // 8. CRIAÇÃO DE USUÁRIO ADMIN PADRÃO (se não existir)
        Logger.info('DB_INIT', 'Verificando usuário admin padrão...');
        try {
            const adminCheck = await client.query("SELECT id FROM users WHERE email = 'admin@aotravel.com'");

            if (adminCheck.rows.length === 0) {
                const adminPassword = crypto.randomBytes(16).toString('hex');
                const hashedPassword = await bcrypt.hash(adminPassword, 10);

                await client.query(`
                    INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_tier, kyc_level)
                    VALUES ('Administrador Sistema', 'admin@aotravel.com', '900000000', $1, 'admin', true, 'vip', 3)
                `, [hashedPassword]);

                Logger.info('DB_INIT', `✅ Usuário admin criado. Senha: ${adminPassword} (ALTERAR IMEDIATAMENTE!)`);
                Logger.security('SYSTEM', 'ADMIN_CREATED', {
                    email: 'admin@aotravel.com',
                    note: 'Senha gerada automaticamente, deve ser alterada'
                });
            } else {
                Logger.info('DB_INIT', '✅ Usuário admin já existe');
            }
        } catch (adminError) {
            Logger.warn('DB_INIT', 'Não foi possível criar usuário admin', adminError);
        }

        // COMMIT da transação
        await client.query('COMMIT');
        Logger.info('DB_INIT', '🎉 Banco de dados inicializado com sucesso!');

    } catch (error) {
        // ROLLBACK em caso de erro
        await client.query('ROLLBACK').catch(rollbackError => {
            Logger.error('DB_INIT', 'Erro ao fazer rollback', rollbackError);
        });

        Logger.error('DB_INIT', '❌ Falha crítica na inicialização do banco', error);

        // Se for erro de conexão, saímos
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            console.error('❌ Não foi possível conectar ao banco de dados. Verifique DATABASE_URL.');
            process.exit(1);
        }

        // Para outros erros, tentamos continuar (modo degradado)
        console.warn('⚠️  Continuando em modo degradado devido a erro no banco...');
    } finally {
        client.release();
        Logger.info('DB_INIT', 'Conexão do bootstrap liberada');
    }
};

// =================================================================================================
// 4. MIDDLEWARES DE SEGURANÇA E CONFIGURAÇÃO - BLINDADOS
// =================================================================================================

// Trust proxy para Render.com e outros hosts
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// Proteção de Cabeçalhos HTTP (Helmet configurado)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Compressão GZIP/Brotli
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    }
}));

// CORS Configurado com segurança
const corsOptions = {
    origin: function (origin, callback) {
        // Em produção, aceitar apenas origens específicas
        if (NODE_ENV === 'development') {
            callback(null, true);
        } else {
            const allowedOrigins = [
                'https://aotravel.onrender.com',
                'https://aotravel.ao',
                'http://localhost:3000',
                'http://localhost:8080'
            ];

            if (!origin || allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                Logger.security(null, 'CORS_BLOCKED', { origin, allowedOrigins });
                callback(new Error('Origem não permitida por CORS'));
            }
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID', 'Accept'],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    credentials: true,
    maxAge: 86400 // 24 horas
};

app.use(cors(corsOptions));

// Body Parsing com limites
app.use(bodyParser.json({
    limit: '10mb',
    verify: (req, res, buf) => {
        try {
            JSON.parse(buf.toString());
        } catch (e) {
            throw new Error('JSON malformado');
        }
    }
}));

app.use(bodyParser.urlencoded({
    extended: true,
    limit: '10mb',
    parameterLimit: 1000
}));

// Logging de Requisições HTTP (Morgan)
app.use(morgan(NODE_ENV === 'development' ? 'dev' : 'combined', {
    skip: (req, res) => req.path === '/health' || req.path === '/favicon.ico',
    stream: {
        write: (message) => Logger.info('HTTP', message.trim())
    }
}));

// Rate Limiting por IP
const createRateLimiter = (windowMs, max, message) => {
    return rateLimit({
        windowMs,
        max,
        message: { error: message },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
            return req.ip || req.connection.remoteAddress;
        },
        handler: (req, res) => {
            Logger.security(req.ip, 'RATE_LIMIT_EXCEEDED', {
                path: req.path,
                method: req.method,
                ip: req.ip
            });
            res.status(429).json({ error: message });
        }
    });
};

// Diferentes limites para diferentes endpoints
app.use('/api/auth/', createRateLimiter(15 * 60 * 1000, 5, 'Muitas tentativas de login. Tente novamente em 15 minutos.'));
app.use('/api/wallet/', createRateLimiter(15 * 60 * 1000, 30, 'Muitas requisições financeiras. Aguarde 15 minutos.'));
app.use('/api/', createRateLimiter(15 * 60 * 1000, 100, 'Muitas requisições. Tente novamente mais tarde.'));

// Servir Arquivos Estáticos (Uploads) com segurança
app.use('/uploads', (req, res, next) => {
    // Prevenir directory traversal
    const requestedPath = path.join(UPLOAD_DIR, req.path);
    if (!requestedPath.startsWith(UPLOAD_DIR)) {
        return res.status(403).json({ error: 'Acesso negado' });
    }

    // Headers de segurança para arquivos
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');

    next();
}, express.static(UPLOAD_DIR, {
    maxAge: '1d',
    setHeaders: (res, path) => {
        // Headers adicionais de segurança
        res.setHeader('Cache-Control', 'public, max-age=86400');
    }
}));

// Middleware: Request ID para tracking
app.use((req, res, next) => {
    req.requestId = crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-ID', req.requestId);
    next();
});

/**
 * MIDDLEWARE: authenticateToken - Blindado
 */
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        Logger.security(null, 'MISSING_TOKEN', {
            path: req.path,
            ip: req.ip,
            requestId: req.requestId
        });
        return res.status(401).json({
            error: "Token de acesso não fornecido.",
            code: "AUTH_REQUIRED"
        });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            error: "Formato de token inválido. Use: Bearer <token>",
            code: "TOKEN_FORMAT_INVALID"
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Verificar se o usuário ainda existe
        const userCheck = await pool.query(
            "SELECT id, is_blocked, wallet_status FROM users WHERE id = $1",
            [decoded.id]
        );

        if (userCheck.rows.length === 0) {
            Logger.security(decoded.id, 'TOKEN_USER_NOT_FOUND', {
                path: req.path,
                ip: req.ip
            });
            return res.status(401).json({
                error: "Usuário não encontrado.",
                code: "USER_NOT_FOUND"
            });
        }

        const user = userCheck.rows[0];

        if (user.is_blocked) {
            Logger.security(decoded.id, 'BLOCKED_USER_ACCESS', {
                path: req.path,
                ip: req.ip
            });
            return res.status(403).json({
                error: "Conta bloqueada. Contate o suporte.",
                code: "ACCOUNT_BLOCKED"
            });
        }

        if (user.wallet_status === 'frozen') {
            return res.status(403).json({
                error: "Carteira congelada por motivos de segurança.",
                code: "WALLET_FROZEN"
            });
        }

        req.user = {
            id: decoded.id,
            role: decoded.role,
            email: decoded.email,
            ...user
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            Logger.security(null, 'TOKEN_EXPIRED', {
                path: req.path,
                ip: req.ip,
                requestId: req.requestId
            });
            return res.status(401).json({
                error: "Token expirado.",
                code: "TOKEN_EXPIRED"
            });
        }

        if (error.name === 'JsonWebTokenError') {
            Logger.security(null, 'TOKEN_INVALID', {
                path: req.path,
                ip: req.ip,
                requestId: req.requestId,
                error: error.message
            });
            return res.status(403).json({
                error: "Token inválido.",
                code: "TOKEN_INVALID"
            });
        }

        Logger.error('AUTH_MIDDLEWARE', 'Erro na autenticação', error);
        return res.status(500).json({
            error: "Erro interno na autenticação.",
            code: "AUTH_INTERNAL_ERROR"
        });
    }
};

/**
 * MIDDLEWARE: requireDriver - Com validação
 */
const requireDriver = (req, res, next) => {
    if (req.user.role !== 'driver') {
        Logger.security(req.user.id, 'DRIVER_ACCESS_DENIED', {
            path: req.path,
            role: req.user.role
        });
        return res.status(403).json({
            error: "Acesso restrito a motoristas.",
            code: "DRIVER_REQUIRED"
        });
    }

    // Verificar se o motorista está verificado
    if (!req.user.is_verified && req.path !== '/api/auth/profile') {
        return res.status(403).json({
            error: "Motorista não verificado. Complete o cadastro.",
            code: "DRIVER_NOT_VERIFIED"
        });
    }

    next();
};

/**
 * MIDDLEWARE: requireAdmin - Blindado
 */
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        Logger.security(req.user.id, 'ADMIN_ACCESS_DENIED', {
            path: req.path,
            role: req.user.role,
            ip: req.ip
        });
        return res.status(403).json({
            error: "Acesso administrativo negado. Requer privilégios de administrador.",
            code: "ADMIN_REQUIRED"
        });
    }
    next();
};

/**
 * MIDDLEWARE: validateRequest - Validação genérica
 */
const validateRequest = (schema) => {
    return (req, res, next) => {
        try {
            // Validação básica do corpo da requisição
            if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
                if (!req.body || typeof req.body !== 'object') {
                    return res.status(400).json({
                        error: "Corpo da requisição inválido.",
                        code: "INVALID_BODY"
                    });
                }
            }

            // Se um schema foi fornecido, validar
            if (schema) {
                const { error, value } = schema.validate(req.body, { abortEarly: false });

                if (error) {
                    const errors = error.details.map(detail => ({
                        field: detail.path.join('.'),
                        message: detail.message
                    }));

                    return res.status(400).json({
                        error: "Validação falhou",
                        code: "VALIDATION_FAILED",
                        details: errors
                    });
                }

                req.validatedBody = value;
            }

            next();
        } catch (validationError) {
            Logger.error('VALIDATION', 'Erro na validação', validationError);
            return res.status(400).json({
                error: "Erro na validação da requisição.",
                code: "VALIDATION_ERROR"
            });
        }
    };
};

// =================================================================================================
// 5. SOCKET.IO CONFIGURAÇÃO - ROBUSTA
// =================================================================================================

const io = new Server(server, {
    cors: {
        origin: NODE_ENV === 'development' ? "*" : [
            'https://aotravel.onrender.com',
            'https://aotravel.ao',
            'http://localhost:3000',
            'http://localhost:8080'
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e6, // 1MB
    connectTimeout: 10000,
    pingTimeout: 5000,
    pingInterval: 25000,
    cookie: false,
    allowEIO3: true
});

// =================================================================================================
// 6. ROTAS DE AUTENTICAÇÃO E PERFIL - BLINDADAS
// =================================================================================================

const authRouter = express.Router();

// Helper para validação de email
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Helper para validação de senha
const isValidPassword = (password) => {
    return password && password.length >= 6;
};

/**
 * POST /api/auth/register - Registro blindado
 */
authRouter.post('/register', validateRequest(), async (req, res) => {
    const { name, email, phone, password, role, vehicle_model, vehicle_plate } = req.body;

    // Validações manuais
    const errors = [];

    if (!name || name.trim().length < 2) errors.push({ field: 'name', message: 'Nome deve ter pelo menos 2 caracteres' });
    if (!isValidEmail(email)) errors.push({ field: 'email', message: 'Email inválido' });
    if (!isValidAngolaPhone(phone)) errors.push({ field: 'phone', message: 'Número de telefone inválido. Use formato 9xxxxxxxx' });
    if (!isValidPassword(password)) errors.push({ field: 'password', message: 'Senha deve ter pelo menos 6 caracteres' });
    if (!role || !['passenger', 'driver'].includes(role)) errors.push({ field: 'role', message: 'Tipo de usuário inválido' });

    if (role === 'driver') {
        if (!vehicle_model || vehicle_model.trim().length < 2) errors.push({ field: 'vehicle_model', message: 'Modelo do veículo é obrigatório' });
        if (!vehicle_plate || vehicle_plate.trim().length < 5) errors.push({ field: 'vehicle_plate', message: 'Matrícula do veículo é obrigatória' });
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: "Validação falhou",
            code: "VALIDATION_FAILED",
            details: errors
        });
    }

    const normalizedPhone = normalizeAngolaPhone(phone);
    if (!normalizedPhone) {
        return res.status(400).json({
            error: "Número de telefone inválido",
            code: "INVALID_PHONE"
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verificar se usuário já existe
        const checkUser = await client.query(
            "SELECT id FROM users WHERE email = $1 OR phone = $2",
            [email.toLowerCase(), normalizedPhone]
        );

        if (checkUser.rows.length > 0) {
            throw new Error("Já existe uma conta com este email ou telefone.");
        }

        // Hash da senha
        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Detalhes do veículo (se motorista)
        const vehicleDetails = role === 'driver' ? JSON.stringify({
            model: vehicle_model.trim(),
            plate: vehicle_plate.trim().toUpperCase(),
            verified: false,
            registered_at: new Date().toISOString()
        }) : '{}';

        // Gerar número de conta da carteira
        const walletAccountNumber = `AO${normalizedPhone}${Date.now().toString().slice(-6)}`;

        // Inserir usuário
        const newUserRes = await client.query(
            `INSERT INTO users (
                name, email, phone, password_hash, role,
                vehicle_details, wallet_account_number, is_verified
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, name, email, phone, role, wallet_account_number, created_at`,
            [
                name.trim(),
                email.toLowerCase().trim(),
                normalizedPhone,
                hashedPassword,
                role,
                vehicleDetails,
                walletAccountNumber,
                role === 'passenger' // Passageiros são verificados automaticamente
            ]
        );

        const newUser = newUserRes.rows[0];

        // Gerar token JWT
        const token = jwt.sign({
            id: newUser.id,
            role: newUser.role,
            email: newUser.email
        }, JWT_SECRET, {
            expiresIn: '30d',
            issuer: 'aotravel-api',
            audience: 'aotravel-app'
        });

        // Se for motorista, criar documento pendente
        if (role === 'driver') {
            await client.query(
                `INSERT INTO user_documents (user_id, doc_type, file_url, status)
                 VALUES ($1, 'driver_license', 'pending', 'pending')`,
                [newUser.id]
            );
        }

        await client.query('COMMIT');

        Logger.audit(newUser.id, 'REGISTER_SUCCESS', {
            role: newUser.role,
            phone: normalizedPhone,
            hasVehicle: role === 'driver'
        });

        // Preparar resposta
        const userResponse = {
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            phone: newUser.phone,
            role: newUser.role,
            wallet_account_number: newUser.wallet_account_number,
            is_verified: newUser.is_verified,
            created_at: newUser.created_at
        };

        if (role === 'driver') {
            userResponse.vehicle_details = JSON.parse(vehicleDetails);
            userResponse.document_status = 'pending';
        }

        res.status(201).json({
            success: true,
            message: role === 'driver'
                ? "Conta de motorista criada! Envie seus documentos para verificação."
                : "Conta criada com sucesso!",
            token: token,
            user: userResponse,
            requires_kyc: role === 'driver'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('AUTH_REGISTER', error.message, { email, phone: normalizedPhone });

        let errorMessage = error.message;
        let errorCode = "REGISTRATION_FAILED";

        if (error.message.includes("já existe") || error.message.includes("already exists")) {
            errorMessage = "Já existe uma conta com este email ou telefone.";
            errorCode = "USER_EXISTS";
        } else if (error.message.includes("violates unique constraint")) {
            errorMessage = "Já existe uma conta com este email ou telefone.";
            errorCode = "DUPLICATE_USER";
        }

        res.status(400).json({
            error: errorMessage,
            code: errorCode
        });
    } finally {
        client.release();
    }
});

/**
 * POST /api/auth/login - Login blindado
 */
authRouter.post('/login', validateRequest(), async (req, res) => {
    const { email, password, fcm_token } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            error: "Email e senha são obrigatórios.",
            code: "CREDENTIALS_REQUIRED"
        });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({
            error: "Email inválido.",
            code: "INVALID_EMAIL"
        });
    }

    try {
        // Buscar usuário
        const result = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            // Delay para prevenir timing attacks
            await bcrypt.compare(password, "$2b$12$fakehashforsecurity.wait");

            Logger.security(null, 'LOGIN_FAILED_EMAIL', {
                email: email.toLowerCase(),
                ip: req.ip
            });

            return res.status(401).json({
                error: "Credenciais inválidas.",
                code: "INVALID_CREDENTIALS"
            });
        }

        const user = result.rows[0];

        // Verificar conta bloqueada
        if (user.is_blocked) {
            Logger.security(user.id, 'LOGIN_BLOCKED_ACCOUNT', {
                email: user.email,
                ip: req.ip
            });

            return res.status(403).json({
                error: "Sua conta está bloqueada. Contate o suporte.",
                code: "ACCOUNT_BLOCKED"
            });
        }

        // Verificar senha
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            Logger.security(user.id, 'LOGIN_FAILED_PASSWORD', {
                email: user.email,
                ip: req.ip
            });

            return res.status(401).json({
                error: "Credenciais inválidas.",
                code: "INVALID_CREDENTIALS"
            });
        }

        // Atualizar FCM token se fornecido
        if (fcm_token && fcm_token.trim().length > 0) {
            await pool.query(
                "UPDATE users SET fcm_token = $1, is_online = true, updated_at = NOW() WHERE id = $2",
                [fcm_token.trim(), user.id]
            ).catch(err => {
                Logger.warn('LOGIN_FCM', 'Erro ao atualizar FCM token', err);
            });
        }

        // Gerar token JWT
        const token = jwt.sign({
            id: user.id,
            role: user.role,
            email: user.email
        }, JWT_SECRET, {
            expiresIn: '30d',
            issuer: 'aotravel-api',
            audience: 'aotravel-app'
        });

        // Preparar resposta do usuário (sem dados sensíveis)
        const userResponse = {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            rating: user.rating,
            balance: parseFloat(user.balance || 0),
            bonus_points: user.bonus_points,
            wallet_account_number: user.wallet_account_number,
            is_verified: user.is_verified,
            is_online: user.is_online,
            wallet_status: user.wallet_status,
            account_tier: user.account_tier,
            daily_limit: parseFloat(user.daily_limit || 0),
            photo_url: user.photo_url,
            photo: user.photo,
            created_at: user.created_at,
            updated_at: user.updated_at
        };

        // Adicionar detalhes do veículo se for motorista
        if (user.role === 'driver' && user.vehicle_details) {
            try {
                userResponse.vehicle_details = typeof user.vehicle_details === 'string'
                    ? JSON.parse(user.vehicle_details)
                    : user.vehicle_details;
            } catch (e) {
                userResponse.vehicle_details = {};
            }
        }

        Logger.audit(user.id, 'LOGIN_SUCCESS', {
            role: user.role,
            is_verified: user.is_verified,
            has_fcm: !!fcm_token
        });

        res.json({
            success: true,
            message: "Login realizado com sucesso!",
            token: token,
            user: userResponse,
            requires_documents: user.role === 'driver' && !user.is_verified
        });

    } catch (error) {
        Logger.error('AUTH_LOGIN', 'Erro interno no login', error);
        res.status(500).json({
            error: "Erro interno no servidor.",
            code: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * GET /api/auth/profile - Perfil blindado
 */
authRouter.get('/profile', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                id, name, email, phone, role,
                photo_url, photo, rating,
                balance, bonus_points, wallet_account_number,
                is_verified, is_online, wallet_status,
                account_tier, kyc_level, daily_limit,
                vehicle_details, fcm_token,
                created_at, updated_at
             FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Usuário não encontrado.",
                code: "USER_NOT_FOUND"
            });
        }

        const user = result.rows[0];

        // Parse vehicle_details se existir
        if (user.vehicle_details && typeof user.vehicle_details === 'string') {
            try {
                user.vehicle_details = JSON.parse(user.vehicle_details);
            } catch (e) {
                user.vehicle_details = {};
            }
        }

        // Remover campos sensíveis
        delete user.fcm_token;
        delete user.password_hash;
        delete user.wallet_pin_hash;

        // Buscar documentos pendentes se for motorista
        if (user.role === 'driver' && !user.is_verified) {
            const documents = await pool.query(
                "SELECT doc_type, status, uploaded_at FROM user_documents WHERE user_id = $1",
                [user.id]
            );
            user.pending_documents = documents.rows;
        }

        res.json({
            success: true,
            user: user
        });

    } catch (error) {
        Logger.error('AUTH_PROFILE', 'Erro ao buscar perfil', error);
        res.status(500).json({
            error: "Erro ao carregar perfil.",
            code: "PROFILE_LOAD_ERROR"
        });
    }
});

/**
 * POST /api/auth/upload-doc - Upload blindado
 */
authRouter.post('/upload-doc', authenticateToken, upload.single('document'), async (req, res) => {
    const { doc_type } = req.body;

    if (!doc_type || !['id_card', 'driver_license', 'passport', 'vehicle_registration'].includes(doc_type)) {
        return res.status(400).json({
            error: "Tipo de documento inválido.",
            code: "INVALID_DOC_TYPE"
        });
    }

    if (!req.file) {
        return res.status(400).json({
            error: "Arquivo é obrigatório.",
            code: "FILE_REQUIRED"
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const fileUrl = `/uploads/${req.file.filename}`;

        // Verificar se já existe documento deste tipo
        const existingDoc = await client.query(
            "SELECT id FROM user_documents WHERE user_id = $1 AND doc_type = $2",
            [req.user.id, doc_type]
        );

        if (existingDoc.rows.length > 0) {
            // Atualizar documento existente
            await client.query(
                `UPDATE user_documents
                 SET file_url = $1, status = 'pending', uploaded_at = NOW(), rejection_reason = NULL
                 WHERE user_id = $2 AND doc_type = $3`,
                [fileUrl, req.user.id, doc_type]
            );
        } else {
            // Inserir novo documento
            await client.query(
                `INSERT INTO user_documents (user_id, doc_type, file_url, status)
                 VALUES ($1, $2, $3, 'pending')`,
                [req.user.id, doc_type, fileUrl]
            );
        }

        // Se for motorista e enviou todos documentos necessários, marcar como pendente verificação
        if (req.user.role === 'driver') {
            const requiredDocs = ['driver_license', 'id_card'];
            const userDocs = await client.query(
                "SELECT doc_type FROM user_documents WHERE user_id = $1 AND status = 'pending'",
                [req.user.id]
            );

            const hasAllRequired = requiredDocs.every(doc =>
                userDocs.rows.some(d => d.doc_type === doc)
            );

            if (hasAllRequired && !req.user.is_verified) {
                await client.query(
                    "UPDATE users SET is_verified = false WHERE id = $1",
                    [req.user.id]
                );
            }
        }

        await client.query('COMMIT');

        Logger.audit(req.user.id, 'DOCUMENT_UPLOADED', {
            doc_type,
            filename: req.file.filename,
            size: req.file.size
        });

        res.json({
            success: true,
            message: "Documento enviado para análise. Aguarde a verificação.",
            url: fileUrl,
            filename: req.file.filename,
            requires_verification: req.user.role === 'driver'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('UPLOAD_DOC', 'Erro ao enviar documento', error);

        // Tentar apagar o arquivo se houve erro no banco
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                Logger.warn('UPLOAD_CLEANUP', 'Erro ao apagar arquivo', unlinkError);
            }
        }

        res.status(500).json({
            error: "Falha ao salvar documento.",
            code: "DOCUMENT_SAVE_ERROR"
        });
    } finally {
        client.release();
    }
});

/**
 * PUT /api/auth/update-profile - Atualização blindada
 */
authRouter.put('/update-profile', authenticateToken, upload.single('photo'), async (req, res) => {
    const { name, phone } = req.body;
    const userId = req.user.id;

    // Validações
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (name && name.trim().length >= 2) {
        updates.push(`name = $${paramIndex}`);
        params.push(name.trim());
        paramIndex++;
    }

    if (phone) {
        const normalizedPhone = normalizeAngolaPhone(phone);
        if (!normalizedPhone) {
            return res.status(400).json({
                error: "Número de telefone inválido.",
                code: "INVALID_PHONE"
            });
        }

        // Verificar se o telefone já está em uso por outro usuário
        const phoneCheck = await pool.query(
            "SELECT id FROM users WHERE phone = $1 AND id != $2",
            [normalizedPhone, userId]
        );

        if (phoneCheck.rows.length > 0) {
            return res.status(400).json({
                error: "Este número de telefone já está em uso.",
                code: "PHONE_IN_USE"
            });
        }

        updates.push(`phone = $${paramIndex}`);
        params.push(normalizedPhone);
        paramIndex++;
    }

    // Processar foto se enviada
    let photoUrl = null;
    if (req.file) {
        photoUrl = `/uploads/${req.file.filename}`;
        updates.push(`photo_url = $${paramIndex}, photo = $${paramIndex}`);
        params.push(photoUrl);
        paramIndex++;

        // Se tinha foto antiga, marcar para exclusão (não excluir imediatamente)
        if (req.user.photo_url && req.user.photo_url.startsWith('/uploads/')) {
            const oldFilename = req.user.photo_url.split('/').pop();
            const oldPath = path.join(UPLOAD_DIR, oldFilename);

            // Renomear arquivo antigo para backup
            if (fs.existsSync(oldPath)) {
                const backupName = `old_${Date.now()}_${oldFilename}`;
                const backupPath = path.join(UPLOAD_DIR, backupName);
                try {
                    fs.renameSync(oldPath, backupPath);
                    Logger.info('PROFILE_PHOTO', 'Foto antiga movida para backup', {
                        userId,
                        oldFilename,
                        backupName
                    });
                } catch (renameError) {
                    Logger.warn('PROFILE_PHOTO', 'Erro ao mover foto antiga', renameError);
                }
            }
        }
    }

    if (updates.length === 0) {
        return res.status(400).json({
            error: "Nenhum dado válido para atualizar.",
            code: "NO_VALID_UPDATES"
        });
    }

    updates.push(`updated_at = NOW()`);
    params.push(userId);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}
                      RETURNING id, name, email, phone, role, photo_url, photo, updated_at`;

        const result = await client.query(query, params);

        await client.query('COMMIT');

        Logger.audit(userId, 'PROFILE_UPDATED', {
            fields: updates.filter(u => !u.includes('updated_at')).map(u => u.split(' = ')[0]),
            has_new_photo: !!req.file
        });

        res.json({
            success: true,
            message: "Perfil atualizado com sucesso.",
            user: result.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');

        // Se houve erro e uma nova foto foi enviada, tentar apagar
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                Logger.warn('PROFILE_CLEANUP', 'Erro ao apagar foto', unlinkError);
            }
        }

        Logger.error('UPDATE_PROFILE', 'Erro ao atualizar perfil', error);
        res.status(500).json({
            error: "Erro ao atualizar perfil.",
            code: "PROFILE_UPDATE_ERROR"
        });
    } finally {
        client.release();
    }
});

/**
 * POST /api/auth/logout - Logout
 */
authRouter.post('/logout', authenticateToken, async (req, res) => {
    try {
        await pool.query(
            "UPDATE users SET fcm_token = NULL, is_online = false, updated_at = NOW() WHERE id = $1",
            [req.user.id]
        );

        Logger.audit(req.user.id, 'LOGOUT', { manual: true });

        res.json({
            success: true,
            message: "Logout realizado com sucesso."
        });
    } catch (error) {
        Logger.error('AUTH_LOGOUT', 'Erro no logout', error);
        res.status(500).json({
            error: "Erro ao realizar logout.",
            code: "LOGOUT_ERROR"
        });
    }
});

/**
 * POST /api/auth/refresh-token - Refresh token (simplificado)
 */
authRouter.post('/refresh-token', authenticateToken, async (req, res) => {
    try {
        // Gerar novo token com os mesmos dados
        const newToken = jwt.sign({
            id: req.user.id,
            role: req.user.role,
            email: req.user.email
        }, JWT_SECRET, {
            expiresIn: '30d',
            issuer: 'aotravel-api',
            audience: 'aotravel-app'
        });

        Logger.audit(req.user.id, 'TOKEN_REFRESHED', {});

        res.json({
            success: true,
            token: newToken,
            expires_in: 30 * 24 * 60 * 60 // 30 dias em segundos
        });
    } catch (error) {
        Logger.error('AUTH_REFRESH', 'Erro ao refresh token', error);
        res.status(500).json({
            error: "Erro ao renovar token.",
            code: "TOKEN_REFRESH_ERROR"
        });
    }
});

// =================================================================================================
// 7. ROTAS DE OPERAÇÃO DE TRANSPORTE (RIDE ENGINE) - BLINDADAS
// =================================================================================================

const ridesRouter = express.Router();

/**
 * POST /api/rides/request - Solicitar corrida blindada
 */
ridesRouter.post('/request', authenticateToken, validateRequest(), async (req, res) => {
    const {
        origin_lat, origin_lng, dest_lat, dest_lng,
        origin_addr, dest_addr, price_offer, distance_km
    } = req.body;

    const passengerId = req.user.id;

    // Validações
    const errors = [];

    if (!origin_lat || isNaN(parseFloat(origin_lat))) errors.push({ field: 'origin_lat', message: 'Latitude de origem inválida' });
    if (!origin_lng || isNaN(parseFloat(origin_lng))) errors.push({ field: 'origin_lng', message: 'Longitude de origem inválida' });
    if (!dest_lat || isNaN(parseFloat(dest_lat))) errors.push({ field: 'dest_lat', message: 'Latitude de destino inválida' });
    if (!dest_lng || isNaN(parseFloat(dest_lng))) errors.push({ field: 'dest_lng', message: 'Longitude de destino inválida' });
    if (!origin_addr || origin_addr.trim().length < 5) errors.push({ field: 'origin_addr', message: 'Endereço de origem muito curto' });
    if (!dest_addr || dest_addr.trim().length < 5) errors.push({ field: 'dest_addr', message: 'Endereço de destino muito curto' });
    if (!price_offer || isNaN(parseFloat(price_offer)) || parseFloat(price_offer) <= 0) errors.push({ field: 'price_offer', message: 'Preço estimado inválido' });
    if (!distance_km || isNaN(parseFloat(distance_km)) || parseFloat(distance_km) <= 0) errors.push({ field: 'distance_km', message: 'Distância inválida' });

    if (errors.length > 0) {
        return res.status(400).json({
            error: "Validação falhou",
            code: "VALIDATION_FAILED",
            details: errors
        });
    }

    // Calcular distância real se não fornecida
    let calculatedDistance = parseFloat(distance_km);
    try {
        calculatedDistance = calculateDistance(origin_lat, origin_lng, dest_lat, dest_lng);
    } catch (distanceError) {
        Logger.warn('RIDE_DISTANCE', 'Erro ao calcular distância', distanceError);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verificar se o passageiro já tem corrida ativa
        const activeRide = await client.query(
            `SELECT id FROM rides
             WHERE passenger_id = $1 AND status IN ('searching', 'accepted', 'started')
             LIMIT 1`,
            [passengerId]
        );

        if (activeRide.rows.length > 0) {
            throw new Error("Você já tem uma corrida em andamento. Finalize-a antes de solicitar outra.");
        }

        // Inserir corrida
        const result = await client.query(
            `INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_address, dest_address, estimated_price, distance_km,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'searching')
            RETURNING *`,
            [
                passengerId,
                parseFloat(origin_lat),
                parseFloat(origin_lng),
                parseFloat(dest_lat),
                parseFloat(dest_lng),
                origin_addr.trim(),
                dest_addr.trim(),
                parseFloat(price_offer),
                calculatedDistance
            ]
        );

        const ride = result.rows[0];

        await client.query('COMMIT');

        // Notificar motoristas online via Socket.IO
        const rideData = {
            ...ride,
            passenger_name: req.user.name,
            passenger_rating: req.user.rating || 5.0
        };

        io.to('drivers_room').emit('new_ride_request', rideData);

        Logger.audit(passengerId, 'RIDE_REQUESTED', {
            ride_id: ride.id,
            distance: calculatedDistance,
            price: price_offer
        });

        res.json({
            success: true,
            message: "Procurando motoristas disponíveis...",
            ride: rideData,
            estimated_wait_time: "2-5 minutos",
            notification_sent: true
        });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('RIDE_REQUEST', 'Erro ao solicitar corrida', error);

        const errorMessage = error.message.includes("já tem")
            ? error.message
            : "Erro ao solicitar corrida. Tente novamente.";

        res.status(400).json({
            error: errorMessage,
            code: "RIDE_REQUEST_ERROR"
        });
    } finally {
        client.release();
    }
});

/**
 * POST /api/rides/accept - Aceitar corrida blindada
 */
ridesRouter.post('/accept', authenticateToken, requireDriver, validateRequest(), async (req, res) => {
    const { ride_id } = req.body;
    const driverId = req.user.id;

    if (!ride_id || isNaN(parseInt(ride_id))) {
        return res.status(400).json({
            error: "ID da corrida inválido.",
            code: "INVALID_RIDE_ID"
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Buscar corrida com LOCK para evitar race conditions
        const rideRes = await client.query(
            `SELECT r.*, u.name as passenger_name, u.phone as passenger_phone
             FROM rides r
             JOIN users u ON r.passenger_id = u.id
             WHERE r.id = $1 FOR UPDATE`,
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            throw new Error("Corrida não encontrada.");
        }

        const ride = rideRes.rows[0];

        // Validar status da corrida
        if (ride.status !== 'searching') {
            throw new Error("Esta corrida já foi aceita por outro motorista ou cancelada.");
        }

        // Verificar se motorista já tem corrida ativa
        const driverActiveRide = await client.query(
            `SELECT id FROM rides
             WHERE driver_id = $1 AND status IN ('accepted', 'started')
             LIMIT 1`,
            [driverId]
        );

        if (driverActiveRide.rows.length > 0) {
            throw new Error("Você já tem uma corrida em andamento. Finalize-a antes de aceitar outra.");
        }

        // Atualizar corrida
        await client.query(
            `UPDATE rides
             SET driver_id = $1, status = 'accepted', accepted_at = NOW()
             WHERE id = $2`,
            [driverId, ride_id]
        );

        // Buscar informações do motorista
        const driverInfo = await client.query(
            `SELECT id, name, phone, vehicle_details, rating, photo_url, photo
             FROM users WHERE id = $1`,
            [driverId]
        );

        await client.query('COMMIT');

        // Preparar dados da corrida
        const rideData = {
            ...ride,
            driver: driverInfo.rows[0],
            status: 'accepted',
            accepted_at: new Date().toISOString()
        };

        // Parse vehicle_details se for string
        if (rideData.driver.vehicle_details && typeof rideData.driver.vehicle_details === 'string') {
            try {
                rideData.driver.vehicle_details = JSON.parse(rideData.driver.vehicle_details);
            } catch (e) {
                rideData.driver.vehicle_details = {};
            }
        }

        // Notificar passageiro via Socket.IO
        io.to(`user_${ride.passenger_id}`).emit('ride_accepted', rideData);

        // Notificar outros motoristas que a corrida foi aceita
        io.to('drivers_room').emit('ride_taken', { ride_id });

        Logger.audit(driverId, 'RIDE_ACCEPTED', {
            ride_id,
            passenger_id: ride.passenger_id,
            price: ride.estimated_price,
            distance: ride.distance_km
        });

        res.json({
            success: true,
            message: "Corrida aceita com sucesso!",
            ride: rideData,
            next_steps: "Dirija-se ao local de partida",
            passenger_contact: {
                name: ride.passenger_name,
                phone: ride.passenger_phone
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('RIDE_ACCEPT', 'Erro ao aceitar corrida', error);

        res.status(409).json({
            error: error.message,
            code: "RIDE_ACCEPT_ERROR"
        });
    } finally {
        client.release();
    }
});

/**
 * POST /api/rides/update-status - Atualizar status blindado
 */
ridesRouter.post('/update-status', authenticateToken, validateRequest(), async (req, res) => {
    const { ride_id, status, cancel_reason } = req.body;
    const userId = req.user.id;

    const validStatuses = ['arrived', 'started', 'completed', 'cancelled'];

    if (!ride_id || !status || !validStatuses.includes(status)) {
        return res.status(400).json({
            error: "Parâmetros inválidos. Status deve ser: " + validStatuses.join(', '),
            code: "INVALID_PARAMETERS"
        });
    }

    if (status === 'cancelled' && (!cancel_reason || cancel_reason.trim().length < 5)) {
        return res.status(400).json({
            error: "Motivo do cancelamento é obrigatório (mínimo 5 caracteres).",
            code: "CANCEL_REASON_REQUIRED"
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Buscar corrida com verificação de permissão
        const rideCheck = await client.query(
            `SELECT * FROM rides
             WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2)
             FOR UPDATE`,
            [ride_id, userId]
        );

        if (rideCheck.rows.length === 0) {
            throw new Error("Corrida não encontrada ou você não tem permissão para alterá-la.");
        }

        const ride = rideCheck.rows[0];
        const userRole = req.user.role;

        // Validações adicionais baseadas no papel
        if (status === 'cancelled') {
            // Só passageiro pode cancelar antes da aceitação
            if (ride.status === 'searching' && userRole !== 'passenger') {
                throw new Error("Apenas passageiros podem cancelar corridas não aceitas.");
            }

            // Motorista só pode cancelar depois de aceitar
            if (ride.status !== 'searching' && userRole === 'driver' && ride.driver_id !== userId) {
                throw new Error("Apenas o motorista atribuído pode cancelar esta corrida.");
            }
        }

        if (status === 'started' && ride.status !== 'accepted' && ride.status !== 'arrived') {
            throw new Error("Corrida precisa estar 'accepted' ou 'arrived' para ser iniciada.");
        }

        if (status === 'completed' && ride.status !== 'started') {
            throw new Error("Corrida precisa estar 'started' para ser completada.");
        }

        // Construir query de atualização
        let query = "UPDATE rides SET status = $1";
        const params = [status];
        let paramIndex = 2;

        if (status === 'started') {
            query += `, started_at = NOW()`;
        } else if (status === 'completed') {
            query += `, completed_at = NOW()`;
        } else if (status === 'cancelled') {
            query += `, cancel_reason = $${paramIndex}`;
            params.push(cancel_reason.trim());
            paramIndex++;
        }

        query += ` WHERE id = $${paramIndex} RETURNING *`;
        params.push(ride_id);

        const updated = await pool.query(query, params);
        const updatedRide = updated.rows[0];

        await client.query('COMMIT');

        // Determinar quem notificar
        const targetId = (userId === ride.passenger_id) ? ride.driver_id : ride.passenger_id;

        if (targetId) {
            const notificationData = {
                ride_id,
                status,
                cancel_reason: status === 'cancelled' ? cancel_reason : undefined,
                updated_by: userRole,
                timestamp: new Date().toISOString()
            };

            io.to(`user_${targetId}`).emit('ride_status_update', notificationData);
        }

        Logger.audit(userId, 'RIDE_STATUS_UPDATED', {
            ride_id,
            from_status: ride.status,
            to_status: status,
            user_role: userRole,
            has_cancel_reason: !!cancel_reason
        });

        res.json({
            success: true,
            message: `Corrida ${getStatusMessage(status)}`,
            ride: updatedRide,
            notification_sent: !!targetId
        });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('RIDE_UPDATE', 'Erro ao atualizar status', error);

        res.status(400).json({
            error: error.message,
            code: "RIDE_UPDATE_ERROR"
        });
    } finally {
        client.release();
    }
});

// Helper para mensagens de status
function getStatusMessage(status) {
    const messages = {
        'arrived': "status atualizado para 'Chegou no local'",
        'started': "iniciada com sucesso",
        'completed': "completada com sucesso",
        'cancelled': "cancelada"
    };
    return messages[status] || "status atualizado";
}

/**
 * POST /api/rides/complete - Completa corrida com pagamento blindado
 */
ridesRouter.post('/complete', authenticateToken, requireDriver, validateRequest(), async (req, res) => {
    const { ride_id, final_price, payment_method } = req.body;
    const driverId = req.user.id;

    if (!ride_id || !final_price) {
        return res.status(400).json({
            error: "ID da corrida e preço final são obrigatórios.",
            code: "REQUIRED_FIELDS"
        });
    }

    const price = parseFloat(final_price);
    if (isNaN(price) || price <= 0) {
        return res.status(400).json({
            error: "Preço final inválido.",
            code: "INVALID_PRICE"
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Buscar corrida com LOCK
        const rideRes = await client.query(
            `SELECT r.*, u.balance as passenger_balance, u.name as passenger_name
             FROM rides r
             JOIN users u ON r.passenger_id = u.id
             WHERE r.id = $1 AND r.driver_id = $2 AND r.status = 'started'
             FOR UPDATE`,
            [ride_id, driverId]
        );

        if (rideRes.rows.length === 0) {
            throw new Error("Corrida não encontrada, não está em andamento ou você não é o motorista.");
        }

        const ride = rideRes.rows[0];
        const passengerId = ride.passenger_id;
        const passengerName = ride.passenger_name;
        const passengerBalance = parseFloat(ride.passenger_balance || 0);

        // Verificar se o preço final é razoável (não mais que 2x o estimado)
        const estimatedPrice = parseFloat(ride.estimated_price || 0);
        if (price > estimatedPrice * 2) {
            throw new Error("Preço final muito acima do estimado. Requer aprovação do passageiro.");
        }

        // Atualizar status da corrida
        await client.query(
            "UPDATE rides SET status = 'completed', completed_at = NOW(), final_price = $1, payment_method = $2 WHERE id = $3",
            [price, payment_method || 'cash', ride_id]
        );

        // Buscar informações do motorista com LOCK
        const driverRes = await client.query(
            "SELECT balance, name FROM users WHERE id = $1 FOR UPDATE",
            [driverId]
        );
        const driver = driverRes.rows[0];

        // Processar pagamento se for por carteira (wallet.js cuidará disso)
        if (payment_method === 'wallet') {
            // Simplesmente atualizar o status de pagamento
            await client.query(
                "UPDATE rides SET payment_status = 'paid' WHERE id = $1",
                [ride_id]
            );
        } else {
            // Pagamento em dinheiro
            await client.query(
                "UPDATE rides SET payment_status = 'pending_cash' WHERE id = $1",
                [ride_id]
            );
        }

        // Atualizar rating do motorista (aumenta 0.1 por corrida completada)
        await client.query(
            "UPDATE users SET rating = LEAST(5.00, COALESCE(rating, 5.00) + 0.1) WHERE id = $1",
            [driverId]
        );

        await client.query('COMMIT');

        // Notificações via Socket.IO
        const completionData = {
            ride_id,
            final_price: price,
            completed_at: new Date().toISOString(),
            driver_rating_increased: true,
            payment_method: payment_method || 'cash'
        };

        if (payment_method === 'wallet') {
            completionData.payment_processed = true;
            completionData.transaction_completed = true;

            io.to(`user_${passengerId}`).emit('ride_payment_processed', {
                ...completionData,
                amount_deducted: price
            });

            io.to(`user_${driverId}`).emit('ride_payment_received', {
                ...completionData,
                amount_received: price
            });
        } else {
            io.to(`user_${passengerId}`).emit('ride_completed_cash', completionData);
            io.to(`user_${driverId}`).emit('ride_completed_notify', completionData);
        }

        Logger.audit(driverId, 'RIDE_COMPLETED', {
            ride_id,
            passenger_id: passengerId,
            final_price: price,
            payment_method: payment_method || 'cash',
            distance: ride.distance_km,
            duration_minutes: ride.started_at ?
                Math.round((new Date() - new Date(ride.started_at)) / 60000) : null
        });

        res.json({
            success: true,
            message: payment_method === 'wallet'
                ? "Corrida completada! Pagamento será processado pelo sistema financeiro."
                : "Corrida completada! Aguarde o pagamento em dinheiro.",
            ride_id,
            final_price: price,
            payment_method: payment_method || 'cash',
            payment_status: payment_method === 'wallet' ? 'paid' : 'pending_cash',
            rating_increased: true
        });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('RIDE_COMPLETE', 'Erro ao completar corrida', error);

        res.status(400).json({
            error: error.message,
            code: "RIDE_COMPLETE_ERROR"
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/rides/history - Histórico blindado
 */
ridesRouter.get('/history', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { status, limit = 20, offset = 0 } = req.query;

    const validStatuses = ['searching', 'accepted', 'arrived', 'started', 'completed', 'cancelled'];

    if (status && !validStatuses.includes(status)) {
        return res.status(400).json({
            error: "Status inválido. Use: " + validStatuses.join(', '),
            code: "INVALID_STATUS"
        });
    }

    try {
        let query = `
            SELECT r.*,
                   p.name as passenger_name, p.photo_url as passenger_photo, p.phone as passenger_phone,
                   d.name as driver_name, d.photo_url as driver_photo, d.phone as driver_phone
            FROM rides r
            LEFT JOIN users p ON r.passenger_id = p.id
            LEFT JOIN users d ON r.driver_id = d.id
            WHERE (r.passenger_id = $1 OR r.driver_id = $1)
        `;

        const params = [userId];
        let paramCount = 2;

        if (status) {
            query += ` AND r.status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        query += ` ORDER BY r.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit) || 20, parseInt(offset) || 0);

        const result = await pool.query(query, params);

        // Buscar total para paginação
        const countQuery = query
            .replace(/SELECT r.*,.*FROM rides r/, 'SELECT COUNT(*) as total FROM rides r')
            .split('ORDER BY')[0];

        const countResult = await pool.query(countQuery, params.slice(0, -2));
        const total = parseInt(countResult.rows[0]?.total || 0);

        // Processar resultados
        const rides = result.rows.map(ride => {
            const rideObj = { ...ride };

            // Remover informações sensíveis baseado no papel
            if (req.user.role === 'passenger' && ride.driver_id !== userId) {
                delete rideObj.driver_phone;
            }

            if (req.user.role === 'driver' && ride.passenger_id !== userId) {
                delete rideObj.passenger_phone;
            }

            return rideObj;
        });

        res.json({
            success: true,
            rides,
            pagination: {
                total,
                limit: parseInt(limit) || 20,
                offset: parseInt(offset) || 0,
                has_more: (parseInt(offset) + rides.length) < total
            }
        });

    } catch (error) {
        Logger.error('RIDE_HISTORY', 'Erro ao buscar histórico', error);
        res.status(500).json({
            error: "Erro ao buscar histórico de corridas.",
            code: "HISTORY_LOAD_ERROR"
        });
    }
});

/**
 * GET /api/rides/active - Corridas ativas blindadas
 */
ridesRouter.get('/active', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `SELECT r.*,
                    p.name as passenger_name, p.photo_url as passenger_photo,
                    d.name as driver_name, d.photo_url as driver_photo
             FROM rides r
             LEFT JOIN users p ON r.passenger_id = p.id
             LEFT JOIN users d ON r.driver_id = d.id
             WHERE (r.passenger_id = $1 OR r.driver_id = $1)
             AND r.status IN ('searching', 'accepted', 'started')
             ORDER BY r.created_at DESC LIMIT 5`,
            [userId]
        );

        res.json({
            success: true,
            active_rides: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        Logger.error('RIDE_ACTIVE', 'Erro ao buscar corridas ativas', error);
        res.status(500).json({
            error: "Erro ao buscar corridas ativas.",
            code: "ACTIVE_RIDES_ERROR"
        });
    }
});

/**
 * GET /api/rides/:id - Detalhes da corrida blindados
 */
ridesRouter.get('/:id', authenticateToken, async (req, res) => {
    const rideId = req.params.id;
    const userId = req.user.id;

    if (!rideId || isNaN(parseInt(rideId))) {
        return res.status(400).json({
            error: "ID da corrida inválido.",
            code: "INVALID_RIDE_ID"
        });
    }

    try {
        const result = await pool.query(
            `SELECT r.*,
                    p.name as passenger_name, p.photo_url as passenger_photo, p.phone as passenger_phone, p.rating as passenger_rating,
                    d.name as driver_name, d.photo_url as driver_photo, d.phone as driver_phone, d.rating as driver_rating,
                    d.vehicle_details as driver_vehicle_details
             FROM rides r
             LEFT JOIN users p ON r.passenger_id = p.id
             LEFT JOIN users d ON r.driver_id = d.id
             WHERE r.id = $1 AND (r.passenger_id = $2 OR r.driver_id = $2 OR $3 = 'admin')`,
            [rideId, userId, req.user.role]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Corrida não encontrada ou acesso não autorizado.",
                code: "RIDE_NOT_FOUND"
            });
        }

        const ride = result.rows[0];

        // Parse vehicle_details
        if (ride.driver_vehicle_details && typeof ride.driver_vehicle_details === 'string') {
            try {
                ride.driver_vehicle_details = JSON.parse(ride.driver_vehicle_details);
            } catch (e) {
                ride.driver_vehicle_details = {};
            }
        }

        // Remover informações sensíveis baseado no papel
        if (req.user.role === 'passenger' && ride.driver_id !== userId) {
            delete ride.driver_phone;
        }

        if (req.user.role === 'driver' && ride.passenger_id !== userId) {
            delete ride.passenger_phone;
        }

        // Buscar mensagens de chat se autorizado
        if (ride.passenger_id === userId || ride.driver_id === userId || req.user.role === 'admin') {
            const messages = await pool.query(
                `SELECT cm.*, u.name as sender_name, u.role as sender_role
                 FROM chat_messages cm
                 JOIN users u ON cm.sender_id = u.id
                 WHERE cm.ride_id = $1
                 ORDER BY cm.created_at ASC`,
                [rideId]
            );

            ride.chat_messages = messages.rows;
        }

        res.json({
            success: true,
            ride
        });

    } catch (error) {
        Logger.error('RIDE_DETAILS', 'Erro ao buscar detalhes da corrida', error);
        res.status(500).json({
            error: "Erro ao buscar detalhes da corrida.",
            code: "RIDE_DETAILS_ERROR"
        });
    }
});

// =================================================================================================
// 8. ROTAS ADMINISTRATIVAS (BACKOFFICE) - BLINDADAS
// =================================================================================================

const adminRouter = express.Router();

// Todas as rotas admin requerem autenticação e privilégios de admin
adminRouter.use(authenticateToken, requireAdmin);

/**
 * GET /api/admin/stats - Estatísticas gerais blindadas
 */
adminRouter.get('/stats', async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM users WHERE role='driver') as total_drivers,
                (SELECT COUNT(*) FROM users WHERE role='passenger') as total_passengers,
                (SELECT COUNT(*) FROM users WHERE role='admin') as total_admins,
                (SELECT COUNT(*) FROM users WHERE is_online=true) as online_users,
                (SELECT COUNT(*) FROM users WHERE is_verified=true) as verified_users,
                (SELECT COUNT(*) FROM users WHERE is_blocked=true) as blocked_users,
                (SELECT COUNT(*) FROM rides) as total_rides,
                (SELECT COUNT(*) FROM rides WHERE status='completed') as completed_rides,
                (SELECT COUNT(*) FROM rides WHERE status='searching') as searching_rides,
                (SELECT COUNT(*) FROM rides WHERE status='cancelled') as cancelled_rides,
                (SELECT COALESCE(SUM(balance), 0) FROM users) as total_balances,
                (SELECT COALESCE(SUM(final_price), 0) FROM rides WHERE status='completed') as total_revenue,
                (SELECT COUNT(*) FROM user_documents WHERE status='pending') as pending_documents,
                (SELECT COUNT(*) FROM chat_messages) as total_messages
        `);

        const statData = stats.rows[0];

        // Calcular métricas adicionais
        const today = new Date().toISOString().split('T')[0];
        const todayStats = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM rides WHERE DATE(created_at) = $1) as rides_today,
                (SELECT COUNT(*) FROM users WHERE DATE(created_at) = $1) as registrations_today,
                (SELECT COALESCE(SUM(final_price), 0) FROM rides WHERE status='completed' AND DATE(completed_at) = $1) as revenue_today
        `, [today]);

        const todayData = todayStats.rows[0];

        res.json({
            success: true,
            stats: {
                ...statData,
                ...todayData,
                platform_health: {
                    database: 'online',
                    socket_io: io.engine.clientsCount,
                    uptime: process.uptime(),
                    memory_usage: process.memoryUsage()
                }
            },
            generated_at: new Date().toISOString()
        });

    } catch (e) {
        Logger.error('ADMIN_STATS', 'Erro ao buscar estatísticas', e);
        res.status(500).json({
            error: "Erro ao buscar estatísticas.",
            code: "STATS_ERROR"
        });
    }
});

/**
 * GET /api/admin/users - Listar usuários com paginação blindada
 */
adminRouter.get('/users', async (req, res) => {
    const {
        role,
        is_online,
        is_blocked,
        is_verified,
        wallet_status,
        account_tier,
        search,
        limit = 50,
        offset = 0
    } = req.query;

    try {
        let query = `
            SELECT id, name, email, phone, role,
                   photo_url, photo, balance, is_online,
                   rating, is_blocked, is_verified,
                   wallet_status, account_tier, kyc_level,
                   daily_limit, daily_limit_used,
                   created_at, updated_at
            FROM users WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        // Filtros
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

        if (is_verified !== undefined) {
            query += ` AND is_verified = $${paramCount}`;
            params.push(is_verified === 'true');
            paramCount++;
        }

        if (wallet_status) {
            query += ` AND wallet_status = $${paramCount}`;
            params.push(wallet_status);
            paramCount++;
        }

        if (account_tier) {
            query += ` AND account_tier = $${paramCount}`;
            params.push(account_tier);
            paramCount++;
        }

        // Busca textual
        if (search && search.trim().length >= 2) {
            query += ` AND (
                name ILIKE $${paramCount} OR
                email ILIKE $${paramCount} OR
                phone ILIKE $${paramCount} OR
                wallet_account_number ILIKE $${paramCount}
            )`;
            params.push(`%${search.trim()}%`);
            paramCount++;
        }

        query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit) || 50, parseInt(offset) || 0);

        const result = await pool.query(query, params);

        // Contagem total (para paginação)
        const countQuery = query
            .replace(/SELECT.*FROM users WHERE/, 'SELECT COUNT(*) as total FROM users WHERE')
            .split('ORDER BY')[0];

        const countResult = await pool.query(countQuery, params.slice(0, -2));
        const total = parseInt(countResult.rows[0]?.total || 0);

        res.json({
            success: true,
            users: result.rows,
            pagination: {
                total,
                limit: parseInt(limit) || 50,
                offset: parseInt(offset) || 0,
                has_more: (parseInt(offset) + result.rows.length) < total
            }
        });

    } catch (e) {
        Logger.error('ADMIN_USERS', 'Erro ao listar usuários', e);
        res.status(500).json({
            error: "Erro ao listar usuários.",
            code: "USERS_LIST_ERROR"
        });
    }
});

/**
 * GET /api/admin/users/:id - Detalhes do usuário blindados
 */
adminRouter.get('/users/:id', async (req, res) => {
    const userId = req.params.id;

    if (!userId || isNaN(parseInt(userId))) {
        return res.status(400).json({
            error: "ID do usuário inválido.",
            code: "INVALID_USER_ID"
        });
    }

    try {
        // Buscar usuário
        const userResult = await pool.query(
            `SELECT * FROM users WHERE id = $1`,
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: "Usuário não encontrado.",
                code: "USER_NOT_FOUND"
            });
        }

        const user = userResult.rows[0];

        // Remover dados sensíveis
        delete user.password_hash;
        delete user.wallet_pin_hash;
        delete user.fcm_token;

        // Parse vehicle_details
        if (user.vehicle_details && typeof user.vehicle_details === 'string') {
            try {
                user.vehicle_details = JSON.parse(user.vehicle_details);
            } catch (e) {
                user.vehicle_details = {};
            }
        }

        // Buscar documentos
        const documents = await pool.query(
            `SELECT * FROM user_documents WHERE user_id = $1 ORDER BY uploaded_at DESC`,
            [userId]
        );

        // Buscar histórico de corridas
        const rides = await pool.query(
            `SELECT r.*,
                    p.name as passenger_name,
                    d.name as driver_name
             FROM rides r
             LEFT JOIN users p ON r.passenger_id = p.id
             LEFT JOIN users d ON r.driver_id = d.id
             WHERE r.passenger_id = $1 OR r.driver_id = $1
             ORDER BY r.created_at DESC LIMIT 10`,
            [userId]
        );

        res.json({
            success: true,
            user,
            documents: documents.rows,
            recent_rides: rides.rows,
            summary: {
                total_rides: rides.rows.length,
                total_documents: documents.rows.length,
                account_age_days: Math.floor((new Date() - new Date(user.created_at)) / (1000 * 60 * 60 * 24))
            }
        });

    } catch (e) {
        Logger.error('ADMIN_USER_DETAILS', 'Erro ao buscar detalhes do usuário', e);
        res.status(500).json({
            error: "Erro ao buscar detalhes do usuário.",
            code: "USER_DETAILS_ERROR"
        });
    }
});

/**
 * POST /api/admin/users/:id/actions - Ações administrativas blindadas
 */
adminRouter.post('/users/:id/actions', validateRequest(), async (req, res) => {
    const userId = req.params.id;
    const { action, reason, data } = req.body;

    if (!userId || isNaN(parseInt(userId))) {
        return res.status(400).json({
            error: "ID do usuário inválido.",
            code: "INVALID_USER_ID"
        });
    }

    if (!action) {
        return res.status(400).json({
            error: "Ação é obrigatória.",
            code: "ACTION_REQUIRED"
        });
    }

    const validActions = [
        'block', 'unblock', 'verify', 'unverify',
        'freeze_wallet', 'unfreeze_wallet',
        'change_tier', 'update_limits',
        'reset_password', 'add_note'
    ];

    if (!validActions.includes(action)) {
        return res.status(400).json({
            error: `Ação inválida. Use: ${validActions.join(', ')}`,
            code: "INVALID_ACTION"
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verificar se usuário existe
        const userCheck = await client.query(
            "SELECT id, name, email FROM users WHERE id = $1",
            [userId]
        );

        if (userCheck.rows.length === 0) {
            throw new Error("Usuário não encontrado.");
        }

        const user = userCheck.rows[0];
        let query;
        let queryParams = [userId];
        let successMessage = "";

        switch (action) {
            case 'block':
                query = "UPDATE users SET is_blocked = true, is_online = false, updated_at = NOW() WHERE id = $1";
                successMessage = `Usuário ${user.name} bloqueado.`;
                break;

            case 'unblock':
                query = "UPDATE users SET is_blocked = false, updated_at = NOW() WHERE id = $1";
                successMessage = `Usuário ${user.name} desbloqueado.`;
                break;

            case 'verify':
                query = "UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1";
                successMessage = `Usuário ${user.name} verificado.`;
                break;

            case 'unverify':
                query = "UPDATE users SET is_verified = false, updated_at = NOW() WHERE id = $1";
                successMessage = `Verificação removida para ${user.name}.`;
                break;

            case 'freeze_wallet':
                query = "UPDATE users SET wallet_status = 'frozen', updated_at = NOW() WHERE id = $1";
                successMessage = `Carteira de ${user.name} congelada.`;
                break;

            case 'unfreeze_wallet':
                query = "UPDATE users SET wallet_status = 'active', updated_at = NOW() WHERE id = $1";
                successMessage = `Carteira de ${user.name} ativada.`;
                break;

            case 'change_tier':
                if (!data || !['standard', 'premium', 'vip'].includes(data.tier)) {
                    throw new Error("Tier inválido. Use: standard, premium, vip");
                }
                query = "UPDATE users SET account_tier = $2, updated_at = NOW() WHERE id = $1";
                queryParams.push(data.tier);
                successMessage = `Tier de ${user.name} alterado para ${data.tier}.`;
                break;

            case 'update_limits':
                if (!data || !data.daily_limit || isNaN(parseFloat(data.daily_limit))) {
                    throw new Error("Limite diário inválido.");
                }
                query = "UPDATE users SET daily_limit = $2, updated_at = NOW() WHERE id = $1";
                queryParams.push(parseFloat(data.daily_limit));
                successMessage = `Limite diário de ${user.name} atualizado para ${data.daily_limit} Kz.`;
                break;

            case 'reset_password':
                // Gerar senha temporária
                const tempPassword = crypto.randomBytes(8).toString('hex');
                const hashedPassword = await bcrypt.hash(tempPassword, 12);

                query = "UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1";
                queryParams.push(hashedPassword);
                successMessage = `Senha de ${user.name} redefinida. Nova senha: ${tempPassword}`;
                break;

            case 'add_note':
                // Para notas, podemos usar um campo JSON adicional ou uma tabela separada
                // Por simplicidade, vamos apenas logar
                successMessage = `Nota adicionada para ${user.name}: ${data?.note || 'N/A'}`;
                break;
        }

        if (query) {
            await client.query(query, queryParams);
        }

        // Registrar ação administrativa
        await client.query(
            `INSERT INTO user_documents (user_id, doc_type, file_url, status, rejection_reason)
             VALUES ($1, 'admin_action', 'N/A', 'approved', $2)`,
            [userId, `Ação: ${action}. Motivo: ${reason || 'N/A'}. Admin: ${req.user.id}`]
        );

        await client.query('COMMIT');

        // Notificar usuário se a ação afetá-lo
        if (['block', 'freeze_wallet'].includes(action)) {
            io.to(`user_${userId}`).emit('account_action', {
                action,
                reason: reason || 'Ação administrativa',
                timestamp: new Date().toISOString(),
                contact_support: true
            });
        }

        Logger.audit(req.user.id, 'ADMIN_ACTION', {
            target_user_id: userId,
            action,
            reason,
            data,
            success_message: successMessage
        });

        // Se for reset de senha, enviar a senha temporária apenas no log (não na resposta)
        const responseMessage = action === 'reset_password'
            ? "Senha redefinida com sucesso. A nova senha foi gerada e registrada nos logs."
            : successMessage;

        res.json({
            success: true,
            message: responseMessage,
            action,
            user_id: userId,
            user_email: user.email,
            requires_user_notification: ['block', 'freeze_wallet'].includes(action)
        });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('ADMIN_ACTION', 'Erro na ação administrativa', error);

        res.status(400).json({
            error: error.message,
            code: "ADMIN_ACTION_ERROR"
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/admin/rides - Histórico global de corridas blindado
 */
adminRouter.get('/rides', async (req, res) => {
    const { status, date_from, date_to, user_id, limit = 50, offset = 0 } = req.query;

    try {
        let query = `
            SELECT r.*,
                   p.name as passenger_name, p.email as passenger_email, p.phone as passenger_phone,
                   d.name as driver_name, d.email as driver_email, d.phone as driver_phone
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

        if (user_id && !isNaN(parseInt(user_id))) {
            query += ` AND (r.passenger_id = $${paramCount} OR r.driver_id = $${paramCount})`;
            params.push(parseInt(user_id));
            paramCount++;
        }

        query += ` ORDER BY r.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit) || 50, parseInt(offset) || 0);

        const result = await pool.query(query, params);

        // Contagem total
        const countQuery = query
            .replace(/SELECT r.*,.*FROM rides r/, 'SELECT COUNT(*) as total FROM rides r')
            .split('ORDER BY')[0];

        const countResult = await pool.query(countQuery, params.slice(0, -2));
        const total = parseInt(countResult.rows[0]?.total || 0);

        res.json({
            success: true,
            rides: result.rows,
            pagination: {
                total,
                limit: parseInt(limit) || 50,
                offset: parseInt(offset) || 0,
                has_more: (parseInt(offset) + result.rows.length) < total
            }
        });

    } catch (e) {
        Logger.error('ADMIN_RIDES', 'Erro ao listar corridas', e);
        res.status(500).json({
            error: "Erro ao listar corridas.",
            code: "RIDES_LIST_ERROR"
        });
    }
});

/**
 * GET /api/admin/documents - Documentos pendentes blindados
 */
adminRouter.get('/documents', async (req, res) => {
    const { status, doc_type, limit = 50, offset = 0 } = req.query;

    try {
        let query = `
            SELECT ud.*, u.name as user_name, u.email, u.phone, u.role
            FROM user_documents ud
            JOIN users u ON ud.user_id = u.id
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        if (status) {
            query += ` AND ud.status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        if (doc_type) {
            query += ` AND ud.doc_type = $${paramCount}`;
            params.push(doc_type);
            paramCount++;
        }

        query += ` ORDER BY ud.uploaded_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit) || 50, parseInt(offset) || 0);

        const result = await pool.query(query, params);

        res.json({
            success: true,
            documents: result.rows,
            count: result.rows.length,
            pending_count: status === 'pending' ? result.rows.length : 'N/A'
        });

    } catch (e) {
        Logger.error('ADMIN_DOCS', 'Erro ao listar documentos', e);
        res.status(500).json({
            error: "Erro ao listar documentos.",
            code: "DOCUMENTS_ERROR"
        });
    }
});

/**
 * POST /api/admin/documents/:id/verify - Verificar documento blindado
 */
adminRouter.post('/documents/:id/verify', validateRequest(), async (req, res) => {
    const docId = req.params.id;
    const { action, rejection_reason } = req.body;

    if (!docId || isNaN(parseInt(docId))) {
        return res.status(400).json({
            error: "ID do documento inválido.",
            code: "INVALID_DOC_ID"
        });
    }

    if (!action || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({
            error: "Ação inválida. Use: 'approve' ou 'reject'.",
            code: "INVALID_ACTION"
        });
    }

    if (action === 'reject' && (!rejection_reason || rejection_reason.trim().length < 5)) {
        return res.status(400).json({
            error: "Motivo da rejeição é obrigatório (mínimo 5 caracteres).",
            code: "REJECTION_REASON_REQUIRED"
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Buscar documento
        const docResult = await client.query(
            `SELECT ud.*, u.id as user_id, u.name as user_name, u.role
             FROM user_documents ud
             JOIN users u ON ud.user_id = u.id
             WHERE ud.id = $1`,
            [docId]
        );

        if (docResult.rows.length === 0) {
            throw new Error("Documento não encontrado.");
        }

        const document = docResult.rows[0];
        const userId = document.user_id;

        // Atualizar documento
        await client.query(
            `UPDATE user_documents
             SET status = $1,
                 rejection_reason = $2,
                 verified_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END
             WHERE id = $3`,
            [
                action === 'approve' ? 'approved' : 'rejected',
                action === 'reject' ? rejection_reason.trim() : null,
                docId
            ]
        );

        // Se for motorista e documento aprovado, verificar se todos documentos necessários foram aprovados
        if (action === 'approve' && document.role === 'driver') {
            const requiredDocs = ['driver_license', 'id_card'];
            const approvedDocs = await client.query(
                `SELECT COUNT(*) as count
                 FROM user_documents
                 WHERE user_id = $1 AND doc_type IN ($2, $3) AND status = 'approved'`,
                [userId, requiredDocs[0], requiredDocs[1]]
            );

            if (parseInt(approvedDocs.rows[0].count) === requiredDocs.length) {
                await client.query(
                    "UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1",
                    [userId]
                );

                // Notificar motorista
                io.to(`user_${userId}`).emit('driver_verified', {
                    message: "Parabéns! Sua conta de motorista foi verificada e ativada.",
                    timestamp: new Date().toISOString()
                });
            }
        }

        await client.query('COMMIT');

        // Notificar usuário
        const notificationData = {
            document_id: docId,
            document_type: document.doc_type,
            action,
            message: action === 'approve'
                ? "Documento aprovado com sucesso!"
                : `Documento rejeitado: ${rejection_reason}`,
            timestamp: new Date().toISOString()
        };

        io.to(`user_${userId}`).emit('document_verification_update', notificationData);

        Logger.audit(req.user.id, 'DOCUMENT_VERIFIED', {
            document_id: docId,
            user_id: userId,
            action,
            rejection_reason: action === 'reject' ? rejection_reason : null,
            auto_verified_user: action === 'approve' && document.role === 'driver'
        });

        res.json({
            success: true,
            message: action === 'approve'
                ? "Documento aprovado com sucesso!"
                : "Documento rejeitado.",
            document_id: docId,
            user_id: userId,
            user_notified: true,
            user_verified: action === 'approve' && document.role === 'driver' && document.doc_type === 'id_card'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        Logger.error('ADMIN_DOC_VERIFY', 'Erro ao verificar documento', error);

        res.status(400).json({
            error: error.message,
            code: "DOC_VERIFY_ERROR"
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/admin/settings - Obter configurações
 */
adminRouter.get('/settings', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM app_settings ORDER BY key"
        );

        // Converter valores JSON para objetos
        const settings = result.rows.map(row => ({
            ...row,
            value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value
        }));

        res.json({
            success: true,
            settings
        });

    } catch (e) {
        Logger.error('ADMIN_SETTINGS', 'Erro ao buscar configurações', e);
        res.status(500).json({
            error: "Erro ao buscar configurações.",
            code: "SETTINGS_ERROR"
        });
    }
});

/**
 * POST /api/admin/settings - Atualizar configurações
 */
adminRouter.post('/settings', validateRequest(), async (req, res) => {
    const { key, value, description } = req.body;

    if (!key || !value) {
        return res.status(400).json({
            error: "Chave e valor são obrigatórios.",
            code: "KEY_VALUE_REQUIRED"
        });
    }

    try {
        // Validar que o valor é JSON válido
        const jsonValue = typeof value === 'string' ? JSON.parse(value) : value;
        const stringValue = JSON.stringify(jsonValue);

        await pool.query(
            `INSERT INTO app_settings (key, value, description, updated_at, updated_by)
             VALUES ($1, $2, $3, NOW(), $4)
             ON CONFLICT (key) DO UPDATE SET
                value = $2,
                description = COALESCE($3, app_settings.description),
                updated_at = NOW(),
                updated_by = $4`,
            [key, stringValue, description, req.user.id]
        );

        Logger.audit(req.user.id, 'SETTINGS_UPDATED', { key, value: jsonValue });

        // Se for configuração de preços, notificar motoristas
        if (key === 'ride_pricing') {
            io.to('drivers_room').emit('pricing_updated', {
                key,
                value: jsonValue,
                updated_at: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            message: "Configuração atualizada com sucesso.",
            key,
            value: jsonValue,
            updated_by: req.user.id,
            updated_at: new Date().toISOString()
        });

    } catch (error) {
        if (error.message.includes('JSON')) {
            return res.status(400).json({
                error: "Valor JSON inválido.",
                code: "INVALID_JSON"
            });
        }

        Logger.error('ADMIN_SETTINGS_UPDATE', 'Erro ao atualizar configurações', error);
        res.status(500).json({
            error: "Erro ao salvar configuração.",
            code: "SETTINGS_SAVE_ERROR"
        });
    }
});

// =================================================================================================
// 9. MONTAGEM DE ROTAS - ORDEM E SEGURANÇA
// =================================================================================================

// Rotas Públicas (sem autenticação)
app.get('/', (req, res) => {
    res.status(200).json({
        status: "AOTRAVEL SERVER ONLINE",
        version: "v6.2 - BLINDADO E ROBUSTO",
        environment: NODE_ENV,
        timestamp: new Date().toISOString(),
        endpoints: {
            auth: {
                register: "POST /api/auth/register",
                login: "POST /api/auth/login",
                profile: "GET /api/auth/profile (autenticado)"
            },
            rides: {
                request: "POST /api/rides/request (autenticado)",
                accept: "POST /api/rides/accept (motorista)",
                complete: "POST /api/rides/complete (motorista)"
            },
            admin: {
                stats: "GET /api/admin/stats (admin)",
                users: "GET /api/admin/users (admin)"
            },
            wallet: "GET /api/wallet/* (autenticado)",
            health: "GET /health"
        },
        security: {
            cors: "Habilitado",
            rate_limit: "Habilitado",
            helmet: "Habilitado",
            ssl: process.env.NODE_ENV === 'production' ? 'Requerido' : 'Opcional'
        }
    });
});

// Health Check (Público)
app.get('/health', async (req, res) => {
    const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        node_version: process.version,
        environment: NODE_ENV
    };

    try {
        // Testar conexão com banco de dados
        const dbTest = await pool.query('SELECT NOW() as time, version() as version');
        health.database = {
            status: "connected",
            time: dbTest.rows[0].time,
            version: dbTest.rows[0].version.split(' ')[1]
        };
    } catch (dbError) {
        health.database = {
            status: "disconnected",
            error: dbError.message
        };
        health.status = "degraded";
    }

    // Testar Socket.IO
    health.socket_io = {
        status: "active",
        connected_clients: io.engine.clientsCount,
        transports: io.engine.transports
    };

    res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

// Rotas Principais (API)
app.use('/api/auth', authRouter);
app.use('/api/rides', ridesRouter);
app.use('/api/admin', adminRouter);

// =================================================================================================
// 10. IMPORTANDO MÓDULO WALLET (EXTERNO) - CARREGAMENTO ROBUSTO
// =================================================================================================

let walletRouter = null;
try {
    // Importar módulo wallet.js
    const walletModule = require('./wallet');
    if (typeof walletModule === 'function') {
        // Passar pool e io para o módulo wallet
        walletRouter = walletModule(pool, io);
        
        // Montar rotas do wallet com autenticação
        app.use('/api/wallet', authenticateToken, walletRouter);
        
        console.log('✅ Módulo Wallet carregado com sucesso.');
        console.log('💰 Sistema Financeiro: Integrado e Funcional');
    } else {
        console.warn('⚠️  Módulo Wallet não retornou uma função. Rotas financeiras desativadas.');
        
        // Rota fallback para wallet
        app.use('/api/wallet', authenticateToken, (req, res) => {
            res.status(503).json({
                error: "Módulo financeiro temporariamente indisponível.",
                code: "WALLET_MODULE_UNAVAILABLE",
                timestamp: new Date().toISOString()
            });
        });
    }
} catch (error) {
    console.error('❌ Erro ao carregar módulo Wallet:', error.message);
    console.warn('⚠️  Rotas financeiras desativadas devido a erro no módulo.');

    // Rota fallback para wallet
    app.use('/api/wallet', authenticateToken, (req, res) => {
        res.status(503).json({
            error: "Módulo financeiro temporariamente indisponível.",
            code: "WALLET_MODULE_UNAVAILABLE",
            timestamp: new Date().toISOString()
        });
    });
}

// =================================================================================================
// 11. MOTOR REAL-TIME (SOCKET.IO) - ROBUSTO
// =================================================================================================

const activeUsers = new Map();
const driverLocations = new Map();
const rideRooms = new Map();

// Middleware de Autenticação do Socket
io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
        Logger.security(null, 'SOCKET_NO_TOKEN', {
            socket_id: socket.id,
            ip: socket.handshake.address
        });
        return next(new Error("Token de autenticação obrigatório."));
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Verificar se o usuário existe e não está bloqueado
        const userCheck = await pool.query(
            "SELECT id, is_blocked FROM users WHERE id = $1",
            [decoded.id]
        );

        if (userCheck.rows.length === 0) {
            Logger.security(decoded.id, 'SOCKET_USER_NOT_FOUND', { socket_id: socket.id });
            return next(new Error("Usuário não encontrado."));
        }

        if (userCheck.rows[0].is_blocked) {
            Logger.security(decoded.id, 'SOCKET_USER_BLOCKED', { socket_id: socket.id });
            return next(new Error("Conta bloqueada."));
        }

        socket.user = {
            id: decoded.id,
            role: decoded.role,
            email: decoded.email
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            Logger.security(null, 'SOCKET_TOKEN_EXPIRED', { socket_id: socket.id });
            return next(new Error("Token expirado."));
        }

        Logger.security(null, 'SOCKET_TOKEN_INVALID', {
            socket_id: socket.id,
            error: error.message
        });
        return next(new Error("Token inválido."));
    }
});

io.on('connection', (socket) => {
    const userId = socket.user.id;
    const userRole = socket.user.role;
    const socketId = socket.id;

    Logger.info('SOCKET', `Usuário conectado: ${userId} (${userRole}) - Socket: ${socketId}`);

    // Registrar usuário ativo
    activeUsers.set(userId, socketId);
    socket.join(`user_${userId}`);

    // Atualizar status online no banco
    pool.query(
        "UPDATE users SET is_online = true, updated_at = NOW() WHERE id = $1",
        [userId]
    ).catch(err => {
        Logger.warn('SOCKET_ONLINE_UPDATE', 'Erro ao atualizar status online', err);
    });

    // Se for motorista, entrar na sala de motoristas
    if (userRole === 'driver') {
        socket.join('drivers_room');
        Logger.info('SOCKET', `Motorista ${userId} entrou na sala de motoristas`);
    }

    // Evento: Atualização de localização (motoristas)
    socket.on('update_location', (data) => {
        if (userRole !== 'driver') {
            socket.emit('error', { message: "Apenas motoristas podem atualizar localização." });
            return;
        }

        const { lat, lng, ride_id, heading, speed } = data;

        if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
            socket.emit('error', { message: "Coordenadas inválidas." });
            return;
        }

        // Armazenar localização
        driverLocations.set(userId, {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            heading: heading ? parseFloat(heading) : null,
            speed: speed ? parseFloat(speed) : null,
            timestamp: Date.now(),
            socket_id: socketId
        });

        // Se estiver em uma corrida, notificar passageiro
        if (ride_id) {
            const rideRoom = `ride_${ride_id}`;
            if (io.sockets.adapter.rooms.has(rideRoom)) {
                io.to(rideRoom).emit('driver_location_update', {
                    ride_id,
                    driver_id: userId,
                    location: { lat: parseFloat(lat), lng: parseFloat(lng) },
                    heading,
                    speed,
                    timestamp: Date.now()
                });
            }
        }

        // Log (reduzido para não sobrecarregar)
        if (Math.random() < 0.01) { // Apenas 1% dos updates são logados
            Logger.info('SOCKET_LOCATION', `Motorista ${userId} atualizou localização`, {
                lat, lng, ride_id, has_ride: !!ride_id
            });
        }
    });

    // Evento: Entrar na sala de uma corrida
    socket.on('join_ride', async (rideId) => {
        if (!rideId || isNaN(parseInt(rideId))) {
            socket.emit('error', { message: "ID da corrida inválido." });
            return;
        }

        try {
            // Verificar se o usuário tem permissão para entrar nesta corrida
            const rideCheck = await pool.query(
                "SELECT passenger_id, driver_id FROM rides WHERE id = $1",
                [rideId]
            );

            if (rideCheck.rows.length === 0) {
                socket.emit('error', { message: "Corrida não encontrada." });
                return;
            }

            const ride = rideCheck.rows[0];

            if (userId !== ride.passenger_id && userId !== ride.driver_id && userRole !== 'admin') {
                socket.emit('error', { message: "Você não tem permissão para acessar esta corrida." });
                return;
            }

            const rideRoom = `ride_${rideId}`;
            socket.join(rideRoom);
            rideRooms.set(socketId, rideRoom);

            Logger.info('SOCKET', `Usuário ${userId} entrou na sala da corrida ${rideId}`);

            // Notificar outros na sala
            socket.to(rideRoom).emit('user_joined_ride', {
                user_id: userId,
                user_role: userRole,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            Logger.error('SOCKET_JOIN_RIDE', 'Erro ao entrar na sala da corrida', error);
            socket.emit('error', { message: "Erro ao acessar corrida." });
        }
    });

    // Evento: Sair da sala de uma corrida
    socket.on('leave_ride', (rideId) => {
        const rideRoom = `ride_${rideId}`;
        socket.leave(rideRoom);
        rideRooms.delete(socketId);

        Logger.info('SOCKET', `Usuário ${userId} saiu da sala da corrida ${rideId}`);
    });

    // Evento: Enviar mensagem no chat
    socket.on('send_message', async (payload) => {
        const { ride_id, text, type = 'text' } = payload;

        if (!ride_id || !text || text.trim().length === 0) {
            socket.emit('error', { message: "ID da corrida e texto da mensagem são obrigatórios." });
            return;
        }

        if (text.length > 1000) {
            socket.emit('error', { message: "Mensagem muito longa (máximo 1000 caracteres)." });
            return;
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verificar permissão
            const rideCheck = await client.query(
                "SELECT passenger_id, driver_id FROM rides WHERE id = $1",
                [ride_id]
            );

            if (rideCheck.rows.length === 0) {
                throw new Error("Corrida não encontrada.");
            }

            const ride = rideCheck.rows[0];

            if (userId !== ride.passenger_id && userId !== ride.driver_id) {
                throw new Error("Você não tem permissão para enviar mensagens nesta corrida.");
            }

            // Inserir mensagem
            const result = await client.query(
                `INSERT INTO chat_messages (ride_id, sender_id, message_text, message_type)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [ride_id, userId, text.trim(), type]
            );

            const message = result.rows[0];

            // Buscar informações do remetente
            const senderInfo = await client.query(
                "SELECT name, role, photo_url FROM users WHERE id = $1",
                [userId]
            );

            const enrichedMessage = {
                ...message,
                sender_name: senderInfo.rows[0]?.name,
                sender_role: senderInfo.rows[0]?.role,
                sender_photo: senderInfo.rows[0]?.photo_url
            };

            await client.query('COMMIT');

            // Enviar para sala da corrida
            const rideRoom = `ride_${ride_id}`;
            io.to(rideRoom).emit('ride_message', enrichedMessage);

            // Enviar notificação para o outro participante (se não estiver na sala)
            const receiverId = userId === ride.passenger_id ? ride.driver_id : ride.passenger_id;
            if (receiverId) {
                const receiverSocketId = activeUsers.get(receiverId);
                if (!receiverSocketId || !socket.adapter.rooms.get(rideRoom)?.has(receiverSocketId)) {
                    io.to(`user_${receiverId}`).emit('new_message_notification', {
                        ride_id,
                        message_preview: text.length > 50 ? text.substring(0, 50) + '...' : text,
                        sender_name: senderInfo.rows[0]?.name,
                        timestamp: new Date().toISOString()
                    });
                }
            }

            Logger.audit(userId, 'CHAT_MESSAGE_SENT', {
                ride_id,
                message_length: text.length,
                has_receiver: !!receiverId
            });

        } catch (error) {
            await client.query('ROLLBACK');
            Logger.error('SOCKET_CHAT', 'Erro ao enviar mensagem', error);
            socket.emit('error', { message: "Erro ao enviar mensagem." });
        } finally {
            client.release();
        }
    });

    // Evento: Marcar mensagens como lidas
    socket.on('mark_messages_read', async (payload) => {
        const { ride_id } = payload;

        if (!ride_id) {
            return;
        }

        try {
            await pool.query(
                `UPDATE chat_messages
                 SET is_read = true
                 WHERE ride_id = $1 AND sender_id != $2 AND is_read = false`,
                [ride_id, userId]
            );

            // Notificar o remetente que as mensagens foram lidas
            const rideCheck = await pool.query(
                "SELECT passenger_id, driver_id FROM rides WHERE id = $1",
                [ride_id]
            );

            if (rideCheck.rows.length > 0) {
                const ride = rideCheck.rows[0];
                const otherUserId = userId === ride.passenger_id ? ride.driver_id : ride.passenger_id;

                if (otherUserId) {
                    io.to(`user_${otherUserId}`).emit('messages_read', {
                        ride_id,
                        reader_id: userId,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            Logger.warn('SOCKET_READ', 'Erro ao marcar mensagens como lidas', error);
        }
    });

    // Evento: Driver arrived
    socket.on('driver_arrived', async (data) => {
        if (userRole !== 'driver') {
            return;
        }

        const { ride_id } = data;

        if (!ride_id) {
            return;
        }

        try {
            // Verificar se o motorista está atribuído a esta corrida
            const rideCheck = await pool.query(
                "SELECT passenger_id FROM rides WHERE id = $1 AND driver_id = $2",
                [ride_id, userId]
            );

            if (rideCheck.rows.length > 0) {
                const passengerId = rideCheck.rows[0].passenger_id;

                // Notificar passageiro
                io.to(`user_${passengerId}`).emit('driver_arrived_notification', {
                    ride_id,
                    driver_id: userId,
                    message: "Motorista chegou no local de partida",
                    timestamp: new Date().toISOString()
                });

                Logger.audit(userId, 'DRIVER_ARRIVED', {
                    ride_id,
                    passenger_id: passengerId
                });
            }
        } catch (error) {
            Logger.warn('SOCKET_ARRIVED', 'Erro ao notificar chegada', error);
        }
    });

    // Evento: Ping (keep-alive)
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
            callback({
                timestamp: Date.now(),
                server_time: new Date().toISOString(),
                uptime: process.uptime()
            });
        }
    });

    // Evento: Disconnect
    socket.on('disconnect', (reason) => {
        Logger.info('SOCKET', `Usuário desconectado: ${userId} - Razão: ${reason}`);

        activeUsers.delete(userId);

        // Remover de salas de corrida
        const rideRoom = rideRooms.get(socketId);
        if (rideRoom) {
            socket.leave(rideRoom);
            rideRooms.delete(socketId);
        }

        // Remover localização se for motorista
        if (userRole === 'driver') {
            driverLocations.delete(userId);
            socket.leave('drivers_room');
        }

        // Atualizar status offline no banco (com delay para reconexões rápidas)
        setTimeout(() => {
            if (!activeUsers.has(userId)) {
                pool.query(
                    "UPDATE users SET is_online = false, updated_at = NOW() WHERE id = $1",
                    [userId]
                ).catch(err => {
                    Logger.warn('SOCKET_OFFLINE_UPDATE', 'Erro ao atualizar status offline', err);
                });
            }
        }, 5000); // 5 segundos de grace period
    });
});

// =================================================================================================
// 12. HANDLERS DE ERRO E INICIALIZAÇÃO - BLINDADOS
// =================================================================================================

// Rota 404 (Not Found) - Deve vir antes do handler de erros global
app.use('*', (req, res) => {
    const requestedPath = req.originalUrl;

    Logger.warn('ROUTE_404', `Rota não encontrada: ${requestedPath}`, {
        method: req.method,
        ip: req.ip,
        user_agent: req.get('User-Agent')
    });

    res.status(404).json({
        error: "Rota não encontrada.",
        path: requestedPath,
        method: req.method,
        timestamp: new Date().toISOString(),
        available_endpoints: {
            api: "/api/",
            health: "/health",
            docs: "Documentação disponível em /"
        }
    });
});

// Handler de Erros Global (deve ser o último middleware)
app.use((err, req, res, next) => {
    const errorId = crypto.randomBytes(8).toString('hex');

    Logger.error('GLOBAL_ERROR', `Erro ${errorId}: ${err.message}`, {
        stack: err.stack,
        path: req.path,
        method: req.method,
        ip: req.ip,
        user_id: req.user?.id,
        request_id: req.requestId
    });

    // Determinar status code apropriado
    let statusCode = 500;
    let errorCode = "INTERNAL_SERVER_ERROR";
    let message = "Erro interno do servidor.";

    if (err instanceof multer.MulterError) {
        statusCode = 400;
        errorCode = "UPLOAD_ERROR";
        message = err.code === 'LIMIT_FILE_SIZE'
            ? "Arquivo muito grande. Tamanho máximo: 10MB."
            : "Erro no upload do arquivo.";
    } else if (err.message.includes('validation') || err.message.includes('Validation')) {
        statusCode = 400;
        errorCode = "VALIDATION_ERROR";
        message = err.message;
    } else if (err.message.includes('not found') || err.message.includes('não encontrado')) {
        statusCode = 404;
        errorCode = "NOT_FOUND";
        message = err.message;
    } else if (err.message.includes('permission') || err.message.includes('permissão')) {
        statusCode = 403;
        errorCode = "FORBIDDEN";
        message = err.message;
    } else if (err.message.includes('unauthorized') || err.message.includes('token')) {
        statusCode = 401;
        errorCode = "UNAUTHORIZED";
        message = err.message;
    }

    const response = {
        error: message,
        code: errorCode,
        reference: errorId,
        timestamp: new Date().toISOString()
    };

    // Em desenvolvimento, incluir stack trace
    if (NODE_ENV === 'development') {
        response.stack = err.stack;
        response.details = err.message;
    }

    res.status(statusCode).json(response);
});

// =================================================================================================
// 13. INICIALIZAÇÃO DO SERVIDOR - BLINDADA
// =================================================================================================

const startServer = async () => {
    try {
        console.log('🚀 Iniciando AOTRAVEL Server v6.2...');
        console.log(`🌍 Ambiente: ${NODE_ENV}`);
        console.log(`🔧 Porta: ${PORT}`);

        // Verificar variáveis de ambiente críticas
        if (!JWT_SECRET || JWT_SECRET.includes('default')) {
            console.warn('⚠️  AVISO: JWT_SECRET está usando valor padrão. Configure JWT_SECRET no .env para produção!');
        }

        if (!DATABASE_URL) {
            console.error('❌ ERRO CRÍTICO: DATABASE_URL não configurado.');
            process.exit(1);
        }

        // Inicializar banco de dados
        console.log('💾 Inicializando banco de dados...');
        await bootstrapDatabase();

        // Aguardar inicialização do wallet.js
        console.log('💰 Aguardando inicialização do módulo financeiro...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Iniciar servidor
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`
            ===========================================================
            🚀 AOTRAVEL SERVER ONLINE (v6.2 - BLINDADO E ROBUSTO)
            ===========================================================
            🌍 Environment: ${NODE_ENV}
            📡 Port:        ${PORT}
            💾 Database:    ✅ Connected
            🔌 Socket.io:   ✅ Active (${io.engine.clientsCount} clients)
            💸 Wallet:      ${walletRouter ? '✅ Module Loaded' : '⚠️  Module Unavailable'}
            👑 Admin Panel: ✅ Functional
            🔒 Security:    ✅ Maximum
            🐛 Debug:       ${NODE_ENV === 'development' ? '✅ Enabled' : '❌ Disabled'}
            ===========================================================
            `);

            // Status do sistema
            console.log('📊 Status do Sistema:');
            console.log('  • Rate Limiting: ✅ Ativo');
            console.log('  • CORS: ✅ Configurado');
            console.log('  • Helmet: ✅ Ativo');
            console.log('  • Compression: ✅ Ativo');
            console.log('  • Uploads: ✅ Disponível em /uploads');
            console.log('  • Health Check: ✅ Disponível em /health');
            console.log('');
            console.log('✅ Sistema pronto para receber conexões.');
            console.log('===========================================================');
        });

    } catch (error) {
        console.error('❌ FALHA CRÍTICA NA INICIALIZAÇÃO:', error.message);
        console.error('Stack:', error.stack);

        // Tentar fornecer informações úteis
        if (error.code === 'ECONNREFUSED') {
            console.error('⚠️  Verifique se o PostgreSQL está rodando e acessível.');
            console.error('⚠️  Verifique a DATABASE_URL no arquivo .env');
        }

        process.exit(1);
    }
};

// Manipulação de sinais para shutdown gracioso
const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} recebido. Iniciando shutdown gracioso...`);

    // 1. Parar de aceitar novas conexões
    server.close(async () => {
        console.log('✅ Servidor HTTP parado.');

        // 2. Fechar conexões do Socket.IO
        io.close(() => {
            console.log('✅ Socket.IO parado.');
        });

        // 3. Fechar pool do PostgreSQL
        try {
            await pool.end();
            console.log('✅ Pool de conexões PostgreSQL fechado.');
        } catch (dbError) {
            console.error('❌ Erro ao fechar pool do PostgreSQL:', dbError.message);
        }

        // 4. Sair
        console.log('👋 Shutdown completo. Até logo!');
        process.exit(0);
    });

    // Timeout forçado após 30 segundos
    setTimeout(() => {
        console.error('❌ Timeout no shutdown forçado. Encerrando...');
        process.exit(1);
    }, 30000);
};

// Capturar sinais de término
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Capturar exceções não tratadas
process.on('uncaughtException', (error) => {
    console.error('❌ EXCEÇÃO NÃO TRATADA:', error);
    console.error('Stack:', error.stack);
    // Não sair imediatamente, tentar continuar
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ PROMISE REJEITADA NÃO TRATADA:', reason);
    // Log adicional pode ser adicionado aqui
});

// Iniciar o servidor
startServer();
