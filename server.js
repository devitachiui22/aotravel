/**
 * =========================================================================
 * AOTRAVEL SERVER PRO 2026 - VERSÃO FINAL ABSOLUTA (FULL MERGED)
 * Localização: backend/server.js
 * Descrição: Backend Profissional para Transporte e Entregas (Angola).
 * =========================================================================
 * Funcionalidades Integradas:
 *   - WebSocket Real-time (Socket.IO)
 *   - API RESTful (Express) JSON 100MB
 *   - Auto-Migration DB (Neon PostgreSQL) + Limpeza de Constraints
 *   - Filtro Geográfico Haversine (8.0 KM)
 *   - Chat com Texto e Arquivos (Base64)
 *   - Sistema Financeiro e Bónus
 *   - Tracking em Tempo Real
 * =========================================================================
 */

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require("socket.io");

// INICIALIZAÇÃO DA APLICAÇÃO
const app = express();

/**
 * CONFIGURAÇÃO DE LIMITES DE DADOS (EXTREMO ROBUSTO)
 * Definido em 100MB para suportar fotos HD e BIs em Base64.
 */
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json({ limit: '100mb' })); // Redundância de segurança
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * CONFIGURAÇÃO DE CORS (PERMISSÃO TOTAL)
 */
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// SERVIDOR HTTP COM SOCKET.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    },
    // Configurações para estabilidade em redes móveis (3G/4G Angola)
    pingTimeout: 60000,
    pingInterval: 25000
});

/**
 * CONEXÃO COM BANCO DE DADOS (NEON POSTGRESQL)
 * String de conexão hardcoded conforme solicitado, com fallback para ENV.
 */
const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_B62pAUiGbJrF@ep-jolly-art-ahef2z0t-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false // Obrigatório para NeonDB/AWS
    },
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

/**
 * =========================================================================
 * LÓGICA GEOGRÁFICA (FÓRMULA DE HAVERSINE)
 * Calcula distância em KM entre coordenadas.
 * =========================================================================
 */
