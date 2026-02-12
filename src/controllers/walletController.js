/**
 * =================================================================================================
 * 🏦 AOTRAVEL SERVER PRO - WALLET API CONTROLLER (TITANIUM INTERFACE)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/walletController.js
 * DESCRIÇÃO: Controlador REST para operações financeiras.
 *            GESTÃO DE CONTAS BANCÁRIAS - VERSÃO SIMPLIFICADA
 *            ✓ Aceita QUALQUER IBAN ou número de conta (11-16 dígitos ou formato livre)
 *            ✓ Sem validação agressiva - apenas logs para debug
 *            ✓ Pronto para substituir por API real sem mexer no frontend
 *            ✓ Mantém compatibilidade total com o app Flutter existente
 * 
 * STATUS: PRODUCTION READY - TEMPORARY ACCEPT ALL MODE
 * =================================================================================================
 */

const pool = require('../config/db');
const walletService = require('../services/walletService');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { logError, logSystem, generateAccountNumber } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// HELPERS PRIVADOS DO CONTROLLER
// =================================================================================================

/**
 * Verifica se o PIN transacional fornecido é válido.
 * Lança erro se inválido, interrompendo o fluxo.
 */
async function verifyPinInternal(userId, pinInput) {
    if (!pinInput) throw new Error("O PIN de transação é obrigatório.");

    const res = await pool.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
    const storedHash = res.rows[0]?.wallet_pin_hash;

    if (!storedHash) {
        throw new Error("PIN de transação não configurado. Vá em Configurações > Segurança.");
    }

    const match = await bcrypt.compare(pinInput, storedHash);
    if (!match) {
        throw new Error("PIN incorreto.");
    }
    return true;
}

// =================================================================================================
// ENDPOINTS DE LEITURA (DASHBOARD)
// =================================================================================================

/**
 * GET /api/wallet
 * Retorna o estado completo da carteira: Saldo, Extrato, Cartões e Contas.
 * Implementa "Lazy Provisioning" do número da conta.
 */
exports.getWalletData = async (req, res) => {
    try {
        const userId = req.user.id;

        const userRes = await pool.query(
            `SELECT
                balance,
                bonus_points,
                wallet_account_number,
                wallet_status,
                daily_limit,
                daily_limit_used,
                account_tier,
                phone,
                (wallet_pin_hash IS NOT NULL) as has_pin
             FROM users WHERE id = $1`,
            [userId]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: "Carteira não encontrada." });
        }

        let userData = userRes.rows[0];

        if (!userData.wallet_account_number) {
            const newAccountNum = generateAccountNumber(userData.phone);
            if (newAccountNum) {
                await pool.query(
                    "UPDATE users SET wallet_account_number = $1 WHERE id = $2",
                    [newAccountNum, userId]
                );
                userData.wallet_account_number = newAccountNum;
                logSystem('WALLET', `Conta Titanium gerada automaticamente para User ${userId}: ${newAccountNum}`);
            }
        }

        const txQuery = `
            SELECT
                t.*,
                s.name as sender_name,
                r.name as receiver_name
            FROM wallet_transactions t
            LEFT JOIN users s ON t.sender_id = s.id
            LEFT JOIN users r ON t.receiver_id = r.id
            WHERE (t.user_id = $1 OR t.sender_id = $1 OR t.receiver_id = $1)
              AND t.is_hidden = FALSE
            ORDER BY t.created_at DESC
            LIMIT 30
        `;
        const txRes = await pool.query(txQuery, [userId]);

        const cardsRes = await pool.query(
            "SELECT * FROM wallet_cards WHERE user_id = $1 AND is_active = TRUE ORDER BY is_default DESC",
            [userId]
        );

        const accountsRes = await pool.query(
            "SELECT * FROM external_bank_accounts WHERE user_id = $1 ORDER BY is_default DESC",
            [userId]
        );

        res.json({
            balance: parseFloat(userData.balance),
            bonus_points: userData.bonus_points,
            account_number: userData.wallet_account_number,
            status: userData.wallet_status,
            limits: {
                daily_total: parseFloat(userData.daily_limit),
                daily_used: parseFloat(userData.daily_limit_used),
                tier: userData.account_tier
            },
            has_pin: userData.has_pin,
            recent_transactions: txRes.rows,
            cards: cardsRes.rows,
            bank_accounts: accountsRes.rows
        });

    } catch (e) {
        logError('WALLET_GET_DATA', e);
        res.status(500).json({ error: "Erro ao carregar dados da carteira." });
    }
};

