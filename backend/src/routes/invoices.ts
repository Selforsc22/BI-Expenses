import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne, transaction } from '../config/database';
import { authenticate, authorize, AuthenticatedRequest, requireCompany } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler';
import { uploadSingle, deleteFile } from '../middleware/upload';
import { InvoiceParser } from '../services/invoiceParser';
import { ActivityLogger } from '../services/activityLogger';

const router = Router();

// Validation schemas
const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1, 'Invoice number is required'),
  invoiceType: z.enum(['vendor', 'customer']),
  vendorName: z.string().optional(),
  customerName: z.string().optional(),
  invoiceDate: z.string().transform(s => new Date(s)),
  dueDate: z.string().optional().transform(s => s ? new Date(s) : undefined),
  subtotal: z.number().min(0),
  taxAmount: z.number().min(0).default(0),
  discountAmount: z.number().min(0).default(0),
  shippingAmount: z.number().min(0).default(0),
  totalAmount: z.number().min(0),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  lineItems: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number().min(0),
    unitPrice: z.number().min(0),
    taxRate: z.number().min(0).default(0),
    total: z.number().min(0),
    inventoryItemId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
  })).optional(),
});

const updateInvoiceSchema = createInvoiceSchema.partial();

// GET /api/invoices
router.get(
  '/',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      page = 1,
      limit = 20,
      type,
      status,
      startDate,
      endDate,
      search,
      sortBy = 'invoice_date',
      sortOrder = 'desc',
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    let whereClause = 'company_id = $1';
    const params: any[] = [req.user!.companyId];
    let paramIndex = 2;

    if (type) {
      whereClause += ` AND invoice_type = $${paramIndex++}`;
      params.push(type);
    }

    if (status) {
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    if (startDate) {
      whereClause += ` AND invoice_date >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND invoice_date <= $${paramIndex++}`;
      params.push(endDate);
    }

    if (search) {
      whereClause += ` AND (invoice_number ILIKE $${paramIndex} OR vendor_name ILIKE $${paramIndex} OR customer_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const validSortFields = ['invoice_date', 'due_date', 'total_amount', 'created_at', 'invoice_number'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'invoice_date';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [invoices, countResult] = await Promise.all([
      query(
        `SELECT id, invoice_number, invoice_type, vendor_name, customer_name,
                invoice_date, due_date, subtotal, tax_amount, total_amount,
                amount_paid, status, created_at
         FROM invoices
         WHERE ${whereClause}
         ORDER BY ${sortField} ${order}
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, Number(limit), offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM invoices WHERE ${whereClause}`,
        params
      ),
    ]);

    const total = parseInt(countResult[0]?.count || '0');

    res.json({
      success: true,
      data: invoices,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  })
);

// GET /api/invoices/:id
router.get(
  '/:id',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const invoice = await queryOne(
      `SELECT * FROM invoices WHERE id = $1 AND company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!invoice) {
      throw new NotFoundError('Invoice');
    }

    // Get line items
    const lineItems = await query(
      `SELECT ili.*, c.name as category_name, ii.name as inventory_item_name
       FROM invoice_line_items ili
       LEFT JOIN categories c ON ili.category_id = c.id
       LEFT JOIN inventory_items ii ON ili.inventory_item_id = ii.id
       WHERE ili.invoice_id = $1
       ORDER BY ili.sort_order`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...invoice,
        lineItems,
      },
    });
  })
);

// POST /api/invoices
router.post(
  '/',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  validateBody(createInvoiceSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;

    // Check for duplicate invoice number
    const existing = await queryOne(
      `SELECT id FROM invoices WHERE company_id = $1 AND invoice_number = $2 AND invoice_type = $3`,
      [req.user!.companyId, data.invoiceNumber, data.invoiceType]
    );

    if (existing) {
      throw new AppError('Invoice with this number already exists', 409);
    }

    const result = await transaction(async (client) => {
      const invoiceId = uuidv4();

      await client.query(
        `INSERT INTO invoices (
          id, company_id, invoice_number, invoice_type, vendor_name, customer_name,
          invoice_date, due_date, subtotal, tax_amount, discount_amount, shipping_amount,
          total_amount, payment_terms, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          invoiceId,
          req.user!.companyId,
          data.invoiceNumber,
          data.invoiceType,
          data.vendorName || null,
          data.customerName || null,
          data.invoiceDate,
          data.dueDate || null,
          data.subtotal,
          data.taxAmount,
          data.discountAmount,
          data.shippingAmount,
          data.totalAmount,
          data.paymentTerms || null,
          data.notes || null,
          req.user!.id,
        ]
      );

      // Create line items
      if (data.lineItems && data.lineItems.length > 0) {
        for (let i = 0; i < data.lineItems.length; i++) {
          const item = data.lineItems[i];
          await client.query(
            `INSERT INTO invoice_line_items (
              id, invoice_id, description, quantity, unit_price, tax_rate,
              tax_amount, total, inventory_item_id, category_id, sort_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              uuidv4(),
              invoiceId,
              item.description,
              item.quantity,
              item.unitPrice,
              item.taxRate || 0,
              (item.quantity * item.unitPrice * (item.taxRate || 0)) / 100,
              item.total,
              item.inventoryItemId || null,
              item.categoryId || null,
              i,
            ]
          );
        }
      }

      return invoiceId;
    });

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'create',
      entityType: 'invoice',
      entityId: result,
      newValues: data,
      ipAddress: req.ip,
    });

    const invoice = await queryOne('SELECT * FROM invoices WHERE id = $1', [result]);

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: invoice,
    });
  })
);

