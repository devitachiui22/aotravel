const express = require('express');
const router = express.Router();
const controller = require('../controllers/profileController');
const { authenticateToken } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

router.get('/', authenticateToken, controller.getProfile);
router.put('/', authenticateToken, controller.updateProfile);
router.post('/photo', authenticateToken, upload.single('photo'), controller.uploadPhoto);
router.post('/documents', authenticateToken, upload.fields([
    { name: 'bi_front', maxCount: 1 }, { name: 'bi_back', maxCount: 1 },
    { name: 'driving_license_front', maxCount: 1 }, { name: 'driving_license_back', maxCount: 1 }
]), controller.uploadDocuments);
router.put('/settings', authenticateToken, controller.updateSettings);
router.post('/change-password', authenticateToken, controller.changePassword);

module.exports = router;