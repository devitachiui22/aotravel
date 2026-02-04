/**
 * =========================================================================
 * AOTRAVEL SERVER PRO - VERSÃO FINAL ABSOLUTA (FULL 2026)
 * =========================================================================
 * Descrição: Backend Profissional para Transporte e Entregas (Angola).
 * Funcionalidades:
 *   - WebSocket Real-time com salas e Chat de Negociação
 *   - API RESTful (Express) com suporte a JSON 100MB
 *   - Migração Automática de DB (Neon PostgreSQL)
 *   - Filtro Geográfico Haversine (Raio de 3.0 KM)
 *   - Gestão de BI (Frente/Verso) e Fotos Base64
 *   - Sistema de Fidelidade (Bónus Real de 5% na Carteira)
 *   - Status Route (Root) para Health Check do Render
 * =========================================================================
 */

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require("socket.io");

// Inicialização da Aplicação
const app = express();

/**
 * CONFIGURAÇÃO DE PORTA DINÂMICA
 */
const port = process.env.PORT || 3000;

/**
 * CONFIGURAÇÃO DE LIMITES DE DADOS (EXTREMO ROBUSTO)
 * Definido em 100MB para suportar strings Base64 de fotos HD e BIs.
 */
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * CONFIGURAÇÃO DE CORS (PERMISSÃO TOTAL)
 * Garante que Android, iOS e Web comuniquem sem bloqueios.
 */
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Servidor HTTP com Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

/**
 * CONEXÃO COM BANCO DE DADOS (NEON POSTGRESQL)
 * Configuração com SSL obrigatório para ambiente de produção.
 */
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_B62pAUiGbJrF@ep-jolly-art-ahef2z0t-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
    ssl: {
        rejectUnauthorized: false
    }
});

/**
 * =========================================================================
 * LÓGICA GEOGRÁFICA (HAVERSINE)
 * Calcula a distância real em KM.
 * =========================================================================
 */
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * =========================================================================
 * DATABASE BOOTSTRAP & AUTO-MIGRATION (FULL ROBUST)
 * Cria tabelas e colunas dinamicamente sem apagar dados existentes.
 * =========================================================================
 */
