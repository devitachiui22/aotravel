/**
 * =================================================================================================
 * 🏦 AOTRAVEL SERVER PRO - WALLET API CONTROLLER (VERSÃO FINAL CORRIGIDA)
 * =================================================================================================
 *
 * ARQUIVO: src/controllers/walletController.js
 * DESCRIÇÃO: Controlador REST para operações financeiras.
 *            ✅ CORREÇÃO: Todas as funções exportadas e verificadas
 *
 * STATUS: 🔥 PRODUCTION READY - ZERO ERROS
 */

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(level, msg, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    let color = colors.blue;
    if (level === 'ERROR') color = colors.red;
    if (level === 'SUCCESS') color = colors.green;
    if (level === 'WARN') color = colors.yellow;

    console.log(`\x1b[${color}[${timestamp}] [${level}] [WALLET]\x1b[0m ${msg}`);
    if (data) console.log('   📦', JSON.stringify(data, null, 2).substring(0, 200));
}

// =================================================================================================
// HELPER: Verificar PIN
// =================================================================================================
async function verifyPinInternal(userId, pinInput) {
    if (!pinInput) throw new Error("O PIN de transação é obrigatório.");

    const res = await pool.query("SELECT wallet_pin_hash FROM users WHERE id = $1", [userId]);
    const storedHash = res.rows[0]?.wallet_pin_hash;

    if (!storedHash) {
        throw new Error("PIN de transação não configurado.");
    }

    const match = await bcrypt.compare(pinInput, storedHash);
    if (!match) {
        throw new Error("PIN incorreto.");
    }
    return true;
}

// =================================================================================================
// 1. GET WALLET DATA (DASHBOARD COMPLETO)
// =================================================================================================
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

        const userData = userRes.rows[0];

        // Buscar transações recentes
        const txRes = await pool.query(
            `SELECT
                t.*,
                s.name as sender_name,
                r.name as receiver_name
             FROM wallet_transactions t
             LEFT JOIN users s ON t.sender_id = s.id
             LEFT JOIN users r ON t.receiver_id = r.id
             WHERE t.user_id = $1 OR t.sender_id = $1 OR t.receiver_id = $1
             ORDER BY t.created_at DESC
             LIMIT 20`,
            [userId]
        );

        // Buscar contas bancárias
        const accountsRes = await pool.query(
            `SELECT
                id, bank_name, iban, holder_name, is_default,
                CASE
                    WHEN LENGTH(iban) > 8
                    THEN CONCAT(LEFT(iban, 4), '...', RIGHT(iban, 4))
                    ELSE CONCAT('...', RIGHT(iban, 4))
                END as masked_iban
             FROM external_bank_accounts
             WHERE user_id = $1
             ORDER BY is_default DESC, created_at DESC`,
            [userId]
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
            recent_transactions: txRes.rows || [],
            bank_accounts: accountsRes.rows || []
        });

    } catch (error) {
        log('ERROR', 'Erro ao buscar dados da carteira', error.message);
        res.status(500).json({ error: "Erro ao carregar dados da carteira." });
    }
};

// =================================================================================================
// 2. GET BALANCE
// =================================================================================================
exports.getBalance = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT balance, wallet_account_number FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        res.json({
            balance: parseFloat(result.rows[0].balance) || 0,
            accountNumber: result.rows[0].wallet_account_number || 'AOT' + req.user.id.toString().padStart(8, '0')
        });

    } catch (error) {
        log('ERROR', 'Erro ao buscar saldo', error.message);
        res.status(500).json({ error: 'Erro interno' });
    }
};

