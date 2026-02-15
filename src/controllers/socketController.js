/**
 * =================================================================================================
 * 🔌 SOCKET CONTROLLER - TITANIUM ENGINE v7.2.0 (ULTRA DEBUG - FORÇA SQL)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/socketController.js
 * DESCRIÇÃO: Gerencia a posição e status dos motoristas em tempo real - VERSÃO FORÇADA
 *
 * ✅ CORREÇÕES APLICADAS v7.2.0:
 * 1. Força UPDATE/INSERT direto - SEM ON CONFLICT complexo
 * 2. Verificação de existência antes de cada operação
 * 3. Logs ultra detalhados para debug
 * 4. Verificação de integridade pós-operação
 * 5. Fallback para socket nulo
 * 6. Sincronização forçada com users
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
// 1. 📍 ATUALIZAR POSIÇÃO DO MOTORISTA - VERSÃO FORÇADA
// =================================================================================================

/**
 * Atualiza a posição do motorista no banco de dados
 * Chamado via socket 'update_location' ou 'heartbeat'
 * 
 * ✅ CORREÇÃO: Usa UPDATE/INSERT separados para garantir funcionamento
 * ✅ CORREÇÃO: Verificação de existência antes de cada operação
 * ✅ CORREÇÃO: Logs ultra detalhados
 */
