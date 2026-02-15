/**
 * =================================================================================================
 * 🔌 SOCKET CONTROLLER - TITANIUM ENGINE v7.1.0 (CORREÇÃO DO BANCO DE DADOS)
 * =================================================================================================
 *
 * ✅ CORREÇÕES APLICADAS:
 * 1. ✅ Força atualização do socket_id no banco
 * 2. ✅ Garante que lat/lng sejam salvos corretamente
 * 3. ✅ Logs detalhados para debug
 * 4. ✅ Sincronização forçada com users
 *
 * STATUS: 🔥 PRODUCTION READY
 * =================================================================================================
 */

const pool = require('../config/db');

// Cores para logs no terminal
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
};

// =================================================================================================
// 1. 📍 ATUALIZAR POSIÇÃO DO MOTORISTA - CORRIGIDO
// =================================================================================================

exports.updateDriverPosition = async (data, socket) => {
    const { driver_id, user_id, lat, lng, heading, speed, accuracy, status, heartbeat } = data;
    const socketId = socket.id;

    const finalDriverId = driver_id || user_id;

    if (!finalDriverId) {
        console.log(`${colors.red}❌ [updateDriverPosition] ID nulo${colors.reset}`);
        return;
    }

    console.log(`${colors.cyan}\n📍 [updateDriverPosition] Driver ${finalDriverId}${colors.reset}`);
    console.log(`   Socket ID: ${socketId}`);
    console.log(`   Lat/Lng: (${lat}, ${lng})`);

    try {
        const finalLat = lat ? parseFloat(lat) : 0;
        const finalLng = lng ? parseFloat(lng) : 0;
        const finalHeading = heading ? parseFloat(heading) : 0;
        const finalSpeed = speed ? parseFloat(speed) : 0;
        const finalAccuracy = accuracy ? parseFloat(accuracy) : 0;
        const finalStatus = status || 'online';

        // 🔴 CORREÇÃO CRÍTICA: Usar ON CONFLICT com DO UPDATE para garantir que socket_id seja salvo
        const query = `
            INSERT INTO driver_positions (
                driver_id, lat, lng, heading, speed, accuracy, socket_id, status, last_update
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (driver_id)
            DO UPDATE SET
                lat = EXCLUDED.lat,
                lng = EXCLUDED.lng,
                heading = EXCLUDED.heading,
                speed = EXCLUDED.speed,
                accuracy = EXCLUDED.accuracy,
                socket_id = EXCLUDED.socket_id,
                status = EXCLUDED.status,
                last_update = NOW()
            RETURNING *
        `;

        const result = await pool.query(query, [
            finalDriverId,
            finalLat,
            finalLng,
            finalHeading,
            finalSpeed,
            finalAccuracy,
            socketId,
            finalStatus
        ]);

        console.log(`${colors.green}✅ [DB] Posição atualizada para driver ${finalDriverId}${colors.reset}`);
        console.log(`   Socket ID no banco: ${result.rows[0].socket_id}`);

        // 🔴 CORREÇÃO: Sincronizar users imediatamente
        await pool.query(
            `UPDATE users SET
                is_online = true,
                last_seen = NOW(),
                updated_at = NOW()
             WHERE id = $1`,
            [finalDriverId]
        );

        console.log(`${colors.green}✅ [DB] Users sincronizado${colors.reset}`);

        return result.rows[0];

    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] updateDriverPosition:${colors.reset}`, error.message);
    }
};

// =================================================================================================
// 2. 🚪 JOIN DRIVER ROOM - CORRIGIDO
// =================================================================================================

exports.joinDriverRoom = async (data, socket) => {
    const { driver_id, user_id, lat, lng, status } = data;
    const socketId = socket.id;

    const finalDriverId = driver_id || user_id;

    console.log(`${colors.magenta}\n🚪 [joinDriverRoom] Driver ${finalDriverId}${colors.reset}`);
    console.log(`   Socket ID: ${socketId}`);
    console.log(`   Lat/Lng: (${lat}, ${lng})`);

    if (!finalDriverId) {
        console.log(`${colors.red}❌ [joinDriverRoom] ID nulo${colors.reset}`);
        return;
    }

    try {
        const finalLat = lat ? parseFloat(lat) : 0;
        const finalLng = lng ? parseFloat(lng) : 0;
        const finalStatus = status || 'online';

        // 🔴 CORREÇÃO CRÍTICA: Garantir que socket_id seja salvo
        const query = `
            INSERT INTO driver_positions (
                driver_id, lat, lng, socket_id, status, last_update
            )
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (driver_id)
            DO UPDATE SET
                lat = EXCLUDED.lat,
                lng = EXCLUDED.lng,
                socket_id = EXCLUDED.socket_id,
                status = EXCLUDED.status,
                last_update = NOW()
            RETURNING *
        `;

        const result = await pool.query(query, [
            finalDriverId,
            finalLat,
            finalLng,
            socketId,
            finalStatus
        ]);

        console.log(`${colors.green}✅ [DB] Driver ${finalDriverId} registrado com sucesso${colors.reset}`);
        console.log(`   Socket ID no banco: ${result.rows[0].socket_id}`);
        console.log(`   Status: ${result.rows[0].status}`);

        // 🔴 CORREÇÃO: Atualizar users
        await pool.query(
            `UPDATE users SET
                is_online = true,
                last_seen = NOW()
             WHERE id = $1`,
            [finalDriverId]
        );

        console.log(`${colors.green}✅ [DB] Users sincronizado${colors.reset}`);

        socket.emit('joined_ack', {
            success: true,
            driver_id: finalDriverId,
            room: 'drivers',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] joinDriverRoom:${colors.reset}`, error.message);
    }
};

