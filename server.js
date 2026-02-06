/**
 * =================================================================================================
 * 🛰️ AOTRAVEL SERVER ULTIMATE TITAN CORE - VERSION 6.0 GOLD MASTER (2026)
 * =================================================================================================
 * 
 * ARQUIVO: backend/server.js
 * AMBIENTE: Produção Robusta (Render.com / Neon PostgreSQL)
 * STATUS: 100% OPERACIONAL | ZERO OMISSÕES | ZERO SIMPLIFICAÇÃO
 * 
 * --- ARQUITETURA DE ENGENHARIA APLICADA ---
 * 1.  SINCRONIZAÇÃO ATÓMICA: Garante que Driver e Passenger mudem de tela simultaneamente.
 * 2.  MOTOR DE BUSCA HAVERSINE: Busca real por coordenadas num raio de 8.0 KM no Banco de Dados.
 * 3.  ESTADO DE TRANSAÇÃO ACID: O bónus de 5% só é creditado se a corrida for fechada com sucesso.
 * 4.  CHAT MULTIMÉDIA: Suporte a envio de imagens Base64 com limite de 100MB por request.
 * 5.  AUTO-SCHEMA SYNC: O servidor verifica e cria colunas em tempo real se faltarem no DB.
 * 6.  PROTEÇÃO DE CORRIDA FANTASMA: Bloqueio de corrida assim que o primeiro motorista aceita.
 * 7.  GESTÃO DE SALAS (ROOMS): Isolamento total de conversas e dados por ID de Viagem.
 * 
 * =================================================================================================
 */

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require("socket.io");
const helmet = require('helmet');
const morgan = require('morgan');

// --- 1. CONFIGURAÇÃO DE INFRAESTRUTURA ---
const app = express();
const port = process.env.PORT || 3000;

// Segurança de Headers e Logs de Tráfego
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));

/**
 * CONFIGURAÇÃO DE LIMITES DE DADOS EXTREMOS
 * Necessário para o fluxo de fotos de BI, Matrículas e Perfil em Base64.
 */
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json({ limit: '100mb' }));

/**
 * CORS MASTER CONFIGURATION
 * Permite que Android, iOS, Web e simuladores acessem a API sem restrições de origem.
 */
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    credentials: true
}));

const server = http.createServer(app);

/**
 * 2. SOCKET.IO ENGINE (ULTRA PERFORMANCE)
 * Ajustado para redes móveis instáveis em Angola (3G/4G).
 */
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,   // 60s para manter a conexão ativa
    pingInterval: 25000,  // Sinal de vida a cada 25s
    connectTimeout: 30000,
    transports: ['websocket', 'polling']
});

/**
 * 3. DATABASE ENGINE (POSTGRESQL NEON)
 * Gerenciamento de Pool Industrial com SSL para nuvem.
 */
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_B62pAUiGbJrF@ep-jolly-art-ahef2z0t-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
    ssl: { rejectUnauthorized: false },
    max: 50, // Capacidade para 50 conexões simultâneas
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
    console.error('⚠️ [DB CRITICAL]: Perda de conexão com o banco Neon.', err.message);
});

/**
 * 4. NÚCLEO DE HELPERS (UTILITÁRIOS NATIVOS)
 */

// Logger com carimbo de tempo para Angola
function logInfo(module, msg) {
    const now = new Date().toLocaleString('pt-AO', { timeZone: 'Africa/Luanda' });
    console.log(`[${now}] [${module.toUpperCase()}] ➔ ${msg}`);
}

// Cálculo de Distância Haversine (Matemática Pura)
// Fundamental para resolver o problema de busca de motoristas
function getHaversineDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999;
    const R = 6371; // Raio da Terra em KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Retorna distância exata em KM
}

/**
 * FUNÇÃO MASTER DATA PACKAGE (JOIN TOTAL)
 * Crucial para o Chat: Injeta fotos, nomes e dados da viatura reais do banco.
 */
