import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne, transaction } from '../config/database';
import { authenticate, authorize, AuthenticatedRequest, requireCompany } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler';
import { ActivityLogger } from '../services/activityLogger';

const router = Router();

// Validation schemas
const createItemSchema = z.object({
  sku: z.string().min(1, 'SKU is required'),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().default('unit'),
  quantity: z.number().min(0).default(0),
  unitCost: z.number().min(0).default(0),
  sellingPrice: z.number().min(0).default(0),
  reorderLevel: z.number().min(0).default(0),
  reorderQuantity: z.number().min(0).default(0),
  locationId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  barcode: z.string().optional(),
  isService: z.boolean().default(false),
  trackInventory: z.boolean().default(true),
  tags: z.array(z.string()).optional(),
});

const updateItemSchema = createItemSchema.partial();

const adjustmentSchema = z.object({
  quantity: z.number(),
  type: z.enum(['adjustment', 'purchase', 'sale', 'transfer', 'return', 'write_off']),
  unitCost: z.number().min(0).optional(),
  notes: z.string().optional(),
  toLocationId: z.string().uuid().optional(),
});

// GET /api/inventory
router.get(
  '/',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      page = 1,
      limit = 20,
      category,
      locationId,
      supplierId,
      lowStock = 'false',
      search,
      sortBy = 'name',
      sortOrder = 'asc',
      includeInactive = 'false',
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    let whereClause = 'ii.company_id = $1';
    const params: any[] = [req.user!.companyId];
    let paramIndex = 2;

    if (includeInactive !== 'true') {
      whereClause += ' AND ii.is_active = true';
    }

    if (category) {
      whereClause += ` AND ii.category = $${paramIndex++}`;
      params.push(category);
    }

    if (locationId) {
      whereClause += ` AND ii.location_id = $${paramIndex++}`;
      params.push(locationId);
    }

    if (supplierId) {
      whereClause += ` AND ii.supplier_id = $${paramIndex++}`;
      params.push(supplierId);
    }

    if (lowStock === 'true') {
      whereClause += ' AND ii.quantity <= ii.reorder_level AND ii.track_inventory = true';
    }

    if (search) {
      whereClause += ` AND (ii.name ILIKE $${paramIndex} OR ii.sku ILIKE $${paramIndex} OR ii.barcode ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const validSortFields = ['name', 'sku', 'quantity', 'unit_cost', 'selling_price', 'created_at'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'name';
    const order = sortOrder === 'desc' ? 'DESC' : 'ASC';

    const [items, countResult] = await Promise.all([
      query(
        `SELECT ii.*, il.name as location_name, s.name as supplier_name,
                (ii.quantity * ii.unit_cost) as total_value,
                (ii.selling_price - ii.unit_cost) as profit_margin
         FROM inventory_items ii
         LEFT JOIN inventory_locations il ON ii.location_id = il.id
         LEFT JOIN suppliers s ON ii.supplier_id = s.id
         WHERE ${whereClause}
         ORDER BY ii.${sortField} ${order}
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, Number(limit), offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM inventory_items ii WHERE ${whereClause}`,
        params
      ),
    ]);

    const total = parseInt(countResult[0]?.count || '0');

    // Calculate summary
    const summary = await query<{ total_items: string; total_value: string; low_stock_count: string }>(
      `SELECT
         COUNT(*) as total_items,
         COALESCE(SUM(quantity * unit_cost), 0) as total_value,
         COUNT(*) FILTER (WHERE quantity <= reorder_level AND track_inventory = true) as low_stock_count
       FROM inventory_items ii WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: items,
      summary: {
        totalItems: parseInt(summary[0]?.total_items || '0'),
        totalValue: parseFloat(summary[0]?.total_value || '0'),
        lowStockCount: parseInt(summary[0]?.low_stock_count || '0'),
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

// GET /api/inventory/low-stock
router.get(
  '/low-stock',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const items = await query(
      `SELECT ii.*, il.name as location_name, s.name as supplier_name,
              (ii.reorder_level - ii.quantity) as quantity_needed
       FROM inventory_items ii
       LEFT JOIN inventory_locations il ON ii.location_id = il.id
       LEFT JOIN suppliers s ON ii.supplier_id = s.id
       WHERE ii.company_id = $1
         AND ii.is_active = true
         AND ii.track_inventory = true
         AND ii.quantity <= ii.reorder_level
       ORDER BY (ii.reorder_level - ii.quantity) DESC`,
      [req.user!.companyId]
    );

    res.json({
      success: true,
      data: items,
    });
  })
);

// GET /api/inventory/valuation
router.get(
  '/valuation',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // By category
    const byCategory = await query(
      `SELECT
         COALESCE(category, 'Uncategorized') as category,
         COUNT(*) as item_count,
         SUM(quantity) as total_quantity,
         SUM(quantity * unit_cost) as total_cost_value,
         SUM(quantity * selling_price) as total_retail_value
       FROM inventory_items
       WHERE company_id = $1 AND is_active = true
       GROUP BY category
       ORDER BY total_cost_value DESC`,
      [req.user!.companyId]
    );

    // By location
    const byLocation = await query(
      `SELECT
         COALESCE(il.name, 'No Location') as location,
         COUNT(*) as item_count,
         SUM(ii.quantity) as total_quantity,
         SUM(ii.quantity * ii.unit_cost) as total_cost_value
       FROM inventory_items ii
       LEFT JOIN inventory_locations il ON ii.location_id = il.id
       WHERE ii.company_id = $1 AND ii.is_active = true
       GROUP BY il.name
       ORDER BY total_cost_value DESC`,
      [req.user!.companyId]
    );

    // Summary
    const summary = await query<{ total_cost: string; total_retail: string; potential_profit: string }>(
      `SELECT
         SUM(quantity * unit_cost) as total_cost,
         SUM(quantity * selling_price) as total_retail,
         SUM(quantity * (selling_price - unit_cost)) as potential_profit
       FROM inventory_items
       WHERE company_id = $1 AND is_active = true`,
      [req.user!.companyId]
    );

    res.json({
      success: true,
      data: {
        summary: {
          totalCostValue: parseFloat(summary[0]?.total_cost || '0'),
          totalRetailValue: parseFloat(summary[0]?.total_retail || '0'),
          potentialProfit: parseFloat(summary[0]?.potential_profit || '0'),
        },
        byCategory,
        byLocation,
      },
    });
  })
);

