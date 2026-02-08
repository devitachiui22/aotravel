const pool = require('../config/db');
const { logSystem, logError } = require('../utils/logger');
const { getUserFullDetails } = require('../utils/queries');

exports.getProfile = async (req, res) => {
    try {
        const user = await getUserFullDetails(req.user.id);
        if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

        const stats = await pool.query(`
            SELECT
                COUNT(CASE WHEN passenger_id = $1 AND status = 'completed' THEN 1 END) as total_rides_as_passenger,
                COUNT(CASE WHEN driver_id = $1 AND status = 'completed' THEN 1 END) as total_rides_as_driver,
                COALESCE(AVG(CASE WHEN passenger_id = $1 THEN rating END), 0) as avg_rating_as_passenger,
                COALESCE(AVG(CASE WHEN driver_id = $1 THEN rating END), 0) as avg_rating_as_driver
            FROM rides
            WHERE (passenger_id = $1 OR driver_id = $1)
        `, [req.user.id]);

        delete user.password;
        user.stats = stats.rows[0] || {};
        res.json(user);
    } catch (e) {
        logError('PROFILE_GET', e);
        res.status(500).json({ error: "Erro ao buscar perfil." });
    }
};

exports.updateProfile = async (req, res) => {
    const { name, phone, photo, vehicle_details } = req.body;
    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (name !== undefined) { updates.push(`name = $${paramCount}`); values.push(name); paramCount++; }
        if (phone !== undefined) { updates.push(`phone = $${paramCount}`); values.push(phone); paramCount++; }
        if (photo !== undefined) { updates.push(`photo = $${paramCount}`); values.push(photo); paramCount++; }
        if (vehicle_details !== undefined && req.user.role === 'driver') {
            updates.push(`vehicle_details = $${paramCount}`);
            values.push(JSON.stringify(vehicle_details));
            paramCount++;
        }

        if (updates.length === 0) return res.status(400).json({ error: "Nenhum dado para atualizar." });
        updates.push(`updated_at = NOW()`);
        values.push(req.user.id);

        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        const result = await pool.query(query, values);
        const updatedUser = result.rows[0];
        delete updatedUser.password;
        logSystem('PROFILE_UPDATE', `Perfil do usuário ${req.user.id} atualizado.`);
        res.json(updatedUser);
    } catch (e) {
        logError('PROFILE_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar perfil." });
    }
};

exports.uploadPhoto = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Nenhuma imagem fornecida." });
        const photoUrl = `/uploads/${req.file.filename}`;
        await pool.query('UPDATE users SET photo = $1, updated_at = NOW() WHERE id = $2', [photoUrl, req.user.id]);
        logSystem('PHOTO_UPLOAD', `Foto de perfil atualizada para usuário ${req.user.id}`);
        res.json({ success: true, photo_url: photoUrl, message: "Foto de perfil atualizada com sucesso." });
    } catch (e) {
        logError('PHOTO_UPLOAD', e);
        res.status(500).json({ error: "Erro ao fazer upload da foto." });
    }
};

