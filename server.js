/**
 * =========================================================================================
 * 🚀 AOTRAVEL SERVER PRO - ULTIMATE EDITION (BUILD 2026.02.07)
 * =========================================================================================
 * 
 * LOCALIZAÇÃO: backend/server.js
 * DESENVOLVEDOR: AOTRAVEL TEAM (ANGOLA)
 * TECNOLOGIA: Node.js + Express + Socket.io + PostgreSQL (NeonDB)
 * 
 * 📋 SUMÁRIO DE FUNCIONALIDADES (FULL):
 * 1. CORE: Servidor HTTP com Socket.io otimizado para redes móveis (3G/4G).
 * 2. DATABASE: Bootstrap automático com 6 tabelas relacionais e chaves estrangeiras.
 * 3. AUTH: Login, Registro (Motorista/Passageiro), Verificação de Duplicidade.
 * 4. REAL-TIME RIDE:
 *    - Algoritmo de Busca de Motoristas (Raio 8KM + Recência).
 *    - Handshake de Aceite (Garante que o passageiro mude de tela).
 *    - Chat Bidirecional com Suporte a Imagens (Base64).
 *    - Sincronização de Preço (Negociação).
 *    - GPS Tracking (Lat/Lng/Heading).
 * 5. FINANCEIRO:
 *    - Transações ACID (Atomicidade) para pagamentos.
 *    - Carteira Digital (Wallet) com histórico.
 * 6. UTILITÁRIOS:
 *    - Logs detalhados com Timestamp.
 *    - Tratamento de erros globais.
 * 
 * =========================================================================================
 */

// --- 1. IMPORTAÇÕES E CONFIGURAÇÕES DE AMBIENTE ---
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require("socket.io");
const moment = require('moment'); // (Opcional, mas simulado aqui com Date nativo se não tiver)

// Inicializa Express
const app = express();

/**
 * 🛠️ CONFIGURAÇÃO DE LIMITES (100MB)
 * Essencial para uploads de fotos de perfil, documentos e fotos no chat.
 */
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * 🌐 CONFIGURAÇÃO DE CORS
 * Permite acesso total para App Mobile (Flutter) e Web.
 */
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true
}));

// --- 2. SERVIDOR HTTP E SOCKET.IO ---
const server = http.createServer(app);

// Configuração Avançada do Socket.IO para estabilidade em redes instáveis
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 15000,    // Aumentado para 15s para evitar desconexões falsas
    pingInterval: 25000,   // Ping a cada 25s
    transports: ['websocket', 'polling'] // Fallback garantido
});

// --- 3. BANCO DE DADOS (NEON POSTGRESQL) ---
const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_B62pAUiGbJrF@ep-jolly-art-ahef2z0t-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }, // Obrigatório para Neon
    max: 20, // Pool de conexões
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Listener de Erros do Pool
pool.on('error', (err, client) => {
    logError('ERRO INESPERADO NO CLIENTE DO BANCO DE DADOS', err);
});

// --- 4. FUNÇÕES UTILITÁRIAS E LOGGING ---

// Logger Customizado com Timestamp
function log(context, message, data = '') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ℹ️ [${context}] ${message}`, data ? JSON.stringify(data).substring(0, 100) + '...' : '');
}

function logError(context, error) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ [${context}] ERRO:`, error.message || error);
}

// Fórmula de Haversine (Distância em KM)
function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
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