async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("--- 🚀 INICIANDO SINCRONIZAÇÃO TOTAL DE BANCO DE DADOS ---");

        // 1. Tabela de Usuários (Completa)
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Sincronização de Colunas (Alter Table Safety)
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_front TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_back TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0.00;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_details JSONB;`);

        // 2. Tabela de Corridas (Com Negociação)
        await client.query(`CREATE TABLE IF NOT EXISTS rides (id SERIAL PRIMARY KEY);`);
        const rideColumns = [
            "passenger_id INTEGER REFERENCES users(id)",
            "driver_id INTEGER REFERENCES users(id)",
            "origin_name TEXT",
            "dest_name TEXT",
            "origin_lat DOUBLE PRECISION",
            "origin_lng DOUBLE PRECISION",
            "dest_lat DOUBLE PRECISION",
            "dest_lng DOUBLE PRECISION",
            "initial_price NUMERIC(15,2)",
            "final_price NUMERIC(15,2)",
            "status TEXT DEFAULT 'searching'",
            "ride_type TEXT DEFAULT 'ride'",
            "negotiation_chat JSONB DEFAULT '[]'",
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ];
        for (let colDef of rideColumns) {
            await client.query(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS ${colDef}`);
        }

        // 3. Tabela de Chat
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. Tabela de Carteira
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount NUMERIC(15,2),
                type TEXT,
                description TEXT,
                reference_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. Tabela de Localização
        await client.query(`
            CREATE TABLE IF NOT EXISTS driver_positions (
                driver_id INTEGER PRIMARY KEY REFERENCES users(id),
                lat DOUBLE PRECISION,
                lng DOUBLE PRECISION,
                heading DOUBLE PRECISION,
                last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        console.log("✅ BANCO DE DADOS SINCRONIZADO (FULL VERSION).");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ ERRO NO SETUP DO DB:", err);
    } finally {
        client.release();
    }
}
bootstrapDatabase();

/**
 * =========================================================================
 * WEBSOCKET (SOCKET.IO) - LÓGICA DE NEGÓCIO REAL-TIME
 * =========================================================================
 */
io.on('connection', (socket) => {
    console.log(`🔌 Conectado: ${socket.id}`);

    // Salas
    socket.on('join_user', (userId) => socket.join(`user_${userId}`));
    socket.on('join_ride', (rideId) => socket.join(`ride_${rideId}`));

    /**
     * 1. SOLICITAR CORRIDA (FILTRO 3KM)
     */
    socket.on('request_ride', async (data) => {
        const {
            passenger_id,
            origin_lat,
            origin_lng,
            dest_lat,
            dest_lng,
            origin_name,
            dest_name,
            initial_price,
            ride_type
        } = data;

        try {
            // 1. Buscar posições dos motoristas no banco
            const driversInDB = await pool.query(`SELECT * FROM driver_positions`);

            // 2. Filtrar motoristas num raio taxativo de 3km
            const nearbyDrivers = driversInDB.rows.filter(d => {
                const dist = getDistance(origin_lat, origin_lng, d.lat, d.lng);
                return dist <= 3.0;
            });

            // 3. Caso não haja motoristas próximos, encerra aqui
            if (nearbyDrivers.length === 0) {
                return io.to(`user_${passenger_id}`).emit('no_drivers', {
                    message: "Nenhum motorista disponível no raio de 3km."
                });
            }

            // 4. Criar o registro da Corrida no Banco de Dados
            const res = await pool.query(
                `INSERT INTO rides (
                    passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                    origin_name, dest_name, initial_price, ride_type, status
                )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'searching')
                 RETURNING *`,
                [passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type]
            );

            const ride = res.rows[0];

            // 5. Coloca o passageiro na sala específica desta corrida e confirma a criação
            socket.join(`ride_${ride.id}`);
            io.to(`user_${passenger_id}`).emit('ride_created', ride);

            // 6. ATUALIZAÇÃO: Notificar apenas os motoristas qualificados dentro do raio
            nearbyDrivers.forEach(driver => {
                // Envia a oportunidade individualmente para cada motorista filtrado
                io.to(`user_${driver.driver_id}`).emit('ride_opportunity', ride);
            });

        } catch (e) {
            console.error("Erro fatal no evento request_ride:", e);
            // Opcional: Notificar o passageiro que houve um erro interno
            io.to(`user_${passenger_id}`).emit('error_response', { message: "Erro ao processar sua solicitação." });
        }
    });

    /**
     * 2. NEGOCIAÇÃO E CHAT
     */
    socket.on('driver_proposal', async (data) => {
        const { ride_id, driver_id, price } = data;
        io.to(`ride_${ride_id}`).emit('price_proposal', { driver_id, price });

        // Persistir no JSON de negociação
        await pool.query(
            `UPDATE rides SET negotiation_chat = negotiation_chat || $1::jsonb WHERE id = $2`,
            [JSON.stringify({ driver_id, price, timestamp: new Date() }), ride_id]
        );
    });

    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;
        try {
            const res = await pool.query(
                `UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted' WHERE id = $3 RETURNING *`,
                [driver_id, final_price, ride_id]
            );
            const driverData = await pool.query(`SELECT name, photo, rating FROM users WHERE id = $1`, [driver_id]);

            io.to(`ride_${ride_id}`).emit('ride_accepted_by_driver', {
                ...res.rows[0],
                driver_name: driverData.rows[0].name,
                driver_photo: driverData.rows[0].photo,
                driver_rating: driverData.rows[0].rating
            });
        } catch (e) { console.error(e); }
    });

    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text } = data;
        try {
            const res = await pool.query(
                'INSERT INTO chat_messages (ride_id, sender_id, text) VALUES ($1, $2, $3) RETURNING *',
                [ride_id, sender_id, text]
            );
            io.to(`ride_${ride_id}`).emit('receive_message', res.rows[0]);
        } catch (e) { console.error(e); }
    });

    /**
     * 3. GPS TRACKING
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
            io.emit('driver_moved', { driver_id: user_id, lat, lng, heading });
        } catch (e) { console.error(e); }
    });
});

/**
 * =========================================================================
 * API RESTFUL - ENDPOINTS DE SISTEMA
 * =========================================================================
 */

