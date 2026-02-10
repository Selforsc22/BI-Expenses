import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, authorize, AuthenticatedRequest, requireCompany } from '../middleware/auth';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler';
import { CalculationEngine } from '../services/calculationEngine';
import { query, queryOne } from '../config/database';
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, startOfQuarter, endOfQuarter, eachMonthOfInterval } from 'date-fns';

const router = Router();

// GET /api/reports/profit-loss
router.get(
  '/profit-loss',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate, compareWithPrevious = 'true' } = req.query;

    const start = startDate ? new Date(startDate as string) : startOfYear(new Date());
    const end = endDate ? new Date(endDate as string) : new Date();

    const summary = await CalculationEngine.calculateFinancialSummary(
      req.user!.companyId!,
      start,
      end
    );

    let comparison = null;
    if (compareWithPrevious === 'true') {
      const periodLength = end.getTime() - start.getTime();
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - periodLength);

      comparison = await CalculationEngine.comparePeriods(
        req.user!.companyId!,
        start,
        end,
        prevStart,
        prevEnd
      );
    }

    // Get detailed breakdown
    const [revenueByCategory, expenseByCategory, operationalCosts] = await Promise.all([
      query(
        `SELECT c.name, COALESCE(SUM(r.amount), 0) as total
         FROM categories c
         LEFT JOIN revenue r ON c.id = r.category_id AND r.revenue_date BETWEEN $2 AND $3
         WHERE c.company_id = $1 AND c.type = 'revenue'
         GROUP BY c.name
         HAVING SUM(r.amount) > 0
         ORDER BY total DESC`,
        [req.user!.companyId, start, end]
      ),
      query(
        `SELECT c.name, COALESCE(SUM(e.amount), 0) as total
         FROM categories c
         LEFT JOIN expenses e ON c.id = e.category_id AND e.expense_date BETWEEN $2 AND $3
         WHERE c.company_id = $1 AND c.type = 'expense'
         GROUP BY c.name
         HAVING SUM(e.amount) > 0
         ORDER BY total DESC`,
        [req.user!.companyId, start, end]
      ),
      query(
        `SELECT name, category, amount, frequency
         FROM operational_costs
         WHERE company_id = $1 AND is_active = true
         ORDER BY category, amount DESC`,
        [req.user!.companyId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        period: {
          start: format(start, 'yyyy-MM-dd'),
          end: format(end, 'yyyy-MM-dd'),
        },
        summary: {
          totalRevenue: summary.revenue.total,
          costOfGoodsSold: summary.cogs,
          grossProfit: summary.grossProfit,
          operatingExpenses: summary.expenses.total,
          operationalCosts: summary.operationalCosts,
          payrollCosts: summary.payrollCosts,
          netProfit: summary.netProfit,
          profitMargin: summary.profitMargin,
        },
        breakdown: {
          revenueByCategory,
          expenseByCategory,
          operationalCosts,
        },
        comparison: comparison ? {
          changes: comparison.changes,
          previousPeriod: {
            totalRevenue: comparison.previous.revenue.total,
            netProfit: comparison.previous.netProfit,
            profitMargin: comparison.previous.profitMargin,
          },
        } : null,
      },
    });
  })
);