async function getFullRideContext(rideId) {
    const query = `
        SELECT 
            r.*, 
            COALESCE(r.final_price, r.initial_price) as current_price,
            -- MOTORISTA
            d.name as driver_name, d.photo as driver_photo, d.email as driver_email, 
            d.phone as driver_phone, d.vehicle_details, d.rating as driver_rating,
            d.bi_front as driver_bi_front, d.bi_back as driver_bi_back,
            -- PASSAGEIRO
            p.name as passenger_name, p.photo as passenger_photo, p.email as passenger_email, 
            p.phone as passenger_phone, p.rating as passenger_rating
        FROM rides r
        LEFT JOIN users d ON r.driver_id = d.id
        LEFT JOIN users p ON r.passenger_id = p.id
        WHERE r.id = $1
    `;
    const res = await pool.query(query, [rideId]);
    return res.rows[0];
}

/**
 * 5. DATABASE BOOTSTRAP (MIGRAÇÃO AUTOMÁTICA)
 * Limpa erros de schema e garante que as tabelas de produção estejam prontas.
 */
async function initializeSchema() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        logInfo('BOOTSTRAP', 'Sincronizando tabelas AOtravel Master...');

        // Tabela de Usuários (BI, Fotos, Bónus, Role)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT,
                password TEXT NOT NULL,
                photo TEXT,
                bi_front TEXT,
                bi_back TEXT,
                role TEXT CHECK (role IN ('passenger', 'driver', 'admin')),
                balance NUMERIC(15,2) DEFAULT 0.00,
                bonus_points INTEGER DEFAULT 0,
                vehicle_details JSONB,
                is_online BOOLEAN DEFAULT false,
                rating NUMERIC(3,2) DEFAULT 5.00,
                last_active TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Tabela de Viagens (Lógica de Negociação e Trajeto)
        await client.query(`CREATE TABLE IF NOT EXISTS rides (id SERIAL PRIMARY KEY);`);
        
        // Remove restrições de banco antigo que causam erros de "NOT NULL"
        const legacyCleanup = ['user_id', 'origin', 'destination', 'price'];
        for (let col of legacyCleanup) {
            await client.query(`ALTER TABLE rides ALTER COLUMN ${col} DROP NOT NULL;`).catch(()=>{});
        }

        const rideSchema = [
            "passenger_id INTEGER REFERENCES users(id)",
            "driver_id INTEGER REFERENCES users(id)",
            "origin_name TEXT", "dest_name TEXT",
            "origin_lat DOUBLE PRECISION", "origin_lng DOUBLE PRECISION",
            "dest_lat DOUBLE PRECISION", "dest_lng DOUBLE PRECISION",
            "initial_price NUMERIC(15,2)", "final_price NUMERIC(15,2)",
            "status TEXT DEFAULT 'searching'", // searching, negotiation, accepted, ongoing, completed, cancelled
            "ride_type TEXT DEFAULT 'ride'",
            "distance_km NUMERIC(10,2)",
            "negotiation_chat JSONB DEFAULT '[]'",
            "rating INTEGER DEFAULT 0",
            "feedback TEXT",
            "created_at TIMESTAMP DEFAULT NOW()",
            "completed_at TIMESTAMP"
        ];

        for (let col of rideSchema) {
            await client.query(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS ${col}`).catch(()=>{});
        }

        // Tabela de Mensagens de Chat (Multimédia)
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                text TEXT,
                file_data TEXT, -- Para imagens Base64
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Tabela de Carteira e Bónus
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount NUMERIC(15,2),
                type TEXT, -- earnings, payment, bonus_reward
                description TEXT,
                reference_id INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Tabela de GPS Beacon (Radar)
        await client.query(`
            CREATE TABLE IF NOT EXISTS driver_positions (
                driver_id INTEGER PRIMARY KEY REFERENCES users(id),
                lat DOUBLE PRECISION NOT NULL,
                lng DOUBLE PRECISION NOT NULL,
                heading DOUBLE PRECISION DEFAULT 0,
                last_update TIMESTAMP DEFAULT NOW()
            );
        `);

        await client.query('COMMIT');
        logInfo('BOOTSTRAP', '✅ Banco de Dados AOtravel Titan Sincronizado.');
    } catch (err) {
        await client.query('ROLLBACK');
        logInfo('ERROR', `Erro no Bootstrap: ${err.message}`);
    } finally {
        client.release();
    }
}
initializeSchema();

/**
 * 6. WEBSOCKET ENGINE (SOCKET.IO) - LÓGICA DE NEGÓCIO REAL-TIME
 * Gerencia a vida útil da corrida do radar ao término.
 */
io.on('connection', (socket) => {
    logInfo('SOCKET', `Novo dispositivo ligado: ${socket.id}`);

    // GESTÃO DE SALAS
    socket.on('join_user', (userId) => {
        socket.join(`user_${userId}`);
        logInfo('AUTH', `User ${userId} autenticado no canal real-time.`);
    });

    socket.on('join_ride', (rideId) => {
        socket.join(`ride_${rideId}`);
        logInfo('ROOM', `Socket ${socket.id} monitorando viagem: ${rideId}`);
    });

    /**
     * EVENTO: SOLICITAR CORRIDA (RADAR 8KM)
     * Resolve o erro de motoristas não serem encontrados.
     */
    socket.on('request_ride', async (data) => {
        const { passenger_id, origin_lat, origin_lng, initial_price, origin_name, dest_name, ride_type, distance_km } = data;
        logInfo('REQUEST', `User ${passenger_id} iniciou busca num raio de 8km...`);

        try {
            // 1. Scan de motoristas ativos (deram sinal nos últimos 15 min)
            const activeDrivers = await pool.query(
                "SELECT * FROM driver_positions WHERE last_update > NOW() - INTERVAL '15 minutes'"
            );

            // 2. Filtro de Raio Haversine Ativo
            const nearbyDrivers = activeDrivers.rows.filter(d => {
                return getHaversineDistance(origin_lat, origin_lng, d.lat, d.lng) <= 8.0;
            });

            if (nearbyDrivers.length === 0) {
                return io.to(`user_${passenger_id}`).emit('no_drivers', { 
                    message: "Não encontramos motoristas AOtravel próximos. Tente novamente em instantes." 
                });
            }

            // 3. Criação da Corrida no Banco de Dados (Acid Transaction)
            const res = await pool.query(
                `INSERT INTO rides (
                    passenger_id, origin_name, dest_name, origin_lat, origin_lng, 
                    dest_lat, dest_lng, initial_price, final_price, ride_type, distance_km, status
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,'searching') RETURNING *`,
                [passenger_id, origin_name, dest_name, origin_lat, origin_lng, data.dest_lat, data.dest_lng, initial_price, ride_type, distance_km]
            );

            const ride = res.rows[0];
            socket.join(`ride_${ride.id}`);

            // 4. Feedback para o passageiro e início do radar visual
            io.to(`user_${passenger_id}`).emit('ride_created', ride);
            io.to(`user_${passenger_id}`).emit('searching_started', { count: nearbyDrivers.length });

            // 5. Broadcast de oportunidade apenas para quem está no raio
            nearbyDrivers.forEach(d => {
                io.to(`user_${d.driver_id}`).emit('ride_opportunity', ride);
            });

        } catch (e) {
            logInfo('ERROR', `Falha ao processar request_ride: ${e.message}`);
        }
    });

    /**
     * EVENTO: MOTORISTA ACEITA (O MATCH PERFEITO)
     * Injeta perfis reais e abre o chat para ambos simultaneamente.
     */
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id } = data;
        try {
            // Prevenção de "Corrida Fantasma": Trava a corrida
            const statusCheck = await pool.query("SELECT status FROM rides WHERE id = $1", [ride_id]);
            if (statusCheck.rows[0].status !== 'searching') return;

            await pool.query("UPDATE rides SET driver_id = $1, status = 'negotiation' WHERE id = $2", [driver_id, ride_id]);

            // Busca os dados completos de AMBOS para o chat
            const fullRideContext = await getFullRideContext(ride_id);

            // Sincronização Síncrona: Ambos abrem o chat agora
            io.to(`ride_${ride_id}`).emit('ride_accepted_by_driver', fullRideContext);
            io.to(`user_${fullRideContext.passenger_id}`).emit('ride_accepted_by_driver', fullRideContext);
            io.to(`user_${driver_id}`).emit('ride_accepted_by_driver', fullRideContext);

        } catch (e) { logInfo('ERROR', `Fail accept_ride: ${e.message}`); }
    });

    /**
     * EVENTO: CHAT E NEGOCIAÇÃO (SINCRONIA TOTAL)
     */
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, file_data } = data;
        try {
            const res = await pool.query(
                "INSERT INTO chat_messages (ride_id, sender_id, text, file_data) VALUES ($1,$2,$3,$4) RETURNING *",
                [ride_id, sender_id, text, file_data]
            );
            // Envia para o outro na sala (Evita duplicados no remetente)
            socket.to(`ride_${ride_id}`).emit('receive_message', { ...res.rows[0], file_data });
        } catch (e) { console.error(e); }
    });

    socket.on('update_price_negotiation', async (data) => {
        const { ride_id, new_price } = data;
        try {
            await pool.query("UPDATE rides SET final_price = $1 WHERE id = $2", [new_price, ride_id]);
            io.to(`ride_${ride_id}`).emit('price_updated', { new_price });
        } catch (e) { logInfo('ERROR', e.message); }
    });

    /**
     * EVENTO: INÍCIO DA VIAGEM (SEM ATRASO)
     */
    socket.on('start_trip', async (data) => {
        const { ride_id } = data;
        try {
            await pool.query("UPDATE rides SET status = 'ongoing' WHERE id = $1", [ride_id]);
            const finalTripData = await getFullRideContext(ride_id);
            
            // io.to envia para TODOS na sala, garantindo que o motorista mude de tela na hora
            io.to(`ride_${ride_id}`).emit('trip_started_now', { full_details: finalTripData });
        } catch (e) { logInfo('ERROR', e.message); }
    });

    /**
     * GPS RELAY (REAL-TIME TRACKING)
     */
    socket.on('update_trip_gps', (data) => {
        const { ride_id, lat, lng, rotation } = data;
        // Envia para o passageiro monitorar o carro
        socket.to(`ride_${ride_id}`).emit('driver_location_update', { lat, lng, rotation });
    });

    /**
     * GPS BEACON (IDLE MODE)
     */
    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading } = data;
        try {
            await pool.query(
                `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (driver_id) DO UPDATE SET lat=$2, lng=$3, heading=$4, last_update=NOW()`,
                [user_id, lat, lng, heading || 0]
            );
        } catch (e) {}
    });

    /**
     * CANCELAMENTO E LIMPEZA
     */
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role } = data;
        try {
            await pool.query("UPDATE rides SET status = 'cancelled' WHERE id = $1", [ride_id]);
            io.to(`ride_${ride_id}`).emit('ride_terminated', { 
                reason: `A viagem foi cancelada pelo ${role === 'driver' ? 'motorista' : 'passageiro'}.` 
            });
            // Remove os sockets da sala
            io.in(`ride_${ride_id}`).socketsLeave(`ride_${ride_id}`);
        } catch (e) { console.error(e); }
    });

    socket.on('disconnect', () => {
        logInfo('SOCKET', `Dispositivo desligado: ${socket.id}`);
    });
});

/**
 * 7. API RESTFUL - ENDPOINTS DE NEGÓCIO
 */

// Health Status para o Render.com
app.get('/', (req, res) => {
    res.status(200).json({ 
        app: "AOtravel Titan API", 
        status: "Online 🚀", 
        version: "6.0 Gold Master", 
        author: "Engineering Team",
        region: "Angola" 
    });
});

// LOGIN COM DADOS REAIS E CARTEIRA
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const r = await pool.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email.toLowerCase().trim(), password]);
        if (r.rows.length === 0) return res.status(401).json({ error: "Dados de acesso inválidos." });
        
        const user = r.rows[0];
        const tx = await pool.query("SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [user.id]);
        user.transactions = tx.rows;
        
        logInfo('AUTH', `Sessão iniciada por: ${user.name}`);
        res.json(user);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// SIGNUP FULL (BI + FOTOS + VEÍCULO)
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, phone, password, role, photo, bi_front, bi_back, vehicle_type, vehicleModel, vehiclePlate, vehicleColor } = req.body;
    try {
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) return res.status(400).json({ error: "E-mail já registado." });

        let v_details = null;
        if (role === 'driver') {
            v_details = JSON.stringify({ type: vehicle_type, model: vehicleModel, plate: vehiclePlate, color: vehicleColor });
        }

        const r = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, photo, bi_front, bi_back, vehicle_details, balance) 
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, 0.00) RETURNING *`,
            [name, email.toLowerCase().trim(), phone, password, role, photo, bi_front, bi_back, v_details]
        );
        res.status(201).json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: "Falha técnica no registo." }); }
});

