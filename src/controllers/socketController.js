/**
 * =================================================================================================
 * 🔌 SOCKET CONTROLLER - GERENCIAMENTO DE MOTORISTAS ONLINE
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/socketController.js
 * DESCRIÇÃO: Gerencia a posição e status dos motoristas em tempo real
 *
 * STATUS: 🔥 CRÍTICO - CORRIGE MOTORISTAS NÃO APARECEREM
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
        // UPSERT: Insere ou atualiza posição do motorista
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

        // ✅ ATUALIZAR USUÁRIO COMO ONLINE
        await pool.query(
            `UPDATE users SET is_online = true, last_seen = NOW() WHERE id = $1`,
            [driver_id]
        );

        console.log(`✅ [SOCKET] Driver ${driver_id} ONLINE em (${lat}, ${lng})`);

        // 📢 NOTIFICAR PASSAGEIROS PRÓXIMOS (se necessário)
        // Esta funcionalidade pode ser implementada depois

    } catch (error) {
        console.error('❌ [SOCKET] Erro ao atualizar posição do motorista:', error);
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

            // Atualizar status do usuário para offline
            await pool.query(
                `UPDATE users SET is_online = false, last_seen = NOW() WHERE id = $1`,
                [driverId]
            );

            console.log(`🟤 [SOCKET] Driver ${driverId} OFFLINE (socket: ${socketId})`);
        }
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao remover motorista:', error);
    }
};

/**
 * 📊 CONTAR MOTORISTAS ONLINE
 */
exports.countOnlineDrivers = async () => {
    try {
        const result = await pool.query(`
            SELECT COUNT(*) as total
            FROM driver_positions
            WHERE last_update > NOW() - INTERVAL '2 minutes'
        `);
        return parseInt(result.rows[0].total);
    } catch (error) {
        console.error('❌ [SOCKET] Erro ao contar motoristas online:', error);
        return 0;
    }
};