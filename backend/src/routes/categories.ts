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
const createCategorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  type: z.enum(['expense', 'revenue']),
  parentId: z.string().uuid().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format').optional(),
  icon: z.string().max(50).optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().uuid().nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  icon: z.string().max(50).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

// GET /api/categories
router.get(
  '/',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { type, includeInactive = 'false' } = req.query;

    let whereClause = 'company_id = $1';
    const params: any[] = [req.user!.companyId];

    if (type) {
      whereClause += ' AND type = $2';
      params.push(type);
    }

    if (includeInactive !== 'true') {
      whereClause += ' AND is_active = true';
    }

    const categories = await query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM categories sc WHERE sc.parent_id = c.id) as subcategory_count
       FROM categories c
       WHERE ${whereClause}
       ORDER BY c.sort_order, c.name`,
      params
    );

    // Build hierarchical structure
    const categoryMap = new Map();
    const rootCategories: any[] = [];

    categories.forEach((cat: any) => {
      categoryMap.set(cat.id, { ...cat, children: [] });
    });

    categories.forEach((cat: any) => {
      const category = categoryMap.get(cat.id);
      if (cat.parent_id && categoryMap.has(cat.parent_id)) {
        categoryMap.get(cat.parent_id).children.push(category);
      } else {
        rootCategories.push(category);
      }
    });

    res.json({
      success: true,
      data: rootCategories,
    });
  })
);

// GET /api/categories/flat - Get flat list of categories
router.get(
  '/flat',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { type } = req.query;

    let whereClause = 'company_id = $1 AND is_active = true';
    const params: any[] = [req.user!.companyId];

    if (type) {
      whereClause += ' AND type = $2';
      params.push(type);
    }

    const categories = await query(
      `SELECT id, name, type, color, icon
       FROM categories
       WHERE ${whereClause}
       ORDER BY sort_order, name`,
      params
    );

    res.json({
      success: true,
      data: categories,
    });
  })
);

// GET /api/categories/:id
router.get(
  '/:id',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const category = await queryOne(
      `SELECT c.*, p.name as parent_name
       FROM categories c
       LEFT JOIN categories p ON c.parent_id = p.id
       WHERE c.id = $1 AND c.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!category) {
      throw new NotFoundError('Category');
    }

    // Get usage statistics
    const [expenseCount, revenueCount] = await Promise.all([
      query<{ count: string }>(
        'SELECT COUNT(*) as count FROM expenses WHERE category_id = $1',
        [id]
      ),
      query<{ count: string }>(
        'SELECT COUNT(*) as count FROM revenue WHERE category_id = $1',
        [id]
      ),
    ]);

    res.json({
      success: true,
      data: {
        ...category,
        usageCount: parseInt(expenseCount[0]?.count || '0') + parseInt(revenueCount[0]?.count || '0'),
      },
    });
  })
);

// POST /api/categories
router.post(
  '/',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  validateBody(createCategorySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { name, type, parentId, color, icon } = req.body;

    // Check for duplicate name
    const existing = await queryOne(
      'SELECT id FROM categories WHERE company_id = $1 AND name = $2 AND type = $3',
      [req.user!.companyId, name, type]
    );

    if (existing) {
      throw new AppError(`A ${type} category with this name already exists`, 409);
    }

    // Validate parent category
    if (parentId) {
      const parent = await queryOne(
        'SELECT id, type FROM categories WHERE id = $1 AND company_id = $2',
        [parentId, req.user!.companyId]
      );

      if (!parent) {
        throw new AppError('Parent category not found', 404);
      }

      if ((parent as any).type !== type) {
        throw new AppError('Parent category must be of the same type', 400);
      }
    }

    const categoryId = uuidv4();

    await query(
      `INSERT INTO categories (id, company_id, name, type, parent_id, color, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [categoryId, req.user!.companyId, name, type, parentId || null, color || null, icon || null]
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'create',
      entityType: 'category',
      entityId: categoryId,
      newValues: { name, type, parentId, color, icon },
      ipAddress: req.ip,
    });

    const category = await queryOne('SELECT * FROM categories WHERE id = $1', [categoryId]);

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category,
    });
  })
);

// PUT /api/categories/:id
router.put(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  validateBody(updateCategorySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;

    const currentCategory = await queryOne(
      'SELECT * FROM categories WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!currentCategory) {
      throw new NotFoundError('Category');
    }

    // Check for duplicate name if updating name
    if (updates.name && updates.name !== (currentCategory as any).name) {
      const existing = await queryOne(
        'SELECT id FROM categories WHERE company_id = $1 AND name = $2 AND type = $3 AND id != $4',
        [req.user!.companyId, updates.name, (currentCategory as any).type, id]
      );

      if (existing) {
        throw new AppError('A category with this name already exists', 409);
      }
    }

    // Validate parent category
    if (updates.parentId) {
      if (updates.parentId === id) {
        throw new AppError('Category cannot be its own parent', 400);
      }

      const parent = await queryOne(
        'SELECT id, type FROM categories WHERE id = $1 AND company_id = $2',
        [updates.parentId, req.user!.companyId]
      );

      if (!parent) {
        throw new AppError('Parent category not found', 404);
      }

      if ((parent as any).type !== (currentCategory as any).type) {
        throw new AppError('Parent category must be of the same type', 400);
      }
    }

    const fieldMapping: Record<string, string> = {
      name: 'name',
      parentId: 'parent_id',
      color: 'color',
      icon: 'icon',
      isActive: 'is_active',
      sortOrder: 'sort_order',
    };

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && fieldMapping[key]) {
        fields.push(`${fieldMapping[key]} = $${paramIndex++}`);
        values.push(value);
      }
    }

    if (fields.length > 0) {
      values.push(id);
      await query(
        `UPDATE categories SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'update',
      entityType: 'category',
      entityId: id,
      oldValues: currentCategory,
      newValues: updates,
      ipAddress: req.ip,
    });

    const updatedCategory = await queryOne('SELECT * FROM categories WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: updatedCategory,
    });
  })
);

// DELETE /api/categories/:id
router.delete(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const category = await queryOne(
      'SELECT * FROM categories WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!category) {
      throw new NotFoundError('Category');
    }

    // Check if category is in use
    const [expenseCount, revenueCount] = await Promise.all([
      query<{ count: string }>(
        'SELECT COUNT(*) as count FROM expenses WHERE category_id = $1',
        [id]
      ),
      query<{ count: string }>(
        'SELECT COUNT(*) as count FROM revenue WHERE category_id = $1',
        [id]
      ),
    ]);

    const usageCount = parseInt(expenseCount[0]?.count || '0') + parseInt(revenueCount[0]?.count || '0');

    if (usageCount > 0) {
      // Soft delete by deactivating
      await query(
        'UPDATE categories SET is_active = false WHERE id = $1',
        [id]
      );

      res.json({
        success: true,
        message: 'Category deactivated (still in use by existing records)',
      });
    } else {
      // Hard delete
      await query('DELETE FROM categories WHERE id = $1', [id]);

      res.json({
        success: true,
        message: 'Category deleted successfully',
      });
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'delete',
      entityType: 'category',
      entityId: id,
      oldValues: category,
      ipAddress: req.ip,
    });
  })
);

export default router;