// =================================================================================================
// ENDPOINTS TRANSACIONAIS (ACID OPERATIONS)
// =================================================================================================

/**
 * POST /api/wallet/transfer/internal
 * Transferência P2P entre usuários.
 */
exports.internalTransfer = async (req, res) => {
    const { receiver_identifier, amount, pin, description } = req.body;
    const senderId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0) return res.status(400).json({ error: "Valor de transferência inválido." });
    if (val < SYSTEM_CONFIG.WALLET_LIMITS.TRANSACTION_MIN) {
        return res.status(400).json({ error: `Valor mínimo é ${SYSTEM_CONFIG.WALLET_LIMITS.TRANSACTION_MIN} Kz.` });
    }
    if (!receiver_identifier) return res.status(400).json({ error: "Destinatário obrigatório." });

    try {
        await verifyPinInternal(senderId, pin);

        const result = await walletService.processInternalTransfer(
            senderId,
            receiver_identifier,
            val,
            description
        );

        if (global.io) {
            global.io.to(`user_${result.receiver_id}`).emit('wallet_update', {
                type: 'received',
                amount: val,
                balance_delta: val,
                title: 'Transferência Recebida',
                message: `Você recebeu ${val.toFixed(2)} Kz de ${req.user.name}`
            });

            global.io.to(`user_${senderId}`).emit('wallet_update', {
                type: 'sent',
                amount: val,
                balance_delta: -val,
                new_balance: result.new_balance
            });
        }

        res.json({
            success: true,
            message: "Transferência realizada com sucesso.",
            details: result
        });

    } catch (e) {
        logError('WALLET_TRANSFER', e.message);
        res.status(400).json({ error: e.message });
    }
};

/**
 * POST /api/wallet/topup
 * Recarga de Saldo (Depósito).
 */
exports.topup = async (req, res) => {
    const { amount, method, payment_details } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val < SYSTEM_CONFIG.WALLET_LIMITS.MIN_DEPOSIT) {
        return res.status(400).json({ error: `Valor mínimo de recarga: ${SYSTEM_CONFIG.WALLET_LIMITS.MIN_DEPOSIT} Kz.` });
    }

    try {
        const result = await walletService.processTopUp(userId, val, method, payment_details || {});

        if (global.io) {
            global.io.to(`user_${userId}`).emit('wallet_update', {
                type: 'topup',
                amount: val,
                new_balance: result.new_balance,
                title: 'Recarga Concluída',
                message: `Seu saldo foi recarregado em ${val.toFixed(2)} Kz.`
            });
        }

        res.json(result);

    } catch (e) {
        logError('WALLET_TOPUP', e);
        res.status(500).json({ error: e.message });
    }
};

/**
 * POST /api/wallet/withdraw
 * Saque para conta bancária.
 */
exports.withdraw = async (req, res) => {
    const { amount, bank_account_id, pin } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val < SYSTEM_CONFIG.WALLET_LIMITS.MIN_WITHDRAW) {
        return res.status(400).json({ error: `Saque mínimo: ${SYSTEM_CONFIG.WALLET_LIMITS.MIN_WITHDRAW} Kz` });
    }

    try {
        await verifyPinInternal(userId, pin);

        const result = await walletService.processWithdrawal(userId, val, bank_account_id);

        if (global.io) {
            global.io.to(`user_${userId}`).emit('wallet_update', {
                type: 'withdraw',
                amount: val,
                new_balance: result.new_balance
            });
        }

        res.json(result);

    } catch (e) {
        logError('WALLET_WITHDRAW', e);
        res.status(400).json({ error: e.message });
    }
};