// GET /api/reports/expense
router.get(
  '/expense',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate, groupBy = 'category', vendorName, categoryId } = req.query;

    const start = startDate ? new Date(startDate as string) : startOfMonth(new Date());
    const end = endDate ? new Date(endDate as string) : new Date();

    let whereClause = 'e.company_id = $1 AND e.expense_date BETWEEN $2 AND $3';
    const params: any[] = [req.user!.companyId, start, end];
    let paramIndex = 4;

    if (vendorName) {
      whereClause += ` AND e.vendor_name ILIKE $${paramIndex++}`;
      params.push(`%${vendorName}%`);
    }

    if (categoryId) {
      whereClause += ` AND e.category_id = $${paramIndex++}`;
      params.push(categoryId);
    }

    let groupByClause = 'c.name';
    let selectClause = 'c.name as group_name';

    switch (groupBy) {
      case 'vendor':
        groupByClause = 'e.vendor_name';
        selectClause = 'COALESCE(e.vendor_name, \'Unknown\') as group_name';
        break;
      case 'month':
        groupByClause = 'DATE_TRUNC(\'month\', e.expense_date)';
        selectClause = 'DATE_TRUNC(\'month\', e.expense_date) as group_name';
        break;
      case 'category':
      default:
        groupByClause = 'c.name';
        selectClause = 'COALESCE(c.name, \'Uncategorized\') as group_name';
    }

    const expenses = await query(
      `SELECT ${selectClause}, COUNT(*) as count, SUM(e.amount) as total
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE ${whereClause}
       GROUP BY ${groupByClause}
       ORDER BY total DESC`,
      params
    );

    // Get total
    const totalResult = await query<{ total: string }>(
      `SELECT SUM(amount) as total FROM expenses e WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: {
        period: { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') },
        groupedBy: groupBy,
        total: parseFloat(totalResult[0]?.total || '0'),
        breakdown: expenses,
      },
    });
  })
);

// GET /api/reports/revenue
router.get(
  '/revenue',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate, groupBy = 'category', customerName, categoryId } = req.query;

    const start = startDate ? new Date(startDate as string) : startOfMonth(new Date());
    const end = endDate ? new Date(endDate as string) : new Date();

    let whereClause = 'r.company_id = $1 AND r.revenue_date BETWEEN $2 AND $3';
    const params: any[] = [req.user!.companyId, start, end];
    let paramIndex = 4;

    if (customerName) {
      whereClause += ` AND r.customer_name ILIKE $${paramIndex++}`;
      params.push(`%${customerName}%`);
    }

    if (categoryId) {
      whereClause += ` AND r.category_id = $${paramIndex++}`;
      params.push(categoryId);
    }

    let groupByClause = 'c.name';
    let selectClause = 'c.name as group_name';

    switch (groupBy) {
      case 'customer':
        groupByClause = 'r.customer_name';
        selectClause = 'COALESCE(r.customer_name, \'Unknown\') as group_name';
        break;
      case 'month':
        groupByClause = 'DATE_TRUNC(\'month\', r.revenue_date)';
        selectClause = 'DATE_TRUNC(\'month\', r.revenue_date) as group_name';
        break;
      case 'category':
      default:
        groupByClause = 'c.name';
        selectClause = 'COALESCE(c.name, \'Uncategorized\') as group_name';
    }

    const revenues = await query(
      `SELECT ${selectClause}, COUNT(*) as count, SUM(r.amount) as total
       FROM revenue r
       LEFT JOIN categories c ON r.category_id = c.id
       WHERE ${whereClause}
       GROUP BY ${groupByClause}
       ORDER BY total DESC`,
      params
    );

    const totalResult = await query<{ total: string }>(
      `SELECT SUM(amount) as total FROM revenue r WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: {
        period: { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') },
        groupedBy: groupBy,
        total: parseFloat(totalResult[0]?.total || '0'),
        breakdown: revenues,
      },
    });
  })
);

// GET /api/reports/inventory
router.get(
  '/inventory',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { category, lowStockOnly = 'false' } = req.query;

    let whereClause = 'ii.company_id = $1 AND ii.is_active = true';
    const params: any[] = [req.user!.companyId];

    if (category) {
      whereClause += ' AND ii.category = $2';
      params.push(category);
    }

    if (lowStockOnly === 'true') {
      whereClause += ' AND ii.quantity <= ii.reorder_level AND ii.track_inventory = true';
    }

    const items = await query(
      `SELECT ii.*, il.name as location_name, s.name as supplier_name,
              (ii.quantity * ii.unit_cost) as total_cost_value,
              (ii.quantity * ii.selling_price) as total_retail_value,
              (ii.selling_price - ii.unit_cost) as unit_margin,
              CASE WHEN ii.selling_price > 0 THEN ((ii.selling_price - ii.unit_cost) / ii.selling_price * 100) ELSE 0 END as margin_percent
       FROM inventory_items ii
       LEFT JOIN inventory_locations il ON ii.location_id = il.id
       LEFT JOIN suppliers s ON ii.supplier_id = s.id
       WHERE ${whereClause}
       ORDER BY ii.category, ii.name`,
      params
    );

    // Summary by category
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

    // Overall summary
    const summary = await query<{
      total_items: string;
      total_quantity: string;
      total_cost: string;
      total_retail: string;
      low_stock_count: string;
    }>(
      `SELECT
         COUNT(*) as total_items,
         SUM(quantity) as total_quantity,
         SUM(quantity * unit_cost) as total_cost,
         SUM(quantity * selling_price) as total_retail,
         COUNT(*) FILTER (WHERE quantity <= reorder_level AND track_inventory = true) as low_stock_count
       FROM inventory_items
       WHERE company_id = $1 AND is_active = true`,
      [req.user!.companyId]
    );

    res.json({
      success: true,
      data: {
        summary: {
          totalItems: parseInt(summary[0]?.total_items || '0'),
          totalQuantity: parseFloat(summary[0]?.total_quantity || '0'),
          totalCostValue: parseFloat(summary[0]?.total_cost || '0'),
          totalRetailValue: parseFloat(summary[0]?.total_retail || '0'),
          lowStockCount: parseInt(summary[0]?.low_stock_count || '0'),
          potentialProfit: parseFloat(summary[0]?.total_retail || '0') - parseFloat(summary[0]?.total_cost || '0'),
        },
        byCategory,
        items,
      },
    });
  })
);

