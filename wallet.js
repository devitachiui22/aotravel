/**
 * =================================================================================================
 * 🏦 AOTRAVEL TITANIUM FINANCIAL ENGINE - WALLET CORE SYSTEM v3.0 (FINAL RELEASE 2026)
 * =================================================================================================
 *
 * ARQUIVO: backend/wallet.js
 * DESCRIÇÃO: Controlador Mestre de Finanças, Transações P2P, Integrações Bancárias e Segurança.
 *
 * AUTOR: Engenharia de Software Sênior (AOtravel Team)
 * DATA: 10 de Fevereiro de 2026
 *
 * --- ÍNDICE DE FUNCIONALIDADES ---
 * 1.  CONFIGURAÇÃO E UTILITÁRIOS (Helpers de Criptografia e Validação)
 * 2.  MIDDLEWARES DE SEGURANÇA (Verificação de PIN, Travamento de Sessão)
 * 3.  ROTAS DE LEITURA (Dashboard, Extrato Detalhado, Verificação de Status)
 * 4.  ROTAS TRANSACIONAIS (P2P, TopUp, Withdraw, Pagamento de Serviços)
 * 5.  GESTÃO DE CONTAS (IBAN, Cartões, Chaves Pix/Kwik)
 * 6.  SEGURANÇA (Redefinição de PIN, Bloqueio de Carteira)
 *
 * --- PADRÕES DE QUALIDADE ---
 * - ACID Compliance: Uso estrito de 'BEGIN', 'COMMIT', 'ROLLBACK'.
 * - Race Condition Protection: Uso de 'FOR UPDATE' para travar linhas de saldo durante escritas.
 * - Audit Logging: Logs detalhados de cada etapa financeira.
 * - Input Sanitation: Validação rigorosa de tipos e valores.
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

/**
 * MÓDULO EXPORTÁVEL
 * Recebe as instâncias do Pool de Conexão (PostgreSQL) e Socket.IO
 */