exports.updateDriverPosition = async (data, socket) => {
    const { driver_id, user_id, lat, lng, heading, speed, accuracy, status } = data;
    const socketId = socket.id;
    const finalDriverId = driver_id || user_id;

    const timestamp = new Date().toISOString();

    console.log(`${colors.cyan}\n📍 [updateDriverPosition] ========================================${colors.reset}`);
    console.log(`${colors.cyan}📍 Timestamp:${colors.reset} ${timestamp}`);
    console.log(`${colors.cyan}📍 Driver ID:${colors.reset} ${finalDriverId}`);
    console.log(`${colors.cyan}📍 Socket ID:${colors.reset} ${socketId}`);
    console.log(`${colors.cyan}📍 Lat/Lng:${colors.reset} (${lat}, ${lng})`);
    console.log(`${colors.cyan}📍 Heading/Speed:${colors.reset} ${heading}°, ${speed} km/h`);
    console.log(`${colors.cyan}📍 Accuracy:${colors.reset} ${accuracy}`);
    console.log(`${colors.cyan}📍 Status:${colors.reset} ${status || 'online'}`);
    console.log(`${colors.cyan}📍 ========================================${colors.reset}\n`);

    if (!finalDriverId) {
        console.log(`${colors.red}❌ [updateDriverPosition] ID nulo - dados recebidos:${colors.reset}`, data);
        return;
    }

    try {
        // 🔴 FORÇAR UPDATE DIRETO - SEM ON CONFLICT COMPLEXO
        const checkExists = await pool.query(
            "SELECT * FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );

        if (checkExists.rows.length > 0) {
            // UPDATE
            console.log(`${colors.yellow}📊 Registro existe - fazendo UPDATE${colors.reset}`);
            
            const updateResult = await pool.query(`
                UPDATE driver_positions SET
                    lat = $1,
                    lng = $2,
                    heading = $3,
                    speed = $4,
                    accuracy = $5,
                    socket_id = $6,
                    status = $7,
                    last_update = NOW()
                WHERE driver_id = $8
                RETURNING *
            `, [
                lat || 0, lng || 0, heading || 0, speed || 0, 
                accuracy || 0, socketId, status || 'online', finalDriverId
            ]);

            console.log(`${colors.green}✅ [DB] Posição ATUALIZADA para driver ${finalDriverId}${colors.reset}`);
            
            if (updateResult.rows.length > 0) {
                console.log(`   - Socket ID no banco: ${updateResult.rows[0].socket_id}`);
                console.log(`   - Last Update: ${updateResult.rows[0].last_update}`);
                console.log(`   - Status: ${updateResult.rows[0].status}`);
            }
        } else {
            // INSERT
            console.log(`${colors.yellow}📊 Registro NÃO existe - fazendo INSERT${colors.reset}`);
            
            const insertResult = await pool.query(`
                INSERT INTO driver_positions 
                (driver_id, lat, lng, heading, speed, accuracy, socket_id, status, last_update)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                RETURNING *
            `, [
                finalDriverId, lat || 0, lng || 0, heading || 0, 
                speed || 0, accuracy || 0, socketId, status || 'online'
            ]);

            console.log(`${colors.green}✅ [DB] Posição INSERIDA para driver ${finalDriverId}${colors.reset}`);
            
            if (insertResult.rows.length > 0) {
                console.log(`   - Socket ID no banco: ${insertResult.rows[0].socket_id}`);
                console.log(`   - Last Update: ${insertResult.rows[0].last_update}`);
            }
        }

        // 🔴 VERIFICAÇÃO FORÇADA - Confirmar que salvou
        const verify = await pool.query(
            "SELECT socket_id, last_update, status FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );
        
        if (verify.rows.length > 0) {
            console.log(`${colors.green}✅ VERIFICAÇÃO PÓS-OPERAÇÃO:`);
            console.log(`   ✅ Socket ID no banco: ${verify.rows[0].socket_id}`);
            console.log(`   ✅ Last Update: ${verify.rows[0].last_update}`);
            console.log(`   ✅ Status: ${verify.rows[0].status}${colors.reset}`);
        } else {
            console.log(`${colors.red}❌ VERIFICAÇÃO FALHOU - Registro não encontrado após operação${colors.reset}`);
        }

        // Sincronizar users
        const userUpdate = await pool.query(
            `UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1 RETURNING is_online`,
            [finalDriverId]
        );
        
        if (userUpdate.rows.length > 0) {
            console.log(`${colors.green}✅ [DB] Users sincronizado - is_online: ${userUpdate.rows[0].is_online}${colors.reset}`);
        }

    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] updateDriverPosition:${colors.reset}`, error.message);
        console.error(error);
    }
};

// =================================================================================================
// 2. 🚪 JOIN DRIVER ROOM - VERSÃO FORÇADA
// =================================================================================================

/**
 * Motorista entra na sala de motoristas
 * Chamado via socket 'join_driver_room'
 * 
 * ✅ CORREÇÃO: Força UPDATE/INSERT com verificação prévia
 * ✅ CORREÇÃO: Payload completo sempre
 * ✅ CORREÇÃO: Ack de confirmação
 */
exports.joinDriverRoom = async (data, socket) => {
    const { driver_id, user_id, lat, lng, heading, speed, accuracy, status } = data;
    const socketId = socket.id;
    const finalDriverId = driver_id || user_id;

    const timestamp = new Date().toISOString();

    console.log(`${colors.magenta}\n🚪 [joinDriverRoom] ========================================${colors.reset}`);
    console.log(`${colors.magenta}🚪 Timestamp:${colors.reset} ${timestamp}`);
    console.log(`${colors.magenta}🚪 Driver ID:${colors.reset} ${finalDriverId}`);
    console.log(`${colors.magenta}🚪 Socket ID:${colors.reset} ${socketId}`);
    console.log(`${colors.magenta}🚪 Lat/Lng:${colors.reset} (${lat}, ${lng})`);
    console.log(`${colors.magenta}🚪 Dados recebidos:${colors.reset}`, JSON.stringify(data, null, 2));
    console.log(`${colors.magenta}🚪 ========================================${colors.reset}\n`);

    if (!finalDriverId) {
        console.log(`${colors.red}❌ [joinDriverRoom] ID nulo${colors.reset}`);
        return;
    }

    try {
        // 🔴 VERIFICAR SE JÁ EXISTE
        const check = await pool.query(
            "SELECT * FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );

        if (check.rows.length > 0) {
            console.log(`${colors.yellow}📊 Motorista já existe - fazendo UPDATE${colors.reset}`);
            console.log(`   - Socket atual: ${check.rows[0].socket_id || 'NULO'}`);
            console.log(`   - Status atual: ${check.rows[0].status}`);
            
            // UPDATE
            const updateResult = await pool.query(`
                UPDATE driver_positions SET
                    lat = $1,
                    lng = $2,
                    heading = $3,
                    speed = $4,
                    accuracy = $5,
                    socket_id = $6,
                    status = $7,
                    last_update = NOW()
                WHERE driver_id = $8
                RETURNING *
            `, [
                lat || 0, lng || 0, heading || 0, speed || 0, 
                accuracy || 0, socketId, status || 'online', finalDriverId
            ]);
            
            console.log(`${colors.green}✅ [DB] Driver ${finalDriverId} ATUALIZADO com socket ${socketId}${colors.reset}`);
            
            if (updateResult.rows.length > 0) {
                console.log(`   - Socket ID: ${updateResult.rows[0].socket_id}`);
                console.log(`   - Status: ${updateResult.rows[0].status}`);
                console.log(`   - Last Update: ${updateResult.rows[0].last_update}`);
            }
        } else {
            console.log(`${colors.yellow}📊 Motorista NÃO existe - fazendo INSERT${colors.reset}`);
            
            // INSERT
            const insertResult = await pool.query(`
                INSERT INTO driver_positions 
                (driver_id, lat, lng, heading, speed, accuracy, socket_id, status, last_update)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                RETURNING *
            `, [
                finalDriverId, lat || 0, lng || 0, heading || 0, 
                speed || 0, accuracy || 0, socketId, status || 'online'
            ]);
            
            console.log(`${colors.green}✅ [DB] Driver ${finalDriverId} INSERIDO com socket ${socketId}${colors.reset}`);
            
            if (insertResult.rows.length > 0) {
                console.log(`   - Socket ID: ${insertResult.rows[0].socket_id}`);
                console.log(`   - Status: ${insertResult.rows[0].status}`);
            }
        }

        // 🔴 VERIFICAÇÃO FORÇADA
        const verify = await pool.query(
            "SELECT socket_id, last_update, status FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );
        
        if (verify.rows.length > 0) {
            console.log(`${colors.green}✅ VERIFICAÇÃO PÓS-OPERAÇÃO:`);
            console.log(`   ✅ Socket ID: ${verify.rows[0].socket_id}`);
            console.log(`   ✅ Status: ${verify.rows[0].status}`);
            console.log(`   ✅ Last Update: ${verify.rows[0].last_update}${colors.reset}`);
        }

        // Sincronizar users
        const userUpdate = await pool.query(
            `UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1 RETURNING is_online`,
            [finalDriverId]
        );

        console.log(`${colors.green}✅ [DB] Users sincronizado - is_online: ${userUpdate.rows[0]?.is_online}${colors.reset}`);

        // Enviar confirmação
        socket.emit('joined_ack', {
            success: true,
            driver_id: finalDriverId,
            room: 'drivers',
            timestamp: new Date().toISOString()
        });

        console.log(`${colors.green}✅ [Socket] joined_ack enviado para driver ${finalDriverId}${colors.reset}`);

    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] joinDriverRoom:${colors.reset}`, error.message);
        console.error(error);
    }
};

