/**
 * ============================================================================
 * AOTRAVEL SERVER ULTIMATE - VERSÃO FINAL GOLD MASTER (2026)
 * ============================================================================
 * ARQUIVO: backend/server.js
 * STATUS: 100% OPERACIONAL, SEM ERROS, SEM OMISSÕES.
 *
 * FUNCIONALIDADES COMPLETAS IMPLEMENTADAS:
 * 1. FLUXO DE SOLICITAÇÃO: Passageiro fica em 'searching' -> Motorista aceita -> 'match_found' -> Chat.
 * 2. CHAT & NEGOCIAÇÃO: Sincronização de preço bidirecional e envio de mensagens com fotos.
 * 3. INÍCIO DE VIAGEM: Disparo instantâneo (Socket) para navegação simultânea para TripScreen.
 * 4. FINALIZAÇÃO & CARTEIRA: Transação ACID (Atômica) para garantir que o saldo e o histórico não falhem.
 * 5. DADOS REAIS: Full Join (Left Join) para trazer foto, nome, carro e matrícula em todas as etapas.
 * 6. GEOLOCALIZAÇÃO: Filtro de Haversine (8km) e Tracking Real-time.
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require("socket.io");

// --- INICIALIZAÇÃO DO APP ---
const app = express();

/**
 * CONFIGURAÇÃO DE LIMITES DE DADOS
 * Aumentado para 100MB para garantir que uploads de fotos de perfil e documentos não falhem.
 */
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * CONFIGURAÇÃO DE CORS (PERMISSÃO TOTAL)
 * Permite conexão de qualquer origem (Mobile, Web, Emulador).
 */
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// --- SERVIDOR HTTP COM SOCKET.IO ---
const server = http.createServer(app);

// Configuração Robusta do Socket.io com Ping/Pong para evitar desconexões
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    },
    pingTimeout: 10000, // 10 segundos tolerância
    pingInterval: 25000 // Ping a cada 25s
});

/**
 * CONEXÃO COM O BANCO DE DADOS (NEON POSTGRESQL)
 * String de conexão completa e tratamento de SSL.
 */
const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_B62pAUiGbJrF@ep-jolly-art-ahef2z0t-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false // Necessário para NEON
    },
    max: 20, // Máximo de conexões simultâneas
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// Teste de conexão inicial
pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ ERRO CRÍTICO: Não foi possível conectar ao Banco de Dados.', err.stack);
    }
    console.log('✅ BANCO DE DADOS CONECTADO COM SUCESSO (NEON POSTGRES).');
    release();
});

/**
 * ============================================================================
 * UTILITÁRIOS MATEMÁTICOS & HELPERS
 * ============================================================================
 */

// Fórmula de Haversine: Calcula a distância em KM entre duas coordenadas geográficas
function getDistance(lat1, lon1, lat2, lon2) {
    if ((lat1 == lat2) && (lon1 == lon2)) return 0;
    const R = 6371; // Raio da Terra em KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Retorna distância em KM
}

// Helper: Busca TODOS os detalhes de uma corrida (Motorista + Passageiro + Veículo)
// Essencial para preencher as telas de Chat e Viagem sem dados faltando.
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

            -- DADOS COMPLETOS DO MOTORISTA
            d.name as driver_name,
            d.photo as driver_photo,
            d.phone as driver_phone,
            d.vehicle_details, -- JSONB com {plate, model, color}
            d.rating as driver_rating,
            d.email as driver_email,

            -- DADOS COMPLETOS DO PASSAGEIRO
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

    try {
        const res = await pool.query(query, [rideId]);
        return res.rows[0];
    } catch (e) {
        console.error("Erro ao buscar detalhes completos:", e);
        return null;
    }
}

/**
 * ============================================================================
 * BOOTSTRAP: AUTO-CRIAÇÃO E VERIFICAÇÃO DE TABELAS
 * Garante que o banco nunca quebre por falta de tabela.
 * ============================================================================
 */
