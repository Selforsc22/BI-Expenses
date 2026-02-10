import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne } from '../config/database';
import { authenticate, authorize, AuthenticatedRequest, requireCompany } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler';
import { uploadSingle, deleteFile } from '../middleware/upload';
import { ExpenseCategorizor } from '../services/expenseCategorizor';
import { ActivityLogger } from '../services/activityLogger';

const router = Router();

// Validation schemas
const createExpenseSchema = z.object({
  categoryId: z.string().uuid().optional(),
  vendorName: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  amount: z.number().positive('Amount must be positive'),
  taxAmount: z.number().min(0).default(0),
  expenseDate: z.string().transform(s => new Date(s)),
  paymentMethod: z.string().optional(),
  paymentReference: z.string().optional(),
  isRecurring: z.boolean().default(false),
  recurrenceInterval: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  recurrenceEndDate: z.string().optional().transform(s => s ? new Date(s) : undefined),
  isTaxDeductible: z.boolean().default(true),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  invoiceId: z.string().uuid().optional(),
});

const updateExpenseSchema = createExpenseSchema.partial();

// GET /api/expenses
router.get(
  '/',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      page = 1,
      limit = 20,
      categoryId,
      vendorName,
      startDate,
      endDate,
      minAmount,
      maxAmount,
      status,
      search,
      sortBy = 'expense_date',
      sortOrder = 'desc',
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    let whereClause = 'e.company_id = $1';
    const params: any[] = [req.user!.companyId];
    let paramIndex = 2;

    if (categoryId) {
      whereClause += ` AND e.category_id = $${paramIndex++}`;
      params.push(categoryId);
    }

    if (vendorName) {
      whereClause += ` AND e.vendor_name ILIKE $${paramIndex++}`;
      params.push(`%${vendorName}%`);
    }

    if (startDate) {
      whereClause += ` AND e.expense_date >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND e.expense_date <= $${paramIndex++}`;
      params.push(endDate);
    }

    if (minAmount) {
      whereClause += ` AND e.amount >= $${paramIndex++}`;
      params.push(Number(minAmount));
    }

    if (maxAmount) {
      whereClause += ` AND e.amount <= $${paramIndex++}`;
      params.push(Number(maxAmount));
    }

    if (status) {
      whereClause += ` AND e.status = $${paramIndex++}`;
      params.push(status);
    }

    if (search) {
      whereClause += ` AND (e.description ILIKE $${paramIndex} OR e.vendor_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const validSortFields = ['expense_date', 'amount', 'vendor_name', 'created_at'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'expense_date';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [expenses, countResult] = await Promise.all([
      query(
        `SELECT e.*, c.name as category_name, c.color as category_color
         FROM expenses e
         LEFT JOIN categories c ON e.category_id = c.id
         WHERE ${whereClause}
         ORDER BY e.${sortField} ${order}
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, Number(limit), offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM expenses e WHERE ${whereClause}`,
        params
      ),
    ]);

    const total = parseInt(countResult[0]?.count || '0');

    // Calculate totals
    const totals = await query<{ total: string; tax_total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total, COALESCE(SUM(tax_amount), 0) as tax_total
       FROM expenses e WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: expenses,
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

// GET /api/expenses/categories - Expense summary by category
router.get(
  '/categories',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate } = req.query;

    let whereClause = 'e.company_id = $1';
    const params: any[] = [req.user!.companyId];

    if (startDate) {
      whereClause += ' AND e.expense_date >= $2';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND e.expense_date <= $${params.length + 1}`;
      params.push(endDate);
    }

    const categoryExpenses = await query(
      `SELECT c.id, c.name, c.color, COUNT(e.id) as count, COALESCE(SUM(e.amount), 0) as total
       FROM categories c
       LEFT JOIN expenses e ON c.id = e.category_id AND ${whereClause}
       WHERE c.company_id = $1 AND c.type = 'expense' AND c.is_active = true
       GROUP BY c.id, c.name, c.color
       ORDER BY total DESC`,
      params
    );

    res.json({
      success: true,
      data: categoryExpenses,
    });
  })
);

