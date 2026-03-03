const express = require('express');
const router = express.Router();
const hubController = require('../controllers/hubController');
const { authenticateToken, requireDriver } = require('../middleware/authMiddleware');

// =================================================================================================
// 🔐 TODAS AS ROTAS DO HUB REQUEREM AUTENTICAÇÃO
// =================================================================================================
router.use(authenticateToken);

// =================================================================================================
// 📅 MÓDULO DE AGENDAMENTO (SCHEDULES)
// =================================================================================================

// Criar um novo agendamento (passageiro)
router.post('/schedules', hubController.createSchedule);

// Listar agendamentos (role-based: passageiro vê seus, motorista vê pendentes + seus)
router.get('/schedules', hubController.getSchedules);

// Aceitar um agendamento (apenas motoristas)
router.post('/schedules/:scheduleId/accept', requireDriver, hubController.acceptSchedule);

// Cancelar um agendamento (passageiro ou motorista)
router.post('/schedules/:scheduleId/cancel', hubController.cancelSchedule);

// =================================================================================================
// 👥 MÓDULO DE VIAGEM EM GRUPO (GROUP RIDES)
// =================================================================================================

// Criar uma nova viagem em grupo (passageiro)
router.post('/groups', hubController.createGroupRide);

// Listar grupos disponíveis (role-based)
router.get('/groups', hubController.getGroups);

// Entrar em um grupo (passageiro)
router.post('/groups/:groupId/join', hubController.joinGroupRide);

// Sair de um grupo (passageiro)
router.post('/groups/:groupId/leave', hubController.leaveGroup);

// Aceitar levar um grupo lotado (apenas motoristas)
router.post('/groups/:groupId/accept', requireDriver, hubController.acceptGroup);

// =================================================================================================
// 📦 MÓDULO DE ENTREGAS (DELIVERIES)
// =================================================================================================

// Criar uma nova entrega (passageiro)
router.post('/deliveries', hubController.createDelivery);

// Listar entregas (role-based)
router.get('/deliveries', hubController.getDeliveries);

// Aceitar uma entrega (apenas motoristas)
router.post('/deliveries/:deliveryId/accept', requireDriver, hubController.acceptDelivery);

// Atualizar status da entrega com localização (apenas motoristas)
router.post('/deliveries/:deliveryId/status', requireDriver, hubController.updateDeliveryStatus);

// Cancelar uma entrega (remetente ou motorista)
router.post('/deliveries/:deliveryId/cancel', hubController.cancelDelivery);

// Obter histórico de rastreio de uma entrega
router.get('/deliveries/:deliveryId/tracking', hubController.getDeliveryTracking);

module.exports = router;
