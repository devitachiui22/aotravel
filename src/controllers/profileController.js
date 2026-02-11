/**
 * =================================================================================================
 * 👤 AOTRAVEL SERVER PRO - PROFILE MANAGEMENT CONTROLLER
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/profileController.js
 * DESCRIÇÃO: Gerencia dados pessoais, estatísticas, upload de documentos (KYC),
 *            fotos de perfil, configurações de app e alteração de credenciais.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const { logSystem, logError, getUserFullDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

/**
 * GET PROFILE
 * Rota: GET /api/profile
 * Retorna: Dados completos do usuário + Estatísticas de corridas/avaliação.
 */
exports.getProfile = async (req, res) => {
    try {
        const user = await getUserFullDetails(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "Usuário não encontrado" });
        }

        // Buscar estatísticas agregadas (Query Otimizada)
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
        user.stats = stats.rows[0] || {
            total_rides_as_passenger: 0,
            total_rides_as_driver: 0,
            avg_rating_as_passenger: 5.0,
            avg_rating_as_driver: 5.0
        };

        res.json(user);
    } catch (e) {
        logError('PROFILE_GET', e);
        res.status(500).json({ error: "Erro ao buscar perfil." });
    }
};

/**
 * UPDATE PROFILE
 * Rota: PUT /api/profile
 * Atualiza: Nome, Telefone, Foto (URL), Detalhes do Veículo.
 */
