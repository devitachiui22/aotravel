/**
 * =========================================================================
 * AOTRAVEL SERVER PRO 2026 - FINAL FULL ROBUST (BACKEND UNIFICADO)
 * Localização: backend/server.js
 * Descrição: Backend Profissional para Transporte e Entregas (Angola).
 * =========================================================================
 * Funcionalidades Integradas:
 *   - WebSocket Real-time com salas e Chat de Negociação
 *   - API RESTful (Express) com suporte a JSON 100MB
 *   - Migração Automática de DB (Neon PostgreSQL)
 *   - Filtro Geográfico Haversine (Raio Fixo de 3.0 KM)
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
 * Usa a porta do ambiente (Render/Heroku) ou 3000 localmente.
 */
const port = process.env.PORT || 3000;

/**
 * CONFIGURAÇÃO DE LIMITES DE DADOS (EXTREMO ROBUSTO)
 * Definido em 100MB para suportar strings Base64 de fotos HD e BIs.
 * Garante que payloads grandes não quebrem o request.
 */
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
// Redundância express.json para garantir compatibilidade
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * CONFIGURAÇÃO DE CORS (PERMISSÃO TOTAL)
 * Garante que Android, iOS e Web comuniquem sem bloqueios de origem cruzada.
 */
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Servidor HTTP com Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    },
    // Configurações de transporte para estabilidade em redes móveis (3G/4G Angola)
    pingTimeout: 60000,
    pingInterval: 25000
});

/**
 * CONEXÃO COM BANCO DE DADOS (NEON POSTGRESQL)
 * Configuração com SSL obrigatório para ambiente de produção (Cloud).
 */
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_B62pAUiGbJrF@ep-jolly-art-ahef2z0t-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
    ssl: {
        rejectUnauthorized: false // Permite certificados auto-assinados (comum em DB as a Service)
    },
    // Configurações de pool para evitar timeout
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

/**
 * =========================================================================
 * LÓGICA GEOGRÁFICA (FÓRMULA DE HAVERSINE)
 * Calcula a distância real em KM entre dois pontos geográficos.
 * Usada para filtrar motoristas no raio de 3km.
 * =========================================================================
 */
function getDistance(lat1, lon1, lat2, lon2) {
    if ((lat1 == lat2) && (lon1 == lon2)) {
        return 0;
    } else {
        const radlat1 = Math.PI * lat1 / 180;
        const radlat2 = Math.PI * lat2 / 180;
        const theta = lon1 - lon2;
        const radtheta = Math.PI * theta / 180;
        let dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
        if (dist > 1) {
            dist = 1;
        }
        dist = Math.acos(dist);
        dist = dist * 180 / Math.PI;
        dist = dist * 60 * 1.1515;
        // Converte Milhas para Quilômetros (1.609344)
        dist = dist * 1.609344;
        return dist;
    }
}
// Alias para compatibilidade com código antigo se necessário
const calculateDistance = getDistance;

/**
 * =========================================================================
 * DATABASE BOOTSTRAP & AUTO-MIGRATION (FULL ROBUST)
 * Cria tabelas e colunas dinamicamente sem apagar dados existentes.
 * Executado na inicialização do servidor.
 * =========================================================================
 */