/**
 * POST /api/wallet/pay-service
 * Pagamento de Contas (Serviços).
 */
exports.payService = async (req, res) => {
    const { service_id, reference, amount, pin } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    try {
        await verifyPinInternal(userId, pin);

        const result = await walletService.processServicePayment(userId, service_id, reference, val);

        if (global.io) {
            global.io.to(`user_${userId}`).emit('wallet_update', {
                type: 'payment',
                amount: val,
                new_balance: result.new_balance
            });
        }

        res.json(result);

    } catch (e) {
        logError('WALLET_PAY_SERVICE', e);
        res.status(400).json({ error: e.message });
    }
};

// =================================================================================================
// GESTÃO DE SEGURANÇA (PIN)
// =================================================================================================

/**
 * POST /api/wallet/set-pin
 * Define ou altera o PIN de transação (4 dígitos).
 */
exports.setPin = async (req, res) => {
    const { pin, old_pin } = req.body;
    const userId = req.user.id;

    if (!pin || pin.length !== 4 || isNaN(pin)) {
        return res.status(400).json({ error: "O PIN deve conter exatamente 4 dígitos numéricos." });
    }

    try {
        const userRes = await pool.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
        const currentHash = userRes.rows[0]?.wallet_pin_hash;

        if (currentHash) {
            if (!old_pin) return res.status(400).json({ error: "Para alterar, informe o PIN atual." });

            const match = await bcrypt.compare(old_pin, currentHash);
            if (!match) return res.status(401).json({ error: "O PIN atual informado está incorreto." });
        }

        const newHash = await bcrypt.hash(pin, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);

        await pool.query(
            "UPDATE users SET wallet_pin_hash = $1, updated_at = NOW() WHERE id = $2",
            [newHash, userId]
        );

        await pool.query(
            "INSERT INTO wallet_security_logs (user_id, event_type, ip_address, device_info) VALUES ($1, 'PIN_CHANGE', $2, $3)",
            [userId, req.ip, req.headers['user-agent']]
        );

        res.json({ success: true, message: "PIN de segurança definido com sucesso." });

    } catch (e) {
        logError('SET_PIN', e);
        res.status(500).json({ error: "Erro interno ao definir PIN." });
    }
};

/**
 * POST /api/wallet/verify-pin
 * Endpoint auxiliar para o Frontend verificar o PIN antes de liberar UI sensível.
 */
exports.verifyPin = async (req, res) => {
    try {
        await verifyPinInternal(req.user.id, req.body.pin);
        res.json({ valid: true });
    } catch (e) {
        res.json({ valid: false, error: e.message });
    }
};

// =================================================================================================
// 🏦 GESTÃO DE CONTAS BANCÁRIAS - VERSÃO ACEITA TUDO
// =================================================================================================
// 🔥 IMPORTANTE: Esta versão ACEITA QUALQUER número de conta ou IBAN
// 🔥 Quando tiver API real do banco, SUBSTITUIR apenas o conteúdo desta função
// 🔥 Mantém compatibilidade total com o frontend - NÃO PRECISA MEXER NO APP
// =================================================================================================

/**
 * POST /api/wallet/accounts/add
 * Adiciona conta bancária para saque.
 * 
 * ✅ ACEITA QUALQUER FORMATO:
 *   - IBAN completo: AO06 0006 1212 1467 0804 0301 2
 *   - Número da conta: 0006 1212 1467 0804 0
 *   - Apenas dígitos: 0006121214670804012
 *   - Qualquer texto: "minha conta teste 123"
 * 
 * ✅ NENHUMA VALIDAÇÃO AGRESSIVA
 * ✅ APENAS SALVA EXATAMENTE COMO RECEBEU
 * ✅ PRONTO PARA API REAL - SÓ SUBSTITUIR O TRY/CATCH
 */
