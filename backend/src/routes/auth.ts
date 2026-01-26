import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne, transaction } from '../config/database';
import { generateToken, authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { ActivityLogger } from '../services/activityLogger';
import { User } from '../types';

const router = Router();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  companyName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// POST /api/auth/register
router.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password, firstName, lastName, companyName } = req.body;

    // Check if user already exists
    const existingUser = await queryOne<User>(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser) {
      throw new AppError('User with this email already exists', 409);
    }

    const result = await transaction(async (client) => {
      // Create company if name provided
      let companyId: string | null = null;
      if (companyName) {
        companyId = uuidv4();
        await client.query(
          `INSERT INTO companies (id, name, currency, fiscal_year_start)
           VALUES ($1, $2, 'USD', 1)`,
          [companyId, companyName]
        );
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create user
      const userId = uuidv4();
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [userId, email.toLowerCase(), passwordHash, firstName, lastName, companyName ? 'admin' : 'employee', companyId]
      );

      // If company was created, add default categories
      if (companyId) {
        const expenseCategories = [
          'Office Supplies', 'Travel', 'Marketing', 'Utilities',
          'Software & Subscriptions', 'Meals & Entertainment',
          'Professional Services', 'Rent', 'Insurance', 'Equipment', 'Payroll', 'Other'
        ];

        const revenueCategories = [
          'Product Sales', 'Services', 'Consulting', 'Subscriptions', 'Licensing', 'Other Income'
        ];

        for (const name of expenseCategories) {
          await client.query(
            `INSERT INTO categories (id, company_id, name, type) VALUES ($1, $2, $3, 'expense')`,
            [uuidv4(), companyId, name]
          );
        }

        for (const name of revenueCategories) {
          await client.query(
            `INSERT INTO categories (id, company_id, name, type) VALUES ($1, $2, $3, 'revenue')`,
            [uuidv4(), companyId, name]
          );
        }

        // Create default inventory location
        await client.query(
          `INSERT INTO inventory_locations (id, company_id, name, is_default)
           VALUES ($1, $2, 'Main Warehouse', true)`,
          [uuidv4(), companyId]
        );
      }

      return { userId, companyId };
    });

    // Generate token
    const token = generateToken({
      userId: result.userId,
      email: email.toLowerCase(),
      role: companyName ? 'admin' : 'employee',
      companyId: result.companyId,
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        user: {
          id: result.userId,
          email: email.toLowerCase(),
          firstName,
          lastName,
          role: companyName ? 'admin' : 'employee',
          companyId: result.companyId,
        },
      },
    });
  })
);

// POST /api/auth/login
router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    // Find user
    const user = await queryOne<User>(
      `SELECT id, email, password_hash, first_name, last_name, role, company_id, is_active
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    if (!user.is_active) {
      throw new AppError('Account is deactivated', 401);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      throw new AppError('Invalid email or password', 401);
    }

    // Update last login
    await query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Log activity
    if (user.company_id) {
      await ActivityLogger.log({
        userId: user.id,
        companyId: user.company_id,
        action: 'login',
        entityType: 'user',
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          companyId: user.company_id,
        },
      },
    });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const user = await queryOne(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.company_id,
              u.created_at, u.last_login, c.name as company_name
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`,
      [req.user!.id]
    );

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Get companies user has access to
    const companies = await query(
      `SELECT c.id, c.name, uca.role
       FROM user_company_access uca
       JOIN companies c ON uca.company_id = c.id
       WHERE uca.user_id = $1
       UNION
       SELECT c.id, c.name, u.role
       FROM companies c
       JOIN users u ON u.company_id = c.id
       WHERE u.id = $1`,
      [req.user!.id]
    );

    res.json({
      success: true,
      data: {
        ...user,
        companies,
      },
    });
  })
);

// POST /api/auth/change-password
router.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body;

    const user = await queryOne<User>(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user!.id]
    );

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      throw new AppError('Current password is incorrect', 401);
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, req.user!.id]
    );

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  })
);

// POST /api/auth/logout
router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.companyId) {
      await ActivityLogger.log({
        userId: req.user.id,
        companyId: req.user.companyId,
        action: 'logout',
        entityType: 'user',
        entityId: req.user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  })
);

// POST /api/auth/switch-company
router.post(
  '/switch-company',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { companyId } = req.body;

    // Check if user has access to this company
    const access = await queryOne(
      `SELECT uca.role
       FROM user_company_access uca
       WHERE uca.user_id = $1 AND uca.company_id = $2
       UNION
       SELECT u.role
       FROM users u
       WHERE u.id = $1 AND u.company_id = $2`,
      [req.user!.id, companyId]
    );

    if (!access) {
      throw new AppError('You do not have access to this company', 403);
    }

    // Generate new token with different company
    const token = generateToken({
      userId: req.user!.id,
      email: req.user!.email,
      role: (access as any).role,
      companyId,
    });

    res.json({
      success: true,
      data: { token },
    });
  })
);

export default router;
