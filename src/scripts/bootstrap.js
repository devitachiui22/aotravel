/**
 * =================================================================================================
 * 🛠️ DATABASE BOOTSTRAP & AUTO-MIGRATION (REVISÃO 2026.02.10)
 * =================================================================================================
 */
const { pool } = require('../config/db'); // CORREÇÃO: Extração do objeto pool
const { logSystem, logError } = require('../utils/logger');

async function bootstrapDatabase() {
    let client;
    try {
        // Agora 'pool.connect' funcionará perfeitamente
        client = await pool.connect();
        await client.query('BEGIN');

        logSystem('BOOTSTRAP', 'Iniciando verificação de integridade e migrações...');

        // 1. Tabela de Usuários (Users)
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
                bonus_points INTEGER DEFAULT 0,
                vehicle_details JSONB DEFAULT '{}'::jsonb,
                bi_front TEXT,
                bi_back TEXT,
                driving_license_front TEXT,
                driving_license_back TEXT,
                is_online BOOLEAN DEFAULT false,
                rating NUMERIC(3,2) DEFAULT 5.00,
                fcm_token TEXT,
                session_token TEXT,
                session_expiry TIMESTAMP,
                last_login TIMESTAMP,
                is_blocked BOOLEAN DEFAULT false,
                is_verified BOOLEAN DEFAULT false,
                verification_code TEXT,
                settings JSONB DEFAULT '{}'::jsonb,
                privacy_settings JSONB DEFAULT '{}'::jsonb,
                notification_preferences JSONB DEFAULT '{"ride_notifications": true, "promo_notifications": true, "chat_notifications": true}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Tabela de Corridas (Rides)
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
                negotiation_history JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                cancelled_at TIMESTAMP,
                cancelled_by TEXT,
                cancellation_reason TEXT,
                payment_method TEXT DEFAULT 'cash',
                payment_status TEXT DEFAULT 'pending'
            );
        `);

        // 3. Tabela de Chat (Chat Messages)
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                text TEXT,
                image_url TEXT,
                file_data TEXT,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                read_at TIMESTAMP
            );
        `);

        // 4. Tabela Financeira (Wallet)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount NUMERIC(15,2),
                type TEXT,
                description TEXT,
                reference_id INTEGER,
                status TEXT DEFAULT 'completed',
                metadata JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. Radar Reverso (Driver Positions)
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

        // --- SISTEMA DE MIGRAÇÃO DINÂMICA (COLUNAS CRÍTICAS) ---
        const columnsToRepair = [
            ['users', 'fcm_token', 'TEXT'],
            ['users', 'session_token', 'TEXT'],
            ['users', 'is_blocked', 'BOOLEAN DEFAULT false'],
            ['users', 'is_verified', 'BOOLEAN DEFAULT false'],
            ['rides', 'payment_method', 'TEXT DEFAULT \'cash\''],
            ['rides', 'payment_status', 'TEXT DEFAULT \'pending\''],
            ['chat_messages', 'file_data', 'TEXT'],
            ['chat_messages', 'image_url', 'TEXT'],
            ['wallet_transactions', 'status', 'TEXT DEFAULT \'completed\'']
        ];

        for (const [table, column, type] of columnsToRepair) {
            try {
                await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
            } catch (migErr) {
                // Silencioso: Coluna já existe ou erro de tabela
            }
        }

        // Índices para performance extrema
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);`);

        await client.query('COMMIT');
        logSystem(
