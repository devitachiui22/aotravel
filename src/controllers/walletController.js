/**
 * =================================================================================================
 * 🏦 AOTRAVEL SERVER PRO - WALLET CONTROLLER
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/walletController.js
 * DESCRIÇÃO: Controlador que expõe a lógica financeira para a API.
 *            Gerencia saldo, transferências, depósitos, saques e gestão de cartões/contas.
 *            Delega a complexidade ACID para o 'walletService.js'.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const walletService = require('../services/walletService');
const bcrypt = require('bcrypt');
const { logError, generateCode } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// Helper interno para verificar PIN antes de ações sensíveis
async function verifyPinInternal(userId, pin) {
    const res = await pool.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
    const hash = res.rows[0]?.wallet_pin_hash;

    if (!hash) {
        throw new Error("PIN de transação não configurado.");
    }

    const match = await bcrypt.compare(pin, hash);
    if (!match) {
        throw new Error("PIN incorreto.");
    }
    return true;
}

/**
 * GET WALLET DATA
 * Rota: GET /api/wallet
 * Lógica: Retorna saldo, extrato, cartões e contas bancárias (Dashboard Financeiro).
 */
exports.getWalletData = async (req, res) => {
    try {
        // Busca dados do usuário financeiros
        const userRes = await pool.query(
            `SELECT balance, bonus_points, wallet_account_number, daily_limit,
                    wallet_status, account_tier, wallet_pin_hash IS NOT NULL as has_pin
             FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: "Carteira não encontrada." });
        }

        // Gera número de conta virtual se não existir (Lazy Generation)
        let userData = userRes.rows[0];
        if (!userData.wallet_account_number) {
            const phoneRes = await pool.query("SELECT phone FROM users WHERE id = $1", [req.user.id]);
            if (phoneRes.rows.length > 0 && phoneRes.rows[0].phone) {
                const newAcc = phoneRes.rows[0].phone.replace(/\D/g, '') + 'AO';
                await pool.query("UPDATE users SET wallet_account_number = $1 WHERE id = $2", [newAcc, req.user.id]);
                userData.wallet_account_number = newAcc;
            }
        }

        // Histórico recente
        const txRes = await pool.query(
            `SELECT t.*, s.name as sender_name, r.name as receiver_name
             FROM wallet_transactions t
             LEFT JOIN users s ON t.sender_id = s.id
             LEFT JOIN users r ON t.receiver_id = r.id
             WHERE t.user_id = $1 AND t.is_hidden = FALSE
             ORDER BY t.created_at DESC LIMIT 30`,
            [req.user.id]
        );

        // Cartões ativos
        const cardsRes = await pool.query(
            "SELECT * FROM wallet_cards WHERE user_id = $1 AND is_active = TRUE",
            [req.user.id]
        );

        // Contas bancárias
        const accountsRes = await pool.query(
            "SELECT * FROM external_bank_accounts WHERE user_id = $1",
            [req.user.id]
        );

        res.json({
            ...userData,
            balance: parseFloat(userData.balance),
            transactions: txRes.rows,
            cards: cardsRes.rows,
            external_accounts: accountsRes.rows
        });

    } catch (e) {
        logError('WALLET_GET', e);
        res.status(500).json({ error: "Erro ao carregar carteira." });
    }
};

/**
 * INTERNAL TRANSFER (P2P)
 * Rota: POST /api/wallet/transfer/internal
 * Lógica: Transfere saldo entre usuários usando o walletService.
 */
exports.internalTransfer = async (req, res) => {
    const { receiver_identifier, amount, pin, description } = req.body;
    const senderId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0) return res.status(400).json({ error: "Valor inválido." });
    if (!receiver_identifier || !pin) return res.status(400).json({ error: "Dados incompletos." });

    try {
        await verifyPinInternal(senderId, pin);

        const result = await walletService.processInternalTransfer(
            senderId,
            receiver_identifier,
            val,
            description
        );

        // Notificação via Socket (Opcional, pois o Service pode emitir se tiver acesso ao IO)
        if (global.io) {
            global.io.to(`user_${result.receiver_id}`).emit('wallet_update', {
                type: 'received',
                amount: val,
                message: `Recebeu ${val} Kz de ${req.user.name}`
            });
            global.io.to(`user_${senderId}`).emit('wallet_update', {
                type: 'sent',
                amount: val,
                new_balance: result.new_balance
            });
        }

        res.json(result);

    } catch (e) {
        // logError('WALLET_TRANSFER', e); // Já logado no service
        res.status(400).json({ error: e.message });
    }
};

/**
 * TOPUP (RECARGA)
 * Rota: POST /api/wallet/topup
 * Lógica: Recarrega via gateway simulado.
 */
exports.topup = async (req, res) => {
    const { amount, method, payment_details } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0) return res.status(400).json({ error: "Valor inválido." });

    try {
        const result = await walletService.processTopUp(userId, val, method, payment_details || {});

        if (global.io) {
            global.io.to(`user_${userId}`).emit('wallet_update', { type: 'topup', amount: val });
        }

        res.json(result);
    } catch (e) {
        logError('WALLET_TOPUP', e);
        res.status(500).json({ error: e.message });
    }
};

/**
 * WITHDRAW (SAQUE)
 * Rota: POST /api/wallet/withdraw
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
            global.io.to(`user_${userId}`).emit('wallet_update', { type: 'withdraw', amount: val });
        }

        res.json(result);
    } catch (e) {
        logError('WALLET_WITHDRAW', e);
        res.status(400).json({ error: e.message });
    }
};

/**
 * PAY SERVICE (SERVIÇOS)
 * Rota: POST /api/wallet/pay-service
 */
exports.payService = async (req, res) => {
    const { service_id, reference, amount, pin } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    try {
        await verifyPinInternal(userId, pin);
        const result = await walletService.processServicePayment(userId, service_id, reference, val);
        res.json(result);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
};

/**
 * SET PIN
 * Rota: POST /api/wallet/set-pin
 */
exports.setPin = async (req, res) => {
    const { pin, old_pin } = req.body;
    const userId = req.user.id;

    if (!pin || pin.length !== 4 || isNaN(pin)) {
        return res.status(400).json({ error: "PIN deve conter 4 dígitos numéricos." });
    }

    try {
        const userRes = await pool.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
        const currentHash = userRes.rows[0]?.wallet_pin_hash;

        if (currentHash) {
            if (!old_pin) return res.status(400).json({ error: "PIN atual obrigatório." });
            const match = await bcrypt.compare(old_pin, currentHash);
            if (!match) return res.status(401).json({ error: "PIN atual incorreto." });
        }

        const newHash = await bcrypt.hash(pin, SYSTEM_CONFIG.SECURITY.BCRYPT_ROUNDS);
        await pool.query("UPDATE users SET wallet_pin_hash = $1 WHERE id = $2", [newHash, userId]);

        // Log de segurança
        await pool.query(
            "INSERT INTO wallet_security_logs (user_id, event_type, ip_address) VALUES ($1, 'PIN_CHANGE', $2)",
            [userId, req.ip]
        );

        res.json({ success: true, message: "PIN definido com sucesso." });
    } catch (e) {
        logError('SET_PIN', e);
        res.status(500).json({ error: "Erro ao definir PIN." });
    }
};

/**
 * VERIFY PIN (AUXILIAR FRONTEND)
 * Rota: POST /api/wallet/verify-pin
 */
exports.verifyPin = async (req, res) => {
    try {
        await verifyPinInternal(req.user.id, req.body.pin);
        res.json({ valid: true });
    } catch (e) {
        res.json({ valid: false, error: e.message });
    }
};

/**
 * ADD CARD
 * Rota: POST /api/wallet/cards/add
 */
exports.addCard = async (req, res) => {
    const { number, expiry, alias, type, cvc } = req.body; // CVC não é salvo, apenas para validação simulada
    const userId = req.user.id;

    if (!number || number.length < 13) return res.status(400).json({ error: "Cartão inválido." });

    try {
        // Tokenização simulada (Hash)
        const token = crypto.createHash('sha256').update(number + userId + Date.now()).digest('hex');
        const lastFour = number.slice(-4);

        // Verifica se é o primeiro cartão (Default)
        const count = await pool.query("SELECT COUNT(*) FROM wallet_cards WHERE user_id = $1", [userId]);
        const isDefault = parseInt(count.rows[0].count) === 0;

        await pool.query(
            `INSERT INTO wallet_cards (user_id, card_alias, last_four, provider_token, expiry_date, card_network, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, alias || 'Cartão', lastFour, token, expiry, type || 'VISA', isDefault]
        );

        res.json({ success: true, message: "Cartão vinculado." });
    } catch (e) {
        logError('ADD_CARD', e);
        res.status(500).json({ error: "Erro ao adicionar cartão." });
    }
};