exports.addAccount = async (req, res) => {
    const { provider, accountNumber, holderName } = req.body;
    const userId = req.user.id;

    // =====================================================================
    // 🔧 LOG DE DEBUG - VER O QUE O FRONTEND ESTÁ ENVIANDO
    // =====================================================================
    console.log('\n📥 [ADD_ACCOUNT] ==========================================');
    console.log(`   📌 Provider:     ${provider}`);
    console.log(`   📌 Account:      ${accountNumber}`);
    console.log(`   📌 Holder:       ${holderName}`);
    console.log(`   📌 UserID:       ${userId}`);
    console.log('========================================================\n');

    // =====================================================================
    // ✅ VALIDAÇÃO MÍNIMA - APENAS CAMPOS OBRIGATÓRIOS
    // =====================================================================
    if (!provider) {
        console.log('❌ [ADD_ACCOUNT] Erro: Provider não informado');
        return res.status(400).json({ error: "O nome do banco é obrigatório." });
    }

    if (!accountNumber) {
        console.log('❌ [ADD_ACCOUNT] Erro: Número da conta não informado');
        return res.status(400).json({ error: "O número da conta é obrigatório." });
    }

    if (!holderName) {
        console.log('❌ [ADD_ACCOUNT] Erro: Nome do titular não informado');
        return res.status(400).json({ error: "O nome do titular é obrigatório." });
    }

    // =====================================================================
    // ✅ LIMPEZA MÍNIMA - REMOVE ESPAÇOS PARA ARMAZENAR
    // =====================================================================
    const contaClean = accountNumber.replace(/\s/g, '');
    
    console.log(`   🧹 Limpo:        ${contaClean}`);
    console.log(`   📏 Tamanho:      ${contaClean.length} caracteres`);

    try {
        // =================================================================
        // 🔥 ACEITA TUDO - SEM VALIDAÇÕES
        // =================================================================
        // Qualquer conta com mais de 5 caracteres é aceita
        if (contaClean.length < 5) {
            console.log(`   ⚠️ Aviso: Conta muito curta (${contaClean.length} chars), mas mesmo assim será aceita`);
        }

        // =================================================================
        // ✅ VERIFICAR LIMITE DE CONTAS POR USUÁRIO
        // =================================================================
        const countRes = await pool.query(
            "SELECT COUNT(*) FROM external_bank_accounts WHERE user_id = $1", 
            [userId]
        );
        
        const accountCount = parseInt(countRes.rows[0].count);
        
        if (accountCount >= (SYSTEM_CONFIG.WALLET_LIMITS?.MAX_ACCOUNTS || 10)) {
            console.log(`❌ [ADD_ACCOUNT] Limite de contas atingido: ${accountCount}/10`);
            return res.status(400).json({ 
                error: "Limite máximo de contas bancárias atingido (10 contas)." 
            });
        }

        // =================================================================
        // ✅ SALVAR EXATAMENTE COMO RECEBEU
        // =================================================================
        // IMPORTANTE: Salva o número EXATO que o usuário digitou
        // Nenhuma transformação, nenhuma validação, nenhum cálculo
        // =================================================================
        const insertRes = await pool.query(
            `INSERT INTO external_bank_accounts 
             (
                user_id, 
                bank_name, 
                iban,              -- Salva EXATAMENTE o que veio do frontend
                holder_name, 
                is_verified, 
                is_default, 
                created_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING id, bank_name, iban, holder_name`,
            [
                userId, 
                provider, 
                contaClean,        // ✅ Salva SEM espaços, MAS EXATAMENTE como digitou
                holderName.toUpperCase(), 
                true,              // Marca como verificado (simulação)
                accountCount === 0 // Primeira conta = padrão
            ]
        );

        const novaConta = insertRes.rows[0];
        
        // =================================================================
        // ✅ GERAR MÁSCARA PARA EXIBIÇÃO NO FRONTEND
        // =================================================================
        let maskedIban = contaClean;
        if (contaClean.length > 8) {
            maskedIban = `${contaClean.substring(0, 4)}...${contaClean.substring(contaClean.length - 4)}`;
        } else {
            maskedIban = `...${contaClean.substring(contaClean.length - 4)}`;
        }

        console.log('\n✅ [ADD_ACCOUNT] Conta salva com SUCESSO:');
        console.log(`   🆔 ID:           ${novaConta.id}`);
        console.log(`   🏦 Banco:        ${novaConta.bank_name}`);
        console.log(`   🔢 IBAN/Conta:   ${novaConta.iban}`);
        console.log(`   👤 Titular:      ${novaConta.holder_name}`);
        console.log(`   🎭 Máscara:      ${maskedIban}`);
        console.log(`   ⭐ Padrão:       ${accountCount === 0 ? 'SIM' : 'NÃO'}`);
        console.log('========================================================\n');

        // =================================================================
        // 📡 NOTIFICAÇÃO EM TEMPO REAL
        // =================================================================
        if (global.io) {
            global.io.to(`user_${userId}`).emit('bank_account_added', {
                id: novaConta.id,
                bank_name: novaConta.bank_name,
                iban: novaConta.iban,
                holder_name: novaConta.holder_name,
                masked_iban: maskedIban
            });
            
            console.log('   📡 Notificação enviada via Socket.IO');
        }

        // =================================================================
        // ✅ RESPOSTA DE SUCESSO
        // =================================================================
        res.status(201).json({
            success: true,
            message: "Conta bancária adicionada com sucesso.",
            account: {
                id: novaConta.id,
                bank: novaConta.bank_name,
                iban: novaConta.iban,
                holder: novaConta.holder_name,
                masked_iban: maskedIban
            }
        });

    } catch (e) {
        // =================================================================
        // ❌ ERRO NO SERVIDOR - NUNCA É CULPA DO IBAN
        // =================================================================
        console.error('\n❌ [ADD_ACCOUNT] ERRO NO SERVIDOR:');
        console.error(`   ${e.message}`);
        console.error('========================================================\n');
        
        logError('ADD_ACCOUNT', e);
        
        res.status(500).json({ 
            error: "Erro interno ao adicionar conta bancária. Tente novamente." 
        });
    }
};

