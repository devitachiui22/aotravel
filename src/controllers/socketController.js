/**
 * =================================================================================================
 * 🔌 SOCKET CONTROLLER - GERENCIAMENTO DE MOTORISTAS ONLINE
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/socketController.js
 * DESCRIÇÃO: Gerencia a posição e status dos motoristas em tempo real
 *
 * CORREÇÃO: Removida referência à coluna 'socket_id' na tabela 'users'
 * STATUS: ✅ FUNCIONAL AGORA
 * =================================================================================================
 */

const pool = require('../config/db');

/**
 * 📍 ATUALIZAR POSIÇÃO DO MOTORISTA
 * Chamado quando motorista:
 * 1. Ativa o modo online
 * 2. Move pelo mapa
 * 3. Atualiza localização
 */
exports.updateDriverPosition = async (data, socket) => {
    const { driver_id, lat, lng, heading, speed, status } = data;

    if (!driver_id || !lat || !lng) {
        console.error('❌ [SOCKET] Dados incompletos para updateDriverPosition');
        return;
    }

    try {
        // UPSERT: Insere ou atualiza posição do motorista APENAS na tabela driver_positions
        const query = `
            INSERT INTO driver_positions (driver_id, lat, lng, heading, speed, socket_id, last_update, status)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
            ON CONFLICT (driver_id)
            DO UPDATE SET
                lat = EXCLUDED.lat,
                lng = EXCLUDED.lng,
                heading = EXCLUDED.heading,
                speed = EXCLUDED.speed,
                socket_id = EXCLUDED.socket_id,
                last_update = NOW(),
                status = EXCLUDED.status
        `;

        await pool.query(query, [
            driver_id,
            lat,
            lng,
            heading || 0,
            speed || 0,
            socket.id,
            status || 'online'
        ]);

        // ✅ ATUALIZAR USUÁRIO COMO ONLINE - SEM socket_id
        await pool.query(
            `UPDATE users SET
                is_online = true,
                last_seen = NOW()
             WHERE id = $1`,
            [driver_id]
        );

        console.log(`✅ [SOCKET] Driver ${driver_id} ONLINE em (${lat}, ${lng})`);

        // 📢 NOTIFICAR PASSAGEIROS PRÓXIMOS (se necessário)
        // Esta funcionalidade pode ser implementada depois

    } catch (error) {
        console.error('❌ [SOCKET] Erro ao atualizar posição do motorista:', error.message);
    }
};

/**
 * 🚪 REMOVER MOTORISTA (offline/disconnect)
 */
exports.removeDriverPosition = async (socketId) => {
    try {
        // Buscar driver_id pelo socket_id
        const result = await pool.query(
            `SELECT driver_id FROM driver_positions WHERE socket_id = $1`,
            [socketId]
        );

        if (result.rows.length > 0) {
            const driverId = result.rows[0].driver_id;

            // Remover da tabela de posições
            await pool.query(
                `DELETE FROM driver_positions WHERE socket_id = $1`,
                [socketId]
            );

            // Atualizar status do usuário para offline - SEM socket_id
            await pool.query(
                `UPDATE users SET
                    is_online = false,
                    last_seen = NOW()
                 WHERE id = $1`,
                [driverId]
            );

            console.log(`🟤 [SOCKET] Driver ${driverId} OFFLINE (socket: ${socketId})`);
        }
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao remover motorista:', error.message);
    }
};

/**
 * 📊 CONTAR MOTORISTAS ONLINE
 * Considera motoristas que atualizaram posição nos últimos 2 minutos
 */
exports.countOnlineDrivers = async () => {
    try {
        const result = await pool.query(`
            SELECT COUNT(*) as total
            FROM driver_positions
            WHERE last_update > NOW() - INTERVAL '2 minutes'
        `);
        return parseInt(result.rows[0].total) || 0;
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao contar motoristas online:', error.message);
        return 0;
    }
};

/**
 * 🔍 BUSCAR POSIÇÃO DE UM MOTORISTA ESPECÍFICO
 */
