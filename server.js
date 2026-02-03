/**
 * AOTRAVEL SERVER PRO - VERSÃO FINAL (FULL MERGED 2026)
 * Localização: backend/server.js
 * Descrição: Backend Completo com API REST, WebSocket Inteligente (Raio 3km),
 * Suporte a Upload de BI/Fotos (100MB), DB Migrations Robustas, Chat e CORS Total.
 */

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require("socket.io");

// --- INICIALIZAÇÃO DO APP ---
const app = express();
const port = 3000;

// --- CONFIGURAÇÕES DE MIDDLEWARE (ATUALIZADO & REDUNDANTE PARA SEGURANÇA) ---
// Configuração de Limites: Definido em 100mb para garantir upload de fotos HD e BI em Base64
// Aplica-se tanto ao bodyParser quanto ao express.json nativo para garantir compatibilidade total.
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// CORS TOTAL: Configuração aplicada para evitar bloqueios no Android/Web e permitir acesso global
app.use(cors({ origin: '*', methods: '*' }));

// Servidor HTTP e Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    }
});

// Conexão PostgreSQL (NeonDB) - String de conexão segura
const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_B62pAUiGbJrF@ep-jolly-art-ahef2z0t-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
});

/**
 * =========================================================================
 * HELPERS (UTILITÁRIOS)
 * =========================================================================
 */

// Fórmula de Haversine: Calcula distância exata em KM entre duas coordenadas (Latitude/Longitude)
// Essencial para o filtro de raio de 3km na busca de motoristas.
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
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
 * DATABASE BOOTSTRAP (MIGRAÇÃO AUTOMÁTICA COMPLETA)
 * Garante que todas as tabelas (Users, Rides, Chat, Wallet, DriverPositions) existam.
 * Executa verificações de colunas (BI, Fotos) para evitar erros de migração.
 * =========================================================================
 */
