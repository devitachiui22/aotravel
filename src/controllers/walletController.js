const { pool } = require('../config/db'); // CORREÇÃO: Desestruturação obrigatória
const { logSystem, logError } = require('../utils/logger');
const { generateCode } = require('../utils/helpers');

exports.getWallet = async (req, res) => {
    try {
        const userRes = await pool.query("SELECT balance, bonus_points FROM users WHERE id = $1", [req.user.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "Usuário inexistente" });
        const txRes = await pool.query("SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30", [req.user.id]);
        res.json({ balance: userRes.rows[0].balance, bonus_points: userRes.rows[0].bonus_points, transactions: txRes.rows });
    } catch (e) {
        logError('WALLET_GET', e);
        res.status(500).json({ error: e.message });
    }
};

exports.topup = async (req, res) => {
    const { amount, payment_method, transaction_id } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Valor inválido." });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO wallet_transactions (user_id, amount, type, description, reference_id, status, metadata) VALUES ($1, $2, 'topup', 'Recarga de saldo', $3, 'completed', $4)`,
            [req.user.id, amount, transaction_id || generateCode(12), JSON.stringify({ payment_method: payment_method || 'unknown', timestamp: new Date().toISOString() })]
        );
        await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, req.user.id]);
        await client.query('COMMIT');
        const balanceRes = await client.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
        logSystem('WALLET_TOPUP', `Recarga de ${amount} para usuário ${req.user.id}`);
        res.json({ success: true, new_balance: balanceRes.rows[0].balance, message: "Saldo adicionado com sucesso." });
    } catch (e) {
        await client.query('ROLLBACK');
        logError('WALLET_TOPUP', e);
        res.status(500).json({ error: "Erro ao adicionar saldo." });
    } finally {
        client.release();
    }
};

exports.withdraw = async (req, res) => {
    const { amount, bank_details } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Valor inválido." });
    if (!bank_details || !bank_details.account_number || !bank_details.bank_name) return res.status(400).json({ error: "Detalhes bancários são obrigatórios." });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const balanceRes = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
        if (parseFloat(balanceRes.rows[0].balance) < amount) { await client.query('ROLLBACK'); return res.status(400).json({ error: "Saldo insuficiente." }); }

        await client.query(
            `INSERT INTO wallet_transactions (user_id, amount, type, description, status, metadata) VALUES ($1, $2, 'withdrawal', 'Solicitação de saque', 'pending', $3)`,
            [req.user.id, -amount, JSON.stringify({ bank_details: bank_details, requested_at: new Date().toISOString(), status: 'pending_approval' })]
        );
        await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, req.user.id]);
        await client.query('COMMIT');
        logSystem('WALLET_WITHDRAW', `Saque de ${amount} solicitado por ${req.user.id}`);
        res.json({ success: true, message: "Solicitação de saque enviada. Aguarde aprovação." });
    } catch (e) {
        await client.query('ROLLBACK');
        logError('WALLET_WITHDRAW', e);
        res.status(500).json({ error: "Erro ao solicitar saque." });
    } finally {
        client.release();
    }
};