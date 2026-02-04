/**
 * =========================================================================
 * AOTRAVEL SERVER PRO 2026 - FINAL PRODUCTION BUILD (FULL MERGED)
 * Localização: backend/server.js
 * Descrição: Backend Profissional para Transporte e Entregas (Angola).
 * Status: FIXED & ROBUST (ACID Transactions, Full Joins, 100MB Limit)
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
 * AUXILIAR: PEGAR DETALHES COMPLETOS DA CORRIDA (CRÍTICO)
 * Junta dados da corrida, passageiro e motorista (LEFT JOIN GARANTIDO).
 * =========================================================================
 */
async function getFullRideDetails(rideId) {
    const query = `
        SELECT
            r.*,
            -- DADOS DO MOTORISTA
            d.name as driver_name,
            d.photo as driver_photo,
            d.phone as driver_phone,
            d.vehicle_details,
            d.rating as driver_rating,
            d.email as driver_email,
            -- DADOS DO PASSAGEIRO
            p.name as passenger_name,
            p.photo as passenger_photo,
            p.phone as passenger_phone,
            p.rating as passenger_rating,
            p.email as passenger_email
        FROM rides r
        LEFT JOIN users d ON r.driver_id = d.id
        LEFT JOIN users p ON r.passenger_id = p.id
        WHERE r.id = $1
    `;
    const res = await pool.query(query, [rideId]);
    return res.rows[0];
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

        // Migração Segura de Colunas
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_front TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_back TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0.00;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_details JSONB;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2) DEFAULT 5.00;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;`);

        // 2. TABELA DE CORRIDAS
        await client.query(`CREATE TABLE IF NOT EXISTS rides (id SERIAL PRIMARY KEY);`);

        // LIMPEZA DE RESTRIÇÕES LEGADAS
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
        console.log(`🚕 Socket ${socket.id} entrou na Viagem: ${rideId}`);
    });

    /**
     * --- BUSCA DE MOTORISTAS (RAIO 20KM - EXPANDIDO) ---
     */
    socket.on('request_ride', async (data) => {
        console.log("📡 Nova solicitação de corrida recebida:", data);

        const {
            passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
            origin_name, dest_name, initial_price, ride_type, distance_km
        } = data;

        try {
            // Busca motoristas ativos (últimos 20 min)
            const driversInDB = await pool.query(`
                SELECT * FROM driver_positions WHERE last_update > NOW() - INTERVAL '20 minutes'
            `);

            // Filtra raio de 20.0 KM para garantir cobertura em Luanda/Benguela
            const nearbyDrivers = driversInDB.rows.filter(d => {
                const dist = getDistance(origin_lat, origin_lng, d.lat, d.lng);
                return dist <= 20.0;
            });

            if (nearbyDrivers.length === 0) {
                console.log(`⚠️ Sem motoristas no raio de 20km para User ${passenger_id}`);
                io.to(`user_${passenger_id}`).emit('no_drivers', {
                    message: "Nenhum motorista AOtravel próximo. Tente novamente."
                });
            } else {
                 io.to(`user_${passenger_id}`).emit('drivers_found', { count: nearbyDrivers.length });
            }

            // CRIA A CORRIDA (PERSISTÊNCIA DE PREÇO INICIAL)
            const res = await pool.query(
                `INSERT INTO rides (
                    passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                    origin_name, dest_name, initial_price, final_price, ride_type, distance_km, status, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW())
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
     * --- NEGOCIAÇÃO DE PREÇO (PROPOSTA E ACEITE) ---
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

    socket.on('driver_accept_price', async (data) => {
        // Alias para aceitar vindo da lista de corridas
        const { ride_id, driver_id, final_price } = data;
        try {
            await pool.query(
                `UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted' WHERE id = $3`,
                [driver_id, final_price, ride_id]
            );
            const fullData = await getFullRideDetails(ride_id);
            io.to(`ride_${ride_id}`).emit('ride_accepted_by_driver', fullData);
            io.to(`user_${fullData.passenger_id}`).emit('ride_accepted_by_driver', fullData);
        } catch (e) { console.error(e); }
    });

    /**
     * --- ATUALIZAR PREÇO NO CHAT ---
     */
    socket.on('update_price_negotiation', async (data) => {
        const { ride_id, new_price } = data;
        try {
            await pool.query("UPDATE rides SET final_price = $1 WHERE id = $2", [new_price, ride_id]);
            // Avisa todos na sala que o preço mudou (BROADCAST PARA A SALA TODA)
            io.to(`ride_${ride_id}`).emit('price_updated', { new_price });
        } catch (e) { console.error(e); }
    });

    /**
     * --- ACEITAR CORRIDA (MATCH) ---
     */
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;
        console.log(`✅ Corrida ${ride_id} Aceita pelo Motorista ${driver_id}`);

        try {
            // Atualiza corrida
            await pool.query(
                `UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted' WHERE id = $3`,
                [driver_id, final_price, ride_id]
            );

            // Busca dados COMPLETOS para exibir na tela de chat
            const fullData = await getFullRideDetails(ride_id);

            // Notifica todos na sala da corrida (io.to para garantir que todos recebam)
            io.to(`ride_${ride_id}`).emit('ride_accepted_by_driver', fullData);
            
            // Redundância para garantir que passageiro receba
            io.to(`user_${fullData.passenger_id}`).emit('ride_accepted_by_driver', fullData);

        } catch (e) { console.error("Erro ao aceitar corrida:", e); }
    });

    /**
     * --- MENSAGENS (CHAT) ---
     */
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, file_data } = data;
        try {
            const res = await pool.query(
                "INSERT INTO chat_messages (ride_id, sender_id, text, created_at) VALUES ($1,$2,$3, NOW()) RETURNING *",
                [ride_id, sender_id, text || (file_data ? "📎 Foto" : ".")]
            );
            
            const msgPayload = { ...res.rows[0], file_data };

            // Broadcast para a sala TODA (incluindo o remetente)
            io.to(`ride_${ride_id}`).emit('receive_message', msgPayload);
        } catch (e) { console.error(e); }
    });

    /**
     * --- INÍCIO DA VIAGEM (MUDANÇA DE TELA GLOBAL) ---
     */
    socket.on('start_trip', async (data) => {
        const { ride_id } = data;

        try {
            // Atualiza status no banco
            await pool.query("UPDATE rides SET status = 'ongoing' WHERE id = $1", [ride_id]);

            // Busca dados atualizados
            const fullData = await getFullRideDetails(ride_id);
            fullData.status = 'ongoing'; // Garante status

            console.log(`🚀 Viagem ${ride_id} INICIADA. Mudando telas.`);

            // CRÍTICO: io.to envia para TODOS os sockets na sala, incluindo o Motorista que clicou.
            io.to(`ride_${ride_id}`).emit('trip_started_now', {
                ride_id,
                status: 'ongoing',
                full_details: fullData, // Payload crucial para a navegação do Flutter
                start_time: new Date()
            });

        } catch (e) {
            console.error("Erro start_trip:", e);
        }
    });

    /**
     * --- TRACKING EM TEMPO REAL (VIAGEM) ---
     */
    socket.on('update_trip_gps', (data) => {
        // O motorista envia { ride_id, lat, lng, rotation }
        // O servidor repassa imediatamente para o passageiro na sala
        const { ride_id, lat, lng, rotation } = data;
        socket.to(`ride_${ride_id}`).emit('driver_location_update', { lat, lng, rotation });
    });

    // ATUALIZAÇÃO GERAL DE POSIÇÃO (Para o mapa inicial - motoristas idle)
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
        } catch (e) { /* Erro silencioso GPS */ }
    });

    /**
     * --- CANCELAMENTO / TÉRMINO ---
     */
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role, user_id } = data;
        try {
            await pool.query("UPDATE rides SET status = 'cancelled' WHERE id = $1", [ride_id]);

            // Emite para TODOS na sala
            io.to(`ride_${ride_id}`).emit('ride_terminated', {
                reason: role === 'driver' ? 'O motorista cancelou.' : 'O passageiro cancelou.',
                canReSearch: role === 'driver'
            });

            // Compatibilidade com lógica antiga de alerta
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

// GET RIDE DETAILS (Endpoint REST auxiliar)
app.get('/api/rides/details/:id', async (req, res) => {
    try {
        const data = await getFullRideDetails(req.params.id);
        if (!data) return res.status(404).json({error: "Corrida não encontrada"});
        res.json(data);
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

// COMPLETAR CORRIDA + BÓNUS (TRANSACTION SAFE)
app.post('/api/rides/complete', async (req, res) => {
    const { ride_id, user_id, amount } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Atualiza Status
        await client.query("UPDATE rides SET status = 'completed' WHERE id = $1", [ride_id]);

        // 2. Calcula Bônus/Earnings (5% de Bônus neste modelo, ou ajuste para comissão)
        // Se 'amount' for o valor total da corrida, vamos dar um pequeno cashback ou registrar o lucro do motorista.
        // Assumindo lógica de bônus por gamificação:
        const bonus = (parseFloat(amount) * 0.05).toFixed(2);

        // 3. Atualiza Saldo
        await client.query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [bonus, user_id]
        );

        // 4. Registra Transação
        await client.query(
            "INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, 'earnings', 'Corrida Finalizada', $3)",
            [bonus, user_id, ride_id]
        );

        await client.query('COMMIT');
        console.log(`✅ Corrida ${ride_id} finalizada com sucesso.`);
        res.json({ success: true, bonus_earned: bonus });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Erro ao finalizar:", e);
        res.status(500).json({ error: "Falha interna ao processar pagamento." });
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
       📍 RAIO FILTRO: 20.0 KM (Expandido)
       🗄️ DB: NEON POSTGRESQL (SSL MODE)
       ⚡ SOCKET: ATIVO E PRONTO (Broadcast Fix)
    ===================================================
    `);
});
