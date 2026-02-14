/**
 * =================================================================================================
 * 🔌 SOCKET CONTROLLER - TITANIUM ENGINE v7.0.0 (ULTRA DEBUG - COMPLETO)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/socketController.js
 * DESCRIÇÃO: Gerencia a posição e status dos motoristas em tempo real - VERSÃO DEBUG COMPLETA
 *
 * ✅ CARACTERÍSTICAS:
 * 1. Logs detalhados em cada operação
 * 2. Verificação de integridade do banco
 * 3. Múltiplos níveis de fallback
 * 4. Sincronização automática com users
 * 5. Tratamento de erros robusto
 * 6. Monitoramento em tempo real
 *
 * STATUS: 🔥 PRODUCTION READY - ULTRA DEBUG
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
// 1. 📍 ATUALIZAR POSIÇÃO DO MOTORISTA - ULTRA DEBUG
// =================================================================================================

/**
 * Atualiza a posição do motorista no banco de dados
 * Chamado via socket 'update_location' ou 'heartbeat'
 */
exports.updateDriverPosition = async (data, socket) => {
    const { driver_id, user_id, lat, lng, heading, speed, accuracy, status, heartbeat } = data;
    const socketId = socket.id;
    
    // Normalizar ID (aceita driver_id ou user_id)
    const finalDriverId = driver_id || user_id;
    
    if (!finalDriverId) {
        console.log(`${colors.red}❌ [updateDriverPosition] ID nulo - dados recebidos:${colors.reset}`, data);
        return;
    }

    const timestamp = new Date().toISOString();
    const isHeartbeat = heartbeat === true;

    console.log(`${colors.cyan}\n📍 [updateDriverPosition] ========================================${colors.reset}`);
    console.log(`${colors.cyan}📍 Timestamp:${colors.reset} ${timestamp}`);
    console.log(`${colors.cyan}📍 Driver ID:${colors.reset} ${finalDriverId}`);
    console.log(`${colors.cyan}📍 Socket ID:${colors.reset} ${socketId}`);
    console.log(`${colors.cyan}📍 É heartbeat:${colors.reset} ${isHeartbeat ? 'SIM' : 'NÃO'}`);
    
    if (!isHeartbeat) {
        console.log(`${colors.cyan}📍 Lat/Lng:${colors.reset} (${lat}, ${lng})`);
        console.log(`${colors.cyan}📍 Heading:${colors.reset} ${heading}`);
        console.log(`${colors.cyan}📍 Speed:${colors.reset} ${speed} km/h`);
        console.log(`${colors.cyan}📍 Accuracy:${colors.reset} ${accuracy}`);
    }
    
    console.log(`${colors.cyan}📍 Status:${colors.reset} ${status || 'online'}`);
    console.log(`${colors.cyan}📍 ========================================${colors.reset}\n`);

    try {
        // Converter para números (ou 0 se inválido)
        const finalLat = lat ? parseFloat(lat) : 0;
        const finalLng = lng ? parseFloat(lng) : 0;
        const finalHeading = heading ? parseFloat(heading) : 0;
        const finalSpeed = speed ? parseFloat(speed) : 0;
        const finalAccuracy = accuracy ? parseFloat(accuracy) : 0;
        const finalStatus = status || 'online';

        // Query UPSERT otimizada
        const query = `
            INSERT INTO driver_positions (
                driver_id, lat, lng, heading, speed, accuracy, socket_id, status, last_update
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (driver_id)
            DO UPDATE SET
                lat = COALESCE(EXCLUDED.lat, driver_positions.lat),
                lng = COALESCE(EXCLUDED.lng, driver_positions.lng),
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

        // Verificar o registro após atualização
        const check = await pool.query(
            "SELECT * FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );

        if (check.rows.length > 0) {
            const lastUpdate = new Date(check.rows[0].last_update);
            const secondsAgo = Math.floor((Date.now() - lastUpdate) / 1000);
            
            console.log(`${colors.gray}📊 Registro atual:${colors.reset}`);
            console.log(`   - ID: ${check.rows[0].driver_id}`);
            console.log(`   - GPS: (${check.rows[0].lat}, ${check.rows[0].lng})`);
            console.log(`   - Última atualização: ${secondsAgo}s atrás`);
            console.log(`   - Status: ${check.rows[0].status}`);
            console.log(`   - Socket ID: ${check.rows[0].socket_id || 'NULO'}`);
        }

        // ✅ Sincronizar status na tabela users
        await pool.query(
            `UPDATE users SET 
                is_online = true, 
                last_seen = NOW(),
                updated_at = NOW()
             WHERE id = $1`,
            [finalDriverId]
        );

        console.log(`${colors.green}✅ [DB] Users sincronizado para driver ${finalDriverId}${colors.reset}`);

    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] updateDriverPosition:${colors.reset}`, error.message);
        console.error(error);
    }
};