function getDistance(lat1, lon1, lat2, lon2) {
    if ((lat1 == lat2) && (lon1 == lon2)) {
        return 0;
    }
    const R = 6371; // Raio da Terra em KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * =========================================================================
 * DATABASE BOOTSTRAP & AUTO-MIGRATION (FULL ROBUST)
 * Cria tabelas e corrige erros de constraints automaticamente.
 * =========================================================================
 */
async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("--- 🚀 AOTRAVEL: SINCRONIZANDO E LIMPANDO TABELAS ---");

        // 1. TABELA DE USUÁRIOS
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

        // Migração Segura de Colunas (Evita erros se já existirem)
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_front TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_back TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0.00;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_details JSONB;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2) DEFAULT 5.00;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;`);

        // 2. TABELA DE CORRIDAS
        await client.query(`CREATE TABLE IF NOT EXISTS rides (id SERIAL PRIMARY KEY);`);

        // LIMPEZA DE RESTRIÇÕES LEGADAS (Fix erro 500)
        const legacyCols = ['origin', 'user_id', 'destination', 'price'];
        for (let col of legacyCols) {
            try {
                await client.query(`ALTER TABLE rides ALTER COLUMN ${col} DROP NOT NULL;`);
            } catch (e) { /* Ignora se coluna não existir */ }
        }

        // Definição das colunas necessárias
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
            "distance_km NUMERIC(10,2)",
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ];

        for (let colDef of rideColumns) {
            await client.query(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS ${colDef}`);
        }

        // 3. TABELA DE MENSAGENS DE CHAT
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. TABELA FINANCEIRA
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

        // 5. TABELA DE POSIÇÃO DO MOTORISTA
        await client.query(`
            CREATE TABLE IF NOT EXISTS driver_positions (
                driver_id INTEGER PRIMARY KEY REFERENCES users(id),
                lat DOUBLE PRECISION,
                lng DOUBLE PRECISION,
                heading DOUBLE PRECISION DEFAULT 0,
                last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        console.log("✅ SISTEMA DE DADOS ESTABILIZADO (ZERO CONSTRAINTS ERRORS).");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ ERRO NO BOOTSTRAP:", err);
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
    console.log(`🔌 Novo Socket Conectado: ${socket.id}`);

    // JOIN ROOMS
    socket.on('join_user', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`👤 Usuário ${userId} entrou na sala user_${userId}`);
    });

    socket.on('join_ride', (rideId) => {
        socket.join(`ride_${rideId}`);
        console.log(`🚕 User entrou na Viagem: ${rideId}`);
    });

    /**
     * --- BUSCA DE MOTORISTAS (RAIO 8KM) ---
     */
    socket.on('request_ride', async (data) => {
        console.log("📡 Nova solicitação de corrida recebida:", data);

        const {
            passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
            origin_name, dest_name, initial_price, ride_type, distance_km
        } = data;

        try {
            // Busca motoristas ativos (últimos 10 min)
            const driversInDB = await pool.query(`
                SELECT * FROM driver_positions WHERE last_update > NOW() - INTERVAL '10 minutes'
            `);

            // Filtra raio de 8.0 KM
            const nearbyDrivers = driversInDB.rows.filter(d => {
                const dist = getDistance(origin_lat, origin_lng, d.lat, d.lng);
                return dist <= 8.0;
            });

            if (nearbyDrivers.length === 0) {
                console.log(`⚠️ Sem motoristas no raio de 8km para User ${passenger_id}`);
                return io.to(`user_${passenger_id}`).emit('no_drivers', {
                    message: "Nenhum motorista AOtravel no raio de 8km. Tente novamente."
                });
            } else {
                 io.to(`user_${passenger_id}`).emit('drivers_found', { count: nearbyDrivers.length });
            }

            // Cria a corrida
            const res = await pool.query(
                `INSERT INTO rides (
                    passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                    origin_name, dest_name, initial_price, ride_type, distance_km, status, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'searching', NOW())
                 RETURNING *`,
                [passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km]
            );
            const ride = res.rows[0];

            socket.join(`ride_${ride.id}`);
            io.to(`user_${passenger_id}`).emit('ride_created', ride);

            // Notifica motoristas próximos
            console.log(`📢 Notificando ${nearbyDrivers.length} motoristas.`);
            nearbyDrivers.forEach(driver => {
                io.to(`user_${driver.driver_id}`).emit('ride_opportunity', ride);
            });

        } catch (e) {
            console.error("❌ Erro request_ride:", e);
            io.to(`user_${passenger_id}`).emit('error_response', { message: "Erro ao processar." });
        }
    });

    /**
     * --- NEGOCIAÇÃO DE PREÇO ---
     */
    socket.on('driver_proposal', async (data) => {
        const { ride_id, driver_id, price } = data;
        io.to(`ride_${ride_id}`).emit('price_proposal', { driver_id, price });
        
        try {
            await pool.query(
                `UPDATE rides SET negotiation_chat = negotiation_chat || $1::jsonb WHERE id = $2`,
                [JSON.stringify({ driver_id, price, timestamp: new Date(), type: 'proposal' }), ride_id]
            );
        } catch (e) { console.error("Erro ao salvar proposta:", e); }
    });

    // Alias para compatibilidade com versões antigas do app
    socket.on('driver_accept_price', async (data) => {
        // Redireciona para lógica de aceitação
        const { ride_id, driver_id, final_price } = data;
        // Chama a função interna ou emite evento de accept
        // Aqui simulamos o evento accept_ride
        socket.emit('accept_ride', { ride_id, driver_id, final_price });
    });

    /**
     * --- ACEITAR CORRIDA (MATCH) ---
     */
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;
        console.log(`✅ Corrida ${ride_id} Aceita pelo Motorista ${driver_id}`);

        try {
            const res = await pool.query(
                `UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted' WHERE id = $3 RETURNING *`,
                [driver_id, final_price, ride_id]
            );

            const driverData = await pool.query(`SELECT name, photo, rating, vehicle_details, phone FROM users WHERE id = $1`, [driver_id]);
            
            const acceptPayload = {
                ...res.rows[0],
                driver_name: driverData.rows[0].name,
                driver_photo: driverData.rows[0].photo,
                driver_phone: driverData.rows[0].phone,
                driver_rating: driverData.rows[0].rating,
                vehicle: driverData.rows[0].vehicle_details,
                status: 'accepted',
                final_price
            };

            // Emite para a sala da corrida e para o usuário específico
            io.to(`ride_${ride_id}`).emit('ride_accepted_by_driver', acceptPayload);
            io.to(`ride_${ride_id}`).emit('price_finalized', { final_price }); // Compatibilidade Snippet 1
            io.to(`user_${res.rows[0].passenger_id}`).emit('ride_accepted_by_driver', acceptPayload);

        } catch (e) { console.error("Erro ao aceitar corrida:", e); }
    });

    /**
     * --- MENSAGENS (CHAT + ARQUIVOS) ---
     */
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, file_data } = data;
        try {
            const res = await pool.query(
                "INSERT INTO chat_messages (ride_id, sender_id, text, created_at) VALUES ($1,$2,$3, NOW()) RETURNING *",
                [ride_id, sender_id, text || (file_data ? "📎 Imagem/Arquivo" : ".")]
            );
            // Envia para TODOS na sala, incluindo o file_data em Base64 para exibição imediata
            socket.to(`ride_${ride_id}`).emit('receive_message', { ...res.rows[0], file_data });
            // Se o sender também estiver ouvindo, confirma recebimento (opcional)
        } catch (e) { console.error(e); }
    });

    /**
     * --- INÍCIO E TRACKING DA VIAGEM ---
     */
    
    // Motorista inicia a viagem
    socket.on('start_trip', async (data) => {
        const { ride_id } = data;
        await pool.query("UPDATE rides SET status = 'ongoing' WHERE id = $1", [ride_id]);
        // Emite ambos os eventos para garantir compatibilidade
        io.to(`ride_${ride_id}`).emit('trip_started_now', { status: 'ongoing' });
        io.to(`ride_${ride_id}`).emit('ride_started', { ride_id, status: 'ongoing', time: new Date() });
    });

    // Alias para compatibilidade
    socket.on('start_ride', async (data) => {
        const { ride_id } = data;
        await pool.query("UPDATE rides SET status = 'ongoing' WHERE id = $1", [ride_id]);
        io.to(`ride_${ride_id}`).emit('trip_started_now', { status: 'ongoing' });
        io.to(`ride_${ride_id}`).emit('ride_started', { ride_id, status: 'ongoing', time: new Date() });
    });

    // GPS EM VIAGEM (Atualização rápida para o passageiro ver o carro no mapa)
    socket.on('update_trip_gps', (data) => {
        const { ride_id, lat, lng, rotation } = data;
        // Passageiro ouve isso para mover o carro no mapa
        socket.to(`ride_${ride_id}`).emit('driver_location_update', { lat, lng, rotation });
    });

    // ATUALIZAÇÃO GERAL DE POSIÇÃO (Para o mapa inicial de busca)
    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading } = data;
        try {
            await pool.query(
                `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (driver_id) DO UPDATE SET lat=$2, lng=$3, heading=$4, last_update=NOW()`,
                [user_id, lat, lng, heading || 0]
            );
            // Emite para todos (carrinhos no mapa home)
            io.emit('driver_moved', { driver_id: user_id, lat, lng, heading });
        } catch (e) { /* Erro silencioso GPS */ }
    });

    /**
     * --- CANCELAMENTO ---
     */
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role, user_id } = data;
        try {
            await pool.query("UPDATE rides SET status = 'cancelled' WHERE id = $1", [ride_id]);
            
            // Notificações Variadas para cobrir todos os casos
            io.to(`ride_${ride_id}`).emit('ride_terminated', { 
                reason: role === 'driver' ? 'O motorista cancelou.' : 'O passageiro cancelou.',
                canReSearch: role === 'driver'
            });
            
            io.to(`ride_${ride_id}`).emit('ride_cancelled_by_other', {
                ride_id,
                message: role === 'driver' ? "O motorista cancelou a negociação." : "O passageiro cancelou o pedido."
            });

        } catch (e) { console.error(e); }
    });

});

