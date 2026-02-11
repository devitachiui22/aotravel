/**
 * =================================================================================================
 * 🛡️ AOTRAVEL SERVER PRO - DATABASE BOOTSTRAP & SELF-HEALING ENGINE (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/utils/dbBootstrap.js
 * VERSÃO DO SCHEMA: 2026.02.11.001
 * DESCRIÇÃO: Script de inicialização "Blindado". Responsável por:
 *            1. Criação idempotente de tabelas (CREATE IF NOT EXISTS).
 *            2. Auto-Cura de Schema (ALTER TABLE para cada coluna faltante).
 *            3. Criação de Triggers de auditoria (updated_at).
 *            4. Indexação agressiva para performance de queries.
 *            5. Seeding de configurações críticas.
 *
 * REGRAS CRÍTICAS:
 * - Não dropar tabelas com dados.
 * - Garantir tipos numéricos precisos (NUMERIC 15,2) para finanças.
 * - Sincronia total com Auth, Wallet e Ride Controllers.
 *
 * =================================================================================================
 */

const pool = require('../config/db');
const { logSystem, logError } = require('./helpers');

/**
 * Função auxiliar para execução segura de DDL (Data Definition Language)
 * Permite que erros não fatais (como "índice já existe") sejam logados mas não parem o boot.
 */
async function safeQuery(client, query, label) {
    try {
        await client.query(query);
        // logSystem('DB_DDL', `Sucesso: ${label}`); // Verbose demais, descomentar se necessário debug
    } catch (error) {
        // Ignora erros de "já existe" para manter a idempotência silenciosa, alerta outros.
        if (error.code === '42P07' || error.code === '42701' || error.code === '42710') {
             // 42P07: relation already exists, 42701: column exists, 42710: constraint exists
             return;
        }
        logError(`DB_DDL_WARN [${label}]`, error.message);
    }
}

/**
 * TRIGGER FUNCTION SETUP
 * Configura a função de banco de dados para atualizar automaticamente o campo 'updated_at'.
 */
async function setupTriggers(client) {
    logSystem('BOOTSTRAP', 'Configurando Triggers de Auditoria...');

    // 1. Função genérica de timestamp
    await client.query(`
        CREATE OR REPLACE FUNCTION update_timestamp_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ language 'plpgsql';
    `);
}

/**
 * Helper para aplicar o trigger em tabelas
 */
async function applyTrigger(client, tableName) {
    try {
        await client.query(`
            DROP TRIGGER IF EXISTS update_${tableName}_modtime ON ${tableName};
            CREATE TRIGGER update_${tableName}_modtime
            BEFORE UPDATE ON ${tableName}
            FOR EACH ROW
            EXECUTE PROCEDURE update_timestamp_column();
        `);
    } catch (e) {
        logError(`TRIGGER_${tableName}`, e);
    }
}

/**
 * FUNÇÃO PRINCIPAL DE BOOTSTRAP
 */