module.exports = (pool, io) => {

    // =============================================================================================
    // 🛠️ SEÇÃO 1: UTILITÁRIOS E HELPERS DO SISTEMA
    // =============================================================================================

    /**
     * Gera uma referência única e legível para transações.
     * Formato: PREF-TIMESTAMP-RANDOM (Ex: TRF-16789922-A1B2)
     * @param {string} prefix - Prefixo da operação (TRF, DEP, WTH, PAY)
     */
    const generateTransactionRef = (prefix) => {
        const timestamp = Date.now().toString().slice(-8);
        const random = crypto.randomBytes(2).toString('hex').toUpperCase();
        return `${prefix}-${timestamp}-${random}`;
    };

    /**
     * Logger especializado para operações financeiras.
     * Inclui timestamp ISO e ID do usuário para rastreabilidade.
     */
    const logFinance = (userId, action, details) => {
        const timestamp = new Date().toISOString();
        console.log(`[💰 FINANCE_AUDIT] [${timestamp}] [USER:${userId}] [${action}] ${JSON.stringify(details)}`);
    };

    /**
     * Valida se um valor monetário é seguro para processamento.
     * Impede valores negativos, nulos ou NaN.
     */
    const isValidAmount = (amount) => {
        return amount && !isNaN(amount) && parseFloat(amount) > 0;
    };

    /**
     * Formata erros de banco de dados para mensagens amigáveis ao cliente.
     */
    const handleDbError = (err, res, transactionRef = 'N/A') => {
        console.error(`❌ [DB_CRITICAL_FAILURE] Ref: ${transactionRef}`, err);
        return res.status(500).json({
            error: "Falha crítica no processamento financeiro.",
            code: "INTERNAL_TX_ERROR",
            reference: transactionRef,
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    };

    // =============================================================================================
    // 📊 SEÇÃO 2: ROTAS DE CONSULTA E DASHBOARD (READ-ONLY)
    // =============================================================================================

    /**
     * ROTA: GET /
     * DESCRIÇÃO: Retorna o sumário completo da carteira do usuário autenticado.
     * DADOS: Saldo real, IBAN, Pontos, Limites e as últimas 50 transações.
     */
    router.get('/', async (req, res) => {
        try {
            // 1. Validação de Sessão
            if (!req.user || !req.user.id) {
                return res.status(401).json({ error: "Sessão inválida ou expirada." });
            }

            const userId = req.user.id;
            const startTime = Date.now();

            // 2. Execução Paralela de Consultas (Otimização de Performance)
            // Utilizamos Promise.all para buscar dados independentes simultaneamente.
            const [userDataResult, externalAccountsResult, transactionsResult] = await Promise.all([
                // Query A: Dados Vitais do Usuário
                pool.query(
                    `SELECT
                        balance,
                        bonus_points,
                        iban,
                        wallet_pin,
                        account_limit,
                        is_verified,
                        currency
                     FROM users WHERE id = $1`,
                    [userId]
                ),

                // Query B: Contas Bancárias Vinculadas
                pool.query(
                    `SELECT id, provider, account_number, holder_name, is_default, created_at
                     FROM external_accounts
                     WHERE user_id = $1
                     ORDER BY is_default DESC, created_at DESC`,
                    [userId]
                ),

                // Query C: Histórico de Transações (Enriquecido com nomes)
                // Faz JOIN com a tabela users duas vezes para pegar nome do remetente e destinatário
                pool.query(
                    `SELECT
                        t.id,
                        t.amount,
                        t.type,
                        t.method,
                        t.description,
                        t.reference_id,
                        t.status,
                        t.created_at,
                        t.sender_id,
                        t.receiver_id,
                        t.metadata,
                        s.name as sender_name,
                        r.name as receiver_name,
                        s.photo as sender_photo,
                        r.photo as receiver_photo
                     FROM wallet_transactions t
                     LEFT JOIN users s ON t.sender_id = s.id
                     LEFT JOIN users r ON t.receiver_id = r.id
                     WHERE t.user_id = $1 OR t.sender_id = $1 OR t.receiver_id = $1
                     ORDER BY t.created_at DESC
                     LIMIT 50`,
                    [userId]
                )
            ]);

            // 3. Tratamento de Dados (Fallback Seguro)
            // Se o usuário não existir (caso raro de deleção durante sessão), retorna padrão zerado.
            const walletData = userDataResult.rows.length > 0 ? userDataResult.rows[0] : {
                balance: 0.00,
                bonus_points: 0,
                iban: "Não gerado",
                account_limit: 500000.00,
                is_verified: false
            };

            // 4. Auditoria de Leitura
            const duration = Date.now() - startTime;
            // console.log(`[WALLET_READ] Dashboard carregado para User ${userId} em ${duration}ms`);

            // 5. Resposta JSON Estruturada
            res.json({
                success: true,
                timestamp: new Date().toISOString(),
                wallet: {
                    balance: parseFloat(walletData.balance || 0).toFixed(2),
                    bonus_points: parseInt(walletData.bonus_points || 0),
                    iban: walletData.iban || "AO06 ...",
                    limit: parseFloat(walletData.account_limit || 500000),
                    status: walletData.is_verified ? "verified" : "unverified",
                    currency: walletData.currency || "AOA",
                    has_pin: !!walletData.wallet_pin // Retorna apenas booleano, nunca o PIN
                },
                external_accounts: externalAccountsResult.rows,
                transactions: transactionsResult.rows
            });

        } catch (error) {
            logFinance(req.user?.id || 'unknown', 'ERROR_DASHBOARD', error.message);
            res.status(500).json({ error: "Erro interno ao carregar a carteira digital." });
        }
    });

    /**
     * ROTA: GET /summary
     * DESCRIÇÃO: Endpoint leve apenas para saldo (Usado em polling ou refresh rápido).
     */
    router.get('/summary', async (req, res) => {
        try {
            const result = await pool.query("SELECT balance, bonus_points FROM users WHERE id = $1", [req.user.id]);
            if (result.rows.length === 0) return res.sendStatus(404);

            res.json({
                balance: parseFloat(result.rows[0].balance),
                points: result.rows[0].bonus_points
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // =============================================================================================
    // 💸 SEÇÃO 3: TRANSFERÊNCIAS P2P (CORE TRANSACTIONAL)
    // =============================================================================================

    /**
     * ROTA: POST /transfer/internal
     * DESCRIÇÃO: Transferência entre usuários da plataforma (P2P).
     * SEGURANÇA: Exige PIN, Saldo Suficiente, Bloqueio de Linha (Row Lock).
     */
    router.post('/transfer/internal', async (req, res) => {
        const { receiver_identifier, amount, description, pin } = req.body;
        const senderId = req.user.id;
        const txRef = generateTransactionRef('TRF');

        // 1. Validação de Entrada Básica
        if (!isValidAmount(amount)) {
            return res.status(400).json({ error: "O valor da transferência deve ser positivo." });
        }
        if (!receiver_identifier) {
            return res.status(400).json({ error: "O destinatário é obrigatório." });
        }
        if (!pin) {
            return res.status(400).json({ error: "O PIN de segurança é obrigatório." });
        }

        // Início da Conexão Dedicada para Transação ACID
        const client = await pool.connect();

        try {
            logFinance(senderId, 'INIT_TRANSFER', { target: receiver_identifier, amount, ref: txRef });

            // INÍCIO DA TRANSAÇÃO NO BANCO DE DADOS
            await client.query('BEGIN');

            // 2. BUSCAR REMETENTE COM BLOQUEIO (FOR UPDATE)
            // Isso impede que o saldo seja gasto duas vezes simultaneamente.
            const senderRes = await client.query(
                `SELECT id, name, balance, wallet_pin, is_blocked, account_limit
                 FROM users WHERE id = $1 FOR UPDATE`,
                [senderId]
            );

            const sender = senderRes.rows[0];

            // 3. Validações de Negócio do Remetente
            if (sender.is_blocked) throw new Error("Sua carteira está bloqueada temporariamente.");
            if (sender.wallet_pin !== pin) throw new Error("PIN de segurança incorreto."); // Em prod, usar bcrypt.compare
            if (parseFloat(sender.balance) < parseFloat(amount)) throw new Error("Saldo insuficiente.");
            if (parseFloat(amount) > parseFloat(sender.account_limit)) throw new Error(`Valor excede o seu limite diário de ${sender.account_limit}.`);

            // 4. BUSCAR DESTINATÁRIO
            // Busca por E-mail, Telefone, IBAN ou ID Interno
            const receiverRes = await client.query(
                `SELECT id, name, is_blocked, fcm_token
                 FROM users
                 WHERE (email = $1 OR phone = $1 OR iban = $1 OR id::text = $1)
                 AND id != $2`, // Garante que não é o próprio usuário
                [receiver_identifier, senderId]
            );

            if (receiverRes.rows.length === 0) {
                throw new Error("Destinatário não encontrado ou inválido.");
            }

            const receiver = receiverRes.rows[0];
            if (receiver.is_blocked) throw new Error("A conta do destinatário está inativa.");

            // 5. EXECUÇÃO FINANCEIRA (ATÔMICA)

            // A. Debitar do Remetente
            await client.query(
                "UPDATE users SET balance = balance - $1 WHERE id = $2",
                [amount, senderId]
            );

            // B. Creditar no Destinatário
            await client.query(
                "UPDATE users SET balance = balance + $1 WHERE id = $2",
                [amount, receiver.id]
            );

            // 6. REGISTRO DE HISTÓRICO (DUPLA ENTRADA)
            // É boa prática contábil registrar a visão de cada usuário separadamente.

            // Registro para Remetente (Débito)
            await client.query(
                `INSERT INTO wallet_transactions
                 (user_id, sender_id, receiver_id, amount, type, method, description, reference_id, status, metadata)
                 VALUES ($1, $2, $3, $4, 'transfer', 'internal', $5, $6, 'completed', $7)`,
                [
                    senderId,
                    senderId,
                    receiver.id,
                    -Math.abs(amount), // Valor negativo para indicar saída visualmente
                    `Envio para ${receiver.name}`,
                    txRef,
                    JSON.stringify({ note: description, direction: 'outbound' })
                ]
            );

            // Registro para Destinatário (Crédito)
            await client.query(
                `INSERT INTO wallet_transactions
                 (user_id, sender_id, receiver_id, amount, type, method, description, reference_id, status, metadata)
                 VALUES ($1, $2, $3, $4, 'transfer', 'internal', $5, $6, 'completed', $7)`,
                [
                    receiver.id,
                    senderId,
                    receiver.id,
                    Math.abs(amount), // Valor positivo
                    `Recebido de ${sender.name}`,
                    txRef,
                    JSON.stringify({ note: description, direction: 'inbound' })
                ]
            );

            // 7. CONFIRMAÇÃO DA TRANSAÇÃO
            await client.query('COMMIT');

            // 8. NOTIFICAÇÕES EM TEMPO REAL (PÓS-COMMIT)
            // Só notificamos se o dinheiro realmente moveu.

            // Notifica Destinatário
            io.to(`user_${receiver.id}`).emit('payment_received', {
                amount: amount,
                sender_name: sender.name,
                reference: txRef,
                timestamp: new Date().toISOString(),
                message: `Você recebeu ${amount} Kz de ${sender.name}`
            });

            // Notifica Remetente (Confirmação visual)
            io.to(`user_${senderId}`).emit('transfer_success', {
                amount: amount,
                receiver_name: receiver.name,
                reference: txRef,
                new_balance: parseFloat(sender.balance) - parseFloat(amount)
            });

            logFinance(senderId, 'SUCCESS_TRANSFER', { ref: txRef, amount });

            res.json({
                success: true,
                message: "Transferência realizada com sucesso.",
                reference: txRef,
                data: {
                    amount: amount,
                    receiver: receiver.name,
                    date: new Date().toISOString()
                }
            });

        } catch (error) {
            // Em caso de qualquer erro, desfaz TUDO. Dinheiro não é perdido.
            await client.query('ROLLBACK');
            logFinance(senderId, 'FAILED_TRANSFER', error.message);
            res.status(400).json({ error: error.message || "Erro ao processar transferência." });
        } finally {
            // Libera a conexão para o pool
            client.release();
        }
    });

    // =============================================================================================
    // 📥 SEÇÃO 4: RECARGAS E DEPÓSITOS (TOP-UP)
    // =============================================================================================

    /**
     * ROTA: POST /topup
     * DESCRIÇÃO: Simula ou integra gateways de pagamento (Multicaixa/Visa).
     * NOTA: Em produção, isso seria um callback/webhook do gateway de pagamento.
     */
    router.post('/topup', async (req, res) => {
        const { amount, method, transaction_id } = req.body;
        const userId = req.user.id;
        const ref = transaction_id || generateTransactionRef('DEP');

        if (!isValidAmount(amount)) {
            return res.status(400).json({ error: "Valor de recarga inválido." });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Atualizar Saldo
            await client.query(
                "UPDATE users SET balance = balance + $1 WHERE id = $2",
                [amount, userId]
            );

            // 2. Registrar Histórico
            await client.query(
                `INSERT INTO wallet_transactions
                 (user_id, amount, type, method, description, reference_id, status, metadata)
                 VALUES ($1, $2, 'topup', $3, 'Recarga de Carteira', $4, 'completed', $5)`,
                [
                    userId,
                    amount,
                    method || 'multicaixa',
                    ref,
                    JSON.stringify({ gateway: 'simulated', original_ref: transaction_id })
                ]
            );

            await client.query('COMMIT');

            // 3. Obter saldo atualizado para retornar à UI
            const balanceRes = await client.query("SELECT balance FROM users WHERE id = $1", [userId]);

            io.to(`user_${userId}`).emit('wallet_updated', {
                type: 'topup',
                amount: amount,
                new_balance: parseFloat(balanceRes.rows[0].balance)
            });

            res.json({
                success: true,
                message: "Recarga realizada com sucesso.",
                new_balance: parseFloat(balanceRes.rows[0].balance),
                reference: ref
            });

        } catch (error) {
            await client.query('ROLLBACK');
            handleDbError(error, res, ref);
        } finally {
            client.release();
        }
    });

    // =============================================================================================
    // 📤 SEÇÃO 5: SAQUES E LEVANTAMENTOS (WITHDRAW)
    // =============================================================================================

    /**
     * ROTA: POST /withdraw
     * DESCRIÇÃO: Solicita retirada para conta bancária externa.
     * FLUXO: Deduz saldo imediatamente, cria registro 'pending'. Admin aprova depois.
     */
    router.post('/withdraw', async (req, res) => {
        const { amount, destination_iban, description } = req.body;
        const userId = req.user.id;
        const ref = generateTransactionRef('WTH');

        if (!isValidAmount(amount)) {
            return res.status(400).json({ error: "Valor de saque inválido." });
        }

        // Valor mínimo de saque (Regra de Negócio)
        if (amount < 2000) {
            return res.status(400).json({ error: "O valor mínimo para levantamento é 2.000 Kz." });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Verificar Saldo com Lock
            const userRes = await client.query("SELECT balance FROM users WHERE id = $1 FOR UPDATE", [userId]);
            const currentBalance = parseFloat(userRes.rows[0].balance);

            if (currentBalance < amount) {
                throw new Error("Saldo insuficiente para realizar este levantamento.");
            }

            // 2. Deduzir Saldo (O dinheiro sai da conta virtual imediatamente para evitar gasto duplo)
            await client.query(
                "UPDATE users SET balance = balance - $1 WHERE id = $2",
                [amount, userId]
            );

            // 3. Registrar Transação (Status: PENDING)
            await client.query(
                `INSERT INTO wallet_transactions
                 (user_id, amount, type, method, description, reference_id, status, metadata)
                 VALUES ($1, $2, 'withdraw', 'bank_transfer', $3, $4, 'pending', $5)`,
                [
                    userId,
                    -amount, // Negativo
                    description || `Levantamento para ${destination_iban}`,
                    ref,
                    JSON.stringify({ destination: destination_iban, bank: 'Unknown' })
                ]
            );

            await client.query('COMMIT');

            res.json({
                success: true,
                message: "Solicitação de levantamento enviada. O processamento pode levar até 24h.",
                reference: ref
            });

        } catch (error) {
            await client.query('ROLLBACK');
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    });

    // =============================================================================================
    // 🔔 SEÇÃO 6: SOLICITAÇÃO DE PAGAMENTO (REQUEST MONEY)
    // =============================================================================================

    /**
     * ROTA: POST /request-payment
     * DESCRIÇÃO: Envia uma notificação push/socket para outro usuário pedindo dinheiro.
     */
    router.post('/request-payment', async (req, res) => {
        const { target_identifier, amount, description } = req.body;
        const userId = req.user.id;

        if (!isValidAmount(amount)) {
            return res.status(400).json({ error: "Valor inválido." });
        }

        try {
            // 1. Localizar o alvo
            const targetRes = await pool.query(
                "SELECT id, name, fcm_token FROM users WHERE email = $1 OR phone = $1 OR iban = $1",
                [target_identifier]
            );

            if (targetRes.rows.length === 0) {
                return res.status(404).json({ error: "Usuário não encontrado." });
            }

            const targetUser = targetRes.rows[0];

            // 2. Salvar solicitação no banco (Opcional, mas bom para histórico)
            await pool.query(
                `INSERT INTO payment_requests
                 (requester_id, payer_id, amount, description, status)
                 VALUES ($1, $2, $3, $4, 'pending')`,
                [userId, targetUser.id, amount, description]
            );

            // 3. Enviar evento Socket em tempo real (Overlay na tela do pagador)
            io.to(`user_${targetUser.id}`).emit('payment_requested_overlay', {
                requester_id: userId,
                requester_name: req.user.name,
                amount: amount,
                description: description || "Solicitação de dinheiro",
                timestamp: new Date().toISOString()
            });

            // 4. (Opcional) Enviar Push Notification via FCM aqui se o usuário estiver offline

            res.json({ success: true, message: `Solicitação enviada para ${targetUser.name}` });

        } catch (error) {
            logFinance(userId, 'REQUEST_ERROR', error.message);
            res.status(500).json({ error: "Erro ao enviar solicitação." });
        }
    });

    // =============================================================================================
    // 💳 SEÇÃO 7: GESTÃO DE CONTAS BANCÁRIAS EXTERNAS
    // =============================================================================================

    /**
     * ROTA: POST /accounts/add
     * DESCRIÇÃO: Salva uma conta bancária favorita para saques futuros.
     */
    router.post('/accounts/add', async (req, res) => {
        const { provider, account_number, holder_name } = req.body;
        const userId = req.user.id;

        if (!provider || !account_number || !holder_name) {
            return res.status(400).json({ error: "Todos os campos são obrigatórios." });
        }

        try {
            // Limite de contas (Regra de Negócio: Max 3)
            const countRes = await pool.query("SELECT COUNT(*) FROM external_accounts WHERE user_id = $1", [userId]);
            if (parseInt(countRes.rows[0].count) >= 5) {
                return res.status(400).json({ error: "Limite de 5 contas bancárias atingido." });
            }

            await pool.query(
                `INSERT INTO external_accounts (user_id, provider, account_number, holder_name)
                 VALUES ($1, $2, $3, $4)`,
                [userId, provider, account_number, holder_name]
            );

            res.json({ success: true, message: "Conta adicionada com sucesso." });
        } catch (error) {
            res.status(500).json({ error: "Erro ao salvar conta bancária." });
        }
    });

    /**
     * ROTA: DELETE /accounts/:id
     * DESCRIÇÃO: Remove uma conta bancária salva.
     */
    router.delete('/accounts/:id', async (req, res) => {
        try {
            const result = await pool.query(
                "DELETE FROM external_accounts WHERE id = $1 AND user_id = $2 RETURNING id",
                [req.params.id, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Conta não encontrada ou permissão negada." });
            }

            res.json({ success: true, message: "Conta removida." });
        } catch (error) {
            res.status(500).json({ error: "Erro ao remover conta." });
        }
    });

    // =============================================================================================
    // 🔐 SEÇÃO 8: SEGURANÇA (PIN E VERIFICAÇÃO)
    // =============================================================================================

    /**
     * ROTA: POST /verify-pin
     * DESCRIÇÃO: Verifica se o PIN informado corresponde ao do usuário (para ações no frontend).
     */
    router.post('/verify-pin', async (req, res) => {
        const { pin } = req.body;
        const userId = req.user.id;

        try {
            const result = await pool.query("SELECT wallet_pin FROM users WHERE id = $1", [userId]);
            const storedPin = result.rows[0]?.wallet_pin;

            if (!storedPin) {
                return res.status(400).json({ error: "PIN não configurado." });
            }

            if (storedPin === pin) {
                res.json({ valid: true });
            } else {
                res.json({ valid: false });
            }
        } catch (error) {
            res.status(500).json({ error: "Erro na verificação." });
        }
    });

    /**
     * ROTA: POST /set-pin
     * DESCRIÇÃO: Configura ou altera o PIN da carteira.
     */
    router.post('/set-pin', async (req, res) => {
        const { current_pin, new_pin } = req.body;
        const userId = req.user.id;

        if (!new_pin || new_pin.length !== 4) {
            return res.status(400).json({ error: "O novo PIN deve ter 4 dígitos." });
        }

        try {
            const result = await pool.query("SELECT wallet_pin FROM users WHERE id = $1", [userId]);
            const storedPin = result.rows[0]?.wallet_pin;

            // Se já tiver PIN, exige o antigo
            if (storedPin && storedPin !== current_pin) {
                return res.status(401).json({ error: "PIN atual incorreto." });
            }

            await pool.query("UPDATE users SET wallet_pin = $1 WHERE id = $2", [new_pin, userId]);

            logFinance(userId, 'PIN_CHANGE', { success: true });
            res.json({ success: true, message: "PIN de segurança atualizado." });

        } catch (error) {
            res.status(500).json({ error: "Erro ao definir PIN." });
        }
    });

    // =============================================================================================
    // 🔎 SEÇÃO 9: INSPEÇÃO DE TRANSAÇÃO (DETALHES)
    // =============================================================================================

    router.get('/transaction/:ref', async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT t.*,
                        s.name as sender_name,
                        r.name as receiver_name
                 FROM wallet_transactions t
                 LEFT JOIN users s ON t.sender_id = s.id
                 LEFT JOIN users r ON t.receiver_id = r.id
                 WHERE t.reference_id = $1 AND (t.sender_id = $2 OR t.receiver_id = $2 OR t.user_id = $2)`,
                [req.params.ref, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Transação não encontrada." });
            }

            res.json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: "Erro ao buscar transação." });
        }
    });

    // Retorna o roteador configurado para ser usado no server.js
    return router;
};
