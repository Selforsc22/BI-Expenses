import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest, requireCompany } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { CalculationEngine } from '../services/calculationEngine';
import { query } from '../config/database';
import { startOfMonth, endOfMonth, subMonths, startOfYear, format } from 'date-fns';

const router = Router();

// GET /api/dashboard - Main dashboard data
router.get(
  '/',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const metrics = await CalculationEngine.getDashboardMetrics(req.user!.companyId!);
    res.json({
      success: true,
      data: metrics,
    });
  })
);

// GET /api/dashboard/metrics - Key financial metrics
router.get(
  '/metrics',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { period = 'month' } = req.query;

    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;
    let prevStartDate: Date;
    let prevEndDate: Date;

    switch (period) {
      case 'year':
        startDate = startOfYear(now);
        prevStartDate = startOfYear(subMonths(now, 12));
        prevEndDate = subMonths(startDate, 1);
        break;
      case 'quarter':
        const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        startDate = quarterStart;
        prevStartDate = subMonths(quarterStart, 3);
        prevEndDate = subMonths(startDate, 1);
        break;
      case 'month':
      default:
        startDate = startOfMonth(now);
        endDate = endOfMonth(now);
        prevStartDate = startOfMonth(subMonths(now, 1));
        prevEndDate = endOfMonth(subMonths(now, 1));
    }

    const comparison = await CalculationEngine.comparePeriods(
      req.user!.companyId!,
      startDate,
      endDate,
      prevStartDate,
      prevEndDate
    );

    res.json({
      success: true,
      data: {
        period: {
          start: format(startDate, 'yyyy-MM-dd'),
          end: format(endDate, 'yyyy-MM-dd'),
        },
        current: comparison.current,
        previous: comparison.previous,
        changes: comparison.changes,
      },
    });
  })
);

// GET /api/dashboard/revenue-expenses-chart
router.get(
  '/revenue-expenses-chart',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { months = 12 } = req.query;

    const now = new Date();
    const startDate = subMonths(startOfMonth(now), Number(months) - 1);
    const endDate = endOfMonth(now);

    const timeSeries = await CalculationEngine.generateTimeSeriesData(
      req.user!.companyId!,
      startDate,
      endDate,
      'month'
    );

    res.json({
      success: true,
      data: {
        labels: timeSeries.map(d => d.date),
        datasets: [
          {
            label: 'Revenue',
            data: timeSeries.map(d => d.revenue),
            borderColor: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
          },
          {
            label: 'Expenses',
            data: timeSeries.map(d => d.expenses),
            borderColor: '#EF4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
          },
          {
            label: 'Profit',
            data: timeSeries.map(d => d.profit),
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
          },
        ],
      },
    });
  })
);

// GET /api/dashboard/expense-breakdown
router.get(
  '/expense-breakdown',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : startOfMonth(new Date());
    const end = endDate ? new Date(endDate as string) : new Date();

    const expenses = await query<{ name: string; total: string; color: string }>(
      `SELECT c.name, COALESCE(SUM(e.amount), 0) as total, c.color
       FROM categories c
       LEFT JOIN expenses e ON c.id = e.category_id
         AND e.expense_date BETWEEN $2 AND $3
       WHERE c.company_id = $1 AND c.type = 'expense' AND c.is_active = true
       GROUP BY c.id, c.name, c.color
       HAVING SUM(e.amount) > 0
       ORDER BY total DESC`,
      [req.user!.companyId, start, end]
    );

    const colors = expenses.map(e => e.color || generateColor(e.name));

    res.json({
      success: true,
      data: {
        labels: expenses.map(e => e.name),
        datasets: [{
          data: expenses.map(e => parseFloat(e.total)),
          backgroundColor: colors,
          borderColor: colors.map(c => c),
          borderWidth: 1,
        }],
      },
    });
  })
);

// GET /api/dashboard/top-vendors
router.get(
  '/top-vendors',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { limit = 10, startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : startOfMonth(new Date());
    const end = endDate ? new Date(endDate as string) : new Date();

    const vendors = await query(
      `SELECT
         COALESCE(vendor_name, 'Unknown') as vendor_name,
         COUNT(*) as transaction_count,
         SUM(amount) as total_amount
       FROM expenses
       WHERE company_id = $1 AND expense_date BETWEEN $2 AND $3
       GROUP BY vendor_name
       ORDER BY total_amount DESC
       LIMIT $4`,
      [req.user!.companyId, start, end, Number(limit)]
    );

    res.json({
      success: true,
      data: vendors,
    });
  })
);

