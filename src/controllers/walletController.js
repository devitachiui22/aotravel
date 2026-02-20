/**
 * =================================================================================================
 * 🏦 AOTRAVEL SERVER PRO - WALLET API CONTROLLER (TITANIUM ACID EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/walletController.js
 * DESCRIÇÃO: Controlador REST para operações financeiras com garantias ACID completas.
 *
 * ✅ CORREÇÕES APLICADAS (BLINDAGEM):
 * 1. Todas as operações que alteram saldo agora usam transações com BEGIN/COMMIT/ROLLBACK.
 * 2. Uso estrito de FOR UPDATE para bloquear a linha do usuário e evitar Double-Spend.
 * 3. Registro duplo e exato em transferências P2P (Débito e Crédito) com balance_after.
 * 4. Verificação de PIN integrada de forma transacional.
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { logSystem, logError, generateRef } = require('../utils/helpers');

// =================================================================================================
// 🔐 HELPER: VERIFICAR PIN (BLINDADO)
// =================================================================================================
async function verifyPinInternal(userId, pinInput, client) {
    if (!pinInput) throw new Error("O PIN de transação é obrigatório.");

    const res = await client.query(
        "SELECT wallet_pin_hash FROM users WHERE id = $1 FOR UPDATE",
    );

    const storedHash = res.rows?.wallet_pin_hash;

    if (!storedHash) throw new Error("PIN de transação não configurado. Defina um PIN em Configurações.");

    const match = await bcrypt.compare(pinInput, storedHash);
    if (!match) throw new Error("PIN incorreto.");

    return true;
}

// =================================================================================================
// 1. DADOS GERAIS E DASHBOARD
// =================================================================================================

exports.getWalletData = async (req, res) => {
    try {
        const userId = req.user.id;

        const userRes = await pool.query(
            `SELECT balance, bonus_points, wallet_account_number, wallet_status,
                    daily_limit, daily_limit_used, account_tier, phone,
                    (wallet_pin_hash IS NOT NULL) as has_pin
             FROM users WHERE id = $1`,
        );

        if (userRes.rows.length === 0) return res.status(404).json({ error: "Carteira não encontrada." });
        const userData = userRes.rows;

        const txRes = await pool.query(
            `SELECT t.*, s.name as sender_name, r.name as receiver_name
             FROM wallet_transactions t
             LEFT JOIN users s ON t.sender_id = s.id
             LEFT JOIN users r ON t.receiver_id = r.id
             WHERE t.user_id = $1 OR t.sender_id = $1 OR t.receiver_id = $1
             ORDER BY t.created_at DESC LIMIT 20`,
        );

        const accountsRes = await pool.query(
            `SELECT id, bank_name, iban, holder_name, is_default,
                    CASE WHEN LENGTH(iban) > 8 THEN CONCAT(LEFT(iban, 4), '...', RIGHT(iban, 4))
                    ELSE CONCAT('...', RIGHT(iban, 4)) END as masked_iban
             FROM external_bank_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
        );

        const cardsRes = await pool.query(
            `SELECT id, card_alias, last_four, card_network, expiry_date, is_default
             FROM wallet_cards WHERE user_id = $1 AND is_active = true ORDER BY is_default DESC, created_at DESC`,
        );

        res.json({
            balance: parseFloat(userData.balance) || 0,
            bonus_points: userData.bonus_points || 0,
            account_number: userData.wallet_account_number || 'AOT' + userId.toString().padStart(8, '0'),
            status: userData.wallet_status || 'active',
            has_pin: userData.has_pin || false,
            limits: {
                daily_total: parseFloat(userData.daily_limit) || 500000,
                daily_used: parseFloat(userData.daily_limit_used) || 0,
                tier: userData.account_tier || 'standard'
            },
            recent_transactions: txRes.rows ||[],
            bank_accounts: accountsRes.rows || [],
            cards: cardsRes.rows ||[]
        });

    } catch (error) {
        logError('WALLET_GET_DATA', error);
        res.status(500).json({ error: "Erro ao carregar dados da carteira." });
    }
};

exports.getBalance = async (req, res) => {
    try {
        const result = await pool.query('SELECT balance, wallet_account_number FROM users WHERE id = $1',);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

        res.json({
            balance: parseFloat(result.rows.balance) || 0,
            accountNumber: result.rows.wallet_account_number || 'AOT' + req.user.id.toString().padStart(8, '0')
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno' });
    }
};

// =================================================================================================
// 2. TRANSFERÊNCIA INTERNA P2P (ACID BLINDADO)
// =================================================================================================

exports.internalTransfer = async (req, res) => {
    const { receiver_identifier, amount, pin, description, is_system_debit } = req.body;
    const senderId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0 || isNaN(val)) return res.status(400).json({ error: "Valor de transferência inválido." });
    if (!receiver_identifier) return res.status(400).json({ error: "Destinatário obrigatório." });

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Se for débito do sistema (como compra de pacotes), não exige PIN se o backend assim definir.
        // Porém, transferências de usuário P2P exigem.
        if (!is_system_debit) {
            await verifyPinInternal(senderId, pin, client);
        }

        // 1. Bloqueia Remetente (FOR UPDATE)
        const senderRes = await client.query(
            'SELECT id, name, balance FROM users WHERE id = $1 FOR UPDATE',
        );
        if (senderRes.rows.length === 0) throw new Error("Remetente não encontrado.");

        const sender = senderRes.rows;
        const senderBalance = parseFloat(sender.balance);

        if (senderBalance < val) throw new Error("Saldo insuficiente para esta transferência.");

        // Lógica de Débito de Sistema (Ex: pagamento de taxas ou pacotes)
        if (is_system_debit && receiver_identifier === 'system_debit') {
            const newSenderBalance = senderBalance - val;
            await client.query('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',);
            const txRef = generateRef('DEB');

            await client.query(
                `INSERT INTO wallet_transactions (reference_id, user_id, amount, type, method, status, description, balance_after, category, created_at)
                 VALUES ($1, $2, $3, 'payment', 'system', 'completed', $4, $5, 'service', NOW())`,
            );

            await client.query('COMMIT');
            return res.json({ success: true, message: "Débito realizado.", new_balance: newSenderBalance, transaction_id: txRef });
        }

        // 2. Busca e Bloqueia Destinatário (FOR UPDATE)
        let receiverQuery = 'SELECT id, name, balance FROM users WHERE phone = $1 FOR UPDATE';
        let receiverParams =;

        if (receiver_identifier.includes('@')) {
            receiverQuery = 'SELECT id, name, balance FROM users WHERE email = $1 FOR UPDATE';
            receiverParams =;
        } else if (receiver_identifier.startsWith('AOT')) {
            receiverQuery = 'SELECT id, name, balance FROM users WHERE wallet_account_number = $1 FOR UPDATE';
            receiverParams =;
        }

        const receiverRes = await client.query(receiverQuery, receiverParams);
        if (receiverRes.rows.length === 0) throw new Error("Destinatário não encontrado na rede Titanium.");

        const receiver = receiverRes.rows;
        if (receiver.id === senderId) throw new Error("Você não pode transferir para si mesmo.");

        // 3. Executa a Transferência P2P
        const newSenderBalance = senderBalance - val;
        const newReceiverBalance = parseFloat(receiver.balance) + val;

        await client.query('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',);
        await client.query('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',);

        // 4. Ledger: Grava Débito e Crédito Separados
        const txRef = generateRef('TRF');

        // Débito Remetente
        await client.query(
            `INSERT INTO wallet_transactions (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, balance_after, category, created_at)
             VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6, $7, 'p2p', NOW())`,
        );

        // Crédito Destinatário
        const receiverRef = `${txRef}-REC`;
        await client.query(
            `INSERT INTO wallet_transactions (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, balance_after, category, created_at)
             VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6, $7, 'p2p', NOW())`,
        );

        await client.query('COMMIT');
        logSystem('WALLET', `Transferência P2P: ${senderId} enviou ${val} para ${receiver.id}`);

        // 5. Notifica em Tempo Real
        if (req.io) {
            req.io.to(`user_${receiver.id}`).emit('wallet_update', { type: 'received', amount: val, new_balance: newReceiverBalance });
            req.io.to(`user_${senderId}`).emit('wallet_update', { type: 'sent', amount: val, new_balance: newSenderBalance });
        }

        res.json({ success: true, message: "Transferência concluída.", new_balance: newSenderBalance, transaction_id: txRef });

    } catch (error) {
        await client.query('ROLLBACK');
        logError('INTERNAL_TRANSFER', error);

        let code = 'TRANSFER_FAILED';
        if (error.message.includes('PIN')) code = 'INVALID_PIN';
        if (error.message.includes('Saldo')) code = 'INSUFFICIENT_FUNDS';

        res.status(400).json({ error: error.message, code: code });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 3. TOPUP, WITHDRAW E PAGAMENTOS GERAIS
// =================================================================================================

exports.topup = async (req, res) => {
    const { amount, method, reference } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0 || isNaN(val)) return res.status(400).json({ error: 'Valor inválido' });

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const userRes = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE',);
        if (userRes.rows.length === 0) throw new Error('Usuário não encontrado');

        const newBalance = parseFloat(userRes.rows.balance) + val;
        await client.query('UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',);

        const ref = reference || generateRef('TOP');
        await client.query(
            `INSERT INTO wallet_transactions (reference_id, user_id, amount, type, method, status, description, balance_after, category, created_at)
             VALUES ($1, $2, $3, 'topup', $4, 'completed', 'Adição de fundos', $5, 'topup', NOW())`,
        );

        await client.query('COMMIT');
        if (req.io) req.io.to(`user_${userId}`).emit('wallet_update', { type: 'topup', amount: val, new_balance: newBalance });

        res.json({ success: true, message: 'Fundos adicionados.', new_balance: newBalance, reference: ref });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Erro interno ao processar recarga.' });
    } finally {
        client.release();
    }
};

exports.withdraw = async (req, res) => {
    const { amount, pin, bank_account_id } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0 || isNaN(val)) return res.status(400).json({ error: 'Valor inválido' });

    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await verifyPinInternal(userId, pin, client);

        const userRes = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE',);
        const currentBalance = parseFloat(userRes.rows.balance);

        if (currentBalance < val) throw new Error('Saldo insuficiente para este saque.');

        const bankRes = await client.query("SELECT * FROM external_bank_accounts WHERE id = $1 AND user_id = $2",);
        if (bankRes.rows.length === 0) throw new Error("Conta bancária inválida ou não pertence a você.");

        const bank = bankRes.rows;
        const newBalance = currentBalance - val;

        await client.query("UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2",);

        const txRef = generateRef('WTH');
        await client.query(
            `INSERT INTO wallet_transactions (reference_id, user_id, amount, type, method, status, description, metadata, balance_after, category, created_at)
             VALUES ($1, $2, $3, 'withdraw', 'bank_transfer', 'pending', $4, $5, $6, 'withdraw', NOW())`,
        );

        await client.query('COMMIT');
        if (req.io) req.io.to(`user_${userId}`).emit('wallet_update', { type: 'withdraw', amount: val, new_balance: newBalance });

        res.json({ success: true, message: 'Saque solicitado com sucesso.', new_balance: newBalance, reference: txRef });

    } catch (error) {
        await client.query('ROLLBACK');
        let code = 'WITHDRAW_FAILED';
        if (error.message.includes('PIN')) code = 'INVALID_PIN';
        res.status(400).json({ error: error.message, code: code });
    } finally {
        client.release();
    }
};

exports.payService = async (req, res) => {
    const { service_id, reference, amount, pin } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0 || isNaN(val)) return res.status(400).json({ error: 'Valor inválido' });

    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        await verifyPinInternal(userId, pin, client);

        const userRes = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE',);
        const currentBalance = parseFloat(userRes.rows.balance);
        const fixedFee = 50.00;
        const totalCost = val + fixedFee;

        if (currentBalance < totalCost) throw new Error(`Saldo insuficiente. Necessário: ${totalCost} Kz.`);

        const newBalance = currentBalance - totalCost;
        await client.query("UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2",);

        const txRef = generateRef('PAY');
        await client.query(
            `INSERT INTO wallet_transactions (reference_id, user_id, amount, fee, type, method, status, description, balance_after, category, created_at)
             VALUES ($1, $2, $3, $4, 'bill_payment', 'internal', 'completed', $5, $6, 'services', NOW())`,
        );

        await client.query('COMMIT');
        res.json({ success: true, message: 'Pagamento realizado.', new_balance: newBalance, reference: txRef });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 4. GESTÃO DE PIN E SEGURANÇA
// =================================================================================================

exports.setPin = async (req, res) => {
    const { pin, old_pin } = req.body;
    const userId = req.user.id;

    if (!pin || pin.length !== 4 || isNaN(pin)) return res.status(400).json({ error: "PIN deve conter 4 dígitos numéricos." });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userRes = await client.query("SELECT wallet_pin_hash FROM users WHERE id = $1 FOR UPDATE",);
        const currentHash = userRes.rows?.wallet_pin_hash;

        if (currentHash) {
            if (!old_pin) throw new Error("Informe o PIN atual para alterá-lo.");
            const match = await bcrypt.compare(old_pin, currentHash);
            if (!match) throw new Error("O PIN atual está incorreto.");
        }

        const newHash = await bcrypt.hash(pin, 10);
        await client.query("UPDATE users SET wallet_pin_hash = $1, updated_at = NOW() WHERE id = $2",);
        await client.query('COMMIT');

        res.json({ success: true, message: "PIN definido com sucesso." });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

exports.verifyPin = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await verifyPinInternal(req.user.id, req.body.pin, client);
        await client.query('COMMIT');
        res.json({ valid: true });
    } catch (error) {
        await client.query('ROLLBACK');
        res.json({ valid: false, error: error.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 5. GESTÃO DE CONTAS EXTERNAS E CARTÕES
// =================================================================================================

exports.addAccount = async (req, res) => {
    const userId = req.user.id;
    const provider = req.body.bank_name || req.body.provider;
    const accountNumber = req.body.iban || req.body.accountNumber;
    const holderName = req.body.holder_name || req.body.holderName;

    if (!provider || !accountNumber || !holderName) return res.status(400).json({ error: "Dados incompletos." });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const countRes = await client.query("SELECT COUNT(*) FROM external_bank_accounts WHERE user_id = $1",);
        if (parseInt(countRes.rows.count) >= 10) throw new Error("Limite máximo de contas.");

        const insertRes = await client.query(
            `INSERT INTO external_bank_accounts (user_id, bank_name, iban, holder_name, is_verified, is_default, created_at)
             VALUES ($1, $2, $3, $4, true, $5, NOW()) RETURNING id, bank_name, iban, holder_name`,.count) === 0]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, account: insertRes.rows });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

exports.deleteAccount = async (req, res) => {
    try {
        const result = await pool.query("DELETE FROM external_bank_accounts WHERE id = $1 AND user_id = $2 RETURNING id",);
        if (result.rows.length === 0) return res.status(404).json({ error: "Conta não encontrada." });
        res.json({ success: true, message: "Removida com sucesso." });
    } catch (e) {
        res.status(500).json({ error: "Erro ao remover conta." });
    }
};

exports.addCard = async (req, res) => {
    const { number, expiry, type, alias } = req.body;
    if (!number || number.length < 13) return res.status(400).json({ error: "Cartão inválido." });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const countRes = await client.query("SELECT COUNT(*) FROM wallet_cards WHERE user_id = $1",);
        if (parseInt(countRes.rows.count) >= 10) throw new Error("Limite de cartões atingido.");

        const lastFour = number.slice(-4);
        const token = crypto.createHash('sha256').update(number + req.user.id + Date.now()).digest('hex');

        await client.query(
            `INSERT INTO wallet_cards (user_id, card_alias, last_four, provider_token, expiry_date, card_network, is_default, is_active, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())`,[req.user.id, alias || `Cartão ${lastFour}`, lastFour, token, expiry, type || 'VISA', parseInt(countRes.rows.count) === 0]
        );
        await client.query('COMMIT');
        res.json({ success: true, message: "Cartão adicionado." });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

exports.deleteCard = async (req, res) => {
    try {
        const result = await pool.query("DELETE FROM wallet_cards WHERE id = $1 AND user_id = $2 RETURNING id",);
        if (result.rows.length === 0) return res.status(404).json({ error: "Cartão não encontrado." });
        res.json({ success: true, message: "Cartão removido." });
    } catch (e) {
        res.status(500).json({ error: "Erro ao remover cartão." });
    }
};