async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("--- 🚀 INICIANDO SINCRONIZAÇÃO TOTAL DE BANCO DE DADOS ---");

        // 1. TABELA DE USUÁRIOS (Completa com BI e Fotos)
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

        // Sincronização de Colunas (Alter Table Safety - Migração Segura)
        // Adiciona colunas se elas não existirem (evita erro em DBs antigos)
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_front TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_back TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(15,2) DEFAULT 0.00;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_details JSONB;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2) DEFAULT 5.00;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;`); // <-- ADICIONE ESTA LINHA

        // 2. TABELA DE CORRIDAS (Com Suporte a Negociação)
        await client.query(`CREATE TABLE IF NOT EXISTS rides (id SERIAL PRIMARY KEY);`);

        // Definição completa das colunas de corrida
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
            "status TEXT DEFAULT 'searching'", // searching, accepted, started, completed, cancelled
            "ride_type TEXT DEFAULT 'ride'", // ride, delivery, moto
            "negotiation_chat JSONB DEFAULT '[]'", // Histórico de lances
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ];

        // Aplica alterações de schema
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

        // 4. TABELA DE TRANSAÇÕES FINANCEIRAS (CARTEIRA)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount NUMERIC(15,2),
                type TEXT, -- deposit, withdraw, payment, bonus_reward
                description TEXT,
                reference_id INTEGER, -- ride_id ou external_id
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. TABELA DE LOCALIZAÇÃO EM TEMPO REAL (DRIVER GPS)
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
        console.log("✅ BANCO DE DADOS SINCRONIZADO (FULL VERSION).");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ ERRO NO SETUP DO DB:", err);
    } finally {
        client.release();
    }
}
// Executa o bootstrap
bootstrapDatabase();

/**
 * =========================================================================
 * WEBSOCKET (SOCKET.IO) - LÓGICA DE NEGÓCIO REAL-TIME
 * Gerencia Corridas, Chat, Negociação e Rastreamento.
 * =========================================================================
 */
io.on('connection', (socket) => {
    console.log(`🔌 Novo Socket Conectado: ${socket.id}`);

    // JOIN ROOMS: Usuário entra na sua sala privada baseada no ID
    socket.on('join_user', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`👤 Usuário ${userId} entrou na sala user_${userId}`);
    });

    // JOIN ROOMS: Usuário entra na sala de uma corrida específica (Chat/Tracking)
    socket.on('join_ride', (rideId) => socket.join(`ride_${rideId}`));

    /**
     * EVENTO 1: SOLICITAR CORRIDA (Request Ride)
     * Filtro Geográfico: Apenas motoristas no raio de 3.0 KM recebem.
     */
    socket.on('request_ride', async (data) => {
        console.log("📡 Nova solicitação de corrida recebida:", data);

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
            // 1. Buscar posições de TODOS os motoristas ativos (last_update < 5 min)
            // (Para produção massiva, usaria PostGIS, mas Haversine em JS funciona bem para < 5000 drivers)
            const driversInDB = await pool.query(`
                SELECT * FROM driver_positions
                WHERE last_update > NOW() - INTERVAL '5 minutes'
            `);

            // 2. Filtrar motoristas num raio taxativo de 3.0 KM
            const nearbyDrivers = driversInDB.rows.filter(d => {
                const dist = getDistance(origin_lat, origin_lng, d.lat, d.lng);
                return dist <= 3.0; // REGRA DE NEGÓCIO: 3KM
            });

            // 3. Caso não haja motoristas próximos, encerra fluxo e avisa passageiro
            if (nearbyDrivers.length === 0) {
                console.log(`⚠️ Sem motoristas próximos para User ${passenger_id}`);
                return io.to(`user_${passenger_id}`).emit('no_drivers', {
                    message: "Nenhum motorista disponível no raio de 3km. Tente novamente em instantes."
                });
            } else {
                 // Avisa o passageiro que a busca começou (Feedback visual)
                 io.to(`user_${passenger_id}`).emit('drivers_found', { count: nearbyDrivers.length });
            }

            // 4. Criar o registro da Corrida no Banco de Dados
            const res = await pool.query(
                `INSERT INTO rides (
                    passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                    origin_name, dest_name, initial_price, ride_type, status, created_at
                )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'searching', NOW())
                 RETURNING *`,
                [passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type]
            );

            const ride = res.rows[0];

            // 5. Coloca o passageiro na sala específica desta corrida
            socket.join(`ride_${ride.id}`);

            // Confirma criação para o passageiro
            io.to(`user_${passenger_id}`).emit('ride_created', ride);

            // 6. BROADCAST GEOGRÁFICO: Notificar apenas os motoristas qualificados
            console.log(`📢 Notificando ${nearbyDrivers.length} motoristas próximos.`);
            nearbyDrivers.forEach(driver => {
                // Envia a oportunidade individualmente para cada motorista filtrado
                io.to(`user_${driver.driver_id}`).emit('ride_opportunity', ride);
            });

        } catch (e) {
            console.error("❌ Erro fatal no evento request_ride:", e);
            // Notificar o passageiro que houve um erro interno
            io.to(`user_${passenger_id}`).emit('error_response', { message: "Erro ao processar sua solicitação." });
        }
    });

    /**
     * EVENTO 2: NEGOCIAÇÃO (Driver Proposal)
     * Motorista propõe um preço diferente.
     */
    socket.on('driver_proposal', async (data) => {
        const { ride_id, driver_id, price } = data;

        // Notifica todos na sala da corrida (incluindo o passageiro)
        io.to(`ride_${ride_id}`).emit('price_proposal', { driver_id, price });

        // Persistir proposta no histórico JSON
        try {
            await pool.query(
                `UPDATE rides SET negotiation_chat = negotiation_chat || $1::jsonb WHERE id = $2`,
                [JSON.stringify({ driver_id, price, timestamp: new Date(), type: 'proposal' }), ride_id]
            );
        } catch (e) { console.error("Erro ao salvar proposta:", e); }
    });

    /**
     * EVENTO 3: ACEITAR CORRIDA (Accept Ride)
     * Passageiro aceita um motorista, OU motorista aceita preço inicial.
     */
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;
        console.log(`✅ Corrida ${ride_id} Aceita pelo Motorista ${driver_id}`);

        try {
            // Atualiza status e vincula motorista
            const res = await pool.query(
                `UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted' WHERE id = $3 RETURNING *`,
                [driver_id, final_price, ride_id]
            );

            // Busca dados do motorista para mostrar ao passageiro
            const driverData = await pool.query(`SELECT name, photo, rating, vehicle_details FROM users WHERE id = $1`, [driver_id]);

            // Emite evento final de aceitação
            const acceptPayload = {
                ...res.rows[0],
                driver_name: driverData.rows[0].name,
                driver_photo: driverData.rows[0].photo,
                driver_rating: driverData.rows[0].rating,
                vehicle: driverData.rows[0].vehicle_details
            };

            // Notifica passageiro (que está na sala ride_ID ou user_ID)
            io.to(`ride_${ride_id}`).emit('ride_accepted_by_driver', acceptPayload);
            io.to(`user_${res.rows[0].passenger_id}`).emit('ride_accepted_by_driver', acceptPayload);

        } catch (e) { console.error("Erro ao aceitar corrida:", e); }
    });

    /**
     * EVENTO 4: CHAT DE MENSAGENS
     */
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text } = data;
        try {
            const res = await pool.query(
                'INSERT INTO chat_messages (ride_id, sender_id, text) VALUES ($1, $2, $3) RETURNING *',
                [ride_id, sender_id, text]
            );
            // Broadcast para a sala da corrida
            io.to(`ride_${ride_id}`).emit('receive_message', res.rows[0]);
        } catch (e) { console.error(e); }
    });

    /**
     * EVENTO 5: GPS TRACKING (DRIVER MOVED)
     * Atualiza a posição do motorista em tempo real.
     */
    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading } = data;
        try {
            // UPSERT: Atualiza se existir, Insere se não
            await pool.query(
                `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (driver_id) DO UPDATE SET lat=$2, lng=$3, heading=$4, last_update=NOW()`,
                [user_id, lat, lng, heading || 0]
            );

            // Emite para todos (para mostrar carrinhos no mapa geral)
            // Otimização: Poderia emitir apenas para salas relevantes, mas para MVP emitimos global ou por raio
            io.emit('driver_moved', { driver_id: user_id, lat, lng, heading });

        } catch (e) { /* Erros de GPS são ignorados para não poluir log */ }
    });

    /**
     * EVENTO 6: INICIAR VIAGEM (Start Ride)
     */
    socket.on('start_ride', async (data) => {
        const { ride_id } = data;
        await pool.query("UPDATE rides SET status = 'started' WHERE id = $1", [ride_id]);
        io.to(`ride_${ride_id}`).emit('ride_started', { ride_id, status: 'started', time: new Date() });
    });
});

