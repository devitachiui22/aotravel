const pool = require('../config/db');
const { logSystem, logError } = require('../utils/logger');

async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        logSystem('BOOTSTRAP', 'Verificando integridade das tabelas e aplicando migrações...');

        // 1. Users
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, password TEXT NOT NULL, photo TEXT,
                role TEXT CHECK (role IN ('passenger', 'driver', 'admin')), balance NUMERIC(15,2) DEFAULT 0.00, bonus_points INTEGER DEFAULT 0,
                vehicle_details JSONB, bi_front TEXT, bi_back TEXT, driving_license_front TEXT, driving_license_back TEXT,
                is_online BOOLEAN DEFAULT false, rating NUMERIC(3,2) DEFAULT 5.00, fcm_token TEXT, settings JSONB DEFAULT '{}',
                privacy_settings JSONB DEFAULT '{}', notification_preferences JSONB DEFAULT '{"ride_notifications": true, "promo_notifications": true, "chat_notifications": true}',
                session_token TEXT, session_expiry TIMESTAMP, last_login TIMESTAMP, is_blocked BOOLEAN DEFAULT false, is_verified BOOLEAN DEFAULT false,
                verification_code TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 2. Rides
        await client.query(`
            CREATE TABLE IF NOT EXISTS rides (
                id SERIAL PRIMARY KEY, passenger_id INTEGER REFERENCES users(id), driver_id INTEGER REFERENCES users(id),
                origin_lat DOUBLE PRECISION, origin_lng DOUBLE PRECISION, dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
                origin_name TEXT, dest_name TEXT, initial_price NUMERIC(15,2), final_price NUMERIC(15,2),
                status TEXT DEFAULT 'searching', ride_type TEXT DEFAULT 'ride', distance_km NUMERIC(10,2), rating INTEGER DEFAULT 0,
                feedback TEXT, negotiation_history JSONB DEFAULT '[]', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at TIMESTAMP, started_at TIMESTAMP, completed_at TIMESTAMP, cancelled_at TIMESTAMP, cancelled_by TEXT,
                cancellation_reason TEXT, payment_method TEXT, payment_status TEXT DEFAULT 'pending'
            );
        `);
        // 3. Chat
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY, ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE, sender_id INTEGER REFERENCES users(id),
                text TEXT, image_url TEXT, file_data TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, read_at TIMESTAMP
            );
        `);
        // 4. Wallet
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), amount NUMERIC(15,2), type TEXT, description TEXT,
                reference_id INTEGER, status TEXT DEFAULT 'completed', metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 5. Driver Positions
        await client.query(`
            CREATE TABLE IF NOT EXISTS driver_positions (
                driver_id INTEGER PRIMARY KEY REFERENCES users(id), lat DOUBLE PRECISION, lng DOUBLE PRECISION,
                heading DOUBLE PRECISION DEFAULT 0, socket_id TEXT, status TEXT DEFAULT 'active', last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 6. Sessions
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), session_token TEXT UNIQUE, device_id TEXT,
                device_info JSONB, fcm_token TEXT, ip_address TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP, last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 7. Documents
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_documents (
                id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), document_type TEXT NOT NULL, front_image TEXT, back_image TEXT,
                status TEXT DEFAULT 'pending', verified_by INTEGER REFERENCES users(id), verified_at TIMESTAMP, rejection_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 8. Notifications
        await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL, type TEXT,
                data JSONB DEFAULT '{}', is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, read_at TIMESTAMP
            );
        `);
        // 9. App Settings
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id SERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL, value JSONB NOT NULL, description TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 10. Reports
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_reports (
                id SERIAL PRIMARY KEY, report_type TEXT NOT NULL, data JSONB NOT NULL, generated_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migrations
        const columnsToAdd = [
            ['users', 'fcm_token', 'TEXT'], ['users', 'session_token', 'TEXT'], ['users', 'session_expiry', 'TIMESTAMP'],
            ['users', 'last_login', 'TIMESTAMP'], ['users', 'is_blocked', 'BOOLEAN DEFAULT false'], ['users', 'is_verified', 'BOOLEAN DEFAULT false'],
            ['users', 'verification_code', 'TEXT'], ['users', 'settings', 'JSONB DEFAULT \'{}\''], ['users', 'privacy_settings', 'JSONB DEFAULT \'{}\''],
            ['users', 'notification_preferences', 'JSONB DEFAULT \'{"ride_notifications": true, "promo_notifications": true, "chat_notifications": true}\''],
            ['users', 'driving_license_front', 'TEXT'], ['users', 'driving_license_back', 'TEXT'], ['users', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'],
            ['rides', 'accepted_at', 'TIMESTAMP'], ['rides', 'started_at', 'TIMESTAMP'], ['rides', 'cancelled_at', 'TIMESTAMP'],
            ['rides', 'cancelled_by', 'TEXT'], ['rides', 'cancellation_reason', 'TEXT'], ['rides', 'payment_method', 'TEXT'],
            ['rides', 'payment_status', 'TEXT DEFAULT \'pending\''], ['chat_messages', 'read_at', 'TIMESTAMP'], ['chat_messages', 'file_data', 'TEXT'],
            ['wallet_transactions', 'status', 'TEXT DEFAULT \'completed\''], ['wallet_transactions', 'metadata', 'JSONB DEFAULT \'{}\''],
        ];

        for (const [table, column, type] of columnsToAdd) {
            try {
                await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
            } catch (err) { logError('MIGRATION', `Erro col ${column}: ${err.message}`); }
        }

        // Indices & Data
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
            CREATE INDEX IF NOT EXISTS idx_users_is_online ON users(is_online);
            CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
            CREATE INDEX IF NOT EXISTS idx_driver_positions_update ON driver_positions(last_update);
        `);
        await client.query(`
            INSERT INTO app_settings (key, value, description) VALUES
            ('ride_prices', '{"base_price": 600, "km_rate": 300, "moto_base": 400, "moto_km_rate": 180, "delivery_base": 1000, "delivery_km_rate": 450}', 'Preços das corridas'),
            ('app_config', '{"max_radius_km": 15, "driver_timeout_minutes": 30}', 'Configs gerais'),
            ('commission_rates', '{"driver_commission": 0.8, "platform_commission": 0.2}', 'Taxas')
            ON CONFLICT (key) DO NOTHING;
        `);

        await client.query('COMMIT');
        logSystem('BOOTSTRAP', '✅ Banco de Dados Sincronizado.');
    } catch (err) {
        await client.query('ROLLBACK');
        logError('BOOTSTRAP', err);
        throw err;
    } finally { client.release(); }
}

module.exports = bootstrapDatabase;