const { Server } = require("socket.io");
const pool = require('../config/db');

let io;

function setupSocketIO(httpServer) {
    io = new Server(httpServer, {
        cors: { origin: "*" },
        transports: ['websocket']
    });

    io.on('connection', (socket) => {
        console.log(`🔌 Socket conectado: ${socket.id}`);

        socket.on('join_driver_room', async (data) => {
            const driverId = data.driver_id || data.user_id;
            if (!driverId) return;
            
            console.log(`🚗 DRIVER JOIN: ${driverId} - Socket: ${socket.id}`);
            
            // FORÇAR atualização no banco
            try {
                await pool.query(`
                    INSERT INTO driver_positions (driver_id, lat, lng, socket_id, status, last_update)
                    VALUES ($1, -8.8399, 13.2894, $2, 'online', NOW())
                    ON CONFLICT (driver_id) DO UPDATE SET
                        socket_id = $2,
                        status = 'online',
                        last_update = NOW()
                `, [driverId, socket.id]);
                
                await pool.query(`
                    UPDATE users SET is_online = true, last_seen = NOW()
                    WHERE id = $1
                `, [driverId]);
                
                console.log(`✅ Driver ${driverId} registrado no banco`);
                
                socket.emit('joined_ack', { success: true });
            } catch (e) {
                console.error(`❌ Erro no banco:`, e.message);
            }
        });

        socket.on('disconnect', async () => {
            // Buscar driver por este socket
            try {
                const result = await pool.query(
                    'SELECT driver_id FROM driver_positions WHERE socket_id = $1',
                    [socket.id]
                );
                
                if (result.rows.length > 0) {
                    const driverId = result.rows[0].driver_id;
                    
                    await pool.query(`
                        UPDATE driver_positions 
                        SET status = 'offline', socket_id = NULL 
                        WHERE driver_id = $1
                    `, [driverId]);
                    
                    await pool.query(`
                        UPDATE users SET is_online = false 
                        WHERE id = $1
                    `, [driverId]);
                    
                    console.log(`🚫 Driver ${driverId} desconectado`);
                }
            } catch (e) {
                console.error(`❌ Erro no disconnect:`, e.message);
            }
        });
    });

    return io;
}

module.exports = { setupSocketIO };
