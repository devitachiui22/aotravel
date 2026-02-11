/**
 * =================================================================================================
 * 👤 AOTRAVEL SERVER PRO - PROFILE MANAGEMENT CONTROLLER (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/profileController.js
 * DESCRIÇÃO: Controlador Mestre de Perfil de Usuário.
 *            Gerencia dados pessoais, uploads de mídia, auditoria de documentos (KYC),
 *            preferências do aplicativo e segurança de credenciais.
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * INTEGRAÇÃO:
 * - Database: PostgreSQL (Neon) via pool.
 * - Filesystem: Gestão de uploads via Multer (middleware externo) e FS.
 * - Security: Bcrypt para troca de senha.
 * - Utils: Helpers globais.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
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
    
    // Remove a barra inicial se existir para resolver o caminho corretamente
    const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    const fullPath = path.resolve(cleanPath);

    fs.unlink(fullPath, (err) => {
        if (err && err.code !== 'ENOENT') {
            // Loga erro apenas se não for "Arquivo não encontrado"
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
 * Descrição: Retorna o perfil completo do usuário autenticado, enriquecido com
 *            estatísticas operacionais (Corridas, Avaliações) e status financeiro.
 */
exports.getProfile = async (req, res) => {
    const userId = req.user.id;

    try {
        // 1. Busca Dados Base (Helper Otimizado)
        const user = await getUserFullDetails(userId);
        
        if (!user) {
            return res.status(404).json({ 
                error: "Perfil não encontrado.",
                code: "USER_NOT_FOUND" 
            });
        }

        // 2. Cálculo de Estatísticas (Aggregation)
        // Executa queries paralelas para performance
        const statsQuery = `
            SELECT
                -- Estatísticas como Passageiro
                COUNT(CASE WHEN passenger_id = $1 AND status = 'completed' THEN 1 END) as rides_taken,
                COUNT(CASE WHEN passenger_id = $1 AND status = 'cancelled' THEN 1 END) as rides_cancelled_by_me,
                COALESCE(AVG(CASE WHEN passenger_id = $1 THEN rating END), 5.0) as rating_as_passenger,

                -- Estatísticas como Motorista (Se aplicável)
                COUNT(CASE WHEN driver_id = $1 AND status = 'completed' THEN 1 END) as rides_given,
                COALESCE(AVG(CASE WHEN driver_id = $1 THEN rating END), 5.0) as rating_as_driver,
                
                -- Totais Gerais
                SUM(CASE WHEN (passenger_id = $1 OR driver_id = $1) AND status = 'completed' THEN distance_km ELSE 0 END) as total_km_traveled
            FROM rides
            WHERE passenger_id = $1 OR driver_id = $1
        `;

        const docCountQuery = `
            SELECT 
                COUNT(*) as total_docs,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_docs,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_docs
            FROM user_documents
            WHERE user_id = $1
        `;

        const [statsResult, docResult] = await Promise.all([
            pool.query(statsQuery, [userId]),
            pool.query(docCountQuery, [userId])
        ]);

        const stats = statsResult.rows[0];
        const docStats = docResult.rows[0];

        // 3. Sanitização de Segurança
        delete user.password;
        delete user.wallet_pin_hash; // Nunca expor hash de PIN

        // 4. Montagem do Payload Rico
        user.stats = {
            rides: {
                taken: parseInt(stats.rides_taken),
                given: parseInt(stats.rides_given),
                cancelled: parseInt(stats.rides_cancelled_by_me),
                total_km: parseFloat(stats.total_km_traveled || 0).toFixed(2)
            },
            ratings: {
                passenger: parseFloat(stats.rating_as_passenger).toFixed(2),
                driver: parseFloat(stats.rating_as_driver).toFixed(2)
            },
            compliance: {
                kyc_level: user.kyc_level,
                docs_uploaded: parseInt(docStats.total_docs),
                docs_approved: parseInt(docStats.approved_docs),
                docs_rejected: parseInt(docStats.rejected_docs),
                is_verified: user.is_verified
            }
        };

        // Retorna configurações parseadas (caso o driver PG retorne string)
        if (typeof user.settings === 'string') user.settings = JSON.parse(user.settings);
        if (typeof user.notification_preferences === 'string') user.notification_preferences = JSON.parse(user.notification_preferences);

        res.json(user);

    } catch (e) {
        logError('PROFILE_GET', e);
        res.status(500).json({ error: "Erro ao carregar dados do perfil." });
    }
};

// =================================================================================================
// 2. ATUALIZAÇÃO DE DADOS (WRITE OPERATIONS)
// =================================================================================================

/**
 * UPDATE PROFILE
 * Rota: PUT /api/profile
 * Descrição: Atualiza dados cadastrais básicos (Nome, Telefone) e detalhes do veículo.
 *            Implementa validação de inputs e restrições baseadas em Role.
 */
