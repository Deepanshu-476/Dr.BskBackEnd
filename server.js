const app = require("./app");
const dotenv = require("dotenv");

dotenv.config();

const PORT = process.env.PORT || 4000;

// Start server
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Server is running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`📁 Uploads folder: ${__dirname}/uploads`); 
  console.log(`🌐 CORS enabled for http://localhost:3000\n`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.log('❌ UNHANDLED REJECTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log('❌ UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  process.exit(1);
});