exports.getDriverPosition = async (driverId) => {
    try {
        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.heading,
                dp.speed,
                dp.last_update,
                dp.status,
                u.name,
                u.rating,
                u.photo,
                u.vehicle_details
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.driver_id = $1
            AND dp.last_update > NOW() - INTERVAL '5 minutes'
        `, [driverId]);

        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao buscar posição do motorista:', error.message);
        return null;
    }
};

/**
 * 🗺️ BUSCAR MOTORISTAS PRÓXIMOS
 */
exports.getNearbyDrivers = async (lat, lng, radiusKm = 15) => {
    try {
        // Consulta otimizada com cálculo de distância aproximada
        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.heading,
                dp.speed,
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
            WHERE dp.last_update > NOW() - INTERVAL '2 minutes'
            AND dp.status = 'online'
            AND u.is_online = true
            AND u.role = 'driver'
            AND u.is_blocked = false
            HAVING distance <= $3
            ORDER BY distance ASC
            LIMIT 20
        `, [lat, lng, radiusKm]);

        return result.rows;
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao buscar motoristas próximos:', error.message);
        return [];
    }
};

/**
 * ⏰ ATUALIZAR TIMESTAMP DE ATIVIDADE
 */
exports.updateDriverActivity = async (driverId) => {
    try {
        await pool.query(
            `UPDATE driver_positions
             SET last_update = NOW()
             WHERE driver_id = $1`,
            [driverId]
        );
        return true;
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao atualizar atividade:', error.message);
        return false;
    }
};

/**
 * 🔄 LIMPAR MOTORISTAS INATIVOS
 * Chamado por um cron job a cada 5 minutos
 */
exports.cleanInactiveDrivers = async () => {
    try {
        // Buscar motoristas inativos há mais de 5 minutos
        const inactiveDrivers = await pool.query(`
            SELECT driver_id
            FROM driver_positions
            WHERE last_update < NOW() - INTERVAL '5 minutes'
        `);

        // Remover posições inativas
        await pool.query(`
            DELETE FROM driver_positions
            WHERE last_update < NOW() - INTERVAL '5 minutes'
        `);

        // Atualizar status dos usuários
        for (const row of inactiveDrivers.rows) {
            await pool.query(
                `UPDATE users SET
                    is_online = false,
                    last_seen = NOW()
                 WHERE id = $1`,
                [row.driver_id]
            );
        }

        console.log(`🧹 [SOCKET] ${inactiveDrivers.rows.length} motoristas inativos removidos`);
        return inactiveDrivers.rows.length;
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao limpar motoristas inativos:', error.message);
        return 0;
    }
};

/**
 * 📈 ESTATÍSTICAS DE MOTORISTAS
 */
exports.getDriverStats = async () => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total_online,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
                COUNT(CASE WHEN status = 'busy' THEN 1 END) as busy,
                COUNT(CASE WHEN status = 'offline' THEN 1 END) as offline,
                AVG(EXTRACT(EPOCH FROM (NOW() - last_update))) as avg_last_update_seconds
            FROM driver_positions
            WHERE last_update > NOW() - INTERVAL '24 hours'
        `);

        return result.rows[0] || {
            total_online: 0,
            active: 0,
            busy: 0,
            offline: 0,
            avg_last_update_seconds: 0
        };
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao buscar estatísticas:', error.message);
        return null;
    }
};

/**
 * ✅ VERIFICAR SE MOTORISTA ESTÁ ONLINE
 */
exports.isDriverOnline = async (driverId) => {
    try {
        const result = await pool.query(`
            SELECT EXISTS(
                SELECT 1
                FROM driver_positions
                WHERE driver_id = $1
                AND last_update > NOW() - INTERVAL '2 minutes'
            ) as online
        `, [driverId]);

        return result.rows[0]?.online || false;
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao verificar status do motorista:', error.message);
        return false;
    }
};

module.exports = exports;