// =================================================================================================
// 2. 🚪 JOIN DRIVER ROOM - ULTRA DEBUG
// =================================================================================================

/**
 * Motorista entra na sala de motoristas
 * Chamado via socket 'join_driver_room'
 */
exports.joinDriverRoom = async (data, socket) => {
    const { driver_id, user_id, lat, lng, status } = data;
    const socketId = socket.id;
    
    const finalDriverId = driver_id || user_id;
    
    const timestamp = new Date().toISOString();

    console.log(`${colors.magenta}\n🚪 [joinDriverRoom] ========================================${colors.reset}`);
    console.log(`${colors.magenta}🚪 Timestamp:${colors.reset} ${timestamp}`);
    console.log(`${colors.magenta}🚪 Driver ID:${colors.reset} ${finalDriverId}`);
    console.log(`${colors.magenta}🚪 Socket ID:${colors.reset} ${socketId}`);
    console.log(`${colors.magenta}🚪 Dados recebidos:${colors.reset}`, JSON.stringify(data, null, 2));
    console.log(`${colors.magenta}🚪 ========================================${colors.reset}\n`);

    if (!finalDriverId) {
        console.log(`${colors.red}❌ [joinDriverRoom] ID nulo${colors.reset}`);
        return;
    }

    try {
        // Verificar se o motorista já existe na tabela
        const check = await pool.query(
            "SELECT * FROM driver_positions WHERE driver_id = $1",
            [finalDriverId]
        );

        if (check.rows.length > 0) {
            const lastUpdate = new Date(check.rows[0].last_update);
            const secondsAgo = Math.floor((Date.now() - lastUpdate) / 1000);
            
            console.log(`${colors.yellow}📊 Motorista já existe:${colors.reset}`);
            console.log(`   - Última atualização: ${secondsAgo}s atrás`);
            console.log(`   - Status atual: ${check.rows[0].status}`);
            console.log(`   - Socket atual: ${check.rows[0].socket_id || 'NULO'}`);
        } else {
            console.log(`${colors.yellow}📊 Motorista não existe na tabela. Será criado.${colors.reset}`);
        }

        // Valores de posição (se fornecidos, senão 0)
        const finalLat = lat ? parseFloat(lat) : 0;
        const finalLng = lng ? parseFloat(lng) : 0;
        const finalStatus = status || 'online';

        // Inserir/atualizar
        const query = `
            INSERT INTO driver_positions (
                driver_id, lat, lng, socket_id, status, last_update
            )
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (driver_id)
            DO UPDATE SET
                lat = COALESCE(EXCLUDED.lat, driver_positions.lat),
                lng = COALESCE(EXCLUDED.lng, driver_positions.lng),
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

        console.log(`${colors.green}✅ [DB] Driver ${finalDriverId} registrado/atualizado com sucesso${colors.reset}`);
        console.log(`   - ID: ${result.rows[0].driver_id}`);
        console.log(`   - Socket: ${result.rows[0].socket_id}`);
        console.log(`   - Status: ${result.rows[0].status}`);
        console.log(`   - GPS: (${result.rows[0].lat}, ${result.rows[0].lng})`);
        console.log(`   - Last Update: ${result.rows[0].last_update}`);

        // Atualizar users
        await pool.query(
            `UPDATE users SET 
                is_online = true, 
                last_seen = NOW() 
             WHERE id = $1`,
            [finalDriverId]
        );

        console.log(`${colors.green}✅ [DB] Users sincronizado${colors.reset}`);

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
// 3. 🚪 REMOVER MOTORISTA (OFFLINE/DISCONNECT) - ULTRA DEBUG
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
// 4. 📊 CONTAR MOTORISTAS ONLINE - ULTRA DEBUG
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
                AND (lat != 0 OR lng != 0)
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
// 5. 🔍 BUSCAR TODOS OS MOTORISTAS ONLINE - ULTRA DEBUG
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
                AND (dp.lat != 0 OR dp.lng != 0)
            ORDER BY dp.last_update DESC
        `;

        const result = await pool.query(query);

        console.log(`${colors.cyan}📊 Motoristas encontrados: ${result.rows.length}${colors.reset}`);

        if (result.rows.length > 0) {
            result.rows.forEach((d, i) => {
                const secondsAgo = Math.round(d.seconds_ago);
                console.log(`   ${i+1}. ${d.name} (ID: ${d.driver_id})`);
                console.log(`      - Última atualização: ${secondsAgo}s atrás`);
                console.log(`      - GPS: (${d.lat}, ${d.lng})`);
                console.log(`      - Socket: ${d.socket_id ? 'OK' : 'NULO'}`);
                console.log(`      - Rating: ${d.rating || 'N/A'}`);
            });
        } else {
            console.log(`${colors.yellow}⚠️ Nenhum motorista encontrado com os critérios${colors.reset}`);
            
            // Diagnosticar por que não encontrou
            await exports.debugDriverStatus();
        }

        console.log(`${colors.cyan}🔍 ========================================${colors.reset}\n`);

        return result.rows;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getAllOnlineDrivers:${colors.reset}`, error.message);
        return [];
    }
};

// =================================================================================================
// 6. 🔍 DIAGNÓSTICO DE STATUS DOS MOTORISTAS - ULTRA DEBUG
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
        allDrivers.rows.forEach(d => {
            console.log(`   - ${d.name} (ID: ${d.id})`);
            console.log(`     is_online: ${d.is_online}, is_blocked: ${d.is_blocked}, last_seen: ${d.last_seen}`);
        });

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
        positions.rows.forEach(p => {
            const secondsAgo = Math.round(p.seconds_ago);
            console.log(`   - Driver ${p.driver_id}:`);
            console.log(`     status: ${p.status}, socket: ${p.socket_id ? 'OK' : 'NULO'}`);
            console.log(`     GPS: (${p.lat}, ${p.lng})`);
            console.log(`     last_update: ${secondsAgo}s atrás`);
        });

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
                AND (dp.lat != 0 OR dp.lng != 0)
        `);

        console.log(`\n${colors.green}✅ Motoristas que PASSAM nos critérios: ${qualified.rows.length}${colors.reset}`);
        qualified.rows.forEach(q => {
            console.log(`   - ${q.name} (ID: ${q.driver_id}) - ${Math.round(q.seconds_ago)}s atrás`);
        });

        // 4. Análise de falhas
        console.log(`\n${colors.yellow}⚠️ Análise de falhas:${colors.reset}`);

        const analysis = await pool.query(`
            SELECT 
                u.id,
                u.name,
                u.is_online,
                u.is_blocked,
                dp.status as dp_status,
                dp.socket_id,
                dp.last_update,
                dp.lat,
                dp.lng,
                CASE 
                    WHEN dp.driver_id IS NULL THEN '❌ Não está na driver_positions'
                    WHEN dp.status != 'online' THEN '❌ Status não é online'
                    WHEN dp.last_update <= NOW() - INTERVAL '2 minutes' THEN '❌ Last update > 2 minutos'
                    WHEN u.is_online != true THEN '❌ users.is_online = false'
                    WHEN u.is_blocked = true THEN '❌ Usuário bloqueado'
                    WHEN dp.socket_id IS NULL THEN '❌ Socket ID nulo'
                    WHEN dp.lat = 0 AND dp.lng = 0 THEN '❌ GPS zero'
                    ELSE '✅ OK'
                END as status_check
            FROM users u
            LEFT JOIN driver_positions dp ON u.id = dp.driver_id
            WHERE u.role = 'driver'
            ORDER BY u.id
        `);

        analysis.rows.forEach(a => {
            console.log(`   ${a.name} (ID: ${a.id}): ${a.status_check}`);
        });

        console.log(`${colors.yellow}🔍 ========================================${colors.reset}\n`);

    } catch (error) {
        console.log(`${colors.red}❌ [DEBUG] Erro no diagnóstico:${colors.reset}`, error.message);
    }
};