/**
 * =========================================================================
 * API RESTFUL - ENDPOINTS DE SISTEMA
 * Rotas HTTP tradicionais para Auth, Profile, History, etc.
 * =========================================================================
 */

// ✅ ROTA ROOT (HEALTH CHECK CRÍTICO PARA RENDER)
app.get('/', (req, res) => {
    res.status(200).json({
        app: "AOtravel API",
        status: "Online 🚀",
        version: "4.5.0 Full Robust",
        server_time: new Date(),
        db_connection: "Secure (SSL)",
        limits: "100MB Body Size"
    });
});

// Endpoint leve para keep-alive
app.get('/api/ping', (req, res) => res.send('pong'));

// ✅ LOGIN (COM EXTRATO RECENTE)
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        // Validação simples (em produção usar bcrypt)
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email.toLowerCase().trim(), password]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Credenciais incorretas ou conta inexistente." });
        }

        const user = result.rows[0];

        // Busca últimas 15 transações da carteira
        const tx = await pool.query('SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15', [user.id]);
        user.transactions = tx.rows;

        // Atualiza status online
        await pool.query('UPDATE users SET is_online = true WHERE id = $1', [user.id]);

        res.json(user);
    } catch (e) {
        console.error("Login Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// ✅ SIGNUP (FULL: FOTOS, BI, VEÍCULO)
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, phone, password, role, photo, bi_front, bi_back, vehicle_type, vehicleModel, vehiclePlate, vehicleColor } = req.body;

    try {
        // Verificação de unicidade
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) return res.status(400).json({ error: "Este E-mail já está registado." });

        // Montagem do JSON de detalhes do veículo
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

        console.log(`👤 Novo Usuário Criado: ${name} (${role})`);
        res.status(201).json(resUser.rows[0]);

    } catch (e) {
        console.error("Erro Signup:", e);
        res.status(500).json({ error: "Erro interno ao criar conta. Verifique os dados." });
    }
});