// ✅ ROTA ROOT (HEALTH CHECK CRÍTICO PARA RENDER)
app.get('/', (req, res) => {
    res.status(200).json({
        app: "AOtravel API",
        status: "Online 🚀",
        version: "4.5.0 Full",
        db_connection: "Secure (SSL)",
        limits: "100MB Body Size"
    });
});

app.get('/api/ping', (req, res) => res.send('pong'));

// ✅ LOGIN (COM TRANSAÇÕES)
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email.toLowerCase().trim(), password]);
        if (result.rows.length === 0) return res.status(401).json({ error: "Credenciais incorretas." });

        const user = result.rows[0];
        // Busca últimas 15 transações
        const tx = await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15', [user.id]);
        user.transactions = tx.rows;

        res.json(user);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ✅ SIGNUP (FULL: FOTOS, BI, VEÍCULO)
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, phone, password, role, photo, bi_front, bi_back, vehicle_type } = req.body;
    try {
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) return res.status(400).json({ error: "Este E-mail já existe." });

        const vehicle_details = vehicle_type ? JSON.stringify({ type: vehicle_type }) : null;

        const resUser = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, photo, bi_front, bi_back, vehicle_details, balance, bonus_points)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0.00, 0) RETURNING *`,
            [name, email.toLowerCase().trim(), phone, password, role, photo, bi_front, bi_back, vehicle_details]
        );
        res.status(201).json(resUser.rows[0]);
    } catch (e) {
        console.error("Erro Signup:", e);
        res.status(500).json({ error: "Erro ao criar conta." });
    }
});

// ✅ UPDATE PROFILE
app.put('/api/users/profile', async (req, res) => {
    const { id, name, photo, bi_front, bi_back } = req.body;
    try {
        const result = await pool.query(
            `UPDATE users SET
                name = COALESCE($1, name),
                photo = COALESCE($2, photo),
                bi_front = COALESCE($3, bi_front),
                bi_back = COALESCE($4, bi_back)
             WHERE id = $5 RETURNING *`,
            [name, photo, bi_front, bi_back, id]
        );
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ✅ HISTORY
app.get('/api/history/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM rides WHERE passenger_id = $1 OR driver_id = $1 ORDER BY created_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ✅ COMPLETAR CORRIDA + BÓNUS (TRANSAÇÃO ATÔMICA)
app.post('/api/rides/complete', async (req, res) => {
    const { ride_id, user_id, amount } = req.body;

    // Bónus de 5%
    const bonusValue = (parseFloat(amount) * 0.05).toFixed(2);

    const client = await pool.connect(); // Cliente dedicado para transação
    try {
        await client.query('BEGIN');

        // 1. Finalizar Status
        await client.query("UPDATE rides SET status = 'completed' WHERE id = $1", [ride_id]);

        // 2. Creditar Saldo e Pontos
        await client.query(
            "UPDATE users SET balance = balance + $1, bonus_points = bonus_points + 10 WHERE id = $2",
            [bonusValue, user_id]
        );

        // 3. Registar no Extrato
        await client.query(
            "INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, 'bonus_reward', 'Prémio Cashback AOtravel', $3)",
            [user_id, bonusValue, ride_id]
        );

        await client.query('COMMIT');
        res.json({ success: true, bonus_earned: bonusValue });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Erro Transaction:", e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

/**
 * START SERVER
 */
server.listen(port, '0.0.0.0', () => {
    console.log(`
    ===================================================
       🚀 AOTRAVEL SERVER PRO ESTÁ ONLINE (FULL 2026)
       -----------------------------------
       📡 PORTA: ${port}
       📍 RAIO: 3.0 KM
       🗄️ DB: NEON POSTGRESQL (SSL)
       ⚡ SOCKET: ATIVO
       📝 LIMIT: 100MB
    ===================================================
    `);
});
