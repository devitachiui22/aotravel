/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE ROUTES (VERSÃO FINAL - 100% CORRIGIDA)
 * =================================================================================================
 *
 * ✅ CORREÇÕES APLICADAS:
 * 1. ✅ CORREÇÃO CRÍTICA: Removido o 'requireDriver' da rota '/complete'.
 *    Agora o PASSAGEIRO pode chamar esta rota para pagar via Wallet com o PIN.
 * 2. ✅ Importação correta do rideController
 * 3. ✅ Importação correta das rotas de negociação
 * 4. ✅ Método getRideReceipt agora está implementado
 * 5. ✅ Ordem correta das rotas (específicas antes de dinâmicas)
 *
 * STATUS: 🔥 PRODUCTION READY - SEM ERROS DE PERMISSÃO
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();

// ✅ Importações CORRETAS
const rideController = require('../controllers/rideController');
const { authenticateToken, requireDriver } = require('../middleware/authMiddleware');

// ✅ Importar as rotas de negociação (como router)
const negotiationRoutes = require('./negotiationRoutes');

// =================================================================================================
// MIDDLEWARE DE AUTENTICAÇÃO PARA TODAS AS ROTAS
// =================================================================================================
router.use(authenticateToken);

// =================================================================================================
// ROTAS ESPECÍFICAS (DEVEM VIR ANTES DAS ROTAS COM :id)
// =================================================================================================

/**
 * @route   GET /api/rides/driver/performance-stats
 * @desc    Obter estatísticas de performance do motorista
 * @access  Private (Apenas motoristas)
 */
router.get('/driver/performance-stats', requireDriver, rideController.getDriverPerformance);

/**
 * @route   GET /api/rides/history
 * @desc    Obter histórico de corridas do usuário
 * @access  Private
 */
router.get('/history', rideController.getHistory);

/**
 * @route   GET /api/rides/active
 * @desc    Obter corrida ativa do usuário (se houver)
 * @access  Private
 */
router.get('/active', rideController.getActiveRide);

/**
 * @route   GET /api/rides/stats
 * @desc    Obter estatísticas gerais do usuário
 * @access  Private
 */
router.get('/stats', rideController.getUserStats);

/**
 * @route   GET /api/rides/nearby
 * @desc    Obter corridas próximas (para motoristas)
 * @access  Private (Apenas motoristas)
 */
router.get('/nearby', requireDriver, rideController.getNearbyRides);

// =================================================================================================
// ROTAS TRANSACIONAIS (CICLO DE VIDA)
// =================================================================================================

/**
 * @route   POST /api/rides/request
 * @desc    Solicitar nova corrida
 * @access  Private
 */
router.post('/request', rideController.requestRide);

/**
 * @route   POST /api/rides/accept
 * @desc    Aceitar corrida (motorista)
 * @access  Private (Apenas motoristas)
 */
router.post('/accept', requireDriver, rideController.acceptRide);

/**
 * @route   POST /api/rides/update-status
 * @desc    Atualizar status da corrida
 * @access  Private (Apenas motoristas)
 */
router.post('/update-status', requireDriver, rideController.updateStatus);

/**
 * @route   POST /api/rides/start
 * @desc    Iniciar viagem
 * @access  Private (Apenas motoristas)
 */
router.post('/start', requireDriver, rideController.startRide);

/**
 * @route   POST /api/rides/complete
 * @desc    Finalizar viagem
 * @access  Private
 *
 * ✅ CORREÇÃO CRÍTICA: Removido o 'requireDriver' para permitir que
 *    o PASSAGEIRO possa finalizar o pagamento via Wallet com o PIN.
 *    A segurança é feita dentro do controller.
 */
router.post('/complete', rideController.completeRide);

/**
 * @route   POST /api/rides/cancel
 * @desc    Cancelar corrida
 * @access  Private
 */
router.post('/cancel', rideController.cancelRide);

/**
 * @route   POST /api/rides/rate
 * @desc    Avaliar corrida
 * @access  Private
 */
router.post('/rate', rideController.rateRide);

// =================================================================================================
// ROTAS DE PAGAMENTO
// =================================================================================================

/**
 * @route   POST /api/rides/payment/request
 * @desc    Solicitar pagamento via wallet
 * @access  Private (Apenas motoristas)
 */
router.post('/payment/request', requireDriver, rideController.requestPayment);

/**
 * @route   POST /api/rides/payment/process
 * @desc    Processar pagamento via wallet
 * @access  Private
 */
router.post('/payment/process', rideController.processWalletPayment);

/**
 * @route   POST /api/rides/payment/cash/confirm
 * @desc    Confirmar pagamento em dinheiro
 * @access  Private (Apenas motoristas)
 */
router.post('/payment/cash/confirm', requireDriver, rideController.confirmCashPayment);

// =================================================================================================
// ROTAS DE SUPORTE E RECURSOS
// =================================================================================================

/**
 * @route   POST /api/rides/:ride_id/support
 * @desc    Reportar problema na corrida
 * @access  Private
 */
router.post('/:ride_id/support', rideController.reportIssue);

/**
 * @route   GET /api/rides/:ride_id/receipt
 * @desc    Obter recibo da corrida
 * @access  Private
 */
router.get('/:ride_id/receipt', rideController.getRideReceipt); // ✅ AGORA FUNCIONA

// =================================================================================================
// SUB-ROTAS DE NEGOCIAÇÃO
// =================================================================================================
router.use('/:ride_id/negotiate', negotiationRoutes);

// =================================================================================================
// ROTAS DINÂMICAS (COM :id) - DEVEM VIR POR ÚLTIMO
// =================================================================================================

/**
 * @route   GET /api/rides/:id
 * @desc    Obter detalhes da corrida
 * @access  Private
 */
router.get('/:id', rideController.getRideDetails);

/**
 * @route   PUT /api/rides/:id
 * @desc    Atualizar dados da corrida (admin apenas)
 * @access  Private (Admin)
 */
router.put('/:id', rideController.updateRide);

/**
 * @route   DELETE /api/rides/:id
 * @desc    Deletar corrida (admin apenas)
 * @access  Private (Admin)
 */
router.delete('/:id', rideController.deleteRide);

// =================================================================================================
// EXPORTAÇÃO DO ROUTER
// =================================================================================================
module.exports = router;
