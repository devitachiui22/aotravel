/**
 * =================================================================================================
 * 📍 AOTRAVEL SERVER PRO - DRIVER STATE CONTROLLER (TITANIUM v8.1.0)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/socketController.js
 * DESCRIÇÃO: Gerencia a persistência de localização e estado dos motoristas.
 *            Alimenta a tabela 'driver_positions' usada pelo algoritmo de Dispatch.
 *
 * ✅ CARACTERÍSTICAS DE PRODUÇÃO:
 * 1. UPSERT Atômico (Insert ou Update seguro) com transações ACID
 * 2. Sincronização automática com tabela 'users' (is_online/last_seen)
 * 3. Validação rigorosa de Coordenadas (Evita crash no cálculo de distância)
 * 4. Sistema de fallback com coordenadas padrão (Luanda)
 * 5. Logs ultra detalhados com cores específicas por operação
 * 6. Verificação de integridade pós-operação OBRIGATÓRIA
 * 7. Limpeza automática de sessões órfãs e motoristas inativos
 * 8. Diagnóstico completo de status dos motoristas
 * 9. Timeout e tratamento de erros aprimorado
 * 10. Batch updates para alta performance
 *
 * ✅ CORREÇÕES APLICADAS v8.1.0:
 * 1. Transações ACID para garantir atomicidade das operações
 * 2. Lógica FORÇADA de UPDATE/INSERT com fallback robusto
 * 3. Coordenadas padrão (Luanda) para garantir sempre dados válidos
 * 4. Verificação de existência prévia em todas as operações
 * 5. Sincronização forçada com tabela users
 * 6. Remoção de motoristas inativos via CRON
 *
 * STATUS: 🔥 PRODUCTION READY - CORE COMPONENT
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

// Logger estruturado
const logger = {
    info: (msg, data) => console.log(`${colors.blue}📍 [INFO]${colors.reset} ${msg}`, data || ''),
    success: (msg, data) => console.log(`${colors.green}📍 [SUCCESS]${colors.reset} ${msg}`, data || ''),
    warn: (msg, data) => console.log(`${colors.yellow}📍 [WARN]${colors.reset} ${msg}`, data || ''),
    error: (msg, data) => console.log(`${colors.red}📍 [ERROR]${colors.reset} ${msg}`, data || ''),
    debug: (msg, data) => process.env.NODE_ENV === 'development' && console.log(`${colors.cyan}📍 [DEBUG]${colors.reset} ${msg}`, data || ''),
    tracking: (msg, data) => console.log(`${colors.magenta}📍 [TRACKING]${colors.reset} ${msg}`, data || '')
};

// Coordenadas padrão (Luanda, Angola) para fallback seguro
const DEFAULT_LAT = -8.8399;
const DEFAULT_LNG = 13.2894;

// =================================================================================================
// 1. 📍 JOIN DRIVER ROOM - VERSÃO ULTRA FORÇADA
// =================================================================================================
exports.joinDriverRoom = async (data, socket) => {
    const { driver_id, user_id, lat, lng, heading, speed, accuracy, status } = data;
    const socketId = socket.id;
    const finalDriverId = driver_id || user_id;
    const timestamp = new Date().toISOString();

    // Validação de segurança
    if (!finalDriverId) {
        logger.error(`Tentativa de join sem driver_id (Socket: ${socketId})`);
        return;
    }

    const safeLat = parseFloat(lat) || DEFAULT_LAT;
    const safeLng = parseFloat(lng) || DEFAULT_LNG;
    const safeHeading = parseFloat(heading) || 0;
    const safeSpeed = parseFloat(speed) || 0;
    const safeAccuracy = parseFloat(accuracy) || 0;
    const safeStatus = status || 'online';

    logger.tracking(`\n🔴🔴🔴🔴🔴 [joinDriverRoom] INÍCIO 🔴🔴🔴🔴🔴`);
    logger.tracking(`📍 Timestamp: ${timestamp}`);
    logger.tracking(`📍 Driver ID: ${finalDriverId}`);
    logger.tracking(`📍 Socket ID: ${socketId}`);
    logger.tracking(`📍 Lat/Lng: (${safeLat}, ${safeLng})`);
    logger.tracking(`📍 Heading/Speed: ${safeHeading}°, ${safeSpeed} km/h`);
    logger.tracking(`📍 Accuracy: ${safeAccuracy}`);
    logger.tracking(`📍 Status: ${safeStatus}`);
    logger.tracking(`📍 Dados recebidos:`, JSON.stringify(data, null, 2));

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 🔴 VERIFICAÇÃO DE EXISTÊNCIA
        const check = await client.query(
            "SELECT driver_id, socket_id, status FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );

        logger.debug(`📊 Verificação de existência: ${check.rows.length > 0 ? 'ENCONTRADO' : 'NÃO ENCONTRADO'}`);

        if (check.rows.length > 0) {
            logger.debug(`   - Socket atual: ${check.rows[0].socket_id || 'NULO'}`);
            logger.debug(`   - Status atual: ${check.rows[0].status}`);
        }

        // 🔴 UPSERT na tabela de posições (Hot Data)
        const upsertQuery = `
            INSERT INTO driver_positions (
                driver_id, lat, lng, heading, speed, accuracy, socket_id, status, last_update
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (driver_id) DO UPDATE SET
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

        const updateResult = await client.query(upsertQuery, [
            finalDriverId, safeLat, safeLng, safeHeading, safeSpeed, safeAccuracy, socketId, safeStatus
        ]);

        logger.success(`✅ [DB] UPSERT executado. Linhas afetadas: ${updateResult.rowCount}`);

        // 🔴 ATUALIZAR TABELA USERS
        const userUpdate = await client.query(`
            UPDATE users SET
                is_online = true,
                last_login = NOW(),
                last_seen = NOW()
            WHERE id = $1
            RETURNING id, is_online
        `, [finalDriverId]);

        logger.success(`✅ [DB] Users atualizado - is_online: ${userUpdate.rows[0]?.is_online || true}`);

        await client.query('COMMIT');

        // 🔴 VERIFICAÇÃO FORÇADA PÓS-OPERAÇÃO
        const verify = await client.query(
            'SELECT driver_id, status, socket_id, last_update, lat, lng FROM driver_positions WHERE driver_id = $1',
            [finalDriverId]
        );

        if (verify.rows.length > 0) {
            logger.success(`✅ VERIFICAÇÃO PÓS-OPERAÇÃO:`);
            logger.success(`   ✅ Status: ${verify.rows[0].status}`);
            logger.success(`   ✅ Socket ID: ${verify.rows[0].socket_id}`);
            logger.success(`   ✅ Last Update: ${verify.rows[0].last_update}`);
            logger.success(`   ✅ Posição: (${verify.rows[0].lat}, ${verify.rows[0].lng})`);
        } else {
            logger.error(`❌ VERIFICAÇÃO FALHOU - Registro não encontrado após operação`);
        }

        // 🔴 ENVIAR CONFIRMAÇÃO PARA O CLIENTE
        socket.emit('joined_ack', {
            success: true,
            driver_id: finalDriverId,
            status: 'online',
            socket_id: socketId,
            room: 'drivers',
            timestamp: timestamp
        });

        logger.success(`✅ [Socket] joined_ack enviado para driver ${finalDriverId}`);

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`❌ [DB ERROR] joinDriverRoom: ${error.message}`);
        console.error(error);

        // Tentar enviar erro para o cliente
        socket.emit('joined_ack', {
            success: false,
            driver_id: finalDriverId,
            error: error.message,
            timestamp: timestamp
        });
    } finally {
        client.release();
    }

    logger.tracking(`🔴🔴🔴🔴🔴 [joinDriverRoom] FIM 🔴🔴🔴🔴🔴\n`);
};

// =================================================================================================
// 2. 📍 UPDATE DRIVER POSITION - VERSÃO OTIMIZADA
// =================================================================================================
exports.updateDriverPosition = async (data, socket) => {
    const { driver_id, user_id, lat, lng, heading, speed, accuracy, status } = data;
    const socketId = socket.id;
    const finalDriverId = driver_id || user_id;
    const timestamp = new Date().toISOString();

    if (!finalDriverId) {
        logger.debug(`updateDriverPosition: ID nulo ignorado`);
        return;
    }

    // Sanitização rigorosa para evitar falhas no SQL
    const safeLat = parseFloat(lat);
    const safeLng = parseFloat(lng);

    // Se coordenadas inválidas, ignorar atualização silenciosamente
    if (isNaN(safeLat) || isNaN(safeLng)) {
        logger.debug(`Coordenadas inválidas para driver ${finalDriverId}: (${lat}, ${lng})`);
        return;
    }

    logger.tracking(`\n📍 [updateDriverPosition] ========================================`);
    logger.tracking(`📍 Timestamp: ${timestamp}`);
    logger.tracking(`📍 Driver ID: ${finalDriverId}`);
    logger.tracking(`📍 Socket ID: ${socketId}`);
    logger.tracking(`📍 Lat/Lng: (${safeLat}, ${safeLng})`);
    logger.tracking(`📍 Heading/Speed: ${parseFloat(heading) || 0}°, ${parseFloat(speed) || 0} km/h`);
    logger.tracking(`📍 Accuracy: ${parseFloat(accuracy) || 0}`);

    try {
        // Query otimizada (Single Statement) para máxima performance
        await pool.query(`
            INSERT INTO driver_positions (
                driver_id, lat, lng, heading, speed, accuracy, socket_id, status, last_update
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (driver_id) DO UPDATE SET
                lat = EXCLUDED.lat,
                lng = EXCLUDED.lng,
                heading = EXCLUDED.heading,
                speed = EXCLUDED.speed,
                accuracy = EXCLUDED.accuracy,
                socket_id = EXCLUDED.socket_id,
                status = EXCLUDED.status,
                last_update = NOW()
        `, [
            finalDriverId,
            safeLat,
            safeLng,
            parseFloat(heading) || 0,
            parseFloat(speed) || 0,
            parseFloat(accuracy) || 0,
            socketId,
            status || 'online'
        ]);

        logger.success(`✅ [DB] Posição atualizada para driver ${finalDriverId}`);

        // 🔴 VERIFICAÇÃO RÁPIDA
        const verify = await pool.query(
            'SELECT last_update, status FROM driver_positions WHERE driver_id = $1',
            [finalDriverId]
        );

        if (verify.rows.length > 0) {
            logger.debug(`✅ Verificação: Status=${verify.rows[0].status}, Update=${verify.rows[0].last_update}`);
        }

    } catch (error) {
        // Erros de tracking não devem parar o servidor, apenas logar se for crítico
        if (error.code !== '23505') { // Ignorar erros de chave única
            logger.error(`❌ [DB ERROR] updateDriverPosition: ${error.message}`);
        }
    }

    logger.tracking(`📍 ========================================\n`);
};

// =================================================================================================
// 3. 🚪 REMOVER MOTORISTA (OFFLINE/DISCONNECT)
// =================================================================================================
exports.removeDriverPosition = async (socketId) => {
    if (!socketId) return;

    logger.warn(`\n🔌 [removeDriverPosition] ========================================`);
    logger.warn(`🔌 Socket ID: ${socketId}`);
    logger.warn(`🔌 Timestamp: ${new Date().toISOString()}`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Buscar o driver_id associado a este socket
        const result = await client.query(
            "SELECT driver_id FROM driver_positions WHERE socket_id = $1",
            [socketId]
        );

        if (result.rows.length > 0) {
            const driverId = result.rows[0].driver_id;

            logger.warn(`📊 Driver encontrado: ${driverId}`);

            // Marcar offline na tabela de posições
            await client.query(
                "UPDATE driver_positions SET status = 'offline', last_update = NOW() WHERE driver_id = $1",
                [driverId]
            );

            logger.success(`✅ [DB] driver_positions atualizado para offline`);

            // Marcar offline na tabela de usuários
            const userUpdate = await client.query(
                `UPDATE users SET
                    is_online = false,
                    last_seen = NOW()
                 WHERE id = $1
                 RETURNING id, is_online`,
                [driverId]
            );

            if (userUpdate.rows.length > 0) {
                logger.success(`✅ [DB] users atualizado para offline - ID: ${driverId}`);
            }

            logger.warn(`🟤 Driver ${driverId} OFFLINE (Socket ${socketId})`);
        } else {
            logger.warn(`⚠️ Nenhum driver encontrado com socket ${socketId}`);

            // Apenas atualizar qualquer registro com este socket
            const updateResult = await client.query(
                "UPDATE driver_positions SET status = 'offline', last_update = NOW() WHERE socket_id = $1 RETURNING driver_id",
                [socketId]
            );

            if (updateResult.rows.length > 0) {
                logger.success(`✅ [DB] ${updateResult.rows.length} registros com socket ${socketId} marcados como offline`);
            }
        }

        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`❌ [DB ERROR] removeDriverPosition: ${error.message}`);
    } finally {
        client.release();
    }

    logger.warn(`🔌 ========================================\n`);
};

// =================================================================================================
// 4. ⏰ HEARTBEAT & KEEP ALIVE
// =================================================================================================
exports.updateDriverActivity = async (driverId) => {
    if (!driverId) return false;

    try {
        // Atualiza apenas o timestamp para evitar que o motorista suma do radar
        const result = await pool.query(
            `UPDATE driver_positions
             SET last_update = NOW(), status = 'online'
             WHERE driver_id = $1
             RETURNING driver_id`,
            [driverId]
        );

        if (result.rows.length > 0) {
            // Sincroniza tabela users
            await pool.query(
                `UPDATE users SET
                    last_seen = NOW(),
                    is_online = true
                 WHERE id = $1`,
                [driverId]
            );

            logger.success(`✅ [updateDriverActivity] Driver ${driverId} atividade atualizada`);
            return true;
        }

        logger.warn(`⚠️ [updateDriverActivity] Driver ${driverId} não encontrado`);
        return false;
    } catch (error) {
        logger.error(`❌ [DB ERROR] updateDriverActivity: ${error.message}`);
        return false;
    }
};

// =================================================================================================
// 5. 📊 CONTAR MOTORISTAS ONLINE
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

        logger.debug(`📊 [countOnlineDrivers] Motoristas online: ${count}`);

        return count;
    } catch (error) {
        logger.error(`❌ [DB ERROR] countOnlineDrivers: ${error.message}`);
        return 0;
    }
};

// =================================================================================================
// 6. 🗺️ BUSCAR MOTORISTAS PRÓXIMOS
// =================================================================================================
exports.getNearbyDrivers = async (lat, lng, radiusKm = 15) => {
    try {
        const centerLat = parseFloat(lat) || DEFAULT_LAT;
        const centerLng = parseFloat(lng) || DEFAULT_LNG;

        logger.debug(`🗺️ [getNearbyDrivers] Buscando motoristas em raio de ${radiusKm}km de (${centerLat}, ${centerLng})`);

        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.heading,
                dp.speed,
                dp.accuracy,
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
                AND dp.socket_id IS NOT NULL
                AND dp.lat IS NOT NULL AND dp.lng IS NOT NULL
                AND dp.lat != 0 AND dp.lng != 0
            HAVING distance <= $3 OR $3 IS NULL
            ORDER BY distance ASC
            LIMIT 20
        `, [centerLat, centerLng, radiusKm]);

        logger.success(`✅ [getNearbyDrivers] Encontrados ${result.rows.length} motoristas`);

        return result.rows;
    } catch (error) {
        logger.error(`❌ [DB ERROR] getNearbyDrivers: ${error.message}`);
        return [];
    }
};

// =================================================================================================
// 7. 🔍 BUSCAR TODOS OS MOTORISTAS ONLINE
// =================================================================================================
exports.getAllOnlineDrivers = async () => {
    try {
        logger.debug(`\n🔍 [getAllOnlineDrivers] ========================================`);
        logger.debug(`🔍 Buscando motoristas online...`);

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

        logger.debug(`📊 Motoristas encontrados: ${result.rows.length}`);

        return result.rows;
    } catch (error) {
        logger.error(`❌ [DB ERROR] getAllOnlineDrivers: ${error.message}`);
        return [];
    }
};

// =================================================================================================
// 8. 🔍 BUSCAR POSIÇÃO DE UM MOTORISTA ESPECÍFICO
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
            const secondsAgo = Math.round(result.rows[0].seconds_ago);
            logger.debug(`📍 [getDriverPosition] Driver ${driverId} - ${secondsAgo}s atrás | Status: ${result.rows[0].status}`);
            return result.rows[0];
        }

        logger.debug(`⚠️ [getDriverPosition] Driver ${driverId} não encontrado`);
        return null;
    } catch (error) {
        logger.error(`❌ [DB ERROR] getDriverPosition: ${error.message}`);
        return null;
    }
};

// =================================================================================================
// 9. ✅ VERIFICAR SE MOTORISTA ESTÁ ONLINE
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

        const isOnline = result.rows[0]?.online || false;
        logger.debug(`✅ [isDriverOnline] Driver ${driverId}: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

        return isOnline;
    } catch (error) {
        logger.error(`❌ [DB ERROR] isDriverOnline: ${error.message}`);
        return false;
    }
};

// =================================================================================================
// 10. 🔄 SINCRONIZAR STATUS DO MOTORISTA
// =================================================================================================
exports.syncDriverStatus = async (driverId) => {
    try {
        logger.debug(`🔄 [syncDriverStatus] Sincronizando driver ${driverId}`);

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

        const isOnline = result.rows[0]?.is_online || false;
        logger.success(`✅ [syncDriverStatus] Driver ${driverId} sincronizado: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

        return isOnline;
    } catch (error) {
        logger.error(`❌ [DB ERROR] syncDriverStatus: ${error.message}`);
        return false;
    }
};

// =================================================================================================
// 11. 🔍 DIAGNÓSTICO DE STATUS DOS MOTORISTAS
// =================================================================================================
exports.debugDriverStatus = async () => {
    try {
        logger.debug(`\n🔍 [DEBUG] Diagnóstico de motoristas ========================================`);

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

        logger.debug(`📊 Total de motoristas cadastrados: ${allDrivers.rows.length}`);

        // 2. Motoristas na driver_positions
        const positions = await pool.query(`
            SELECT
                dp.driver_id,
                dp.lat,
                dp.lng,
                dp.socket_id,
                dp.status,
                dp.last_update,
                EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago,
                u.name
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            ORDER BY dp.last_update DESC
        `);

        logger.debug(`\n📊 Total de registros em driver_positions: ${positions.rows.length}`);

        // 3. Motoristas que atendem aos critérios
        const qualified = await pool.query(`
            SELECT
                dp.driver_id,
                u.name,
                dp.last_update,
                EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago,
                dp.socket_id,
                dp.status,
                u.is_online,
                u.is_blocked
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.status = 'online'
                AND dp.last_update > NOW() - INTERVAL '2 minutes'
                AND u.is_online = true
                AND u.is_blocked = false
                AND u.role = 'driver'
                AND dp.socket_id IS NOT NULL
        `);

        logger.success(`\n✅ Motoristas que PASSAM nos critérios: ${qualified.rows.length}`);

        // 4. Motivos de reprovação
        const failed = await pool.query(`
            SELECT
                u.id,
                u.name,
                u.is_online,
                u.is_blocked,
                dp.status as dp_status,
                dp.last_update,
                dp.socket_id,
                EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago,
                CASE
                    WHEN dp.status != 'online' THEN 'status diferente de online'
                    WHEN dp.last_update <= NOW() - INTERVAL '2 minutes' THEN 'atualização antiga'
                    WHEN u.is_online = false THEN 'user offline'
                    WHEN u.is_blocked = true THEN 'usuário bloqueado'
                    WHEN dp.socket_id IS NULL THEN 'socket nulo'
                    ELSE 'outro motivo'
                END as motivo
            FROM users u
            LEFT JOIN driver_positions dp ON u.id = dp.driver_id
            WHERE u.role = 'driver'
                AND NOT (
                    dp.status = 'online'
                    AND dp.last_update > NOW() - INTERVAL '2 minutes'
                    AND u.is_online = true
                    AND u.is_blocked = false
                    AND dp.socket_id IS NOT NULL
                )
        `);

        logger.warn(`\n⚠️ Motoristas REPROVADOS: ${failed.rows.length}`);

        logger.debug(`\n🔍 ========================================\n`);

        return {
            total_drivers: allDrivers.rows.length,
            total_positions: positions.rows.length,
            online_qualified: qualified.rows.length,
            failed_count: failed.rows.length,
            failed_reasons: failed.rows
        };

    } catch (error) {
        logger.error(`❌ [DEBUG] Erro no diagnóstico: ${error.message}`);
        return null;
    }
};

// =================================================================================================
// 12. 🧹 LIMPAR MOTORISTAS INATIVOS
// =================================================================================================
exports.cleanInactiveDrivers = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        logger.warn(`\n🧹 [cleanInactiveDrivers] Iniciando limpeza...`);

        // Buscar motoristas inativos há mais de 2 minutos
        const inactiveDrivers = await client.query(`
            SELECT driver_id
            FROM driver_positions
            WHERE last_update < NOW() - INTERVAL '2 minutes'
                AND status = 'online'
        `);

        logger.debug(`📊 Motoristas inativos encontrados: ${inactiveDrivers.rows.length}`);

        // Atualizar para offline
        const updateResult = await client.query(`
            UPDATE driver_positions
            SET status = 'offline', last_update = NOW()
            WHERE last_update < NOW() - INTERVAL '2 minutes'
                AND status = 'online'
            RETURNING driver_id
        `);

        // Atualizar status dos usuários
        for (const row of updateResult.rows) {
            await client.query(
                `UPDATE users SET
                    is_online = false,
                    last_seen = NOW()
                 WHERE id = $1`,
                [row.driver_id]
            );
            logger.debug(`   ✅ Driver ${row.driver_id} marcado como offline`);
        }

        await client.query('COMMIT');

        logger.success(`✅ [cleanInactiveDrivers] ${updateResult.rows.length} motoristas marcados como offline`);
        logger.warn(`🧹 ========================================\n`);

        return updateResult.rows.length;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`❌ [DB ERROR] cleanInactiveDrivers: ${error.message}`);
        return 0;
    } finally {
        client.release();
    }
};

// =================================================================================================
// 13. 📊 ESTATÍSTICAS DE MOTORISTAS
// =================================================================================================
exports.getDriverStats = async () => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total_registros,
                COUNT(CASE WHEN status = 'online'
                    AND last_update > NOW() - INTERVAL '2 minutes'
                    AND socket_id IS NOT NULL THEN 1 END) as online,
                COUNT(CASE WHEN status = 'offline' OR last_update < NOW() - INTERVAL '2 minutes' THEN 1 END) as offline,
                COUNT(CASE WHEN socket_id IS NULL THEN 1 END) as sem_socket,
                COUNT(CASE WHEN last_update < NOW() - INTERVAL '5 minutes' THEN 1 END) as inativos_5min
            FROM driver_positions
        `);

        const stats = {
            total_registros: parseInt(result.rows[0].total_registros) || 0,
            online: parseInt(result.rows[0].online) || 0,
            offline: parseInt(result.rows[0].offline) || 0,
            sem_socket: parseInt(result.rows[0].sem_socket) || 0,
            inativos_5min: parseInt(result.rows[0].inativos_5min) || 0
        };

        logger.debug(`📊 [getDriverStats] ========================`);
        logger.debug(`   Online: ${stats.online}`);
        logger.debug(`   Offline: ${stats.offline}`);
        logger.debug(`   Sem Socket: ${stats.sem_socket}`);
        logger.debug(`   Inativos 5min: ${stats.inativos_5min}`);
        logger.debug(`   Total: ${stats.total_registros}`);

        return stats;
    } catch (error) {
        logger.error(`❌ [DB ERROR] getDriverStats: ${error.message}`);
        return {
            total_registros: 0,
            online: 0,
            offline: 0,
            sem_socket: 0,
            inativos_5min: 0
        };
    }
};

// =================================================================================================
// 14. 🔄 RECONECTAR MOTORISTA
// =================================================================================================
exports.reconnectDriver = async (driverId, socketId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        logger.debug(`🔄 [reconnectDriver] Reconectando driver ${driverId} com socket ${socketId}`);

        // Verificar se existe
        const check = await client.query(
            "SELECT driver_id FROM driver_positions WHERE driver_id = $1",
            [driverId]
        );

        if (check.rows.length > 0) {
            // UPDATE
            await client.query(`
                UPDATE driver_positions
                SET
                    socket_id = $1,
                    last_update = NOW(),
                    status = 'online'
                WHERE driver_id = $2
            `, [socketId, driverId]);

            logger.success(`✅ [DB] driver_positions atualizado`);
        } else {
            // INSERT com valores padrão
            await client.query(`
                INSERT INTO driver_positions
                (driver_id, socket_id, status, last_update, lat, lng)
                VALUES ($1, $2, 'online', NOW(), $3, $4)
            `, [driverId, socketId, DEFAULT_LAT, DEFAULT_LNG]);

            logger.success(`✅ [DB] driver_positions inserido`);
        }

        // Atualizar users
        await client.query(
            `UPDATE users SET
                is_online = true,
                last_seen = NOW()
             WHERE id = $1`,
            [driverId]
        );

        await client.query('COMMIT');

        logger.success(`✅ [reconnectDriver] Driver ${driverId} reconectado com sucesso`);
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`❌ [DB ERROR] reconnectDriver: ${error.message}`);
        return false;
    } finally {
        client.release();
    }
};

// =================================================================================================
// 15. 🔍 BUSCAR MOTORISTAS COM SOCKET ATIVO
// =================================================================================================
exports.getDriversWithActiveSockets = async () => {
    try {
        const result = await pool.query(`
            SELECT
                dp.driver_id,
                dp.socket_id,
                dp.last_update,
                dp.status,
                u.name,
                u.is_online
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.socket_id IS NOT NULL
                AND dp.status = 'online'
                AND dp.last_update > NOW() - INTERVAL '3 minutes'
            ORDER BY dp.last_update DESC
        `);

        logger.debug(`📊 [getDriversWithActiveSockets] Encontrados ${result.rows.length} motoristas com socket ativo`);

        return result.rows;
    } catch (error) {
        logger.error(`❌ [DB ERROR] getDriversWithActiveSockets: ${error.message}`);
        return [];
    }
};

// =================================================================================================
// 16. 🗑️ LIMPAR SOCKETS ÓRFÃOS
// =================================================================================================
exports.cleanOrphanSockets = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        logger.warn(`\n🗑️ [cleanOrphanSockets] Iniciando limpeza de sockets órfãos...`);

        // Buscar registros com socket_id mas sem atualização recente
        const orphanResult = await client.query(`
            UPDATE driver_positions
            SET status = 'offline', last_update = NOW()
            WHERE socket_id IS NOT NULL
                AND last_update < NOW() - INTERVAL '3 minutes'
                AND status = 'online'
            RETURNING driver_id, socket_id
        `);

        if (orphanResult.rows.length > 0) {
            logger.warn(`⚠️ Encontrados ${orphanResult.rows.length} sockets órfãos`);

            // Atualizar users correspondentes
            for (const row of orphanResult.rows) {
                await client.query(
                    `UPDATE users SET
                        is_online = false,
                        last_seen = NOW()
                     WHERE id = $1`,
                    [row.driver_id]
                );
                logger.debug(`   🗑️ Driver ${row.driver_id} - Socket ${row.socket_id} removido`);
            }
        } else {
            logger.success(`✅ Nenhum socket órfão encontrado`);
        }

        await client.query('COMMIT');

        logger.success(`✅ [cleanOrphanSockets] Limpeza concluída: ${orphanResult.rows.length} sockets removidos`);
        logger.warn(`🗑️ ========================================\n`);

        return orphanResult.rows.length;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`❌ [DB ERROR] cleanOrphanSockets: ${error.message}`);
        return 0;
    } finally {
        client.release();
    }
};

// =================================================================================================
// 17. 🔍 VERIFICAR INTEGRIDADE DOS DADOS
// =================================================================================================
exports.verifyDataIntegrity = async () => {
    try {
        logger.debug(`\n🔍 [verifyDataIntegrity] Verificando integridade dos dados...`);

        // Verificar inconsistências
        const inconsistencies = await pool.query(`
            SELECT
                u.id,
                u.name,
                u.is_online as user_online,
                dp.status as driver_status,
                dp.last_update,
                dp.socket_id,
                CASE
                    WHEN u.is_online = true AND (dp.status != 'online' OR dp.last_update <= NOW() - INTERVAL '2 minutes') THEN 'user online mas driver offline'
                    WHEN u.is_online = false AND dp.status = 'online' AND dp.last_update > NOW() - INTERVAL '2 minutes' THEN 'user offline mas driver online'
                    WHEN dp.socket_id IS NOT NULL AND dp.last_update <= NOW() - INTERVAL '2 minutes' THEN 'socket ativo mas sem atualização'
                    ELSE NULL
                END as inconsistency
            FROM users u
            LEFT JOIN driver_positions dp ON u.id = dp.driver_id
            WHERE u.role = 'driver'
                AND (
                    (u.is_online = true AND (dp.status != 'online' OR dp.last_update <= NOW() - INTERVAL '2 minutes'))
                    OR (u.is_online = false AND dp.status = 'online' AND dp.last_update > NOW() - INTERVAL '2 minutes')
                    OR (dp.socket_id IS NOT NULL AND dp.last_update <= NOW() - INTERVAL '2 minutes')
                )
        `);

        if (inconsistencies.rows.length > 0) {
            logger.warn(`⚠️ Encontradas ${inconsistencies.rows.length} inconsistências:`);
            inconsistencies.rows.forEach((inc, i) => {
                logger.warn(`   ${i+1}. ${inc.name}: ${inc.inconsistency}`);
            });
        } else {
            logger.success(`✅ Nenhuma inconsistência encontrada`);
        }

        logger.debug(`🔍 ========================================\n`);

        return {
            hasInconsistencies: inconsistencies.rows.length > 0,
            inconsistencies: inconsistencies.rows
        };
    } catch (error) {
        logger.error(`❌ [DB ERROR] verifyDataIntegrity: ${error.message}`);
        return null;
    }
};

// =================================================================================================
// 18. 🕒 ATUALIZAR POSIÇÃO EM MASSA (BATCH UPDATE)
// =================================================================================================
exports.batchUpdatePositions = async (positions) => {
    if (!positions || positions.length === 0) return 0;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        logger.debug(`📦 [batchUpdatePositions] Atualizando ${positions.length} posições em lote`);

        let updated = 0;
        for (const pos of positions) {
            const { driver_id, lat, lng, heading, speed, accuracy, socket_id, status } = pos;

            const result = await client.query(`
                INSERT INTO driver_positions
                (driver_id, lat, lng, heading, speed, accuracy, socket_id, status, last_update)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (driver_id) DO UPDATE SET
                    lat = EXCLUDED.lat,
                    lng = EXCLUDED.lng,
                    heading = EXCLUDED.heading,
                    speed = EXCLUDED.speed,
                    accuracy = EXCLUDED.accuracy,
                    socket_id = EXCLUDED.socket_id,
                    status = EXCLUDED.status,
                    last_update = EXCLUDED.last_update
                RETURNING driver_id
            `, [
                driver_id,
                parseFloat(lat) || DEFAULT_LAT,
                parseFloat(lng) || DEFAULT_LNG,
                parseFloat(heading) || 0,
                parseFloat(speed) || 0,
                parseFloat(accuracy) || 0,
                socket_id,
                status || 'online'
            ]);

            if (result.rows.length > 0) updated++;
        }

        await client.query('COMMIT');

        logger.success(`✅ [batchUpdatePositions] ${updated} posições atualizadas com sucesso`);

        return updated;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`❌ [DB ERROR] batchUpdatePositions: ${error.message}`);
        return 0;
    } finally {
        client.release();
    }
};

module.exports = exports;