// GET /api/dashboard/cash-flow
router.get(
  '/cash-flow',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    // Calculate cash flow: revenue - expenses
    const [revenueResult, expenseResult, receivables, payables] = await Promise.all([
      query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0) as total FROM revenue
         WHERE company_id = $1 AND revenue_date BETWEEN $2 AND $3`,
        [req.user!.companyId, monthStart, monthEnd]
      ),
      query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
         WHERE company_id = $1 AND expense_date BETWEEN $2 AND $3`,
        [req.user!.companyId, monthStart, monthEnd]
      ),
      query<{ total: string }>(
        `SELECT COALESCE(SUM(total_amount - amount_paid), 0) as total FROM invoices
         WHERE company_id = $1 AND invoice_type = 'customer' AND status IN ('pending', 'partial')`,
        [req.user!.companyId]
      ),
      query<{ total: string }>(
        `SELECT COALESCE(SUM(total_amount - amount_paid), 0) as total FROM invoices
         WHERE company_id = $1 AND invoice_type = 'vendor' AND status IN ('pending', 'partial')`,
        [req.user!.companyId]
      ),
    ]);

    const revenue = parseFloat(revenueResult[0]?.total || '0');
    const expenses = parseFloat(expenseResult[0]?.total || '0');
    const accountsReceivable = parseFloat(receivables[0]?.total || '0');
    const accountsPayable = parseFloat(payables[0]?.total || '0');

    res.json({
      success: true,
      data: {
        revenue,
        expenses,
        netCashFlow: revenue - expenses,
        accountsReceivable,
        accountsPayable,
        projectedCash: revenue - expenses + accountsReceivable - accountsPayable,
      },
    });
  })
);

// GET /api/dashboard/inventory-status
router.get(
  '/inventory-status',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const [summary, lowStock, topItems] = await Promise.all([
      query<{ total_items: string; total_value: string; total_quantity: string }>(
        `SELECT
           COUNT(*) as total_items,
           COALESCE(SUM(quantity * unit_cost), 0) as total_value,
           COALESCE(SUM(quantity), 0) as total_quantity
         FROM inventory_items
         WHERE company_id = $1 AND is_active = true`,
        [req.user!.companyId]
      ),
      query(
        `SELECT id, sku, name, quantity, reorder_level, unit_cost
         FROM inventory_items
         WHERE company_id = $1 AND is_active = true AND track_inventory = true AND quantity <= reorder_level
         ORDER BY (reorder_level - quantity) DESC
         LIMIT 5`,
        [req.user!.companyId]
      ),
      query(
        `SELECT id, sku, name, quantity, selling_price, (quantity * selling_price) as value
         FROM inventory_items
         WHERE company_id = $1 AND is_active = true
         ORDER BY value DESC
         LIMIT 5`,
        [req.user!.companyId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalItems: parseInt(summary[0]?.total_items || '0'),
          totalValue: parseFloat(summary[0]?.total_value || '0'),
          totalQuantity: parseFloat(summary[0]?.total_quantity || '0'),
        },
        lowStock,
        topItems,
      },
    });
  })
);

// GET /api/dashboard/payroll-summary
router.get(
  '/payroll-summary',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const [currentMonth, headcount, upcomingPayroll] = await Promise.all([
      query<{ total_gross: string; total_net: string; employee_count: string }>(
        `SELECT
           COALESCE(SUM(pr.gross_pay), 0) as total_gross,
           COALESCE(SUM(pr.net_pay), 0) as total_net,
           COUNT(DISTINCT pr.employee_id) as employee_count
         FROM payroll_records pr
         JOIN employees e ON pr.employee_id = e.id
         WHERE e.company_id = $1
           AND pr.pay_period_start >= $2
           AND pr.pay_period_end <= $3`,
        [req.user!.companyId, monthStart, monthEnd]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM employees
         WHERE company_id = $1 AND status = 'active'`,
        [req.user!.companyId]
      ),
      query<{ pending_count: string; pending_amount: string }>(
        `SELECT COUNT(*) as pending_count, COALESCE(SUM(gross_pay), 0) as pending_amount
         FROM payroll_records pr
         JOIN employees e ON pr.employee_id = e.id
         WHERE e.company_id = $1 AND pr.status IN ('draft', 'pending')`,
        [req.user!.companyId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        currentMonth: {
          totalGross: parseFloat(currentMonth[0]?.total_gross || '0'),
          totalNet: parseFloat(currentMonth[0]?.total_net || '0'),
          employeeCount: parseInt(currentMonth[0]?.employee_count || '0'),
        },
        activeEmployees: parseInt(headcount[0]?.count || '0'),
        pendingPayroll: {
          count: parseInt(upcomingPayroll[0]?.pending_count || '0'),
          amount: parseFloat(upcomingPayroll[0]?.pending_amount || '0'),
        },
      },
    });
  })
);

// GET /api/dashboard/activity
router.get(
  '/activity',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { limit = 10 } = req.query;

    const activities = await query(
      `SELECT al.*, u.first_name, u.last_name
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.company_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2`,
      [req.user!.companyId, Number(limit)]
    );

    res.json({
      success: true,
      data: activities,
    });
  })
);

// Helper function to generate consistent colors for categories
function generateColor(name: string): string {
  const colors = [
    '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444',
    '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

export default router;