// GET /api/reports/payroll
router.get(
  '/payroll',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { year, month, department } = req.query;

    const now = new Date();
    const targetYear = year ? parseInt(year as string) : now.getFullYear();
    const targetMonth = month ? parseInt(month as string) - 1 : null;

    let startDate: Date;
    let endDate: Date;

    if (targetMonth !== null) {
      startDate = new Date(targetYear, targetMonth, 1);
      endDate = endOfMonth(startDate);
    } else {
      startDate = new Date(targetYear, 0, 1);
      endDate = new Date(targetYear, 11, 31);
    }

    let whereClause = 'e.company_id = $1 AND pr.pay_period_start >= $2 AND pr.pay_period_end <= $3';
    const params: any[] = [req.user!.companyId, startDate, endDate];

    if (department) {
      whereClause += ' AND e.department = $4';
      params.push(department);
    }

    // Summary
    const summary = await query<{
      total_gross: string;
      total_net: string;
      total_deductions: string;
      total_employer_cost: string;
      employee_count: string;
      record_count: string;
    }>(
      `SELECT
         COALESCE(SUM(pr.gross_pay), 0) as total_gross,
         COALESCE(SUM(pr.net_pay), 0) as total_net,
         COALESCE(SUM(pr.total_deductions), 0) as total_deductions,
         COALESCE(SUM(pr.total_employer_cost), 0) as total_employer_cost,
         COUNT(DISTINCT pr.employee_id) as employee_count,
         COUNT(*) as record_count
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE ${whereClause}`,
      params
    );

    // By department
    const byDepartment = await query(
      `SELECT
         COALESCE(e.department, 'No Department') as department,
         COUNT(DISTINCT e.id) as employee_count,
         SUM(pr.gross_pay) as total_gross,
         SUM(pr.net_pay) as total_net,
         SUM(pr.total_employer_cost) as total_employer_cost
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE ${whereClause}
       GROUP BY e.department
       ORDER BY total_gross DESC`,
      params
    );

    // By employee
    const byEmployee = await query(
      `SELECT
         e.employee_number, e.first_name, e.last_name, e.department,
         COUNT(*) as pay_periods,
         SUM(pr.gross_pay) as total_gross,
         SUM(pr.net_pay) as total_net,
         AVG(pr.gross_pay) as avg_gross
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE ${whereClause}
       GROUP BY e.id, e.employee_number, e.first_name, e.last_name, e.department
       ORDER BY total_gross DESC`,
      params
    );

    res.json({
      success: true,
      data: {
        period: {
          year: targetYear,
          month: targetMonth !== null ? targetMonth + 1 : null,
          startDate: format(startDate, 'yyyy-MM-dd'),
          endDate: format(endDate, 'yyyy-MM-dd'),
        },
        summary: {
          totalGross: parseFloat(summary[0]?.total_gross || '0'),
          totalNet: parseFloat(summary[0]?.total_net || '0'),
          totalDeductions: parseFloat(summary[0]?.total_deductions || '0'),
          totalEmployerCost: parseFloat(summary[0]?.total_employer_cost || '0'),
          employeeCount: parseInt(summary[0]?.employee_count || '0'),
          recordCount: parseInt(summary[0]?.record_count || '0'),
        },
        byDepartment,
        byEmployee,
      },
    });
  })
);

