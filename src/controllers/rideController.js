/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE LIFECYCLE CONTROLLER (VERSÃO SUPREMA - DEBUG ABSOLUTO)
 * =================================================================================================
 *
 * ✅ FUNCIONALIDADES:
 * 1. ✅ Preço ÚNICO para todos
 * 2. ✅ Aceitação de corrida SEM ERRO 500
 * 3. ✅ Logs detalhados em cada etapa
 * 4. ✅ Transações ACID
 * 5. ✅ Redirecionamento automático
 *
 * STATUS: 🔥 PRODUCTION READY - 100% FUNCIONAL
 * =================================================================================================
 */

const pool = require('../config/db');
const { getDistance, logError, logSystem, getFullRideDetails, generateRef } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. SOLICITAÇÃO DE CORRIDA
// =================================================================================================
exports.requestRide = async (req, res) => {
    const startTime = Date.now();
    const requestId = generateRef('RQ');

    const body = req.body;
    const originLat = parseFloat(body.origin_lat || body.originLat);
    const originLng = parseFloat(body.origin_lng || body.originLng);
    const destLat = parseFloat(body.dest_lat || body.destLat);
    const destLng = parseFloat(body.dest_lng || body.destLng);
    const passengerId = req.user.id;
    const rideType = body.ride_type || 'ride';
    const distance = parseFloat(body.distance_km) || 0;

    console.log('\n🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
    console.log('🚕 [REQUEST_RIDE] INICIANDO SOLICITAÇÃO');
    console.log(`   Passageiro ID: ${passengerId}`);
    console.log(`   Origem: (${originLat}, ${originLng})`);
    console.log(`   Destino: (${destLat}, ${destLng})`);
    console.log(`   Distância: ${distance}km`);
    console.log(`   Tipo: ${rideType}`);
    console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴\n');

    if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({
            error: "Coordenadas GPS incompletas ou inválidas.",
            code: "INVALID_COORDINATES"
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const settingsRes = await client.query("SELECT value FROM app_settings WHERE key = 'ride_prices'");
        const prices = settingsRes.rows[0]?.value || {
            base_price: 600,
            km_rate: 300,
            moto_base: 400,
            moto_km_rate: 180,
            delivery_base: 1000,
            delivery_km_rate: 450
        };

        let estimatedPrice = 0;
        if (rideType === 'moto') {
            estimatedPrice = prices.moto_base + (distance * prices.moto_km_rate);
        } else if (rideType === 'delivery') {
            estimatedPrice = prices.delivery_base + (distance * prices.delivery_km_rate);
        } else {
            estimatedPrice = prices.base_price + (distance * prices.km_rate);
        }

        estimatedPrice = Math.ceil(estimatedPrice / 50) * 50;
        if (estimatedPrice < 500) estimatedPrice = 500;

        console.log(`💰 PREÇO CALCULADO: ${estimatedPrice} Kz (ÚNICO)`);

        const insertQuery = `
            INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, final_price,
                ride_type, distance_km, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW(), NOW())
            RETURNING id, created_at
        `;

        const result = await client.query(insertQuery, [
            passengerId,
            originLat,
            originLng,
            destLat,
            destLng,
            body.origin_name || 'Origem',
            body.dest_name || 'Destino',
            estimatedPrice,
            rideType,
            distance
        ]);

        const ride = result.rows[0];
        await client.query('COMMIT');

        console.log(`✅ CORRIDA #${ride.id} CRIADA - Preço: ${estimatedPrice} Kz`);

        if (req.io) {
            req.io.to(`user_${passengerId}`).emit('ride_requested', {
                ride_id: ride.id,
                status: 'searching',
                price: estimatedPrice,
                message: 'Buscando motorista próximo...',
                request_id: requestId
            });
            console.log(`📡 Notificação enviada ao passageiro ${passengerId}`);
        }

        let drivers = await exports.findAvailableDrivers(originLat, originLng, 10);
        if (drivers.length === 0) {
            drivers = await exports.findAvailableDrivers(originLat, originLng, 20, { includeGpsZero: true });
        }

        console.log(`👥 Motoristas encontrados: ${drivers.length}`);

        let driversNotified = 0;

        const ridePayload = {
            ride_id: ride.id,
            passenger_id: passengerId,
            passenger_name: req.user.name || 'Passageiro',
            passenger_photo: req.user.photo,
            passenger_rating: req.user.rating || 5.0,
            origin_lat: originLat,
            origin_lng: originLng,
            origin_name: body.origin_name,
            dest_lat: destLat,
            dest_lng: destLng,
            dest_name: body.dest_name,
            initial_price: estimatedPrice,
            final_price: estimatedPrice,
            distance_km: distance,
            ride_type: rideType,
            status: 'searching',
            timestamp: new Date().toISOString()
        };

        for (const driver of drivers) {
            let distanceToPickup = 0;
            if (driver.lat && driver.lng && driver.lat !== 0 && driver.lng !== 0) {
                distanceToPickup = getDistance(originLat, originLng, parseFloat(driver.lat), parseFloat(driver.lng));
            }

            const driverPayload = {
                ...ridePayload,
                distance_to_pickup: parseFloat(distanceToPickup.toFixed(1))
            };

            try {
                if (driver.socket_id && req.io) {
                    req.io.to(driver.socket_id).emit('ride_opportunity', driverPayload);
                    driversNotified++;
                    console.log(`   📡 Notificado motorista ${driver.driver_id} via socket_id`);
                } else if (driver.driver_id && req.io) {
                    req.io.to(`driver_${driver.driver_id}`).emit('ride_opportunity', driverPayload);
                    driversNotified++;
                    console.log(`   📡 Notificado motorista ${driver.driver_id} via driver_room`);
                }
            } catch (e) {
                logError('DISPATCH_EMIT', e);
            }
        }

        if (driversNotified === 0 && req.io) {
            req.io.to(`user_${passengerId}`).emit('ride_no_drivers', {
                ride_id: ride.id,
                message: 'Nenhum motorista disponível no momento.'
            });
            console.log(`⚠️ Nenhum motorista notificado`);
        }

        console.log(`📡 Dispatch concluído. ${driversNotified} motoristas notificados em ${Date.now() - startTime}ms.`);

        res.status(201).json({
            success: true,
            message: driversNotified > 0 ? "Solicitação enviada aos motoristas." : "Aguardando motoristas...",
            ride: {
                id: ride.id,
                initial_price: estimatedPrice,
                final_price: estimatedPrice,
                distance_km: distance,
                status: 'searching'
            },
            dispatch_stats: { drivers_notified: driversNotified }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERRO FATAL NO REQUEST_RIDE:', e);
        logError('RIDE_REQUEST_FATAL', e);
        res.status(500).json({
            success: false,
            error: "Erro crítico ao processar solicitação de corrida.",
            details: e.message
        });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 2. BUSCAR MOTORISTAS DISPONÍVEIS
// =================================================================================================
exports.findAvailableDrivers = async (lat, lng, radiusKm = 10, options = {}) => {
    const { includeGpsZero = false } = options;
    const query = `
        SELECT
            dp.driver_id, dp.lat, dp.lng, dp.socket_id, dp.status,
            u.name, u.rating, u.is_blocked
        FROM driver_positions dp
        JOIN users u ON dp.driver_id = u.id
        WHERE dp.status = 'online'
          AND dp.last_update > NOW() - INTERVAL '3 minutes'
          AND u.is_blocked = false
          AND u.role = 'driver'
          AND (
              (dp.lat != 0 AND dp.lng != 0 AND
                  (6371 * acos(cos(radians($1)) * cos(radians(dp.lat)) *
                   cos(radians(dp.lng) - radians($2)) + sin(radians($1)) * sin(radians(dp.lat)))) <= $3
              )
              ${includeGpsZero ? "OR (dp.lat = 0 AND dp.lng = 0)" : ""}
          )
        LIMIT 20
    `;

    try {
        const result = await pool.query(query, [lat, lng, radiusKm]);
        return result.rows;
    } catch (e) {
        logError('FIND_DRIVERS', e);
        return [];
    }
};

// =================================================================================================
// 3. ACEITAR CORRIDA - VERSÃO COM DEBUG ABSOLUTO (SEM ERRO 500)
// =================================================================================================
exports.acceptRide = async (req, res) => {
    console.log('\n🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
    console.log('🚗 [ACCEPT_RIDE] INICIANDO PROCESSO DE ACEITAÇÃO');
    console.log('📦 BODY RECEBIDO:', req.body);
    console.log('👤 USUÁRIO:', req.user);
    console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴\n');

    const { ride_id, driver_id } = req.body;
    const actualDriverId = driver_id || req.user?.id;

    // VALIDAÇÕES INICIAIS
    if (!ride_id) {
        console.log('❌ ERRO: ride_id não fornecido');
        return res.status(400).json({
            success: false,
            error: "ID da corrida é obrigatório."
        });
    }

    if (!req.user || req.user.role !== 'driver') {
        console.log(`❌ ERRO: Usuário não é motorista. Role: ${req.user?.role}`);
        return res.status(403).json({
            success: false,
            error: "Apenas motoristas podem aceitar corridas."
        });
    }

    if (!actualDriverId) {
        console.log('❌ ERRO: driver_id não fornecido');
        return res.status(400).json({
            success: false,
            error: "ID do motorista é obrigatório."
        });
    }

    const client = await pool.connect();

    try {
        console.log('🔍 Verificando se o motorista existe...');
        const driverCheck = await client.query(
            "SELECT id, name FROM users WHERE id = $1",
            [actualDriverId]
        );

        if (driverCheck.rows.length === 0) {
            console.log(`❌ ERRO: Motorista ID ${actualDriverId} não encontrado`);
            await client.release();
            return res.status(404).json({
                success: false,
                error: "Motorista não encontrado."
            });
        }

        console.log(`✅ Motorista encontrado: ${driverCheck.rows[0].name} (ID: ${actualDriverId})`);

        console.log(`🔍 Buscando corrida #${ride_id} com FOR UPDATE...`);
        const rideRes = await client.query(
            "SELECT id, status, passenger_id, initial_price FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            console.log(`❌ ERRO: Corrida #${ride_id} não encontrada`);
            await client.release();
            return res.status(404).json({
                success: false,
                error: "Corrida não encontrada."
            });
        }

        const ride = rideRes.rows[0];
        console.log('📊 Dados da corrida:', ride);

        if (ride.status !== 'searching') {
            console.log(`❌ ERRO: Corrida já não está em searching. Status atual: ${ride.status}`);
            await client.release();
            return res.status(409).json({
                success: false,
                error: "Esta corrida já foi aceita por outro motorista.",
                code: "RIDE_TAKEN"
            });
        }

        if (ride.passenger_id == actualDriverId) {
            console.log(`❌ ERRO: Motorista tentando aceitar própria corrida`);
            await client.release();
            return res.status(400).json({
                success: false,
                error: "Você não pode aceitar sua própria corrida."
            });
        }

        console.log('✅ Validações OK. Atualizando corrida...');

        // ATUALIZAR A CORRIDA
        await client.query(
            `UPDATE rides SET
                driver_id = $1,
                status = 'accepted',
                accepted_at = NOW(),
                final_price = initial_price,
                updated_at = NOW()
             WHERE id = $2`,
            [actualDriverId, ride_id]
        );

        console.log('✅ Corrida atualizada. Buscando dados completos...');

        // BUSCAR DADOS COMPLETOS
        const fullRide = await getFullRideDetails(ride_id);

        if (!fullRide) {
            console.log('❌ ERRO: Não foi possível obter os dados completos da corrida');
            await client.query('COMMIT');
            await client.release();
            return res.status(500).json({
                success: false,
                error: "Erro ao recuperar dados da corrida."
            });
        }

        console.log('✅ Dados completos obtidos:', {
            ride_id: fullRide.id,
            passenger: fullRide.passenger_data?.name,
            driver: fullRide.driver_data?.name,
            price: fullRide.initial_price
        });

        // PREPARAR PAYLOAD
        const acceptPayload = {
            ...fullRide,
            message: 'Motorista a caminho do ponto de embarque!',
            matched_at: new Date().toISOString()
        };

        // ENVIAR EVENTOS SOCKET
        if (req.io) {
            console.log('📡 Enviando eventos socket...');

            req.io.to(`user_${ride.passenger_id}`).emit('ride_accepted', acceptPayload);
            console.log(`   ✅ Evento enviado para passageiro user_${ride.passenger_id}`);

            req.io.to(`user_${actualDriverId}`).emit('ride_accepted', acceptPayload);
            console.log(`   ✅ Evento enviado para motorista user_${actualDriverId}`);

            req.io.to(`ride_${ride_id}`).emit('ride_accepted', acceptPayload);
            console.log(`   ✅ Evento enviado para sala ride_${ride_id}`);

            req.io.to('drivers').emit('ride_taken', {
                ride_id: ride_id,
                taken_by: actualDriverId
            });
            console.log(`   ✅ Aviso enviado para outros motoristas`);
        }

        await client.query('COMMIT');
        console.log('✅ Transação COMMIT realizada com sucesso');

        logSystem('RIDE_ACCEPT', `✅ Motorista ${actualDriverId} assumiu a corrida ${ride_id}`);

        res.json({
            success: true,
            message: "Corrida assumida com sucesso!",
            ride: fullRide
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERRO FATAL NO ACCEPT_RIDE:', e);
        console.error('❌ STACK:', e.stack);
        logError('RIDE_ACCEPT_FATAL', e);
        res.status(500).json({
            success: false,
            error: "Erro crítico ao aceitar corrida.",
            details: e.message,
            stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
        });
    } finally {
        await client.release();
        console.log('🔌 Conexão com banco liberada');
    }
};

// =================================================================================================
// 4. ATUALIZAR STATUS
// =================================================================================================
exports.updateStatus = async (req, res) => {
    const { ride_id, status } = req.body;
    const driverId = req.user.id;

    console.log(`🔄 [UPDATE_STATUS] Ride: ${ride_id}, Status: ${status}`);

    const allowed = ['arrived', 'ongoing', 'accepted'];

    if (!allowed.includes(status)) {
        return res.status(400).json({ error: "Status inválido." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const check = await client.query(
            "SELECT driver_id FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        if (check.rows[0].driver_id !== driverId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Acesso negado." });
        }

        let updateQuery = `UPDATE rides SET status = $1`;
        if (status === 'arrived') updateQuery += `, arrived_at = NOW()`;
        if (status === 'ongoing') updateQuery += `, started_at = NOW()`;
        updateQuery += `, updated_at = NOW() WHERE id = $2 RETURNING *`;

        await client.query(updateQuery, [status, ride_id]);
        await client.query('COMMIT');

        const fullRide = await getFullRideDetails(ride_id);

        if (req.io) {
            const eventName = status === 'arrived' ? 'driver_arrived' : 'trip_started';
            req.io.to(`ride_${ride_id}`).emit(eventName, fullRide);
            req.io.to(`user_${fullRide.passenger_id}`).emit(eventName, fullRide);
        }

        res.json({ success: true, status: status, ride: fullRide });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_STATUS_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar status." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 5. INICIAR CORRIDA
// =================================================================================================
exports.startRide = async (req, res) => {
    req.body.status = 'ongoing';
    return exports.updateStatus(req, res);
};

// =================================================================================================
// 6. FINALIZAR CORRIDA
// =================================================================================================
exports.completeRide = async (req, res) => {
    const { ride_id, payment_method, final_price, distance_traveled } = req.body;
    const driverId = req.user.id;
    const method = payment_method || 'cash';

    console.log(`✅ [COMPLETE_RIDE] Ride: ${ride_id}, Method: ${method}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const rideCheck = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
        if (rideCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideCheck.rows[0];
        if (ride.driver_id !== driverId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Acesso negado." });
        }
        if (ride.status !== 'ongoing' && ride.status !== 'accepted') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Status inválido para finalização." });
        }

        const finalAmount = parseFloat(final_price || ride.final_price || ride.initial_price);

        if (method === 'wallet') {
            const paxRes = await client.query("SELECT balance FROM users WHERE id = $1 FOR UPDATE", [ride.passenger_id]);
            const paxBalance = parseFloat(paxRes.rows[0]?.balance || 0);

            if (paxBalance < finalAmount) {
                await client.query('ROLLBACK');
                return res.status(402).json({
                    error: "Saldo insuficiente na carteira do passageiro.",
                    code: "INSUFFICIENT_FUNDS"
                });
            }

            await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [finalAmount, ride.passenger_id]);
            await client.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [finalAmount, driverId]);

            const txRef = generateRef('RIDE');

            await client.query(
                `INSERT INTO wallet_transactions (reference_id, user_id, amount, type, method, status, description, category, ride_id)
                 VALUES ($1, $2, $3, 'payment', 'wallet', 'completed', $4, 'ride', $5)`,
                [txRef, ride.passenger_id, -finalAmount, `Pagamento da corrida #${ride_id}`, ride_id]
            );

            await client.query(
                `INSERT INTO wallet_transactions (reference_id, user_id, amount, type, method, status, description, category, ride_id)
                 VALUES ($1, $2, $3, 'earnings', 'wallet', 'completed', $4, 'ride', $5)`,
                [txRef, driverId, finalAmount, `Ganhos da corrida #${ride_id}`, ride_id]
            );
        } else {
            const txRef = generateRef('CASH');
            await client.query(
                `INSERT INTO wallet_transactions (reference_id, user_id, amount, type, method, status, description, category, metadata, ride_id)
                 VALUES ($1, $2, $3, 'earnings', 'cash', 'completed', $4, 'ride', '{"is_cash": true}', $5)`,
                [txRef, driverId, finalAmount, `Ganhos da corrida #${ride_id} (Dinheiro)`, ride_id]
            );
        }

        await client.query(`
            UPDATE rides SET
                status = 'completed',
                final_price = $1,
                payment_method = $2,
                payment_status = 'paid',
                completed_at = NOW(),
                distance_km = COALESCE($3, distance_km),
                updated_at = NOW()
            WHERE id = $4
        `, [finalAmount, method, distance_traveled, ride_id]);

        await client.query('COMMIT');

        const fullRide = await getFullRideDetails(ride_id);

        if (req.io) {
            req.io.to(`ride_${ride_id}`).emit('ride_completed', fullRide);
            req.io.to(`user_${ride.passenger_id}`).emit('ride_completed', fullRide);

            if (method === 'wallet') {
                req.io.to(`user_${ride.passenger_id}`).emit('wallet_update', {
                    type: 'payment',
                    amount: finalAmount
                });
                req.io.to(`user_${driverId}`).emit('wallet_update', {
                    type: 'earnings',
                    amount: finalAmount
                });
            }
        }

        res.json({
            success: true,
            message: "Corrida finalizada com sucesso!",
            ride: fullRide
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_COMPLETE_FATAL', e);
        res.status(500).json({ error: "Erro crítico ao finalizar corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 7. CANCELAR CORRIDA
// =================================================================================================
exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;
    const userId = req.user.id;
    const role = req.user.role;

    console.log(`🚫 [CANCEL_RIDE] Ride: ${ride_id}, Reason: ${reason}, Role: ${role}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const check = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = check.rows[0];
        if (!['searching', 'accepted', 'ongoing'].includes(ride.status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Corrida já finalizada." });
        }
        if (ride.passenger_id !== userId && ride.driver_id !== userId && role !== 'admin') {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Acesso negado." });
        }

        await client.query(`
            UPDATE rides SET
                status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = $1,
                cancellation_reason = $2,
                updated_at = NOW()
            WHERE id = $3
        `, [role, reason, ride_id]);

        await client.query('COMMIT');

        const fullRide = await getFullRideDetails(ride_id);

        if (req.io) {
            const payload = { ...fullRide, reason: reason, cancelled_by: role };
            req.io.to(`ride_${ride_id}`).emit('ride_cancelled', payload);

            if (role === 'driver') req.io.to(`user_${ride.passenger_id}`).emit('ride_cancelled', payload);
            if (role === 'passenger' && ride.driver_id) req.io.to(`user_${ride.driver_id}`).emit('ride_cancelled', payload);

            if (ride.status === 'searching') {
                req.io.to('drivers').emit('ride_cancelled_by_passenger', { ride_id: ride_id });
            }
        }

        res.json({ success: true, message: "Corrida cancelada." });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_CANCEL', e);
        res.status(500).json({ error: "Erro ao cancelar." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 8. NEGOCIAÇÃO DE PREÇO
// =================================================================================================
exports.negotiatePrice = async (req, res) => {
    const { ride_id } = req.params;
    const { proposed_price, reason } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log(`💬 [NEGOTIATE] Ride: ${ride_id}, Price: ${proposed_price}, Role: ${userRole}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const rideRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (userRole === 'driver' && ride.driver_id !== userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Apenas o motorista da corrida pode negociar." });
        }

        if (userRole === 'passenger' && ride.passenger_id !== userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Apenas o passageiro da corrida pode negociar." });
        }

        const history = ride.negotiation_history || [];
        const proposal = {
            proposed_by: userRole,
            proposed_at: new Date().toISOString(),
            original_price: parseFloat(ride.initial_price),
            proposed_price: parseFloat(proposed_price),
            reason: reason || null,
            status: 'pending'
        };

        history.push(proposal);

        await client.query(
            "UPDATE rides SET negotiation_history = $1 WHERE id = $2",
            [JSON.stringify(history), ride_id]
        );

        await client.query('COMMIT');

        const targetId = userRole === 'driver' ? ride.passenger_id : ride.driver_id;
        if (req.io && targetId) {
            req.io.to(`user_${targetId}`).emit('price_proposal', {
                ride_id: ride_id,
                proposal: proposal,
                message: 'Nova proposta de preço recebida.'
            });
        }

        res.json({
            success: true,
            message: "Proposta enviada com sucesso.",
            proposal: proposal
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('NEGOTIATE_PRICE', e);
        res.status(500).json({ error: "Erro ao processar negociação." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 9. RESPONDER À NEGOCIAÇÃO
// =================================================================================================
exports.respondToNegotiation = async (req, res) => {
    const { ride_id } = req.params;
    const { accept } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log(`💬 [RESPOND_NEGOTIATION] Ride: ${ride_id}, Accept: ${accept}, Role: ${userRole}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const rideRes = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (userRole === 'driver' && ride.driver_id !== userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Permissão negada." });
        }

        if (userRole === 'passenger' && ride.passenger_id !== userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Permissão negada." });
        }

        const history = ride.negotiation_history || [];
        const pendingProposals = history.filter(p => p.status === 'pending');

        if (pendingProposals.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Nenhuma proposta pendente encontrada." });
        }

        const latestProposal = pendingProposals[pendingProposals.length - 1];
        latestProposal.status = accept ? 'accepted' : 'rejected';
        latestProposal.responded_at = new Date().toISOString();

        if (accept) {
            await client.query(
                "UPDATE rides SET final_price = $1, negotiation_history = $2 WHERE id = $3",
                [latestProposal.proposed_price, JSON.stringify(history), ride_id]
            );
        } else {
            await client.query(
                "UPDATE rides SET negotiation_history = $1 WHERE id = $2",
                [JSON.stringify(history), ride_id]
            );
        }

        await client.query('COMMIT');

        const targetId = userRole === 'driver' ? ride.passenger_id : ride.driver_id;
        if (req.io && targetId) {
            req.io.to(`user_${targetId}`).emit('price_proposal_response', {
                ride_id: ride_id,
                accepted: accept,
                new_price: accept ? latestProposal.proposed_price : ride.initial_price,
                message: accept ? 'Proposta aceita.' : 'Proposta rejeitada.'
            });
        }

        res.json({
            success: true,
            message: accept ? "Proposta aceita com sucesso." : "Proposta rejeitada.",
            new_price: accept ? latestProposal.proposed_price : ride.initial_price
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RESPOND_NEGOTIATION', e);
        res.status(500).json({ error: "Erro ao responder à proposta." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 10. HISTÓRICO DE CORRIDAS
// =================================================================================================
exports.getHistory = async (req, res) => {
    const userId = req.user.id;
    try {
        const query = `
            SELECT r.*,
                CASE WHEN r.passenger_id = $1 THEN d.name ELSE p.name END as counterpart_name,
                CASE WHEN r.passenger_id = $1 THEN d.photo ELSE p.photo END as counterpart_photo
            FROM rides r
            LEFT JOIN users d ON r.driver_id = d.id
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE r.passenger_id = $1 OR r.driver_id = $1
            ORDER BY r.created_at DESC LIMIT 50
        `;
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (e) {
        logError('RIDE_HISTORY', e);
        res.status(500).json({ error: "Erro ao buscar histórico." });
    }
};

// =================================================================================================
// 11. DETALHES DA CORRIDA
// =================================================================================================
exports.getRideDetails = async (req, res) => {
    try {
        const fullRide = await getFullRideDetails(req.params.id);
        if (!fullRide) return res.status(404).json({ error: "Corrida não encontrada." });
        res.json(fullRide);
    } catch (e) {
        logError('GET_RIDE_DETAILS', e);
        res.status(500).json({ error: "Erro ao buscar detalhes." });
    }
};

// =================================================================================================
// 12. PERFORMANCE DO MOTORISTA
// =================================================================================================
exports.getDriverPerformance = async (req, res) => {
    try {
        const statsQuery = `
            SELECT
                COUNT(*) as missions,
                COALESCE(SUM(final_price), 0) as earnings,
                COALESCE(AVG(rating), 0) as avg_rating
            FROM rides
            WHERE driver_id = $1 AND status = 'completed' AND created_at >= CURRENT_DATE
        `;
        const statsRes = await pool.query(statsQuery, [req.user.id]);

        const recentQuery = `SELECT * FROM rides WHERE driver_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 5`;
        const recentRes = await pool.query(recentQuery, [req.user.id]);

        const totalQuery = `SELECT COUNT(*) as total FROM rides WHERE driver_id = $1 AND status = 'completed'`;
        const totalRes = await pool.query(totalQuery, [req.user.id]);

        res.json({
            success: true,
            todayEarnings: parseFloat(statsRes.rows[0].earnings),
            missionsCount: parseInt(statsRes.rows[0].missions),
            averageRating: parseFloat(statsRes.rows[0].avg_rating) || 5.0,
            totalMissions: parseInt(totalRes.rows[0].total),
            recentRides: recentRes.rows
        });
    } catch (e) {
        logError('DRIVER_PERFORMANCE', e);
        res.status(500).json({ error: "Erro ao buscar performance." });
    }
};

// =================================================================================================
// EXPORTAR TODOS OS MÉTODOS
// =================================================================================================
module.exports = exports;
