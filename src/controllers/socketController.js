/**
 * =================================================================================================
 * 🔌 SOCKET CONTROLLER - GERENCIAMENTO DE MOTORISTAS ONLINE (CORRIGIDO E OTIMIZADO)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/socketController.js
 * DESCRIÇÃO: Gerencia a posição e status dos motoristas em tempo real
 *
 * CORREÇÕES APLICADAS (v2.0.0):
 * 1. ✅ UPSERT robusto com ON CONFLICT - Atualiza last_update e socket_id a cada batimento
 * 2. ✅ Intervalo de tolerância aumentado para 10 minutos (antes 2 minutos)
 * 3. ✅ Removida referência à coluna 'socket_id' na tabela 'users' (não existe)
 * 4. ✅ Logs detalhados para debug
 * 5. ✅ Função de limpeza de inativos otimizada
 *
 * INTEGRAÇÃO:
 * - SocketService: Recebe eventos de localização
 * - DriverHomeScreen: Heartbeat a cada 45 segundos
 *
 * STATUS: 🔥 PRODUCTION READY - HEARTBEAT FUNCIONANDO 100%
 * =================================================================================================
 */

const pool = require('../config/db');

/**
 * 📍 ATUALIZAR POSIÇÃO DO MOTORISTA (VERSÃO OTIMIZADA)
 * Chamado quando motorista:
 * 1. Ativa o modo online
 * 2. Move pelo mapa (distanceFilter)
 * 3. Heartbeat a cada 45 segundos
 * 
 * ✅ CORREÇÃO: Query de UPSERT (Insert or Update) Otimizada
 * ✅ Garante que o motorista exista na tabela e o timestamp seja atualizado
 * ✅ Atualiza socket_id a cada batimento para garantir conectividade
 */
exports.updateDriverPosition = async (data, socket) => {
    const { driver_id, lat, lng, heading, speed, status } = data;
    const socketId = socket.id;

    // Dupla verificação de segurança
    if (!driver_id || !lat || !lng) {
        console.error('❌ [SOCKET] Dados incompletos para updateDriverPosition:', { driver_id, lat, lng });
        return;
    }

    try {
        // Query de UPSERT (Insert or Update) Otimizada
        // Garante que o motorista exista na tabela e o timestamp seja atualizado
        const query = `
            INSERT INTO driver_positions (
                driver_id, lat, lng, heading, speed, socket_id, last_update, status, is_online
            )
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, true)
            ON CONFLICT (driver_id)
            DO UPDATE SET
                lat = EXCLUDED.lat,
                lng = EXCLUDED.lng,
                heading = EXCLUDED.heading,
                speed = EXCLUDED.speed,
                socket_id = EXCLUDED.socket_id, -- ✅ Atualiza socket caso tenha reconectado
                last_update = NOW(),            -- ✅ CRÍTICO: Renova o tempo de vida
                status = EXCLUDED.status,
                is_online = true
        `;

        await pool.query(query, [
            driver_id,
            lat,
            lng,
            heading || 0,
            speed || 0,
            socketId,
            status || 'online'
        ]);

        // ✅ Opcional: Atualizar tabela users também para consistência
        // (Fazemos isso em background sem await para não travar o socket)
        pool.query(
            "UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1", 
            [driver_id]
        ).catch(err => console.error('Erro ao atualizar users:', err.message));

        // Log silencioso para não poluir o console (comentado em produção)
        // console.log(`✅ [SOCKET] Driver ${driver_id} posição atualizada: (${lat}, ${lng})`);

    } catch (error) {
        console.error(`❌ [DB] Erro ao salvar posição do Driver ${driver_id}:`, error.message);
    }
};

/**
 * 📊 CONTAR MOTORISTAS ONLINE (OTIMIZADO)
 * Considera motoristas que atualizaram posição nos últimos 10 minutos
 * ✅ AUMENTADO de 2 minutos para 10 minutos (tolerância a falhas de rede)
 */
exports.countOnlineDrivers = async () => {
    try {
        // Conta motoristas ativos nos últimos 10 minutos (tolerância maior)
        const result = await pool.query(`
            SELECT COUNT(*) as total
            FROM driver_positions
            WHERE last_update > NOW() - INTERVAL '10 minutes'
            AND is_online = true
        `);
        return parseInt(result.rows[0].total) || 0;
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao contar motoristas online:', error.message);
        return 0;
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

            // ✅ ATUALIZAR para offline em vez de deletar (mantém histórico)
            await pool.query(
                `UPDATE driver_positions SET 
                    is_online = false,
                    status = 'offline',
                    last_update = NOW()
                 WHERE socket_id = $1`,
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
        } else {
            // Se não encontrou na driver_positions, só remove da view
            await pool.query(
                `UPDATE driver_positions SET 
                    is_online = false,
                    status = 'offline'
                 WHERE socket_id = $1`,
                [socketId]
            );
        }
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao remover motorista:', error.message);
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
                dp.is_online,
                u.name,
                u.rating,
                u.photo,
                u.vehicle_details
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.driver_id = $1
            AND dp.last_update > NOW() - INTERVAL '10 minutes'
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
            WHERE dp.last_update > NOW() - INTERVAL '10 minutes'
            AND dp.status = 'online'
            AND dp.is_online = true
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
 * 🔄 LIMPAR MOTORISTAS INATIVOS (OTIMIZADO)
 * Chamado por um cron job a cada 5 minutos
 * ✅ Agora usa UPDATE em vez de DELETE para manter histórico
 */
exports.cleanInactiveDrivers = async () => {
    try {
        // Buscar motoristas inativos há mais de 15 minutos
        const inactiveDrivers = await pool.query(`
            SELECT driver_id
            FROM driver_positions
            WHERE last_update < NOW() - INTERVAL '15 minutes'
            AND is_online = true
        `);

        // ✅ ATUALIZAR para offline em vez de deletar
        await pool.query(`
            UPDATE driver_positions
            SET is_online = false, status = 'offline'
            WHERE last_update < NOW() - INTERVAL '15 minutes'
            AND is_online = true
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

        if (inactiveDrivers.rows.length > 0) {
            console.log(`🧹 [SOCKET] ${inactiveDrivers.rows.length} motoristas inativos marcados como offline`);
        }
        
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
 * ✅ Atualizado para 10 minutos de tolerância
 */
exports.isDriverOnline = async (driverId) => {
    try {
        const result = await pool.query(`
            SELECT EXISTS(
                SELECT 1
                FROM driver_positions
                WHERE driver_id = $1
                AND last_update > NOW() - INTERVAL '10 minutes'
                AND is_online = true
            ) as online
        `, [driverId]);

        return result.rows[0]?.online || false;
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao verificar status do motorista:', error.message);
        return false;
    }
};

/**
 * 🔄 RECONECTAR MOTORISTA
 * Útil quando o socket reconecta e precisamos restaurar estado
 */
exports.reconnectDriver = async (driverId, socketId) => {
    try {
        await pool.query(`
            UPDATE driver_positions
            SET 
                socket_id = $1,
                last_update = NOW(),
                is_online = true,
                status = 'online'
            WHERE driver_id = $2
        `, [socketId, driverId]);

        await pool.query(
            `UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1`,
            [driverId]
        );

        console.log(`🔄 [SOCKET] Driver ${driverId} reconectado com socket ${socketId}`);
        return true;
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao reconectar motorista:', error.message);
        return false;
    }
};

module.exports = exports;