// =================================================================================================
// 🔧 ENDPOINTS AUXILIARES DE CONTAS BANCÁRIAS
// =================================================================================================

/**
 * DELETE /api/wallet/accounts/:id
 * Remove uma conta bancária.
 */
exports.deleteAccount = async (req, res) => {
    try {
        console.log(`📥 [DELETE_ACCOUNT] ID: ${req.params.id}, User: ${req.user.id}`);
        
        const result = await pool.query(
            "DELETE FROM external_bank_accounts WHERE id = $1 AND user_id = $2 RETURNING id, bank_name",
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            console.log(`❌ [DELETE_ACCOUNT] Conta não encontrada: ${req.params.id}`);
            return res.status(404).json({ error: "Conta bancária não encontrada." });
        }

        console.log(`✅ [DELETE_ACCOUNT] Conta removida: ${result.rows[0].bank_name} (${result.rows[0].id})`);
        
        if (global.io) {
            global.io.to(`user_${req.user.id}`).emit('bank_account_deleted', {
                id: req.params.id
            });
        }

        res.json({ 
            success: true, 
            message: "Conta bancária removida com sucesso.",
            account_id: req.params.id
        });
        
    } catch (e) {
        console.error('❌ [DELETE_ACCOUNT] Erro:', e);
        logError('DELETE_ACCOUNT', e);
        res.status(500).json({ error: "Erro ao remover conta bancária." });
    }
};