// GET /api/inventory/:id
router.get(
  '/:id',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const item = await queryOne(
      `SELECT ii.*, il.name as location_name, s.name as supplier_name
       FROM inventory_items ii
       LEFT JOIN inventory_locations il ON ii.location_id = il.id
       LEFT JOIN suppliers s ON ii.supplier_id = s.id
       WHERE ii.id = $1 AND ii.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!item) {
      throw new NotFoundError('Inventory item');
    }

    // Get recent transactions
    const transactions = await query(
      `SELECT it.*, u.first_name, u.last_name
       FROM inventory_transactions it
       LEFT JOIN users u ON it.created_by = u.id
       WHERE it.inventory_item_id = $1
       ORDER BY it.created_at DESC
       LIMIT 10`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...item,
        recentTransactions: transactions,
      },
    });
  })
);

// POST /api/inventory
router.post(
  '/',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  validateBody(createItemSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;

    // Check for duplicate SKU
    const existing = await queryOne(
      'SELECT id FROM inventory_items WHERE company_id = $1 AND sku = $2',
      [req.user!.companyId, data.sku]
    );

    if (existing) {
      throw new AppError('An item with this SKU already exists', 409);
    }

    const itemId = uuidv4();

    await query(
      `INSERT INTO inventory_items (
        id, company_id, sku, name, description, category, unit, quantity,
        unit_cost, selling_price, reorder_level, reorder_quantity, location_id,
        supplier_id, barcode, is_service, track_inventory, tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        itemId,
        req.user!.companyId,
        data.sku,
        data.name,
        data.description || null,
        data.category || null,
        data.unit,
        data.quantity,
        data.unitCost,
        data.sellingPrice,
        data.reorderLevel,
        data.reorderQuantity,
        data.locationId || null,
        data.supplierId || null,
        data.barcode || null,
        data.isService,
        data.trackInventory,
        data.tags || [],
      ]
    );

    // Record initial quantity as transaction if > 0
    if (data.quantity > 0 && data.trackInventory) {
      await query(
        `INSERT INTO inventory_transactions (
          id, inventory_item_id, transaction_type, quantity, unit_cost, total_cost, notes, created_by
        ) VALUES ($1, $2, 'adjustment', $3, $4, $5, 'Initial stock', $6)`,
        [uuidv4(), itemId, data.quantity, data.unitCost, data.quantity * data.unitCost, req.user!.id]
      );
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'create',
      entityType: 'inventory_item',
      entityId: itemId,
      newValues: data,
      ipAddress: req.ip,
    });

    const item = await queryOne('SELECT * FROM inventory_items WHERE id = $1', [itemId]);

    res.status(201).json({
      success: true,
      message: 'Inventory item created successfully',
      data: item,
    });
  })
);

