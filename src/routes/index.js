/**
 * ARQUIVO: src/routes/index.js
 * DESCRIÇÃO: Agregador Mestre de Rotas.
 */
const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const profileRoutes = require('./profileRoutes');
const rideRoutes = require('./rideRoutes');
const walletRoutes = require('./walletRoutes');
const adminRoutes = require('./adminRoutes');
const chatRoutes = require('./chatRoutes');

// Mapeamento dos módulos
router.use('/auth', authRoutes);
router.use('/profile', profileRoutes);
router.use('/rides', rideRoutes);
router.use('/wallet', walletRoutes);
router.use('/admin', adminRoutes);
router.use('/chat', chatRoutes);

// Rota específica de compatibilidade (se o frontend chamar /api/driver diretamente)
// No entanto, já mapeamos isso dentro de rideRoutes (/api/rides/driver/...)
// Se o frontend chamar /api/driver/performance-stats, precisamos de um redirect ou alias.
// Alias para compatibilidade estrita com a solicitação anterior:
const rideController = require('../controllers/rideController');
const { authenticateToken } = require('../middleware/authMiddleware');
router.get('/driver/performance-stats', authenticateToken, rideController.getDriverPerformance);

module.exports = router;