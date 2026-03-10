/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE CONTROLLER (MATCHING & LIFECYCLE v13.0)
 * =================================================================================================
 * STATUS: 🔥 PRODUCTION READY - CLEAN ARCHITECTURE APLICADA
 * ✅ FIX RACE CONDITION E CATEGORIAS (Premium, Standard, Moto)
 * ✅ CORREÇÃO CRÍTICA: getActiveRide agora filtra apenas status ativos e com limite de 12h
 * ✅ OMNI-MODULE COMPLETE RIDE: Suporte para finalizar corridas, entregas, agendamentos e grupos
 * =================================================================================================
 */

const pool = require('../config/db');
const { getDistance, logError, logSystem, getFullRideDetails, generateRef } = require('../utils/helpers');
const walletService = require('../services/walletService');

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
    const distance = parseFloat(body.distance_km) || 0;

    // Normalização estrita do tipo
    let rideType = (body.ride_type || 'car').toLowerCase();
    if (rideType === 'standard' || rideType === 'ride') rideType = 'car';
    if (rideType === 'comfort' || rideType === 'lux') rideType = 'premium';
    if (rideType === 'delivery_car') rideType = 'delivery_car';
    if (rideType === 'delivery_moto') rideType = 'delivery_moto';

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
        } else if (rideType === 'premium') {
            estimatedPrice = 1200 + (distance * 500); // Tabela Premium
        } else if (rideType === 'delivery_car') {
            estimatedPrice = 1000 + (distance * 450);
        } else if (rideType === 'delivery_moto') {
            estimatedPrice = 800 + (distance * 300);
        } else {
            estimatedPrice = 600 + (distance * 300); // Standard Car
        }

        estimatedPrice = Math.ceil(estimatedPrice / 50) * 50;
        if (rideType === 'car' && estimatedPrice < 600) estimatedPrice = 600;
        if (rideType === 'moto' && estimatedPrice < 400) estimatedPrice = 400;
        if (rideType === 'premium' && estimatedPrice < 1200) estimatedPrice = 1200;
        if (rideType === 'delivery_car' && estimatedPrice < 1000) estimatedPrice = 1000;
        if (rideType === 'delivery_moto' && estimatedPrice < 800) estimatedPrice = 800;

        console.log(`💰 PREÇO FIXADO: ${estimatedPrice} Kz | Tipo: ${rideType}`);

        const insertQuery = `
            INSERT INTO rides (
                passenger_id, origin_lat, origin_lng, dest_lat, dest_lng,
                origin_name, dest_name, initial_price, final_price,
                ride_type, distance_km, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, 'searching', NOW(), NOW())
            RETURNING id, created_at
        `;

        const result = await client.query(insertQuery, [
            passengerId, originLat, originLng, destLat, destLng,
            body.origin_name || 'Origem', body.dest_name || 'Destino',
            estimatedPrice, rideType, distance
        ]);

        const ride = result.rows[0];
        await client.query('COMMIT');

        console.log(`✅ CORRIDA #${ride.id} CRIADA - Preço: ${estimatedPrice} Kz`);

        // Notifica o passageiro via socket que a busca começou
        if (req.io) {
            req.io.to(`user_${passengerId}`).emit('ride_requested', {
                ride_id: ride.id, status: 'searching', price: estimatedPrice,
                request_id: requestId
            });
            console.log(`📡 Notificação enviada ao passageiro ${passengerId}`);
        }

        // Buscar motoristas qualificados
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
            origin_lat: originLat, origin_lng: originLng, origin_name: body.origin_name,
            dest_lat: destLat, dest_lng: destLng, dest_name: body.dest_name,
            initial_price: estimatedPrice, final_price: estimatedPrice,
            distance_km: distance, ride_type: rideType,
            status: 'searching', timestamp: new Date().toISOString()
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
                ride_id: ride.id, message: 'Nenhum motorista disponível no momento.'
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
// 2. BUSCA DE MOTORISTAS BLINDADA POR CATEGORIA E VEÍCULO
// =================================================================================================
exports.findAvailableDrivers = async (lat, lng, radiusKm = 10, options = {}) => {
    const { includeGpsZero = false, rideType = 'car' } = options;

    // ✅ LÓGICA DE MATCHING VIP
    // Se o passageiro pediu PREMIUM -> Somente Premium
    // Se o passageiro pediu CAR (Standard) -> Premium E Car aceitam
    // Se o passageiro pediu MOTO -> Somente Moto
    // Se for delivery_car -> Aceita car e premium
    // Se for delivery_moto -> Aceita moto

    let categoryCondition = "";
    let vehicleTypeCondition = "";
    let params = [lat, lng, radiusKm];

    if (rideType === 'moto' || rideType === 'delivery_moto') {
        categoryCondition = "AND u.vehicle_category = 'moto'";
        vehicleTypeCondition = "AND u.vehicle_details->>'type' = 'moto'";
    } else if (rideType === 'premium') {
        categoryCondition = "AND u.vehicle_category = 'premium'";
        vehicleTypeCondition = "AND u.vehicle_details->>'type' IN ('premium', 'car')";
    } else if (rideType === 'delivery_car') {
        categoryCondition = "AND u.vehicle_category IN ('car', 'premium')";
        vehicleTypeCondition = "AND u.vehicle_details->>'type' IN ('car', 'premium')";
    } else {
        // Standard 'car'
        categoryCondition = "AND u.vehicle_category IN ('car', 'premium')";
        vehicleTypeCondition = "AND u.vehicle_details->>'type' IN ('car', 'premium')";
    }

    const query = `
        SELECT
            dp.driver_id,
            dp.lat,
            dp.lng,
            dp.socket_id,
            dp.status,
            u.name,
            u.rating,
            u.vehicle_category,
            u.vehicle_details
        FROM driver_positions dp
        JOIN users u ON dp.driver_id = u.id
        WHERE dp.status = 'online'
          AND dp.last_update > NOW() - INTERVAL '3 minutes'
          AND u.is_blocked = false
          AND u.is_verified = true
          AND u.role = 'driver'
          ${categoryCondition}
          ${vehicleTypeCondition}
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
        const result = await pool.query(query, params);

        console.log(`🔍 Buscando motoristas para tipo: ${rideType}`);
        console.log(`✅ Encontrados ${result.rows.length} motoristas qualificados`);

        result.rows.forEach((driver, index) => {
            if (driver.lat && driver.lng && driver.lat !== 0 && driver.lng !== 0) {
                const dist = getDistance(lat, lng, parseFloat(driver.lat), parseFloat(driver.lng));
                console.log(`   ${index + 1}. Motorista ${driver.driver_id} - Distância: ${dist.toFixed(1)}km - Categoria: ${driver.vehicle_category || 'N/A'}`);
            } else {
                console.log(`   ${index + 1}. Motorista ${driver.driver_id} - GPS: 0,0 (incluído por includeGpsZero) - Categoria: ${driver.vehicle_category || 'N/A'}`);
            }
        });

        return result.rows;
    } catch (e) {
        logError('FIND_DRIVERS', e);
        return [];
    }
};

// =================================================================================================
// 3. ACEITAR CORRIDA (HTTP É A SOURCE OF TRUTH - ANTI RACE CONDITION)
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
            "SELECT id, name, is_verified, vehicle_category, vehicle_details, email, phone FROM users WHERE id = $1",
            [actualDriverId]
        );

        if (driverCheck.rows.length === 0) {
            console.log(`❌ ERRO: Motorista ID ${actualDriverId} não encontrado`);
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: "Motorista não encontrado."
            });
        }

        if (!driverCheck.rows[0].is_verified) {
            console.log(`❌ ERRO: Motorista ID ${actualDriverId} não está verificado (KYC pendente)`);
            await client.query('ROLLBACK');
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
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: "Corrida não encontrada."
            });
        }

        const ride = rideRes.rows[0];
        console.log('📊 Dados da corrida:', ride);

        // ✅ PROTEÇÃO CONTRA RACE CONDITION (SÓ ACEITA SE FOR SEARCHING)
        if (ride.status !== 'searching') {
            console.log(`❌ ERRO: Corrida já não está em searching. Status atual: ${ride.status}`);
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: "Esta corrida já foi assumida por outro motorista.",
                code: "RIDE_TAKEN"
            });
        }

        if (ride.passenger_id == actualDriverId) {
            console.log(`❌ ERRO: Motorista tentando aceitar própria corrida`);
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: "Você não pode aceitar sua própria corrida."
            });
        }

        // ✅ VALIDAÇÃO FINAL DE COMPATIBILIDADE VIP
        const vCat = driverCheck.rows[0].vehicle_category || 'car';
        const vDetails = driverCheck.rows[0].vehicle_details || {};
        const vType = vDetails.type || 'car';
        const rType = ride.ride_type || 'car';

        console.log(`🔍 Verificando compatibilidade:`);
        console.log(`   Motorista - Categoria: ${vCat}, Tipo: ${vType}`);
        console.log(`   Corrida - Tipo: ${rType}`);

        // Validação por categoria
        if (rType === 'premium' && vCat !== 'premium') {
            console.log(`❌ ERRO: Apenas motoristas Premium podem aceitar esta corrida.`);
            await client.query('ROLLBACK');
            return res.status(403).json({
                success: false,
                error: "Apenas motoristas Premium podem aceitar esta corrida."
            });
        }

        if (rType === 'moto' && vCat !== 'moto') {
            console.log(`❌ ERRO: Apenas motos podem aceitar esta corrida.`);
            await client.query('ROLLBACK');
            return res.status(403).json({
                success: false,
                error: "Veículo incompatível."
            });
        }

        if (rType === 'delivery_moto' && vCat !== 'moto') {
            console.log(`❌ ERRO: Apenas motos podem aceitar entregas.`);
            await client.query('ROLLBACK');
            return res.status(403).json({
                success: false,
                error: "Veículo incompatível para entrega."
            });
        }

        // Validação por tipo de veículo
        if ((rType === 'moto' || rType === 'delivery_moto') && vType !== 'moto') {
            console.log(`❌ ERRO: Tipo de veículo incompatível para moto.`);
            await client.query('ROLLBACK');
            return res.status(403).json({
                success: false,
                error: "Veículo incompatível."
            });
        }

        console.log('✅ Validações OK. Atualizando corrida...');

        // Atualização da Base de Dados (Source of truth)
        await client.query(
            "UPDATE rides SET driver_id = $1, status = 'accepted', accepted_at = NOW(), updated_at = NOW() WHERE id = $2",
            [actualDriverId, ride_id]
        );

        console.log('✅ Corrida atualizada. Buscando dados completos...');

        const fullRide = await getFullRideDetails(ride_id);

        if (!fullRide) {
            console.log('❌ ERRO: Não foi possível obter os dados completos da corrida');
            await client.query('COMMIT');
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

        // ✅ EMITE SOCKET PARA COLOCAR OS DOIS NO CHAT
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
        client.release();
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
// 6. FINALIZAR MISSÃO (OMNI-MODULE PAYMENT ENGINE)
// =================================================================================================
exports.completeRide = async (req, res) => {
    const { ride_id, payment_method, final_price, distance_traveled, pin, hub_type } = req.body;
    const userId = req.user.id;
    const method = payment_method || 'cash';

    console.log(`\n✅ [COMPLETE_MISSION] Ride: ${ride_id} | Method: ${method} | Hub: ${hub_type || 'Ride'}`);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Resolução Polimórfica de Tabelas
        let table = 'rides';
        let pCol = 'passenger_id';
        let dCol = 'driver_id';
        let statusField = 'status';

        if (hub_type === 'delivery') {
            table = 'hub_deliveries';
            pCol = 'sender_id';
            dCol = 'driver_id';
        } else if (hub_type === 'schedule') {
            table = 'hub_schedules';
            pCol = 'passenger_id';
            dCol = 'driver_id';
        } else if (hub_type === 'group') {
            table = 'hub_groups';
            pCol = 'creator_id';
            dCol = 'driver_id';
        }

        const rideCheck = await client.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [ride_id]);
        if (rideCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            throw new Error("Missão não encontrada.");
        }

        const ride = rideCheck.rows[0];
        const passengerId = ride[pCol];
        const driverId = ride[dCol];

        if (driverId != userId && passengerId != userId) {
            await client.query('ROLLBACK');
            throw new Error("Acesso negado.");
        }

        // Verificar status válido
        const validStatuses = ['ongoing', 'accepted', 'in_transit', 'picked_up'];
        if (!validStatuses.includes(ride.status)) {
            await client.query('ROLLBACK');
            throw new Error("A missão já foi finalizada ou cancelada.");
        }

        // Extrator dinâmico de preço
        let finalAmount = 0;
        if (final_price) {
            finalAmount = parseFloat(final_price);
        } else if (ride.final_price) {
            finalAmount = parseFloat(ride.final_price);
        } else if (ride.price) {
            finalAmount = parseFloat(ride.price);
        } else if (ride.total_fare) {
            finalAmount = parseFloat(ride.total_fare);
        } else if (ride.proposed_price) {
            finalAmount = parseFloat(ride.proposed_price);
        } else if (ride.initial_price) {
            finalAmount = parseFloat(ride.initial_price);
        } else {
            finalAmount = 0;
        }

        // Processamento de Pagamento Clean Architecture
        if (method === 'wallet') {
            if (userId !== passengerId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: "Apenas o passageiro/remetente pode autorizar o débito." });
            }

            await walletService.processRidePayment(
                passengerId,
                driverId,
                finalAmount,
                ride_id,
                pin,
                client
            );
        } else {
            // Pagamento em CASH (Dinheiro)
            if (userId !== driverId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: "O motorista deve confirmar o recebimento em dinheiro." });
            }

            await walletService.processCashRideLog(
                driverId,
                finalAmount,
                ride_id,
                client
            );
        }

        // Atualização de Status baseada no tipo de hub
        let statusVal = 'completed';
        let socketEvent = 'ride_completed';

        if (hub_type === 'delivery') {
            statusVal = 'delivered';
            socketEvent = 'delivery_completed';
        } else if (hub_type === 'schedule') {
            statusVal = 'completed';
            socketEvent = 'schedule_completed';
        } else if (hub_type === 'group') {
            statusVal = 'completed';
            socketEvent = 'group_completed';
        }

        // Atualizar a missão
        let updateFields = `status = '${statusVal}', updated_at = NOW()`;

        if (table === 'rides') {
            updateFields += `, final_price = ${finalAmount}, payment_method = '${method}', payment_status = 'paid', completed_at = NOW()`;
            if (distance_traveled) updateFields += `, distance_km = ${distance_traveled}`;
        } else if (table === 'hub_deliveries') {
            updateFields += `, completed_at = NOW()`;
        } else if (table === 'hub_schedules') {
            updateFields += `, completed_at = NOW()`;
        } else if (table === 'hub_groups') {
            updateFields += `, completed_at = NOW()`;
        }

        await client.query(`UPDATE ${table} SET ${updateFields} WHERE id = $1`, [ride_id]);

        await client.query('COMMIT');

        // Notificações Sockets (Disparo Simultâneo)
        if (req.io) {
            const payload = {
                id: ride_id,
                status: statusVal,
                hub_type: hub_type || 'ride',
                final_price: finalAmount,
                payment_method: method
            };

            req.io.to(`ride_${ride_id}`).emit(socketEvent, payload);
            req.io.to(`user_${passengerId}`).emit(socketEvent, payload);
            req.io.to(`user_${driverId}`).emit(socketEvent, payload);

            if (method === 'wallet') {
                req.io.to(`user_${passengerId}`).emit('wallet_update', { type: 'payment', amount: finalAmount });
                req.io.to(`user_${driverId}`).emit('wallet_update', { type: 'earnings', amount: finalAmount });
            }

            // Atualização específica da UI do Hub
            if (hub_type === 'delivery') {
                req.io.to(`user_${passengerId}`).emit('hub_delivery_update', { id: ride_id, status: 'delivered' });
                req.io.to(`user_${driverId}`).emit('hub_delivery_update', { id: ride_id, status: 'delivered' });
            }
            if (hub_type === 'schedule') {
                req.io.to(`user_${passengerId}`).emit('hub_schedule_update', { id: ride_id, status: 'completed' });
            }
            if (hub_type === 'group') {
                req.io.to(`user_${driverId}`).emit('hub_group_update', { id: ride_id, status: 'completed' });
            }
        }

        res.json({
            success: true,
            message: "Missão concluída com sucesso.",
            data: {
                id: ride_id,
                status: statusVal,
                hub_type: hub_type || 'ride',
                final_price: finalAmount,
                payment_method: method
            }
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERRO NO COMPLETE_RIDE:', e.message);

        if (e.code === 'INSUFFICIENT_FUNDS') {
            return res.status(402).json({ error: e.message, code: e.code });
        }
        if (e.message && e.message.includes('PIN')) {
            return res.status(403).json({ error: e.message });
        }

        res.status(500).json({ error: "Erro crítico ao finalizar a missão." });
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

        const totalQuery = `
            SELECT COUNT(*) as total
            FROM rides
            WHERE driver_id = $1 AND status = 'completed'
        `;
        const totalRes = await pool.query(totalQuery, [driverId]);

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
// 11. SOLICITAR PAGAMENTO VIA WALLET
// =================================================================================================
exports.requestPayment = async (req, res) => {
    const { ride_id, amount } = req.body;
    const driverId = req.user.id;

    console.log(`💰 [REQUEST_PAYMENT] Motorista ${driverId} solicitando pagamento para ride ${ride_id}`);

    try {
        const rideCheck = await pool.query(
            "SELECT passenger_id FROM rides WHERE id = $1 AND driver_id = $2 AND status = 'ongoing'",
            [ride_id, driverId]
        );

        if (rideCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: "Corrida não encontrada ou não autorizada."
            });
        }

        if (req.io) {
            req.io.to(`user_${rideCheck.rows[0].passenger_id}`).emit('payment_requested', {
                ride_id: ride_id,
                driver_id: driverId,
                amount: amount,
                method: 'wallet',
                timestamp: new Date().toISOString()
            });
        }

        res.json({
            success: true,
            message: "Solicitação de pagamento enviada ao passageiro."
        });

    } catch (e) {
        console.error('❌ ERRO AO SOLICITAR PAGAMENTO:', e);
        res.status(500).json({ error: "Erro ao solicitar pagamento." });
    }
};

// =================================================================================================
// 12. PROCESSAR PAGAMENTO WALLET (MÉTODO AUXILIAR)
// =================================================================================================
exports.processWalletPayment = async (req, res) => {
    req.body.payment_method = 'wallet';
    return exports.completeRide(req, res);
};

// =================================================================================================
// 13. CONFIRMAR PAGAMENTO EM DINHEIRO
// =================================================================================================
exports.confirmCashPayment = async (req, res) => {
    req.body.payment_method = 'cash';
    return exports.completeRide(req, res);
};

// =================================================================================================
// 14. AVALIAR CORRIDA
// =================================================================================================
exports.rateRide = async (req, res) => {
    const { ride_id, rating, feedback } = req.body;
    const userId = req.user.id;

    console.log(`⭐ [RATE_RIDE] Usuário ${userId} avaliando ride ${ride_id} com nota ${rating}`);

    try {
        const rideCheck = await pool.query(
            "SELECT * FROM rides WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2)",
            [ride_id, userId]
        );

        if (rideCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: "Corrida não encontrada."
            });
        }

        const role = rideCheck.rows[0].passenger_id === userId ? 'passenger' : 'driver';

        if (role === 'passenger') {
            await pool.query(
                "UPDATE rides SET passenger_rating = $1, passenger_feedback = $2, rated_at = NOW() WHERE id = $3",
                [rating, feedback, ride_id]
            );
        } else {
            await pool.query(
                "UPDATE rides SET driver_rating = $1, driver_feedback = $2, rated_at = NOW() WHERE id = $3",
                [rating, feedback, ride_id]
            );
        }

        res.json({
            success: true,
            message: "Avaliação registrada com sucesso."
        });

    } catch (e) {
        console.error('❌ ERRO AO AVALIAR CORRIDA:', e);
        res.status(500).json({ error: "Erro ao registrar avaliação." });
    }
};

// =================================================================================================
// 15. OBTER CORRIDA ATIVA DO USUÁRIO (BLINDADO CONTRA CORRIDAS FANTASMAS)
// =================================================================================================
exports.getActiveRide = async (req, res) => {
    const userId = req.user.id;

    console.log(`🔍 [GET_ACTIVE_RIDE] Buscando corrida ativa para usuário ${userId}`);

    try {
        // ✅ CORREÇÃO CRÍTICA:
        // 1. Apenas corridas 'accepted', 'arrived' ou 'ongoing'.
        // 2. Limite temporal: Atualizado nas últimas 12 horas. Corridas antigas "presas" são ignoradas.
        const result = await pool.query(`
            SELECT * FROM rides
            WHERE (passenger_id = $1 OR driver_id = $1)
              AND status IN ('accepted', 'arrived', 'ongoing')
              AND updated_at > NOW() - INTERVAL '12 hours'
            ORDER BY updated_at DESC
            LIMIT 1
        `, [userId]);

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                active: false,
                ride: null
            });
        }

        const fullRide = await getFullRideDetails(result.rows[0].id);

        res.json({
            success: true,
            active: true,
            ride: fullRide
        });

    } catch (e) {
        console.error('❌ ERRO AO BUSCAR CORRIDA ATIVA:', e);
        res.status(500).json({ error: "Erro ao buscar corrida ativa." });
    }
};

// =================================================================================================
// 16. OBTER ESTATÍSTICAS DO USUÁRIO
// =================================================================================================
exports.getUserStats = async (req, res) => {
    const userId = req.user.id;

    console.log(`📊 [GET_USER_STATS] Buscando estatísticas para usuário ${userId}`);

    try {
        const passengerStats = await pool.query(`
            SELECT
                COUNT(*) as total_rides,
                COALESCE(AVG(passenger_rating), 0) as avg_rating,
                SUM(final_price) as total_spent
            FROM rides
            WHERE passenger_id = $1 AND status = 'completed'
        `, [userId]);

        const driverStats = await pool.query(`
            SELECT
                COUNT(*) as total_rides,
                COALESCE(AVG(driver_rating), 0) as avg_rating,
                SUM(final_price) as total_earned
            FROM rides
            WHERE driver_id = $1 AND status = 'completed'
        `, [userId]);

        res.json({
            success: true,
            stats: {
                asPassenger: {
                    totalRides: parseInt(passengerStats.rows[0].total_rides),
                    averageRating: parseFloat(passengerStats.rows[0].avg_rating),
                    totalSpent: parseFloat(passengerStats.rows[0].total_spent || 0)
                },
                asDriver: {
                    totalRides: parseInt(driverStats.rows[0].total_rides),
                    averageRating: parseFloat(driverStats.rows[0].avg_rating),
                    totalEarned: parseFloat(driverStats.rows[0].total_earned || 0)
                }
            }
        });

    } catch (e) {
        console.error('❌ ERRO AO BUSCAR ESTATÍSTICAS:', e);
        res.status(500).json({ error: "Erro ao buscar estatísticas." });
    }
};

// =================================================================================================
// 17. OBTER CORRIDAS PRÓXIMAS (PARA MOTORISTAS)
// =================================================================================================
exports.getNearbyRides = async (req, res) => {
    const driverId = req.user.id;
    const { lat, lng, radius = 10 } = req.query;

    console.log(`📍 [GET_NEARBY_RIDES] Motorista ${driverId} buscando corridas num raio de ${radius}km`);

    try {
        const driverInfo = await pool.query(
            "SELECT vehicle_category, vehicle_details->>'type' as vehicle_type FROM users WHERE id = $1",
            [driverId]
        );

        const vehicleCategory = driverInfo.rows[0]?.vehicle_category || 'car';
        const vehicleType = driverInfo.rows[0]?.vehicle_type || 'car';

        let rideTypes = [];
        if (vehicleCategory === 'moto' || vehicleType === 'moto') {
            rideTypes = ['moto', 'delivery_moto'];
        } else {
            rideTypes = ['car', 'premium', 'delivery_car'];
        }

        const query = `
            SELECT
                id,
                passenger_id,
                origin_lat,
                origin_lng,
                origin_name,
                dest_name,
                initial_price,
                ride_type,
                distance_km,
                created_at
            FROM rides
            WHERE status = 'searching'
              AND ride_type = ANY($1::text[])
              AND created_at > NOW() - INTERVAL '30 minutes'
              AND (6371 * acos(cos(radians($2)) * cos(radians(origin_lat)) *
                   cos(radians(origin_lng) - radians($3)) + sin(radians($2)) * sin(radians(origin_lat)))) <= $4
            ORDER BY created_at DESC
        `;

        const result = await pool.query(query, [rideTypes, lat, lng, radius]);

        const rides = await Promise.all(
            result.rows.map(async (row) => {
                const distance = getDistance(
                    parseFloat(lat), parseFloat(lng),
                    parseFloat(row.origin_lat), parseFloat(row.origin_lng)
                );
                return {
                    ...row,
                    distance_to_pickup: parseFloat(distance.toFixed(1))
                };
            })
        );

        res.json({
            success: true,
            rides: rides
        });

    } catch (e) {
        console.error('❌ ERRO AO BUSCAR CORRIDAS PRÓXIMAS:', e);
        res.status(500).json({ error: "Erro ao buscar corridas próximas." });
    }
};

// =================================================================================================
// 18. REPORTAR PROBLEMA NA CORRIDA
// =================================================================================================
exports.reportIssue = async (req, res) => {
    const { ride_id } = req.params;
    const { issue_type, description } = req.body;
    const userId = req.user.id;

    console.log(`⚠️ [REPORT_ISSUE] Usuário ${userId} reportando problema na ride ${ride_id}`);

    try {
        await pool.query(`
            INSERT INTO ride_issues (ride_id, user_id, issue_type, description, created_at)
            VALUES ($1, $2, $3, $4, NOW())
        `, [ride_id, userId, issue_type, description]);

        res.json({
            success: true,
            message: "Problema reportado com sucesso. Nossa equipe irá analisar."
        });

    } catch (e) {
        console.error('❌ ERRO AO REPORTAR PROBLEMA:', e);
        res.status(500).json({ error: "Erro ao reportar problema." });
    }
};

// =================================================================================================
// 19. OBTER RECIBO DA CORRIDA
// =================================================================================================
exports.getRideReceipt = async (req, res) => {
    const { ride_id } = req.params;
    const userId = req.user.id;

    console.log(`🧾 [GET_RIDE_RECEIPT] Buscando recibo da ride ${ride_id}`);

    try {
        const rideCheck = await pool.query(
            "SELECT * FROM rides WHERE id = $1 AND (passenger_id = $2 OR driver_id = $3)",
            [ride_id, userId, userId]
        );

        if (rideCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: "Recibo não encontrado."
            });
        }

        const fullRide = await getFullRideDetails(ride_id);

        const receipt = {
            ride_id: fullRide.id,
            date: fullRide.completed_at || fullRide.created_at,
            passenger: fullRide.passenger_data?.name,
            driver: fullRide.driver_data?.name,
            origin: fullRide.origin_name,
            destination: fullRide.dest_name,
            distance: fullRide.distance_km,
            price: fullRide.final_price || fullRide.initial_price,
            payment_method: fullRide.payment_method || 'cash',
            ride_type: fullRide.ride_type
        };

        res.json({
            success: true,
            receipt: receipt
        });

    } catch (e) {
        console.error('❌ ERRO AO BUSCAR RECIBO:', e);
        res.status(500).json({ error: "Erro ao buscar recibo." });
    }
};

// =================================================================================================
// 20. ATUALIZAR CORRIDA (ADMIN)
// =================================================================================================
exports.updateRide = async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    console.log(`🔄 [UPDATE_RIDE] Admin atualizando ride ${id}`);

    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: "Acesso negado." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const fields = [];
        const values = [];
        let paramCounter = 1;

        Object.entries(updates).forEach(([key, value]) => {
            if (value !== undefined) {
                fields.push(`${key} = $${paramCounter}`);
                values.push(value);
                paramCounter++;
            }
        });

        fields.push(`updated_at = NOW()`);
        values.push(id);

        const query = `UPDATE rides SET ${fields.join(', ')} WHERE id = $${paramCounter} RETURNING *`;
        const result = await client.query(query, values);

        await client.query('COMMIT');

        res.json({
            success: true,
            ride: result.rows[0]
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ ERRO AO ATUALIZAR CORRIDA:', e);
        res.status(500).json({ error: "Erro ao atualizar corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 21. DELETAR CORRIDA (ADMIN)
// =================================================================================================
exports.deleteRide = async (req, res) => {
    const { id } = req.params;

    console.log(`🗑️ [DELETE_RIDE] Admin deletando ride ${id}`);

    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: "Acesso negado." });
    }

    try {
        await pool.query("DELETE FROM rides WHERE id = $1", [id]);

        res.json({
            success: true,
            message: "Corrida deletada com sucesso."
        });

    } catch (e) {
        console.error('❌ ERRO AO DELETAR CORRIDA:', e);
        res.status(500).json({ error: "Erro ao deletar corrida." });
    }
};

// =================================================================================================
// EXPORTAR TODOS OS MÉTODOS
// =================================================================================================
module.exports = exports;