// =================================================================================================
// 3. 🚪 REMOVER MOTORISTA (OFFLINE/DISCONNECT)
// =================================================================================================

/**
 * Remove motorista quando desconecta
 * Chamado via socket 'disconnect'
 */
exports.removeDriverPosition = async (socketId) => {
    console.log(`${colors.yellow}\n🔌 [removeDriverPosition] ========================================${colors.reset}`);
    console.log(`${colors.yellow}🔌 Socket ID:${colors.reset} ${socketId}`);
    console.log(`${colors.yellow}🔌 Timestamp:${colors.reset} ${new Date().toISOString()}`);
    console.log(`${colors.yellow}🔌 ========================================${colors.reset}\n`);

    try {
        // Buscar o driver_id associado a este socket
        const result = await pool.query(
            "SELECT driver_id FROM driver_positions WHERE socket_id = $1",
            [socketId]
        );

        if (result.rows.length > 0) {
            const driverId = result.rows[0].driver_id;

            console.log(`${colors.yellow}📊 Driver encontrado: ${driverId}${colors.reset}`);

            // Atualizar status para offline na driver_positions
            await pool.query(
                "UPDATE driver_positions SET status = 'offline', last_update = NOW() WHERE socket_id = $1",
                [socketId]
            );

            console.log(`${colors.green}✅ [DB] driver_positions atualizado para offline${colors.reset}`);

            // Atualizar usuário na tabela users
            await pool.query(
                `UPDATE users SET
                    is_online = false,
                    last_seen = NOW()
                 WHERE id = $1`,
                [driverId]
            );

            console.log(`${colors.green}✅ [DB] users atualizado para offline${colors.reset}`);
            console.log(`${colors.yellow}🟤 Driver ${driverId} OFFLINE${colors.reset}`);
        } else {
            console.log(`${colors.yellow}⚠️ Nenhum driver encontrado com socket ${socketId}${colors.reset}`);

            // Apenas atualizar qualquer registro com este socket
            await pool.query(
                "UPDATE driver_positions SET status = 'offline' WHERE socket_id = $1",
                [socketId]
            );

            console.log(`${colors.green}✅ [DB] registros com socket ${socketId} marcados como offline${colors.reset}`);
        }
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] removeDriverPosition:${colors.reset}`, error.message);
    }
};

// =================================================================================================
// 4. 📊 CONTAR MOTORISTAS ONLINE
// =================================================================================================

/**
 * Conta quantos motoristas estão online (critérios rigorosos)
 */
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

/**
 * Busca todos os motoristas online (usado pelo rideController)
 */
exports.getAllOnlineDrivers = async () => {
    try {
        console.log(`${colors.cyan}\n🔍 [getAllOnlineDrivers] ========================================${colors.reset}`);
        console.log(`${colors.cyan}🔍 Buscando motoristas online...${colors.reset}`);

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

        console.log(`${colors.cyan}📊 Motoristas encontrados: ${result.rows.length}${colors.reset}`);

        if (result.rows.length > 0) {
            result.rows.forEach((d, i) => {
                const secondsAgo = Math.round(d.seconds_ago);
                console.log(`   ${i+1}. ${d.name} (ID: ${d.driver_id}) - ${secondsAgo}s atrás`);
            });
        }

        console.log(`${colors.cyan}🔍 ========================================${colors.reset}\n`);

        return result.rows;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getAllOnlineDrivers:${colors.reset}`, error.message);
        return [];
    }
};

