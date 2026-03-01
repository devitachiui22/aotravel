/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE LIFECYCLE CONTROLLER (TITANIUM KYC & MATCHING)
 * =================================================================================================
 * STATUS: 🔥 PRODUCTION READY - 100% BLINDADO - ZERO ERROS DE PREÇO/CATEGORIA
 * =================================================================================================
 */

const pool = require('../config/db');
const { getDistance, logError, logSystem, getFullRideDetails, generateRef } = require('../utils/helpers');

// =================================================================================================
// 1. SOLICITAÇÃO DE CORRIDA (PREÇO ÚNICO E MATCHING EXATO)
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
    const rideType = body.ride_type || 'car'; // car | moto | delivery_car | delivery_moto
    const distance = parseFloat(body.distance_km) || 0;

    console.log('\n🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
    console.log('🚕 [REQUEST_RIDE] INICIANDO SOLICITAÇÃO');
    console.log(`   Request ID: ${requestId}`);
    console.log(`   Passageiro ID: ${passengerId}`);
    console.log(`   Origem: (${originLat}, ${originLng})`);
    console.log(`   Destino: (${destLat}, ${destLng})`);
    console.log(`   Distância: ${distance}km`);
    console.log(`   Tipo: ${rideType}`);
    console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴\n');

    if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({
            error: "Coordenadas incompletas.",
            code: "INVALID_COORDINATES"
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // ✅ MATEMÁTICA IDÊNTICA AO FRONTEND
        let estimatedPrice = 0;
        if (rideType === 'moto') {
            estimatedPrice = 400 + (distance * 180);
        } else if (rideType === 'delivery_car') {
            estimatedPrice = 1000 + (distance * 450);
        } else if (rideType === 'delivery_moto') {
            estimatedPrice = 800 + (distance * 300);
        } else {
            estimatedPrice = 600 + (distance * 300); // car
        }

        estimatedPrice = Math.ceil(estimatedPrice / 50) * 50;
        if (estimatedPrice < 500) estimatedPrice = 500;

        console.log(`💰 PREÇO FIXADO: ${estimatedPrice} Kz | Tipo: ${rideType}`);

        const insertQuery = `
            INSERT INTO rides (
                passenger_id,
                origin_lat,
                origin_lng,
                dest_lat,
                dest_lng,
                origin_name,
                dest_name,
                initial_price,
                final_price,
                ride_type,
                distance_km,
                status,
                created_at,
                updated_at
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
                request_id: requestId
            });
            console.log(`📡 Notificação enviada ao passageiro ${passengerId}`);
        }

        // Passar rideType exato para o buscador
        let drivers = await exports.findAvailableDrivers(originLat, originLng, 10, { rideType });
        if (drivers.length === 0) {
            console.log(`⚠️ Nenhum motorista encontrado no raio de 10km, expandindo para 20km...`);
            drivers = await exports.findAvailableDrivers(originLat, originLng, 20, { includeGpsZero: true, rideType });
        }

        console.log(`👥 Motoristas verificados e encontrados: ${drivers.length}`);

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
                    console.log(`   📡 Notificado motorista ${driver.driver_id} via socket_id (distância: ${distanceToPickup.toFixed(1)}km)`);
                } else if (driver.driver_id && req.io) {
                    req.io.to(`driver_${driver.driver_id}`).emit('ride_opportunity', driverPayload);
                    driversNotified++;
                    console.log(`   📡 Notificado motorista ${driver.driver_id} via driver_room (distância: ${distanceToPickup.toFixed(1)}km)`);
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
            console.log(`⚠️ Nenhum motorista notificado para a corrida #${ride.id}`);
        }

        console.log(`📡 Dispatch concluído. ${driversNotified} motoristas notificados em ${Date.now() - startTime}ms.`);

        res.status(201).json({
            success: true,
            message: driversNotified > 0 ? "Solicitação enviada aos motoristas." : "Aguardando motoristas...",
            ride: {
                id: ride.id,
                initial_price: estimatedPrice,
                ride_type: rideType,
                distance_km: distance,
                status: 'searching'
            },
            dispatch_stats: {
                drivers_notified: driversNotified,
                request_id: requestId
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERRO FATAL NO REQUEST_RIDE:', e);
        console.error('❌ STACK:', e.stack);
        logError('RIDE_REQUEST_FATAL', e);
        res.status(500).json({
            error: "Erro crítico ao processar solicitação.",
            request_id: requestId
        });
    } finally {
        client.release();
        console.log(`🔌 Conexão com banco liberada (Request ID: ${requestId})`);
    }
};

// =================================================================================================
// 2. BUSCA DE MOTORISTAS BLINDADA POR VEÍCULO
// =================================================================================================
exports.findAvailableDrivers = async (lat, lng, radiusKm = 10, options = {}) => {
    const { includeGpsZero = false, rideType = 'car' } = options;

    // ✅ MAPEAR SERVIÇO -> VEÍCULO NECESSÁRIO
    let requiredVehicleType = 'car';
    if (rideType === 'moto' || rideType === 'delivery_moto') requiredVehicleType = 'moto';
    if (rideType === 'car' || rideType === 'delivery_car') requiredVehicleType = 'car';

    console.log(`🔍 Buscando motoristas para tipo: ${rideType} (veículo: ${requiredVehicleType})`);

    const query = `
        SELECT
            dp.driver_id,
            dp.lat,
            dp.lng,
            dp.socket_id,
            dp.status,
            u.name,
            u.rating,
            u.is_blocked,
            u.vehicle_details
        FROM driver_positions dp
        JOIN users u ON dp.driver_id = u.id
        WHERE dp.status = 'online'
          AND dp.last_update > NOW() - INTERVAL '3 minutes'
          AND u.is_blocked = false
          AND u.is_verified = true
          AND u.role = 'driver'
          AND COALESCE(u.vehicle_details->>'type', 'car') = $4
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
        const result = await pool.query(query, [lat, lng, radiusKm, requiredVehicleType]);
        console.log(`✅ Encontrados ${result.rows.length} motoristas do tipo ${requiredVehicleType}`);

        // Log detalhado dos motoristas encontrados
        result.rows.forEach((driver, index) => {
            if (driver.lat && driver.lng && driver.lat !== 0 && driver.lng !== 0) {
                const dist = getDistance(lat, lng, parseFloat(driver.lat), parseFloat(driver.lng));
                console.log(`   ${index + 1}. Motorista ${driver.driver_id} - Distância: ${dist.toFixed(1)}km - Rating: ${driver.rating || 'N/A'}`);
            } else {
                console.log(`   ${index + 1}. Motorista ${driver.driver_id} - GPS: 0,0 (incluído por includeGpsZero)`);
            }
        });

        return result.rows;
    } catch (e) {
        logError('FIND_DRIVERS', e);
        return [];
    }
};

// =================================================================================================
// 3. ACEITAR CORRIDA
// =================================================================================================
exports.acceptRide = async (req, res) => {
    const { ride_id, driver_id } = req.body;
    const actualDriverId = driver_id || req.user?.id;

    console.log('\n🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
    console.log('🚗 [ACCEPT_RIDE] INICIANDO PROCESSO DE ACEITAÇÃO');
    console.log('📦 BODY RECEBIDO:', req.body);
    console.log('👤 USUÁRIO:', req.user);
    console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴\n');

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
        await client.query('BEGIN');

        console.log('🔍 Verificando se o motorista existe e está verificado (KYC)...');
        const driverCheck = await client.query(
            "SELECT id, name, is_verified, vehicle_details, email, phone FROM users WHERE id = $1",
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

        if (!driverCheck.rows[0].is_verified) {
            console.log(`❌ ERRO: Motorista ID ${actualDriverId} não está verificado (KYC pendente)`);
            await client.release();
            return res.status(403).json({
                success: false,
                error: "Sua conta ainda não foi aprovada. Complete seu cadastro e aguarde verificação."
            });
        }

        console.log(`✅ Motorista encontrado e verificado: ${driverCheck.rows[0].name} (ID: ${actualDriverId})`);

        console.log(`🔍 Buscando corrida #${ride_id} com FOR UPDATE...`);
        const rideRes = await client.query(
            "SELECT id, status, passenger_id, initial_price, ride_type, origin_name, dest_name, distance_km FROM rides WHERE id = $1 FOR UPDATE",
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

        // Validar tipo do veículo na aceitação final
        const vType = driverCheck.rows[0].vehicle_details?.type || 'car';
        let reqType = 'car';
        if (ride.ride_type === 'moto' || ride.ride_type === 'delivery_moto') reqType = 'moto';

        console.log(`🔍 Verificando compatibilidade de veículo: Motorista ${vType} vs Corrida ${reqType}`);

        if (vType !== reqType) {
            console.log(`❌ ERRO: Tipo de veículo incompatível. Motorista: ${vType}, Necessário: ${reqType}`);
            await client.release();
            return res.status(400).json({
                success: false,
                error: `Seu veículo (${vType}) não é compatível com este tipo de corrida (${ride.ride_type}).`
            });
        }

        console.log('✅ Validações OK. Atualizando corrida...');

        await client.query(
            "UPDATE rides SET driver_id = $1, status = 'accepted', accepted_at = NOW(), updated_at = NOW() WHERE id = $2",
            [actualDriverId, ride_id]
        );

        console.log('✅ Corrida atualizada. Buscando dados completos...');

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
            price: fullRide.initial_price,
            ride_type: fullRide.ride_type
        });

        if (req.io) {
            console.log('📡 Enviando eventos socket...');

            req.io.to(`user_${ride.passenger_id}`).emit('ride_accepted', fullRide);
            console.log(`   ✅ Evento enviado para passageiro user_${ride.passenger_id}`);

            req.io.to(`user_${actualDriverId}`).emit('ride_accepted', fullRide);
            console.log(`   ✅ Evento enviado para motorista user_${actualDriverId}`);

            req.io.to(`ride_${ride_id}`).emit('ride_accepted', fullRide);
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
            details: process.env.NODE_ENV === 'development' ? e.message : undefined
        });
    } finally {
        await client.release();
        console.log('🔌 Conexão com banco liberada');
    }
};