async function bootstrapDatabase() {
    const client = await pool.connect();

    try {
        logSystem('BOOTSTRAP', '🚀 Iniciando sequência de inicialização do Banco de Dados (Titanium Mode)...');
        await client.query('BEGIN');

        // =========================================================================================
        // ETAPA 1: CRIAÇÃO ESTRUTURAL (TABLES)
        // Definição base. Se a tabela não existir, cria do zero.
        // =========================================================================================

        // 1. Users (Auth + Profile + Wallet Core)
        // OBS: Usamos 'password' e não 'password_hash' para bater com o AuthController.
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT,
                password TEXT NOT NULL,
                photo TEXT,
                role TEXT CHECK (role IN ('passenger', 'driver', 'admin')),

                -- Financeiro (Wallet)
                balance NUMERIC(15,2) DEFAULT 0.00 CHECK (balance >= -1000000), -- Permite saldo negativo controlado
                wallet_account_number VARCHAR(50) UNIQUE,
                wallet_pin_hash VARCHAR(255),
                wallet_status VARCHAR(20) DEFAULT 'active',
                daily_limit NUMERIC(15, 2) DEFAULT 500000.00,
                daily_limit_used NUMERIC(15, 2) DEFAULT 0.00,
                last_transaction_date DATE DEFAULT CURRENT_DATE,
                account_tier VARCHAR(20) DEFAULT 'standard',
                kyc_level INTEGER DEFAULT 1,
                bonus_points INTEGER DEFAULT 0,

                -- Detalhes Motorista / Veículo
                vehicle_details JSONB,
                rating NUMERIC(3,2) DEFAULT 5.00,
                is_online BOOLEAN DEFAULT false,

                -- Segurança e Sessão
                fcm_token TEXT,
                session_token TEXT,
                session_expiry TIMESTAMP,
                last_login TIMESTAMP,
                is_blocked BOOLEAN DEFAULT false,
                is_verified BOOLEAN DEFAULT false,
                verification_code TEXT,

                -- Documentação (URLs)
                bi_front TEXT,
                bi_back TEXT,
                driving_license_front TEXT,
                driving_license_back TEXT,

                -- Configurações (JSONB para flexibilidade)
                settings JSONB DEFAULT '{}',
                privacy_settings JSONB DEFAULT '{}',
                notification_preferences JSONB DEFAULT '{"ride_notifications": true, "promo_notifications": true, "chat_notifications": true}',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Rides (Mobilidade)
        await client.query(`
            CREATE TABLE IF NOT EXISTS rides (
                id SERIAL PRIMARY KEY,
                passenger_id INTEGER REFERENCES users(id),
                driver_id INTEGER REFERENCES users(id),

                -- Geolocalização Precisa
                origin_lat DOUBLE PRECISION NOT NULL,
                origin_lng DOUBLE PRECISION NOT NULL,
                dest_lat DOUBLE PRECISION NOT NULL,
                dest_lng DOUBLE PRECISION NOT NULL,
                origin_name TEXT,
                dest_name TEXT,

                -- Financeiro da Corrida
                initial_price NUMERIC(15,2),
                final_price NUMERIC(15,2),
                negotiation_history JSONB DEFAULT '[]',
                payment_method TEXT,
                payment_status TEXT DEFAULT 'pending',

                -- Status e Metadados
                status TEXT DEFAULT 'searching',
                ride_type TEXT DEFAULT 'ride', -- 'ride', 'moto', 'delivery'
                distance_km NUMERIC(10,2),

                -- Avaliação
                rating INTEGER DEFAULT 0,
                feedback TEXT,

                -- Timestamps de Ciclo de Vida
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                cancelled_at TIMESTAMP,
                cancelled_by TEXT,
                cancellation_reason TEXT
            );
        `);

        // 3. Wallet Transactions (Ledger Financeiro)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                reference_id VARCHAR(100) UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id), -- Dono do registro
                sender_id INTEGER REFERENCES users(id),
                receiver_id INTEGER REFERENCES users(id),

                amount NUMERIC(15,2) NOT NULL,
                fee NUMERIC(15, 2) DEFAULT 0.00,
                balance_after NUMERIC(15, 2), -- Snapshot do saldo pós-operação

                currency VARCHAR(3) DEFAULT 'AOA',
                type TEXT NOT NULL, -- 'transfer', 'deposit', 'withdraw', 'payment', 'earnings'
                method VARCHAR(50) DEFAULT 'internal',
                status TEXT DEFAULT 'completed',

                description TEXT,
                category VARCHAR(50),
                metadata JSONB DEFAULT '{}',
                is_hidden BOOLEAN DEFAULT FALSE,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. Driver Positions (Radar/GPS) - CORREÇÃO CRÍTICA: driver_id é PK
        await client.query(`
            CREATE TABLE IF NOT EXISTS driver_positions (
                driver_id INTEGER PRIMARY KEY REFERENCES users(id),
                lat DOUBLE PRECISION NOT NULL,
                lng DOUBLE PRECISION NOT NULL,
                heading DOUBLE PRECISION DEFAULT 0,
                socket_id TEXT,
                status TEXT DEFAULT 'active',
                last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. Chat Messages (Comunicação)
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

        // 6. User Sessions (Segurança Persistente)
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                session_token TEXT UNIQUE NOT NULL,
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

        // 7. User Documents (KYC)
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_documents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                document_type TEXT NOT NULL, -- 'bi', 'driving_license'
                front_image TEXT,
                back_image TEXT,
                status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
                verified_by INTEGER REFERENCES users(id),
                verified_at TIMESTAMP,
                rejection_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, document_type) -- Garante um registro por tipo por usuário
            );
        `);

        // 8. Notifications (Inbox)
        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                type TEXT,
                data JSONB DEFAULT '{}',
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                read_at TIMESTAMP
            );
        `);

        // 9. App Settings (Configuração Dinâmica)
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id SERIAL PRIMARY KEY,
                key TEXT UNIQUE NOT NULL,
                value JSONB NOT NULL,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 10. Admin Reports (Analíticos)
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_reports (
                id SERIAL PRIMARY KEY,
                report_type TEXT NOT NULL,
                data JSONB NOT NULL,
                generated_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 11. External Bank Accounts (Saques)
        await client.query(`
            CREATE TABLE IF NOT EXISTS external_bank_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                bank_name VARCHAR(100) NOT NULL,
                iban VARCHAR(50) NOT NULL,
                holder_name VARCHAR(150) NOT NULL,
                is_verified BOOLEAN DEFAULT FALSE,
                is_default BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 12. Wallet Cards (Cartões Virtuais)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_cards (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

        // 13. Wallet Security Logs (Auditoria)
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

        // =========================================================================================
        // ETAPA 2: AUTO-HEALING (AUTO-CURA DE SCHEMA)
        // Varre todas as tabelas e adiciona colunas que possam faltar.
        // Garante compatibilidade total com o código fornecido, independente do estado anterior do DB.
        // =========================================================================================

        logSystem('BOOTSTRAP', 'Executando Auto-Cura de Schema (Verificação de Colunas)...');

        const schemaRepairs = [
            // --- USERS ---
            { table: 'users', col: 'session_token', type: 'TEXT' },
            { table: 'users', col: 'session_expiry', type: 'TIMESTAMP' },
            { table: 'users', col: 'last_login', type: 'TIMESTAMP' },
            { table: 'users', col: 'is_blocked', type: 'BOOLEAN DEFAULT false' },
            { table: 'users', col: 'is_verified', type: 'BOOLEAN DEFAULT false' },
            { table: 'users', col: 'verification_code', type: 'TEXT' },
            { table: 'users', col: 'settings', type: "JSONB DEFAULT '{}'" },
            { table: 'users', col: 'privacy_settings', type: "JSONB DEFAULT '{}'" },
            { table: 'users', col: 'notification_preferences', type: "JSONB DEFAULT '{}'" },
            { table: 'users', col: 'driving_license_front', type: 'TEXT' },
            { table: 'users', col: 'driving_license_back', type: 'TEXT' },
            { table: 'users', col: 'bi_front', type: 'TEXT' },
            { table: 'users', col: 'bi_back', type: 'TEXT' },
            { table: 'users', col: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
            // Users - Wallet
            { table: 'users', col: 'wallet_account_number', type: 'VARCHAR(50) UNIQUE' },
            { table: 'users', col: 'wallet_pin_hash', type: 'VARCHAR(255)' },
            { table: 'users', col: 'wallet_status', type: "VARCHAR(20) DEFAULT 'active'" },
            { table: 'users', col: 'daily_limit', type: 'NUMERIC(15, 2) DEFAULT 500000.00' },
            { table: 'users', col: 'daily_limit_used', type: 'NUMERIC(15, 2) DEFAULT 0.00' },
            { table: 'users', col: 'last_transaction_date', type: 'DATE DEFAULT CURRENT_DATE' },
            { table: 'users', col: 'account_tier', type: "VARCHAR(20) DEFAULT 'standard'" },
            { table: 'users', col: 'kyc_level', type: 'INTEGER DEFAULT 1' },
            { table: 'users', col: 'bonus_points', type: 'INTEGER DEFAULT 0' },

            // --- RIDES ---
            { table: 'rides', col: 'accepted_at', type: 'TIMESTAMP' },
            { table: 'rides', col: 'started_at', type: 'TIMESTAMP' },
            { table: 'rides', col: 'completed_at', type: 'TIMESTAMP' },
            { table: 'rides', col: 'cancelled_at', type: 'TIMESTAMP' },
            { table: 'rides', col: 'cancelled_by', type: 'TEXT' },
            { table: 'rides', col: 'cancellation_reason', type: 'TEXT' },
            { table: 'rides', col: 'payment_method', type: 'TEXT' },
            { table: 'rides', col: 'payment_status', type: "TEXT DEFAULT 'pending'" },
            { table: 'rides', col: 'final_price', type: 'NUMERIC(15,2)' },
            { table: 'rides', col: 'negotiation_history', type: "JSONB DEFAULT '[]'" },

            // --- CHAT ---
            { table: 'chat_messages', col: 'read_at', type: 'TIMESTAMP' },
            { table: 'chat_messages', col: 'image_url', type: 'TEXT' },

            // --- WALLET TRANSACTIONS ---
            { table: 'wallet_transactions', col: 'status', type: "TEXT DEFAULT 'completed'" },
            { table: 'wallet_transactions', col: 'metadata', type: "JSONB DEFAULT '{}'" },
            { table: 'wallet_transactions', col: 'fee', type: 'NUMERIC(15, 2) DEFAULT 0.00' },
            { table: 'wallet_transactions', col: 'currency', type: "VARCHAR(3) DEFAULT 'AOA'" },
            { table: 'wallet_transactions', col: 'method', type: "VARCHAR(50) DEFAULT 'internal'" },
            { table: 'wallet_transactions', col: 'balance_after', type: 'NUMERIC(15, 2)' },
            { table: 'wallet_transactions', col: 'category', type: 'VARCHAR(50)' },
            { table: 'wallet_transactions', col: 'is_hidden', type: 'BOOLEAN DEFAULT FALSE' },
            { table: 'wallet_transactions', col: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },

            // --- DOCUMENTS ---
            { table: 'user_documents', col: 'rejection_reason', type: 'TEXT' },
            { table: 'user_documents', col: 'verified_by', type: 'INTEGER REFERENCES users(id)' },

             // --- SESSIONS ---
             { table: 'user_sessions', col: 'fcm_token', type: 'TEXT' },
             { table: 'user_sessions', col: 'ip_address', type: 'TEXT' }
        ];

        // Loop de Auto-Cura (Very Robust)
        for (const repair of schemaRepairs) {
            try {
                // Tenta adicionar a coluna. Se existir, o Postgres lança erro que pegamos.
                // Esta é a maneira mais segura e atômica de garantir existência.
                await client.query(`ALTER TABLE ${repair.table} ADD COLUMN IF NOT EXISTS ${repair.col} ${repair.type}`);
            } catch (err) {
                // Loga apenas se for erro real, não "column already exists"
                if (err.code !== '42701') {
                     logError('SCHEMA_REPAIR', `Falha ao reparar ${repair.table}.${repair.col}: ${err.message}`);
                }
            }
        }

        // =========================================================================================
        // ETAPA 3: ÍNDICES DE PERFORMANCE (TURBOCHARGING)
        // Criação de índices para acelerar buscas críticas (Login, Histórico, Geolocalização).
        // =========================================================================================

        logSystem('BOOTSTRAP', 'Otimizando Banco de Dados (Indexação)...');

        const indexes = [
            // Users
            "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
            "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)",
            "CREATE INDEX IF NOT EXISTS idx_users_online ON users(is_online) WHERE is_online = true",
            "CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_account_number)",

            // Rides
            "CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id)",
            "CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id)",
            "CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status)",
            "CREATE INDEX IF NOT EXISTS idx_rides_created ON rides(created_at DESC)",

            // Wallet
            "CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_wallet_ref ON wallet_transactions(reference_id)",
            "CREATE INDEX IF NOT EXISTS idx_wallet_date ON wallet_transactions(created_at DESC)",

            // Driver Radar
            "CREATE INDEX IF NOT EXISTS idx_driver_pos_geo ON driver_positions(lat, lng)",
            "CREATE INDEX IF NOT EXISTS idx_driver_pos_update ON driver_positions(last_update)",

            // Chat & Sessions
            "CREATE INDEX IF NOT EXISTS idx_chat_ride ON chat_messages(ride_id)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token)"
        ];

        for (const idxQuery of indexes) {
            await safeQuery(client, idxQuery, 'CREATE_INDEX');
        }

        // =========================================================================================
        // ETAPA 4: TRIGGERS E AUTOMATIZAÇÃO
        // =========================================================================================

        await setupTriggers(client);
        // Aplica o trigger 'updated_at' nas tabelas críticas
        const tablesWithTimestamp = ['users', 'wallet_transactions', 'user_documents', 'app_settings', 'external_bank_accounts'];
        for (const t of tablesWithTimestamp) {
            await applyTrigger(client, t);
        }

        // =========================================================================================
        // ETAPA 5: SEEDING (DADOS INICIAIS CRÍTICOS)
        // =========================================================================================

        logSystem('BOOTSTRAP', 'Aplicando Seed Data (Configurações)...');

        // Configurações Padrão (Preços, Regras)
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
                desc: 'Tabela de preços base das corridas'
            },
            {
                key: 'app_config',
                value: JSON.stringify({
                    max_radius_km: 15,
                    driver_timeout_minutes: 30,
                    ride_search_timeout: 600
                }),
                desc: 'Configurações globais de comportamento do app'
            },
            {
                key: 'commission_rates',
                value: JSON.stringify({
                    driver_commission: 0.8,
                    platform_commission: 0.2
                }),
                desc: 'Split de pagamento (Motorista/Plataforma)'
            }
        ];

        for (const setting of defaultSettings) {
            await client.query(`
                INSERT INTO app_settings (key, value, description)
                VALUES ($1, $2, $3)
                ON CONFLICT (key) DO NOTHING;
            `, [setting.key, setting.value, setting.desc]);
        }

        // =========================================================================================
        // ETAPA 6: CORREÇÃO DE DADOS LEGADOS (LEGACY FIX)
        // Garante que usuários criados antes da Wallet tenham número de conta.
        // =========================================================================================

        await client.query(`
            UPDATE users
            SET wallet_account_number = regexp_replace(phone, '\\D','','g') || 'AO'
            WHERE wallet_account_number IS NULL AND phone IS NOT NULL;
        `);

        // Finaliza Transação
        await client.query('COMMIT');
        logSystem('BOOTSTRAP', '✅ Banco de Dados BLINDADO e Sincronizado com Sucesso (v2026.02).');

    } catch (err) {
        await client.query('ROLLBACK');
        logError('BOOTSTRAP_FATAL', err);
        // Relança o erro para parar o servidor se o DB não subir.
        // Em produção, isso impede que o app rode quebrado.
        throw err;
    } finally {
        client.release();
    }
}

// Exportação no padrão CommonJS exigido pelo server.js
module.exports = { bootstrapDatabase };