// PUT /api/inventory/:id
router.put(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  validateBody(updateItemSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;

    const currentItem = await queryOne(
      'SELECT * FROM inventory_items WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!currentItem) {
      throw new NotFoundError('Inventory item');
    }

    // Check SKU uniqueness if updating
    if (updates.sku && updates.sku !== (currentItem as any).sku) {
      const existing = await queryOne(
        'SELECT id FROM inventory_items WHERE company_id = $1 AND sku = $2 AND id != $3',
        [req.user!.companyId, updates.sku, id]
      );

      if (existing) {
        throw new AppError('An item with this SKU already exists', 409);
      }
    }

    const fieldMapping: Record<string, string> = {
      sku: 'sku',
      name: 'name',
      description: 'description',
      category: 'category',
      unit: 'unit',
      unitCost: 'unit_cost',
      sellingPrice: 'selling_price',
      reorderLevel: 'reorder_level',
      reorderQuantity: 'reorder_quantity',
      locationId: 'location_id',
      supplierId: 'supplier_id',
      barcode: 'barcode',
      isService: 'is_service',
      trackInventory: 'track_inventory',
      isActive: 'is_active',
      tags: 'tags',
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
        `UPDATE inventory_items SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'update',
      entityType: 'inventory_item',
      entityId: id,
      oldValues: currentItem,
      newValues: updates,
      ipAddress: req.ip,
    });

    const item = await queryOne('SELECT * FROM inventory_items WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Inventory item updated successfully',
      data: item,
    });
  })
);

// POST /api/inventory/:id/adjust - Adjust inventory quantity
router.post(
  '/:id/adjust',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  validateBody(adjustmentSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { quantity, type, unitCost, notes, toLocationId } = req.body;

    const item = await queryOne<{ quantity: number; unit_cost: number; track_inventory: boolean }>(
      'SELECT quantity, unit_cost, track_inventory FROM inventory_items WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!item) {
      throw new NotFoundError('Inventory item');
    }

    if (!item.track_inventory) {
      throw new AppError('Inventory tracking is disabled for this item', 400);
    }

    const newQuantity = item.quantity + quantity;

    if (newQuantity < 0) {
      throw new AppError('Insufficient inventory', 400);
    }

    const cost = unitCost ?? item.unit_cost;
    const totalCost = Math.abs(quantity) * cost;

    await transaction(async (client) => {
      // Update inventory quantity
      await client.query(
        'UPDATE inventory_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newQuantity, id]
      );

      // Record transaction
      await client.query(
        `INSERT INTO inventory_transactions (
          id, inventory_item_id, transaction_type, quantity, unit_cost, total_cost,
          to_location_id, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv4(),
          id,
          type,
          quantity,
          cost,
          totalCost,
          toLocationId || null,
          notes || null,
          req.user!.id,
        ]
      );
    });

    res.json({
      success: true,
      message: 'Inventory adjusted successfully',
      data: {
        previousQuantity: item.quantity,
        adjustment: quantity,
        newQuantity,
      },
    });
  })
);

// GET /api/inventory/:id/transactions
router.get(
  '/:id/transactions',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    // Verify item belongs to company
    const item = await queryOne(
      'SELECT id FROM inventory_items WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!item) {
      throw new NotFoundError('Inventory item');
    }

    const [transactions, countResult] = await Promise.all([
      query(
        `SELECT it.*, u.first_name, u.last_name,
                fl.name as from_location_name, tl.name as to_location_name
         FROM inventory_transactions it
         LEFT JOIN users u ON it.created_by = u.id
         LEFT JOIN inventory_locations fl ON it.from_location_id = fl.id
         LEFT JOIN inventory_locations tl ON it.to_location_id = tl.id
         WHERE it.inventory_item_id = $1
         ORDER BY it.created_at DESC
         LIMIT $2 OFFSET $3`,
        [id, Number(limit), offset]
      ),
      query<{ count: string }>(
        'SELECT COUNT(*) as count FROM inventory_transactions WHERE inventory_item_id = $1',
        [id]
      ),
    ]);

    const total = parseInt(countResult[0]?.count || '0');

    res.json({
      success: true,
      data: transactions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  })
);

// DELETE /api/inventory/:id
router.delete(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const item = await queryOne(
      'SELECT * FROM inventory_items WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!item) {
      throw new NotFoundError('Inventory item');
    }

    // Soft delete
    await query(
      'UPDATE inventory_items SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'delete',
      entityType: 'inventory_item',
      entityId: id,
      oldValues: item,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Inventory item deactivated successfully',
    });
  })
);

// Locations endpoints
// GET /api/inventory/locations
router.get(
  '/locations/list',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const locations = await query(
      `SELECT il.*,
              (SELECT COUNT(*) FROM inventory_items WHERE location_id = il.id AND is_active = true) as item_count,
              (SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM inventory_items WHERE location_id = il.id AND is_active = true) as total_value
       FROM inventory_locations il
       WHERE il.company_id = $1
       ORDER BY il.is_default DESC, il.name`,
      [req.user!.companyId]
    );

    res.json({
      success: true,
      data: locations,
    });
  })
);

export default router;