exports.updateProfile = async (req, res) => {
    const { name, phone, photo, vehicle_details } = req.body;

    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramCount}`);
            values.push(name);
            paramCount++;
        }

        if (phone !== undefined) {
            updates.push(`phone = $${paramCount}`);
            values.push(phone);
            paramCount++;
        }

        if (photo !== undefined) {
            updates.push(`photo = $${paramCount}`);
            values.push(photo);
            paramCount++;
        }

        // Atualização de veículo permitida apenas para motoristas
        if (vehicle_details !== undefined && req.user.role === 'driver') {
            updates.push(`vehicle_details = $${paramCount}`);
            values.push(JSON.stringify(vehicle_details));
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "Nenhum dado fornecido para atualização." });
        }

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

/**
 * UPLOAD PROFILE PHOTO
 * Rota: POST /api/profile/photo
 * Processa upload via Multer e atualiza URL no banco.
 */
exports.uploadPhoto = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Nenhuma imagem fornecida." });
        }

        // Caminho relativo para acesso via URL estática
        const photoUrl = `/uploads/${req.file.filename}`;

        await pool.query(
            'UPDATE users SET photo = $1, updated_at = NOW() WHERE id = $2',
            [photoUrl, req.user.id]
        );

        logSystem('PHOTO_UPLOAD', `Foto de perfil atualizada: ${req.user.id}`);

        res.json({
            success: true,
            photo_url: photoUrl,
            message: "Foto de perfil atualizada com sucesso."
        });
    } catch (e) {
        logError('PHOTO_UPLOAD', e);
        res.status(500).json({ error: "Erro ao processar upload da foto." });
    }
};

/**
 * UPLOAD DOCUMENTS (KYC)
 * Rota: POST /api/profile/documents
 * Processa múltiplos arquivos: BI (Frente/Verso), Carta de Condução (Frente/Verso).
 */
exports.uploadDocuments = async (req, res) => {
    // Nota: O middleware upload.fields deve estar configurado na rota
    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        // --- Processamento do Bilhete de Identidade (BI) ---
        if (req.files['bi_front']) {
            const path = `/uploads/${req.files['bi_front'][0].filename}`;
            updates.push(`bi_front = $${paramCount}`);
            values.push(path);
            paramCount++;

            // Registrar na tabela de auditoria de documentos
            await pool.query(
                `INSERT INTO user_documents (user_id, document_type, front_image, status)
                 VALUES ($1, 'bi', $2, 'pending')
                 ON CONFLICT (user_id, document_type)
                 DO UPDATE SET front_image = $2, status = 'pending', updated_at = NOW()`,
                [req.user.id, path]
            );
        }

        if (req.files['bi_back']) {
            const path = `/uploads/${req.files['bi_back'][0].filename}`;
            updates.push(`bi_back = $${paramCount}`);
            values.push(path);
            paramCount++;

            await pool.query(
                `UPDATE user_documents SET back_image = $1, updated_at = NOW()
                 WHERE user_id = $2 AND document_type = 'bi'`,
                [path, req.user.id]
            );
        }

        // --- Processamento da Carta de Condução (Apenas Motoristas) ---
        if (req.user.role === 'driver') {
            if (req.files['driving_license_front']) {
                const path = `/uploads/${req.files['driving_license_front'][0].filename}`;
                updates.push(`driving_license_front = $${paramCount}`);
                values.push(path);
                paramCount++;

                await pool.query(
                    `INSERT INTO user_documents (user_id, document_type, front_image, status)
                     VALUES ($1, 'driving_license', $2, 'pending')
                     ON CONFLICT (user_id, document_type)
                     DO UPDATE SET front_image = $2, status = 'pending', updated_at = NOW()`,
                    [req.user.id, path]
                );
            }

            if (req.files['driving_license_back']) {
                const path = `/uploads/${req.files['driving_license_back'][0].filename}`;
                updates.push(`driving_license_back = $${paramCount}`);
                values.push(path);
                paramCount++;

                await pool.query(
                    `UPDATE user_documents SET back_image = $1, updated_at = NOW()
                     WHERE user_id = $2 AND document_type = 'driving_license'`,
                    [path, req.user.id]
                );
            }
        }

        // Atualizar tabela principal de usuários
        if (updates.length > 0) {
            values.push(req.user.id);
            const query = `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount}`;
            await pool.query(query, values);
        }

        // Lógica de Verificação Automática (Reset):
        // Se novos documentos foram enviados, reseta o status 'is_verified' para false
        // para forçar nova validação pelo Admin.
        if (req.user.role === 'driver') {
            const docCount = await pool.query(
                `SELECT COUNT(*) FROM user_documents
                 WHERE user_id = $1 AND document_type IN ('bi', 'driving_license')
                 AND front_image IS NOT NULL`,
                [req.user.id]
            );

            // Se tem pelo menos os 2 documentos principais iniciados, marca pendente
            if (parseInt(docCount.rows[0].count) >= 1) {
                await pool.query(
                    'UPDATE users SET is_verified = false WHERE id = $1',
                    [req.user.id]
                );
            }
        }

        logSystem('DOCUMENTS_UPLOAD', `Documentos KYC enviados por ${req.user.id}`);
        res.json({
            success: true,
            message: "Documentos enviados com sucesso. Aguarde análise da equipe."
        });

    } catch (e) {
        logError('DOCUMENTS_UPLOAD', e);
        res.status(500).json({ error: "Erro ao fazer upload dos documentos." });
    }
};

/**
 * UPDATE SETTINGS
 * Rota: PUT /api/profile/settings
 * Atualiza preferências JSONB (Notificações, Privacidade).
 */
exports.updateSettings = async (req, res) => {
    const { settings, privacy_settings, notification_preferences } = req.body;

    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (settings !== undefined) {
            updates.push(`settings = $${paramCount}`);
            values.push(JSON.stringify(settings));
            paramCount++;
        }

        if (privacy_settings !== undefined) {
            updates.push(`privacy_settings = $${paramCount}`);
            values.push(JSON.stringify(privacy_settings));
            paramCount++;
        }

        if (notification_preferences !== undefined) {
            updates.push(`notification_preferences = $${paramCount}`);
            values.push(JSON.stringify(notification_preferences));
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "Nenhuma configuração enviada." });
        }

        updates.push(`updated_at = NOW()`);
        values.push(req.user.id);

        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`;
        await pool.query(query, values);

        logSystem('SETTINGS_UPDATE', `Configurações atualizadas: ${req.user.id}`);
        res.json({
            success: true,
            message: "Configurações salvas com sucesso."
        });
    } catch (e) {
        logError('SETTINGS_UPDATE', e);
        res.status(500).json({ error: "Erro ao salvar configurações." });
    }
};

/**
 * CHANGE PASSWORD
 * Rota: POST /api/profile/change-password
 * Valida a senha atual e define uma nova com hash Bcrypt.
 */
exports.changePassword = async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias." });
    }

    if (new_password.length < 6) {
        return res.status(400).json({ error: "A nova senha deve ter no mínimo 6 caracteres." });
    }

    try {
        // Buscar senha atual (hash)
        const userQuery = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);

        if (userQuery.rows.length === 0) {
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const currentHash = userQuery.rows[0].password;

        // Validar senha atual
        const isValid = await bcrypt.compare(current_password, currentHash);

        // Fallback temporário para senhas em texto plano durante migração
        const isPlainValid = current_password === currentHash;

        if (!isValid && !isPlainValid) {
            return res.status(401).json({ error: "A senha atual está incorreta." });
        }

        // Hash da nova senha
        const newHash = await bcrypt.hash(new_password, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);

        // Atualizar
        await pool.query(
            'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
            [newHash, req.user.id]
        );

        logSystem('PASSWORD_CHANGE', `Senha alterada com sucesso: ${req.user.id}`);
        res.json({
            success: true,
            message: "Sua senha foi alterada com segurança."
        });

    } catch (e) {
        logError('PASSWORD_CHANGE', e);
        res.status(500).json({ error: "Erro interno ao alterar senha." });
    }
};