const pool = require('../config/db');

exports.fixDriverStatus = async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. Reset completo
        await client.query('DELETE FROM driver_positions');
        
        // 2. Recriar para todos os motoristas
        await client.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, status, last_update)
            SELECT id, -8.8399, 13.2894, 'offline', NOW() - INTERVAL '1 hour'
            FROM users WHERE role = 'driver'
        `);
        
        // 3. Forçar todos offline
        await client.query(`
            UPDATE users SET is_online = false WHERE role = 'driver'
        `);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: 'Banco de dados resetado. Peça aos motoristas para fazer login novamente.'
        });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

exports.forceDriverOnline = async (req, res) => {
    const { driverId } = req.params;
    const { socketId } = req.body;
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // FORÇAR atualização manual
        await client.query(`
            INSERT INTO driver_positions (driver_id, lat, lng, socket_id, status, last_update)
            VALUES ($1, -8.8399, 13.2894, $2, 'online', NOW())
            ON CONFLICT (driver_id) DO UPDATE SET
                socket_id = $2,
                status = 'online',
                last_update = NOW()
        `, [driverId, socketId]);
        
        await client.query(`
            UPDATE users SET is_online = true, last_seen = NOW()
            WHERE id = $1
        `, [driverId]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: `Driver ${driverId} forçado a online com socket ${socketId}`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};