exports.updateProfile = async (req, res) => {
    const { name, phone, vehicle_details } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Preparação da Query Dinâmica
        const updates = [];
        const values = [];
        let paramCount = 1;

        // Atualização de Nome
        if (name && name.trim().length > 2) {
            updates.push(`name = $${paramCount}`);
            values.push(name.trim());
            paramCount++;
        }

        // Atualização de Telefone (Requer verificação de unicidade)
        if (phone) {
            if (!isValidPhone(phone)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Número de telefone inválido." });
            }

            // Verifica se o telefone já está em uso por OUTRO usuário
            const checkPhone = await client.query(
                "SELECT id FROM users WHERE phone = $1 AND id != $2",
                [phone.replace(/\D/g, ''), userId]
            );

            if (checkPhone.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: "Este número de telefone já está em uso." });
            }

            updates.push(`phone = $${paramCount}`);
            values.push(phone.replace(/\D/g, ''));
            paramCount++;
        }

        // Atualização de Veículo (Apenas Motoristas)
        if (vehicle_details) {
            if (userRole !== 'driver') {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: "Apenas motoristas podem ter detalhes de veículo." });
            }

            // Validação mínima do objeto JSON
            if (!vehicle_details.model || !vehicle_details.plate) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Modelo e Matrícula são obrigatórios para o veículo." });
            }

            // Merge com dados existentes para não perder info (ex: cor, ano)
            // Busca dados atuais
            const currentRes = await client.query("SELECT vehicle_details FROM users WHERE id = $1", [userId]);
            const currentDetails = currentRes.rows[0].vehicle_details || {};
            
            // Sobrescreve com novos dados
            const newDetails = { ...currentDetails, ...vehicle_details, updated_at: new Date().toISOString() };

            updates.push(`vehicle_details = $${paramCount}`);
            values.push(JSON.stringify(newDetails));
            paramCount++;
        }

        if (updates.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Nenhum dado válido fornecido para atualização." });
        }

        // Adiciona Timestamp
        updates.push(`updated_at = NOW()`);
        
        // Finaliza Query
        values.push(userId);
        const query = `
            UPDATE users 
            SET ${updates.join(', ')} 
            WHERE id = $${paramCount} 
            RETURNING id, name, phone, vehicle_details, updated_at
        `;

        const result = await client.query(query, values);

        await client.query('COMMIT');

        logSystem('PROFILE_UPDATE', `Usuário ${userId} atualizou seu perfil.`);

        res.json({
            success: true,
            message: "Perfil atualizado com sucesso.",
            user: result.rows[0]
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('PROFILE_UPDATE_ERROR', e);
        res.status(500).json({ error: "Erro ao atualizar perfil." });
    } finally {
        client.release();
    }
};

/**
 * UPLOAD PROFILE PHOTO
 * Rota: POST /api/profile/photo
 * Descrição: Recebe arquivo via Multer, salva no disco, atualiza DB e remove foto antiga.
 */
exports.uploadPhoto = async (req, res) => {
    const userId = req.user.id;

    if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo de imagem enviado." });
    }

    try {
        // 1. Identificar foto antiga para remoção
        const userRes = await pool.query("SELECT photo FROM users WHERE id = $1", [userId]);
        const oldPhoto = userRes.rows[0]?.photo;

        // 2. Definir novo caminho (URL relativa)
        // O Multer salva apenas o filename, precisamos prefixar
        const photoUrl = `/uploads/${req.file.filename}`;

        // 3. Atualizar Banco
        await pool.query(
            "UPDATE users SET photo = $1, updated_at = NOW() WHERE id = $2",
            [photoUrl, userId]
        );

        // 4. Limpeza (Cleanup)
        if (oldPhoto && oldPhoto !== photoUrl) {
            deleteOldFile(oldPhoto);
        }

        logSystem('PHOTO_UPLOAD', `Foto de perfil atualizada para User ${userId}`);

        res.json({
            success: true,
            message: "Foto de perfil atualizada.",
            photo_url: photoUrl
        });

    } catch (e) {
        // Se der erro no banco, tenta remover o arquivo que acabou de subir para não deixar lixo
        if (req.file) deleteOldFile(req.file.path);
        
        logError('PHOTO_UPLOAD_ERROR', e);
        res.status(500).json({ error: "Erro ao processar upload da foto." });
    }
};

/**
 * UPLOAD DOCUMENTS (KYC ENGINE)
 * Rota: POST /api/profile/documents
 * Descrição: Endpoint complexo para upload de BI e Carta de Condução.
 *            - Atualiza tabela `users` (colunas de atalho).
 *            - Insere na tabela `user_documents` (Auditoria e Histórico).
 *            - Reseta status de verificação para 'false' para forçar nova análise Admin.
 */