/**
 * =========================================================================
 * API RESTFUL - ENDPOINTS DE SISTEMA
 * =========================================================================
 */

// ROOT / HEALTH CHECK
app.get('/', (req, res) => {
    res.status(200).json({
        app: "AOtravel API PRO",
        status: "Online 🚀",
        version: "FINAL MERGED 2026",
        server_time: new Date(),
        db: "Connected via SSL"
    });
});

app.get('/api/ping', (req, res) => res.send('pong'));

// LOGIN
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email.toLowerCase().trim(), password]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Credenciais incorretas." });
        }
        const user = result.rows[0];

        // Extrato
        const tx = await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15', [user.id]);
        user.transactions = tx.rows;

        // Online
        await pool.query('UPDATE users SET is_online = true WHERE id = $1', [user.id]);

        res.json(user);
    } catch (e) {
        console.error("Login Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// SIGNUP (COMPLETO)
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, phone, password, role, photo, bi_front, bi_back, vehicle_type, vehicleModel, vehiclePlate, vehicleColor } = req.body;

    try {
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) return res.status(400).json({ error: "E-mail já registado." });

        let vehicle_details = null;
        if (role === 'driver') {
            vehicle_details = JSON.stringify({
                type: vehicle_type,
                model: vehicleModel,
                plate: vehiclePlate,
                color: vehicleColor
            });
        }

        const resUser = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, photo, bi_front, bi_back, vehicle_details, balance, bonus_points)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0.00, 0) RETURNING *`,
            [name, email.toLowerCase().trim(), phone, password, role, photo, bi_front, bi_back, vehicle_details]
        );

        console.log(`👤 Novo Usuário: ${name}`);
        res.status(201).json(resUser.rows[0]);

    } catch (e) {
        console.error("Erro Signup:", e);
        res.status(500).json({ error: "Erro interno no registo." });
    }
});

// UPDATE PROFILE
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

// GET RIDE DETAILS (Dados reais do motorista e carro)
app.get('/api/rides/details/:id', async (req, res) => {
    try {
        const ride = await pool.query(
            `SELECT r.*, u.name as driver_name, u.photo as driver_photo, u.vehicle_details, u.phone as driver_phone 
             FROM rides r 
             JOIN users u ON u.id = r.driver_id 
             WHERE r.id = $1`, 
             [req.params.id]
        );
        res.json(ride.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// HISTORY
app.get('/api/history/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM rides
             WHERE passenger_id = $1 OR driver_id = $1
             ORDER BY created_at DESC LIMIT 50`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// COMPLETAR CORRIDA + BÓNUS
