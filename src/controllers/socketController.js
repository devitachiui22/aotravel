/**
 * =================================================================================================
 * 📍 AOTRAVEL SERVER PRO - DRIVER STATE CONTROLLER (VERSÃO SIMPLIFICADA - 100% FUNCIONAL)
 * =================================================================================================
 */

const pool = require('../config/db');

// Coordenadas padrão (Luanda)
const DEFAULT_LAT = -8.8399;
const DEFAULT_LNG = 13.2894;

// Logger simples
const log = {
    info: (msg) => console.log(`📍 [INFO] ${msg}`),
    success: (msg) => console.log(`📍 [SUCCESS] ${msg}`),
    error: (msg) => console.log(`📍 [ERROR] ${msg}`)
};

// =================================================================================================
// 1. JOIN DRIVER ROOM - VERSÃO SIMPLIFICADA
// =================================================================================================
exports.joinDriverRoom = async (data, socket) => {
    const driverId = data.driver_id || data.user_id;
    const socketId = socket.id;
    
    if (!driverId) {
        log.error(`join sem driver_id`);
        return;
    }

    const lat = parseFloat(data.lat) || DEFAULT_LAT;
    const lng = parseFloat(data.lng) || DEFAULT_LNG;

    log.info(`🚗 Driver ${driverId} conectando com socket ${socketId}`);

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // 1. Inserir ou atualizar posição
        await client.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, socket_id, status, last_update)
            VALUES ($1, $2, $3, $4, 'online', NOW())
            ON CONFLICT (driver_id) DO UPDATE SET
                lat = $2,
                lng = $3,
                socket_id = $4,
                status = 'online',
                last_update = NOW()
        `, [driverId, lat, lng, socketId]);

        // 2. Atualizar usuário
        await client.query(`
            UPDATE users SET is_online = true, last_seen = NOW()
            WHERE id = $1
        `, [driverId]);

        await client.query('COMMIT');
        
        log.success(`✅ Driver ${driverId} registrado com sucesso`);
        
        socket.emit('joined_ack', {
            success: true,
            driver_id: driverId,
            status: 'online'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        log.error(`Erro: ${error.message}`);
    } finally {
        client.release();
    }
};

// =================================================================================================
// 2. UPDATE DRIVER POSITION
// =================================================================================================
exports.updateDriverPosition = async (data, socket) => {
    const driverId = data.driver_id || data.user_id;
    if (!driverId) return;

    const lat = parseFloat(data.lat);
    const lng = parseFloat(data.lng);
    
    if (isNaN(lat) || isNaN(lng)) return;

    try {
        await pool.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, socket_id, status, last_update)
            VALUES ($1, $2, $3, $4, 'online', NOW())
            ON CONFLICT (driver_id) DO UPDATE SET
                lat = $2,
                lng = $3,
                socket_id = $4,
                status = 'online',
                last_update = NOW()
        `, [driverId, lat, lng, socket.id]);
        
        // Também atualizar users.last_seen
        await pool.query(`
            UPDATE users SET last_seen = NOW() WHERE id = $1
        `, [driverId]);
        
    } catch (error) {
        // Ignorar erros
    }
};

// =================================================================================================
// 3. REMOVER MOTORISTA (DISCONNECT)
// =================================================================================================
exports.removeDriverPosition = async (socketId) => {
    if (!socketId) return;

    log.info(`🔌 Desconectando socket ${socketId}`);

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Buscar driver associado
        const result = await client.query(
            "SELECT driver_id FROM driver_positions WHERE socket_id = $1",
            [socketId]
        );

        if (result.rows.length > 0) {
            const driverId = result.rows[0].driver_id;

            // Marcar offline
            await client.query(
                "UPDATE driver_positions SET status = 'offline', last_update = NOW(), socket_id = NULL WHERE driver_id = $1",
                [driverId]
            );

            await client.query(
                "UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1",
                [driverId]
            );

            log.success(`✅ Driver ${driverId} desconectado`);
        }

        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        log.error(`Erro: ${error.message}`);
    } finally {
        client.release();
    }
};

// =================================================================================================
// 4. HEARTBEAT
// =================================================================================================
exports.updateDriverActivity = async (driverId) => {
    if (!driverId) return false;

    try {
        await pool.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, status, last_update)
            VALUES ($1, $2, $3, 'online', NOW())
            ON CONFLICT (driver_id) DO UPDATE SET
                last_update = NOW(),
                status = 'online'
        `, [driverId, DEFAULT_LAT, DEFAULT_LNG]);

        await pool.query(
            "UPDATE users SET last_seen = NOW(), is_online = true WHERE id = $1",
            [driverId]
        );

        return true;
    } catch (error) {
        return false;
    }
};

// =================================================================================================
// 5. CONTAR MOTORISTAS ONLINE
// =================================================================================================
exports.countOnlineDrivers = async () => {
    try {
        const result = await pool.query(`
            SELECT COUNT(*) as total
            FROM driver_positions
            WHERE status = 'online'
                AND last_update > NOW() - INTERVAL '2 minutes'
                AND socket_id IS NOT NULL
        `);
        return parseInt(result.rows[0].total) || 0;
    } catch (error) {
        return 0;
    }
};

// =================================================================================================
// 6. BUSCAR MOTORISTAS PRÓXIMOS
// =================================================================================================
exports.getNearbyDrivers = async (lat, lng, radiusKm = 15) => {
    try {
        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                u.name,
                u.rating,
                u.photo,
                u.vehicle_details,
                (
                    6371 * acos(
                        cos(radians($1)) *
                        cos(radians(dp.lat)) *
                        cos(radians(dp.lng) - radians($2)) +
                        sin(radians($1)) *
                        sin(radians(dp.lat))
                    )
                ) AS distance
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.status = 'online'
                AND dp.last_update > NOW() - INTERVAL '2 minutes'
                AND dp.socket_id IS NOT NULL
                AND u.is_online = true
                AND u.is_blocked = false
            HAVING distance <= $3
            ORDER BY distance ASC
            LIMIT 20
        `, [lat, lng, radiusKm]);

        return result.rows;
    } catch (error) {
        return [];
    }
};

// =================================================================================================
// 7. LIMPAR MOTORISTAS INATIVOS
// =================================================================================================
exports.cleanInactiveDrivers = async () => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Buscar inativos
        const inativos = await client.query(`
            SELECT driver_id
            FROM driver_positions
            WHERE last_update < NOW() - INTERVAL '3 minutes'
                AND status = 'online'
        `);

        // Marcar como offline
        await client.query(`
            UPDATE driver_positions
            SET status = 'offline', socket_id = NULL
            WHERE last_update < NOW() - INTERVAL '3 minutes'
                AND status = 'online'
        `);

        // Sincronizar users
        for (const row of inativos.rows) {
            await client.query(
                "UPDATE users SET is_online = false WHERE id = $1",
                [row.driver_id]
            );
        }

        await client.query('COMMIT');
        
        return inativos.rows.length;
    } catch (error) {
        await client.query('ROLLBACK');
        return 0;
    } finally {
        client.release();
    }
};

module.exports = exports;
