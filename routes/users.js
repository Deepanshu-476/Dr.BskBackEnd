const express = require("express");
const router = express.Router();
const productController = require("../controllers/productControllers");
const categoryController = require("../controllers/categoryControllers");
const SubCategoryController = require("../controllers/subCategoryControllers");
const newarrivalController = require("../controllers/newarrivalControllers");
const bannerController = require("../controllers/bannerController");
const wholeSaleController = require("../controllers/wholeSaleController");
const prescriptionController = require("../controllers/prescriptionController");

const tokenRequired = require("../middlewares/authMiddlewares");
const upload = require("../middlewares/uploadMiddleware");

router.post('/createProduct', productController.upload.array('media', 10), productController.createProduct);
router.get("/products/xml", productController.getAllProductsXML);
router.get("/allproducts", productController.getAllProducts);
router.get("/product/:id", productController.getProductById);
router.put("/updateProduct/:id",productController.upload.array('media', 10), productController.updateProduct);
router.delete("/deleteProduct/:id", productController.deleteProduct);
router.get("/search", productController.searchProducts);
router.get("/totalProductcount", productController.getProductCount);

router.post("/createnewArrival", newarrivalController.createNewArrivalProduct);
router.get("/allnewarrivalproducts", newarrivalController.getAllNewArrivalProducts);
router.get("/newarrivalproduct/:id", newarrivalController.getNewArrivalProductById);
router.put("/updatenewArrivalProduct/:id", tokenRequired, newarrivalController.updateNewArrivalProduct);
router.delete("/deletenewArrivalProduct/:id", tokenRequired, newarrivalController.deleteNewArrivalProduct);

router.post("/createWholesalePartner", wholeSaleController.createWholesalePartner);
router.get("/allWholesalePartners", wholeSaleController.getAllWholesalePartners);
router.get("/WholesalePartner/:id", wholeSaleController.getWholesalePartnerById);
router.put("/updateWholesalePartner/:id", wholeSaleController.updateWholesalePartner);
router.delete("/deleteWholesalePartner/:id", tokenRequired, wholeSaleController.deleteWholesalePartner);

// router.post("/createCategory",upload.single("image"), categoryController.createCategory);
router.post("/createCategory", upload.single("image"), categoryController.createCategory);

router.get("/allcategories", categoryController.getAllCategories);
router.get("/category/:id", categoryController.getCategoryById);
router.put("/updateCategory/:id", upload.single("image"), categoryController.updateCategory);
router.delete("/deleteCategory/:id", categoryController.deleteCategory);

// router.post("/createSubCategory", SubCategoryController.createSubCategory);
// GET all subcategories
router.get('/allSubcategories', SubCategoryController.getAllSubCategories);

// GET single subcategory
router.get('/subcategory/:id', SubCategoryController.getSubCategoryById);

// CREATE SubCategory with image upload
router.post('/createSubCategory', (req, res, next) => {
    console.log('\n📥 [BACKEND] POST /createSubCategory');
    console.log('Headers:', req.headers['content-type']);
    next();
}, upload.single('image'), SubCategoryController.createSubCategory);

// UPDATE subcategory with image upload
router.put('/updateSubCategory/:id', (req, res, next) => {
    console.log('\n📥 [BACKEND] PUT /updateSubCategory/' + req.params.id);
    console.log('Headers:', req.headers['content-type']);
    next();
}, upload.single('image'), SubCategoryController.updateSubCategory);

// DELETE subcategory (soft delete)
router.delete('/deleteSubCategory/:id', SubCategoryController.deleteSubCategory);

router.post("/createPrescription", upload.single("image"), prescriptionController.createPrescription);
router.get("/allPrescriptions", prescriptionController.getPrescriptions);
router.get("/Prescription/:id", prescriptionController.getPrescriptionById);
// router.put("/updateSubCategory/:id", tokenRequired, SubCategoryController.updateSubCategory);
router.put("/updatePrescription/:id", upload.single("image"), prescriptionController.updatePrescription);
router.delete("/deletePrescription/:id", prescriptionController.deletePrescription);

// router.post("/createBanner", bannerController.createBanner);
router.post('/createBanner', upload.single('slider_image'), bannerController.createBanner);
router.get("/allBanners", bannerController.getBanners);
router.get("/dashboardBanner/:id", bannerController.getBannerById);
router.put("/updateBanner/:id", tokenRequired, bannerController.updateBanner);
router.delete("/deleteBanner/:id", bannerController.deleteBanner);

router.get('/images', productController.getAllProductImages);

module.exports = router;


router.get('/readUser/:id', async (req, res) => {
  try {
    const User = require('../models/admin'); // 👈 tumhara "User" actually Admin model hai
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