exports.uploadDocuments = async (req, res) => {
    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (req.files['bi_front']) {
            updates.push(`bi_front = $${paramCount}`);
            values.push(`/uploads/${req.files['bi_front'][0].filename}`);
            paramCount++;
            await pool.query(
                `INSERT INTO user_documents (user_id, document_type, front_image, status)
                 VALUES ($1, 'bi', $2, 'pending')
                 ON CONFLICT (user_id, document_type) DO UPDATE SET front_image = $2, status = 'pending', updated_at = NOW()`,
                [req.user.id, `/uploads/${req.files['bi_front'][0].filename}`]
            );
        }
        if (req.files['bi_back']) {
            updates.push(`bi_back = $${paramCount}`);
            values.push(`/uploads/${req.files['bi_back'][0].filename}`);
            paramCount++;
            await pool.query(
                `UPDATE user_documents SET back_image = $1, updated_at = NOW() WHERE user_id = $2 AND document_type = 'bi'`,
                [`/uploads/${req.files['bi_back'][0].filename}`, req.user.id]
            );
        }
        if (req.user.role === 'driver') {
            if (req.files['driving_license_front']) {
                updates.push(`driving_license_front = $${paramCount}`);
                values.push(`/uploads/${req.files['driving_license_front'][0].filename}`);
                paramCount++;
                await pool.query(
                    `INSERT INTO user_documents (user_id, document_type, front_image, status)
                     VALUES ($1, 'driving_license', $2, 'pending')
                     ON CONFLICT (user_id, document_type) DO UPDATE SET front_image = $2, status = 'pending', updated_at = NOW()`,
                    [req.user.id, `/uploads/${req.files['driving_license_front'][0].filename}`]
                );
            }
            if (req.files['driving_license_back']) {
                updates.push(`driving_license_back = $${paramCount}`);
                values.push(`/uploads/${req.files['driving_license_back'][0].filename}`);
                paramCount++;
                await pool.query(
                    `UPDATE user_documents SET back_image = $1, updated_at = NOW() WHERE user_id = $2 AND document_type = 'driving_license'`,
                    [`/uploads/${req.files['driving_license_back'][0].filename}`, req.user.id]
                );
            }
        }

        if (updates.length > 0) {
            values.push(req.user.id);
            const query = `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount}`;
            await pool.query(query, values);
        }

        if (req.user.role === 'driver') {
            const docCount = await pool.query(
                `SELECT COUNT(*) FROM user_documents WHERE user_id = $1 AND document_type IN ('bi', 'driving_license') AND front_image IS NOT NULL`,
                [req.user.id]
            );
            if (docCount.rows[0].count == 2) await pool.query('UPDATE users SET is_verified = false WHERE id = $1', [req.user.id]);
        }
        logSystem('DOCUMENTS_UPLOAD', `Documentos atualizados para usuário ${req.user.id}`);
        res.json({ success: true, message: "Documentos enviados com sucesso. Aguarde verificação." });
    } catch (e) {
        logError('DOCUMENTS_UPLOAD', e);
        res.status(500).json({ error: "Erro ao fazer upload dos documentos." });
    }
};

exports.updateSettings = async (req, res) => {
    const { settings, privacy_settings, notification_preferences } = req.body;
    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (settings !== undefined) { updates.push(`settings = $${paramCount}`); values.push(JSON.stringify(settings)); paramCount++; }
        if (privacy_settings !== undefined) { updates.push(`privacy_settings = $${paramCount}`); values.push(JSON.stringify(privacy_settings)); paramCount++; }
        if (notification_preferences !== undefined) { updates.push(`notification_preferences = $${paramCount}`); values.push(JSON.stringify(notification_preferences)); paramCount++; }

        if (updates.length === 0) return res.status(400).json({ error: "Nenhuma configuração para atualizar." });
        updates.push(`updated_at = NOW()`);
        values.push(req.user.id);

        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`;
        await pool.query(query, values);
        logSystem('SETTINGS_UPDATE', `Configurações atualizadas para usuário ${req.user.id}`);
        res.json({ success: true, message: "Configurações atualizadas com sucesso." });
    } catch (e) {
        logError('SETTINGS_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar configurações." });
    }
};

exports.changePassword = async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias." });
    try {
        const user = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        if (user.rows.length === 0) return res.status(404).json({ error: "Usuário não encontrado." });
        if (user.rows[0].password !== current_password) return res.status(401).json({ error: "Senha atual incorreta." });
        await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [new_password, req.user.id]);
        logSystem('PASSWORD_CHANGE', `Senha alterada para usuário ${req.user.id}`);
        res.json({ success: true, message: "Senha alterada com sucesso." });
    } catch (e) {
        logError('PASSWORD_CHANGE', e);
        res.status(500).json({ error: "Erro ao alterar senha." });
    }
};