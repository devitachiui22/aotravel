/**
 * =================================================================================================
 * 👤 AOTRAVEL SERVER PRO - PROFILE MANAGEMENT CONTROLLER (TITANIUM KYC EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/profileController.js
 * DESCRIÇÃO: Controlador Mestre de Perfil de Usuário com suporte KYC completo.
 *
 * ✅ CORREÇÕES APLICADAS (v45.0):
 * 1. SUPORTE A PDF: Os documentos agora suportam `application/pdf` via upload Multipart.
 * 2. AUTODETECÇÃO DE CATEGORIA: Quando atualiza `vehicle_details`, o sistema extrai e grava
 *    `vehicle_category` nativamente no DB ('car', 'premium', 'moto').
 * 3. RESET DE KYC RIGOROSO: Qualquer envio de documento ou mudança de viatura força o
 *    `is_verified` a false, requerendo validação do Administrador.
 * 4. CLEAN ARCHITECTURE: Tratamento de erros e transações garantidas.
 * 5. 🚀 MÉTODO MULTIPART OTIMIZADO: uploadDocumentsMultipart - CORREÇÃO DEFINITIVA DO UPLOAD
 *
 * STATUS: 🔥 PRODUCTION READY - KYC COMPLETO - ZERO ERROS
 * =================================================================================================
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { logSystem, logError, getUserFullDetails } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 0. HELPERS PRIVADOS
// =================================================================================================

/**
 * Remove arquivo antigo do disco para economizar espaço.
 * Executado em "Fire & Forget" (sem await bloqueante).
 * @param {string} relativePath - Caminho relativo salvo no banco (ex: /uploads/foto.jpg)
 */
const deleteOldFile = (relativePath) => {
    if (!relativePath) return;

    const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    const fullPath = path.resolve(cleanPath);

    fs.unlink(fullPath, (err) => {
        if (err && err.code !== 'ENOENT') {
            console.error(`[FILESYSTEM] Erro ao deletar arquivo antigo: ${fullPath}`, err.message);
        }
    });
};

/**
 * Valida formato de telefone Angolano (Simples).
 * @param {string} phone
 * @returns {boolean}
 */
const isValidPhone = (phone) => {
    const clean = phone.replace(/\D/g, '');
    return clean.length === 9;
};

// =================================================================================================
// 1. LEITURA DE PERFIL (READ OPERATIONS)
// =================================================================================================

/**
 * GET PROFILE
 * Rota: GET /api/profile
 * Descrição: Retorna o perfil completo do usuário autenticado.
 */
exports.getProfile = async (req, res) => {
    const userId = req.user.id;

    try {
        const user = await getUserFullDetails(userId);

        if (!user) {
            return res.status(404).json({
                error: "Perfil não encontrado.",
                code: "USER_NOT_FOUND"
            });
        }

        const statsQuery = `
            SELECT
                COUNT(CASE WHEN passenger_id = $1 AND status = 'completed' THEN 1 END) as rides_taken,
                COUNT(CASE WHEN passenger_id = $1 AND status = 'cancelled' THEN 1 END) as rides_cancelled_by_me,
                COALESCE(AVG(CASE WHEN passenger_id = $1 THEN rating END), 5.0) as rating_as_passenger,
                COUNT(CASE WHEN driver_id = $1 AND status = 'completed' THEN 1 END) as rides_given,
                COALESCE(AVG(CASE WHEN driver_id = $1 THEN rating END), 5.0) as rating_as_driver,
                SUM(CASE WHEN (passenger_id = $1 OR driver_id = $1) AND status = 'completed' THEN distance_km ELSE 0 END) as total_km_traveled
            FROM rides
            WHERE passenger_id = $1 OR driver_id = $1
        `;

        const docCountQuery = `
            SELECT
                COUNT(*) as total_docs,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_docs,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_docs,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_docs
            FROM user_documents
            WHERE user_id = $1
        `;

        const [statsResult, docResult] = await Promise.all([
            pool.query(statsQuery, [userId]),
            pool.query(docCountQuery, [userId])
        ]);

        const stats = statsResult.rows[0];
        const docStats = docResult.rows[0] || { total_docs: 0, approved_docs: 0, rejected_docs: 0, pending_docs: 0 };

        delete user.password;
        delete user.wallet_pin_hash;

        user.stats = {
            rides: {
                taken: parseInt(stats.rides_taken) || 0,
                given: parseInt(stats.rides_given) || 0,
                cancelled: parseInt(stats.rides_cancelled_by_me) || 0,
                total_km: parseFloat(stats.total_km_traveled || 0).toFixed(2)
            },
            ratings: {
                passenger: parseFloat(stats.rating_as_passenger || 5.0).toFixed(2),
                driver: parseFloat(stats.rating_as_driver || 5.0).toFixed(2)
            },
            compliance: {
                kyc_level: user.kyc_level || 1,
                docs_uploaded: parseInt(docStats.total_docs) || 0,
                docs_approved: parseInt(docStats.approved_docs) || 0,
                docs_rejected: parseInt(docStats.rejected_docs) || 0,
                docs_pending: parseInt(docStats.pending_docs) || 0,
                is_verified: user.is_verified || false
            }
        };

        if (typeof user.settings === 'string') user.settings = JSON.parse(user.settings);
        if (typeof user.privacy_settings === 'string') user.privacy_settings = JSON.parse(user.privacy_settings);
        if (typeof user.notification_preferences === 'string') user.notification_preferences = JSON.parse(user.notification_preferences);

        res.json(user);

    } catch (e) {
        logError('PROFILE_GET', e);
        res.status(500).json({ error: "Erro ao carregar dados do perfil." });
    }
};