// GET /api/reports/tax-summary
router.get(
  '/tax-summary',
  authenticate,
  requireCompany,
  authorize('admin', 'accountant'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { year } = req.query;
    const targetYear = year ? parseInt(year as string) : new Date().getFullYear();

    const startDate = new Date(targetYear, 0, 1);
    const endDate = new Date(targetYear, 11, 31);

    // Tax deductible expenses
    const deductibleExpenses = await query(
      `SELECT c.name, SUM(e.amount) as total
       FROM expenses e
       JOIN categories c ON e.category_id = c.id
       WHERE e.company_id = $1
         AND e.expense_date BETWEEN $2 AND $3
         AND e.is_tax_deductible = true
       GROUP BY c.name
       ORDER BY total DESC`,
      [req.user!.companyId, startDate, endDate]
    );

    // Revenue
    const revenue = await query<{ total: string; tax_collected: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total, COALESCE(SUM(tax_amount), 0) as tax_collected
       FROM revenue
       WHERE company_id = $1 AND revenue_date BETWEEN $2 AND $3`,
      [req.user!.companyId, startDate, endDate]
    );

    // Payroll taxes paid
    const payrollTaxes = await query<{
      federal_tax: string;
      state_tax: string;
      local_tax: string;
      social_security: string;
      medicare: string;
      employer_taxes: string;
    }>(
      `SELECT
         COALESCE(SUM(pr.federal_tax), 0) as federal_tax,
         COALESCE(SUM(pr.state_tax), 0) as state_tax,
         COALESCE(SUM(pr.local_tax), 0) as local_tax,
         COALESCE(SUM(pr.social_security), 0) as social_security,
         COALESCE(SUM(pr.medicare), 0) as medicare,
         COALESCE(SUM(pr.employer_taxes), 0) as employer_taxes
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE e.company_id = $1
         AND pr.pay_period_start >= $2
         AND pr.pay_period_end <= $3
         AND pr.status = 'paid'`,
      [req.user!.companyId, startDate, endDate]
    );

    const totalDeductible = deductibleExpenses.reduce<number>(
      (sum, e) => sum + parseFloat((e as any).total),
      0
    );

    res.json({
      success: true,
      data: {
        year: targetYear,
        revenue: {
          total: parseFloat(revenue[0]?.total || '0'),
          taxCollected: parseFloat(revenue[0]?.tax_collected || '0'),
        },
        deductibleExpenses: {
          total: totalDeductible,
          byCategory: deductibleExpenses,
        },
        payrollTaxes: {
          federalWithholding: parseFloat(payrollTaxes[0]?.federal_tax || '0'),
          stateWithholding: parseFloat(payrollTaxes[0]?.state_tax || '0'),
          localWithholding: parseFloat(payrollTaxes[0]?.local_tax || '0'),
          socialSecurity: parseFloat(payrollTaxes[0]?.social_security || '0'),
          medicare: parseFloat(payrollTaxes[0]?.medicare || '0'),
          employerPortion: parseFloat(payrollTaxes[0]?.employer_taxes || '0'),
        },
      },
    });
  })
);

// POST /api/reports/save - Save report configuration
router.post(
  '/save',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { name, reportType, filters, columns, isPublic } = req.body;

    const reportId = uuidv4();

    await query(
      `INSERT INTO saved_reports (id, company_id, created_by, name, report_type, filters, columns, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        reportId,
        req.user!.companyId,
        req.user!.id,
        name,
        reportType,
        JSON.stringify(filters || {}),
        JSON.stringify(columns || []),
        isPublic || false,
      ]
    );

    const report = await queryOne('SELECT * FROM saved_reports WHERE id = $1', [reportId]);

    res.status(201).json({
      success: true,
      message: 'Report saved successfully',
      data: report,
    });
  })
);

// GET /api/reports/saved
router.get(
  '/saved',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const reports = await query(
      `SELECT sr.*, u.first_name, u.last_name
       FROM saved_reports sr
       JOIN users u ON sr.created_by = u.id
       WHERE sr.company_id = $1 AND (sr.is_public = true OR sr.created_by = $2)
       ORDER BY sr.updated_at DESC`,
      [req.user!.companyId, req.user!.id]
    );

    res.json({
      success: true,
      data: reports,
    });
  })
);

// DELETE /api/reports/saved/:id
router.delete(
  '/saved/:id',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const report = await queryOne(
      'SELECT id, created_by FROM saved_reports WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!report) {
      throw new NotFoundError('Report');
    }

    // Only creator or admin can delete
    if ((report as any).created_by !== req.user!.id && req.user!.role !== 'admin') {
      throw new NotFoundError('Report');
    }

    await query('DELETE FROM saved_reports WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Report deleted successfully',
    });
  })
);

export default router;