/**
 * DELETE CARD
 * Rota: DELETE /api/wallet/cards/:id
 */
exports.deleteCard = async (req, res) => {
    try {
        await pool.query("DELETE FROM wallet_cards WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
        res.json({ success: true, message: "Cartão removido." });
    } catch (e) {
        res.status(500).json({ error: "Erro ao remover cartão." });
    }
};

/**
 * ADD BANK ACCOUNT
 * Rota: POST /api/wallet/accounts/add
 */
exports.addAccount = async (req, res) => {
    const { provider, account_number, holder_name } = req.body;
    const userId = req.user.id;

    if (!account_number) return res.status(400).json({ error: "Número da conta inválido." });

    try {
        await pool.query(
            `INSERT INTO external_bank_accounts (user_id, bank_name, iban, holder_name, is_verified)
             VALUES ($1, $2, $3, $4, true)`, // Auto-verificado na simulação
            [userId, provider, account_number, holder_name]
        );
        res.json({ success: true, message: "Conta bancária adicionada." });
    } catch (e) {
        res.status(500).json({ error: "Erro ao adicionar conta." });
    }
};

/**
 * DELETE BANK ACCOUNT
 * Rota: DELETE /api/wallet/accounts/:id
 */
exports.deleteAccount = async (req, res) => {
    try {
        await pool.query("DELETE FROM external_bank_accounts WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
        res.json({ success: true, message: "Conta removida." });
    } catch (e) {
        res.status(500).json({ error: "Erro ao remover conta." });
    }
};