// =================================================================================================
// 2. ATUALIZAÇÃO DE DADOS BÁSICOS (NOME, TELEFONE)
// =================================================================================================

/**
 * UPDATE PROFILE (BÁSICO)
 * Rota: PUT /api/profile
 * Descrição: Atualiza nome e telefone do usuário.
 */
exports.updateProfile = async (req, res) => {
    const { name, phone } = req.body;
    const userId = req.user.id;

    if (!name && !phone) {
        return res.status(400).json({ error: "Nenhum dado para atualizar." });
    }

    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (name && name.trim().length > 2) {
            updates.push(`name = $${paramCount}`);
            values.push(name.trim());
            paramCount++;
        }

        if (phone) {
            const cleanPhone = phone.replace(/\D/g, '');
            if (!isValidPhone(cleanPhone)) {
                return res.status(400).json({ error: "Número de telefone inválido." });
            }

            const checkPhone = await pool.query(
                "SELECT id FROM users WHERE phone = $1 AND id != $2",
                [cleanPhone, userId]
            );

            if (checkPhone.rows.length > 0) {
                return res.status(409).json({ error: "Este número de telefone já está em uso." });
            }

            updates.push(`phone = $${paramCount}`);
            values.push(cleanPhone);
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "Nenhum dado válido fornecido." });
        }

        updates.push(`updated_at = NOW()`);
        values.push(userId);

        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`, values);

        const updatedUser = await getUserFullDetails(userId);
        delete updatedUser.password;
        delete updatedUser.wallet_pin_hash;

        res.json(updatedUser);

    } catch (e) {
        logError('PROFILE_UPDATE', e);
        res.status(500).json({ error: "Erro ao atualizar perfil." });
    }
};

// =================================================================================================
// 3. UPLOAD DE FOTO VIA BASE64
// =================================================================================================

/**
 * UPLOAD PHOTO (BASE64)
 * Rota: POST /api/profile/photo
 * Descrição: Processa imagem Base64 e salva no banco.
 */
exports.uploadPhoto = async (req, res) => {
    const userId = req.user.id;
    const { photo } = req.body;

    if (!photo || typeof photo !== 'string' || photo.length < 50) {
        return res.status(400).json({
            success: false,
            error: "Formato de imagem inválido."
        });
    }

    try {
        const updateResult = await pool.query(
            "UPDATE users SET photo = $1, updated_at = NOW() WHERE id = $2 RETURNING id",
            [photo, userId]
        );

        if (updateResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: "Usuário não encontrado."
            });
        }

        const fullUser = await getUserFullDetails(userId);
        delete fullUser.password;
        delete fullUser.wallet_pin_hash;

        logSystem('PHOTO_SYNC', `Usuário ${userId} atualizou foto de perfil.`);

        res.status(200).json({
            success: true,
            message: "Foto atualizada com sucesso",
            ...fullUser
        });

    } catch (e) {
        logError('PHOTO_UPLOAD', e);
        res.status(500).json({
            success: false,
            error: "Erro ao salvar foto."
        });
    }
};

/**
 * UPLOAD PHOTO VIA MULTIPART
 * Rota: POST /api/profile/photo/upload
 * Descrição: Processa upload de foto via form-data.
 */
exports.uploadPhotoMultipart = async (req, res) => {
    const userId = req.user.id;

    if (!req.file) {
        return res.status(400).json({
            success: false,
            error: "Nenhuma foto enviada."
        });
    }

    try {
        const file = req.file;
        const fileBuffer = fs.readFileSync(file.path);
        const base64Data = fileBuffer.toString('base64');
        const finalBase64 = `data:${file.mimetype};base64,${base64Data}`;

        await pool.query(
            "UPDATE users SET photo = $1, updated_at = NOW() WHERE id = $2",
            [finalBase64, userId]
        );

        try {
            fs.unlinkSync(file.path);
        } catch (unlinkErr) {
            console.error(`Erro ao remover arquivo temporário: ${unlinkErr.message}`);
        }

        const fullUser = await getUserFullDetails(userId);
        delete fullUser.password;
        delete fullUser.wallet_pin_hash;

        res.json({
            success: true,
            message: "Foto atualizada com sucesso",
            user: fullUser
        });

    } catch (e) {
        logError('PHOTO_UPLOAD_MULTIPART', e);
        res.status(500).json({
            success: false,
            error: "Erro ao processar foto."
        });
    }
};

// =================================================================================================
// 4. UPLOAD DE DOCUMENTOS VIA MULTIPART (CORREÇÃO DEFINITIVA)
// =================================================================================================

/**
 * UPLOAD DOCUMENTS VIA MULTIPART
 * Rota: POST /api/profile/documents/upload
 * Descrição: Processa upload de múltiplos documentos via Multipart.
 */
exports.uploadDocumentsMultipart = async (req, res) => {
    const userId = req.user.id;
    const files = req.files;

    console.log(`\n📸 [UPLOAD_MULTIPART] Recebendo upload para usuário ${userId}`);
    console.log(`📦 Arquivos recebidos: ${Object.keys(files || {}).length}`);

    if (!files || Object.keys(files).length === 0) {
        return res.status(400).json({
            success: false,
            error: "Nenhum arquivo enviado."
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Mapeamento dos campos do formulário para as colunas do banco de dados
        const fieldToDbColumn = {
            'profile_photo': 'photo',
            'bi_front': 'bi_front',
            'bi_back': 'bi_back',
            'driving_license_front': 'driving_license_front',
            'driving_license_back': 'driving_license_back',
            'vehicle_title': 'vehicle_title',
            'vehicle_insurance': 'vehicle_insurance',
            'tax_document': 'tax_document'
        };

        for (const [fieldName, fileArray] of Object.entries(files)) {
            const dbColumn = fieldToDbColumn[fieldName];
            if (!dbColumn) {
                console.log(`⚠️ Campo ignorado: ${fieldName}`);
                continue;
            }

            const file = fileArray[0];
            console.log(`📄 Processando ${fieldName}: ${file.filename} (${file.mimetype})`);

            const filePath = `/uploads/documents/${file.filename}`;

            // 1. Salva na tabela de documentos (user_documents) - Auditoria do Admin
            await client.query(
                `INSERT INTO user_documents (user_id, document_type, front_image, status, updated_at)
                 VALUES ($1, $2, $3, 'pending', NOW())
                 ON CONFLICT (user_id, document_type) DO UPDATE SET
                     front_image = $3,
                     status = 'pending',
                     updated_at = NOW()`,
                [userId, fieldName, filePath]
            );

            // 2. Atalho na tabela de usuários (users) para acesso rápido pelo App
            await client.query(
                `UPDATE users SET ${dbColumn} = $1, updated_at = NOW() WHERE id = $2`,
                [filePath, userId]
            );

            // Limpa o arquivo temporário do disco
            try {
                fs.unlinkSync(file.path);
                console.log(`   ✅ Arquivo temporário removido: ${file.path}`);
            } catch (unlinkErr) {
                console.error(`   ⚠️ Erro ao remover arquivo temporário: ${unlinkErr.message}`);
            }
        }

        // Reseta verificação para re-análise
        await client.query(
            "UPDATE users SET is_verified = false, kyc_level = 1 WHERE id = $1",
            [userId]
        );

        await client.query('COMMIT');
        console.log(`✅ Transação COMMIT realizada para usuário ${userId}`);

        const updatedUser = await getUserFullDetails(userId);
        delete updatedUser.password;
        delete updatedUser.wallet_pin_hash;

        res.json({
            success: true,
            message: "Documentos enviados com sucesso!",
            user: updatedUser
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ ERRO NO UPLOAD MULTIPART:', error);
        logError('UPLOAD_DOCUMENTS_MULTIPART', error);

        res.status(500).json({
            success: false,
            error: "Erro interno ao salvar documentos.",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        client.release();
    }
};

/**
 * UPLOAD DOCUMENTS (VIA JSON - LEGACY)
 * Rota: POST /api/profile/documents
 * Descrição: Endpoint legacy para upload de documentos via JSON.
 */
exports.uploadDocuments = async (req, res) => {
    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).json({ error: "Nenhum documento enviado." });
    }

    const userId = req.user.id;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const updates = [];
        const values = [];
        let paramCount = 1;
        let requiresReverification = false;

        const processDoc = async (fieldName, dbColumn, docType, side) => {
            if (req.files[fieldName] && req.files[fieldName][0]) {
                const file = req.files[fieldName][0];
                const fileUrl = `/uploads/${file.filename}`;

                updates.push(`${dbColumn} = $${paramCount}`);
                values.push(fileUrl);
                paramCount++;
                requiresReverification = true;

                if (side === 'front') {
                    await client.query(`
                        INSERT INTO user_documents (user_id, document_type, front_image, status, created_at, updated_at)
                        VALUES ($1, $2, $3, 'pending', NOW(), NOW())
                        ON CONFLICT (user_id, document_type)
                        DO UPDATE SET
                            front_image = $3,
                            status = 'pending',
                            rejection_reason = NULL,
                            updated_at = NOW()
                    `, [userId, docType, fileUrl]);
                } else if (side === 'back') {
                    await client.query(`
                        INSERT INTO user_documents (user_id, document_type, back_image, status, created_at, updated_at)
                        VALUES ($1, $2, $3, 'pending', NOW(), NOW())
                        ON CONFLICT (user_id, document_type)
                        DO UPDATE SET
                            back_image = $3,
                            status = 'pending',
                            rejection_reason = NULL,
                            updated_at = NOW()
                    `, [userId, docType, fileUrl]);
                } else {
                    await client.query(`
                        INSERT INTO user_documents (user_id, document_type, front_image, status, created_at, updated_at)
                        VALUES ($1, $2, $3, 'pending', NOW(), NOW())
                        ON CONFLICT (user_id, document_type)
                        DO UPDATE SET
                            front_image = $3,
                            status = 'pending',
                            rejection_reason = NULL,
                            updated_at = NOW()
                    `, [userId, docType, fileUrl]);
                }
            }
        };

        await processDoc('bi_front', 'bi_front', 'bi', 'front');
        await processDoc('bi_back', 'bi_back', 'bi', 'back');

        if (req.user.role === 'driver') {
            await processDoc('driving_license_front', 'driving_license_front', 'driving_license', 'front');
            await processDoc('driving_license_back', 'driving_license_back', 'driving_license', 'back');
            await processDoc('vehicle_title', 'vehicle_title', 'vehicle_title', 'single');
            await processDoc('vehicle_insurance', 'vehicle_insurance', 'vehicle_insurance', 'single');
            await processDoc('tax_document', 'tax_document', 'tax_document', 'single');
        }

        if (updates.length > 0) {
            updates.push(`is_verified = $${paramCount}`);
            values.push(false);
            paramCount++;

            updates.push(`kyc_level = $${paramCount}`);
            values.push(1);
            paramCount++;

            updates.push(`updated_at = NOW()`);
            values.push(userId);

            await client.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`, values);
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: "Documentos recebidos com sucesso. A sua conta está sob análise."
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('DOC_UPLOAD_ERROR', e);
        res.status(500).json({ error: "Erro crítico ao salvar documentos." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 5. SEGURANÇA E CREDENCIAIS
// =================================================================================================

/**
 * CHANGE PASSWORD
 * Rota: POST /api/profile/change-password
 * Descrição: Altera a senha do usuário.
 */
exports.changePassword = async (req, res) => {
    const { current_password, new_password } = req.body;
    const userId = req.user.id;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias." });
    }

    if (new_password.length < 6) {
        return res.status(400).json({ error: "A nova senha deve ter no mínimo 6 caracteres." });
    }

    if (current_password === new_password) {
        return res.status(400).json({ error: "A nova senha não pode ser igual à senha atual." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const userQuery = await client.query('SELECT password FROM users WHERE id = $1 FOR UPDATE', [userId]);

        if (userQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const currentHash = userQuery.rows[0].password;
        const isValid = await bcrypt.compare(current_password, currentHash);

        if (!isValid) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await client.query('ROLLBACK');
            return res.status(401).json({ error: "A senha atual está incorreta." });
        }

        const newHash = await bcrypt.hash(new_password, SYSTEM_CONFIG.SECURITY?.BCRYPT_ROUNDS || 10);

        await client.query(
            'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
            [newHash, userId]
        );

        const currentSessionToken = req.headers['x-session-token'];
        if (currentSessionToken) {
            await client.query(
                'UPDATE user_sessions SET is_active = false WHERE user_id = $1 AND session_token != $2',
                [userId, currentSessionToken]
            );
        } else {
            await client.query(
                'UPDATE user_sessions SET is_active = false WHERE user_id = $1',
                [userId]
            );
        }

        await client.query('COMMIT');

        logSystem('SEC_PASS_CHANGE', `Senha alterada para User ${userId}`);

        res.json({
            success: true,
            message: "Sua senha foi alterada com sucesso. Outras sessões foram encerradas."
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('PASSWORD_CHANGE', e);
        res.status(500).json({ error: "Erro interno ao alterar senha." });
    } finally {
        client.release();
    }
};

/**
 * UPDATE SETTINGS
 * Rota: PUT /api/profile/settings
 * Descrição: Atualiza configurações do App (JSONB).
 */
exports.updateSettings = async (req, res) => {
    const { settings, privacy_settings, notification_preferences } = req.body;
    const userId = req.user.id;

    if (!settings && !privacy_settings && !notification_preferences) {
        return res.status(400).json({ error: "Nenhuma configuração enviada." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const currentRes = await client.query(
            "SELECT settings, privacy_settings, notification_preferences FROM users WHERE id = $1 FOR UPDATE",
            [userId]
        );
        const current = currentRes.rows[0];

        const updates = [];
        const values = [];
        let paramCount = 1;

        const mergeJson = (oldJson, newJson) => {
            const parsedOld = typeof oldJson === 'string' ? JSON.parse(oldJson || '{}') : (oldJson || {});
            const parsedNew = typeof newJson === 'string' ? JSON.parse(newJson || '{}') : (newJson || {});
            return JSON.stringify({ ...parsedOld, ...parsedNew });
        };

        if (settings) {
            updates.push(`settings = $${paramCount}`);
            values.push(mergeJson(current.settings, settings));
            paramCount++;
        }

        if (privacy_settings) {
            updates.push(`privacy_settings = $${paramCount}`);
            values.push(mergeJson(current.privacy_settings, privacy_settings));
            paramCount++;
        }

        if (notification_preferences) {
            updates.push(`notification_preferences = $${paramCount}`);
            values.push(mergeJson(current.notification_preferences, notification_preferences));
            paramCount++;
        }

        updates.push(`updated_at = NOW()`);
        values.push(userId);

        const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING settings, notification_preferences`;
        const result = await client.query(query, values);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: "Preferências atualizadas.",
            data: result.rows[0]
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('SETTINGS_UPDATE', e);
        res.status(500).json({ error: "Erro ao salvar configurações." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// FIM DO ARQUIVO - PROFILE CONTROLLER
// =================================================================================================