// =================================================================================================
// 4. ATUALIZAR STATUS DA CORRIDA
// =================================================================================================
exports.updateStatus = async (req, res) => {
    const { ride_id, status } = req.body;
    const driverId = req.user.id;
    const allowed = ['arrived', 'ongoing', 'accepted'];

    console.log(`🔄 [UPDATE_STATUS] Ride: ${ride_id}, Status: ${status}, Driver: ${driverId}`);

    if (!allowed.includes(status)) {
        console.log(`❌ ERRO: Status inválido: ${status}`);
        return res.status(400).json({ error: "Status inválido." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        console.log(`🔍 Verificando permissões para corrida #${ride_id}...`);
        const check = await client.query(
            "SELECT driver_id, passenger_id FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (check.rows.length === 0) {
            console.log(`❌ ERRO: Corrida #${ride_id} não encontrada`);
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        if (check.rows[0].driver_id !== driverId) {
            console.log(`❌ ERRO: Motorista ${driverId} não é o responsável pela corrida`);
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Acesso negado." });
        }

        console.log(`✅ Permissão OK. Atualizando status para ${status}...`);

        let updateQuery = `UPDATE rides SET status = $1`;
        if (status === 'arrived') updateQuery += `, arrived_at = NOW()`;
        if (status === 'ongoing') updateQuery += `, started_at = NOW()`;
        updateQuery += `, updated_at = NOW() WHERE id = $2 RETURNING *`;

        const updateResult = await client.query(updateQuery, [status, ride_id]);
        console.log(`✅ Status atualizado para ${status}`);

        await client.query('COMMIT');

        const fullRide = await getFullRideDetails(ride_id);

        if (req.io) {
            const eventName = status === 'arrived' ? 'driver_arrived' : 'trip_started';
            console.log(`📡 Emitindo evento ${eventName}...`);

            req.io.to(`ride_${ride_id}`).emit(eventName, fullRide);
            req.io.to(`user_${fullRide.passenger_id}`).emit(eventName, fullRide);

            console.log(`   ✅ Evento enviado para passageiro user_${fullRide.passenger_id}`);
        }

        res.json({
            success: true,
            status: status,
            ride: fullRide
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERRO AO ATUALIZAR STATUS:', e);
        logError('RIDE_STATUS_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar status." });
    } finally {
        client.release();
        console.log('🔌 Conexão com banco liberada');
    }
};

// =================================================================================================
// 5. INICIAR CORRIDA
// =================================================================================================
exports.startRide = async (req, res) => {
    console.log('🚀 [START_RIDE] Iniciando corrida...');
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

    console.log('\n✅ [COMPLETE_RIDE] INICIANDO FINALIZAÇÃO');
    console.log(`   Ride: ${ride_id}`);
    console.log(`   Method: ${method}`);
    console.log(`   Final Price: ${final_price}`);
    console.log(`   Distance Traveled: ${distance_traveled}`);
    console.log('----------------------------------------\n');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        console.log(`🔍 Buscando corrida #${ride_id}...`);
        const rideCheck = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (rideCheck.rows.length === 0) {
            console.log(`❌ ERRO: Corrida #${ride_id} não encontrada`);
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideCheck.rows[0];
        console.log(`📊 Dados da corrida:`, {
            id: ride.id,
            status: ride.status,
            driver_id: ride.driver_id,
            passenger_id: ride.passenger_id,
            initial_price: ride.initial_price
        });

        if (ride.driver_id !== driverId) {
            console.log(`❌ ERRO: Motorista ${driverId} não é o responsável`);
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Acesso negado." });
        }

        if (ride.status !== 'ongoing' && ride.status !== 'accepted') {
            console.log(`❌ ERRO: Status inválido para finalização: ${ride.status}`);
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Status inválido para finalização." });
        }

        const finalAmount = parseFloat(final_price || ride.final_price || ride.initial_price);
        console.log(`💰 Valor final: ${finalAmount} Kz`);

        // LÓGICA FINANCEIRA INTEGRADA
        if (method === 'wallet') {
            console.log(`💳 Processando pagamento via carteira...`);

            // Verifica saldo do passageiro
            const paxRes = await client.query(
                "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
                [ride.passenger_id]
            );
            const paxBalance = parseFloat(paxRes.rows[0]?.balance || 0);

            console.log(`   Saldo do passageiro: ${paxBalance} Kz`);

            if (paxBalance < finalAmount) {
                console.log(`❌ ERRO: Saldo insuficiente. Necessário: ${finalAmount}, Disponível: ${paxBalance}`);
                await client.query('ROLLBACK');
                return res.status(402).json({
                    error: "Saldo insuficiente na carteira do passageiro.",
                    code: "INSUFFICIENT_FUNDS"
                });
            }

            // Transferência Atômica
            await client.query(
                "UPDATE users SET balance = balance - $1 WHERE id = $2",
                [finalAmount, ride.passenger_id]
            );
            await client.query(
                "UPDATE users SET balance = balance + $1 WHERE id = $2",
                [finalAmount, driverId]
            );

            const txRef = generateRef('RIDE');

            // Log Débito Pax
            await client.query(
                `INSERT INTO wallet_transactions (
                    reference_id, user_id, amount, type, method, status,
                    description, category, ride_id, created_at
                ) VALUES ($1, $2, $3, 'payment', 'wallet', 'completed', $4, 'ride', $5, NOW())`,
                [txRef, ride.passenger_id, -finalAmount, `Pagamento da corrida #${ride_id}`, ride_id]
            );

            // Log Crédito Motorista
            await client.query(
                `INSERT INTO wallet_transactions (
                    reference_id, user_id, amount, type, method, status,
                    description, category, ride_id, created_at
                ) VALUES ($1, $2, $3, 'earnings', 'wallet', 'completed', $4, 'ride', $5, NOW())`,
                [txRef, driverId, finalAmount, `Ganhos da corrida #${ride_id}`, ride_id]
            );

            console.log(`✅ Transação wallet concluída. Referência: ${txRef}`);

        } else {
            console.log(`💰 Processando pagamento em dinheiro...`);

            // Apenas registra o ganho em dinheiro
            const txRef = generateRef('CASH');
            await client.query(
                `INSERT INTO wallet_transactions (
                    reference_id, user_id, amount, type, method, status,
                    description, category, metadata, ride_id, created_at
                ) VALUES ($1, $2, $3, 'earnings', 'cash', 'completed', $4, 'ride', $5, $6, NOW())`,
                [txRef, driverId, finalAmount, `Ganhos da corrida #${ride_id} (Dinheiro)`, '{"is_cash": true}', ride_id]
            );

            console.log(`✅ Transação cash registrada. Referência: ${txRef}`);
        }

        // ATUALIZA A CORRIDA
        console.log(`📝 Atualizando status da corrida para 'completed'...`);

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
        console.log(`✅ Corrida #${ride_id} finalizada com sucesso`);

        const fullRide = await getFullRideDetails(ride_id);

        // NOTIFICAÇÕES SOCKET
        if (req.io) {
            console.log(`📡 Enviando notificações de finalização...`);

            req.io.to(`ride_${ride_id}`).emit('ride_completed', fullRide);
            req.io.to(`user_${ride.passenger_id}`).emit('ride_completed', fullRide);

            console.log(`   ✅ Notificações enviadas para ride_${ride_id} e user_${ride.passenger_id}`);

            if (method === 'wallet') {
                // Dispara trigger para o app atualizar saldo da UI
                req.io.to(`user_${ride.passenger_id}`).emit('wallet_update', {
                    type: 'payment',
                    amount: finalAmount
                });
                req.io.to(`user_${driverId}`).emit('wallet_update', {
                    type: 'earnings',
                    amount: finalAmount
                });
                console.log(`   ✅ Atualizações de wallet enviadas`);
            }
        }

        res.json({
            success: true,
            message: "Corrida finalizada com sucesso!",
            ride: fullRide
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERRO FATAL NO COMPLETE_RIDE:', e);
        console.error('❌ STACK:', e.stack);
        logError('RIDE_COMPLETE_FATAL', e);
        res.status(500).json({
            error: "Erro crítico ao finalizar corrida.",
            details: process.env.NODE_ENV === 'development' ? e.message : undefined
        });
    } finally {
        client.release();
        console.log('🔌 Conexão com banco liberada');
    }
};

// =================================================================================================
// 7. CANCELAR CORRIDA
// =================================================================================================
exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;
    const userId = req.user.id;
    const role = req.user.role;

    console.log('\n🚫 [CANCEL_RIDE] INICIANDO CANCELAMENTO');
    console.log(`   Ride: ${ride_id}`);
    console.log(`   Reason: ${reason}`);
    console.log(`   Role: ${role}`);
    console.log('----------------------------------------\n');

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        console.log(`🔍 Buscando corrida #${ride_id}...`);
        const check = await client.query(
            "SELECT * FROM rides WHERE id = $1 FOR UPDATE",
            [ride_id]
        );

        if (check.rows.length === 0) {
            console.log(`❌ ERRO: Corrida #${ride_id} não encontrada`);
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = check.rows[0];
        console.log(`📊 Status atual da corrida: ${ride.status}`);

        if (!['searching', 'accepted', 'ongoing'].includes(ride.status)) {
            console.log(`❌ ERRO: Corrida já finalizada. Status: ${ride.status}`);
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Corrida já finalizada." });
        }

        if (ride.passenger_id !== userId && ride.driver_id !== userId && role !== 'admin') {
            console.log(`❌ ERRO: Usuário ${userId} não tem permissão para cancelar esta corrida`);
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Acesso negado." });
        }

        console.log(`✅ Permissão OK. Atualizando status para 'cancelled'...`);

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
        console.log(`✅ Corrida #${ride_id} cancelada com sucesso`);

        const fullRide = await getFullRideDetails(ride_id);

        if (req.io) {
            console.log(`📡 Enviando notificações de cancelamento...`);

            const payload = { ...fullRide, reason: reason, cancelled_by: role };

            req.io.to(`ride_${ride_id}`).emit('ride_cancelled', payload);
            console.log(`   ✅ Notificação enviada para ride_${ride_id}`);

            if (role === 'driver') {
                req.io.to(`user_${ride.passenger_id}`).emit('ride_cancelled', payload);
                console.log(`   ✅ Notificação enviada para passageiro user_${ride.passenger_id}`);
            }

            if (role === 'passenger' && ride.driver_id) {
                req.io.to(`user_${ride.driver_id}`).emit('ride_cancelled', payload);
                console.log(`   ✅ Notificação enviada para motorista user_${ride.driver_id}`);
            }

            if (ride.status === 'searching') {
                req.io.to('drivers').emit('ride_cancelled_by_passenger', {
                    ride_id: ride_id,
                    reason: reason
                });
                console.log(`   ✅ Aviso enviado para todos os motoristas (radar)`);
            }
        }

        res.json({
            success: true,
            message: "Corrida cancelada com sucesso."
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERRO AO CANCELAR CORRIDA:', e);
        logError('RIDE_CANCEL', e);
        res.status(500).json({ error: "Erro ao cancelar corrida." });
    } finally {
        client.release();
        console.log('🔌 Conexão com banco liberada');
    }
};

// =================================================================================================
// 8. HISTÓRICO DE CORRIDAS
// =================================================================================================
exports.getHistory = async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    console.log(`📜 [GET_HISTORY] Buscando histórico para usuário ${userId}, página ${page}`);

    try {
        const countQuery = `
            SELECT COUNT(*) as total
            FROM rides
            WHERE passenger_id = $1 OR driver_id = $1
        `;
        const countResult = await pool.query(countQuery, [userId]);
        const total = parseInt(countResult.rows[0].total);

        const query = `
            SELECT
                r.*,
                CASE WHEN r.passenger_id = $1 THEN d.name ELSE p.name END as counterpart_name,
                CASE WHEN r.passenger_id = $1 THEN d.photo ELSE p.photo END as counterpart_photo,
                CASE WHEN r.passenger_id = $1 THEN d.rating ELSE p.rating END as counterpart_rating
            FROM rides r
            LEFT JOIN users d ON r.driver_id = d.id
            LEFT JOIN users p ON r.passenger_id = p.id
            WHERE r.passenger_id = $1 OR r.driver_id = $1
            ORDER BY r.created_at DESC
            LIMIT $2 OFFSET $3
        `;

        const result = await pool.query(query, [userId, limit, offset]);

        console.log(`✅ Encontradas ${result.rows.length} corridas (total: ${total})`);

        res.json({
            success: true,
            rides: result.rows,
            pagination: {
                page: page,
                limit: limit,
                total: total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (e) {
        console.error('❌ ERRO AO BUSCAR HISTÓRICO:', e);
        logError('RIDE_HISTORY', e);
        res.status(500).json({
            success: false,
            error: "Erro ao buscar histórico."
        });
    }
};

// =================================================================================================
// 9. DETALHES DA CORRIDA
// =================================================================================================
exports.getRideDetails = async (req, res) => {
    const rideId = req.params.id;
    const userId = req.user.id;

    console.log(`🔍 [GET_RIDE_DETAILS] Buscando detalhes da corrida ${rideId}`);

    try {
        const fullRide = await getFullRideDetails(rideId);

        if (!fullRide) {
            console.log(`❌ Corrida ${rideId} não encontrada`);
            return res.status(404).json({
                success: false,
                error: "Corrida não encontrada."
            });
        }

        // Verificar se o usuário tem permissão para ver esta corrida
        if (fullRide.passenger_id !== userId && fullRide.driver_id !== userId && req.user.role !== 'admin') {
            console.log(`❌ Usuário ${userId} não tem permissão para ver corrida ${rideId}`);
            return res.status(403).json({
                success: false,
                error: "Acesso negado."
            });
        }

        console.log(`✅ Detalhes da corrida ${rideId} recuperados com sucesso`);

        res.json({
            success: true,
            ride: fullRide
        });

    } catch (e) {
        console.error('❌ ERRO AO BUSCAR DETALHES:', e);
        logError('GET_RIDE_DETAILS', e);
        res.status(500).json({
            success: false,
            error: "Erro ao buscar detalhes da corrida."
        });
    }
};

// =================================================================================================
// 10. PERFORMANCE DO MOTORISTA
// =================================================================================================
exports.getDriverPerformance = async (req, res) => {
    const driverId = req.user.id;

    console.log(`📊 [GET_DRIVER_PERFORMANCE] Buscando performance do motorista ${driverId}`);

    try {
        // Estatísticas do dia
        const statsQuery = `
            SELECT
                COUNT(*) as missions,
                COALESCE(SUM(final_price), 0) as earnings,
                COALESCE(AVG(rating), 0) as avg_rating
            FROM rides
            WHERE driver_id = $1
              AND status = 'completed'
              AND created_at >= CURRENT_DATE
        `;
        const statsRes = await pool.query(statsQuery, [driverId]);

        // Corridas recentes
        const recentQuery = `
            SELECT
                id,
                created_at,
                origin_name,
                dest_name,
                final_price,
                rating,
                passenger_id
            FROM rides
            WHERE driver_id = $1 AND status = 'completed'
            ORDER BY created_at DESC
            LIMIT 5
        `;
        const recentRes = await pool.query(recentQuery, [driverId]);

        // Total de missões
        const totalQuery = `
            SELECT COUNT(*) as total
            FROM rides
            WHERE driver_id = $1 AND status = 'completed'
        `;
        const totalRes = await pool.query(totalQuery, [driverId]);

        // Rating médio geral
        const ratingQuery = `
            SELECT COALESCE(AVG(rating), 0) as overall_rating
            FROM rides
            WHERE driver_id = $1 AND status = 'completed' AND rating IS NOT NULL
        `;
        const ratingRes = await pool.query(ratingQuery, [driverId]);

        console.log(`✅ Performance recuperada:`, {
            todayMissions: parseInt(statsRes.rows[0].missions),
            todayEarnings: parseFloat(statsRes.rows[0].earnings),
            totalMissions: parseInt(totalRes.rows[0].total)
        });

        res.json({
            success: true,
            todayEarnings: parseFloat(statsRes.rows[0].earnings),
            missionsCount: parseInt(statsRes.rows[0].missions),
            averageRating: parseFloat(statsRes.rows[0].avg_rating) || 5.0,
            overallRating: parseFloat(ratingRes.rows[0].overall_rating) || 5.0,
            totalMissions: parseInt(totalRes.rows[0].total),
            recentRides: recentRes.rows.map(ride => ({
                ...ride,
                final_price: parseFloat(ride.final_price)
            }))
        });

    } catch (e) {
        console.error('❌ ERRO AO BUSCAR PERFORMANCE:', e);
        logError('DRIVER_PERFORMANCE', e);
        res.status(500).json({
            success: false,
            error: "Erro ao buscar performance do motorista."
        });
    }
};

// =================================================================================================
// EXPORTAR TODOS OS MÉTODOS
// =================================================================================================
module.exports = exports;