async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("--- 🚀 INICIANDO SETUP DO BANCO DE DADOS AOTRAVEL (FULL) ---");

        // 1. TABELA DE USUÁRIOS (Com suporte a BI, Fotos e Role)
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
                bonus_points INTEGER DEFAULT 0,
                vehicle_details JSONB,
                is_online BOOLEAN DEFAULT false,
                bi_front TEXT,
                bi_back TEXT,
                rating NUMERIC(3,2) DEFAULT 5.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Garante colunas de BI e Foto (Mesmo se a tabela já existir de versões anteriores)
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_front TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bi_back TEXT;`);
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;`);

        // 2. TABELA DE VIAGENS (RIDES)
        await client.query(`CREATE TABLE IF NOT EXISTS rides (id SERIAL PRIMARY KEY);`);

        // Lista de colunas essenciais para viagens, histórico e negociação
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
            "distance_km NUMERIC(10,2)",
            "negotiation_chat JSONB DEFAULT '[]'",
            "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        ];

        for (let colDef of rideColumns) {
            // Extrai apenas o nome da coluna para verificação
            const colName = colDef.split(' ')[0];
            // Adiciona a coluna se não existir
            await client.query(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS ${colDef}`);
        }

        // 3. TABELA DE CHAT (Necessária para o Socket funcionar sem erros e persistir mensagens)
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                text TEXT NOT NULL,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. TABELA DE TRANSAÇÕES (CARTEIRA) (Necessária para o login retornar histórico financeiro)
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

        // 5. TABELA DE POSIÇÃO DOS MOTORISTAS (Real-time GPS)
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
        console.log("✅ BANCO DE DADOS SINCRONIZADO COM SUCESSO (FULL MERGED).");
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ ERRO CRÍTICO NO SETUP DO DB:", err);
    } finally {
        client.release();
    }
}

// Executa a migração ao iniciar o servidor
bootstrapDatabase();

/**
 * =========================================================================
 * WEBSOCKET (SOCKET.IO) - LÓGICA DE NEGÓCIO REAL-TIME
 * =========================================================================
 */
io.on('connection', (socket) => {
    console.log(`🔌 Novo Cliente Conectado via Socket: ${socket.id}`);

    // --- AUTENTICAÇÃO E SALAS ---
    socket.on('join_user', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`👤 Usuário ID ${userId} entrou na sala user_${userId}`);
    });

    socket.on('join_ride', (rideId) => {
        socket.join(`ride_${rideId}`);
        console.log(`🚗 Cliente entrou na sala da corrida: ride_${rideId}`);
    });

    // --- 1. SOLICITAÇÃO DE CORRIDA (Com Filtro de Raio 3km) ---
    socket.on('request_ride', async (data) => {
        console.log("📝 Pedido de Corrida Recebido:", data);

        try {
            // Extração de dados (Compatível com formato padrão e simplificado)
            const { passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type } = data;

            // Tratamento caso venha simplificado como 'lat/lng' ou 'origin_lat'
            const pLat = origin_lat || data.lat;
            const pLng = origin_lng || data.lng;

            // A) Salva a solicitação no Banco de Dados (Status: searching)
            const res = await pool.query(
                `INSERT INTO rides (
                    passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                    origin_name, dest_name, initial_price, ride_type, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'searching') RETURNING *`,
                [passenger_id, pLat, pLng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type || 'standard']
            );
            const ride = res.rows[0];

            // B) Busca todos os motoristas ativos
            const driversResult = await pool.query(`SELECT * FROM driver_positions`);
            const allDrivers = driversResult.rows;

            // C) Filtro de Proximidade: Raio de 3.0 KM usando Haversine
            const nearbyDrivers = allDrivers.filter(driver => {
                const dist = getDistance(pLat, pLng, driver.lat, driver.lng);
                return dist <= 3.0;
            });

            // D) Notificações e Gestão de Sala
            socket.join(`ride_${ride.id}`);

            // Confirmação para o passageiro que a corrida foi criada
            io.to(`user_${passenger_id}`).emit('ride_created', ride);

            if (nearbyDrivers.length > 0) {
                console.log(`✅ ${nearbyDrivers.length} motoristas encontrados no raio de 3km.`);

                // Notifica o passageiro
                io.to(`user_${passenger_id}`).emit('drivers_found', {
                    count: nearbyDrivers.length,
                    message: "Motoristas notificados próximos a você!"
                });

                // Envia a oferta APENAS para os motoristas dentro do raio
                nearbyDrivers.forEach(driver => {
                    io.to(`user_${driver.driver_id}`).emit('ride_opportunity', ride);
                });
            } else {
                console.log("⚠️ Nenhum motorista encontrado no raio de 3km.");
                // Notifica o passageiro sobre a ausência de motoristas
                io.to(`user_${passenger_id}`).emit('no_drivers', {
                    message: "Sem motoristas num raio de 3km. Tente novamente mais tarde."
                });
            }

        } catch (e) {
            console.error("Erro critico em request_ride:", e.message);
            socket.emit('error', { msg: "Falha ao processar solicitação de corrida." });
        }
    });

    // --- 2. NEGOCIAÇÃO DE PREÇO (DRIVER) ---
    socket.on('driver_proposal', async (data) => {
        const { ride_id, driver_id, price } = data;

        // Notifica a sala da corrida (Passageiro vê a contraproposta)
        io.to(`ride_${ride_id}`).emit('price_proposal', { driver_id, price });

        // Salva histórico da negociação no banco (JSONB)
        try {
            await pool.query(
                `UPDATE rides SET negotiation_chat = negotiation_chat || $1::jsonb WHERE id = $2`,
                [JSON.stringify({ driver_id, price, timestamp: new Date() }), ride_id]
            );
        } catch (dbErr) {
            console.error("Erro ao salvar negociação:", dbErr);
        }
    });

    // --- 3. ACEITAR CORRIDA (PASSAGEIRO OU DRIVER) ---
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id, final_price } = data;
        try {
            // Atualiza a corrida com o motorista vencedor e preço final
            await pool.query(
                `UPDATE rides SET driver_id = $1, final_price = $2, status = 'accepted' WHERE id = $3`,
                [driver_id, final_price, ride_id]
            );

            // Busca nome do motorista para feedback visual
            const driverRes = await pool.query('SELECT name FROM users WHERE id = $1', [driver_id]);
            const driverName = driverRes.rows[0]?.name || "Motorista";

            // Notifica todos na sala que a corrida foi aceita
            io.to(`ride_${ride_id}`).emit('ride_accepted_by_driver', {
                ride_id,
                driver_id,
                driver_name: driverName,
                final_price
            });

        } catch (e) {
            console.error("Erro accept_ride:", e);
        }
    });

    // --- 4. CHAT EM TEMPO REAL ---
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text } = data;
        try {
            // Salva mensagem no banco
            const res = await pool.query(
                'INSERT INTO chat_messages (ride_id, sender_id, text) VALUES ($1, $2, $3) RETURNING *',
                [ride_id, sender_id, text]
            );
            // Emite para a sala da corrida específica (Privacidade)
            io.to(`ride_${ride_id}`).emit('receive_message', res.rows[0]);
        } catch (e) {
            console.error("Erro chat:", e);
        }
    });

    // --- 5. RASTREAMENTO GPS (DRIVER) ---
    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading } = data;
        try {
            // Upsert: Atualiza se existe, Insere se não existe
            await pool.query(
                `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (driver_id) DO UPDATE SET lat=$2, lng=$3, heading=$4, last_update=NOW()`,
                [user_id, lat, lng, heading || 0]
            );

            // Broadcast global para mapas ao vivo (Para quem estiver ouvindo 'driver_moved')
            io.emit('driver_moved', { driver_id: user_id, lat, lng, heading });
        } catch (e) {
            console.error("Erro GPS:", e);
        }
    });

    socket.on('disconnect', () => {
        console.log(`🔌 Cliente Desconectado: ${socket.id}`);
    });
});

/**
 * =========================================================================
 * API RESTFUL (ROTAS HTTP)
 * =========================================================================
 */

// 0. ROTA DE PING (Health Check)
app.get('/api/ping', (req, res) => res.send('pong'));

// 1. ROTA DE LOGIN
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "E-mail ou senha incorretos." });
        }

        const user = result.rows[0];

        // Busca últimas transações para exibir saldo corretamente no app
        const tx = await pool.query(
            'SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
            [user.id]
        );
        user.transactions = tx.rows;

        res.json(user);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. ROTA DE REGISTO (SIGNUP) - Suporte Completo a BI e Fotos
app.post('/api/auth/signup', async (req, res) => {
    // Campos completos + BI + Foto (Recebidos como string Base64 ou URL)
    const { name, email, phone, password, role, vehicle_type, photo, bi_front, bi_back } = req.body;
    try {
        // Verifica duplicidade de email
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (check.rows.length > 0) return res.status(400).json({ error: "E-mail já cadastrado." });

        // Insere novo usuário com suporte a todos os campos (incluindo JSON para veículo)
        const resUser = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, balance, vehicle_details, photo, bi_front, bi_back)
             VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9) RETURNING *`,
            [
                name,
                email,
                phone,
                password,
                role,
                vehicle_type ? JSON.stringify({ type: vehicle_type }) : null,
                photo || null,
                bi_front || null,
                bi_back || null
            ]
        );

        res.status(201).json(resUser.rows[0]);
    } catch (e) {
        console.error("Erro no cadastro:", e);
        res.status(500).json({ error: e.message });
    }
});