// GET /api/expenses/:id
router.get(
  '/:id',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const expense = await queryOne(
      `SELECT e.*, c.name as category_name, c.color as category_color,
              u.first_name as created_by_first_name, u.last_name as created_by_last_name
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = $1 AND e.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!expense) {
      throw new NotFoundError('Expense');
    }

    res.json({
      success: true,
      data: expense,
    });
  })
);

// POST /api/expenses
router.post(
  '/',
  authenticate,
  requireCompany,
  validateBody(createExpenseSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;

    // Auto-categorize if no category provided
    if (!data.categoryId && (data.vendorName || data.description)) {
      const categorizer = new ExpenseCategorizor(req.user!.companyId!);
      await categorizer.initialize();
      const result = await categorizer.categorize(
        data.vendorName || '',
        data.description,
        data.amount
      );
      if (result.confidence > 0.5) {
        data.categoryId = result.categoryId;
      }
    }

    const expenseId = uuidv4();

    await query(
      `INSERT INTO expenses (
        id, company_id, category_id, vendor_name, description, amount, tax_amount,
        expense_date, payment_method, payment_reference, is_recurring, recurrence_interval,
        recurrence_end_date, is_tax_deductible, tags, notes, invoice_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        expenseId,
        req.user!.companyId,
        data.categoryId || null,
        data.vendorName || null,
        data.description,
        data.amount,
        data.taxAmount,
        data.expenseDate,
        data.paymentMethod || null,
        data.paymentReference || null,
        data.isRecurring,
        data.recurrenceInterval || null,
        data.recurrenceEndDate || null,
        data.isTaxDeductible,
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
      entityType: 'expense',
      entityId: expenseId,
      newValues: data,
      ipAddress: req.ip,
    });

    const expense = await queryOne(
      `SELECT e.*, c.name as category_name
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.id = $1`,
      [expenseId]
    );

    res.status(201).json({
      success: true,
      message: 'Expense created successfully',
      data: expense,
    });
  })
);