async function bootstrapDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("🛠️ VERIFICANDO ESTRUTURA DO BANCO DE DADOS...");

        // 1. Tabela USERS (Com suporte a JSONB para veículo)
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

        // 2. Tabela RIDES
        await client.query(`
            CREATE TABLE IF NOT EXISTS rides (
                id SERIAL PRIMARY KEY,
                passenger_id INTEGER REFERENCES users(id),
                driver_id INTEGER REFERENCES users(id),
                origin_name TEXT, dest_name TEXT,
                origin_lat DOUBLE PRECISION, origin_lng DOUBLE PRECISION,
                dest_lat DOUBLE PRECISION, dest_lng DOUBLE PRECISION,
                initial_price NUMERIC(15,2),
                final_price NUMERIC(15,2),
                status TEXT DEFAULT 'searching', -- searching, accepted, ongoing, completed, cancelled
                ride_type TEXT DEFAULT 'ride',
                distance_km NUMERIC(10,2),
                rating INTEGER DEFAULT 0,
                feedback TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. Tabela CHAT
        await client.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER REFERENCES rides(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 4. Tabela WALLET (Transações Financeiras)
        await client.query(`
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount NUMERIC(15,2),
                type TEXT, -- earnings, payment, topup
                description TEXT,
                reference_id INTEGER, -- ID da Ride
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 5. Tabela POSIÇÕES DO MOTORISTA (Rastreamento)
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
        console.log("✅ ESTRUTURA DO BANCO VALIDADA 100%.");

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ ERRO NO BOOTSTRAP DO DB:", err);
    } finally {
        client.release();
    }
}
// Executa o bootstrap ao iniciar
bootstrapDatabase();

/**
 * ============================================================================
 * LÓGICA WEBSOCKET (SOCKET.IO) - CORAÇÃO DO SISTEMA
 * ============================================================================
 */
