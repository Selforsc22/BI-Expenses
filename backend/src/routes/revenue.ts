import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne } from '../config/database';
import { authenticate, AuthenticatedRequest, requireCompany } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler';
import { ActivityLogger } from '../services/activityLogger';

const router = Router();

// Validation schemas
const createRevenueSchema = z.object({
  categoryId: z.string().uuid().optional(),
  customerName: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  amount: z.number().positive('Amount must be positive'),
  taxAmount: z.number().min(0).default(0),
  revenueDate: z.string().transform(s => new Date(s)),
  paymentMethod: z.string().optional(),
  paymentReference: z.string().optional(),
  isRecurring: z.boolean().default(false),
  recurrenceInterval: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  invoiceId: z.string().uuid().optional(),
});

const updateRevenueSchema = createRevenueSchema.partial();

// GET /api/revenue
router.get(
  '/',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      page = 1,
      limit = 20,
      categoryId,
      customerName,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      search,
      sortBy = 'revenue_date',
      sortOrder = 'desc',
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    let whereClause = 'r.company_id = $1';
    const params: any[] = [req.user!.companyId];
    let paramIndex = 2;

    if (categoryId) {
      whereClause += ` AND r.category_id = $${paramIndex++}`;
      params.push(categoryId);
    }

    if (customerName) {
      whereClause += ` AND r.customer_name ILIKE $${paramIndex++}`;
      params.push(`%${customerName}%`);
    }

    if (startDate) {
      whereClause += ` AND r.revenue_date >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND r.revenue_date <= $${paramIndex++}`;
      params.push(endDate);
    }

    if (minAmount) {
      whereClause += ` AND r.amount >= $${paramIndex++}`;
      params.push(Number(minAmount));
    }

    if (maxAmount) {
      whereClause += ` AND r.amount <= $${paramIndex++}`;
      params.push(Number(maxAmount));
    }

    if (search) {
      whereClause += ` AND (r.description ILIKE $${paramIndex} OR r.customer_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const validSortFields = ['revenue_date', 'amount', 'customer_name', 'created_at'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'revenue_date';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [revenues, countResult] = await Promise.all([
      query(
        `SELECT r.*, c.name as category_name, c.color as category_color
         FROM revenue r
         LEFT JOIN categories c ON r.category_id = c.id
         WHERE ${whereClause}
         ORDER BY r.${sortField} ${order}
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, Number(limit), offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM revenue r WHERE ${whereClause}`,
        params
      ),
    ]);

    const total = parseInt(countResult[0]?.count || '0');

    // Calculate totals
    const totals = await query<{ total: string; tax_total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total, COALESCE(SUM(tax_amount), 0) as tax_total
       FROM revenue r WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: revenues,
      summary: {
        total: parseFloat(totals[0]?.total || '0'),
        taxTotal: parseFloat(totals[0]?.tax_total || '0'),
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  })
);

// GET /api/revenue/categories - Revenue summary by category
router.get(
  '/categories',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate } = req.query;

    let whereClause = 'r.company_id = $1';
    const params: any[] = [req.user!.companyId];

    if (startDate) {
      whereClause += ' AND r.revenue_date >= $2';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND r.revenue_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    const categoryRevenue = await query(
      `SELECT c.id, c.name, c.color, COUNT(r.id) as count, COALESCE(SUM(r.amount), 0) as total
       FROM categories c
       LEFT JOIN revenue r ON c.id = r.category_id AND ${whereClause}
       WHERE c.company_id = $1 AND c.type = 'revenue' AND c.is_active = true
       GROUP BY c.id, c.name, c.color
       ORDER BY total DESC`,
      params
    );

    res.json({
      success: true,
      data: categoryRevenue,
    });
  })
);

// GET /api/revenue/:id
router.get(
  '/:id',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const revenue = await queryOne(
      `SELECT r.*, c.name as category_name, c.color as category_color
       FROM revenue r
       LEFT JOIN categories c ON r.category_id = c.id
       WHERE r.id = $1 AND r.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!revenue) {
      throw new NotFoundError('Revenue record');
    }

    res.json({
      success: true,
      data: revenue,
    });
  })
);

// POST /api/revenue
router.post(
  '/',
  authenticate,
  requireCompany,
  validateBody(createRevenueSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;

    const revenueId = uuidv4();

    await query(
      `INSERT INTO revenue (
        id, company_id, category_id, customer_name, description, amount, tax_amount,
        revenue_date, payment_method, payment_reference, is_recurring, recurrence_interval,
        tags, notes, invoice_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        revenueId,
        req.user!.companyId,
        data.categoryId || null,
        data.customerName || null,
        data.description,
        data.amount,
        data.taxAmount,
        data.revenueDate,
        data.paymentMethod || null,
        data.paymentReference || null,
        data.isRecurring,
        data.recurrenceInterval || null,
        data.tags || [],
        data.notes || null,
        data.invoiceId || null,
        req.user!.id,
      ]
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'create',
      entityType: 'revenue',
      entityId: revenueId,
      newValues: data,
      ipAddress: req.ip,
    });

    const revenue = await queryOne(
      `SELECT r.*, c.name as category_name
       FROM revenue r
       LEFT JOIN categories c ON r.category_id = c.id
       WHERE r.id = $1`,
      [revenueId]
    );

    res.status(201).json({
      success: true,
      message: 'Revenue recorded successfully',
      data: revenue,
    });
  })
);

// PUT /api/revenue/:id
router.put(
  '/:id',
  authenticate,
  requireCompany,
  validateBody(updateRevenueSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;

    const currentRevenue = await queryOne(
      'SELECT * FROM revenue WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!currentRevenue) {
      throw new NotFoundError('Revenue record');
    }

    const fieldMapping: Record<string, string> = {
      categoryId: 'category_id',
      customerName: 'customer_name',
      description: 'description',
      amount: 'amount',
      taxAmount: 'tax_amount',
      revenueDate: 'revenue_date',
      paymentMethod: 'payment_method',
      paymentReference: 'payment_reference',
      isRecurring: 'is_recurring',
      recurrenceInterval: 'recurrence_interval',
      tags: 'tags',
      notes: 'notes',
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
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await query(
        `UPDATE revenue SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'update',
      entityType: 'revenue',
      entityId: id,
      oldValues: currentRevenue,
      newValues: updates,
      ipAddress: req.ip,
    });

    const updatedRevenue = await queryOne(
      `SELECT r.*, c.name as category_name
       FROM revenue r
       LEFT JOIN categories c ON r.category_id = c.id
       WHERE r.id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: 'Revenue updated successfully',
      data: updatedRevenue,
    });
  })
);

// DELETE /api/revenue/:id
router.delete(
  '/:id',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const revenue = await queryOne(
      'SELECT * FROM revenue WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!revenue) {
      throw new NotFoundError('Revenue record');
    }

    await query('DELETE FROM revenue WHERE id = $1', [id]);

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'delete',
      entityType: 'revenue',
      entityId: id,
      oldValues: revenue,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Revenue deleted successfully',
    });
  })
);

export default router;
