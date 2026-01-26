import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne } from '../config/database';
import { authenticate, authorize, AuthenticatedRequest, requireCompany } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler';
import { ActivityLogger } from '../services/activityLogger';

const router = Router();

// Validation schemas
const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  taxId: z.string().optional(),
  currency: z.string().length(3).optional(),
  fiscalYearStart: z.number().min(1).max(12).optional(),
});

const inviteUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'manager', 'accountant', 'employee']),
});

// GET /api/companies/current
router.get(
  '/current',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const company = await queryOne(
      `SELECT id, name, address, phone, email, tax_id, currency, fiscal_year_start,
              logo_path, settings, created_at, updated_at
       FROM companies WHERE id = $1`,
      [req.user!.companyId]
    );

    if (!company) {
      throw new NotFoundError('Company');
    }

    // Get stats
    const [userCount, invoiceCount, expenseCount] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*) as count FROM users WHERE company_id = $1', [req.user!.companyId]),
      query<{ count: string }>('SELECT COUNT(*) as count FROM invoices WHERE company_id = $1', [req.user!.companyId]),
      query<{ count: string }>('SELECT COUNT(*) as count FROM expenses WHERE company_id = $1', [req.user!.companyId]),
    ]);

    res.json({
      success: true,
      data: {
        ...company,
        stats: {
          users: parseInt(userCount[0]?.count || '0'),
          invoices: parseInt(invoiceCount[0]?.count || '0'),
          expenses: parseInt(expenseCount[0]?.count || '0'),
        },
      },
    });
  })
);

// PUT /api/companies/current
router.put(
  '/current',
  authenticate,
  requireCompany,
  authorize('admin'),
  validateBody(updateCompanySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const updates = req.body;

    const currentCompany = await queryOne(
      'SELECT * FROM companies WHERE id = $1',
      [req.user!.companyId]
    );

    if (!currentCompany) {
      throw new NotFoundError('Company');
    }

    // Build update query
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const fieldMapping: Record<string, string> = {
      name: 'name',
      address: 'address',
      phone: 'phone',
      email: 'email',
      taxId: 'tax_id',
      currency: 'currency',
      fiscalYearStart: 'fiscal_year_start',
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && fieldMapping[key]) {
        fields.push(`${fieldMapping[key]} = $${paramIndex++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      throw new AppError('No valid fields to update', 400);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.user!.companyId);

    await query(
      `UPDATE companies SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'update',
      entityType: 'company',
      entityId: req.user!.companyId!,
      oldValues: currentCompany,
      newValues: updates,
      ipAddress: req.ip,
    });

    const updatedCompany = await queryOne(
      'SELECT * FROM companies WHERE id = $1',
      [req.user!.companyId]
    );

    res.json({
      success: true,
      message: 'Company updated successfully',
      data: updatedCompany,
    });
  })
);

// POST /api/companies/invite
router.post(
  '/invite',
  authenticate,
  requireCompany,
  authorize('admin'),
  validateBody(inviteUserSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { email, role } = req.body;

    // Check if user exists
    const existingUser = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser) {
      // Check if already has access
      const existingAccess = await queryOne(
        `SELECT id FROM user_company_access
         WHERE user_id = $1 AND company_id = $2`,
        [existingUser.id, req.user!.companyId]
      );

      if (existingAccess) {
        throw new AppError('User already has access to this company', 409);
      }

      // Grant access
      await query(
        `INSERT INTO user_company_access (id, user_id, company_id, role, granted_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), existingUser.id, req.user!.companyId, role, req.user!.id]
      );

      await ActivityLogger.log({
        userId: req.user!.id,
        companyId: req.user!.companyId!,
        action: 'create',
        entityType: 'user',
        entityId: existingUser.id,
        newValues: { email, role, action: 'granted_access' },
        ipAddress: req.ip,
      });

      res.json({
        success: true,
        message: 'User granted access to company',
      });
    } else {
      // TODO: Send invitation email to new user
      // For now, just return an error
      throw new AppError('User not found. Please ask them to register first.', 404);
    }
  })
);

// DELETE /api/companies/access/:userId
router.delete(
  '/access/:userId',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = req.params;

    if (userId === req.user!.id) {
      throw new AppError('Cannot remove your own access', 400);
    }

    const access = await queryOne(
      `SELECT id FROM user_company_access
       WHERE user_id = $1 AND company_id = $2`,
      [userId, req.user!.companyId]
    );

    if (!access) {
      throw new NotFoundError('User access');
    }

    await query(
      'DELETE FROM user_company_access WHERE user_id = $1 AND company_id = $2',
      [userId, req.user!.companyId]
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'delete',
      entityType: 'user',
      entityId: userId,
      oldValues: { action: 'revoked_access' },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'User access revoked',
    });
  })
);

// GET /api/companies/settings
router.get(
  '/settings',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const company = await queryOne<{ settings: Record<string, any> }>(
      'SELECT settings FROM companies WHERE id = $1',
      [req.user!.companyId]
    );

    res.json({
      success: true,
      data: company?.settings || {},
    });
  })
);

// PUT /api/companies/settings
router.put(
  '/settings',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { settings } = req.body;

    await query(
      `UPDATE companies SET settings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(settings), req.user!.companyId]
    );

    res.json({
      success: true,
      message: 'Settings updated successfully',
    });
  })
);

export default router;