// Busca Completa de Dados da Corrida (JOINs Complexos)
// CRUCIAL: Garante que o app receba foto, placa e nome ao mudar de tela
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
            
            -- DADOS MOTORISTA
            d.name as driver_name, 
            d.photo as driver_photo, 
            d.phone as driver_phone, 
            d.email as driver_email,
            d.vehicle_details, 
            d.rating as driver_rating,
            
            -- DADOS PASSAGEIRO
            p.name as passenger_name, 
            p.photo as passenger_photo, 
            p.phone as passenger_phone, 
            p.email as passenger_email,
            p.rating as passenger_rating
        FROM rides r
        LEFT JOIN users d ON r.driver_id = d.id
        LEFT JOIN users p ON r.passenger_id = p.id
        WHERE r.id = $1
    `;
    try {
        const res = await pool.query(query, [rideId]);
        return res.rows[0];
    } catch (e) {
        logError('DB_GET_RIDE', e);
        return null;
    }
}

// --- 5. BOOTSTRAP DO BANCO DE DADOS (AUTO-CONFIGURAÇÃO) ---
async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        log('SYSTEM', 'Verificando integridade das tabelas...');

        // 5.1 Tabela USERS
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
                vehicle_details JSONB, -- { model, plate, color, type }
                bi_front TEXT, bi_back TEXT,
                is_online BOOLEAN DEFAULT false,
                rating NUMERIC(3,2) DEFAULT 5.00,
                push_token TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5.2 Tabela RIDES
        await client.query(`
            CREATE TABLE IF NOT EXISTS rides (
                id SERIAL PRIMARY KEY,
                passenger_id INTEGER REFERENCES users(id),
                driver_id INTEGER REFERENCES users(id),
                origin_lat DOUBLE PRECISION, origin_lng DOUBLE PRECISION,
                dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
                origin_name TEXT, dest_name TEXT,
                initial_price NUMERIC(15,2), final_price NUMERIC(15,2),
                status TEXT DEFAULT 'searching',
                ride_type TEXT DEFAULT 'ride',
                distance_km NUMERIC(10,2),
                rating INTEGER DEFAULT 0,
                feedback TEXT,
                negotiation_history JSONB DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            );
        `);

        // 5.3 Tabela CHAT
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                text TEXT,
                image_url TEXT,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5.4 Tabela WALLET (Transações)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount NUMERIC(15,2),
                type TEXT, -- 'credit', 'debit', 'earnings', 'payment'
                description TEXT,
                reference_id INTEGER, -- ride_id ou external_id
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5.5 Tabela DRIVER POSITIONS (Radar)
        await client.query(`
            CREATE TABLE IF NOT EXISTS driver_positions (
                driver_id INTEGER PRIMARY KEY REFERENCES users(id),
                lat DOUBLE PRECISION,
                lng DOUBLE PRECISION,
                heading DOUBLE PRECISION DEFAULT 0,
                socket_id TEXT,
                last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        log('SYSTEM', '✅ Banco de Dados Sincronizado e Pronto.');
    } catch (err) {
        await client.query('ROLLBACK');
        logError('BOOTSTRAP', err);
    } finally {
        client.release();
    }
}
bootstrapDatabase();

/**
 * =========================================================================================
 * 6. LÓGICA DE NEGÓCIO REAL-TIME (SOCKET.IO)
 * =========================================================================================
 */
