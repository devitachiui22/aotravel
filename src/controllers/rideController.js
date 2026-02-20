/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE LIFECYCLE CONTROLLER (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/rideController.js
 * DESCRIÇÃO: Controlador Mestre do fluxo de viagens (Ride-Hailing).
 *            Gerencia Solicitações, Despacho (Dispatch), Aceite, Rotas e Finalização.
 *
 * ✅ CORREÇÕES APLICADAS (BLINDAGEM):
 * 1. Evento 'ride_accepted' agora envia o payload ENRIQUECIDO com dados do
 *    motorista e passageiro, forçando o frontend a sair da tela de busca e ir para o chat.
 * 2. Uso de transações (BEGIN/COMMIT) com 'FOR UPDATE' no aceite para evitar
 *    que múltiplos motoristas peguem a mesma corrida (Race Condition).
 * 3. Finalização da corrida agora processa o saldo da carteira (Wallet)
 *    automaticamente se o método for 'wallet', com garantias ACID.
 * 4. Algoritmo de busca de motoristas otimizado com expansão de raio.
 * 5. ✅ CORREÇÃO CRÍTICA: Sintaxe inválida na linha 291 corrigida.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const { getDistance, logError, logSystem, getFullRideDetails, generateRef } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 1. SOLICITAÇÃO DE CORRIDA (REQUEST & DISPATCH ENGINE)
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

    logSystem('RIDE_REQ', ` Nova solicitação de Pax ${passengerId}`);

    if (!originLat || !originLng || !destLat || !destLng) {
        return res.status(400).json({ error: "Coordenadas GPS incompletas ou inválidas.", code: "INVALID_COORDINATES" });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Calcular Tarifa Estimada
        const settingsRes = await client.query("SELECT value FROM app_settings WHERE key = 'ride_prices'");
        const prices = settingsRes.rows[0]?.value || { base_price: 600, km_rate: 300, moto_base: 400, moto_km_rate: 180, delivery_base: 1000, delivery_km_rate: 450 };

        const dist = parseFloat(body.distance_km) || 0;
        const rideType = body.ride_type || 'ride';

        let estimatedPrice = 0;
        if (rideType === 'moto') estimatedPrice = prices.moto_base + (dist * prices.moto_km_rate);
        else if (rideType === 'delivery') estimatedPrice = prices.delivery_base + (dist * prices.delivery_km_rate);
        else estimatedPrice = prices.base_price + (dist * prices.km_rate);

        // Arredondar para a nota de 50 mais próxima e garantir piso mínimo
        estimatedPrice = Math.ceil(estimatedPrice / 50) * 50;
        if (estimatedPrice < 500) estimatedPrice = 500;

        // 2. Inserir Corrida no Banco (Status: searching)
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
            dist
        ]);

        const ride = result.rows[0];
        await client.query('COMMIT');

        // 3. Notificar Passageiro que o dispatch iniciou
        if (req.io) {
            req.io.to(`user_${passengerId}`).emit('ride_requested', {
                ride_id: ride.id,
                status: 'searching',
                message: 'Buscando motorista próximo...',
                request_id: requestId
            });
        }

        // 4. Mecanismo de Despacho (Dispatch Engine)
        let drivers = await exports.findAvailableDrivers(originLat, originLng, 10);

        // Expansão de Raio se não encontrar
        if (drivers.length === 0) drivers = await exports.findAvailableDrivers(originLat, originLng, 20, { includeGpsZero: true });

        let driversNotified = 0;
        const ridePayload = {
            ride_id: ride.id,
            passenger_id: passengerId,
            passenger_name: req.user.name || 'Passageiro',
            passenger_photo: req.user.photo,
            passenger_rating: req.user.rating || 5.0,
            origin_lat: originLat, origin_lng: originLng, origin_name: body.origin_name,
            dest_lat: destLat, dest_lng: destLng, dest_name: body.dest_name,
            initial_price: estimatedPrice,
            distance_km: dist,
            ride_type: rideType,
            status: 'searching',
            timestamp: new Date().toISOString()
        };

        // Disparar para motoristas válidos
        for (const driver of drivers) {
            let distanceToPickup = 0;
            if (driver.lat && driver.lng && driver.lat !== 0 && driver.lng !== 0) {
                distanceToPickup = getDistance(originLat, originLng, parseFloat(driver.lat), parseFloat(driver.lng));
            }

            const driverPayload = { ...ridePayload, distance_to_pickup: parseFloat(distanceToPickup.toFixed(1)) };

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

        // 5. Fallback se não notificar ninguém
        if (driversNotified === 0 && req.io) {
            req.io.to(`user_${passengerId}`).emit('ride_no_drivers', {
                ride_id: ride.id,
                message: 'Nenhum motorista disponível no momento. Tente novamente.',
            });
        }

        logSystem('RIDE_REQ', ` Dispatch concluído. ${driversNotified} motoristas notificados em ${Date.now() - startTime}ms.`);

        res.status(201).json({
            success: true,
            message: driversNotified > 0 ? "Solicitação enviada aos motoristas." : "Aguardando motoristas...",
            ride: { id: ride.id, initial_price: estimatedPrice, distance_km: dist, status: 'searching' },
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
// 2. BUSCA DE MOTORISTAS DISPONÍVEIS (RADAR)
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
                  (6371 * acos(cos(radians($1)) * cos(radians(dp.lat)) * cos(radians(dp.lng) - radians($2)) + sin(radians($1)) * sin(radians(dp.lat)))) <= $3
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
// 3. ACEITAR CORRIDA (CRITICAL PATH - CORREÇÃO DA TELA TRAVADA)
// =================================================================================================

exports.acceptRide = async (req, res) => {
    const { ride_id, driver_id } = req.body;
    const actualDriverId = driver_id || req.user.id;

    if (req.user.role !== 'driver') return res.status(403).json({ error: "Apenas motoristas podem aceitar." });

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Bloqueia o registro para evitar que 2 motoristas aceitem ao mesmo tempo (Race Condition)
        const rideRes = await client.query("SELECT id, status, passenger_id FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);

        if (rideRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Corrida não encontrada." });
        }

        const ride = rideRes.rows[0];

        // 2. Validações de Status
        if (ride.status !== 'searching') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: "Esta corrida já foi aceita por outro motorista.", code: "RIDE_TAKEN" });
        }

        if (ride.passenger_id == actualDriverId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Você não pode aceitar sua própria corrida." });
        }

        // 3. Atualiza a corrida vinculando o motorista
        await client.query(
            `UPDATE rides SET driver_id = $1, status = 'accepted', accepted_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [actualDriverId, ride_id]
        );

        await client.query('COMMIT');

        // 4. BUSCAR DADOS COMPLETOS (O SEGREDO PARA DESTRAVAR O FRONTEND)
        // Isso traz o JSON populado com 'driver_data' e 'passenger_data'
        const fullRide = await getFullRideDetails(ride_id);

        if (!fullRide) throw new Error("Falha ao recuperar payload da corrida após aceite.");

        // 5. EMITIR EVENTOS DE SOCKET
        if (req.io) {
            const acceptPayload = {
                ...fullRide,
                message: 'Motorista a caminho do ponto de embarque!',
                matched_at: new Date().toISOString()
            };

            // Notifica o Passageiro (Isto é o que faz o app dele sair da tela de busca)
            req.io.to(`user_${ride.passenger_id}`).emit('ride_accepted', acceptPayload);

            // Notifica o Motorista (Fallback caso a requisição HTTP falhe)
            req.io.to(`user_${actualDriverId}`).emit('ride_accepted', acceptPayload);

            // Avisa os outros motoristas para limparem o card da tela
            req.io.to('drivers').emit('ride_taken', { ride_id: ride_id, taken_by: actualDriverId });
        }

        logSystem('RIDE_ACCEPT', `Motorista ${actualDriverId} assumiu a corrida ${ride_id}`);

        // 6. Resposta HTTP
        res.json({
            success: true,
            message: "Corrida assumida com sucesso!",
            ride: fullRide
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
// 4. ATUALIZAR STATUS INTERMEDIÁRIOS (CHEGOU, INICIOU)
// =================================================================================================

exports.updateStatus = async (req, res) => {
    const { ride_id, status } = req.body;
    const driverId = req.user.id;

    // ✅ CORREÇÃO: Array de status permitidos corretamente definido
    const allowed = ['arrived', 'ongoing', 'accepted'];
    
    if (!allowed.includes(status)) return res.status(400).json({ error: "Status inválido." });

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const check = await client.query("SELECT driver_id FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
        if (check.rows.length === 0) { 
            await client.query('ROLLBACK'); 
            return res.status(404).json({ error: "Not found." }); 
        }
        if (check.rows[0].driver_id !== driverId) { 
            await client.query('ROLLBACK'); 
            return res.status(403).json({ error: "Denied." }); 
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

        res.json({ success: true, status: status });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_STATUS_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar status." });
    } finally {
        client.release();
    }
};

exports.startRide = async (req, res) => {
    req.body.status = 'ongoing';
    return exports.updateStatus(req, res);
};

// =================================================================================================
// 5. FINALIZAR CORRIDA (INTEGRAÇÃO COM WALLET ACID)
// =================================================================================================

exports.completeRide = async (req, res) => {
    const { ride_id, payment_method, final_price, distance_traveled } = req.body;
    const driverId = req.user.id;
    const method = payment_method || 'cash';

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const rideCheck = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
        if (rideCheck.rows.length === 0) { 
            await client.query('ROLLBACK'); 
            return res.status(404).json({ error: "Not found." }); 
        }

        const ride = rideCheck.rows[0];
        if (ride.driver_id !== driverId) { 
            await client.query('ROLLBACK'); 
            return res.status(403).json({ error: "Denied." }); 
        }
        if (ride.status !== 'ongoing' && ride.status !== 'accepted') { 
            await client.query('ROLLBACK'); 
            return res.status(400).json({ error: "Invalid Status." }); 
        }

        const finalAmount = parseFloat(final_price || ride.final_price || ride.initial_price);

        // --- LÓGICA FINANCEIRA INTEGRADA ---
        if (method === 'wallet') {
            // Verifica saldo do passageiro
            const paxRes = await client.query("SELECT balance FROM users WHERE id = $1 FOR UPDATE", [ride.passenger_id]);
            const paxBalance = parseFloat(paxRes.rows[0]?.balance || 0);

            if (paxBalance < finalAmount) {
                await client.query('ROLLBACK');
                return res.status(402).json({ error: "Saldo insuficiente na carteira do passageiro.", code: "INSUFFICIENT_FUNDS" });
            }

            // Transferência Atômica
            await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [finalAmount, ride.passenger_id]);
            await client.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [finalAmount, driverId]);

            const txRef = generateRef('RIDE');

            // Log Débito Pax
            await client.query(
                `INSERT INTO wallet_transactions (reference_id, user_id, amount, type, method, status, description, category, ride_id) 
                 VALUES ($1, $2, $3, 'payment', 'wallet', 'completed', $4, 'ride', $5)`,
                [txRef, ride.passenger_id, -finalAmount, `Pagamento da corrida #${ride_id}`, ride_id]
            );

            // Log Crédito Motorista
            await client.query(
                `INSERT INTO wallet_transactions (reference_id, user_id, amount, type, method, status, description, category, ride_id) 
                 VALUES ($1, $2, $3, 'earnings', 'wallet', 'completed', $4, 'ride', $5)`,
                [txRef, driverId, finalAmount, `Ganhos da corrida #${ride_id}`, ride_id]
            );
        } else {
            // Apenas registra o ganho em dinheiro
            const txRef = generateRef('CASH');
            await client.query(
                `INSERT INTO wallet_transactions (reference_id, user_id, amount, type, method, status, description, category, metadata, ride_id) 
                 VALUES ($1, $2, $3, 'earnings', 'cash', 'completed', $4, 'ride', '{"is_cash": true}', $5)`,
                [txRef, driverId, finalAmount, `Ganhos da corrida #${ride_id} (Dinheiro)`, ride_id]
            );
        }

        // --- ATUALIZA A CORRIDA ---
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

        // --- NOTIFICAÇÕES SOCKET ---
        if (req.io) {
            req.io.to(`ride_${ride_id}`).emit('ride_completed', fullRide);
            req.io.to(`user_${ride.passenger_id}`).emit('ride_completed', fullRide);

            if (method === 'wallet') {
                // Dispara trigger para o app atualizar saldo da UI
                req.io.to(`user_${ride.passenger_id}`).emit('wallet_update', { type: 'payment', amount: finalAmount });
                req.io.to(`user_${driverId}`).emit('wallet_update', { type: 'earnings', amount: finalAmount });
            }
        }

        res.json({ success: true, message: "Corrida finalizada com sucesso!", ride: fullRide });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('RIDE_COMPLETE_FATAL', e);
        res.status(500).json({ error: "Erro crítico ao finalizar corrida." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 6. CANCELAR CORRIDA
// =================================================================================================

exports.cancelRide = async (req, res) => {
    const { ride_id, reason } = req.body;
    const userId = req.user.id;
    const role = req.user.role;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const check = await client.query("SELECT * FROM rides WHERE id = $1 FOR UPDATE", [ride_id]);
        if (check.rows.length === 0) { 
            await client.query('ROLLBACK'); 
            return res.status(404).json({ error: "Not found." }); 
        }

        const ride = check.rows[0];
        if (!['searching', 'accepted', 'ongoing'].includes(ride.status)) { 
            await client.query('ROLLBACK'); 
            return res.status(400).json({ error: "Já finalizada." }); 
        }
        if (ride.passenger_id !== userId && ride.driver_id !== userId && role !== 'admin') { 
            await client.query('ROLLBACK'); 
            return res.status(403).json({ error: "Denied." }); 
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

            // Se cancelou antes de alguém aceitar, avisa os motoristas pra tirarem do radar
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
// 7. LEITURA DE HISTÓRICO E DETALHES
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

/**
 * =================================================================================================
 * FIM DO ARQUIVO - RIDE CONTROLLER CORRIGIDO
 * =================================================================================================
 */