// POST /api/expenses/bulk - Bulk create expenses
router.post(
  '/bulk',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { expenses } = req.body;

    if (!Array.isArray(expenses) || expenses.length === 0) {
      throw new AppError('Expenses array is required', 400);
    }

    const categorizer = new ExpenseCategorizor(req.user!.companyId!);
    await categorizer.initialize();

    const created: string[] = [];

    for (const data of expenses) {
      // Auto-categorize
      if (!data.categoryId && (data.vendorName || data.description)) {
        const result = await categorizer.categorize(
          data.vendorName || '',
          data.description,
          data.amount
        );
        if (result.confidence > 0.5) {
          data.categoryId = result.categoryId;
        }
      }

      const expenseId = uuidv4();
      await query(
        `INSERT INTO expenses (
          id, company_id, category_id, vendor_name, description, amount,
          expense_date, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          expenseId,
          req.user!.companyId,
          data.categoryId || null,
          data.vendorName || null,
          data.description,
          data.amount,
          data.expenseDate || new Date(),
          req.user!.id,
        ]
      );
      created.push(expenseId);
    }

    res.status(201).json({
      success: true,
      message: `${created.length} expenses created successfully`,
      data: { createdIds: created },
    });
  })
);

// PUT /api/expenses/:id
router.put(
  '/:id',
  authenticate,
  requireCompany,
  validateBody(updateExpenseSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;

    const currentExpense = await queryOne(
      'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!currentExpense) {
      throw new NotFoundError('Expense');
    }

    const fieldMapping: Record<string, string> = {
      categoryId: 'category_id',
      vendorName: 'vendor_name',
      description: 'description',
      amount: 'amount',
      taxAmount: 'tax_amount',
      expenseDate: 'expense_date',
      paymentMethod: 'payment_method',
      paymentReference: 'payment_reference',
      isRecurring: 'is_recurring',
      recurrenceInterval: 'recurrence_interval',
      recurrenceEndDate: 'recurrence_end_date',
      isTaxDeductible: 'is_tax_deductible',
      tags: 'tags',
      notes: 'notes',
      status: 'status',
    };

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && fieldMapping[key]) {
        fields.push(`${fieldMapping[key]} = $${paramIndex++}`);
        values.push(key === 'tags' ? value : value);
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await query(
        `UPDATE expenses SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'update',
      entityType: 'expense',
      entityId: id,
      oldValues: currentExpense,
      newValues: updates,
      ipAddress: req.ip,
    });

    const updatedExpense = await queryOne(
      `SELECT e.*, c.name as category_name
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: 'Expense updated successfully',
      data: updatedExpense,
    });
  })
);

// DELETE /api/expenses/:id
router.delete(
  '/:id',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const expense = await queryOne(
      'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!expense) {
      throw new NotFoundError('Expense');
    }

    // Check permission - only creator, managers, or admins can delete
    if (
      (expense as any).created_by !== req.user!.id &&
      !['admin', 'manager'].includes(req.user!.role)
    ) {
      throw new AppError('You do not have permission to delete this expense', 403);
    }

    await query('DELETE FROM expenses WHERE id = $1', [id]);

    // Delete receipt if exists
    if ((expense as any).receipt_path) {
      await deleteFile((expense as any).receipt_path);
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'delete',
      entityType: 'expense',
      entityId: id,
      oldValues: expense,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Expense deleted successfully',
    });
  })
);

// POST /api/expenses/:id/receipt - Upload receipt
router.post(
  '/:id/receipt',
  authenticate,
  requireCompany,
  uploadSingle('receipt'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const expense = await queryOne(
      'SELECT id, receipt_path FROM expenses WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!expense) {
      throw new NotFoundError('Expense');
    }

    // Delete old receipt if exists
    if ((expense as any).receipt_path) {
      await deleteFile((expense as any).receipt_path);
    }

    await query(
      'UPDATE expenses SET receipt_path = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [req.file.path, id]
    );

    res.json({
      success: true,
      message: 'Receipt uploaded successfully',
      data: { receiptPath: req.file.path },
    });
  })
);

// POST /api/expenses/:id/approve
router.post(
  '/:id/approve',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const expense = await queryOne(
      'SELECT id, status FROM expenses WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!expense) {
      throw new NotFoundError('Expense');
    }

    await query(
      `UPDATE expenses
       SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [req.user!.id, id]
    );

    res.json({
      success: true,
      message: 'Expense approved successfully',
    });
  })
);

// POST /api/expenses/categorize - Auto-categorize expenses
router.post(
  '/categorize',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { vendorName, description, amount } = req.body;

    const categorizer = new ExpenseCategorizor(req.user!.companyId!);
    await categorizer.initialize();

    const result = await categorizer.categorize(vendorName || '', description || '', amount);

    res.json({
      success: true,
      data: result,
    });
  })
);

// GET /api/expenses/flagged - Get flagged/unusual expenses
router.get(
  '/flagged',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const categorizer = new ExpenseCategorizor(req.user!.companyId!);
    await categorizer.initialize();

    const flagged = await categorizer.flagUnusualExpenses(2);

    // Get expense details
    const expenseIds = flagged.map(f => f.id);
    const expenses = expenseIds.length > 0
      ? await query(
          `SELECT e.*, c.name as category_name
           FROM expenses e
           LEFT JOIN categories c ON e.category_id = c.id
           WHERE e.id = ANY($1)`,
          [expenseIds]
        )
      : [];

    const expenseMap = new Map(expenses.map(e => [(e as any).id, e]));

    const result = flagged.map(f => {
      const expense = expenseMap.get(f.id) || {};
      return {
        ...expense,
        flagReason: f.reason,
        deviation: f.deviation,
      };
    });

    res.json({
      success: true,
      data: result,
    });
  })
);

export default router;