// 3. ROTA DE ATUALIZAÇÃO DE PERFIL
app.put('/api/users/profile', async (req, res) => {
    const { id, name, photo, bi_front, bi_back } = req.body;
    try {
        // Atualização dinâmica segura (COALESCE mantém o valor antigo se o novo for null)
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4. ROTA DE HISTÓRICO DE VIAGENS
app.get('/api/history/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM rides WHERE passenger_id = $1 OR driver_id = $1 ORDER BY created_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5. ROTA DE CONCLUSÃO E RECOMPENSAS (WALLET)
app.post('/api/rides/complete', async (req, res) => {
    const { ride_id, user_id, amount } = req.body;
    const bonus = (parseFloat(amount) * 0.05).toFixed(2); // 5% de Cashback Calculado

    try {
        await pool.query('BEGIN');

        // Atualiza status da corrida
        await pool.query("UPDATE rides SET status = 'completed' WHERE id = $1", [ride_id]);

        // Atualiza saldo e pontos do usuário (Driver ou Passageiro conforme lógica de app)
        await pool.query(
            'UPDATE users SET balance = balance + $1, bonus_points = bonus_points + 10 WHERE id = $2',
            [bonus, user_id]
        );

        // Registra a transação no histórico da carteira
        await pool.query(
            `INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id)
             VALUES ($1, $2, 'bonus_reward', 'Cashback de Corrida AOtravel', $3)`,
            [user_id, bonus, ride_id]
        );

        await pool.query('COMMIT');
        res.json({ success: true, bonus_earned: bonus });
    } catch (e) {
        await pool.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    }
});

/**
 * =========================================================================
 * STARTUP DO SERVIDOR
 * =========================================================================
 */
server.listen(port, '0.0.0.0', () => {
    console.log(`
    ===================================================
       🚀 AOTRAVEL SERVER PRO ONLINE (FULL MERGED 2026)
       -----------------------------------
       📡 PORTA: ${port}
       📍 RAIO DE BUSCA: 3.0 KM (Haversine Ativo)
       🗄️ DB: NEON POSTGRESQL (SSL Conectado)
       🆔 UPLOAD: ATÉ 100MB (Suporte a BI Frente/Verso)
       ⚡ REAL-TIME: ATIVO (Socket.io c/ Salas)
       🌐 CORS: TOTAL (*)
    ===================================================
    `);
});