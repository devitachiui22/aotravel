/**
 * =================================================================================================
 * 🔄 AOTRAVEL SERVER PRO - DATABASE BOOTSTRAP & MIGRATION ENGINE
 * =================================================================================================
 *
 * ARQUIVO: src/utils/dbBootstrap.js
 * DESCRIÇÃO: Script responsável pela inicialização do schema do banco de dados.
 *            Executa a criação de tabelas se não existirem e aplica migrações de reparo
 *            para garantir que todas as colunas necessárias (do server.js e wallet.js) existam.
 *
 * STATUS: PRODUCTION READY - AUTO HEALING ENABLED
 * =================================================================================================
 */

const pool = require('../config/db');
const { logSystem, logError } = require('./helpers');

async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        logSystem('BOOTSTRAP', 'Verificando integridade das tabelas e aplicando migrações...');

        // 1. TABELA DE USUÁRIOS
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

                -- Colunas Financeiras (Wallet Integration)
                wallet_account_number VARCHAR(50) UNIQUE,
                wallet_pin_hash VARCHAR(255),
                wallet_status VARCHAR(20) DEFAULT 'active',
                daily_limit NUMERIC(15, 2) DEFAULT 500000.00,
                daily_limit_used NUMERIC(15, 2) DEFAULT 0.00,
                last_transaction_date DATE DEFAULT CURRENT_DATE,
                account_tier VARCHAR(20) DEFAULT 'standard',
                kyc_level INTEGER DEFAULT 1,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. TABELA DE CORRIDAS (RIDES)
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
                negotiation_history JSONB DEFAULT '[]',
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

        // 4. TABELA DE CARTEIRA (WALLET TRANSACTIONS)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                reference_id VARCHAR(100) UNIQUE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                sender_id INTEGER REFERENCES users(id),
                receiver_id INTEGER REFERENCES users(id),
                amount NUMERIC(15,2),
                fee NUMERIC(15, 2) DEFAULT 0.00,
                currency VARCHAR(3) DEFAULT 'AOA',
                type TEXT,
                method VARCHAR(50) DEFAULT 'internal',
                description TEXT,
                status TEXT DEFAULT 'completed',
                metadata JSONB DEFAULT '{}',
                balance_after NUMERIC(15, 2),
                category VARCHAR(50),
                is_hidden BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. TABELA DE POSIÇÕES DOS MOTORISTAS (RADAR)
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

        // 6. TABELA DE SESSÕES (PERSISTÊNCIA)
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

        // 7. TABELA DE DOCUMENTOS
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

        // 8. TABELA DE NOTIFICAÇÕES
        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                type TEXT,
                data JSONB DEFAULT '{}',
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                read_at TIMESTAMP
            );
        `);

        // 9. TABELA DE CONFIGURAÇÕES DO APP
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id SERIAL PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                value JSONB NOT NULL,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 10. TABELA DE RELATÓRIOS ADMIN
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_reports (
                id SERIAL PRIMARY KEY,
                report_type TEXT NOT NULL,
                data JSONB NOT NULL,
                generated_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 11. TABELA DE CONTAS BANCÁRIAS EXTERNAS (WALLET)
        await client.query(`
            CREATE TABLE IF NOT EXISTS external_bank_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                bank_name VARCHAR(100),
                iban VARCHAR(50),
                holder_name VARCHAR(150),
                is_verified BOOLEAN DEFAULT FALSE,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 12. TABELA DE CARTÕES DA CARTEIRA (WALLET)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_cards (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                card_alias VARCHAR(100),
                last_four VARCHAR(4),
                card_network VARCHAR(50),
                provider_token VARCHAR(255),
                expiry_date VARCHAR(10),
                cvv_hash VARCHAR(255),
                is_active BOOLEAN DEFAULT TRUE,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 13. TABELA DE LOGS DE SEGURANÇA FINANCEIRA (WALLET)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_security_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                event_type VARCHAR(50) NOT NULL,
                ip_address VARCHAR(45),
                device_info TEXT,
                details JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // --- MIGRAÇÃO DE REPARO (AUTO-HEALING) ---
        // Adiciona colunas que possam faltar em instalações existentes para garantir compatibilidade total.
        const columnsToAdd = [
            // Users table (Original + Wallet Integration)
            ['users', 'session_token', 'TEXT'],
            ['users', 'session_expiry', 'TIMESTAMP'],
            ['users', 'last_login', 'TIMESTAMP'],
            ['users', 'is_blocked', 'BOOLEAN DEFAULT false'],
            ['users', 'is_verified', 'BOOLEAN DEFAULT false'],
            ['users', 'verification_code', 'TEXT'],
            ['users', 'settings', 'JSONB DEFAULT \'{}\''],
            ['users', 'privacy_settings', 'JSONB DEFAULT \'{}\''],
            ['users', 'notification_preferences', 'JSONB DEFAULT \'{"ride_notifications": true, "promo_notifications": true, "chat_notifications": true}\''],
            ['users', 'driving_license_front', 'TEXT'],
            ['users', 'driving_license_back', 'TEXT'],
            ['users', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
            ['users', 'wallet_account_number', 'VARCHAR(50) UNIQUE'],
            ['users', 'wallet_pin_hash', 'VARCHAR(255)'],
            ['users', 'wallet_status', "VARCHAR(20) DEFAULT 'active'"],
            ['users', 'daily_limit', 'NUMERIC(15, 2) DEFAULT 500000.00'],
            ['users', 'daily_limit_used', 'NUMERIC(15, 2) DEFAULT 0.00'],
            ['users', 'last_transaction_date', 'DATE DEFAULT CURRENT_DATE'],
            ['users', 'account_tier', "VARCHAR(20) DEFAULT 'standard'"],
            ['users', 'kyc_level', 'INTEGER DEFAULT 1'],

            // Rides table
            ['rides', 'accepted_at', 'TIMESTAMP'],
            ['rides', 'started_at', 'TIMESTAMP'],
            ['rides', 'cancelled_at', 'TIMESTAMP'],
            ['rides', 'cancelled_by', 'TEXT'],
            ['rides', 'cancellation_reason', 'TEXT'],
            ['rides', 'payment_method', 'TEXT'],
            ['rides', 'payment_status', 'TEXT DEFAULT \'pending\''],

            // Chat messages table
            ['chat_messages', 'read_at', 'TIMESTAMP'],

            // Wallet transactions table (Expanded Schema)
            ['wallet_transactions', 'status', 'TEXT DEFAULT \'completed\''],
            ['wallet_transactions', 'metadata', 'JSONB DEFAULT \'{}\''],
            ['wallet_transactions', 'reference_id', 'VARCHAR(100)'], // Unique constraint checked separately usually but safe here
            ['wallet_transactions', 'sender_id', 'INTEGER REFERENCES users(id)'],
            ['wallet_transactions', 'receiver_id', 'INTEGER REFERENCES users(id)'],
            ['wallet_transactions', 'fee', 'NUMERIC(15, 2) DEFAULT 0.00'],
            ['wallet_transactions', 'currency', "VARCHAR(3) DEFAULT 'AOA'"],
            ['wallet_transactions', 'method', "VARCHAR(50) DEFAULT 'internal'"],
            ['wallet_transactions', 'balance_after', 'NUMERIC(15, 2)'],
            ['wallet_transactions', 'category', 'VARCHAR(50)'],
            ['wallet_transactions', 'is_hidden', 'BOOLEAN DEFAULT FALSE'],
            ['wallet_transactions', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP']
        ];

        for (const [table, column, type] of columnsToAdd) {
            try {
                await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
                // Não logamos cada sucesso para não poluir, apenas erros.
            } catch (err) {
                // Ignorar erro se a coluna já existe (fallback) ou logar se for crítico
                // Logamos apenas erros que não sejam "column already exists"
                if (err.code !== '42701') {
                    logError('MIGRATION', `Erro ao adicionar coluna ${column} à ${table}: ${err.message}`);
                }
            }
        }

        // Criar índices para performance (Idempotente: IF NOT EXISTS)
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_users_is_online ON users(is_online);
            CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
            CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id);
            CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id);
            CREATE INDEX IF NOT EXISTS idx_rides_created ON rides(created_at);
            CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id);
            CREATE INDEX IF NOT EXISTS idx_wallet_tx_ref ON wallet_transactions(reference_id);
            CREATE INDEX IF NOT EXISTS idx_wallet_tx_created ON wallet_transactions(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_chat_ride ON chat_messages(ride_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token);
            CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS idx_driver_positions_update ON driver_positions(last_update);
        `);

        // Inserir configurações padrão do app (Idempotente: ON CONFLICT DO NOTHING)
        await client.query(`
            INSERT INTO app_settings (key, value, description)
            VALUES
            ('ride_prices', '{"base_price": 600, "km_rate": 300, "moto_base": 400, "moto_km_rate": 180, "delivery_base": 1000, "delivery_km_rate": 450}', 'Configurações de preços das corridas'),
            ('app_config', '{"max_radius_km": 15, "driver_timeout_minutes": 30, "ride_search_timeout": 600}', 'Configurações gerais do app'),
            ('commission_rates', '{"driver_commission": 0.8, "platform_commission": 0.2}', 'Taxas de comissão'),
            ('notification_settings', '{"ride_timeout": 30, "promo_enabled": true}', 'Configurações de notificação')
            ON CONFLICT (key) DO NOTHING;
        `);

        // Sincronização de Contas Legadas (Wallet Logic)
        // Garante que usuários antigos tenham número de conta gerado
        await client.query(`
            UPDATE users SET wallet_account_number = phone || 'AO'
            WHERE wallet_account_number IS NULL AND phone IS NOT NULL;
        `);

        await client.query('COMMIT');
        logSystem('BOOTSTRAP', '✅ Banco de Dados Sincronizado, Reparado e Pronto para Produção.');

    } catch (err) {
        await client.query('ROLLBACK');
        logError('BOOTSTRAP', err);
        throw err; // Propaga o erro para o server.js saber que falhou
    } finally {
        client.release();
    }
}

module.exports = bootstrapDatabase;