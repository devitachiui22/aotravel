/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - DATABASE BOOTSTRAP & SELF-HEALING ENGINE (TITANIUM HUB EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/utils/dbBootstrap.js
 * VERSÃO DO SCHEMA: 2026.03.03.HUB.COMPLETE.FINAL
 * DESCRIÇÃO: Script de inicialização com módulos Core + Hub Inteligente (Agendamento, Grupos, Entregas)
 *
 * ✅ MÓDULOS INCLUÍDOS:
 * - Core: Users, Rides, Wallet, Chat, Notifications
 * - Hub Agendamento: hub_schedules
 * - Hub Grupos: hub_groups, hub_group_participants
 * - Hub Entregas: hub_deliveries, hub_delivery_tracking
 * - KYC Completo: Documentos, Vehicle Details, Bank Accounts
 *
 * 🔑 USUÁRIOS DE TESTE (senha: 123456 para todos):
 * - Motorista Ao (driver@aotravel.com / 123456)
 * - Moto Táxi (moto@gmail.com / 123456)
 * - Passageiro VIP (passageiro@gmail.com / 123456)
 *
 * STATUS: 🔥 PRODUCTION READY - HUB INTELIGENTE ATIVO - 100% FUNCIONAL
 * =================================================================================================
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

const log = {
    info: (msg) => console.log(`${colors.blue}ℹ️${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
    section: (msg) => {
        console.log(`\n${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}`);
        console.log(`${colors.cyan}   ${msg}${colors.reset}`);
        console.log(`${colors.cyan}══════════════════════════════════════════════════════════════${colors.reset}\n`);
    }
};

async function safeQuery(client, query, params = [], description = '') {
    try {
        if (params.length > 0) {
            return await client.query(query, params);
        } else {
            return await client.query(query);
        }
    } catch (error) {
        if (error.code === '42P07' || error.code === '42701' || error.code === '42710') {
            return null;
        }
        log.error(`${description} - ${error.message}`);
        throw error;
    }
}

async function bootstrapDatabase() {
    log.section('🚀 INICIANDO BOOTSTRAP DO BANCO DE DADOS - HUB INTELIGENTE PREMIUM');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // =========================================================================================
        // ETAPA 1: CRIAÇÃO DE TODAS AS TABELAS (CORE + HUB)
        // =========================================================================================
        log.info('Criando/Verificando tabelas base...');

        // 1. TABELA USERS - COM TODAS AS COLUNAS KYC
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT UNIQUE,
                password TEXT NOT NULL,
                photo TEXT,
                role TEXT DEFAULT 'passenger' CHECK (role IN ('passenger', 'driver', 'admin')),

                -- Wallet / Financeiro
                balance NUMERIC(15,2) DEFAULT 0.00,
                wallet_account_number VARCHAR(50) UNIQUE,
                wallet_pin_hash VARCHAR(255),
                wallet_status VARCHAR(20) DEFAULT 'active',
                daily_limit NUMERIC(15,2) DEFAULT 500000.00,
                daily_limit_used NUMERIC(15,2) DEFAULT 0.00,
                last_transaction_date DATE DEFAULT CURRENT_DATE,
                account_tier VARCHAR(20) DEFAULT 'standard',
                kyc_level INTEGER DEFAULT 1,
                bonus_points INTEGER DEFAULT 0,

                -- Detalhes Motorista
                vehicle_details JSONB,
                rating NUMERIC(3,2) DEFAULT 5.00,

                -- Status
                is_online BOOLEAN DEFAULT false,
                is_blocked BOOLEAN DEFAULT false,
                is_verified BOOLEAN DEFAULT false,

                -- Documentação KYC Avançada
                bi_front TEXT,
                bi_back TEXT,
                driving_license_front TEXT,
                driving_license_back TEXT,
                vehicle_title TEXT,
                vehicle_insurance TEXT,
                tax_document TEXT,

                -- Sessão / Tokens
                fcm_token TEXT,
                session_token TEXT,
                session_expiry TIMESTAMP,
                verification_code TEXT,
                last_login TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                -- Configurações
                settings JSONB DEFAULT '{}',
                privacy_settings JSONB DEFAULT '{}',
                notification_preferences JSONB DEFAULT '{"ride_notifications": true, "promo_notifications": true, "chat_notifications": true}',

                -- Timestamps
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE users');

        // 2. TABELA DRIVER_POSITIONS
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS driver_positions (
                driver_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                lat DOUBLE PRECISION NOT NULL DEFAULT 0,
                lng DOUBLE PRECISION NOT NULL DEFAULT 0,
                heading DOUBLE PRECISION DEFAULT 0,
                speed DOUBLE PRECISION DEFAULT 0,
                accuracy DOUBLE PRECISION DEFAULT 0,
                socket_id VARCHAR(100),
                status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy', 'away')),
                last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE driver_positions');

        // 3. TABELA RIDES
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS rides (
                id SERIAL PRIMARY KEY,
                passenger_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                origin_lat DOUBLE PRECISION NOT NULL,
                origin_lng DOUBLE PRECISION NOT NULL,
                dest_lat DOUBLE PRECISION NOT NULL,
                dest_lng DOUBLE PRECISION NOT NULL,
                origin_name TEXT,
                dest_name TEXT,
                initial_price NUMERIC(15,2) NOT NULL,
                final_price NUMERIC(15,2),
                negotiation_history JSONB DEFAULT '[]',
                ride_type VARCHAR(20) DEFAULT 'ride' CHECK (ride_type IN ('ride', 'moto', 'delivery')),
                distance_km NUMERIC(10,2),
                status VARCHAR(20) DEFAULT 'searching' CHECK (status IN ('searching', 'accepted', 'arrived', 'ongoing', 'completed', 'cancelled')),
                payment_method VARCHAR(20) DEFAULT 'cash' CHECK (payment_method IN ('cash', 'wallet', 'card')),
                payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
                rating INTEGER CHECK (rating >= 1 AND rating <= 5),
                feedback TEXT,
                cancelled_by VARCHAR(20),
                cancellation_reason TEXT,
                accepted_at TIMESTAMP,
                arrived_at TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                cancelled_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE rides');

        // 4. TABELA WALLET_TRANSACTIONS
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                reference_id VARCHAR(100) UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                receiver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                ride_id INTEGER REFERENCES rides(id) ON DELETE SET NULL,
                amount NUMERIC(15,2) NOT NULL,
                fee NUMERIC(15,2) DEFAULT 0.00,
                balance_before NUMERIC(15,2),
                balance_after NUMERIC(15,2),
                currency VARCHAR(3) DEFAULT 'AOA',
                type VARCHAR(50) CHECK (type IN ('topup', 'withdraw', 'payment', 'earnings', 'refund', 'bonus', 'transfer', 'adjustment', 'bill_payment')),
                method VARCHAR(50) DEFAULT 'internal' CHECK (method IN ('cash', 'wallet', 'card', 'transfer', 'internal', 'admin_override', 'bank_transfer')),
                status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
                description TEXT,
                category VARCHAR(50) DEFAULT 'general',
                metadata JSONB DEFAULT '{}',
                is_hidden BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE wallet_transactions');

        // 5. TABELA USER_SESSIONS
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                session_token TEXT UNIQUE NOT NULL,
                device_info JSONB,
                device_id TEXT,
                ip_address VARCHAR(45),
                fcm_token TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE user_sessions');

        // 6. TABELA CHAT_MESSAGES (Base)
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'location', 'payment')),
                text TEXT,
                image_url TEXT,
                location_lat DOUBLE PRECISION,
                location_lng DOUBLE PRECISION,
                is_read BOOLEAN DEFAULT false,
                read_at TIMESTAMP,
                module_type VARCHAR(20) DEFAULT 'ride',
                module_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE chat_messages');

        // 7. TABELA NOTIFICATIONS
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(50),
                title VARCHAR(255),
                body TEXT,
                data JSONB DEFAULT '{}',
                is_read BOOLEAN DEFAULT false,
                read_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE notifications');

        // 8. TABELA APP_SETTINGS
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS app_settings (
                key VARCHAR(100) PRIMARY KEY,
                value JSONB NOT NULL,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE app_settings');

        // 9. TABELA VEHICLE_DETAILS
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS vehicle_details (
                id SERIAL PRIMARY KEY,
                driver_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                model VARCHAR(100),
                plate VARCHAR(20),
                color VARCHAR(50),
                type VARCHAR(50) DEFAULT 'car' CHECK (type IN ('car', 'moto', 'delivery', 'truck')),
                year INTEGER,
                documents_verified BOOLEAN DEFAULT false,
                insurance_expiry DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE vehicle_details');

        // 10. TABELA USER_DOCUMENTS
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS user_documents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                document_type TEXT NOT NULL CHECK (document_type IN ('bi', 'driving_license', 'passport', 'vehicle_title', 'vehicle_insurance', 'tax_document')),
                front_image TEXT,
                back_image TEXT,
                status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
                verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                verified_at TIMESTAMP,
                rejection_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, document_type)
            );
        `, [], 'CREATE TABLE user_documents');

        // 11. TABELA EXTERNAL_BANK_ACCOUNTS
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS external_bank_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                bank_name VARCHAR(100) NOT NULL,
                iban VARCHAR(50) NOT NULL,
                holder_name VARCHAR(150) NOT NULL,
                is_verified BOOLEAN DEFAULT FALSE,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE external_bank_accounts');

        // 12. TABELA ADMIN_REPORTS
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS admin_reports (
                id SERIAL PRIMARY KEY,
                report_type TEXT NOT NULL,
                data JSONB NOT NULL,
                generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE admin_reports');

        // =====================================================================
        // 🏗️ NOVAS TABELAS DO HUB INTELIGENTE
        // =====================================================================

        // 13. AGENDAMENTO DE VIAGENS (Scheduled Rides)
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS hub_schedules (
                id SERIAL PRIMARY KEY,
                passenger_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                origin_name TEXT NOT NULL,
                origin_lat DOUBLE PRECISION NOT NULL,
                origin_lng DOUBLE PRECISION NOT NULL,
                dest_name TEXT NOT NULL,
                dest_lat DOUBLE PRECISION NOT NULL,
                dest_lng DOUBLE PRECISION NOT NULL,
                scheduled_time TIMESTAMP NOT NULL,
                proposed_price NUMERIC(15,2) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'active', 'completed', 'cancelled')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE hub_schedules');

        // 14. VIAGENS EM GRUPO (Group Rides)
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS hub_groups (
                id SERIAL PRIMARY KEY,
                creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                origin_name TEXT NOT NULL,
                origin_lat DOUBLE PRECISION NOT NULL,
                origin_lng DOUBLE PRECISION NOT NULL,
                dest_name TEXT NOT NULL,
                dest_lat DOUBLE PRECISION NOT NULL,
                dest_lng DOUBLE PRECISION NOT NULL,
                departure_time TIMESTAMP NOT NULL,
                price_per_seat NUMERIC(15,2) NOT NULL,
                total_seats INTEGER NOT NULL,
                available_seats INTEGER NOT NULL,
                status VARCHAR(20) DEFAULT 'gathering' CHECK (status IN ('gathering', 'full', 'active', 'completed', 'cancelled')),
                is_private BOOLEAN DEFAULT true,
                total_fare NUMERIC(15,2) DEFAULT 0.00,
                split_fare NUMERIC(15,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE hub_groups');

        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS hub_group_participants (
                group_id INTEGER REFERENCES hub_groups(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                seats_reserved INTEGER DEFAULT 1,
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
                payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (group_id, user_id)
            );
        `, [], 'CREATE TABLE hub_group_participants');

        // 15. ENTREGAS COM RASTREIO REAL (Deliveries)
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS hub_deliveries (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                pickup_name TEXT NOT NULL,
                pickup_lat DOUBLE PRECISION NOT NULL,
                pickup_lng DOUBLE PRECISION NOT NULL,
                dropoff_name TEXT NOT NULL,
                dropoff_lat DOUBLE PRECISION NOT NULL,
                dropoff_lng DOUBLE PRECISION NOT NULL,
                recipient_name TEXT NOT NULL,
                recipient_phone TEXT NOT NULL,
                package_details TEXT,
                price NUMERIC(15,2) NOT NULL,
                status VARCHAR(20) DEFAULT 'searching' CHECK (status IN ('searching', 'accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled')),
                proof_image_url TEXT,
                stops JSONB DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE hub_deliveries');

        // 16. PERSISTÊNCIA DE RASTREIO (No Polling, real persist)
        await safeQuery(client, `
            CREATE TABLE IF NOT EXISTS hub_delivery_tracking (
                id SERIAL PRIMARY KEY,
                delivery_id INTEGER REFERENCES hub_deliveries(id) ON DELETE CASCADE,
                lat DOUBLE PRECISION NOT NULL,
                lng DOUBLE PRECISION NOT NULL,
                status_at_time VARCHAR(20),
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `, [], 'CREATE TABLE hub_delivery_tracking');

        log.success('✅ Todas as tabelas (Core + Hub) criadas/verificadas com sucesso');

        // =========================================================================================
        // ETAPA 2: AUTO-HEALING - ADICIONAR COLUNAS FALTANTES (KYC + HUB)
        // =========================================================================================
        log.section('🔧 EXECUTANDO AUTO-HEALING (VERIFICAÇÃO DE COLUNAS)');

        const schemaRepairs = [
            // ✅ KYC COLUMNS - VEHICLE TITLE, INSURANCE, TAX DOCUMENT
            { table: 'users', col: 'vehicle_title', type: 'TEXT' },
            { table: 'users', col: 'vehicle_insurance', type: 'TEXT' },
            { table: 'users', col: 'tax_document', type: 'TEXT' },

            // ✅ OTHER KYC COLUMNS
            { table: 'users', col: 'bi_front', type: 'TEXT' },
            { table: 'users', col: 'bi_back', type: 'TEXT' },
            { table: 'users', col: 'driving_license_front', type: 'TEXT' },
            { table: 'users', col: 'driving_license_back', type: 'TEXT' },
            { table: 'users', col: 'last_login', type: 'TIMESTAMP' },
            { table: 'users', col: 'last_seen', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
            { table: 'users', col: 'wallet_account_number', type: 'VARCHAR(50) UNIQUE' },
            { table: 'users', col: 'wallet_pin_hash', type: 'VARCHAR(255)' },
            { table: 'users', col: 'wallet_status', type: "VARCHAR(20) DEFAULT 'active'" },
            { table: 'users', col: 'daily_limit', type: 'NUMERIC(15,2) DEFAULT 500000.00' },
            { table: 'users', col: 'daily_limit_used', type: 'NUMERIC(15,2) DEFAULT 0.00' },
            { table: 'users', col: 'last_transaction_date', type: 'DATE DEFAULT CURRENT_DATE' },
            { table: 'users', col: 'account_tier', type: "VARCHAR(20) DEFAULT 'standard'" },
            { table: 'users', col: 'kyc_level', type: 'INTEGER DEFAULT 1' },
            { table: 'users', col: 'bonus_points', type: 'INTEGER DEFAULT 0' },
            { table: 'users', col: 'vehicle_details', type: 'JSONB' },
            { table: 'users', col: 'rating', type: 'NUMERIC(3,2) DEFAULT 5.00' },
            { table: 'users', col: 'is_online', type: 'BOOLEAN DEFAULT false' },
            { table: 'users', col: 'is_blocked', type: 'BOOLEAN DEFAULT false' },
            { table: 'users', col: 'is_verified', type: 'BOOLEAN DEFAULT false' },
            { table: 'users', col: 'fcm_token', type: 'TEXT' },
            { table: 'users', col: 'session_token', type: 'TEXT' },
            { table: 'users', col: 'session_expiry', type: 'TIMESTAMP' },
            { table: 'users', col: 'verification_code', type: 'TEXT' },
            { table: 'users', col: 'settings', type: "JSONB DEFAULT '{}'" },
            { table: 'users', col: 'privacy_settings', type: "JSONB DEFAULT '{}'" },
            { table: 'users', col: 'notification_preferences', type: "JSONB DEFAULT '{\"ride_notifications\": true, \"promo_notifications\": true, \"chat_notifications\": true}'" },

            // Driver positions columns
            { table: 'driver_positions', col: 'heading', type: 'DOUBLE PRECISION DEFAULT 0' },
            { table: 'driver_positions', col: 'speed', type: 'DOUBLE PRECISION DEFAULT 0' },
            { table: 'driver_positions', col: 'accuracy', type: 'DOUBLE PRECISION DEFAULT 0' },
            { table: 'driver_positions', col: 'socket_id', type: 'VARCHAR(100)' },

            // Rides columns
            { table: 'rides', col: 'negotiation_history', type: "JSONB DEFAULT '[]'" },
            { table: 'rides', col: 'payment_method', type: "VARCHAR(20) DEFAULT 'cash'" },
            { table: 'rides', col: 'payment_status', type: "VARCHAR(20) DEFAULT 'pending'" },
            { table: 'rides', col: 'accepted_at', type: 'TIMESTAMP' },
            { table: 'rides', col: 'arrived_at', type: 'TIMESTAMP' },
            { table: 'rides', col: 'started_at', type: 'TIMESTAMP' },
            { table: 'rides', col: 'completed_at', type: 'TIMESTAMP' },
            { table: 'rides', col: 'cancelled_at', type: 'TIMESTAMP' },
            { table: 'rides', col: 'cancelled_by', type: 'VARCHAR(20)' },
            { table: 'rides', col: 'cancellation_reason', type: 'TEXT' },

            // Wallet transactions columns
            { table: 'wallet_transactions', col: 'ride_id', type: 'INTEGER REFERENCES rides(id) ON DELETE SET NULL' },
            { table: 'wallet_transactions', col: 'fee', type: 'NUMERIC(15,2) DEFAULT 0.00' },
            { table: 'wallet_transactions', col: 'balance_before', type: 'NUMERIC(15,2)' },
            { table: 'wallet_transactions', col: 'balance_after', type: 'NUMERIC(15,2)' },
            { table: 'wallet_transactions', col: 'currency', type: "VARCHAR(3) DEFAULT 'AOA'" },
            { table: 'wallet_transactions', col: 'method', type: "VARCHAR(50) DEFAULT 'internal'" },
            { table: 'wallet_transactions', col: 'category', type: "VARCHAR(50) DEFAULT 'general'" },
            { table: 'wallet_transactions', col: 'metadata', type: "JSONB DEFAULT '{}'" },
            { table: 'wallet_transactions', col: 'is_hidden', type: 'BOOLEAN DEFAULT FALSE' },
            { table: 'wallet_transactions', col: 'completed_at', type: 'TIMESTAMP' },

            // Chat messages columns - Adicionar suporte ao Hub
            { table: 'chat_messages', col: 'module_type', type: "VARCHAR(20) DEFAULT 'ride'" },
            { table: 'chat_messages', col: 'module_id', type: 'INTEGER' },
            { table: 'chat_messages', col: 'message_type', type: "VARCHAR(20) DEFAULT 'text'" },
            { table: 'chat_messages', col: 'image_url', type: 'TEXT' },
            { table: 'chat_messages', col: 'location_lat', type: 'DOUBLE PRECISION' },
            { table: 'chat_messages', col: 'location_lng', type: 'DOUBLE PRECISION' },
            { table: 'chat_messages', col: 'read_at', type: 'TIMESTAMP' },

            // User sessions columns
            { table: 'user_sessions', col: 'device_id', type: 'TEXT' },
            { table: 'user_sessions', col: 'fcm_token', type: 'TEXT' },
            { table: 'user_sessions', col: 'last_activity', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },

            // Hub tables columns (auto-healing adicional)
            { table: 'hub_schedules', col: 'driver_id', type: 'INTEGER REFERENCES users(id) ON DELETE SET NULL' },

            // Hub Groups - Novas colunas
            { table: 'hub_groups', col: 'is_private', type: 'BOOLEAN DEFAULT true' },
            { table: 'hub_groups', col: 'total_fare', type: 'NUMERIC(15,2) DEFAULT 0.00' },
            { table: 'hub_groups', col: 'split_fare', type: 'NUMERIC(15,2) DEFAULT 0.00' },
            { table: 'hub_groups', col: 'driver_id', type: 'INTEGER REFERENCES users(id) ON DELETE SET NULL' },

            // Hub Group Participants - Novas colunas
            { table: 'hub_group_participants', col: 'status', type: "VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected'))" },
            { table: 'hub_group_participants', col: 'payment_status', type: "VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed'))" },

            // Hub Deliveries - Nova coluna
            { table: 'hub_deliveries', col: 'stops', type: "JSONB DEFAULT '[]'" },
            { table: 'hub_deliveries', col: 'driver_id', type: 'INTEGER REFERENCES users(id) ON DELETE SET NULL' },
            { table: 'hub_deliveries', col: 'proof_image_url', type: 'TEXT' },

            { table: 'hub_delivery_tracking', col: 'status_at_time', type: 'VARCHAR(20)' }
        ];

        let repairedCount = 0;
        for (const repair of schemaRepairs) {
            try {
                await client.query(`ALTER TABLE ${repair.table} ADD COLUMN IF NOT EXISTS ${repair.col} ${repair.type}`);
                repairedCount++;
            } catch (err) {
                if (err.code !== '42701') {
                    log.warn(`Erro ao adicionar ${repair.table}.${repair.col}: ${err.message}`);
                }
            }
        }
        log.success(`✅ Auto-healing concluído: ${repairedCount} colunas verificadas`);

        // =========================================================================================
        // ETAPA 3: CRIAÇÃO DE ÍNDICES (CORE + HUB)
        // =========================================================================================
        log.section('⚡ OTIMIZANDO COM ÍNDICES DE PERFORMANCE');

        const indexes = [
            // Índices Users
            "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
            "CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)",
            "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)",
            "CREATE INDEX IF NOT EXISTS idx_users_online ON users(is_online) WHERE is_online = true",
            "CREATE INDEX IF NOT EXISTS idx_users_session ON users(session_token) WHERE session_token IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS idx_users_verified ON users(is_verified) WHERE is_verified = false",

            // Índices Driver Positions
            "CREATE INDEX IF NOT EXISTS idx_driver_positions_status ON driver_positions(status)",
            "CREATE INDEX IF NOT EXISTS idx_driver_positions_update ON driver_positions(last_update)",
            "CREATE INDEX IF NOT EXISTS idx_driver_positions_geo ON driver_positions(lat, lng)",
            "CREATE INDEX IF NOT EXISTS idx_driver_positions_socket ON driver_positions(socket_id)",

            // Índices Rides
            "CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id)",
            "CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id)",
            "CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status)",
            "CREATE INDEX IF NOT EXISTS idx_rides_created ON rides(created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_rides_passenger_status ON rides(passenger_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_rides_driver_status ON rides(driver_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_rides_type ON rides(ride_type)",

            // Índices Wallet
            "CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_wallet_ref ON wallet_transactions(reference_id)",
            "CREATE INDEX IF NOT EXISTS idx_wallet_date ON wallet_transactions(created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_wallet_status ON wallet_transactions(status)",

            // Índices Chat
            "CREATE INDEX IF NOT EXISTS idx_chat_ride ON chat_messages(ride_id)",
            "CREATE INDEX IF NOT EXISTS idx_chat_module ON chat_messages(module_type, module_id)",
            "CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at)",

            // Índices Sessions
            "CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at)",

            // Índices Notifications
            "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read)",

            // Índices Documents
            "CREATE INDEX IF NOT EXISTS idx_documents_user ON user_documents(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_documents_status ON user_documents(status)",

            // 🆕 ÍNDICES HUB INTELIGENTE
            "CREATE INDEX IF NOT EXISTS idx_hub_schedules_passenger ON hub_schedules(passenger_id)",
            "CREATE INDEX IF NOT EXISTS idx_hub_schedules_driver ON hub_schedules(driver_id)",
            "CREATE INDEX IF NOT EXISTS idx_hub_schedules_time ON hub_schedules(scheduled_time)",
            "CREATE INDEX IF NOT EXISTS idx_hub_schedules_status ON hub_schedules(status)",

            "CREATE INDEX IF NOT EXISTS idx_hub_groups_creator ON hub_groups(creator_id)",
            "CREATE INDEX IF NOT EXISTS idx_hub_groups_driver ON hub_groups(driver_id)",
            "CREATE INDEX IF NOT EXISTS idx_hub_groups_departure ON hub_groups(departure_time)",
            "CREATE INDEX IF NOT EXISTS idx_hub_groups_status ON hub_groups(status)",
            "CREATE INDEX IF NOT EXISTS idx_hub_groups_available ON hub_groups(available_seats) WHERE available_seats > 0",
            "CREATE INDEX IF NOT EXISTS idx_hub_groups_private ON hub_groups(is_private)",

            "CREATE INDEX IF NOT EXISTS idx_hub_participants_group ON hub_group_participants(group_id)",
            "CREATE INDEX IF NOT EXISTS idx_hub_participants_user ON hub_group_participants(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_hub_participants_status ON hub_group_participants(status)",
            "CREATE INDEX IF NOT EXISTS idx_hub_participants_payment ON hub_group_participants(payment_status)",

            "CREATE INDEX IF NOT EXISTS idx_hub_deliveries_sender ON hub_deliveries(sender_id)",
            "CREATE INDEX IF NOT EXISTS idx_hub_deliveries_driver ON hub_deliveries(driver_id)",
            "CREATE INDEX IF NOT EXISTS idx_hub_deliveries_status ON hub_deliveries(status)",
            "CREATE INDEX IF NOT EXISTS idx_hub_deliveries_created ON hub_deliveries(created_at DESC)",

            "CREATE INDEX IF NOT EXISTS idx_hub_tracking_delivery ON hub_delivery_tracking(delivery_id)",
            "CREATE INDEX IF NOT EXISTS idx_hub_tracking_recorded ON hub_delivery_tracking(recorded_at DESC)"
        ];

        for (const idx of indexes) {
            await safeQuery(client, idx, [], 'CREATE INDEX');
        }
        log.success('✅ Índices de performance criados/verificados');

        // =========================================================================================
        // ETAPA 4: CRIAÇÃO DE TRIGGERS
        // =========================================================================================
        log.section('🔄 CONFIGURANDO TRIGGERS AUTOMÁTICOS');

        await safeQuery(client, `
            CREATE OR REPLACE FUNCTION update_timestamp_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ language 'plpgsql';
        `, [], 'CREATE FUNCTION update_timestamp_column');

        const tablesWithTimestamp = [
            'users', 'rides', 'wallet_transactions', 'vehicle_details',
            'user_documents', 'external_bank_accounts', 'app_settings',
            'hub_schedules', 'hub_groups', 'hub_deliveries'
        ];

        for (const table of tablesWithTimestamp) {
            await safeQuery(client, `
                DROP TRIGGER IF EXISTS update_${table}_modtime ON ${table};
                CREATE TRIGGER update_${table}_modtime
                BEFORE UPDATE ON ${table}
                FOR EACH ROW
                EXECUTE PROCEDURE update_timestamp_column();
            `, [], `CREATE TRIGGER ${table}`);
        }

        await safeQuery(client, `
            CREATE OR REPLACE FUNCTION generate_wallet_number()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.wallet_account_number IS NULL THEN
                    NEW.wallet_account_number := 'AOT' || LPAD(NEW.id::TEXT, 8, '0');
                END IF;
                RETURN NEW;
            END;
            $$ language 'plpgsql';
        `, [], 'CREATE FUNCTION generate_wallet_number');

        await safeQuery(client, `
            DROP TRIGGER IF EXISTS set_wallet_number ON users;
            CREATE TRIGGER set_wallet_number
            BEFORE INSERT ON users
            FOR EACH ROW
            EXECUTE PROCEDURE generate_wallet_number();
        `, [], 'CREATE TRIGGER set_wallet_number');

        log.success('✅ Triggers configurados com sucesso');

        // =========================================================================================
        // ETAPA 5: CONFIGURAÇÕES INICIAIS (COM CONFIGURAÇÕES DO HUB)
        // =========================================================================================
        log.section('⚙️ APLICANDO CONFIGURAÇÕES INICIAIS');

        const defaultSettings = [
            {
                key: 'ride_prices',
                value: JSON.stringify({
                    base_price: 600,
                    km_rate: 300,
                    moto_base: 400,
                    moto_km_rate: 180,
                    delivery_base: 1000,
                    delivery_km_rate: 450
                }),
                description: 'Tabela de preços base das corridas'
            },
            {
                key: 'app_config',
                value: JSON.stringify({
                    max_radius_km: 15,
                    driver_timeout_minutes: 30,
                    ride_search_timeout: 60,
                    version: '11.5.0',
                    kyc_required: true,
                    hub_enabled: true
                }),
                description: 'Configurações globais do app'
            },
            {
                key: 'kyc_requirements',
                value: JSON.stringify({
                    required_documents: ['bi', 'driving_license', 'vehicle_title', 'vehicle_insurance', 'tax_document'],
                    min_kyc_level: 2,
                    auto_approve: false
                }),
                description: 'Requisitos KYC para motoristas'
            },
            {
                key: 'hub_config',
                value: JSON.stringify({
                    schedules_enabled: true,
                    groups_enabled: true,
                    deliveries_enabled: true,
                    max_group_seats: 8,
                    schedule_advance_days: 30,
                    delivery_tracking_interval: 10,
                    group_gathering_timeout_minutes: 120,
                    private_group_enabled: true,
                    fare_splitting_enabled: true
                }),
                description: 'Configurações do Hub Inteligente'
            }
        ];

        for (const setting of defaultSettings) {
            await client.query(`
                INSERT INTO app_settings (key, value, description, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (key) DO UPDATE SET
                    value = EXCLUDED.value,
                    description = EXCLUDED.description,
                    updated_at = NOW()
            `, [setting.key, setting.value, setting.description]);
        }
        log.success('✅ Configurações iniciais aplicadas');

        // =========================================================================================
        // ETAPA 6: POPULAR COM USUÁRIOS DE TESTE
        // =========================================================================================
        log.section('👤 CRIANDO USUÁRIOS DE TESTE');

        const saltRounds = 10;
        const testPassword = '123456';
        const hashedPassword = await bcrypt.hash(testPassword, saltRounds);

        log.info('Senha de teste: 123456 (hash gerado automaticamente)');

        const testUsers = [
            {
                name: 'Motorista Ao',
                email: 'driver@aotravel.com',
                phone: '923456789',
                password: hashedPassword,
                role: 'driver',
                rating: 4.9,
                is_verified: true,
                kyc_level: 2,
                vehicle_details: JSON.stringify({
                    model: 'Toyota Corolla',
                    plate: 'LD-12-34-AB',
                    color: 'Preto',
                    type: 'car',
                    year: 2024
                })
            },
            {
                name: 'Moto Táxi',
                email: 'moto@gmail.com',
                phone: '987654321',
                password: hashedPassword,
                role: 'driver',
                rating: 4.8,
                is_verified: true,
                kyc_level: 2,
                vehicle_details: JSON.stringify({
                    model: 'Honda CG 160',
                    plate: 'LD-56-78-CD',
                    color: 'Vermelha',
                    type: 'moto',
                    year: 2024
                })
            },
            {
                name: 'Passageiro VIP',
                email: 'passageiro@gmail.com',
                phone: '912345678',
                password: hashedPassword,
                role: 'passenger',
                rating: 4.7,
                is_verified: true,
                kyc_level: 1
            }
        ];

        for (const user of testUsers) {
            // Verificar se o usuário já existe pelo email
            const existing = await client.query(
                'SELECT id FROM users WHERE email = $1 OR phone = $2',
                [user.email, user.phone]
            );

            let userId;

            if (existing.rows.length > 0) {
                // ✅ Usuário existe, fazer UPDATE
                const result = await client.query(
                    `UPDATE users SET
                        name = $1, password = $2, role = $3, rating = $4,
                        is_verified = $5, kyc_level = $6, vehicle_details = $7, updated_at = NOW()
                     WHERE id = $8 RETURNING id`,
                    [
                        user.name,
                        user.password,
                        user.role,
                        user.rating,
                        user.is_verified,
                        user.kyc_level,
                        user.vehicle_details || null,
                        existing.rows[0].id
                    ]
                );
                userId = result.rows[0].id;
                log.info(`👤 Usuário atualizado: ${user.name}`);
            } else {
                // ✅ Usuário não existe, fazer INSERT
                const result = await client.query(
                    `INSERT INTO users
                     (name, email, phone, password, role, rating, is_verified, kyc_level, vehicle_details, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                     RETURNING id`,
                    [
                        user.name,
                        user.email,
                        user.phone,
                        user.password,
                        user.role,
                        user.rating,
                        user.is_verified,
                        user.kyc_level,
                        user.vehicle_details || null
                    ]
                );
                userId = result.rows[0].id;
                log.success(`✅ Novo usuário criado: ${user.name}`);
            }

            // ✅ Verificar se userId existe antes de prosseguir
            if (!userId) {
                log.error(`❌ ERRO: Não foi possível obter ID para o usuário ${user.name}`);
                continue;
            }

            // Atualizar número da conta da wallet
            const accountNumber = `AOT${userId.toString().padStart(8, '0')}`;
            await client.query(
                'UPDATE users SET wallet_account_number = $1 WHERE id = $2',
                [accountNumber, userId]
            );

            // ✅ Inserir em driver_positions apenas se for motorista
            if (user.role === 'driver') {
                await client.query(`
                    INSERT INTO driver_positions (driver_id, lat, lng, status, last_update)
                    VALUES ($1, -8.8399, 13.2894, 'offline', NOW())
                    ON CONFLICT (driver_id) DO UPDATE SET
                        lat = EXCLUDED.lat,
                        lng = EXCLUDED.lng,
                        last_update = NOW()
                `, [userId]);

                // ✅ Inserir em vehicle_details apenas se tiver dados
                if (user.vehicle_details) {
                    try {
                        const vd = JSON.parse(user.vehicle_details);
                        await client.query(`
                            INSERT INTO vehicle_details (driver_id, model, plate, color, type, year)
                            VALUES ($1, $2, $3, $4, $5, $6)
                            ON CONFLICT (driver_id) DO UPDATE SET
                                model = EXCLUDED.model,
                                plate = EXCLUDED.plate,
                                color = EXCLUDED.color,
                                type = EXCLUDED.type,
                                year = EXCLUDED.year
                        `, [userId, vd.model, vd.plate, vd.color, vd.type, vd.year]);
                    } catch (e) {
                        log.warn(`⚠️ Erro ao processar vehicle_details para usuário ${userId}: ${e.message}`);
                    }
                }
            }
        }

        // =========================================================================================
        // ETAPA 7: CRIAR DADOS DE EXEMPLO PARA O HUB
        // =========================================================================================
        log.section('📦 CRIANDO DADOS DE EXEMPLO PARA O HUB');

        // Buscar IDs dos usuários de teste
        const users = await client.query(`
            SELECT id, name, email, role FROM users
            WHERE email IN ('driver@aotravel.com', 'moto@gmail.com', 'passageiro@gmail.com')
        `);

        const driverAo = users.rows.find(u => u.email === 'driver@aotravel.com');
        const moto = users.rows.find(u => u.email === 'moto@gmail.com');
        const passageiro = users.rows.find(u => u.email === 'passageiro@gmail.com');

        // Criar um agendamento de exemplo
        if (passageiro && driverAo) {
            const scheduledTime = new Date();
            scheduledTime.setHours(scheduledTime.getHours() + 24); // Amanhã

            await client.query(`
                INSERT INTO hub_schedules
                (passenger_id, driver_id, origin_name, origin_lat, origin_lng,
                 dest_name, dest_lat, dest_lng, scheduled_time, proposed_price, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT DO NOTHING
            `, [
                passageiro.id, driverAo.id,
                'Talatona', -8.9167, 13.2667,
                'Mutamba', -8.8383, 13.2344,
                scheduledTime, 3500.00, 'pending'
            ]);
            log.success('✅ Agendamento de exemplo criado');
        }

        // Criar um grupo de viagem de exemplo com as novas colunas
        if (driverAo) {
            const departureTime = new Date();
            departureTime.setHours(departureTime.getHours() + 2); // Daqui a 2 horas

            const groupResult = await client.query(`
                INSERT INTO hub_groups
                (creator_id, driver_id, origin_name, origin_lat, origin_lng,
                 dest_name, dest_lat, dest_lng, departure_time,
                 price_per_seat, total_seats, available_seats, status,
                 is_private, total_fare, split_fare)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING id
            `, [
                driverAo.id, driverAo.id,
                'Benfica', -8.9689, 13.2767,
                'Kilamba', -9.0167, 13.2667,
                departureTime,
                800.00, 4, 3, 'gathering',
                false, 3200.00, 800.00
            ]);

            if (groupResult.rows.length > 0) {
                const groupId = groupResult.rows[0].id;

                // Adicionar participantes de exemplo com os novos campos
                if (passageiro) {
                    await client.query(`
                        INSERT INTO hub_group_participants (group_id, user_id, seats_reserved, status, payment_status)
                        VALUES ($1, $2, 1, 'accepted', 'pending')
                        ON CONFLICT DO NOTHING
                    `, [groupId, passageiro.id]);

                    // Atualizar assentos disponíveis
                    await client.query(`
                        UPDATE hub_groups SET available_seats = available_seats - 1
                        WHERE id = $1
                    `, [groupId]);
                }

                log.success('✅ Grupo de viagem de exemplo criado com rateio privado');
            }
        }

        // Criar uma entrega de exemplo com stops (paragens)
        if (passageiro && moto) {
            const stops = JSON.stringify([
                {
                    name: 'Paragem 1 - Supermercado',
                    lat: -8.9167,
                    lng: 13.2667,
                    address: 'Supermercado Kero - Talatona'
                },
                {
                    name: 'Paragem 2 - Farmácia',
                    lat: -8.9250,
                    lng: 13.2500,
                    address: 'Farmácia Talatona'
                }
            ]);

            await client.query(`
                INSERT INTO hub_deliveries
                (sender_id, driver_id, pickup_name, pickup_lat, pickup_lng,
                 dropoff_name, dropoff_lat, dropoff_lng,
                 recipient_name, recipient_phone, package_details, price, status,
                 stops)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT DO NOTHING
            `, [
                passageiro.id, moto.id,
                'Shopping Kilamba', -8.9167, 13.2667,
                'Talatona', -8.9358, 13.2147,
                'João Cliente', '923456789', 'Documentos importantes com paragens', 1500.00, 'accepted',
                stops
            ]);
            log.success('✅ Entrega de exemplo criada com suporte a paragens');
        }

        await client.query('COMMIT');

        const stats = await client.query(`
            SELECT
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'driver') as total_drivers,
                (SELECT COUNT(*) FROM users WHERE role = 'passenger') as total_passengers,
                (SELECT COUNT(*) FROM users WHERE is_verified = false) as pending_kyc,
                (SELECT COUNT(*) FROM hub_schedules) as total_schedules,
                (SELECT COUNT(*) FROM hub_groups) as total_groups,
                (SELECT COUNT(*) FROM hub_deliveries) as total_deliveries,
                (SELECT COUNT(*) FROM hub_group_participants WHERE status = 'pending') as pending_participants,
                (SELECT COUNT(*) FROM hub_deliveries WHERE stops != '[]') as deliveries_with_stops
        `);

        log.section('🎉 BANCO DE DADOS INICIALIZADO COM SUCESSO - HUB INTELIGENTE ATIVO');
        log.info(`📊 Estatísticas:`);
        log.info(`   - Usuários: ${stats.rows[0].total_users}`);
        log.info(`   - Motoristas: ${stats.rows[0].total_drivers}`);
        log.info(`   - Passageiros: ${stats.rows[0].total_passengers}`);
        log.info(`   - Pendentes KYC: ${stats.rows[0].pending_kyc}`);
        log.info(`   - Agendamentos: ${stats.rows[0].total_schedules}`);
        log.info(`   - Grupos: ${stats.rows[0].total_groups}`);
        log.info(`   - Entregas: ${stats.rows[0].total_deliveries}`);
        log.info(`   - Participantes Pendentes: ${stats.rows[0].pending_participants}`);
        log.info(`   - Entregas com Paragens: ${stats.rows[0].deliveries_with_stops}`);

        return true;

    } catch (error) {
        await client.query('ROLLBACK');
        log.error(`❌ ERRO FATAL NO BOOTSTRAP: ${error.message}`);
        console.error(error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { bootstrapDatabase };
