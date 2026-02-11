/**
 * =================================================================================================
 * 🚦 AOTRAVEL SERVER PRO - MAIN ROUTER HUB (TITANIUM EDITION)
 * =================================================================================================
 *
 * ARQUIVO: src/routes/index.js
 * DESCRIÇÃO: Agregador Mestre de Rotas.
 *            Centraliza todos os módulos de rota da aplicação em um único ponto de entrada.
 *            Define prefixos de API e gerencia rotas de compatibilidade (Legacy).
 *
 * ESTRUTURA DE ROTAS:
 * /api/auth    -> Autenticação e Sessão
 * /api/profile -> Perfil, Configurações e KYC
 * /api/rides   -> Ciclo de vida das Corridas
 * /api/wallet  -> Transações Financeiras
 * /api/admin   -> Painel Administrativo
 * /api/chat    -> Mensagens e Comunicação
 *
 * VERSÃO: 11.0.0-GOLD-ARMORED
 * DATA: 2026.02.11
 *
 * STATUS: PRODUCTION READY - FULL VERSION
 * =================================================================================================
 */

const express = require('express');
const router = express.Router();

// Importação dos Módulos de Rota
const authRoutes = require('./authRoutes');
const profileRoutes = require('./profileRoutes');
const rideRoutes = require('./rideRoutes');
const walletRoutes = require('./walletRoutes');
const adminRoutes = require('./adminRoutes');
const chatRoutes = require('./chatRoutes');

// =================================================================================================
// 1. MAPEAMENTO DE MÓDULOS
// =================================================================================================

router.use('/auth', authRoutes);
router.use('/profile', profileRoutes);
router.use('/rides', rideRoutes);
router.use('/wallet', walletRoutes);
router.use('/admin', adminRoutes);
router.use('/chat', chatRoutes);

// =================================================================================================
// 2. ROTAS DE COMPATIBILIDADE E ALIASES
// =================================================================================================
/*
 * Alguns frontends legados ou versões antigas do App podem chamar endpoints
 * que foram movidos ou renomeados. Aqui criamos redirecionamentos internos
 * ou aliases para garantir que nada quebre em produção.
 */

// Alias: Dashboard do Motorista
// O frontend pode tentar chamar /api/driver/performance-stats diretamente
// Redirecionamos a lógica para o controller de rides sem precisar de 301 Redirect
const rideController = require('../controllers/rideController');
const { authenticateToken, requireDriver } = require('../middleware/authMiddleware');

router.get('/driver/performance-stats', authenticateToken, requireDriver, rideController.getDriverPerformance);

// =================================================================================================
// 3. HEALTH CHECK DA API (ROOT OF API)
// =================================================================================================
router.get('/', (req, res) => {
    res.json({
        status: 'online',
        system: 'AOtravel API Gateway',
        version: '11.0.0-GOLD-ARMORED',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