/**
 * GET /api/wallet/accounts
 * Lista todas as contas bancárias do usuário.
 */
exports.listAccounts = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 
                id, 
                bank_name, 
                iban, 
                holder_name, 
                is_default, 
                created_at,
                CASE 
                    WHEN LENGTH(iban) > 8 
                    THEN CONCAT(LEFT(iban, 4), '...', RIGHT(iban, 4))
                    ELSE CONCAT('...', RIGHT(iban, 4))
                END as masked_iban
             FROM external_bank_accounts 
             WHERE user_id = $1 
             ORDER BY is_default DESC, created_at DESC`,
            [req.user.id]
        );

        res.json({
            success: true,
            accounts: result.rows
        });

    } catch (e) {
        logError('LIST_ACCOUNTS', e);
        res.status(500).json({ error: "Erro ao listar contas bancárias." });
    }
};

/**
 * PUT /api/wallet/accounts/:id/default
 * Define uma conta como padrão.
 */
exports.setDefaultAccount = async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        await client.query(
            "UPDATE external_bank_accounts SET is_default = false WHERE user_id = $1",
            [req.user.id]
        );
        
        const result = await client.query(
            "UPDATE external_bank_accounts SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING id",
            [req.params.id, req.user.id]
        );
        
        await client.query('COMMIT');
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Conta não encontrada." });
        }
        
        if (global.io) {
            global.io.to(`user_${req.user.id}`).emit('default_account_updated', {
                account_id: req.params.id
            });
        }
        
        res.json({ 
            success: true, 
            message: "Conta padrão atualizada com sucesso." 
        });

    } catch (e) {
        await client.query('ROLLBACK');
        logError('SET_DEFAULT_ACCOUNT', e);
        res.status(500).json({ error: "Erro ao definir conta padrão." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// GESTÃO DE CARTÕES
// =================================================================================================

/**
 * POST /api/wallet/cards/add
 * Adiciona cartão virtual ou físico.
 */
exports.addCard = async (req, res) => {
    const { number, expiry, alias, type } = req.body;
    const userId = req.user.id;

    if (!number || number.length < 13) {
        return res.status(400).json({ error: "Número de cartão inválido." });
    }

    try {
        const token = crypto.createHash('sha256').update(number + userId + Date.now()).digest('hex');
        const lastFour = number.slice(-4);

        const countRes = await pool.query(
            "SELECT COUNT(*) FROM wallet_cards WHERE user_id = $1", 
            [userId]
        );
        
        if (parseInt(countRes.rows[0].count) >= (SYSTEM_CONFIG.WALLET_LIMITS?.MAX_CARDS || 10)) {
            return res.status(400).json({ error: "Limite máximo de cartões atingido." });
        }

        const isDefault = parseInt(countRes.rows[0].count) === 0;

        await pool.query(
            `INSERT INTO wallet_cards 
             (user_id, card_alias, last_four, provider_token, expiry_date, card_network, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, alias || `Cartão final ${lastFour}`, lastFour, token, expiry, type || 'VISA', isDefault]
        );

        res.json({ 
            success: true, 
            message: "Cartão vinculado com sucesso." 
        });

    } catch (e) {
        logError('ADD_CARD', e);
        res.status(500).json({ error: "Erro ao adicionar cartão." });
    }
};

/**
 * DELETE /api/wallet/cards/:id
 * Remove um cartão.
 */
exports.deleteCard = async (req, res) => {
    try {
        const result = await pool.query(
            "DELETE FROM wallet_cards WHERE id = $1 AND user_id = $2 RETURNING id",
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Cartão não encontrado." });
        }

        res.json({ 
            success: true, 
            message: "Cartão removido." 
        });
        
    } catch (e) {
        logError('DELETE_CARD', e);
        res.status(500).json({ error: "Erro ao remover cartão." });
    }
};

// =================================================================================================
// EXPORTS
// =================================================================================================
module.exports = exports;