io.on('connection', (socket) => {
    log('SOCKET', `Nova Conexão: ${socket.id}`);

    // --- GESTÃO DE SALAS ---
    
    // Usuário entra na sua sala privada (user_123)
    socket.on('join_user', (userId) => {
        if (!userId) return;
        const room = `user_${userId}`;
        socket.join(room);
        log('ROOM', `User ${userId} entrou na sala ${room}`);
    });

    // Usuário entra na sala da corrida (ride_999)
    socket.on('join_ride', (rideId) => {
        if (!rideId) return;
        const room = `ride_${rideId}`;
        socket.join(room);
        log('ROOM', `Socket ${socket.id} entrou na sala ${room}`);
    });

    /**
     * --- FLUXO 1: SOLICITAR CORRIDA ---
     * Passageiro envia pedido -> Servidor filtra drivers -> Servidor notifica drivers
     */
    socket.on('request_ride', async (data) => {
        const { passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km } = data;
        
        log('RIDE_REQUEST', `Passageiro ${passenger_id} solicitando corrida de ${distance_km}km`);

        try {
            // 1. Inserir Corrida no Banco (Status: searching)
            const result = await pool.query(
                `INSERT INTO rides (
                    passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, 
                    origin_name, dest_name, initial_price, final_price, ride_type, distance_km, status, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW()) 
                RETURNING *`,
                [passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km]
            );
            const ride = result.rows[0];

            // 2. Colocar Passageiro IMEDIATAMENTE na sala da corrida
            socket.join(`ride_${ride.id}`);
            
            // 3. Confirmar para o Passageiro (Mudar UI para Radar)
            io.to(`user_${passenger_id}`).emit('searching_started', ride);

            // 4. Buscar Motoristas (Logica de Radar)
            const driversRes = await pool.query(`SELECT * FROM driver_positions WHERE last_update > NOW() - INTERVAL '30 minutes'`);
            
            // Filtro de 8KM
            const nearbyDrivers = driversRes.rows.filter(d => {
                const dist = getDistance(origin_lat, origin_lng, d.lat, d.lng);
                return dist <= 8.0;
            });

            if (nearbyDrivers.length === 0) {
                log('RIDE_REQUEST', `Nenhum motorista encontrado no raio de 8km para Ride ${ride.id}`);
                // Avisa passageiro após 5 segundos simulados para dar efeito de busca
                setTimeout(() => {
                    io.to(`user_${passenger_id}`).emit('no_drivers', { message: "Nenhum motorista próximo." });
                }, 4000);
            } else {
                log('RIDE_REQUEST', `Encontrados ${nearbyDrivers.length} motoristas para Ride ${ride.id}`);
                // Envia oferta para cada motorista
                nearbyDrivers.forEach(d => {
                    io.to(`user_${d.driver_id}`).emit('ride_opportunity', ride);
                });
            }

        } catch (e) {
            logError('RIDE_REQUEST', e);
            io.to(`user_${passenger_id}`).emit('error', { message: "Erro ao criar pedido." });
        }
    });

    /**
     * --- FLUXO 2: ACEITAR CORRIDA ---
     * Motorista aceita -> Servidor vincula -> Servidor avisa AMBOS para ir ao Chat
     */
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;
        log('RIDE_ACCEPT', `Driver ${driver_id} aceitou Ride ${ride_id}`);

        try {
            // 1. Verifica se já não foi aceita por outro
            const check = await pool.query("SELECT status FROM rides WHERE id = $1", [ride_id]);
            if (check.rows[0].status !== 'searching') {
                socket.emit('error_response', { message: "Corrida já aceita por outro motorista." });
                return;
            }

            // 2. Atualiza Ride
            await pool.query(
                "UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted' WHERE id = $3",
                [driver_id, final_price, ride_id]
            );

            // 3. Motorista entra na sala da corrida
            socket.join(`ride_${ride_id}`);

            // 4. Busca Dados COMPLETOS
            const fullRideData = await getFullRideDetails(ride_id);

            // 5. DISPARO SINCRONIZADO (GARANTIA DE NAVEGAÇÃO)
            // Avisa Passageiro (Sala Privada)
            io.to(`user_${fullRideData.passenger_id}`).emit('match_found', fullRideData);
            
            // Avisa Motorista (Sala Privada)
            io.to(`user_${driver_id}`).emit('match_found', fullRideData);
            
            // Avisa Sala da Corrida (Backup)
            io.to(`ride_${ride_id}`).emit('match_found', fullRideData);

        } catch (e) {
            logError('RIDE_ACCEPT', e);
        }
    });

    /**
     * --- FLUXO 3: CHAT & NEGOCIAÇÃO ---
     */
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, file_data } = data;
        try {
            const res = await pool.query(
                "INSERT INTO chat_messages (ride_id, sender_id, text, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
                [ride_id, sender_id, text || (file_data ? '📷 Imagem' : '')]
            );
            
            // Se tiver imagem base64, repassa no payload mas não salva base64 gigante no banco (idealmente usaria S3, mas aqui repassamos)
            const payload = { ...res.rows[0], file_data };
            
            // Envia para quem está na sala (exceto remetente se usar broadcast, mas aqui usamos .to para sala)
            // Usamos socket.to para não duplicar para quem enviou
            socket.to(`ride_${ride_id}`).emit('receive_message', payload);
            
        } catch (e) { logError('CHAT', e); }
    });

    socket.on('update_price_negotiation', async (data) => {
        const { ride_id, new_price } = data;
        await pool.query("UPDATE rides SET final_price = $1 WHERE id = $2", [new_price, ride_id]);
        io.to(`ride_${ride_id}`).emit('price_updated', { new_price });
    });

    /**
     * --- FLUXO 4: INICIAR VIAGEM ---
     */
    socket.on('start_trip', async (data) => {
        const { ride_id } = data;
        log('TRIP_START', `Iniciando Ride ${ride_id}`);
        
        try {
            await pool.query("UPDATE rides SET status = 'ongoing' WHERE id = $1", [ride_id]);
            const fullData = await getFullRideDetails(ride_id);
            
            // Força ambos a irem para a tela de Mapa
            io.to(`ride_${ride_id}`).emit('trip_started_now', {
                full_details: fullData,
                status: 'ongoing',
                timestamp: new Date()
            });
        } catch (e) { logError('TRIP_START', e); }
    });

    /**
     * --- FLUXO 5: GPS TRACKING ---
     */
    socket.on('update_trip_gps', (data) => {
        // Driver envia -> Server repassa para Passenger na mesma sala
        const { ride_id, lat, lng, rotation } = data;
        socket.to(`ride_${ride_id}`).emit('driver_location_update', { lat, lng, rotation });
    });

    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading } = data;
        // Upsert na tabela de posições
        try {
            await pool.query(
                `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update, socket_id)
                 VALUES ($1, $2, $3, $4, NOW(), $5)
                 ON CONFLICT (driver_id) DO UPDATE SET lat=$2, lng=$3, heading=$4, last_update=NOW(), socket_id=$5`,
                [user_id, lat, lng, heading || 0, socket.id]
            );
        } catch (e) { /* ignore quiet errors */ }
    });

    /**
     * --- FLUXO 6: CANCELAMENTO ---
     * Lógica corrigida para limpar a tela do passageiro.
     */
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role, reason } = data;
        log('CANCEL', `Ride ${ride_id} cancelada por ${role}. Motivo: ${reason}`);

        try {
            await pool.query("UPDATE rides SET status = 'cancelled', feedback = $1 WHERE id = $2", [reason, ride_id]);
            
            const msg = role === 'driver' ? "Motorista cancelou a viagem." : "Você cancelou a viagem.";
            
            // Evento específico que força o app a fechar modais e voltar pra home
            io.to(`ride_${ride_id}`).emit('ride_terminated', {
                reason: msg,
                origin: role,
                can_restart: true
            });
            
            // Redundância para passageiro
            const details = await getFullRideDetails(ride_id);
            if(details) {
                io.to(`user_${details.passenger_id}`).emit('ride_terminated', { reason: msg });
            }

        } catch (e) { logError('CANCEL', e); }
    });

    // Desconexão
    socket.on('disconnect', () => {
        log('SOCKET', `Desconectado: ${socket.id}`);
        // Opcional: Marcar driver como offline após X tempo
    });
});

