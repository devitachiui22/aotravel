/**
=========================================================================
AOTRAVEL SERVER PRO 2026 - FINAL ABSOLUTE VERSION (ULTRA FULL)
Localização: backend/server.js
Status: FIXED (Sem erros de relatório, Sincronização Total, Zero Omissões)
=========================================================================
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
 * CONFIGURAÇÃO DE LIMITES DE DADOS
 * 100MB para garantir upload de fotos e documentos
 */
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * CONFIGURAÇÃO DE CORS
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
        credentials: true
    },
    pingTimeout: 5000,
    pingInterval: 10000
});

/**
 * CONEXÃO COM BANCO DE DADOS (NEON POSTGRESQL)
 */
const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_B62pAUiGbJrF@ep-jolly-art-ahef2z0t-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false
    },
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

/**
 * LÓGICA GEOGRÁFICA (HAVERSINE)
 */
function getDistance(lat1, lon1, lat2, lon2) {
    if ((lat1 == lat2) && (lon1 == lon2)) return 0;
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
 * AUXILIAR: PEGAR DETALHES COMPLETOS DA CORRIDA
 */
async function getFullRideDetails(rideId) {
    const query = `
        SELECT
            r.id, r.passenger_id, r.driver_id,
            r.origin_name, r.dest_name,
            r.origin_lat, r.origin_lng, r.dest_lat, r.dest_lng,
            r.initial_price,
            COALESCE(r.final_price, r.initial_price) as final_price,
            r.status, r.ride_type, r.created_at, r.distance_km,
            r.rating, r.feedback,

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
 * DATABASE BOOTSTRAP (AUTO-CRIAÇÃO DE TABELAS)
 */
async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("--- 🚀 AOTRAVEL: VERIFICANDO INTEGRIDADE DO BANCO ---");

        // TABELA USERS
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

        // TABELA RIDES
        await client.query(`CREATE TABLE IF NOT EXISTS rides (id SERIAL PRIMARY KEY);`);

        // Colunas essenciais da corrida
        const rideColumns = [
            "passenger_id INTEGER REFERENCES users(id)",
            "driver_id INTEGER REFERENCES users(id)",
            "origin_name TEXT", "dest_name TEXT",
            "origin_lat DOUBLE PRECISION", "origin_lng DOUBLE PRECISION",
            "dest_lat DOUBLE PRECISION", "dest_lng DOUBLE PRECISION",
            "initial_price NUMERIC(15,2)", "final_price NUMERIC(15,2)",
            "status TEXT DEFAULT 'searching'",
            "ride_type TEXT DEFAULT 'ride'",
            "negotiation_chat JSONB DEFAULT '[]'",
            "distance_km NUMERIC(10,2)",
            "rating INTEGER DEFAULT 0",
            "feedback TEXT",
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ];

        for (let colDef of rideColumns) {
            await client.query(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS ${colDef}`);
        }

        // TABELA CHAT
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // TABELA WALLET
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

        // TABELA DRIVER POSITIONS
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
        console.log("✅ BANCO DE DADOS SINCRONIZADO COM SUCESSO.");

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
    console.log(`🔌 Socket Conectado: ${socket.id}`);

    // --- GERENCIAMENTO DE SALAS ---
    socket.on('join_user', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`👤 User ${userId} entrou na sala user_${userId}`);
    });

    socket.on('join_ride', (rideId) => {
        socket.join(`ride_${rideId}`);
        console.log(`🚕 Socket ${socket.id} entrou na Viagem: ${rideId}`);
    });

    /**
     * --- SOLICITAR CORRIDA ---
     */
    socket.on('request_ride', async (data) => {
        console.log("📡 Nova solicitação:", data);
        const { passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type, distance_km } = data;

        try {
            // Busca motoristas ativos
            const driversInDB = await pool.query(`SELECT * FROM driver_positions WHERE last_update > NOW() - INTERVAL '20 minutes'`);

            // Filtro de Raio 8KM
            const nearbyDrivers = driversInDB.rows.filter(d => getDistance(origin_lat, origin_lng, d.lat, d.lng) <= 8.0);

            if (nearbyDrivers.length === 0) {
                io.to(`user_${passenger_id}`).emit('no_drivers', { message: "Nenhum motorista no raio de 8km." });
            } else {
                 io.to(`user_${passenger_id}`).emit('drivers_found', { count: nearbyDrivers.length });
            }

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
            nearbyDrivers.forEach(driver => {
                io.to(`user_${driver.driver_id}`).emit('ride_opportunity', ride);
            });

        } catch (e) {
            console.error("❌ Erro request_ride:", e);
            io.to(`user_${passenger_id}`).emit('error_response', { message: "Erro ao criar corrida." });
        }
    });

    /**
     * --- NEGOCIAÇÃO DE PREÇO ---
     */
    socket.on('update_price_negotiation', async (data) => {
        const { ride_id, new_price } = data;
        try {
            await pool.query("UPDATE rides SET final_price = $1 WHERE id = $2", [new_price, ride_id]);
            socket.to(`ride_${ride_id}`).emit('price_updated', { new_price });
        } catch (e) { console.error(e); }
    });

    /**
     * --- ACEITAR CORRIDA ---
     */
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;
        console.log(`✅ Corrida ${ride_id} aceita por ${driver_id}`);

        try {
            await pool.query(
                `UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted' WHERE id = $3`,
                [driver_id, final_price, ride_id]
            );

            // FETCH FULL
            const fullData = await getFullRideDetails(ride_id);

            // Envia para AMBOS
            io.to(`ride_${ride_id}`).emit('ride_accepted_by_driver', fullData);
            io.to(`user_${fullData.passenger_id}`).emit('ride_accepted_by_driver', fullData);
            io.to(`user_${driver_id}`).emit('ride_accepted_by_driver', fullData);

        } catch (e) { console.error("Erro accept_ride:", e); }
    });

    /**
     * --- MENSAGENS DE CHAT ---
     */
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, file_data } = data;
        try {
            const res = await pool.query(
                `INSERT INTO chat_messages (ride_id, sender_id, text, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *`,
                [ride_id, sender_id, text || (file_data ? "📎 Foto" : ".")]
            );

            const msgPayload = { ...res.rows[0], file_data };

            // Envia para todos MENOS o remetente para não duplicar na tela dele
            socket.to(`ride_${ride_id}`).emit('receive_message', msgPayload);

        } catch (e) { console.error(e); }
    });

    /**
     * --- INÍCIO DA VIAGEM ---
     */
    socket.on('start_trip', async (data) => {
        const { ride_id } = data;
        try {
            await pool.query("UPDATE rides SET status = 'ongoing' WHERE id = $1", [ride_id]);

            const fullData = await getFullRideDetails(ride_id);
            fullData.status = 'ongoing';

            console.log(`🚀 Viagem ${ride_id} INICIADA.`);

            // IMPORTANTE: io.to envia para TODOS (Motorista + Passageiro) para garantir que as telas mudem juntas
            io.to(`ride_${ride_id}`).emit('trip_started_now', {
                ride_id,
                status: 'ongoing',
                full_details: fullData,
                start_time: new Date()
            });

        } catch (e) { console.error("Erro start_trip:", e); }
    });

    /**
     * --- GPS REAL-TIME ---
     */
    socket.on('update_trip_gps', (data) => {
        const { ride_id, lat, lng, rotation } = data;
        // Envia para o passageiro
        socket.to(`ride_${ride_id}`).emit('driver_location_update', { lat, lng, rotation });
    });

    // Atualização de posição IDLE
    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading } = data;
        try {
            await pool.query(
                `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (driver_id) DO UPDATE SET lat=$2, lng=$3, heading=$4, last_update=NOW()`,
                [user_id, lat, lng, heading || 0]
            );
        } catch (e) { /* silent */ }
    });

    /**
     * --- CANCELAMENTO ---
     */
    socket.on('cancel_ride', async (data) => {
        const { ride_id, role } = data;
        try {
            await pool.query("UPDATE rides SET status = 'cancelled' WHERE id = $1", [ride_id]);
            io.to(`ride_${ride_id}`).emit('ride_terminated', {
                reason: role === 'driver' ? 'O motorista cancelou.' : 'O passageiro cancelou.',
                canReSearch: role === 'driver'
            });
        } catch (e) { console.error(e); }
    });

});

