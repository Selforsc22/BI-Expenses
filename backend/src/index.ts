import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { config } from './config';
import { testConnection } from './config/database';

// Import routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import companyRoutes from './routes/companies';
import invoiceRoutes from './routes/invoices';
import expenseRoutes from './routes/expenses';
import revenueRoutes from './routes/revenue';
import categoryRoutes from './routes/categories';
import inventoryRoutes from './routes/inventory';
import employeeRoutes from './routes/employees';
import payrollRoutes from './routes/payroll';
import dashboardRoutes from './routes/dashboard';
import reportRoutes from './routes/reports';

// Import middleware
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (config.server.nodeEnv !== 'test') {
  app.use(morgan(config.server.isProduction ? 'combined' : 'dev'));
}

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.server.nodeEnv,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`,
  });
});

// Start server
async function startServer() {
  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('Failed to connect to database. Server will start but database operations will fail.');
  }

  app.listen(config.server.port, () => {
    console.log(`
    ╔═══════════════════════════════════════════════════════╗
    ║                                                       ║
    ║   BusinessHub API Server                              ║
    ║                                                       ║
    ║   Environment: ${config.server.nodeEnv.padEnd(39)}║
    ║   Port: ${String(config.server.port).padEnd(46)}║
    ║   Database: ${dbConnected ? 'Connected' : 'Disconnected'.padEnd(42)}║
    ║                                                       ║
    ║   API Docs: http://localhost:${config.server.port}/api/docs          ║
    ║   Health: http://localhost:${config.server.port}/api/health           ║
    ║                                                       ║
    ╚═══════════════════════════════════════════════════════╝
    `);
  });
}

startServer().catch(console.error);

export default app;