// =================================================================================================
// 3. 🚪 REMOVER MOTORISTA (OFFLINE/DISCONNECT)
// =================================================================================================

exports.removeDriverPosition = async (socketId) => {
    console.log(`${colors.yellow}\n🔌 [removeDriverPosition] Socket ID: ${socketId}${colors.reset}`);

    try {
        const result = await pool.query(
            "SELECT driver_id FROM driver_positions WHERE socket_id = $1",
            [socketId]
        );

        if (result.rows.length > 0) {
            const driverId = result.rows[0].driver_id;

            await pool.query(
                "UPDATE driver_positions SET status = 'offline', last_update = NOW() WHERE socket_id = $1",
                [socketId]
            );

            await pool.query(
                `UPDATE users SET
                    is_online = false,
                    last_seen = NOW()
                 WHERE id = $1`,
                [driverId]
            );

            console.log(`${colors.green}✅ [DB] Driver ${driverId} marcado como offline${colors.reset}`);
        } else {
            await pool.query(
                "UPDATE driver_positions SET status = 'offline' WHERE socket_id = $1",
                [socketId]
            );
            console.log(`${colors.green}✅ [DB] Registros com socket ${socketId} marcados como offline${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] removeDriverPosition:${colors.reset}`, error.message);
    }
};

// =================================================================================================
// 4. 📊 CONTAR MOTORISTAS ONLINE
// =================================================================================================

exports.countOnlineDrivers = async () => {
    try {
        const query = `
            SELECT COUNT(*) as total
            FROM driver_positions
            WHERE last_update > NOW() - INTERVAL '2 minutes'
                AND status = 'online'
                AND socket_id IS NOT NULL
        `;

        const result = await pool.query(query);
        const count = parseInt(result.rows[0].total) || 0;

        console.log(`${colors.blue}📊 [countOnlineDrivers] Motoristas online: ${count}${colors.reset}`);

        return count;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] countOnlineDrivers:${colors.reset}`, error.message);
        return 0;
    }
};

// =================================================================================================
// 5. 🔍 BUSCAR TODOS OS MOTORISTAS ONLINE
// =================================================================================================

exports.getAllOnlineDrivers = async () => {
    try {
        const query = `
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.socket_id,
                dp.status,
                dp.last_update,
                EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago,
                u.id as user_id,
                u.name,
                u.rating,
                u.photo,
                u.phone,
                u.vehicle_details,
                u.is_online,
                u.is_blocked,
                u.role
            FROM driver_positions dp
            INNER JOIN users u ON dp.driver_id = u.id
            WHERE dp.last_update > NOW() - INTERVAL '2 minutes'
                AND dp.status = 'online'
                AND u.is_online = true
                AND u.is_blocked = false
                AND u.role = 'driver'
                AND dp.socket_id IS NOT NULL
            ORDER BY dp.last_update DESC
        `;

        const result = await pool.query(query);
        console.log(`${colors.cyan}📊 [getAllOnlineDrivers] Encontrados: ${result.rows.length}${colors.reset}`);

        return result.rows;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getAllOnlineDrivers:${colors.reset}`, error.message);
        return [];
    }
};

// =================================================================================================
// 6. 🔍 DIAGNÓSTICO DE STATUS DOS MOTORISTAS
// =================================================================================================

