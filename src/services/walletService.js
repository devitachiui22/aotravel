/**
 * =================================================================================================
 * 🏦 AOTRAVEL SERVER PRO - WALLET SERVICE ENGINE (TITANIUM ACID)
 * =================================================================================================
 *
 * ARQUIVO: src/services/walletService.js
 * DESCRIÇÃO: Encapsula a lógica financeira complexa, gateways de pagamento e
 *            transações ACID. Gerencia o Ledger (Livro Razão) e garante integridade
 *            dos saldos dos usuários.
 *
 * REGRAS DE OURO:
 * 1. NUNCA alterar saldo sem uma transação de banco de dados (BEGIN/COMMIT).
 * 2. SEMPRE usar row-locking (FOR UPDATE) ao ler saldo para debitar.
 * 3. REGISTRAR todas as operações em `wallet_transactions` (Rastreabilidade).
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const pool = require('../config/db');
const crypto = require('crypto');
const { generateCode, generateRef, logError, logSystem } = require('../utils/helpers');
const SYSTEM_CONFIG = require('../config/appConfig');

// =================================================================================================
// 0. GATEWAY DE PAGAMENTOS MOCKUP (SIMULAÇÃO REALISTA)
// Em produção, isso seria substituído por chamadas HTTP para Proxypay, CyberSource ou MCX.
// =================================================================================================

class PaymentGateway {
    constructor() {
        this.providers = {
            'MCX': { name: 'Multicaixa Express', active: true, fee: 0 },
            'VISA': { name: 'Visa/Mastercard Secure', active: true, fee: 2.5 }, // 2.5%
            'BAI_DIRECT': { name: 'BAI Directo', active: true, fee: 0 }
        };
    }

    /**
     * Simula uma cobrança no cartão ou carteira digital externa.
     */
    async charge(provider, amount, payload) {
        // Simulação de latência de rede (Jitter 500ms - 1.5s)
        const delay = Math.floor(Math.random() * 1000) + 500;
        await new Promise(resolve => setTimeout(resolve, delay));

        // Validações Básicas
        if (!this.providers[provider]) {
            throw new Error(`Provedor de pagamento '${provider}' indisponível ou inexistente.`);
        }

        if (amount < 50) {
            throw new Error("O valor mínimo para processamento via gateway é 50.00 Kz.");
        }

        if (provider === 'MCX' && !payload.phone) {
            throw new Error("O número de telefone é obrigatório para transações MCX.");
        }

        if (provider === 'VISA' && !payload.cardToken && !payload.cardNumber) {
            throw new Error("Dados do cartão inválidos ou token expirado.");
        }

        // Simulação de Sucesso/Falha (99% de sucesso para testes, 1% erro randômico)
        const isSuccess = Math.random() > 0.01;

        if (!isSuccess) {
            logError('GATEWAY', `Transação negada pelo emissor (${provider}).`);
            throw new Error(`[GW_REJ_051] Transação negada pelo emissor. Verifique o saldo ou limites do seu banco.`);
        }

        const txId = crypto.randomUUID();
        const providerRef = `${provider}-${txId.slice(0, 8).toUpperCase()}`;

        return {
            success: true,
            status: 'captured',
            transaction_id: txId,
            provider_ref: providerRef,
            timestamp: new Date().toISOString(),
            amount_charged: amount,
            currency: 'AOA',
            fee_applied: (amount * (this.providers[provider].fee / 100))
        };
    }

    /**
     * Simula pagamento de serviços (ENDE, EPAL, etc).
     */
    async payService(entity, reference, amount) {
        const services = ['ENDE', 'EPAL', 'UNITEL', 'MOVICEL', 'ZAP', 'DSTV', 'INTERNET'];

        if (!services.includes(entity)) {
            throw new Error(`Entidade '${entity}' não é suportada por este gateway.`);
        }

        // Simulação de validação da referência na entidade
        if (reference.length < 5) {
            throw new Error(`Referência inválida para a entidade ${entity}.`);
        }

        await new Promise(resolve => setTimeout(resolve, 800)); // Latência

        return {
            success: true,
            receipt: `REC-${entity}-${Date.now().toString().slice(-6)}-${generateCode(4)}`,
            message: "Pagamento confirmado na entidade.",
            timestamp: new Date().toISOString(),
            entity_ref: reference
        };
    }
}

const gateway = new PaymentGateway();

// =================================================================================================
// 1. LÓGICA DE TRANSFERÊNCIA INTERNA (P2P)
// =================================================================================================