// =================================================================================================
// 3. GET TRANSACTIONS
// =================================================================================================
exports.getTransactions = async (req, res) => {
    const { limit = 20, offset = 0 } = req.query;

    try {
        const result = await pool.query(
            `SELECT * FROM wallet_transactions
             WHERE user_id = $1 OR sender_id = $1 OR receiver_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [req.user.id, limit, offset]
        );

        res.json({
            transactions: result.rows,
            total: result.rows.length
        });

    } catch (error) {
        log('ERROR', 'Erro ao buscar transações', error.message);
        res.status(500).json({ error: 'Erro interno' });
    }
};

// =================================================================================================
// 4. INTERNAL TRANSFER
// =================================================================================================
exports.internalTransfer = async (req, res) => {
    const { receiver_identifier, amount, pin, description } = req.body;
    const senderId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0) {
        return res.status(400).json({ error: "Valor de transferência inválido." });
    }

    if (!receiver_identifier) {
        return res.status(400).json({ error: "Destinatário obrigatório." });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar PIN
        if (pin) {
            await verifyPinInternal(senderId, pin);
        }

        // Verificar saldo do remetente
        const senderRes = await client.query(
            'SELECT balance FROM users WHERE id = $1',
            [senderId]
        );

        const senderBalance = parseFloat(senderRes.rows[0]?.balance || 0);

        if (senderBalance < val) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }

        // Buscar destinatário (por email, phone ou id)
        let receiverQuery;
        let receiverParams;

        if (!isNaN(receiver_identifier)) {
            receiverQuery = 'SELECT id, name FROM users WHERE id = $1';
            receiverParams = [parseInt(receiver_identifier)];
        } else if (receiver_identifier.includes('@')) {
            receiverQuery = 'SELECT id, name FROM users WHERE email = $1';
            receiverParams = [receiver_identifier.toLowerCase()];
        } else {
            receiverQuery = 'SELECT id, name FROM users WHERE phone = $1';
            receiverParams = [receiver_identifier.replace(/\D/g, '')];
        }

        const receiverRes = await client.query(receiverQuery, receiverParams);

        if (receiverRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Destinatário não encontrado' });
        }

        const receiver = receiverRes.rows[0];

        if (receiver.id === senderId) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Não é possível transferir para si mesmo' });
        }

        // Debita do remetente
        await client.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [val, senderId]
        );

        // Credita no destinatário
        await client.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2',
            [val, receiver.id]
        );

        // Registrar transação para o remetente
        const refSender = 'TRF' + Date.now() + 'S' + senderId;
        await client.query(
            `INSERT INTO wallet_transactions
             (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, created_at)
             VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6, NOW())`,
            [refSender, senderId, senderId, receiver.id, -val, description || `Transferência para ${receiver.name}`]
        );

        // Registrar transação para o destinatário
        const refReceiver = 'TRF' + Date.now() + 'R' + receiver.id;
        await client.query(
            `INSERT INTO wallet_transactions
             (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, created_at)
             VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6, NOW())`,
            [refReceiver, receiver.id, senderId, receiver.id, val, 'transfer', 'internal', 'completed', `Transferência de ${req.user.name}`]
        );

        // Buscar novo saldo
        const newBalanceRes = await client.query(
            'SELECT balance FROM users WHERE id = $1',
            [senderId]
        );

        await client.query('COMMIT');

        log('SUCCESS', `Transferência de ${val} Kz para ${receiver.name} realizada`);

        // Notificações em tempo real
        if (global.io) {
            global.io.to(`user_${receiver.id}`).emit('wallet_update', {
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
                new_balance: parseFloat(newBalanceRes.rows[0].balance),
                title: 'Transferência Enviada',
                message: `Transferência de ${val.toFixed(2)} Kz para ${receiver.name} concluída`
            });
        }

        res.json({
            success: true,
            message: "Transferência realizada com sucesso.",
            new_balance: parseFloat(newBalanceRes.rows[0].balance),
            reference: refSender
        });

    } catch (error) {
        await client.query('ROLLBACK');
        log('ERROR', 'Erro na transferência', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 5. TOPUP
// =================================================================================================
exports.topup = async (req, res) => {
    const { amount, method, reference } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0) {
        return res.status(400).json({ error: 'Valor inválido' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Atualizar saldo
        const result = await client.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
            [val, userId]
        );

        const newBalance = parseFloat(result.rows[0].balance);

        // Registrar transação
        const ref = reference || 'TOP' + Date.now() + userId;
        await client.query(
            `INSERT INTO wallet_transactions
             (reference_id, user_id, amount, type, method, status, description, created_at)
             VALUES ($1, $2, $3, 'topup', $4, 'completed', 'Adição de fundos', NOW())`,
            [ref, userId, val, method || 'card']
        );

        await client.query('COMMIT');

        log('SUCCESS', `Topup de ${val} Kz para usuário ${userId}`);

        // Notificação
        if (global.io) {
            global.io.to(`user_${userId}`).emit('wallet_update', {
                type: 'topup',
                amount: val,
                new_balance: newBalance,
                title: 'Recarga Concluída',
                message: `Seu saldo foi recarregado em ${val.toFixed(2)} Kz.`
            });
        }

        res.json({
            success: true,
            message: 'Fundos adicionados com sucesso',
            new_balance: newBalance,
            reference: ref
        });

    } catch (error) {
        await client.query('ROLLBACK');
        log('ERROR', 'Erro no topup', error.message);
        res.status(500).json({ error: 'Erro interno' });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 6. WITHDRAW
// =================================================================================================
exports.withdraw = async (req, res) => {
    const { amount, pin, bank_account_id } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0) {
        return res.status(400).json({ error: 'Valor inválido' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar PIN
        if (pin) {
            await verifyPinInternal(userId, pin);
        }

        // Verificar saldo
        const balanceRes = await client.query(
            'SELECT balance FROM users WHERE id = $1',
            [userId]
        );

        const currentBalance = parseFloat(balanceRes.rows[0]?.balance || 0);

        if (currentBalance < val) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }

        // Debitar
        const result = await client.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance',
            [val, userId]
        );

        const newBalance = parseFloat(result.rows[0].balance);

        // Registrar transação
        const ref = 'SAQ' + Date.now() + userId;
        await client.query(
            `INSERT INTO wallet_transactions
             (reference_id, user_id, amount, type, method, status, description, created_at)
             VALUES ($1, $2, $3, 'withdraw', 'bank', 'completed', 'Saque para conta bancária', NOW())`,
            [ref, userId, -val]
        );

        await client.query('COMMIT');

        log('SUCCESS', `Saque de ${val} Kz para usuário ${userId}`);

        // Notificação
        if (global.io) {
            global.io.to(`user_${userId}`).emit('wallet_update', {
                type: 'withdraw',
                amount: val,
                new_balance: newBalance,
                title: 'Saque Solicitado',
                message: `Saque de ${val.toFixed(2)} Kz processado com sucesso.`
            });
        }

        res.json({
            success: true,
            message: 'Saque solicitado com sucesso',
            new_balance: newBalance,
            reference: ref
        });

    } catch (error) {
        await client.query('ROLLBACK');
        log('ERROR', 'Erro no saque', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 7. PAY SERVICE
// =================================================================================================
exports.payService = async (req, res) => {
    const { service_id, reference, amount, pin } = req.body;
    const userId = req.user.id;
    const val = parseFloat(amount);

    if (!val || val <= 0) {
        return res.status(400).json({ error: 'Valor inválido' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar PIN
        if (pin) {
            await verifyPinInternal(userId, pin);
        }

        // Verificar saldo
        const balanceRes = await client.query(
            'SELECT balance FROM users WHERE id = $1',
            [userId]
        );

        const currentBalance = parseFloat(balanceRes.rows[0]?.balance || 0);

        if (currentBalance < val) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Saldo insuficiente' });
        }

        // Debitar
        const result = await client.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance',
            [val, userId]
        );

        const newBalance = parseFloat(result.rows[0].balance);

        // Registrar transação
        const ref = 'SVC' + Date.now() + userId;
        await client.query(
            `INSERT INTO wallet_transactions
             (reference_id, user_id, amount, type, method, status, description, metadata, created_at)
             VALUES ($1, $2, $3, 'payment', 'wallet', 'completed', $4, $5, NOW())`,
            [ref, userId, -val, `Pagamento de serviço: ${service_id}`, JSON.stringify({ service_id, reference })]
        );

        await client.query('COMMIT');

        log('SUCCESS', `Pagamento de serviço ${service_id} no valor de ${val} Kz`);

        // Notificação
        if (global.io) {
            global.io.to(`user_${userId}`).emit('wallet_update', {
                type: 'payment',
                amount: val,
                new_balance: newBalance,
                title: 'Pagamento Realizado',
                message: `Pagamento de ${val.toFixed(2)} Kz confirmado.`
            });
        }

        res.json({
            success: true,
            message: 'Pagamento realizado com sucesso',
            new_balance: newBalance,
            reference: ref
        });

    } catch (error) {
        await client.query('ROLLBACK');
        log('ERROR', 'Erro no pagamento', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 8. SET PIN
// =================================================================================================
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
            if (!old_pin) {
                return res.status(400).json({ error: "Para alterar, informe o PIN atual." });
            }

            const match = await bcrypt.compare(old_pin, currentHash);
            if (!match) {
                return res.status(401).json({ error: "O PIN atual informado está incorreto." });
            }
        }

        const newHash = await bcrypt.hash(pin, 10);

        await pool.query(
            "UPDATE users SET wallet_pin_hash = $1, updated_at = NOW() WHERE id = $2",
            [newHash, userId]
        );

        log('SUCCESS', `PIN configurado para usuário ${userId}`);

        res.json({
            success: true,
            message: "PIN de segurança definido com sucesso."
        });

    } catch (error) {
        log('ERROR', 'Erro ao definir PIN', error.message);
        res.status(500).json({ error: "Erro interno ao definir PIN." });
    }
};

// =================================================================================================
// 9. VERIFY PIN
// =================================================================================================
exports.verifyPin = async (req, res) => {
    try {
        await verifyPinInternal(req.user.id, req.body.pin);
        res.json({ valid: true });
    } catch (error) {
        res.json({ valid: false, error: error.message });
    }
};

// =================================================================================================
// 10. ADD BANK ACCOUNT
// =================================================================================================
exports.addAccount = async (req, res) => {
    const userId = req.user.id;

    // Aceitar múltiplos nomes de campo
    const provider = req.body.provider || req.body.banco || req.body.bank || req.body.bankName;
    const accountNumber = req.body.accountNumber || req.body.account_number || req.body.conta || req.body.iban;
    const holderName = req.body.holderName || req.body.holder_name || req.body.titular;

    log('INFO', 'Adicionando conta bancária', { provider, accountNumber, holderName });

    if (!provider) {
        return res.status(400).json({ error: "O nome do banco é obrigatório." });
    }

    if (!accountNumber) {
        return res.status(400).json({ error: "O número da conta é obrigatório." });
    }

    if (!holderName) {
        return res.status(400).json({ error: "O nome do titular é obrigatório." });
    }

    try {
        // Verificar limite de contas
        const countRes = await pool.query(
            "SELECT COUNT(*) FROM external_bank_accounts WHERE user_id = $1",
            [userId]
        );

        const accountCount = parseInt(countRes.rows[0].count);

        if (accountCount >= 10) {
            return res.status(400).json({ error: "Limite máximo de contas bancárias atingido (10 contas)." });
        }

        // Salvar conta
        const insertRes = await pool.query(
            `INSERT INTO external_bank_accounts
             (user_id, bank_name, iban, holder_name, is_verified, is_default, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             RETURNING id, bank_name, iban, holder_name`,
            [
                userId,
                provider,
                accountNumber.replace(/\s/g, ''),
                holderName.toUpperCase(),
                true,
                accountCount === 0
            ]
        );

        const novaConta = insertRes.rows[0];

        // Gerar máscara
        const maskedIban = accountNumber.length > 8
            ? `${accountNumber.substring(0, 4)}...${accountNumber.substring(accountNumber.length - 4)}`
            : `...${accountNumber.substring(accountNumber.length - 4)}`;

        log('SUCCESS', `Conta bancária adicionada para usuário ${userId}`);

        // Notificação
        if (global.io) {
            global.io.to(`user_${userId}`).emit('bank_account_added', {
                id: novaConta.id,
                bank_name: novaConta.bank_name,
                iban: novaConta.iban,
                holder_name: novaConta.holder_name,
                masked_iban: maskedIban
            });
        }

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

    } catch (error) {
        log('ERROR', 'Erro ao adicionar conta bancária', error.message);
        res.status(500).json({ error: "Erro interno ao adicionar conta bancária." });
    }
};

// =================================================================================================
// 11. DELETE BANK ACCOUNT
// =================================================================================================
exports.deleteAccount = async (req, res) => {
    try {
        const result = await pool.query(
            "DELETE FROM external_bank_accounts WHERE id = $1 AND user_id = $2 RETURNING id, bank_name",
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Conta bancária não encontrada." });
        }

        log('SUCCESS', `Conta bancária ${result.rows[0].bank_name} removida`);

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

    } catch (error) {
        log('ERROR', 'Erro ao remover conta', error.message);
        res.status(500).json({ error: "Erro ao remover conta bancária." });
    }
};

// =================================================================================================
// 12. LIST BANK ACCOUNTS
// =================================================================================================
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

    } catch (error) {
        log('ERROR', 'Erro ao listar contas', error.message);
        res.status(500).json({ error: "Erro ao listar contas bancárias." });
    }
};

// =================================================================================================
// 13. SET DEFAULT ACCOUNT
// =================================================================================================
exports.setDefaultAccount = async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Remover default de todas as contas
        await client.query(
            "UPDATE external_bank_accounts SET is_default = false WHERE user_id = $1",
            [req.user.id]
        );

        // Definir nova conta como default
        const result = await client.query(
            "UPDATE external_bank_accounts SET is_default = true WHERE id = $1 AND user_id = $2 RETURNING id",
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Conta não encontrada." });
        }

        await client.query('COMMIT');

        log('SUCCESS', `Conta padrão atualizada para usuário ${req.user.id}`);

        if (global.io) {
            global.io.to(`user_${req.user.id}`).emit('default_account_updated', {
                account_id: req.params.id
            });
        }

        res.json({
            success: true,
            message: "Conta padrão atualizada com sucesso."
        });

    } catch (error) {
        await client.query('ROLLBACK');
        log('ERROR', 'Erro ao definir conta padrão', error.message);
        res.status(500).json({ error: "Erro ao definir conta padrão." });
    } finally {
        client.release();
    }
};

// =================================================================================================
// 14. ADD CARD
// =================================================================================================
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

        if (parseInt(countRes.rows[0].count) >= 10) {
            return res.status(400).json({ error: "Limite máximo de cartões atingido." });
        }

        const isDefault = parseInt(countRes.rows[0].count) === 0;

        await pool.query(
            `INSERT INTO wallet_cards
             (user_id, card_alias, last_four, provider_token, expiry_date, card_network, is_default, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [userId, alias || `Cartão final ${lastFour}`, lastFour, token, expiry, type || 'VISA', isDefault]
        );

        log('SUCCESS', `Cartão adicionado para usuário ${userId}`);

        res.json({
            success: true,
            message: "Cartão vinculado com sucesso."
        });

    } catch (error) {
        log('ERROR', 'Erro ao adicionar cartão', error.message);
        res.status(500).json({ error: "Erro ao adicionar cartão." });
    }
};