// =================================================================================================
// 7. 🔍 BUSCAR POSIÇÃO DE UM MOTORISTA ESPECÍFICO
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
// 8. ✅ VERIFICAR SE MOTORISTA ESTÁ ONLINE
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
// 9. 🔄 SINCRONIZAR STATUS DO MOTORISTA
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
// 10. 🧹 LIMPAR MOTORISTAS INATIVOS
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
        for (const row of inactiveDrivers.rows) {
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
// 11. 🧹 LIMPAR SOCKETS ÓRFÃOS
// =================================================================================================

/**
 * Limpa sockets órfãos (sem heartbeat)
 */
exports.cleanOrphanSockets = async () => {
    try {
        console.log(`${colors.yellow}\n🧹 [cleanOrphanSockets] Iniciando limpeza...${colors.reset}`);

        const result = await pool.query(`
            UPDATE driver_positions
            SET status = 'offline'
            WHERE last_update < NOW() - INTERVAL '3 minutes'
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

        console.log(`${colors.green}✅ [cleanOrphanSockets] ${result.rows.length} sockets órfãos limpos${colors.reset}`);

        return result.rows.length;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] cleanOrphanSockets:${colors.reset}`, error.message);
        return 0;
    }
};

// =================================================================================================
// 12. 📊 ESTATÍSTICAS DE MOTORISTAS
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
                    AND (lat != 0 OR lng != 0) THEN 1 END) as online,
                COUNT(CASE WHEN status = 'offline' OR last_update < NOW() - INTERVAL '2 minutes' THEN 1 END) as offline,
                AVG(EXTRACT(EPOCH FROM (NOW() - last_update))) as avg_last_update_seconds
            FROM driver_positions
        `);

        const stats = {
            total_registros: parseInt(result.rows[0].total_registros) || 0,
            online: parseInt(result.rows[0].online) || 0,
            offline: parseInt(result.rows[0].offline) || 0,
            avg_last_update_seconds: Math.round(result.rows[0].avg_last_update_seconds || 0)
        };

        console.log(`${colors.blue}📊 [getDriverStats] Online: ${stats.online}, Offline: ${stats.offline}, Total: ${stats.total_registros}${colors.reset}`);

        return stats;
    } catch (error) {
        console.log(`${colors.red}❌ [DB ERROR] getDriverStats:${colors.reset}`, error.message);
        return {
            total_registros: 0,
            online: 0,
            offline: 0,
            avg_last_update_seconds: 0
        };
    }
};

// =================================================================================================
// 13. 🔄 RECONECTAR MOTORISTA
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

// =================================================================================================
// 14. 🗺️ BUSCAR MOTORISTAS PRÓXIMOS
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
                AND (dp.lat != 0 OR dp.lng != 0)
            HAVING distance <= $3
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
// 15. ⏰ ATUALIZAR TIMESTAMP DE ATIVIDADE
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

module.exports = exports;