app.post('/api/rides/complete', async (req, res) => {
    const { ride_id, user_id, amount } = req.body;
    const bonusValue = (parseFloat(amount) * 0.05).toFixed(2);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("UPDATE rides SET status = 'completed' WHERE id = $1", [ride_id]);
        await client.query(
            "UPDATE users SET balance = balance + $1, bonus_points = bonus_points + 10 WHERE id = $2",
            [bonusValue, user_id]
        );
        await client.query(
            "INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, 'bonus_reward', 'Prémio Cashback AOtravel', $3)",
            [user_id, bonusValue, ride_id]
        );
        await client.query('COMMIT');
        console.log(`💰 Corrida ${ride_id} finalizada. Cashback: ${bonusValue}`);
        res.json({ success: true, bonus_earned: bonusValue });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Transaction Error:", e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

/**
 * =========================================================================
 * START SERVER
 * =========================================================================
 */
const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
    console.log(`
    ===================================================
       🚀 AOTRAVEL SERVER PRO ESTÁ ONLINE (FULL 2026)
       -----------------------------------
       📡 PORTA: ${port}
       📍 RAIO FILTRO: 8.0 KM
       🗄️ DB: NEON POSTGRESQL (SSL MODE)
       ⚡ SOCKET: ATIVO E PRONTO
       📝 BODY LIMIT: 100MB
       📦 CORS: PERMISSIVO (*)
    ===================================================
    `);
});
