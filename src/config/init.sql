-- =================================================================================================
-- 🚀 AOTRAVEL DATABASE SCHEMA - TITANIUM EDITION v11.2.0
-- =================================================================================================

-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =================================================================================================
-- 1. TABELA DE USUÁRIOS (CORRIGIDA com last_seen)
-- =================================================================================================
DROP TABLE IF EXISTS users CASCADE;
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    wallet_pin_hash VARCHAR(255),
    role VARCHAR(20) DEFAULT 'passenger' CHECK (role IN ('passenger', 'driver', 'admin')),
    photo TEXT,
    rating DECIMAL(3,2) DEFAULT 4.5,
    balance DECIMAL(12,2) DEFAULT 0.0,
    bonus_points INTEGER DEFAULT 0,
    wallet_account_number VARCHAR(50) UNIQUE,
    is_verified BOOLEAN DEFAULT false,
    is_online BOOLEAN DEFAULT false,
    is_blocked BOOLEAN DEFAULT false,
    has_pin BOOLEAN DEFAULT false,
    last_login TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    device_token TEXT,
    app_version VARCHAR(20),
    platform VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =================================================================================================
-- 2. DETALHES DO VEÍCULO (MOTORISTAS)
-- =================================================================================================
DROP TABLE IF EXISTS vehicle_details CASCADE;
CREATE TABLE vehicle_details (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    model VARCHAR(100),
    plate VARCHAR(20),
    color VARCHAR(50),
    type VARCHAR(50) DEFAULT 'car' CHECK (type IN ('car', 'moto', 'delivery', 'truck')),
    year INTEGER,
    documents_verified BOOLEAN DEFAULT false,
    insurance_expiry DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(driver_id)
);