// POST /api/invoices/import - Import from file
router.post(
  '/import',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  uploadSingle('file'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const parseResult = await InvoiceParser.parseFile(req.file.path);

    if (!parseResult.success) {
      await deleteFile(req.file.path);
      throw new AppError(parseResult.errors?.join(', ') || 'Failed to parse invoice', 400);
    }

    res.json({
      success: true,
      message: 'Invoice parsed successfully',
      data: {
        invoice: parseResult.invoice,
        lineItems: parseResult.lineItems,
        confidence: parseResult.confidence,
        filePath: req.file.path,
      },
    });
  })
);

// PUT /api/invoices/:id
router.put(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  validateBody(updateInvoiceSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;

    const currentInvoice = await queryOne(
      'SELECT * FROM invoices WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!currentInvoice) {
      throw new NotFoundError('Invoice');
    }

    const fieldMapping: Record<string, string> = {
      invoiceNumber: 'invoice_number',
      invoiceType: 'invoice_type',
      vendorName: 'vendor_name',
      customerName: 'customer_name',
      invoiceDate: 'invoice_date',
      dueDate: 'due_date',
      subtotal: 'subtotal',
      taxAmount: 'tax_amount',
      discountAmount: 'discount_amount',
      shippingAmount: 'shipping_amount',
      totalAmount: 'total_amount',
      paymentTerms: 'payment_terms',
      notes: 'notes',
      status: 'status',
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
        `UPDATE invoices SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }

    // Update line items if provided
    if (updates.lineItems) {
      await query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [id]);

      for (let i = 0; i < updates.lineItems.length; i++) {
        const item = updates.lineItems[i];
        await query(
          `INSERT INTO invoice_line_items (
            id, invoice_id, description, quantity, unit_price, tax_rate,
            tax_amount, total, inventory_item_id, category_id, sort_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            uuidv4(),
            id,
            item.description,
            item.quantity,
            item.unitPrice,
            item.taxRate || 0,
            (item.quantity * item.unitPrice * (item.taxRate || 0)) / 100,
            item.total,
            item.inventoryItemId || null,
            item.categoryId || null,
            i,
          ]
        );
      }
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'update',
      entityType: 'invoice',
      entityId: id,
      oldValues: currentInvoice,
      newValues: updates,
      ipAddress: req.ip,
    });

    const updatedInvoice = await queryOne('SELECT * FROM invoices WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Invoice updated successfully',
      data: updatedInvoice,
    });
  })
);

// DELETE /api/invoices/:id
router.delete(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const invoice = await queryOne(
      'SELECT * FROM invoices WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!invoice) {
      throw new NotFoundError('Invoice');
    }

    await query('DELETE FROM invoices WHERE id = $1', [id]);

    // Delete associated file if exists
    if ((invoice as any).file_path) {
      await deleteFile((invoice as any).file_path);
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'delete',
      entityType: 'invoice',
      entityId: id,
      oldValues: invoice,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Invoice deleted successfully',
    });
  })
);

// POST /api/invoices/:id/pay - Record payment
router.post(
  '/:id/pay',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { amount, paymentMethod, reference } = req.body;

    const invoice = await queryOne<{ total_amount: number; amount_paid: number; status: string }>(
      'SELECT total_amount, amount_paid, status FROM invoices WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!invoice) {
      throw new NotFoundError('Invoice');
    }

    const newAmountPaid = Number(invoice.amount_paid) + Number(amount);
    const totalAmount = Number(invoice.total_amount);
    const newStatus = newAmountPaid >= totalAmount ? 'paid' : 'partial';

    await query(
      `UPDATE invoices
       SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [newAmountPaid, newStatus, id]
    );

    res.json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        amountPaid: newAmountPaid,
        remainingBalance: totalAmount - newAmountPaid,
        status: newStatus,
      },
    });
  })
);

export default router;
