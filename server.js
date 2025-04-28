const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http'); // Import Node's HTTP module
const { Server } = require('socket.io'); // Import Socket.IO server

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Middleware for parsing JSON requests
app.use(express.json());

// CORS configuration
app.use(
  cors({
    origin: [
      'http://localhost:3000', // Localhost shorthand
      'http://127.0.0.1:5500', // Exact IP used by Live Server
      process.env.FRONTEND_URL, // Deployed frontend
    ],
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'], // Allowed methods
    allowedHeaders: ['Content-Type', 'Authorization', 'login', 'ts'], // Make sure custom headers are allowed
    credentials: true, // Allow credentials if needed
  })
);

//
// Global Authentication Middleware – enforce required headers for every request
//

// List of paths where we do not enforce the auth middleware
const authExceptionPaths = ['/api/get-public-token'];
// Require our custom authentication middleware on every request except the exceptions.
app.use((req, res, next) => {
  if (authExceptionPaths.includes(req.path)) {
    return next();
  }
  // Dynamically require the middleware to ensure it's loaded before every route.
  const authenticateRequest = require('./middleware/authMiddleware');
  return authenticateRequest(req, res, next);
});

//
// Route definitions (public and protected)
//

// Public Authentication Routes – these endpoints *must* now be called with the required headers
const {
  signup,
  login,
  requestOTPForPasswordReset,
  resetPasswordWithOTP,
  verifyEmailWithOTP,
  superuserLogin,
  resendOTP,
} = require('./auth/auth');

app.post('/signup', signup);
app.post('/login', login);
app.post('/superuser-login', superuserLogin);
app.post('/request-password-reset-otp', requestOTPForPasswordReset);
app.post('/reset-password-with-otp', resetPasswordWithOTP);
app.post('/verify-email-with-otp', verifyEmailWithOTP);
app.post('/resend-otp', resendOTP);

// Other routes (their requests will be validated globally by the middleware)
const productRoutes = require('./auth/product');
const categoryRoutes = require('./auth/category');
const orderRoutes = require('./auth/order');
const reviewRoutes = require('./auth/review');
const infoRouter = require('./auth/info');
const typeRoutes = require('./auth/type');
const cartRoutes = require('./auth/cart');
const posterRoutes = require('./auth/poster');
const typeComboRoutes = require('./auth/typecombo');
const messageRoutes = require('./auth/message');
const ReportRoutes = require('./auth/Report');
const contactRoutes = require('./auth/feedback');
const blockedIpsRouter = require('./middleware/blockedIps');

app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);

// Example of a public route – If desired, you can exclude this one from authentication, but here it is
app.use('/api/info', infoRouter);

// Protected routes
app.use('/api/type', typeRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/posters', posterRoutes);
app.use('/api/type-combo', typeComboRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/report', ReportRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/admin', blockedIpsRouter);

//
// Socket.IO Setup
//

// Create an HTTP server from the Express app
const server = http.createServer(app);

// Initialize Socket.IO on the HTTP server with the same CORS configuration
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:5500',
      process.env.FRONTEND_URL,
    ],
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'login', 'ts'],
    credentials: true,
  },
});

// Attach the Socket.IO instance so that it can be accessed in your routes, if needed
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`New socket connected: ${socket.id}`);

  // Listen for room join requests
  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room: ${room}`);
  });

  // Optionally, listen for room leave requests
  socket.on('leaveRoom', (room) => {
    socket.leave(room);
    console.log(`Socket ${socket.id} left room: ${room}`);
  });

  // Handle disconnections
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Start the HTTP server instead of app.listen
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  const renderUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`🚀 Server is running at: ${renderUrl}`);
});