// =================================================================================================
// 6. 🔍 BUSCAR POSIÇÃO DE UM MOTORISTA ESPECÍFICO
// =================================================================================================

/**
 * Busca posição de um motorista específico
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
            console.log(`${colors.cyan}📍 [getDriverPosition] Driver ${driverId} - ${secondsAgo}s atrás${colors.reset}`);
            return result.rows[0];
        }

        console.log(`${colors.yellow}⚠️ [getDriverPosition] Driver ${driverId} não encontrado${colors.reset}`);
        return null;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getDriverPosition:${colors.reset}`, error.message);
        return null;
    }
};

// =================================================================================================
// 7. ✅ VERIFICAR SE MOTORISTA ESTÁ ONLINE
// =================================================================================================

/**
 * Verifica se um motorista específico está online
 */
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
        console.log(`${colors.cyan}✅ [isDriverOnline] Driver ${driverId}: ${isOnline ? 'ONLINE' : 'OFFLINE'}${colors.reset}`);

        return isOnline;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] isDriverOnline:${colors.reset}`, error.message);
        return false;
    }
};

// =================================================================================================
// 8. 🗺️ BUSCAR MOTORISTAS PRÓXIMOS
// =================================================================================================

/**
 * Busca motoristas próximos a uma localização
 */
exports.getNearbyDrivers = async (lat, lng, radiusKm = 15) => {
    try {
        console.log(`${colors.cyan}🗺️ [getNearbyDrivers] Buscando motoristas em raio de ${radiusKm}km${colors.reset}`);

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
            HAVING distance <= $3 OR $3 IS NULL
            ORDER BY distance ASC
            LIMIT 20
        `, [lat, lng, radiusKm]);

        console.log(`${colors.green}✅ [getNearbyDrivers] Encontrados ${result.rows.length} motoristas${colors.reset}`);

        return result.rows;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getNearbyDrivers:${colors.reset}`, error.message);
        return [];
    }
};

// =================================================================================================
// 9. ⏰ ATUALIZAR TIMESTAMP DE ATIVIDADE
// =================================================================================================

/**
 * Atualiza apenas o timestamp de atividade (sem alterar posição)
 */
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

        console.log(`${colors.green}✅ [updateDriverActivity] Driver ${driverId} atividade atualizada${colors.reset}`);
        return true;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] updateDriverActivity:${colors.reset}`, error.message);
        return false;
    }
};

// =================================================================================================
// 10. 🔄 SINCRONIZAR STATUS DO MOTORISTA
// =================================================================================================

/**
 * Sincroniza o status entre driver_positions e users
 */