exports.uploadDocuments = async (req, res) => {
    // req.files contém os arrays de arquivos processados pelo Multer
    // Campos esperados: bi_front, bi_back, driving_license_front, driving_license_back
    
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

        // Helper para processar cada tipo de documento
        const processDoc = async (fieldName, dbColumn, docType, side) => {
            if (req.files[fieldName] && req.files[fieldName][0]) {
                const file = req.files[fieldName][0];
                const fileUrl = `/uploads/${file.filename}`;

                // A. Adiciona à lista de updates da tabela Users
                updates.push(`${dbColumn} = $${paramCount}`);
                values.push(fileUrl);
                paramCount++;

                // B. Insere/Atualiza na tabela de Auditoria (user_documents)
                // A lógica aqui é complexa: user_documents tem 'front_image' e 'back_image'
                // Precisamos saber se já existe um registro pendente para esse tipo de doc
                
                // Primeiro, upsert base
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
                } else {
                    // Se for verso, assume que o registro já deve ter sido criado pelo front ou cria agora
                    // Como o ON CONFLICT exige todos os campos NOT NULL, fazemos upsert seguro
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
                }
            }
        };

        // Processa BI (Bilhete de Identidade)
        await processDoc('bi_front', 'bi_front', 'bi', 'front');
        await processDoc('bi_back', 'bi_back', 'bi', 'back');

        // Processa Carta de Condução (Apenas se for motorista)
        if (req.user.role === 'driver') {
            await processDoc('driving_license_front', 'driving_license_front', 'driving_license', 'front');
            await processDoc('driving_license_back', 'driving_license_back', 'driving_license', 'back');
        }

        // Se houver atualizações na tabela users
        if (updates.length > 0) {
            // C. Reseta status de verificação (KYC Reset)
            // Qualquer novo upload invalida a verificação anterior por segurança
            updates.push(`is_verified = $${paramCount}`);
            values.push(false);
            paramCount++;

            updates.push(`updated_at = NOW()`);
            
            values.push(userId);
            const userUpdateQuery = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`;
            
            await client.query(userUpdateQuery, values);
        }

        await client.query('COMMIT');

        logSystem('DOC_UPLOAD', `Usuário ${userId} enviou novos documentos para análise.`);

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

/**
 * UPDATE SETTINGS
 * Rota: PUT /api/profile/settings
 * Descrição: Atualiza configurações do App (JSONB).
 *            Suporta atualização parcial (Merge) para não sobrescrever chaves existentes.
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

        // Busca configurações atuais para fazer Merge
        const currentRes = await client.query(
            "SELECT settings, privacy_settings, notification_preferences FROM users WHERE id = $1 FOR UPDATE",
            [userId]
        );
        const current = currentRes.rows[0];

        const updates = [];
        const values = [];
        let paramCount = 1;

        // Helper de Merge JSON
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
// 3. SEGURANÇA E CREDENCIAIS
// =================================================================================================

/**
 * CHANGE PASSWORD
 * Rota: POST /api/profile/change-password
 * Descrição: Altera a senha do usuário.
 *            Requer senha atual para validação.
 *            Encerra todas as sessões ativas (exceto a atual) por segurança.
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

        // 1. Busca senha atual (hash)
        const userQuery = await client.query('SELECT password FROM users WHERE id = $1 FOR UPDATE', [userId]);
        
        if (userQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Usuário não encontrado." });
        }

        const currentHash = userQuery.rows[0].password;

        // 2. Valida senha atual
        const isValid = await bcrypt.compare(current_password, currentHash);
        const isPlainValid = current_password === currentHash; // Fallback migração

        if (!isValid && !isPlainValid) {
            // Delay anti-bruteforce
            await new Promise(resolve => setTimeout(resolve, 1000));
            await client.query('ROLLBACK');
            return res.status(401).json({ error: "A senha atual está incorreta." });
        }

        // 3. Hash da nova senha
        const newHash = await bcrypt.hash(new_password, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);

        // 4. Atualiza senha
        await client.query(
            'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
            [newHash, userId]
        );

        // 5. Revoga outras sessões (Security Best Practice)
        // Mantém apenas a sessão atual se o token estiver disponível no request
        const currentSessionToken = req.headers['x-session-token'];
        if (currentSessionToken) {
            await client.query(
                'UPDATE user_sessions SET is_active = false WHERE user_id = $1 AND session_token != $2',
                [userId, currentSessionToken]
            );
        } else {
            // Se não conseguirmos identificar a sessão atual, derruba todas por segurança
            await client.query(
                'UPDATE user_sessions SET is_active = false WHERE user_id = $1',
                [userId]
            );
        }

        // 6. Log de Segurança
        await client.query(
            "INSERT INTO wallet_security_logs (user_id, event_type, ip_address, device_info) VALUES ($1, 'PASSWORD_CHANGE', $2, $3)",
            [userId, req.ip, req.headers['user-agent']]
        );

        await client.query('COMMIT');

        logSystem('SEC_PASS_CHANGE', `Senha alterada para User ${userId}`);

        res.json({
            success: true,
            message: "Sua senha foi alterada com sucesso. Outras sessões foram encerradas."
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('PASSWORD_CHANGE_FATAL', e);
        res.status(500).json({ error: "Erro interno ao alterar senha." });
    } finally {
        client.release();
    }
};

/**
 * =================================================================================================
 * FIM DO ARQUIVO - PROFILE CONTROLLER
 * =================================================================================================
 */