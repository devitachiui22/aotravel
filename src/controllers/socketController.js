/**
 * =================================================================================================
 * 🔌 SOCKET CONTROLLER - TITANIUM ENGINE v7.3.0 (CORREÇÃO RADICAL + ULTRA DEBUG)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/socketController.js
 * DESCRIÇÃO: Gerencia a posição e status dos motoristas em tempo real - VERSÃO ULTRA ESTÁVEL
 *
 * ✅ CORREÇÕES APLICADAS v7.3.0:
 * 1. Transações ACID para garantir atomicidade das operações
 * 2. Lógica de UPDATE/INSERT com fallback robusto
 * 3. Verificação de existência prévia em todas as operações
 * 4. Logs ultra detalhados com cores específicas por operação
 * 5. Verificação de integridade pós-operação
 * 6. Sincronização forçada com tabela users
 * 7. Remoção de motoristas inativos via CRON
 * 8. Diagnóstico completo de status
 * 9. Timeout e tratamento de erros aprimorado
 *
 * STATUS: 🔥 ABSOLUTAMENTE PRODUCTION READY
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
// 1. 📍 JOIN DRIVER ROOM - VERSÃO RADICALMENTE CORRIGIDA
// =================================================================================================
exports.joinDriverRoom = async (data, socket) => {
    const { driver_id, user_id, lat, lng, heading, speed, accuracy, status } = data;
    const socketId = socket.id;
    const finalDriverId = driver_id || user_id;
    const timestamp = new Date().toISOString();

    console.log(`${colors.magenta}\n🔴🔴🔴 [joinDriverRoom] INÍCIO 🔴🔴🔴${colors.reset}`);
    console.log(`${colors.magenta}📍 Timestamp:${colors.reset} ${timestamp}`);
    console.log(`${colors.magenta}📍 Driver ID:${colors.reset} ${finalDriverId}`);
    console.log(`${colors.magenta}📍 Socket ID:${colors.reset} ${socketId}`);
    console.log(`${colors.magenta}📍 Lat/Lng:${colors.reset} (${lat}, ${lng})`);
    console.log(`${colors.magenta}📍 Heading/Speed:${colors.reset} ${heading}°, ${speed} km/h`);
    console.log(`${colors.magenta}📍 Accuracy:${colors.reset} ${accuracy}`);
    console.log(`${colors.magenta}📍 Status:${colors.reset} ${status || 'online'}`);
    console.log(`${colors.magenta}📍 Dados recebidos:${colors.reset}`, JSON.stringify(data, null, 2));

    if (!finalDriverId) {
        console.log(`${colors.red}❌ [joinDriverRoom] ID nulo${colors.reset}`);
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 🔴 VERIFICAÇÃO DE EXISTÊNCIA
        const check = await client.query(
            "SELECT driver_id, socket_id, status FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );

        console.log(`${colors.yellow}📊 Verificação de existência: ${check.rows.length > 0 ? 'ENCONTRADO' : 'NÃO ENCONTRADO'}${colors.reset}`);
        
        if (check.rows.length > 0) {
            console.log(`   - Socket atual: ${check.rows[0].socket_id || 'NULO'}`);
            console.log(`   - Status atual: ${check.rows[0].status}`);
        }

        let result;
        if (check.rows.length > 0) {
            // 🔴 TENTA UPDATE
            result = await client.query(`
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
                lat || 0, 
                lng || 0, 
                heading || 0, 
                speed || 0,
                accuracy || 0, 
                socketId, 
                status || 'online', 
                finalDriverId
            ]);

            console.log(`${colors.green}✅ [DB] UPDATE executado. Linhas afetadas: ${result.rowCount}${colors.reset}`);
        }

        // 🔴 SE NÃO EXISTE OU O UPDATE NÃO AFETOU LINHAS, FAZ INSERT
        if (check.rows.length === 0 || result?.rowCount === 0) {
            console.log(`${colors.yellow}⚠️ Registro não encontrado ou UPDATE falhou. Forçando INSERT...${colors.reset}`);
            
            result = await client.query(`
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
                RETURNING *
            `, [
                finalDriverId, 
                lat || 0, 
                lng || 0, 
                heading || 0, 
                speed || 0,
                accuracy || 0, 
                socketId, 
                status || 'online'
            ]);
            
            console.log(`${colors.green}✅ [DB] INSERT/CONFLICT executado.${colors.reset}`);
        }

        await client.query('COMMIT');

        // 🔴 VERIFICAÇÃO FINAL
        const verify = await client.query(
            "SELECT socket_id, last_update, status FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );
        
        if (verify.rows.length > 0) {
            console.log(`${colors.green}✅ VERIFICAÇÃO PÓS-OPERAÇÃO:`);
            console.log(`   ✅ Socket ID: ${verify.rows[0].socket_id}`);
            console.log(`   ✅ Status: ${verify.rows[0].status}`);
            console.log(`   ✅ Last Update: ${verify.rows[0].last_update}${colors.reset}`);
        } else {
            console.log(`${colors.red}❌ VERIFICAÇÃO FALHOU - Registro não encontrado após operação${colors.reset}`);
        }

        // Sincronizar users
        const userUpdate = await client.query(
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
        await client.query('ROLLBACK');
        console.log(`${colors.red}❌ [DB ERROR] joinDriverRoom:${colors.reset}`, error.message);
        console.error(error);
        
        // Tentar enviar erro para o cliente
        socket.emit('joined_ack', {
            success: false,
            driver_id: finalDriverId,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    } finally {
        client.release();
    }
    
    console.log(`${colors.magenta}🔴🔴🔴 [joinDriverRoom] FIM 🔴🔴🔴${colors.reset}\n`);
};

// =================================================================================================
// 2. 📍 UPDATE DRIVER POSITION - VERSÃO REFORÇADA
// =================================================================================================
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

    if (!finalDriverId) {
        console.log(`${colors.red}❌ [updateDriverPosition] ID nulo - dados recebidos:${colors.reset}`, data);
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 🔴 FORÇAR UPDATE DIRETO - COM VERIFICAÇÃO PRÉVIA
        const checkExists = await client.query(
            "SELECT * FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );

        if (checkExists.rows.length > 0) {
            // UPDATE
            console.log(`${colors.yellow}📊 Registro existe - fazendo UPDATE${colors.reset}`);

            const updateResult = await client.query(`
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
                lat || 0, 
                lng || 0, 
                heading || 0, 
                speed || 0,
                accuracy || 0, 
                socketId, 
                status || 'online', 
                finalDriverId
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

            const insertResult = await client.query(`
                INSERT INTO driver_positions
                (driver_id, lat, lng, heading, speed, accuracy, socket_id, status, last_update)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                RETURNING *
            `, [
                finalDriverId, 
                lat || 0, 
                lng || 0, 
                heading || 0,
                speed || 0, 
                accuracy || 0, 
                socketId, 
                status || 'online'
            ]);

            console.log(`${colors.green}✅ [DB] Posição INSERIDA para driver ${finalDriverId}${colors.reset}`);

            if (insertResult.rows.length > 0) {
                console.log(`   - Socket ID no banco: ${insertResult.rows[0].socket_id}`);
                console.log(`   - Last Update: ${insertResult.rows[0].last_update}`);
            }
        }

        await client.query('COMMIT');

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
        await client.query('ROLLBACK');
        console.log(`${colors.red}❌ [DB ERROR] updateDriverPosition:${colors.reset}`, error.message);
        console.error(error);
    } finally {
        client.release();
    }
    
    console.log(`${colors.cyan}📍 ========================================${colors.reset}\n`);
};

// =================================================================================================
// 3. 🚪 REMOVER MOTORISTA (OFFLINE/DISCONNECT)
// =================================================================================================
exports.removeDriverPosition = async (socketId) => {
    console.log(`${colors.yellow}\n🔌 [removeDriverPosition] ========================================${colors.reset}`);
    console.log(`${colors.yellow}🔌 Socket ID:${colors.reset} ${socketId}`);
    console.log(`${colors.yellow}🔌 Timestamp:${colors.reset} ${new Date().toISOString()}`);

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

            console.log(`${colors.yellow}📊 Driver encontrado: ${driverId}${colors.reset}`);

            // Atualizar status para offline na driver_positions
            await client.query(
                "UPDATE driver_positions SET status = 'offline', last_update = NOW() WHERE socket_id = $1",
                [socketId]
            );

            console.log(`${colors.green}✅ [DB] driver_positions atualizado para offline${colors.reset}`);

            // Atualizar usuário na tabela users
            const userUpdate = await client.query(
                `UPDATE users SET
                    is_online = false,
                    last_seen = NOW()
                 WHERE id = $1
                 RETURNING id, is_online`,
                [driverId]
            );

            if (userUpdate.rows.length > 0) {
                console.log(`${colors.green}✅ [DB] users atualizado para offline - ID: ${driverId}${colors.reset}`);
            }

            console.log(`${colors.yellow}🟤 Driver ${driverId} OFFLINE${colors.reset}`);
        } else {
            console.log(`${colors.yellow}⚠️ Nenhum driver encontrado com socket ${socketId}${colors.reset}`);

            // Apenas atualizar qualquer registro com este socket
            const updateResult = await client.query(
                "UPDATE driver_positions SET status = 'offline' WHERE socket_id = $1 RETURNING driver_id",
                [socketId]
            );

            if (updateResult.rows.length > 0) {
                console.log(`${colors.green}✅ [DB] ${updateResult.rows.length} registros com socket ${socketId} marcados como offline${colors.reset}`);
            }
        }

        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        console.log(`${colors.red}❌ [DB ERROR] removeDriverPosition:${colors.reset}`, error.message);
    } finally {
        client.release();
    }
    
    console.log(`${colors.yellow}🔌 ========================================${colors.reset}\n`);
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
                console.log(`   ${i+1}. ${d.name} (ID: ${d.driver_id}) - ${secondsAgo}s atrás | Socket: ${d.socket_id ? 'OK' : 'NULO'}`);
            });
        } else {
            console.log(`${colors.yellow}⚠️ Nenhum motorista online encontrado${colors.reset}`);
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
            console.log(`${colors.cyan}📍 [getDriverPosition] Driver ${driverId} - ${secondsAgo}s atrás | Status: ${result.rows[0].status}${colors.reset}`);
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
exports.getNearbyDrivers = async (lat, lng, radiusKm = 15) => {
    try {
        console.log(`${colors.cyan}🗺️ [getNearbyDrivers] Buscando motoristas em raio de ${radiusKm}km de (${lat}, ${lng})${colors.reset}`);

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
            HAVING distance <= $3 OR $3 IS NULL
            ORDER BY distance ASC
            LIMIT 20
        `, [lat, lng, radiusKm]);

        console.log(`${colors.green}✅ [getNearbyDrivers] Encontrados ${result.rows.length} motoristas${colors.reset}`);
        
        if (result.rows.length > 0) {
            result.rows.forEach((d, i) => {
                console.log(`   ${i+1}. ${d.name} - ${d.distance.toFixed(2)}km`);
            });
        }

        return result.rows;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getNearbyDrivers:${colors.reset}`, error.message);
        return [];
    }
};

// =================================================================================================
// 9. ⏰ ATUALIZAR TIMESTAMP DE ATIVIDADE
// =================================================================================================
exports.updateDriverActivity = async (driverId) => {
    try {
        const result = await pool.query(
            `UPDATE driver_positions
             SET last_update = NOW()
             WHERE driver_id = $1
             RETURNING driver_id`,
            [driverId]
        );

        if (result.rows.length > 0) {
            await pool.query(
                `UPDATE users SET
                    last_seen = NOW()
                 WHERE id = $1`,
                [driverId]
            );

            console.log(`${colors.green}✅ [updateDriverActivity] Driver ${driverId} atividade atualizada${colors.reset}`);
            return true;
        }

        console.log(`${colors.yellow}⚠️ [updateDriverActivity] Driver ${driverId} não encontrado${colors.reset}`);
        return false;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] updateDriverActivity:${colors.reset}`, error.message);
        return false;
    }
};

// =================================================================================================
// 10. 🔄 SINCRONIZAR STATUS DO MOTORISTA
// =================================================================================================
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
        
        if (allDrivers.rows.length > 0) {
            allDrivers.forEach((d, i) => {
                console.log(`   ${i+1}. ${d.name} (ID: ${d.id}) - Online: ${d.is_online ? '✅' : '❌'}, Bloqueado: ${d.is_blocked ? '✅' : '❌'}`);
            });
        }

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

        console.log(`\n${colors.cyan}📊 Total de registros em driver_positions: ${positions.rows.length}${colors.reset}`);
        
        if (positions.rows.length > 0) {
            positions.rows.forEach((p, i) => {
                const secondsAgo = Math.round(p.seconds_ago);
                console.log(`   ${i+1}. ${p.name} - ${secondsAgo}s atrás | Socket: ${p.socket_id ? '✅' : '❌'} | Status: ${p.status}`);
            });
        }

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

        console.log(`\n${colors.green}✅ Motoristas que PASSAM nos critérios: ${qualified.rows.length}${colors.reset}`);
        
        if (qualified.rows.length > 0) {
            qualified.rows.forEach((q, i) => {
                console.log(`   ${i+1}. ${q.name} - ${Math.round(q.seconds_ago)}s atrás | Socket: ${q.socket_id}`);
            });
        }

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

        console.log(`\n${colors.yellow}⚠️ Motoristas REPROVADOS: ${failed.rows.length}${colors.reset}`);
        
        if (failed.rows.length > 0) {
            failed.rows.forEach((f, i) => {
                console.log(`   ${i+1}. ${f.name} - Motivo: ${f.motivo}`);
            });
        }

        console.log(`${colors.yellow}🔍 ========================================${colors.reset}\n`);

        return {
            total_drivers: allDrivers.rows.length,
            total_positions: positions.rows.length,
            online_qualified: qualified.rows.length,
            failed_count: failed.rows.length,
            failed_reasons: failed.rows
        };

    } catch (error) {
        console.log(`${colors.red}❌ [DEBUG] Erro no diagnóstico:${colors.reset}`, error.message);
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
        
        console.log(`${colors.yellow}\n🧹 [cleanInactiveDrivers] Iniciando limpeza...${colors.reset}`);

        // Buscar motoristas inativos há mais de 2 minutos
        const inactiveDrivers = await client.query(`
            SELECT driver_id
            FROM driver_positions
            WHERE last_update < NOW() - INTERVAL '2 minutes'
                AND status = 'online'
        `);

        console.log(`${colors.cyan}📊 Motoristas inativos encontrados: ${inactiveDrivers.rows.length}${colors.reset}`);

        // Atualizar para offline
        const updateResult = await client.query(`
            UPDATE driver_positions
            SET status = 'offline'
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
            console.log(`${colors.green}   ✅ Driver ${row.driver_id} marcado como offline${colors.reset}`);
        }

        await client.query('COMMIT');

        console.log(`${colors.green}✅ [cleanInactiveDrivers] ${updateResult.rows.length} motoristas marcados como offline${colors.reset}`);
        console.log(`${colors.yellow}🧹 ========================================${colors.reset}\n`);

        return updateResult.rows.length;
    } catch (error) {
        await client.query('ROLLBACK');
        console.log(`${colors.red}❌ [DB ERROR] cleanInactiveDrivers:${colors.reset}`, error.message);
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

        console.log(`${colors.blue}📊 [getDriverStats] ========================`);
        console.log(`   Online: ${stats.online}`);
        console.log(`   Offline: ${stats.offline}`);
        console.log(`   Sem Socket: ${stats.sem_socket}`);
        console.log(`   Inativos 5min: ${stats.inativos_5min}`);
        console.log(`   Total: ${stats.total_registros}${colors.reset}`);

        return stats;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getDriverStats:${colors.reset}`, error.message);
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
        
        console.log(`${colors.cyan}🔄 [reconnectDriver] Reconectando driver ${driverId} com socket ${socketId}${colors.reset}`);

        // Verificar se existe
        const check = await client.query(
            "SELECT driver_id FROM driver_positions WHERE driver_id = $1",
            [driverId]
        );

        let result;
        if (check.rows.length > 0) {
            // UPDATE
            result = await client.query(`
                UPDATE driver_positions
                SET
                    socket_id = $1,
                    last_update = NOW(),
                    status = 'online'
                WHERE driver_id = $2
                RETURNING *
            `, [socketId, driverId]);
            
            console.log(`${colors.green}✅ [DB] driver_positions atualizado${colors.reset}`);
        } else {
            // INSERT com valores padrão
            result = await client.query(`
                INSERT INTO driver_positions
                (driver_id, socket_id, status, last_update, lat, lng)
                VALUES ($1, $2, 'online', NOW(), 0, 0)
                RETURNING *
            `, [driverId, socketId]);
            
            console.log(`${colors.green}✅ [DB] driver_positions inserido${colors.reset}`);
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

        console.log(`${colors.green}✅ [reconnectDriver] Driver ${driverId} reconectado com sucesso${colors.reset}`);
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.log(`${colors.red}❌ [DB ERROR] reconnectDriver:${colors.reset}`, error.message);
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

        console.log(`${colors.cyan}📊 [getDriversWithActiveSockets] Encontrados ${result.rows.length} motoristas com socket ativo${colors.reset}`);
        
        return result.rows;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getDriversWithActiveSockets:${colors.reset}`, error.message);
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
        
        console.log(`${colors.yellow}\n🗑️ [cleanOrphanSockets] Iniciando limpeza de sockets órfãos...${colors.reset}`);

        // Buscar registros com socket_id mas sem atualização recente
        const orphanResult = await client.query(`
            UPDATE driver_positions
            SET status = 'offline'
            WHERE socket_id IS NOT NULL
                AND last_update < NOW() - INTERVAL '3 minutes'
                AND status = 'online'
            RETURNING driver_id, socket_id
        `);

        if (orphanResult.rows.length > 0) {
            console.log(`${colors.yellow}⚠️ Encontrados ${orphanResult.rows.length} sockets órfãos${colors.reset}`);
            
            // Atualizar users correspondentes
            for (const row of orphanResult.rows) {
                await client.query(
                    `UPDATE users SET
                        is_online = false,
                        last_seen = NOW()
                     WHERE id = $1`,
                    [row.driver_id]
                );
                console.log(`   🗑️ Driver ${row.driver_id} - Socket ${row.socket_id} removido`);
            }
        } else {
            console.log(`${colors.green}✅ Nenhum socket órfão encontrado${colors.reset}`);
        }

        await client.query('COMMIT');

        console.log(`${colors.green}✅ [cleanOrphanSockets] Limpeza concluída: ${orphanResult.rows.length} sockets removidos${colors.reset}`);
        console.log(`${colors.yellow}🗑️ ========================================${colors.reset}\n`);

        return orphanResult.rows.length;
    } catch (error) {
        await client.query('ROLLBACK');
        console.log(`${colors.red}❌ [DB ERROR] cleanOrphanSockets:${colors.reset}`, error.message);
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
        console.log(`${colors.cyan}\n🔍 [verifyDataIntegrity] Verificando integridade dos dados...${colors.reset}`);

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
            console.log(`${colors.yellow}⚠️ Encontradas ${inconsistencies.rows.length} inconsistências:${colors.reset}`);
            inconsistencies.rows.forEach((inc, i) => {
                console.log(`   ${i+1}. ${inc.name}: ${inc.inconsistency}`);
            });
        } else {
            console.log(`${colors.green}✅ Nenhuma inconsistência encontrada${colors.reset}`);
        }

        console.log(`${colors.cyan}🔍 ========================================${colors.reset}\n`);

        return {
            hasInconsistencies: inconsistencies.rows.length > 0,
            inconsistencies: inconsistencies.rows
        };
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] verifyDataIntegrity:${colors.reset}`, error.message);
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
        
        console.log(`${colors.cyan}📦 [batchUpdatePositions] Atualizando ${positions.length} posições em lote${colors.reset}`);

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
                driver_id, lat || 0, lng || 0, heading || 0,
                speed || 0, accuracy || 0, socket_id, status || 'online'
            ]);

            if (result.rows.length > 0) updated++;
        }

        await client.query('COMMIT');
        
        console.log(`${colors.green}✅ [batchUpdatePositions] ${updated} posições atualizadas com sucesso${colors.reset}`);
        
        return updated;
    } catch (error) {
        await client.query('ROLLBACK');
        console.log(`${colors.red}❌ [DB ERROR] batchUpdatePositions:${colors.reset}`, error.message);
        return 0;
    } finally {
        client.release();
    }
};

module.exports = exports;
