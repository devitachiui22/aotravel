const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { authenticateToken } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');

router.get('/', authenticateToken, profileController.getProfile);
router.put('/', authenticateToken, profileController.updateProfile);
router.put('/settings', authenticateToken, profileController.updateSettings);
router.post('/change-password', authenticateToken, profileController.changePassword);

// Uploads
router.post('/photo', authenticateToken, upload.single('photo'), profileController.uploadPhoto);
router.post('/documents', authenticateToken, upload.fields([
    { name: 'bi_front', maxCount: 1 },
    { name: 'bi_back', maxCount: 1 },
    { name: 'driving_license_front', maxCount: 1 },
    { name: 'driving_license_back', maxCount: 1 }
]), profileController.uploadDocuments);

module.exports = router;