exports.debugDriverStatus = async () => {
    try {
        console.log(`${colors.yellow}\n🔍 [DEBUG] Diagnóstico de motoristas${colors.reset}`);

        // 1. Todos os motoristas na tabela users
        const allDrivers = await pool.query(`
            SELECT
                id,
                name,
                role,
                is_online,
                is_blocked,
                last_seen
            FROM users
            WHERE role = 'driver'
            ORDER BY id
        `);

        console.log(`📊 Total de motoristas cadastrados: ${allDrivers.rows.length}`);

        // 2. Motoristas na driver_positions
        const positions = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.socket_id,
                dp.status,
                dp.last_update,
                EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago
            FROM driver_positions dp
            ORDER BY dp.last_update DESC
        `);

        console.log(`\n📊 Registros em driver_positions: ${positions.rows.length}`);

        // 3. Análise detalhada
        console.log(`\n${colors.yellow}📋 Análise detalhada:${colors.reset}`);
        
        for (const driver of allDrivers.rows) {
            const pos = positions.rows.find(p => p.driver_id === driver.id);
            const secondsAgo = pos ? Math.round(pos.seconds_ago) : 'N/A';
            const socketOk = pos && pos.socket_id ? '✅' : '❌';
            const status = pos ? pos.status : 'sem registro';
            
            console.log(`   Driver ${driver.id} (${driver.name}):`);
            console.log(`      is_online: ${driver.is_online ? '✅' : '❌'}`);
            console.log(`      last_seen: ${driver.last_seen}`);
            console.log(`      driver_positions: ${pos ? '✅' : '❌'}`);
            console.log(`      socket_id: ${socketOk} ${pos?.socket_id || 'nulo'}`);
            console.log(`      status: ${status}`);
            console.log(`      last_update: ${secondsAgo}s atrás`);
            console.log(`      GPS: (${pos?.lat || 0}, ${pos?.lng || 0})`);
            console.log('---');
        }

    } catch (error) {
        console.log(`${colors.red}❌ [DEBUG] Erro:${colors.reset}`, error.message);
    }
};

// =================================================================================================
// 7. 🔍 BUSCAR POSIÇÃO DE UM MOTORISTA ESPECÍFICO
// =================================================================================================

exports.getDriverPosition = async (driverId) => {
    try {
        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.heading,
                dp.speed,
                dp.accuracy,
                dp.last_update,
                dp.status,
                dp.socket_id,
                EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago,
                u.name,
                u.rating,
                u.photo,
                u.vehicle_details,
                u.is_online,
                u.is_blocked
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.driver_id = $1
        `, [driverId]);

        if (result.rows.length > 0) {
            return result.rows[0];
        }
        return null;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getDriverPosition:${colors.reset}`, error.message);
        return null;
    }
};

// =================================================================================================
// 8. ✅ VERIFICAR SE MOTORISTA ESTÁ ONLINE
// =================================================================================================

exports.isDriverOnline = async (driverId) => {
    try {
        const result = await pool.query(`
            SELECT EXISTS(
                SELECT 1
                FROM driver_positions
                WHERE driver_id = $1
                    AND last_update > NOW() - INTERVAL '2 minutes'
                    AND status = 'online'
                    AND socket_id IS NOT NULL
            ) as online
        `, [driverId]);

        return result.rows[0]?.online || false;
    } catch (error) {
        return false;
    }
};

// =================================================================================================
// 9. 🔄 SINCRONIZAR STATUS DO MOTORISTA
// =================================================================================================

exports.syncDriverStatus = async (driverId) => {
    try {
        const result = await pool.query(`
            UPDATE users u
            SET is_online = (
                SELECT EXISTS(
                    SELECT 1
                    FROM driver_positions dp
                    WHERE dp.driver_id = u.id
                        AND dp.last_update > NOW() - INTERVAL '2 minutes'
                        AND dp.status = 'online'
                        AND dp.socket_id IS NOT NULL
                )
            )
            WHERE u.id = $1
            RETURNING is_online
        `, [driverId]);

        return result.rows[0]?.is_online || false;
    } catch (error) {
        return false;
    }
};

// =================================================================================================
// 10. 🧹 LIMPAR MOTORISTAS INATIVOS
// =================================================================================================

exports.cleanInactiveDrivers = async () => {
    try {
        const result = await pool.query(`
            UPDATE driver_positions
            SET status = 'offline'
            WHERE last_update < NOW() - INTERVAL '2 minutes'
                AND status = 'online'
            RETURNING driver_id
        `);

        for (const row of result.rows) {
            await pool.query(
                `UPDATE users SET
                    is_online = false,
                    last_seen = NOW()
                 WHERE id = $1`,
                [row.driver_id]
            );
        }

        return result.rows.length;
    } catch (error) {
        return 0;
    }
};

// =================================================================================================
// 11. ⏰ ATUALIZAR TIMESTAMP DE ATIVIDADE
// =================================================================================================

exports.updateDriverActivity = async (driverId) => {
    try {
        await pool.query(
            `UPDATE driver_positions
             SET last_update = NOW()
             WHERE driver_id = $1`,
            [driverId]
        );

        await pool.query(
            `UPDATE users SET
                last_seen = NOW()
             WHERE id = $1`,
            [driverId]
        );

        return true;
    } catch (error) {
        return false;
    }
};

module.exports = exports;
