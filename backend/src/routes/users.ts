import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne } from '../config/database';
import { authenticate, authorize, AuthenticatedRequest, requireCompany } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler';
import { ActivityLogger } from '../services/activityLogger';

const router = Router();

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z.enum(['admin', 'manager', 'accountant', 'employee']),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(['admin', 'manager', 'accountant', 'employee']).optional(),
  isActive: z.boolean().optional(),
});

// GET /api/users - List users in company
router.get(
  '/',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page = 1, limit = 20, search, role, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'company_id = $1';
    const params: any[] = [req.user!.companyId];
    let paramIndex = 2;

    if (search) {
      whereClause += ` AND (email ILIKE $${paramIndex} OR first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (role) {
      whereClause += ` AND role = $${paramIndex++}`;
      params.push(role);
    }

    if (status === 'active') {
      whereClause += ' AND is_active = true';
    } else if (status === 'inactive') {
      whereClause += ' AND is_active = false';
    }

    const [users, countResult] = await Promise.all([
      query(
        `SELECT id, email, first_name, last_name, role, is_active, created_at, last_login
         FROM users
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, Number(limit), offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM users WHERE ${whereClause}`,
        params
      ),
    ]);

    const total = parseInt(countResult[0]?.count || '0');

    res.json({
      success: true,
      data: users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  })
);

// GET /api/users/:id
router.get(
  '/:id',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    // Users can view their own profile, admins/managers can view anyone
    if (id !== req.user!.id && !['admin', 'manager'].includes(req.user!.role)) {
      throw new AppError('Forbidden', 403);
    }

    const user = await queryOne(
      `SELECT id, email, first_name, last_name, role, is_active, created_at, last_login
       FROM users
       WHERE id = $1 AND company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!user) {
      throw new NotFoundError('User');
    }

    res.json({
      success: true,
      data: user,
    });
  })
);

// POST /api/users - Create new user
router.post(
  '/',
  authenticate,
  requireCompany,
  authorize('admin'),
  validateBody(createUserSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { email, password, firstName, lastName, role } = req.body;

    // Check if user already exists
    const existingUser = await queryOne(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser) {
      throw new AppError('User with this email already exists', 409);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const userId = uuidv4();
    await query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [userId, email.toLowerCase(), passwordHash, firstName, lastName, role, req.user!.companyId]
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'create',
      entityType: 'user',
      entityId: userId,
      newValues: { email, firstName, lastName, role },
      ipAddress: req.ip,
    });

    const user = await queryOne(
      `SELECT id, email, first_name, last_name, role, is_active, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: user,
    });
  })
);

// PUT /api/users/:id
router.put(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin'),
  validateBody(updateUserSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;

    // Get current user data
    const currentUser = await queryOne(
      `SELECT id, first_name, last_name, role, is_active
       FROM users WHERE id = $1 AND company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!currentUser) {
      throw new NotFoundError('User');
    }

    // Prevent admins from demoting themselves
    if (id === req.user!.id && updates.role && updates.role !== 'admin') {
      throw new AppError('Cannot change your own admin role', 400);
    }

    // Build update query
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.firstName !== undefined) {
      fields.push(`first_name = $${paramIndex++}`);
      values.push(updates.firstName);
    }
    if (updates.lastName !== undefined) {
      fields.push(`last_name = $${paramIndex++}`);
      values.push(updates.lastName);
    }
    if (updates.role !== undefined) {
      fields.push(`role = $${paramIndex++}`);
      values.push(updates.role);
    }
    if (updates.isActive !== undefined) {
      fields.push(`is_active = $${paramIndex++}`);
      values.push(updates.isActive);
    }

    if (fields.length === 0) {
      throw new AppError('No valid fields to update', 400);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'update',
      entityType: 'user',
      entityId: id,
      oldValues: currentUser,
      newValues: updates,
      ipAddress: req.ip,
    });

    const updatedUser = await queryOne(
      `SELECT id, email, first_name, last_name, role, is_active, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser,
    });
  })
);

// DELETE /api/users/:id
router.delete(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    if (id === req.user!.id) {
      throw new AppError('Cannot delete your own account', 400);
    }

    const user = await queryOne(
      'SELECT id, email, first_name, last_name FROM users WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!user) {
      throw new NotFoundError('User');
    }

    // Soft delete by deactivating
    await query(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'delete',
      entityType: 'user',
      entityId: id,
      oldValues: user,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'User deactivated successfully',
    });
  })
);

export default router;