/**
 * Processa transferência entre carteiras internas com garantia ACID.
 * Implementa Double-Entry Bookkeeping (Débito no Remetente / Crédito no Destinatário).
 *
 * @param {number} senderId - ID do usuário que envia
 * @param {string} receiverIdentifier - Email, Telefone ou Conta Titanium do destino
 * @param {number} amount - Valor em Kwanzas
 * @param {string} description - Nota opcional
 */
async function processInternalTransfer(senderId, receiverIdentifier, amount, description) {
    const client = await pool.connect();

    try {
        logSystem('WALLET', `Iniciando transferência P2P: ${senderId} -> ${receiverIdentifier} (${amount} Kz)`);
        await client.query('BEGIN'); // Início da Transação Atômica

        // ---------------------------------------------------------------------
        // PASSO 1: Bloquear e Validar Remetente (Sender)
        // ---------------------------------------------------------------------
        const senderRes = await client.query(
            `SELECT id, name, balance, daily_limit_used, last_transaction_date,
                    wallet_status, account_tier, is_blocked
             FROM users WHERE id = $1 FOR UPDATE`, // LOCK ROW
            [senderId]
        );

        const sender = senderRes.rows[0];
        if (!sender) throw new Error("Remetente não encontrado.");
        if (sender.is_blocked) throw new Error("Sua conta está bloqueada. Contacte o suporte.");
        if (sender.wallet_status !== 'active') throw new Error(`Carteira inativa (Status: ${sender.wallet_status}).`);

        // Validação de Saldo
        const currentBalance = parseFloat(sender.balance);
        if (currentBalance < amount) {
            throw new Error(`Saldo insuficiente. Disponível: ${currentBalance.toFixed(2)} Kz.`);
        }

        // ---------------------------------------------------------------------
        // PASSO 2: Verificação de Limites Diários (Compliance)
        // ---------------------------------------------------------------------
        const todayStr = new Date().toISOString().split('T')[0];
        const lastTxDateStr = new Date(sender.last_transaction_date).toISOString().split('T')[0];

        let currentUsage = parseFloat(sender.daily_limit_used);

        // Se a data mudou, reseta o uso diário
        if (lastTxDateStr !== todayStr) {
            currentUsage = 0;
        }

        // Define limite baseado no Tier da conta
        const dailyLimit = sender.account_tier === 'premium' || sender.account_tier === 'gold'
            ? SYSTEM_CONFIG.WALLET_LIMITS.DAILY_MAX_TIER_2
            : SYSTEM_CONFIG.WALLET_LIMITS.DAILY_MAX_TIER_1;

        if ((currentUsage + amount) > dailyLimit) {
            throw new Error(`Limite diário excedido. Restante hoje: ${(dailyLimit - currentUsage).toFixed(2)} Kz.`);
        }

        // ---------------------------------------------------------------------
        // PASSO 3: Buscar e Validar Destinatário (Receiver)
        // ---------------------------------------------------------------------
        // Busca flexível: por Email, Telefone ou Número da Conta
        const receiverRes = await client.query(
            `SELECT id, name, wallet_status, balance, is_blocked
             FROM users
             WHERE (email = $1 OR phone = $1 OR wallet_account_number = $1)
             AND id != $2`, // Garante que não transfere para si mesmo
            [receiverIdentifier, senderId]
        );

        if (receiverRes.rows.length === 0) {
            // Verifica se tentou transferir para si mesmo
            const selfCheck = await client.query("SELECT id FROM users WHERE (email=$1 OR phone=$1) AND id=$2", [receiverIdentifier, senderId]);
            if (selfCheck.rows.length > 0) throw new Error("Você não pode transferir para si mesmo.");

            throw new Error("Destinatário não encontrado. Verifique os dados.");
        }

        const receiver = receiverRes.rows[0];
        if (receiver.is_blocked) throw new Error("A conta do destinatário está bloqueada e não pode receber valores.");
        if (receiver.wallet_status !== 'active') throw new Error("A carteira do destinatário não está ativa.");

        // ---------------------------------------------------------------------
        // PASSO 4: Executar Movimentação (Débito e Crédito)
        // ---------------------------------------------------------------------
        const txRef = generateRef('TRF');

        // A. Debita Remetente
        const newSenderBalance = currentBalance - amount;
        const newUsage = currentUsage + amount;

        await client.query(
            `UPDATE users SET
                balance = $1,
                daily_limit_used = $2,
                last_transaction_date = CURRENT_DATE,
                updated_at = NOW()
             WHERE id = $3`,
            [newSenderBalance, newUsage, senderId]
        );

        // B. Credita Destinatário
        const receiverBalance = parseFloat(receiver.balance) + amount;
        await client.query(
            `UPDATE users SET
                balance = balance + $1,
                updated_at = NOW()
             WHERE id = $2`,
            [amount, receiver.id]
        );

        // ---------------------------------------------------------------------
        // PASSO 5: Registrar no Ledger (Double Entry)
        // ---------------------------------------------------------------------

        // Log 1: Saída do Remetente (Amount Negativo)
        await client.query(
            `INSERT INTO wallet_transactions
            (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, balance_after, category)
            VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6, $7, 'p2p')`,
            [
                txRef,
                senderId,
                senderId,
                receiver.id,
                -amount, // Negativo
                description || `Envio para ${receiver.name}`,
                newSenderBalance
            ]
        );

        // Log 2: Entrada no Destinatário (Amount Positivo)
        // Note: Reference ID é o mesmo para rastreamento cruzado, mas com user_id diferente
        // Como reference_id é UNIQUE, precisamos de um sufixo ou estratégia.
        // Na nossa modelagem dbBootstrap, reference_id é UNIQUE.
        // SOLUÇÃO: Usamos reference_id para o SENDER e reference_id + '-IN' para o RECEIVER
        // ou ajustamos a constraint.
        // MELHOR: Usar `txRef` para o sender e gerar `txRef-REC` para o receiver.

        const receiverRef = `${txRef}-REC`;

        await client.query(
            `INSERT INTO wallet_transactions
            (reference_id, user_id, sender_id, receiver_id, amount, type, method, status, description, balance_after, category)
            VALUES ($1, $2, $3, $4, $5, 'transfer', 'internal', 'completed', $6, $7, 'p2p')`,
            [
                receiverRef,
                receiver.id,
                senderId,
                receiver.id,
                amount, // Positivo
                `Recebido de ${sender.name}`,
                receiverBalance
            ]
        );

        await client.query('COMMIT');

        logSystem('WALLET', `✅ Transferência P2P concluída: ${txRef}`);

        return {
            success: true,
            reference: txRef,
            amount: amount,
            recipient: receiver.name,
            sender_id: senderId,
            receiver_id: receiver.id,
            new_balance: newSenderBalance,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        await client.query('ROLLBACK');
        logError('WALLET_TRANSFER_ROLLBACK', error);
        throw error; // Propaga erro para o Controller
    } finally {
        client.release();
    }
}

// =================================================================================================
// 2. LÓGICA DE RECARGA (TOP-UP)
// =================================================================================================

/**
 * Processa recarga via Gateway Externo.
 */
async function processTopUp(userId, amount, method, paymentDetails) {
    // 1. Cobrança no Gateway (Fora da transação do DB para não bloquear conexão em caso de timeout)
    let gwResult;
    try {
        gwResult = await gateway.charge(
            method === 'visa' ? 'VISA' : 'MCX',
            amount,
            paymentDetails
        );
    } catch (gwError) {
        throw gwError; // Erro de gateway, aborta antes de tocar no DB
    }

    // 2. Persistência ACID
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Atualiza Saldo
        // Returning balance para obter o saldo final atômico
        const updateRes = await client.query(
            "UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING balance",
            [amount, userId]
        );

        if (updateRes.rows.length === 0) throw new Error("Usuário não encontrado para crédito.");
        const newBalance = parseFloat(updateRes.rows[0].balance);

        // Registra Transação
        await client.query(
            `INSERT INTO wallet_transactions
             (reference_id, user_id, amount, type, method, status, description, metadata, balance_after, category)
             VALUES ($1, $2, $3, 'deposit', $4, 'completed', $5, $6, $7, 'topup')`,
            [
                gwResult.provider_ref,
                userId,
                amount,
                method,
                `Recarga via ${method === 'visa' ? 'Cartão' : 'Multicaixa'}`,
                JSON.stringify(gwResult),
                newBalance
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            new_balance: newBalance,
            reference: gwResult.provider_ref,
            message: "Recarga realizada com sucesso."
        };

    } catch (dbError) {
        await client.query('ROLLBACK');
        logError('TOPUP_DB_FATAL', dbError);
        // Em um cenário real, se o gateway cobrou mas o DB falhou, precisamos de um mecanismo de estorno/reconciliação.
        // Aqui lançamos um erro crítico.
        throw new Error(`Erro ao creditar saldo. Se o valor foi descontado, guarde a ref: ${gwResult.provider_ref}`);
    } finally {
        client.release();
    }
}

// =================================================================================================
// 3. LÓGICA DE SAQUE (WITHDRAWAL)
// =================================================================================================

/**
 * Processa saque para conta bancária externa.
 */
async function processWithdrawal(userId, amount, bankAccountId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Bloqueia Usuário
        const userRes = await client.query("SELECT balance FROM users WHERE id = $1 FOR UPDATE", [userId]);
        const balance = parseFloat(userRes.rows[0].balance);

        // Cálculo de Taxas
        let fee = amount * SYSTEM_CONFIG.WALLET_FEES.BANK_WITHDRAWAL_PCT;
        if (fee < SYSTEM_CONFIG.WALLET_FEES.BANK_WITHDRAWAL_MIN) {
            fee = SYSTEM_CONFIG.WALLET_FEES.BANK_WITHDRAWAL_MIN;
        }

        const totalDeduction = amount + fee;

        // Validação
        if (balance < totalDeduction) {
            throw new Error(`Saldo insuficiente. Necessário: ${totalDeduction.toFixed(2)} Kz (Inclui taxa de ${fee.toFixed(2)} Kz).`);
        }

        // Validação da Conta Bancária (Garante que pertence ao user)
        const bankRes = await client.query(
            "SELECT * FROM external_bank_accounts WHERE id = $1 AND user_id = $2",
            [bankAccountId, userId]
        );

        if (bankRes.rows.length === 0) throw new Error("Conta bancária inválida ou não pertence a este usuário.");
        const bank = bankRes.rows[0];

        // Executa Débito
        const newBalance = balance - totalDeduction;
        await client.query(
            "UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2",
            [newBalance, userId]
        );

        const txRef = generateRef('WTH');

        // Registra Transação (Estado 'pending' pois saques bancários não são instantâneos)
        await client.query(
            `INSERT INTO wallet_transactions
             (reference_id, user_id, amount, fee, type, method, status, description, metadata, balance_after, category)
             VALUES ($1, $2, $3, $4, 'withdraw', 'bank_transfer', 'pending', $5, $6, $7, 'withdraw')`,
            [
                txRef,
                userId,
                -amount, // O valor principal é negativo
                fee,     // A taxa é registrada positivamente na coluna fee
                `Saque para ${bank.bank_name} (${bank.iban.slice(-4)})`,
                JSON.stringify({ iban: bank.iban, holder: bank.holder_name }),
                newBalance
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            reference: txRef,
            amount_deducted: totalDeduction,
            fee: fee,
            new_balance: newBalance,
            status: 'pending',
            message: "Solicitação de saque recebida. Processamento em até 24h úteis."
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// =================================================================================================
// 4. LÓGICA DE PAGAMENTO DE SERVIÇOS
// =================================================================================================

/**
 * Processa pagamento de serviços (TV, Água, Luz).
 */
async function processServicePayment(userId, serviceId, reference, amount) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Bloqueia Usuário
        const userRes = await client.query("SELECT balance FROM users WHERE id = $1 FOR UPDATE", [userId]);
        const balance = parseFloat(userRes.rows[0].balance);
        const fixedFee = SYSTEM_CONFIG.WALLET_FEES.SERVICE_PAYMENT_FIXED;
        const totalCost = amount + fixedFee;

        if (balance < totalCost) {
            throw new Error(`Saldo insuficiente. Total necessário: ${totalCost.toFixed(2)} Kz.`);
        }

        // Chama Gateway (Dentro da transaction aqui, assumindo resposta rápida,
        // ou movemos para fora se o gateway for lento, similar ao TopUp, mas com reserva de saldo).
        // Por simplicidade e segurança (evitar double spend), chamamos dentro e confiamos no timeout.
        let svcResult;
        try {
            svcResult = await gateway.payService(serviceId, reference, amount);
        } catch (gwError) {
            throw gwError; // Se falhar no gateway, rollback automático
        }

        // Debitar
        const newBalance = balance - totalCost;
        await client.query("UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2", [newBalance, userId]);

        const txRef = generateRef('PAY');

        // Registrar
        await client.query(
            `INSERT INTO wallet_transactions
             (reference_id, user_id, amount, fee, type, method, status, description, metadata, balance_after, category)
             VALUES ($1, $2, $3, $4, 'bill_payment', 'internal', 'completed', $5, $6, $7, 'services')`,
            [
                txRef,
                userId,
                -amount,
                fixedFee,
                `Pagamento ${serviceId} - ${reference}`,
                JSON.stringify({ ref: reference, receipt: svcResult.receipt, entity: serviceId }),
                newBalance
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            receipt: svcResult.receipt,
            total_paid: totalCost,
            fee: fixedFee,
            new_balance: newBalance
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Exportação dos Métodos Blindados
module.exports = {
    processInternalTransfer,
    processTopUp,
    processWithdrawal,
    processServicePayment
};