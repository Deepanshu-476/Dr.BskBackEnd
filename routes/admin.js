const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminControllers');

// OTP based routes
router.post('/send-otp', adminController.sendOtp);
router.post('/login-with-otp', adminController.loginWithOtp);

// Old password based routes
router.post('/login', adminController.adminLogin);

// CRUD routes
router.post('/create', adminController.createAdmin);
router.put('/update/:id', adminController.updateAdmin);
router.put('/updateAdmin/:id', adminController.updateAdmin);
router.get('/readAdmin/:id', adminController.readAdmin);
router.delete('/delete/:id', adminController.deleteAdmin);
router.delete('/deleteAdmin/:id', adminController.deleteAdmin);

// ✅ READ ALL ADMINS (ONLY THIS ONE)
router.get('/read-all', adminController.readAllAdmins);

// Custom email sending
router.post('/send-custom-email', adminController.attachmentsUpload, adminController.sendCustomEmail);

// Other routes
router.get('/image/:filename', adminController.getImage);
router.get('/count', adminController.getAdminCount);

module.exports = router;
