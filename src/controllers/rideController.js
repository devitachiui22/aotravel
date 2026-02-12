/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE LIFECYCLE CONTROLLER (TITANIUM CORE)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/rideController.js
 * DESCRIÇÃO: Controlador central para gestão de corridas.
 *            Responsável por: Solicitação, Aceite (Lock), Rastreamento, Finalização e
 *            Liquidação Financeira (Split de Pagamento).
 *
 * INTEGRAÇÃO:
 * - WalletService: Para movimentação de valores.
 * - SocketService: Para notificações em tempo real.
 * - DbBootstrap: Alinhado com schema v2026.02.
 *
 * VERSÃO CORRIGIDA COM SOCKET - V3.0.0
 * =================================================================================================
 */

const pool = require('../config/db');
const { getDistance, getFullRideDetails, logSystem, logError, generateRef } = require('../utils/helpers');
const { emitGlobal, emitToUser, emitToRoom } = require('../services/socketService');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. SOLICITAÇÃO DE CORRIDA (REQUEST) - VERSÃO CORRIGIDA COM SOCKET
// =================================================================================================

/**
 * POST /api/rides/request
 * Cria a intenção de corrida, calcula preço e notifica motoristas próximos via socket.
 */
exports.requestRide = async (req, res) => {
    const {
        origin_lat, origin_lng, dest_lat, dest_lng,
        origin_name, dest_name, ride_type, distance_km
    } = req.body;

    // Validação Estrita de Geolocalização
    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng) {
        return res.status(400).json({ error: "Coordenadas GPS incompletas." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Precificação Dinâmica (Busca config do banco para hot-reload de preços)
        const settingsRes = await client.query(
            "SELECT value FROM app_settings WHERE key = 'ride_prices'"
        );
        const prices = settingsRes.rows[0]?.value || {
            base_price: 600,
            km_rate: 300,
            moto_base: 400,
            moto_km_rate: 180,
            delivery_base: 1000,
            delivery_km_rate: 450
        };

        // Lógica de Cálculo
        let estimatedPrice = 0;
        const dist = parseFloat(distance_km) ||
                     getDistance(origin_lat, origin_lng, dest_lat, dest_lng);

        if (ride_type === 'moto') {
            estimatedPrice = prices.moto_base + (dist * prices.moto_km_rate);
        } else if (ride_type === 'delivery') {
            estimatedPrice = prices.delivery_base + (dist * prices.delivery_km_rate);
        } else {
            // Padrão 'ride' (Carro)
            estimatedPrice = prices.base_price + (dist * prices.km_rate);
        }

        // Arredondamento para múltiplos de 50 Kz (Facilita troco em dinheiro)
        estimatedPrice = Math.ceil(estimatedPrice / 50) * 50;

        // Preço mínimo de segurança
        if (estimatedPrice < 500) estimatedPrice = 500;

        // 2. Persistência no Banco
        const insertQuery = `
            INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, final_price,
                ride_type, distance_km, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW())
            RETURNING *
        `;

        const result = await client.query(insertQuery, [
            req.user.id,
            origin_lat, origin_lng, dest_lat, dest_lng,
            origin_name || 'Origem desconhecida',
            dest_name || 'Destino desconhecido',
            estimatedPrice,
            ride_type || 'ride',
            dist
        ]);

        const ride = result.rows[0];
        await client.query('COMMIT');

        // =================================================================
        // 3. DISPATCH INTELIGENTE VIA SOCKET - CORRIGIDO
        // =================================================================
        const maxRadius = SYSTEM_CONFIG.RIDES.MAX_RADIUS_KM || 15;

        // Busca motoristas ativos e online com socket_id válido
        const driversRes = await pool.query(`
            SELECT 
                dp.driver_id, 
                dp.lat, 
                dp.lng, 
                dp.socket_id, 
                u.fcm_token, 
                u.name,
                u.photo,
                u.rating,
                u.vehicle_details
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE u.is_online = true
            AND u.role = 'driver'
            AND u.is_blocked = false
            AND dp.last_update > NOW() - INTERVAL '2 minutes'
            AND dp.socket_id IS NOT NULL
        `);

        let driversNotified = 0;
        const notifiedDrivers = [];

        // Filtra em memória (Geofencing) e notifica via socket
        for (const driver of driversRes.rows) {
            const distanceToPickup = getDistance(
                origin_lat, origin_lng, 
                driver.lat, driver.lng
            );

            if (distanceToPickup <= maxRadius) {
                // Prepara payload completo para o motorista
                const rideOpportunity = {
                    ...ride,
                    distance_to_pickup: parseFloat(distanceToPickup.toFixed(2)),
                    passenger_name: req.user.name,
                    passenger_photo: req.user.photo,
                    passenger_rating: req.user.rating,
                    estimated_arrival: Math.ceil(distanceToPickup * 3), // 3 min/km
                    notified_at: new Date().toISOString()
                };

                // 🔥 NOTIFICAÇÃO SOCKET DIRETA - PRIORIDADE MÁXIMA
                if (driver.socket_id && global.io) {
                    // Emite para o socket específico do motorista
                    global.io.to(driver.socket_id).emit('ride_opportunity', rideOpportunity);
                    
                    // Emite para a sala pessoal do motorista (redundância)
                    global.io.to(`user_${driver.driver_id}`).emit('new_ride_available', rideOpportunity);
                    
                    driversNotified++;
                    notifiedDrivers.push({
                        driver_id: driver.driver_id,
                        name: driver.name,
                        distance: distanceToPickup
                    });
                }

                // TODO: Firebase Cloud Messaging para background/offline
                // if (driver.fcm_token) { await sendFCMNotification(driver.fcm_token, rideOpportunity); }
            }
        }

        // 🔥 ADICIONA PASSAGEIRO À SALA DA CORRIDA
        if (global.io) {
            global.io.to(`user_${req.user.id}`).emit('ride_requested', {
                ride_id: ride.id,
                status: 'searching',
                message: 'Buscando motorista próximo...'
            });
            
            // Cria sala dedicada para esta corrida
            global.io.to(`ride_${ride.id}`).emit('ride_created', ride);
        }

        // Log detalhado do dispatch
        logSystem('RIDE_REQUEST', `✅ Corrida #${ride.id} criada por User ${req.user.id}. Motoristas notificados: ${driversNotified}/${driversRes.rows.length}`);

        if (notifiedDrivers.length > 0) {
            logSystem('RIDE_DISPATCH', `Motoristas notificados: ${JSON.stringify(notifiedDrivers)}`);
        }

        res.status(201).json({
            success: true,
            message: "Solicitação enviada aos motoristas.",
            ride: ride,
            drivers_nearby: driversNotified,
            dispatch_stats: {
                total_drivers_online: driversRes.rows.length,
                notified: driversNotified,
                radius_km: maxRadius
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_REQUEST_FATAL', e);
        res.status(500).json({ error: "Erro ao solicitar corrida: " + e.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 2. ACEITE DE CORRIDA (MATCHING ACID) - VERSÃO CORRIGIDA COM SOCKET
// =================================================================================================

/**
 * POST /api/rides/accept
 * Motorista aceita a corrida. Usa transação para evitar 'Race Condition'.
 */
exports.acceptRide = async (req, res) => {
    const { ride_id } = req.body;
    const driverId = req.user.id;

    if (req.user.role !== 'driver') {
        return res.status(403).json({ error: "Apenas motoristas podem aceitar corridas." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Start Transaction

        // 1. Lock Row: Impede que outro motorista leia este registro simultaneamente
        const checkRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = checkRes.rows[0];

        // 2. Validação de Estado
        if (ride.status !== 'searching') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: "Esta corrida já foi aceita por outro motorista.",
                code: "RIDE_TAKEN",
                current_status: ride.status
            });
        }

        if (ride.passenger_id === driverId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Você não pode aceitar sua própria corrida." });
        }

        // 3. Verificar se motorista tem vehicle_details cadastrado
        if (!req.user.vehicle_details) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: "Complete seu cadastro de veículo antes de aceitar corridas.",
                code: "VEHICLE_REQUIRED"
            });
        }

        // 4. Atualização Atômica
        const updateRes = await client.query(
            `UPDATE rides SET
                driver_id = $1,
                status = 'accepted',
                accepted_at = NOW(),
                updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [driverId, ride_id]
        );

        await client.query('COMMIT'); // Commit Transaction

        // =================================================================
        // 5. NOTIFICAÇÕES EM TEMPO REAL - CORRIGIDO
        // =================================================================
        
        // Busca detalhes completos (com fotos e dados do passageiro)
        const fullRide = await getFullRideDetails(ride_id);

        // Payload enriquecido para o passageiro
        const matchPayload = {
            ...fullRide,
            driver_name: req.user.name,
            driver_photo: req.user.photo,
            driver_rating: req.user.rating || 4.5,
            driver_phone: req.user.phone,
            vehicle: req.user.vehicle_details,
            driver_socket_id: req.user.socket_id,
            matched_at: new Date().toISOString(),
            estimated_pickup_time: Math.ceil(ride.distance_km * 3), // 3 min/km
            message: "Motorista a caminho do ponto de embarque!"
        };

        // 🔥 NOTIFICA PASSAGEIRO - PRIORIDADE 1
        if (global.io) {
            // Notifica passageiro na sala pessoal dele
            emitToUser(fullRide.passenger_id, 'match_found', matchPayload);
            
            // Notifica a sala da corrida
            emitToRoom(`ride_${ride_id}`, 'ride_accepted', matchPayload);
            
            // Notificação global de status (fallback)
            global.io.emit('ride_status_changed', {
                ride_id: ride_id,
                status: 'accepted',
                driver_id: driverId,
                passenger_id: fullRide.passenger_id
            });

            // 🔥 NOTIFICA TODOS OS OUTROS MOTORISTAS QUE A CORRIDA FOI ACEITA
            // Busca socket_ids dos motoristas que estavam na disputa
            const otherDriversRes = await pool.query(`
                SELECT socket_id, driver_id 
                FROM driver_positions 
                WHERE last_update > NOW() - INTERVAL '2 minutes'
                AND driver_id != $1
                AND socket_id IS NOT NULL
            `, [driverId]);

            otherDriversRes.rows.forEach(driver => {
                if (driver.socket_id) {
                    global.io.to(driver.socket_id).emit('ride_taken', {
                        ride_id: ride_id,
                        message: 'Esta corrida já não está mais disponível.',
                        taken_by: driverId
                    });
                }
            });
        }

        logSystem('RIDE_MATCH', `✅ Corrida #${ride_id} aceita por Driver ${driverId} para Passageiro ${fullRide.passenger_id}`);

        res.json({
            success: true,
            message: "Corrida aceita com sucesso!",
            ride: matchPayload
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_ACCEPT_FATAL', e);
        res.status(500).json({ error: "Erro crítico ao aceitar corrida: " + e.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 3. FLUXO DE EXECUÇÃO (START / STATUS UPDATE) - CORRIGIDO COM SOCKET
// =================================================================================================

/**
 * POST /api/rides/update-status
 * Atualizações intermediárias: 'arrived' (Chegou no embarque), 'picked_up' (Passageiro embarcou).
 */
exports.updateStatus = async (req, res) => {
    const { ride_id, status } = req.body;
    const allowedStatuses = ['arrived', 'picked_up'];

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: "Status inválido." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Valida propriedade da corrida
        const check = await client.query(
            "SELECT driver_id, passenger_id, status FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        if (check.rows[0].driver_id !== req.user.id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Permissão negada." });
        }

        const ride = check.rows[0];

        // Atualiza status conforme evento
        if (status === 'picked_up') {
            await client.query(
                `UPDATE rides SET 
                    status = 'ongoing', 
                    started_at = NOW(), 
                    updated_at = NOW() 
                WHERE id = $1`,
                [ride_id]
            );
        }
        // 'arrived' não altera status principal, apenas log

        await client.query('COMMIT');

        // Busca detalhes atualizados
        const fullRide = await getFullRideDetails(ride_id);

        // =================================================================
        // NOTIFICAÇÕES DE STATUS - CORRIGIDO
        // =================================================================
        
        if (global.io) {
            if (status === 'arrived') {
                // Notifica passageiro que motorista chegou
                emitToUser(fullRide.passenger_id, 'driver_arrived', {
                    ride_id: ride_id,
                    message: "O motorista chegou ao local de embarque!",
                    driver_lat: req.body.current_lat,
                    driver_lng: req.body.current_lng,
                    arrived_at: new Date().toISOString()
                });

                // Notifica sala da corrida
                emitToRoom(`ride_${ride_id}`, 'driver_arrived', {
                    ride_id: ride_id,
                    status: 'arrived',
                    timestamp: new Date().toISOString()
                });

            } else if (status === 'picked_up') {
                // Notifica passageiro que viagem começou
                emitToUser(fullRide.passenger_id, 'trip_started', {
                    ...fullRide,
                    message: "Viagem iniciada! Boa viagem! 🚗",
                    started_at: new Date().toISOString()
                });

                // Notifica sala da corrida
                emitToRoom(`ride_${ride_id}`, 'trip_started', {
                    ride_id: ride_id,
                    status: 'ongoing',
                    started_at: new Date().toISOString()
                });
            }

            // Notificação global de mudança de status
            global.io.emit('ride_status_changed', {
                ride_id: ride_id,
                status: status === 'picked_up' ? 'ongoing' : status,
                updated_at: new Date().toISOString()
            });
        }

        logSystem('RIDE_STATUS', `Corrida #${ride_id} status atualizado para: ${status}`);

        res.json({ 
            success: true, 
            status: status,
            ride: fullRide 
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_STATUS_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar status." });
    } finally {
        client.release();
    }
};

/**
 * POST /api/rides/start
 * Início formal da viagem (redundância para 'picked_up' ou botão explícito).
 */
exports.startRide = async (req, res) => {
    const { ride_id } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE rides SET
                status = 'ongoing',
                started_at = NOW(),
                updated_at = NOW()
             WHERE id = $1 AND driver_id = $2
             RETURNING *`,
            [ride_id, req.user.id]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada ou não pertence a você." });
        }

        await client.query('COMMIT');

        const fullRide = await getFullRideDetails(ride_id);

        // Notificações
        if (global.io) {
            emitToRoom(`ride_${ride_id}`, 'trip_started', fullRide);
            emitToUser(fullRide.passenger_id, 'trip_started_now', {
                status: 'ongoing',
                started_at: new Date().toISOString(),
                ride: fullRide
            });
        }

        logSystem('RIDE_START', `Corrida #${ride_id} iniciada`);
        res.json(fullRide);

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_START', e);
        res.status(500).json({ error: "Erro ao iniciar corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 4. FINALIZAÇÃO E PAGAMENTO (COMPLETE) - CORRIGIDO COM SOCKET
// =================================================================================================

/**
 * POST /api/rides/complete
 * Finaliza a corrida, calcula taxas e executa a liquidação financeira.
 */
exports.completeRide = async (req, res) => {
    const { ride_id, rating, feedback, payment_method, distance_traveled } = req.body;

    // Default cash se não especificado
    const method = payment_method || 'cash';
    const finalDistance = parseFloat(distance_traveled) || null;

    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Start Transaction

        // 1. Lock e Validação
        const rideRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (ride.driver_id !== req.user.id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Apenas o motorista responsável pode finalizar." });
        }

        if (ride.status !== 'ongoing' && ride.status !== 'accepted') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Status inválido para finalização: ${ride.status}` });
        }

        // 2. Calcular distância real percorrida se fornecida
        let finalAmount = parseFloat(ride.final_price || ride.initial_price);
        
        if (finalDistance && finalDistance > ride.distance_km) {
            // Recalcular preço baseado na distância real
            const settingsRes = await client.query(
                "SELECT value FROM app_settings WHERE key = 'ride_prices'"
            );
            const prices = settingsRes.rows[0]?.value || {
                km_rate: 300,
                moto_km_rate: 180,
                delivery_km_rate: 450
            };

            let additionalRate = prices.km_rate;
            if (ride.ride_type === 'moto') additionalRate = prices.moto_km_rate;
            if (ride.ride_type === 'delivery') additionalRate = prices.delivery_km_rate;

            const extraDistance = finalDistance - ride.distance_km;
            const extraCharge = Math.ceil(extraDistance * additionalRate / 50) * 50;
            finalAmount = ride.initial_price + extraCharge;
        }

        // 3. Atualizar Status da Corrida
        await client.query(
            `UPDATE rides SET
                status = 'completed',
                completed_at = NOW(),
                final_price = $1,
                rating = $2,
                feedback = $3,
                payment_method = $4,
                payment_status = 'paid',
                distance_km = COALESCE($5, distance_km),
                updated_at = NOW()
             WHERE id = $6`,
            [finalAmount, rating || 0, feedback || '', method, finalDistance, ride_id]
        );

        // 4. Lógica Financeira (Wallet Integration)
        const amount = finalAmount;
        const txRef = generateRef('RIDE');

        // Se pagamento for via CARTEIRA (Wallet)
        if (method === 'wallet') {
            // A. Verificar saldo do passageiro
            const balanceCheck = await client.query(
                "SELECT balance FROM users WHERE id = $1",
                [ride.passenger_id]
            );

            if (balanceCheck.rows.length === 0 || balanceCheck.rows[0].balance < amount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: "Saldo insuficiente na carteira do passageiro.",
                    code: "INSUFFICIENT_BALANCE"
                });
            }

            // B. Debita Passageiro
            await client.query(
                `UPDATE users SET 
                    balance = balance - $1,
                    updated_at = NOW()
                WHERE id = $2`,
                [amount, ride.passenger_id]
            );

            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, category, created_at)
                 VALUES ($1, $2, $2, $3, $4, 'payment', 'internal', 'completed', $5, 'ride', NOW())`,
                [`${txRef}-PAY`, ride.passenger_id, ride.driver_id, -amount, `Pagamento Corrida #${ride_id}`]
            );

            // C. Credita Motorista
            await client.query(
                `UPDATE users SET 
                    balance = balance + $1,
                    updated_at = NOW()
                WHERE id = $2`,
                [amount, ride.driver_id]
            );

            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, category, created_at)
                 VALUES ($1, $2, $3, $2, $4, 'earnings', 'internal', 'completed', $5, 'ride', NOW())`,
                [`${txRef}-EARN`, ride.driver_id, ride.passenger_id, amount, `Recebimento Corrida #${ride_id}`]
            );
        }
        // Se pagamento for DINHEIRO (Cash)
        else {
            // Apenas registramos o ganho no histórico do motorista
            await client.query(
                `INSERT INTO wallet_transactions
                 (reference_id, user_id, amount, type, method, status, description, category, metadata, created_at)
                 VALUES ($1, $2, $3, 'earnings', 'cash', 'completed', $4, 'ride', '{"is_cash": true}', NOW())`,
                [`${txRef}-CASH`, ride.driver_id, amount, `Corrida em Dinheiro #${ride_id}`]
            );
        }

        await client.query('COMMIT');

        // =================================================================
        // 5. NOTIFICAÇÕES DE FINALIZAÇÃO - CORRIGIDO
        // =================================================================
        
        const fullRide = await getFullRideDetails(ride_id);

        if (global.io) {
            // Notifica sala da corrida
            emitToRoom(`ride_${ride_id}`, 'ride_completed', {
                ...fullRide,
                message: "Viagem finalizada! Obrigado por viajar conosco!",
                completed_at: new Date().toISOString()
            });

            // Notificações individuais
            emitToUser(ride.passenger_id, 'ride_completed_passenger', {
                ride_id: ride_id,
                amount: amount,
                payment_method: method,
                rating: rating,
                completed_at: new Date().toISOString()
            });

            emitToUser(ride.driver_id, 'ride_completed_driver', {
                ride_id: ride_id,
                amount: amount,
                payment_method: method,
                completed_at: new Date().toISOString()
            });

            // Atualiza saldo visual se foi via wallet
            if (method === 'wallet') {
                // Busca saldos atualizados
                const passengerBalance = await pool.query(
                    "SELECT balance FROM users WHERE id = $1",
                    [ride.passenger_id]
                );
                const driverBalance = await pool.query(
                    "SELECT balance FROM users WHERE id = $1",
                    [ride.driver_id]
                );

                emitToUser(ride.passenger_id, 'wallet_update', { 
                    type: 'payment', 
                    amount: -amount,
                    balance: passengerBalance.rows[0].balance
                });
                
                emitToUser(ride.driver_id, 'wallet_update', { 
                    type: 'earnings', 
                    amount: amount,
                    balance: driverBalance.rows[0].balance
                });
            }
        }

        logSystem('RIDE_COMPLETE', `✅ Corrida #${ride_id} finalizada (${method}). Valor: ${amount} Kz`);
        res.json({
            success: true,
            message: "Corrida finalizada com sucesso!",
            ride: fullRide
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_COMPLETE_FATAL', e);
        res.status(500).json({ error: "Erro crítico ao finalizar corrida: " + e.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 5. CANCELAMENTO E HISTÓRICO - CORRIGIDO COM SOCKET
// =================================================================================================

/**
 * POST /api/rides/cancel
 */
exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;
    const userId = req.user.id;
    const role = req.user.role;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verifica se a corrida pode ser cancelada (não finalizada)
        const check = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );
        
        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = check.rows[0];
        
        if (['completed', 'cancelled'].includes(ride.status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Corrida já finalizada ou cancelada." });
        }

        // Verificar permissão
        if (ride.passenger_id !== userId && ride.driver_id !== userId && req.user.role !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Permissão negada." });
        }

        const result = await client.query(
            `UPDATE rides SET
                status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = $1,
                cancellation_reason = $2,
                updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [role, reason || 'Cancelado pelo usuário', ride_id]
        );

        await client.query('COMMIT');

        const cancelledRide = result.rows[0];

        // =================================================================
        // NOTIFICAÇÕES DE CANCELAMENTO - CORRIGIDO
        // =================================================================
        
        if (global.io) {
            // Notifica sala da corrida
            emitToRoom(`ride_${ride_id}`, 'ride_cancelled', {
                ride_id: ride_id,
                cancelled_by: role,
                reason: reason || 'Cancelado pelo usuário',
                cancelled_at: new Date().toISOString()
            });

            // Notifica o outro participante
            const targetId = role === 'driver' ? ride.passenger_id : ride.driver_id;
            if (targetId) {
                emitToUser(targetId, 'ride_cancelled', {
                    ride_id: ride_id,
                    cancelled_by: role,
                    reason: reason || 'Cancelado pelo usuário',
                    cancelled_at: new Date().toISOString()
                });
            }

            // Se estava em 'searching', notifica motoristas que a corrida foi cancelada
            if (ride.status === 'searching') {
                const driversRes = await pool.query(`
                    SELECT socket_id 
                    FROM driver_positions 
                    WHERE last_update > NOW() - INTERVAL '2 minutes'
                    AND socket_id IS NOT NULL
                `);

                driversRes.rows.forEach(driver => {
                    if (driver.socket_id) {
                        global.io.to(driver.socket_id).emit('ride_cancelled_by_passenger', {
                            ride_id: ride_id,
                            message: 'Esta corrida foi cancelada pelo passageiro.'
                        });
                    }
                });
            }
        }

        logSystem('RIDE_CANCEL', `Corrida #${ride_id} cancelada por ${role}`);
        res.json({ 
            success: true, 
            message: "Corrida cancelada.",
            ride: cancelledRide
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_CANCEL', e);
        res.status(500).json({ error: "Erro ao cancelar corrida." });
    } finally {
        client.release();
    }
};

/**
 * GET /api/rides/history
 * Histórico paginado.
 */
exports.getHistory = async (req, res) => {
    const { limit = 20, offset = 0, status } = req.query;
    const userId = req.user.id;

    try {
        let query = `
            SELECT 
                r.*,
                -- Dados do Parceiro (Se sou passageiro, mostre motorista, e vice-versa)
                CASE 
                    WHEN r.passenger_id = $1 THEN json_build_object(
                        'id', d.id,
                        'name', d.name,
                        'photo', d.photo,
                        'rating', d.rating,
                        'phone', d.phone,
                        'role', 'driver'
                    )
                    ELSE json_build_object(
                        'id', p.id,
                        'name', p.name,
                        'photo', p.photo,
                        'rating', p.rating,
                        'phone', p.phone,
                        'role', 'passenger'
                    )
                END as counterpart,
                -- Flags de perfil
                CASE WHEN r.passenger_id = $1 THEN 'passenger' ELSE 'driver' END as user_role_in_ride
            FROM rides r
            LEFT JOIN users d ON r.driver_id = d.id
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE (r.passenger_id = $1 OR r.driver_id = $1)
        `;

        const params = [userId];
        let paramCount = 2;

        if (status) {
            query += ` AND r.status = $${paramCount}`;
            params.push(status);
            paramCount++;
        }

        query += ` ORDER BY r.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);
        
        // Formatar valores
        const formattedRides = result.rows.map(ride => ({
            ...ride,
            initial_price: parseFloat(ride.initial_price),
            final_price: parseFloat(ride.final_price),
            distance_km: parseFloat(ride.distance_km),
            created_at: ride.created_at?.toISOString(),
            accepted_at: ride.accepted_at?.toISOString(),
            started_at: ride.started_at?.toISOString(),
            completed_at: ride.completed_at?.toISOString(),
            cancelled_at: ride.cancelled_at?.toISOString()
        }));

        res.json({
            success: true,
            rides: formattedRides,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: formattedRides.length
            }
        });

    } catch (e) {
        logError('RIDE_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
};

/**
 * GET /api/rides/:id
 * Detalhes completos.
 */
exports.getRideDetails = async (req, res) => {
    try {
        const fullRide = await getFullRideDetails(req.params.id);
        
        if (!fullRide) {
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        // Segurança: Apenas participantes ou admin
        if (fullRide.passenger_id !== req.user.id && 
            fullRide.driver_id !== req.user.id && 
            req.user.role !== 'admin') {
            return res.status(403).json({ error: "Acesso negado." });
        }

        // Formatar datas
        const formattedRide = {
            ...fullRide,
            initial_price: parseFloat(fullRide.initial_price),
            final_price: parseFloat(fullRide.final_price || fullRide.initial_price),
            distance_km: parseFloat(fullRide.distance_km),
            created_at: fullRide.created_at?.toISOString(),
            accepted_at: fullRide.accepted_at?.toISOString(),
            started_at: fullRide.started_at?.toISOString(),
            completed_at: fullRide.completed_at?.toISOString(),
            cancelled_at: fullRide.cancelled_at?.toISOString()
        };

        res.json(formattedRide);

    } catch (e) {
        logError('RIDE_DETAILS', e);
        res.status(500).json({ error: "Erro ao carregar detalhes." });
    }
};

// =================================================================================================
// 6. ESTATÍSTICAS E PERFORMANCE
// =================================================================================================

/**
 * GET /api/driver/performance-stats
 * Dashboard do Motorista (Requisito do Frontend).
 */
exports.getDriverPerformance = async (req, res) => {
    try {
        if (req.user.role !== 'driver') {
            return res.status(403).json({ error: "Apenas motoristas podem acessar estas estatísticas." });
        }

        // Estatísticas de hoje (Aggregation)
        const statsQuery = `
            SELECT
                COUNT(*) as missions,
                COALESCE(SUM(final_price), 0) as earnings,
                COALESCE(AVG(rating), 0) as avg_rating,
                COUNT(CASE WHEN rating >= 4 THEN 1 END) as positive_ratings,
                COUNT(CASE WHEN rating < 3 THEN 1 END) as negative_ratings
            FROM rides
            WHERE driver_id = $1
              AND status = 'completed'
              AND created_at >= CURRENT_DATE
        `;
        const statsRes = await pool.query(statsQuery, [req.user.id]);

        // Estatísticas da semana
        const weekStatsQuery = `
            SELECT
                COUNT(*) as week_missions,
                COALESCE(SUM(final_price), 0) as week_earnings,
                COALESCE(AVG(rating), 0) as week_avg_rating
            FROM rides
            WHERE driver_id = $1
              AND status = 'completed'
              AND created_at >= NOW() - INTERVAL '7 days'
        `;
        const weekStatsRes = await pool.query(weekStatsQuery, [req.user.id]);

        // Últimas 10 corridas para lista rápida
        const recentQuery = `
            SELECT 
                r.*, 
                p.name as passenger_name,
                p.photo as passenger_photo,
                p.rating as passenger_rating
            FROM rides r
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE r.driver_id = $1 
            AND r.status = 'completed'
            ORDER BY r.created_at DESC 
            LIMIT 10
        `;
        const recentRes = await pool.query(recentQuery, [req.user.id]);

        // Estatísticas por tipo de corrida
        const typeStatsQuery = `
            SELECT
                ride_type,
                COUNT(*) as count,
                COALESCE(AVG(final_price), 0) as avg_price,
                COALESCE(SUM(final_price), 0) as total_earnings
            FROM rides
            WHERE driver_id = $1
            AND status = 'completed'
            AND created_at >= NOW() - INTERVAL '30 days'
            GROUP BY ride_type
        `;
        const typeStatsRes = await pool.query(typeStatsQuery, [req.user.id]);

        res.json({
            success: true,
            today: {
                missions: parseInt(statsRes.rows[0].missions),
                earnings: parseFloat(statsRes.rows[0].earnings),
                avg_rating: parseFloat(statsRes.rows[0].avg_rating),
                positive_ratings: parseInt(statsRes.rows[0].positive_ratings),
                negative_ratings: parseInt(statsRes.rows[0].negative_ratings)
            },
            week: {
                missions: parseInt(weekStatsRes.rows[0].week_missions),
                earnings: parseFloat(weekStatsRes.rows[0].week_earnings),
                avg_rating: parseFloat(weekStatsRes.rows[0].week_avg_rating)
            },
            recent_rides: recentRes.rows.map(ride => ({
                ...ride,
                final_price: parseFloat(ride.final_price),
                created_at: ride.created_at?.toISOString()
            })),
            by_ride_type: typeStatsRes.rows.map(type => ({
                type: type.ride_type || 'ride',
                count: parseInt(type.count),
                avg_price: parseFloat(type.avg_price),
                total_earnings: parseFloat(type.total_earnings)
            }))
        });

    } catch (e) {
        logError('DRIVER_STATS', e);
        res.status(500).json({ error: "Erro ao carregar estatísticas." });
    }
};

/**
 * GET /api/passenger/stats
 * Estatísticas para passageiros
 */
exports.getPassengerStats = async (req, res) => {
    try {
        const statsQuery = `
            SELECT
                COUNT(*) as total_rides,
                COALESCE(AVG(rating), 0) as avg_rating_given,
                COALESCE(SUM(final_price), 0) as total_spent,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_rides,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_rides
            FROM rides
            WHERE passenger_id = $1
            AND created_at >= NOW() - INTERVAL '30 days'
        `;
        
        const statsRes = await pool.query(statsQuery, [req.user.id]);

        res.json({
            success: true,
            stats: {
                total_rides: parseInt(statsRes.rows[0].total_rides),
                avg_rating_given: parseFloat(statsRes.rows[0].avg_rating_given),
                total_spent: parseFloat(statsRes.rows[0].total_spent),
                cancelled_rides: parseInt(statsRes.rows[0].cancelled_rides),
                completed_rides: parseInt(statsRes.rows[0].completed_rides)
            }
        });

    } catch (e) {
        logError('PASSENGER_STATS', e);
        res.status(500).json({ error: "Erro ao carregar estatísticas." });
    }
};

/**
 * POST /api/rides/:id/rating
 * Avaliar corrida (passageiro avalia motorista)
 */
exports.rateRide = async (req, res) => {
    const { ride_id } = req.params;
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Avaliação deve ser entre 1 e 5 estrelas." });
    }

    try {
        const result = await pool.query(
            `UPDATE rides SET
                rating = $1,
                feedback = $2,
                updated_at = NOW()
             WHERE id = $3 
             AND passenger_id = $4
             AND status = 'completed'
             RETURNING *`,
            [rating, feedback || '', ride_id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Corrida não encontrada ou não pode ser avaliada." });
        }

        // Atualiza média de rating do motorista
        await pool.query(`
            UPDATE users 
            SET rating = (
                SELECT COALESCE(AVG(rating), 0)
                FROM rides
                WHERE driver_id = $1
                AND rating > 0
            )
            WHERE id = $1
        `, [result.rows[0].driver_id]);

        logSystem('RIDE_RATED', `Corrida #${ride_id} avaliada com ${rating} estrelas`);

        res.json({
            success: true,
            message: "Avaliação registrada com sucesso!",
            rating: rating
        });

    } catch (e) {
        logError('RIDE_RATE', e);
        res.status(500).json({ error: "Erro ao registrar avaliação." });
    }
};

module.exports = exports;