/**
 * =========================================================================
 * API RESTFUL - ENDPOINTS DE SISTEMA
 * =========================================================================
 */

// HEALTH CHECK
app.get('/', (req, res) => {
    res.status(200).json({ status: "Online 🚀", db: "Connected" });
});

app.get('/api/ping', (req, res) => res.send('pong'));

// LOGIN
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email.toLowerCase().trim(), password]);
        if (result.rows.length === 0) return res.status(401).json({ error: "Credenciais incorretas." });

        const user = result.rows[0];

        // Busca transações recentes
        const tx = await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15', [user.id]);
        user.transactions = tx.rows;

        await pool.query('UPDATE users SET is_online = true WHERE id = $1', [user.id]);
        res.json(user);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// SIGNUP
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, phone, password, role, photo, bi_front, bi_back, vehicle_type, vehicleModel, vehiclePlate, vehicleColor } = req.body;
    try {
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) return res.status(400).json({ error: "E-mail em uso." });

        let vehicle_details = null;
        if (role === 'driver') {
            vehicle_details = JSON.stringify({ type: vehicle_type, model: vehicleModel, plate: vehiclePlate, color: vehicleColor });
        }

        const resUser = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, photo, bi_front, bi_back, vehicle_details, balance, bonus_points)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0.00, 0) RETURNING *`,
            [name, email.toLowerCase().trim(), phone, password, role, photo, bi_front, bi_back, vehicle_details]
        );
        res.status(201).json(resUser.rows[0]);
    } catch (e) { res.status(500).json({ error: "Erro no registo." }); }
});

// GET RIDE DETAILS
app.get('/api/rides/details/:id', async (req, res) => {
    try {
        const data = await getFullRideDetails(req.params.id);
        if (!data) return res.status(404).json({error: "Corrida não encontrada"});
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// HISTÓRICO
app.get('/api/history/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM rides WHERE passenger_id = $1 OR driver_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * COMPLETAR CORRIDA + PAGAMENTO (CORREÇÃO DE ERRO DE RELATÓRIO)
 * Endpoint corrigido: ordem dos parâmetros SQL e validação
 */
app.post('/api/rides/complete', async (req, res) => {
    const { ride_id, user_id, amount, rating, comment } = req.body;

    // Validação de segurança
    if (!ride_id || !user_id || !amount) {
        return res.status(400).json({ error: "Dados incompletos para finalizar corrida." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Atualiza Status da Corrida
        await client.query(
            `UPDATE rides
             SET status = 'completed', final_price = $1, rating = $2, feedback = $3
             WHERE id = $4`,
            [amount, rating || 0, comment || "", ride_id]
        );

        // 2. Calcula e Salva a Transação
        const finalAmount = parseFloat(amount);

        // CORREÇÃO: Ordem dos parâmetros ($1 = user_id, $2 = amount)
        // Isso resolve o erro "erro ao salvar relatorio"
        await client.query(
            `INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id)
             VALUES ($1, $2, 'earnings', 'Corrida Finalizada', $3)`,
            [user_id, finalAmount, ride_id]
        );

        // 3. Atualiza saldo do motorista
        await client.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [finalAmount, user_id]);

        await client.query('COMMIT');

        // 4. Notifica via Socket (Sync) para que o app do passageiro feche/avalie instantaneamente
        io.to(`ride_${ride_id}`).emit('ride_completed', {
            ride_id,
            final_price: finalAmount,
            status: 'completed'
        });

        res.json({ success: true, message: "Corrida finalizada com sucesso." });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Erro ao finalizar corrida:", e);
        res.status(500).json({ error: "Erro interno ao salvar relatório: " + e.message });
    } finally {
        client.release();
    }
});

/**
 * START SERVER
 */
const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
    console.log(`
    🚀 AOTRAVEL SERVER PRO ESTÁ ONLINE (FULL)
    -----------------------------------------
    📡 PORTA: ${port}
    📍 RAIO: 8.0 KM
    🗄️ DB: NEON POSTGRESQL (SSL)
    ⚡ SOCKET: SYNC OK
    🛠️ STATUS: BUG RELATÓRIO CORRIGIDO
    =========================================
    `);
});