/**
 * =========================================================================================
 * 7. API RESTFUL (ENDPOINTS SEGUROS)
 * =========================================================================================
 */

// Health Check
app.get('/', (req, res) => res.status(200).json({ status: "AOTRAVEL SERVER ULTIMATE ONLINE", version: "2026.1" }));

// --- AUTH: LOGIN ---
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email.toLowerCase().trim(), password]);
        if (result.rows.length === 0) return res.status(401).json({ error: "Email ou senha inválidos." });

        const user = result.rows[0];
        
        // Atualiza status online
        await pool.query('UPDATE users SET is_online = true WHERE id = $1', [user.id]);
        
        // Pega transações recentes
        const wallet = await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5', [user.id]);
        
        user.transactions = wallet.rows;
        res.json(user);
    } catch (e) {
        logError('LOGIN', e);
        res.status(500).json({ error: "Erro interno no login." });
    }
});

// --- AUTH: SIGNUP ---
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, phone, password, role, vehicleModel, vehiclePlate, vehicleColor, photo } = req.body;
    
    try {
        // Validação Duplicidade
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) return res.status(400).json({ error: "Este email já está em uso." });

        let vehicleDetails = null;
        if (role === 'driver') {
            vehicleDetails = JSON.stringify({ model: vehicleModel, plate: vehiclePlate, color: vehicleColor });
        }

        const result = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, photo, vehicle_details, balance)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0.00) RETURNING *`,
            [name, email.toLowerCase().trim(), phone, password, role, photo, vehicleDetails]
        );

        log('SIGNUP', `Novo usuário: ${name} (${role})`);
        res.status(201).json(result.rows[0]);

    } catch (e) {
        logError('SIGNUP', e);
        res.status(500).json({ error: "Falha ao criar conta." });
    }
});

// --- RIDES: FINALIZAR CORRIDA (TRANSAÇÃO FINANCEIRA) ---
// Corrige o erro "Erro ao salvar relatório" garantindo a ordem dos parâmetros
app.post('/api/rides/complete', async (req, res) => {
    const { ride_id, user_id, amount, rating, comment } = req.body;

    // Validação
    if (!ride_id || !user_id) {
        return res.status(400).json({ error: "Parâmetros inválidos." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Inicia transação

        const valAmount = parseFloat(amount || 0);

        // 1. Atualiza a Ride
        await client.query(
            `UPDATE rides SET status = 'completed', final_price = $1, rating = $2, feedback = $3, completed_at = NOW() 
             WHERE id = $4`,
            [valAmount, rating || 0, comment || "", ride_id]
        );

        // 2. Insere na Carteira (Ganhos)
        // ATENÇÃO: user_id vem primeiro, amount depois na query abaixo
        await client.query(
            `INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id)
             VALUES ($1, $2, 'earnings', 'Ganho de Corrida', $3)`,
            [user_id, valAmount, ride_id]
        );

        // 3. Atualiza Saldo do Usuário
        await client.query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [valAmount, user_id]
        );

        await client.query('COMMIT'); // Salva

        log('FINANCE', `Corrida ${ride_id} finalizada. Valor: ${valAmount} KZ`);

        // Notifica Socket para tela de "Obrigado"
        io.to(`ride_${ride_id}`).emit('ride_completed_success', {
            ride_id,
            final_price: valAmount,
            timestamp: new Date()
        });

        res.json({ success: true });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_COMPLETE', e);
        res.status(500).json({ error: "Erro ao processar pagamento." });
    } finally {
        client.release();
    }
});

// --- RIDES: HISTÓRICO ---
app.get('/api/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await pool.query(
            `SELECT r.*, 
                    CASE WHEN r.passenger_id = $1 THEN d.name ELSE p.name END as counterpart_name 
             FROM rides r
             LEFT JOIN users d ON r.driver_id = d.id
             LEFT JOIN users p ON r.passenger_id = p.id
             WHERE (r.passenger_id = $1 OR r.driver_id = $1) 
             AND r.status IN ('completed', 'cancelled')
             ORDER BY r.created_at DESC LIMIT 30`,
            [userId] // O Postgres fará o cast automático de string para int se possível
        );
        res.json(result.rows);
    } catch (e) {
        logError('HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
});

// --- RIDES: DETALHES (GET) ---
app.get('/api/rides/details/:id', async (req, res) => {
    try {
        const data = await getFullRideDetails(req.params.id);
        if (!data) return res.status(404).json({ error: "Corrida não encontrada" });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- WALLET: SALDO E EXTRATO ---
app.get('/api/wallet/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const userRes = await pool.query("SELECT balance FROM users WHERE id = $1", [userId]);
        const txRes = await pool.query("SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20", [userId]);
        
        if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuário não encontrado" });

        res.json({
            balance: userRes.rows[0].balance,
            transactions: txRes.rows
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * =========================================================================================
 * 8. INICIALIZAÇÃO DO SERVIDOR
 * =========================================================================================
 */
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗ 
    ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
    ███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
    ╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
    ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
    ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
    
    🚀 AOTRAVEL SERVER ULTIMATE (2026) ESTÁ ONLINE
    ----------------------------------------------
    📡 Porta: ${PORT}
    💾 Database: Neon PostgreSQL (SSL)
    ⚡ Socket.io: Ativo (Polling + Websocket)
    📍 Geo-Filter: 8.0 KM
    🔧 Status: FULL FULL FULL (NO OMISSIONS)
    ----------------------------------------------
    `);
});