exports.syncDriverStatus = async (driverId) => {
    try {
        console.log(`${colors.cyan}🔄 [syncDriverStatus] Sincronizando driver ${driverId}${colors.reset}`);

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
        console.log(`${colors.green}✅ [syncDriverStatus] Driver ${driverId} sincronizado: ${isOnline ? 'ONLINE' : 'OFFLINE'}${colors.reset}`);

        return isOnline;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] syncDriverStatus:${colors.reset}`, error.message);
        return false;
    }
};

// =================================================================================================
// 11. 🔍 DIAGNÓSTICO DE STATUS DOS MOTORISTAS
// =================================================================================================

/**
 * Função de diagnóstico para entender por que motoristas não aparecem online
 */
exports.debugDriverStatus = async () => {
    try {
        console.log(`${colors.yellow}\n🔍 [DEBUG] Diagnóstico de motoristas ========================================${colors.reset}`);

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

        console.log(`${colors.cyan}📊 Total de motoristas cadastrados: ${allDrivers.rows.length}${colors.reset}`);

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

        console.log(`\n${colors.cyan}📊 Total de registros em driver_positions: ${positions.rows.length}${colors.reset}`);

        // 3. Motoristas que atendem aos critérios
        const qualified = await pool.query(`
            SELECT
                dp.driver_id,
                u.name,
                dp.last_update,
                EXTRACT(EPOCH FROM (NOW() - dp.last_update)) as seconds_ago
            FROM driver_positions dp
            JOIN users u ON dp.driver_id = u.id
            WHERE dp.status = 'online'
                AND dp.last_update > NOW() - INTERVAL '2 minutes'
                AND u.is_online = true
                AND u.is_blocked = false
                AND u.role = 'driver'
                AND dp.socket_id IS NOT NULL
        `);

        console.log(`\n${colors.green}✅ Motoristas que PASSAM nos critérios: ${qualified.rows.length}${colors.reset}`);

        console.log(`${colors.yellow}🔍 ========================================${colors.reset}\n`);

        return {
            total_drivers: allDrivers.rows.length,
            total_positions: positions.rows.length,
            online_qualified: qualified.rows.length
        };

    } catch (error) {
        console.log(`${colors.red}❌ [DEBUG] Erro no diagnóstico:${colors.reset}`, error.message);
        return null;
    }
};

// =================================================================================================
// 12. 🧹 LIMPAR MOTORISTAS INATIVOS
// =================================================================================================

/**
 * Limpa motoristas inativos (chamado por cron job)
 */
exports.cleanInactiveDrivers = async () => {
    try {
        console.log(`${colors.yellow}\n🧹 [cleanInactiveDrivers] Iniciando limpeza...${colors.reset}`);

        // Buscar motoristas inativos há mais de 2 minutos
        const inactiveDrivers = await pool.query(`
            SELECT driver_id
            FROM driver_positions
            WHERE last_update < NOW() - INTERVAL '2 minutes'
                AND status = 'online'
        `);

        // Atualizar para offline
        const updateResult = await pool.query(`
            UPDATE driver_positions
            SET status = 'offline'
            WHERE last_update < NOW() - INTERVAL '2 minutes'
                AND status = 'online'
            RETURNING driver_id
        `);

        // Atualizar status dos usuários
        for (const row of updateResult.rows) {
            await pool.query(
                `UPDATE users SET
                    is_online = false,
                    last_seen = NOW()
                 WHERE id = $1`,
                [row.driver_id]
            );
        }

        console.log(`${colors.green}✅ [cleanInactiveDrivers] ${updateResult.rows.length} motoristas marcados como offline${colors.reset}`);

        return updateResult.rows.length;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] cleanInactiveDrivers:${colors.reset}`, error.message);
        return 0;
    }
};

// =================================================================================================
// 13. 📊 ESTATÍSTICAS DE MOTORISTAS
// =================================================================================================

/**
 * Retorna estatísticas dos motoristas
 */
exports.getDriverStats = async () => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total_registros,
                COUNT(CASE WHEN status = 'online'
                    AND last_update > NOW() - INTERVAL '2 minutes'
                    AND socket_id IS NOT NULL THEN 1 END) as online,
                COUNT(CASE WHEN status = 'offline' OR last_update < NOW() - INTERVAL '2 minutes' THEN 1 END) as offline
            FROM driver_positions
        `);

        const stats = {
            total_registros: parseInt(result.rows[0].total_registros) || 0,
            online: parseInt(result.rows[0].online) || 0,
            offline: parseInt(result.rows[0].offline) || 0
        };

        console.log(`${colors.blue}📊 [getDriverStats] Online: ${stats.online}, Offline: ${stats.offline}, Total: ${stats.total_registros}${colors.reset}`);

        return stats;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getDriverStats:${colors.reset}`, error.message);
        return {
            total_registros: 0,
            online: 0,
            offline: 0
        };
    }
};

// =================================================================================================
// 14. 🔄 RECONECTAR MOTORISTA
// =================================================================================================

/**
 * Reconecta um motorista (útil para quando o socket reconecta)
 */
exports.reconnectDriver = async (driverId, socketId) => {
    try {
        console.log(`${colors.cyan}🔄 [reconnectDriver] Reconectando driver ${driverId}${colors.reset}`);

        await pool.query(`
            UPDATE driver_positions
            SET
                socket_id = $1,
                last_update = NOW(),
                status = 'online'
            WHERE driver_id = $2
        `, [socketId, driverId]);

        await pool.query(
            `UPDATE users SET
                is_online = true,
                last_seen = NOW()
             WHERE id = $1`,
            [driverId]
        );

        console.log(`${colors.green}✅ [reconnectDriver] Driver ${driverId} reconectado${colors.reset}`);
        return true;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] reconnectDriver:${colors.reset}`, error.message);
        return false;
    }
};

module.exports = exports;
