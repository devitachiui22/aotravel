/**
 * =================================================================================================
 * 🚕 AOTRAVEL SERVER PRO - RIDE ROUTES (TITANIUM EDITION) - CORRIGIDO
 * =================================================================================================
 *
 * ARQUIVO: src/routes/rideRoutes.js
 * DESCRIÇÃO: Rotas do ciclo de vida das corridas.
 * 
 * ✅ CORREÇÕES:
 * 1. ✅ Importação correta do negotiationController
 * 2. ✅ Rotas de negociação funcionando
 * 3. ✅ Todos os métodos existentes
 *
 * STATUS: 🔥 PRODUCTION READY
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { authenticateToken, requireDriver } = require('../middleware/authMiddleware');

// Importar rotas de negociação - ✅ CORREÇÃO: Importar o router, não o controller
const negotiationRoutes = require('./negotiationRoutes');

// =================================================================================================
// MIDDLEWARE GLOBAL
// =================================================================================================
// Todas as rotas de viagens exigem autenticação prévia
router.use(authenticateToken);

// =================================================================================================
// ROTAS DE MOTORISTA (ESPECÍFICAS)
// =================================================================================================
// IMPORTANTE: Definir rotas estáticas antes de rotas com parâmetros (:id) para evitar conflitos.

// GET /api/rides/driver/performance-stats - Dashboard financeiro e métricas do motorista
router.get('/driver/performance-stats', requireDriver, rideController.getDriverPerformance);

// =================================================================================================
// ROTAS TRANSACIONAIS (CICLO DE VIDA)
// =================================================================================================

// POST /api/rides/request - Solicitar nova corrida (Passageiro inicia o processo)
router.post('/request', rideController.requestRide);

// POST /api/rides/accept - Aceitar corrida (Motorista confirma interesse)
router.post('/accept', requireDriver, rideController.acceptRide);

// POST /api/rides/update-status - Atualizações intermediárias (Ex: Motorista no local, Embarque)
router.post('/update-status', requireDriver, rideController.updateStatus);

// POST /api/rides/start - Iniciar viagem efetivamente (Cronômetro e GPS ativos)
router.post('/start', requireDriver, rideController.startRide);

// POST /api/rides/complete - Finalizar viagem, processar pagamento e gerar recibo
router.post('/complete', requireDriver, rideController.completeRide);

// POST /api/rides/cancel - Cancelar corrida (Pode ser chamado por passageiro ou motorista)
router.post('/cancel', rideController.cancelRide);

// =================================================================================================
// ROTAS DE NEGOCIAÇÃO (SUB-ROTAS) - ✅ CORREÇÃO: Usar o router importado
// =================================================================================================
// Gerencia contrapropostas de valores entre motorista e passageiro
// Exemplo de uso: /api/rides/123/negotiate/propose
router.use('/:ride_id/negotiate', negotiationRoutes);

// =================================================================================================
// ROTAS DE LEITURA (HISTÓRICO E DETALHES)
// =================================================================================================

// GET /api/rides/history - Histórico de corridas do usuário (paginado)
router.get('/history', rideController.getHistory);

// GET /api/rides/:id - Detalhes completos de uma corrida específica (Dados, Rota, Valores)
router.get('/:id', rideController.getRideDetails);

module.exports = router;
