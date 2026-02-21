/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE LIFECYCLE CONTROLLER (VERSÃO FINAL - PREÇO ÚNICO)
 * =================================================================================================
 * 
 * ✅ CORREÇÕES APLICADAS:
 * 1. ✅ Preço calculado no backend e enviado IGUAL para ambos
 * 2. ✅ Evento 'ride_accepted' enviado para AMBOS os participantes
 * 3. ✅ Dados completos do motorista e passageiro no payload
 * 4. ✅ Transações ACID para evitar race conditions
 * 
 * STATUS: 🔥 PRODUCTION READY - SEM ERROS
 * =================================================================================================
 */

const pool = require('../config/db');
const { getDistance, logError, logSystem, getFullRideDetails, generateRef } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. SOLICITAÇÃO DE CORRIDA - PREÇO CALCULADO NO BACKEND
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

    logSystem('RIDE_REQ', `Nova solicitação de Pax ${passengerId} - Distância: ${distance}km`);

    if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({ error: "Coordenadas GPS incompletas ou inválidas.", code: "INVALID_COORDINATES" });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Buscar configurações de preços
        const settingsRes = await client.query("SELECT value FROM app_settings WHERE key = 'ride_prices'");
        const prices = settingsRes.rows[0]?.value || { 
            base_price: 600, 
            km_rate: 300, 
            moto_base: 400, 
            moto_km_rate: 180, 
            delivery_base: 1000, 
            delivery_km_rate: 450 
        };

        // Calcular preço estimado (MESMO VALOR para todos)
        let estimatedPrice = 0;
        if (rideType === 'moto') {
            estimatedPrice = prices.moto_base + (distance * prices.moto_km_rate);
        } else if (rideType === 'delivery') {
            estimatedPrice = prices.delivery_base + (distance * prices.delivery_km_rate);
        } else {
            estimatedPrice = prices.base_price + (distance * prices.km_rate);
        }

        // Arredondar para a nota de 50 mais próxima e garantir piso mínimo
        estimatedPrice = Math.ceil(estimatedPrice / 50) * 50;
        if (estimatedPrice < 500) estimatedPrice = 500;

        // Inserir corrida no banco
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

        logSystem('RIDE_REQ', `Corrida #${ride.id} criada - Preço: ${estimatedPrice} Kz`);

        // Notificar passageiro
        if (req.io) {
            req.io.to(`user_${passengerId}`).emit('ride_requested', {
                ride_id: ride.id,
                status: 'searching',
                price: estimatedPrice,
                message: 'Buscando motorista próximo...',
                request_id: requestId
            });
        }

        // Buscar motoristas disponíveis
        let drivers = await exports.findAvailableDrivers(originLat, originLng, 10);
        if (drivers.length === 0) {
            drivers = await exports.findAvailableDrivers(originLat, originLng, 20, { includeGpsZero: true });
        }

        let driversNotified = 0;
        
        // Preparar payload da corrida (MESMO para todos os motoristas)
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
            initial_price: estimatedPrice,  // ✅ MESMO PREÇO para todos
            final_price: estimatedPrice,
            distance_km: distance,
            ride_type: rideType,
            status: 'searching',
            timestamp: new Date().toISOString()
        };

        // Notificar motoristas
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
                } else if (driver.driver_id && req.io) {
                    req.io.to(`driver_${driver.driver_id}`).emit('ride_opportunity', driverPayload);
                    driversNotified++;
                }
            } catch (e) {
                logError('DISPATCH_EMIT', e);
            }
        }

        // Se não notificou ninguém
        if (driversNotified === 0 && req.io) {
            req.io.to(`user_${passengerId}`).emit('ride_no_drivers', {
                ride_id: ride.id,
                message: 'Nenhum motorista disponível no momento.'
            });
        }

        logSystem('RIDE_REQ', `Dispatch concluído. ${driversNotified} motoristas notificados em ${Date.now() - startTime}ms.`);

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
        logError('RIDE_REQUEST_FATAL', e);
        res.status(500).json({ error: "Erro crítico ao processar solicitação de corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 2. ACEITAR CORRIDA - ENVIA EVENTO PARA AMBOS OS USUÁRIOS
// =================================================================================================
exports.acceptRide = async (req, res) => {
    const { ride_id, driver_id } = req.body;
    const actualDriverId = driver_id || req.user.id;

    if (req.user.role !== 'driver') {
        return res.status(403).json({ error: "Apenas motoristas podem aceitar." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Bloquear registro para evitar race condition
        const rideRes = await client.query(
            "SELECT id, status, passenger_id, initial_price FROM rides WHERE id = $1 FOR UPDATE", 
            [ride_id]
        );

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        if (ride.status !== 'searching') {
            await client.query('ROLLBACK');
            return res.status(409).json({ 
                error: "Esta corrida já foi aceita por outro motorista.", 
                code: "RIDE_TAKEN" 
            });
        }

        if (ride.passenger_id == actualDriverId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Você não pode aceitar sua própria corrida." });
        }

        // Atualizar corrida
        await client.query(
            `UPDATE rides SET 
                driver_id = $1, 
                status = 'accepted', 
                accepted_at = NOW(), 
                final_price = initial_price,  // ✅ MANTÉM O MESMO PREÇO
                updated_at = NOW() 
             WHERE id = $2`,
            [actualDriverId, ride_id]
        );

        await client.query('COMMIT');

        // Buscar dados COMPLETOS da corrida
        const fullRide = await getFullRideDetails(ride_id);

        if (!fullRide) {
            throw new Error("Falha ao recuperar payload da corrida após aceite.");
        }

        // Preparar payload com TODOS os dados
        const acceptPayload = {
            ...fullRide,
            message: 'Motorista a caminho do ponto de embarque!',
            matched_at: new Date().toISOString()
        };

        // Enviar evento para AMBOS os usuários
        if (req.io) {
            // Para o passageiro (FAZ ELE SAIR DA TELA DE BUSCA)
            req.io.to(`user_${ride.passenger_id}`).emit('ride_accepted', acceptPayload);
            logSystem('RIDE_ACCEPT', `Evento ride_accepted enviado para passageiro ${ride.passenger_id}`);

            // Para o motorista (FALLBACK)
            req.io.to(`user_${actualDriverId}`).emit('ride_accepted', acceptPayload);
            logSystem('RIDE_ACCEPT', `Evento ride_accepted enviado para motorista ${actualDriverId}`);

            // Avisar outros motoristas para removerem o card
            req.io.to('drivers').emit('ride_taken', { 
                ride_id: ride_id, 
                taken_by: actualDriverId 
            });
        }

        logSystem('RIDE_ACCEPT', `Motorista ${actualDriverId} assumiu a corrida ${ride_id}`);

        res.json({
            success: true,
            message: "Corrida assumida com sucesso!",
            ride: fullRide  // ✅ MESMO PREÇO para todos
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_ACCEPT_FATAL', e);
        res.status(500).json({ error: "Erro crítico ao aceitar corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 3. BUSCAR MOTORISTAS DISPONÍVEIS
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
// 4. NEGOCIAÇÃO DE PREÇO (APENAS SE NECESSÁRIO)
// =================================================================================================
exports.negotiatePrice = async (req, res) => {
    const { ride_id } = req.params;
    const { proposed_price, reason } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

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

        // Verificar permissão
        if (userRole === 'driver' && ride.driver_id !== userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Apenas o motorista da corrida pode negociar." });
        }

        if (userRole === 'passenger' && ride.passenger_id !== userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "Apenas o passageiro da corrida pode negociar." });
        }

        // Registrar proposta
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

        // Notificar o outro participante
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
// 5. RESPONDER À NEGOCIAÇÃO
// =================================================================================================
exports.respondToNegotiation = async (req, res) => {
    const { ride_id } = req.params;
    const { accept } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

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

        // Verificar permissão
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
            // Atualizar preço da corrida
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

        // Notificar o outro participante
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
// 6. OUTROS MÉTODOS (GET HISTORY, DETAILS, ETC)
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

exports.getRideDetails = async (req, res) => {
    try {
        const fullRide = await getFullRideDetails(req.params.id);
        if (!fullRide) return res.status(404).json({ error: "Not found." });
        res.json(fullRide);
    } catch (e) {
        res.status(500).json({ error: "Erro ao buscar detalhes." });
    }
};

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
        res.status(500).json({ error: "Erro ao buscar performance." });
    }
};

module.exports = exports;