// ✅ UPDATE PROFILE (PUT)
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

// ✅ HISTORY (OBTÉM HISTÓRICO DE CORRIDAS)
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

// ✅ COMPLETAR CORRIDA + BÓNUS (TRANSAÇÃO ATÔMICA FINANCEIRA)
// Executa múltiplas queries numa única transação segura.
app.post('/api/rides/complete', async (req, res) => {
    const { ride_id, user_id, amount } = req.body;

    // Regra de Negócio: Bónus de 5% sobre o valor da corrida
    const bonusValue = (parseFloat(amount) * 0.05).toFixed(2);

    const client = await pool.connect(); // Cliente dedicado para transação
    try {
        await client.query('BEGIN'); // Inicia Transação

        // 1. Finalizar Status da Corrida
        await client.query("UPDATE rides SET status = 'completed' WHERE id = $1", [ride_id]);

        // 2. Creditar Saldo e Pontos na conta do usuário (Cashback)
        await client.query(
            "UPDATE users SET balance = balance + $1, bonus_points = bonus_points + 10 WHERE id = $2",
            [bonusValue, user_id]
        );

        // 3. Registar no Extrato (Histórico Financeiro)
        await client.query(
            "INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, 'bonus_reward', 'Prémio Cashback AOtravel', $3)",
            [user_id, bonusValue, ride_id]
        );

        await client.query('COMMIT'); // Confirma Transação

        console.log(`💰 Corrida ${ride_id} finalizada. Bónus de ${bonusValue} para User ${user_id}`);
        res.json({ success: true, bonus_earned: bonusValue });

    } catch (e) {
        await client.query('ROLLBACK'); // Reverte tudo em caso de erro
        console.error("Erro Transaction:", e);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

/**
 * =========================================================================
 * START SERVER
 * Inicia o servidor na porta especificada.
 * =========================================================================
 */
server.listen(port, '0.0.0.0', () => {
    console.log(`
    ===================================================
       🚀 AOTRAVEL SERVER PRO ESTÁ ONLINE (FULL 2026)
       -----------------------------------
       📡 PORTA: ${port}
       📍 RAIO FILTRO: 3.0 KM
       🗄️ DB: NEON POSTGRESQL (SSL MODE)
       ⚡ SOCKET: ATIVO E PRONTO
       📝 BODY LIMIT: 100MB
       📦 CORS: PERMISSIVO (*)
    ===================================================
    `);
});