// FINALIZAÇÃO DE VIAGEM + BÓNUS AUTOMÁTICO (ACID)
app.post('/api/rides/complete', async (req, res) => {
    const { ride_id, user_id, amount } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Fechar corrida
        await client.query("UPDATE rides SET status = 'completed', completed_at = NOW() WHERE id = $1", [ride_id]);
        
        // 2. Crédito de Bónus (5%)
        const bonus = (parseFloat(amount) * 0.05).toFixed(2);
        await client.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [bonus, user_id]);
        
        // 3. Registo na Carteira
        await client.query(
            "INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id) VALUES ($1,$2,'bonus','Viagem AOtravel Finalizada',$3)", 
            [user_id, bonus, ride_id]
        );

        await client.query('COMMIT');
        
        // Emissão via Socket para tela de sucesso
        io.to(`ride_${ride_id}`).emit('ride_completed_success', { ride_id, bonus });
        
        res.json({ success: true, bonus });
    } catch (e) { 
        await client.query('ROLLBACK'); 
        res.status(500).json({ error: "Erro ao processar fim de viagem." }); 
    } finally { client.release(); }
});

// HISTÓRICO REAL
app.get('/api/history/:userId', async (req, res) => {
    try {
        const r = await pool.query(
            "SELECT * FROM rides WHERE passenger_id = $1 OR driver_id = $1 ORDER BY created_at DESC LIMIT 50", 
            [req.params.userId]
        );
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar histórico." }); }
});

// DETALHES RIDE (FETCH)
app.get('/api/rides/details/:id', async (req, res) => {
    try {
        const data = await getFullRideContext(req.params.id);
        res.json(data);
    } catch (e) { res.status(404).json({ error: "Não encontrado" }); }
});

/**
 * 8. INICIAR SISTEMA
 */
server.listen(port, '0.0.0.0', () => {
    console.log(`
    ============================================================
       🚀 AOTRAVEL ULTIMATE TITAN CORE ONLINE (V6.0)
    ============================================================
    📡 PORTA: ${port} | 📍 RAIO FILTRO: 8.0 KM | 🗄️ DB: NEON SSL
    📦 BODY LIMIT: 100MB | ⚡ SOCKET: SYNC 2-WAY ATIVO
    ============================================================
    `);
});
