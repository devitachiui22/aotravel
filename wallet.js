/**
 * =================================================================================================
 * 🏦 AOTRAVEL TITANIUM WALLET ENGINE - BEYOND BANKING (REVISION 2026)
 * =================================================================================================
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Middleware de Autenticação (Assume que está disponível)
// const { authenticateToken } = require('./server');

module.exports = (pool, io) => {

    // --- HELPER: GERAR REFERÊNCIA ÚNICA ---
    const generateRef = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // 1. CONSULTAR CARTEIRA FULL (Saldo + Contas + Transações)
    router.get('/', async (req, res) => {
        try {
            const userId = req.user.id;

            // Query paralela para performance
            const [userRes, accountsRes, txRes] = await Promise.all([
                pool.query("SELECT balance, bonus_points, iban, wallet_pin FROM users WHERE id = $1", [userId]),
                pool.query("SELECT * FROM external_accounts WHERE user_id = $1", [userId]),
                pool.query(`
                    SELECT t.*,
                    s.name as sender_name, r.name as receiver_name
                    FROM wallet_transactions t
                    LEFT JOIN users s ON t.sender_id = s.id
                    LEFT JOIN users r ON t.receiver_id = r.id
                    WHERE t.sender_id = $1 OR t.receiver_id = $1
                    ORDER BY t.created_at DESC LIMIT 50`, [userId])
            ]);

            res.json({
                wallet: userRes.rows[0],
                external_accounts: accountsRes.rows,
                transactions: txRes.rows
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // 2. TRANSFERÊNCIA INTERNA (REAL-TIME + NOTIFICAÇÃO)
    router.post('/transfer/internal', async (req, res) => {
        const { receiver_identifier, amount, description, pin } = req.body;
        const senderId = req.user.id;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // a) Verificar PIN e Saldo
            const sender = await client.query("SELECT balance, wallet_pin FROM users WHERE id = $1 FOR UPDATE", [senderId]);
            if (sender.rows[0].wallet_pin !== pin) throw new Error("PIN de transação incorreto.");
            if (parseFloat(sender.rows[0].balance) < amount) throw new Error("Saldo insuficiente.");

            // b) Localizar Recebedor (por E-mail, Telefone ou IBAN)
            const receiverRes = await client.query(
                "SELECT id, name FROM users WHERE email = $1 OR phone = $1 OR iban = $1",
                [receiver_identifier]
            );
            if (receiverRes.rows.length === 0) throw new Error("Beneficiário não encontrado.");
            const receiverId = receiverRes.rows[0].id;

            // c) Executar Movimentação
            await client.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [amount, senderId]);
            await client.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [amount, receiverId]);

            // d) Registrar Histórico
            const ref = generateRef('TX');
            await client.query(`
                INSERT INTO wallet_transactions (sender_id, receiver_id, amount, type, method, description, reference_id)
                VALUES ($1, $2, $3, 'transfer', 'internal', $4, $5)`,
                [senderId, receiverId, amount, description, ref]);

            await client.query('COMMIT');

            // e) NOTIFICAÇÃO REAL-TIME VIA SOCKET
            io.to(`user_${receiverId}`).emit('new_payment_received', {
                amount,
                sender_name: req.user.name,
                message: `Recebeu ${amount} Kz de ${req.user.name}`
            });

            res.json({ success: true, reference: ref });
        } catch (e) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: e.message });
        } finally { client.release(); }
    });

    // 3. PAGAMENTO VIA QR CODE / KWIK (SIMULAÇÃO DE GATEWAY)
    router.post('/pay/qr', async (req, res) => {
        const { qr_data, amount, pin } = req.body;
        // Lógica similar à transferência, mas para entidades ou chaves Kwik
        // ... (Lógica ACID de transação)
    });

    // 4. SOLICITAR PAGAMENTO (NOTIFICAÇÃO PUSH NA TELA)
    router.post('/request-payment', async (req, res) => {
        const { target_identifier, amount, description } = req.body;
        try {
            const target = await pool.query("SELECT id, name FROM users WHERE phone = $1 OR email = $1", [target_identifier]);
            if (target.rows.length === 0) return res.status(404).json({error: "Usuário não encontrado"});

            const targetId = target.rows[0].id;

            // Salvar solicitação
            await pool.query(
                "INSERT INTO payment_requests (requester_id, payer_id, amount, description) VALUES ($1, $2, $3, $4)",
                [req.user.id, targetId, amount, description]
            );

            // EMITIR NOTIFICAÇÃO DE TELA CHEIA PARA O PAGADOR
            io.to(`user_${targetId}`).emit('payment_requested_overlay', {
                requester_name: req.user.name,
                amount: amount,
                description: description,
                timestamp: new Date()
            });

            res.json({ success: true, message: "Solicitação enviada." });
        } catch (e) { res.status(500).json({error: e.message}); }
    });

    // 5. ADICIONAR CONTA BANCÁRIA / VISA
    router.post('/accounts/add', async (req, res) => {
        const { provider, account_number, holder_name } = req.body;
        try {
            await pool.query(
                "INSERT INTO external_accounts (user_id, provider, account_number, holder_name) VALUES ($1, $2, $3, $4)",
                [req.user.id, provider, account_number, holder_name]
            );
            res.json({ success: true });
        } catch (e) { res.status(500).json({error: e.message}); }
    });

    return router;
};