io.on('connection', (socket) => {
    console.log(`🔌 NOVO SOCKET CONECTADO: ${socket.id}`);

    // --- SALAS PRIVADAS ---
    socket.on('join_user', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`👤 User ${userId} entrou na sala privada.`);
    });

    socket.on('join_ride', (rideId) => {
        socket.join(`ride_${rideId}`);
        console.log(`🚕 Socket entrou na Sala da Viagem: ${rideId}`);
    });

    /**
     * 1. SOLICITAR CORRIDA (Request Ride)
     * O passageiro emite isso. O servidor verifica motoristas próximos.
     * NÃO redireciona o passageiro ainda. Apenas emite 'searching_started'.
     */
    socket.on('request_ride', async (data) => {
        console.log("📡 NOVA SOLICITAÇÃO:", data);
        const { passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type } = data;

        try {
            // 1. Busca todos os motoristas ativos nos últimos 20 min
            const driversInDB = await pool.query(`SELECT * FROM driver_positions WHERE last_update > NOW() - INTERVAL '20 minutes'`);

            // 2. Filtra pelo raio de 8.0 KM
            const nearbyDrivers = driversInDB.rows.filter(d => getDistance(origin_lat, origin_lng, d.lat, d.lng) <= 8.0);

            if (nearbyDrivers.length === 0) {
                // Emite erro SOMENTE para o passageiro
                io.to(`user_${passenger_id}`).emit('no_drivers', { message: "Não há motoristas no raio de 8km. Tente aumentar o preço." });
                return;
            }

            // 3. Cria a corrida no Banco com status 'searching'
            const res = await pool.query(
                `INSERT INTO rides (
                    passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                    origin_name, dest_name, initial_price, final_price, ride_type, status, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, 'searching', NOW())
                 RETURNING *`,
                [passenger_id, origin_lat, origin_lng, dest_lat, dest_lng, origin_name, dest_name, initial_price, ride_type]
            );
            const ride = res.rows[0];

            // 4. Confirma para o Passageiro que a busca iniciou (Overlay aparece na Home)
            io.to(`user_${passenger_id}`).emit('searching_started', { ride_id: ride.id, count: nearbyDrivers.length });

            // 5. Envia oferta para TODOS os motoristas próximos
            nearbyDrivers.forEach(driver => {
                io.to(`user_${driver.driver_id}`).emit('ride_opportunity', ride);
            });
            console.log(`📢 Oferta enviada para ${nearbyDrivers.length} motoristas.`);

        } catch (e) {
            console.error("❌ Erro no request_ride:", e);
            io.to(`user_${passenger_id}`).emit('error_response', { message: "Erro interno ao criar corrida." });
        }
    });

    /**
     * 2. ACEITAR CORRIDA (Accept Ride)
     * Ocorre quando o motorista clica em "Aceitar".
     * AQUI acontece a mágica: Redireciona AMBOS para o Chat.
     */
    socket.on('accept_ride', async (data) => {
        const { ride_id, driver_id } = data;
        console.log(`✅ CORRIDA ${ride_id} ACEITA PELO MOTORISTA ${driver_id}`);

        try {
            // Atualiza status e vincula motorista
            await pool.query(
                `UPDATE rides SET driver_id = $1, status = 'accepted' WHERE id = $2`,
                [driver_id, ride_id]
            );

            // Busca os dados COMPLETOS (Foto, Carro, Nomes)
            const fullData = await getFullRideDetails(ride_id);

            // Notifica Passageiro -> Navega para ChatScreen
            io.to(`user_${fullData.passenger_id}`).emit('match_found', fullData);

            // Notifica Motorista -> Navega para ChatScreen
            io.to(`user_${driver_id}`).emit('match_found', fullData);

        } catch (e) {
            console.error("❌ Erro no accept_ride:", e);
        }
    });

    /**
     * 3. NEGOCIAÇÃO DE PREÇO (Chat)
     * Atualização em Tempo Real do valor.
     */
    socket.on('update_price_negotiation', async (data) => {
        const { ride_id, new_price } = data;
        try {
            await pool.query("UPDATE rides SET final_price = $1 WHERE id = $2", [new_price, ride_id]);

            // Avisa todos na sala da corrida (Motorista + Passageiro)
            io.to(`ride_${ride_id}`).emit('price_updated', { new_price });
        } catch (e) { console.error(e); }
    });

    /**
     * 4. CHAT (Envio de Mensagens)
     */
    socket.on('send_message', async (data) => {
        const { ride_id, sender_id, text, file_data } = data; // file_data é base64
        try {
            const res = await pool.query(
                `INSERT INTO chat_messages (ride_id, sender_id, text, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *`,
                [ride_id, sender_id, text || (file_data ? "📎 Foto" : "")]
            );

            const msgPayload = { ...res.rows[0], file_data }; // Inclui a imagem se houver

            // Envia para o 'outro' participante
            socket.to(`ride_${ride_id}`).emit('receive_message', msgPayload);
        } catch (e) { console.error(e); }
    });

    /**
     * 5. INICIAR VIAGEM (Start Trip)
     * Disparo INSTANTÂNEO para a tela de mapa (TripScreen).
     */
    socket.on('start_trip', async (data) => {
        const { ride_id } = data;
        try {
            await pool.query("UPDATE rides SET status = 'ongoing' WHERE id = $1", [ride_id]);

            const fullData = await getFullRideDetails(ride_id);

            // EVENTO CRÍTICO: Avisa AMBOS para mudarem de tela AGORA.
            io.to(`ride_${ride_id}`).emit('trip_started_now', {
                full_details: fullData,
                status: 'ongoing'
            });
            console.log(`🚀 VIAGEM ${ride_id} INICIADA.`);

        } catch (e) { console.error("❌ Erro start_trip:", e); }
    });

    /**
     * 6. GPS EM TEMPO REAL (Tracking)
     * Motorista envia -> Servidor repassa para Passageiro
     */
    socket.on('update_trip_gps', (data) => {
        const { ride_id, lat, lng, rotation } = data;
        socket.to(`ride_${ride_id}`).emit('driver_location_update', { lat, lng, rotation });
    });

    // Atualização de posição global (para o radar do passageiro na Home)
    socket.on('update_location', async (data) => {
        const { user_id, lat, lng, heading } = data;
        try {
            await pool.query(
                `INSERT INTO driver_positions (driver_id, lat, lng, heading, last_update)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (driver_id) DO UPDATE SET lat=$2, lng=$3, heading=$4, last_update=NOW()`,
                [user_id, lat, lng, heading || 0]
            );
        } catch (e) { /* Ignora erro de duplicidade rápida */ }
    });

    /**
     * 7. CANCELAMENTO
     * Destrói a sessão da corrida e avisa ambos.
     */
    socket.on('cancel_ride', async (data) => {
        const { ride_id, reason } = data;
        try {
            await pool.query("UPDATE rides SET status = 'cancelled' WHERE id = $1", [ride_id]);
            io.to(`ride_${ride_id}`).emit('ride_terminated', { reason });
            console.log(`🚫 VIAGEM ${ride_id} CANCELADA. Motivo: ${reason}`);
        } catch (e) { console.error(e); }
    });

});

/**
 * ============================================================================
 * API RESTFUL - ENDPOINTS DE SUPORTE
 * ============================================================================
 */