-- =================================================================================================
-- 3. POSIÇÕES DOS MOTORISTAS (TEMPO REAL)
-- =================================================================================================
DROP TABLE IF EXISTS driver_positions CASCADE;
CREATE TABLE driver_positions (
    driver_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    lat DECIMAL(10,8) DEFAULT 0,
    lng DECIMAL(11,8) DEFAULT 0,
    heading DECIMAL(5,2) DEFAULT 0,
    speed DECIMAL(5,2) DEFAULT 0,
    accuracy DECIMAL(5,2) DEFAULT 0,
    socket_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy', 'away')),
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX idx_driver_positions_status ON driver_positions(status);
CREATE INDEX idx_driver_positions_last_update ON driver_positions(last_update);
CREATE INDEX idx_driver_positions_socket ON driver_positions(socket_id);

-- =================================================================================================
-- 4. CORRIDAS
-- =================================================================================================
DROP TABLE IF EXISTS rides CASCADE;
CREATE TABLE rides (
    id SERIAL PRIMARY KEY,
    passenger_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    origin_lat DECIMAL(10,8) NOT NULL,
    origin_lng DECIMAL(11,8) NOT NULL,
    dest_lat DECIMAL(10,8) NOT NULL,
    dest_lng DECIMAL(11,8) NOT NULL,
    origin_name TEXT,
    dest_name TEXT,
    initial_price DECIMAL(10,2) NOT NULL,
    final_price DECIMAL(10,2),
    ride_type VARCHAR(20) DEFAULT 'ride' CHECK (ride_type IN ('ride', 'moto', 'delivery')),
    distance_km DECIMAL(10,2),
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

-- Índices para corridas
CREATE INDEX idx_rides_passenger ON rides(passenger_id);
CREATE INDEX idx_rides_driver ON rides(driver_id);
CREATE INDEX idx_rides_status ON rides(status);
CREATE INDEX idx_rides_created ON rides(created_at);

-- =================================================================================================
-- 5. TRANSAÇÕES DA CARTEIRA
-- =================================================================================================
DROP TABLE IF EXISTS wallet_transactions CASCADE;
CREATE TABLE wallet_transactions (
    id SERIAL PRIMARY KEY,
    reference_id VARCHAR(100) UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    receiver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ride_id INTEGER REFERENCES rides(id) ON DELETE SET NULL,
    amount DECIMAL(12,2) NOT NULL,
    balance_before DECIMAL(12,2),
    balance_after DECIMAL(12,2),
    type VARCHAR(50) CHECK (type IN ('topup', 'withdraw', 'payment', 'earnings', 'refund', 'bonus')),
    method VARCHAR(20) CHECK (method IN ('cash', 'wallet', 'card', 'transfer', 'internal')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    description TEXT,
    category VARCHAR(50) DEFAULT 'general',
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Índices para transações
CREATE INDEX idx_transactions_user ON wallet_transactions(user_id);
CREATE INDEX idx_transactions_reference ON wallet_transactions(reference_id);
CREATE INDEX idx_transactions_created ON wallet_transactions(created_at);

-- =================================================================================================
-- 6. MENSAGENS DO CHAT
-- =================================================================================================
DROP TABLE IF EXISTS chat_messages CASCADE;
CREATE TABLE chat_messages (
    id SERIAL PRIMARY KEY,
    ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'location', 'payment')),
    text TEXT,
    image_url TEXT,
    location_lat DECIMAL(10,8),
    location_lng DECIMAL(11,8),
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mensagens
CREATE INDEX idx_messages_ride ON chat_messages(ride_id);
CREATE INDEX idx_messages_created ON chat_messages(created_at);

-- =================================================================================================
-- 7. NOTIFICAÇÕES
-- =================================================================================================
DROP TABLE IF EXISTS notifications CASCADE;
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50),
    title VARCHAR(255),
    body TEXT,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para notificações
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);

-- =================================================================================================
-- 8. SESSÕES DE AUTENTICAÇÃO
-- =================================================================================================
DROP TABLE IF EXISTS sessions CASCADE;
CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    device_info JSONB,
    ip_address VARCHAR(45),
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para sessões
CREATE INDEX idx_sessions_token ON sessions(session_token);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- =================================================================================================
-- 9. CONFIGURAÇÕES DO APP
-- =================================================================================================
DROP TABLE IF EXISTS app_settings CASCADE;
CREATE TABLE app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- =================================================================================================
-- 10. INSERIR DADOS INICIAIS
-- =================================================================================================

-- Inserir configurações padrão
INSERT INTO app_settings (key, value, description) VALUES
('ride_prices', '{"base_price": 600, "km_rate": 300, "moto_base": 400, "moto_km_rate": 180, "delivery_base": 1000, "delivery_km_rate": 450}', 'Preços base das corridas'),
('system_config', '{"max_driver_distance": 5000, "search_timeout": 60, "version": "11.2.0"}', 'Configurações do sistema'),
('wallet_config', '{"min_topup": 100, "max_topup": 1000000, "daily_limit": 500000}', 'Limites da carteira')
ON CONFLICT (key) DO NOTHING;

-- Criar índices adicionais para performance
CREATE INDEX IF NOT EXISTS idx_users_role_online ON users(role, is_online);
CREATE INDEX IF NOT EXISTS idx_driver_positions_coords ON driver_positions(lat, lng);
CREATE INDEX IF NOT EXISTS idx_rides_status_created ON rides(status, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status ON wallet_transactions(status);

-- =================================================================================================
-- 11. FUNÇÕES E TRIGGERS
-- =================================================================================================

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rides_updated_at ON rides;
CREATE TRIGGER update_rides_updated_at
    BEFORE UPDATE ON rides
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Função para gerar número da carteira automaticamente
CREATE OR REPLACE FUNCTION generate_wallet_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.wallet_account_number IS NULL THEN
        NEW.wallet_account_number := 'AOT' || LPAD(NEW.id::TEXT, 8, '0');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para número da carteira
DROP TRIGGER IF EXISTS set_wallet_number ON users;
CREATE TRIGGER set_wallet_number
    BEFORE INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION generate_wallet_number();

-- =================================================================================================
-- 12. USUÁRIOS DE TESTE (OPCIONAL - COMENTAR EM PRODUÇÃO)
-- =================================================================================================

-- Senha: 123456 (hash bcrypt)
-- $2b$10$YourHashHere

INSERT INTO users (name, email, phone, password_hash, role, is_verified, rating) VALUES
('Motorista Ao', 'driver@aotravel.com', '+244923456789', '$2b$10$YourHashHere', 'driver', true, 4.9),
('moto', 'moto@aotravel.com', '+244987654321', '$2b$10$YourHashHere', 'driver', true, 4.8),
('Passageiro Teste', 'passenger@aotravel.com', '+244912345678', '$2b$10$YourHashHere', 'passenger', true, 4.7)
ON CONFLICT (email) DO NOTHING;

-- Inserir detalhes dos veículos
INSERT INTO vehicle_details (driver_id, model, plate, color, type) VALUES
(1, 'Toyota Corolla', 'LD-12-34-AB', 'Preto', 'car'),
(2, 'Honda CG 160', 'LD-56-78-CD', 'Vermelha', 'moto')
ON CONFLICT (driver_id) DO NOTHING;

-- Inserir posições iniciais (offline)
INSERT INTO driver_positions (driver_id, lat, lng, status) VALUES
(1, -8.8399, 13.2894, 'offline'),
(2, -8.9219, 13.2296, 'offline')
ON CONFLICT (driver_id) DO NOTHING;

-- =================================================================================================
-- 13. VERIFICAÇÃO FINAL
-- =================================================================================================

SELECT '✅ Database schema created successfully!' as status;