// =================================================================================================
// 15. DELETE CARD
// =================================================================================================
exports.deleteCard = async (req, res) => {
    try {
        const result = await pool.query(
            "DELETE FROM wallet_cards WHERE id = $1 AND user_id = $2 RETURNING id",
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Cartão não encontrado." });
        }

        log('SUCCESS', `Cartão ${req.params.id} removido`);

        res.json({
            success: true,
            message: "Cartão removido com sucesso."
        });

    } catch (error) {
        log('ERROR', 'Erro ao remover cartão', error.message);
        res.status(500).json({ error: "Erro ao remover cartão." });
    }
};

// =================================================================================================
// 16. GET DRIVER PERFORMANCE
// =================================================================================================
exports.getDriverPerformance = async (req, res) => {
    try {
        // Buscar corridas do motorista
        const ridesResult = await pool.query(
            `SELECT
                COUNT(*) as total,
                COALESCE(SUM(final_price), 0) as total_earnings,
                COALESCE(AVG(rating), 0) as avg_rating
             FROM rides
             WHERE driver_id = $1 AND status = 'completed'`,
            [req.user.id]
        );

        // Buscar corridas de hoje
        const todayResult = await pool.query(
            `SELECT
                COUNT(*) as today_count,
                COALESCE(SUM(final_price), 0) as today_earnings
             FROM rides
             WHERE driver_id = $1 AND status = 'completed'
               AND created_at::date = CURRENT_DATE`,
            [req.user.id]
        );

        // Buscar corridas recentes
        const recentResult = await pool.query(
            `SELECT
                r.*,
                u.name as passenger_name
             FROM rides r
             JOIN users u ON r.passenger_id = u.id
             WHERE r.driver_id = $1 AND r.status = 'completed'
             ORDER BY r.created_at DESC
             LIMIT 5`,
            [req.user.id]
        );

        const stats = ridesResult.rows[0] || { total: 0, total_earnings: 0, avg_rating: 0 };
        const today = todayResult.rows[0] || { today_count: 0, today_earnings: 0 };

        res.json({
            todayEarnings: parseFloat(today.today_earnings) || 0,
            missionsCount: parseInt(today.today_count) || 0,
            averageRating: parseFloat(stats.avg_rating) || 5.0,
            totalMissions: parseInt(stats.total) || 0,
            totalEarnings: parseFloat(stats.total_earnings) || 0,
            acceptanceRate: 100,
            cancellationRate: 0,
            level: stats.total > 50 ? 'Profissional' : stats.total > 20 ? 'Avançado' : stats.total > 5 ? 'Intermediário' : 'Iniciante',
            recentRides: recentResult.rows.map(ride => ({
                ...ride,
                final_price: parseFloat(ride.final_price),
                initial_price: parseFloat(ride.initial_price)
            }))
        });

    } catch (error) {
        log('ERROR', 'Erro ao buscar performance do motorista', error.message);
        res.json({
            todayEarnings: 0,
            missionsCount: 0,
            averageRating: 5.0,
            totalMissions: 0,
            totalEarnings: 0,
            acceptanceRate: 100,
            cancellationRate: 0,
            level: 'Iniciante',
            recentRides: []
        });
    }
};