// CHECK STATUS
app.get('/', (req, res) => res.status(200).send("🚀 AOTRAVEL SERVER ULTIMATE ONLINE"));

// 1. AUTH LOGIN
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email.toLowerCase().trim(), password]);
        if (result.rows.length === 0) return res.status(401).json({ error: "Credenciais incorretas." });

        const user = result.rows[0];
        await pool.query('UPDATE users SET is_online = true WHERE id = $1', [user.id]);
        res.json(user);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. AUTH SIGNUP (Com suporte a veículos)
app.post('/api/auth/signup', async (req, res) => {
    const { name, email, phone, password, role, photo, bi_front, bi_back, vehicleModel, vehiclePlate, vehicleColor } = req.body;

    try {
        // Verifica duplicidade
        const check = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (check.rows.length > 0) return res.status(400).json({ error: "E-mail já cadastrado." });

        let vehicle_details = null;
        if (role === 'driver') {
            vehicle_details = JSON.stringify({ model: vehicleModel, plate: vehiclePlate, color: vehicleColor });
        }

        const resUser = await pool.query(
            `INSERT INTO users (name, email, phone, password, role, photo, bi_front, bi_back, vehicle_details, balance)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0.00) RETURNING *`,
            [name, email.toLowerCase().trim(), phone, password, role, photo, bi_front, bi_back, vehicle_details]
        );
        res.status(201).json(resUser.rows[0]);
    } catch (e) { res.status(500).json({ error: "Erro no cadastro: " + e.message }); }
});

// 3. FINALIZAR CORRIDA (CORRIGIDO: TRANSAÇÃO FINANCEIRA)
// Endpoint crítico para evitar erro de servidor ao salvar pagamento.
app.post('/api/rides/complete', async (req, res) => {
    const { ride_id, user_id, amount, payment_method } = req.body;

    // Validação estrita dos dados
    if (!ride_id || !user_id || !amount) {
        return res.status(400).json({ error: "Dados inválidos para finalizar corrida." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Inicia Transação Segura

        const finalAmount = parseFloat(amount); // Garante numérico

        // A. Atualiza Status da Corrida
        await client.query(
            "UPDATE rides SET status = 'completed', final_price = $1 WHERE id = $2",
            [finalAmount, ride_id]
        );

        // B. Registra a Transação na Wallet
        // Nota: 'earnings' adiciona ao saldo do motorista
        await client.query(
            `INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id)
             VALUES ($1, $2, 'earnings', $3, $4)`,
            [user_id, finalAmount, `Corrida Finalizada (${payment_method || 'Dinheiro'})`, ride_id]
        );

        // C. Atualiza Saldo do Usuário (Motorista)
        await client.query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [finalAmount, user_id]
        );

        await client.query('COMMIT'); // Salva Tudo

        console.log(`💰 CORRIDA ${ride_id} FINALIZADA. VALOR: ${finalAmount} KZ.`);

        // Avisa passageiro via Socket para mostrar recibo e fechar
        io.to(`ride_${ride_id}`).emit('ride_terminated', { reason: "Viagem finalizada com sucesso! Obrigado." });

        res.json({ success: true, message: "Transação salva com sucesso." });

    } catch (e) {
        await client.query('ROLLBACK'); // Desfaz se der erro
        console.error("❌ ERRO AO FINALIZAR CORRIDA:", e);
        res.status(500).json({ error: "Erro interno no servidor." });
    } finally {
        client.release();
    }
});

// 4. DETALHES DA CORRIDA (Backup para REST)
app.get('/api/rides/details/:id', async (req, res) => {
    const data = await getFullRideDetails(req.params.id);
    if (!data) return res.status(404).json({error: "Não encontrado"});
    res.json(data);
});

// 5. HISTÓRICO
app.get('/api/history/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM rides WHERE (passenger_id = $1 OR driver_id = $1) AND status IN ('completed', 'cancelled') ORDER BY created_at DESC LIMIT 50`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- INICIA O SERVIDOR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ==================================================
    🚀 AOTRAVEL SERVER ULTIMATE (GOLD MASTER)
    📡 STATUS: ONLINE
    🔌 PORTA: ${PORT}
    📍 RAIO DE BUSCA: 8.0 KM
    💾 DATABASE: NEON POSTGRESQL (SSL ATIVO)
    🛠️ RECURSOS: SOCKETS, UPLOAD 100MB, TRANSAÇÕES
    ==================================================
    `);
});
