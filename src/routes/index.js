const express = require('express');
const router = express.Router();

router.use('/auth', require('./authRoutes'));
router.use('/profile', require('./profileRoutes'));
router.use('/rides', require('./rideRoutes'));
router.use('/wallet', require('./walletRoutes'));
router.use('/admin', require('./adminRoutes'));
router.use('/settings', require('./adminRoutes')); // Alias para configurações se necessário
router.use('/chat', require('./chatRoutes'));
router.use('/notifications', require('./notificationRoutes'));

module.exports = router;