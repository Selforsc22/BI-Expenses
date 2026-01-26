import { query } from '../config/database';
import { FinancialPeriod, ChartData } from '../types';
import { format, startOfMonth, endOfMonth, subMonths, startOfQuarter, endOfQuarter, startOfYear, endOfYear, eachMonthOfInterval, eachDayOfInterval, differenceInDays } from 'date-fns';

interface FinancialSummary {
  revenue: {
    total: number;
    byCategory: Record<string, number>;
    byCustomer: Record<string, number>;
  };
  expenses: {
    total: number;
    byCategory: Record<string, number>;
    byVendor: Record<string, number>;
  };
  cogs: number;
  operationalCosts: number;
  payrollCosts: number;
  grossProfit: number;
  netProfit: number;
  profitMargin: number;
}

interface TimeSeriesData {
  date: string;
  revenue: number;
  expenses: number;
  profit: number;
}

interface PeriodComparison {
  current: FinancialSummary;
  previous: FinancialSummary;
  changes: {
    revenue: number;
    expenses: number;
    grossProfit: number;
    netProfit: number;
    profitMargin: number;
  };
}

export class CalculationEngine {

  /**
   * Calculate comprehensive financial summary for a period
   */
  static async calculateFinancialSummary(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<FinancialSummary> {
    const [
      revenueData,
      expenseData,
      cogsData,
      operationalCostsData,
      payrollData
    ] = await Promise.all([
      this.getRevenueSummary(companyId, startDate, endDate),
      this.getExpenseSummary(companyId, startDate, endDate),
      this.calculateCOGS(companyId, startDate, endDate),
      this.getOperationalCosts(companyId, startDate, endDate),
      this.getPayrollCosts(companyId, startDate, endDate)
    ]);

    const totalRevenue = revenueData.total;
    const totalExpenses = expenseData.total;
    const cogs = cogsData;
    const operationalCosts = operationalCostsData;
    const payrollCosts = payrollData;

    // Gross Profit = Revenue - COGS
    const grossProfit = totalRevenue - cogs;

    // Net Profit = Gross Profit - Operating Expenses - Payroll
    const netProfit = grossProfit - operationalCosts - payrollCosts - (totalExpenses - cogs);

    // Profit Margin = (Net Profit / Revenue) × 100
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return {
      revenue: revenueData,
      expenses: expenseData,
      cogs,
      operationalCosts,
      payrollCosts,
      grossProfit,
      netProfit,
      profitMargin: Math.round(profitMargin * 100) / 100,
    };
  }

  /**
   * Get revenue summary with breakdowns
   */
  private static async getRevenueSummary(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{ total: number; byCategory: Record<string, number>; byCustomer: Record<string, number> }> {
    // Get total revenue
    const totalResult = await query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM revenue
       WHERE company_id = $1 AND revenue_date BETWEEN $2 AND $3`,
      [companyId, startDate, endDate]
    );

    // Get revenue by category
    const categoryResult = await query<{ name: string; total: string }>(
      `SELECT c.name, COALESCE(SUM(r.amount), 0) as total
       FROM revenue r
       LEFT JOIN categories c ON r.category_id = c.id
       WHERE r.company_id = $1 AND r.revenue_date BETWEEN $2 AND $3
       GROUP BY c.name
       ORDER BY total DESC`,
      [companyId, startDate, endDate]
    );

    // Get revenue by customer
    const customerResult = await query<{ customer_name: string; total: string }>(
      `SELECT COALESCE(customer_name, 'Unknown') as customer_name, SUM(amount) as total
       FROM revenue
       WHERE company_id = $1 AND revenue_date BETWEEN $2 AND $3
       GROUP BY customer_name
       ORDER BY total DESC
       LIMIT 10`,
      [companyId, startDate, endDate]
    );

    // Also include customer invoices as revenue
    const invoiceRevenue = await query<{ total: string }>(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM invoices
       WHERE company_id = $1
         AND invoice_type = 'customer'
         AND status IN ('paid', 'partial')
         AND invoice_date BETWEEN $2 AND $3`,
      [companyId, startDate, endDate]
    );

    const total = parseFloat(totalResult[0]?.total || '0') + parseFloat(invoiceRevenue[0]?.total || '0');

    const byCategory: Record<string, number> = {};
    categoryResult.forEach(row => {
      byCategory[row.name || 'Uncategorized'] = parseFloat(row.total);
    });

    const byCustomer: Record<string, number> = {};
    customerResult.forEach(row => {
      byCustomer[row.customer_name] = parseFloat(row.total);
    });

    return { total, byCategory, byCustomer };
  }

  /**
   * Get expense summary with breakdowns
   */
  private static async getExpenseSummary(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{ total: number; byCategory: Record<string, number>; byVendor: Record<string, number> }> {
    // Get total expenses
    const totalResult = await query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM expenses
       WHERE company_id = $1 AND expense_date BETWEEN $2 AND $3`,
      [companyId, startDate, endDate]
    );

    // Get expenses by category
    const categoryResult = await query<{ name: string; total: string }>(
      `SELECT c.name, COALESCE(SUM(e.amount), 0) as total
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.company_id = $1 AND e.expense_date BETWEEN $2 AND $3
       GROUP BY c.name
       ORDER BY total DESC`,
      [companyId, startDate, endDate]
    );

    // Get expenses by vendor
    const vendorResult = await query<{ vendor_name: string; total: string }>(
      `SELECT COALESCE(vendor_name, 'Unknown') as vendor_name, SUM(amount) as total
       FROM expenses
       WHERE company_id = $1 AND expense_date BETWEEN $2 AND $3
       GROUP BY vendor_name
       ORDER BY total DESC
       LIMIT 10`,
      [companyId, startDate, endDate]
    );

    // Also include vendor invoices as expenses
    const invoiceExpenses = await query<{ total: string }>(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM invoices
       WHERE company_id = $1
         AND invoice_type = 'vendor'
         AND status IN ('paid', 'partial')
         AND invoice_date BETWEEN $2 AND $3`,
      [companyId, startDate, endDate]
    );

    const total = parseFloat(totalResult[0]?.total || '0') + parseFloat(invoiceExpenses[0]?.total || '0');

    const byCategory: Record<string, number> = {};
    categoryResult.forEach(row => {
      byCategory[row.name || 'Uncategorized'] = parseFloat(row.total);
    });

    const byVendor: Record<string, number> = {};
    vendorResult.forEach(row => {
      byVendor[row.vendor_name] = parseFloat(row.total);
    });

    return { total, byCategory, byVendor };
  }

  /**
   * Calculate Cost of Goods Sold
   */
  private static async calculateCOGS(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    // COGS from inventory transactions (sales)
    const result = await query<{ total: string }>(
      `SELECT COALESCE(SUM(total_cost), 0) as total
       FROM inventory_transactions it
       JOIN inventory_items ii ON it.inventory_item_id = ii.id
       WHERE ii.company_id = $1
         AND it.transaction_type = 'sale'
         AND it.created_at BETWEEN $2 AND $3`,
      [companyId, startDate, endDate]
    );

    return parseFloat(result[0]?.total || '0');
  }

  /**
   * Get operational costs for a period
   */
  private static async getOperationalCosts(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const days = differenceInDays(endDate, startDate) + 1;

    const result = await query<{ amount: string; frequency: string }>(
      `SELECT amount, frequency
       FROM operational_costs
       WHERE company_id = $1
         AND is_active = true
         AND start_date <= $2
         AND (end_date IS NULL OR end_date >= $3)`,
      [companyId, endDate, startDate]
    );

    let total = 0;
    result.forEach(cost => {
      const amount = parseFloat(cost.amount);
      switch (cost.frequency) {
        case 'daily':
          total += amount * days;
          break;
        case 'weekly':
          total += amount * (days / 7);
          break;
        case 'monthly':
          total += amount * (days / 30);
          break;
        case 'quarterly':
          total += amount * (days / 90);
          break;
        case 'yearly':
          total += amount * (days / 365);
          break;
        case 'one_time':
          total += amount;
          break;
      }
    });

    return Math.round(total * 100) / 100;
  }

  /**
   * Get payroll costs for a period
   */
  private static async getPayrollCosts(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const result = await query<{ total: string }>(
      `SELECT COALESCE(SUM(gross_pay + COALESCE(employer_taxes, 0) + COALESCE(employer_benefits, 0)), 0) as total
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE e.company_id = $1
         AND pr.pay_period_start >= $2
         AND pr.pay_period_end <= $3
         AND pr.status IN ('processed', 'paid')`,
      [companyId, startDate, endDate]
    );

    return parseFloat(result[0]?.total || '0');
  }

  /**
   * Generate time series data for charts
   */
  static async generateTimeSeriesData(
    companyId: string,
    startDate: Date,
    endDate: Date,
    granularity: 'day' | 'month' = 'month'
  ): Promise<TimeSeriesData[]> {
    const intervals = granularity === 'month'
      ? eachMonthOfInterval({ start: startDate, end: endDate })
      : eachDayOfInterval({ start: startDate, end: endDate });

    const data: TimeSeriesData[] = [];

    for (let i = 0; i < intervals.length; i++) {
      const periodStart = intervals[i];
      const periodEnd = granularity === 'month'
        ? endOfMonth(periodStart)
        : periodStart;

      const [revenueResult, expenseResult] = await Promise.all([
        query<{ total: string }>(
          `SELECT COALESCE(SUM(amount), 0) as total FROM revenue
           WHERE company_id = $1 AND revenue_date BETWEEN $2 AND $3`,
          [companyId, periodStart, periodEnd]
        ),
        query<{ total: string }>(
          `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
           WHERE company_id = $1 AND expense_date BETWEEN $2 AND $3`,
          [companyId, periodStart, periodEnd]
        ),
      ]);

      const revenue = parseFloat(revenueResult[0]?.total || '0');
      const expenses = parseFloat(expenseResult[0]?.total || '0');

      data.push({
        date: format(periodStart, granularity === 'month' ? 'MMM yyyy' : 'yyyy-MM-dd'),
        revenue,
        expenses,
        profit: revenue - expenses,
      });
    }

    return data;
  }

  /**
   * Compare two periods
   */
  static async comparePeriods(
    companyId: string,
    currentStart: Date,
    currentEnd: Date,
    previousStart: Date,
    previousEnd: Date
  ): Promise<PeriodComparison> {
    const [current, previous] = await Promise.all([
      this.calculateFinancialSummary(companyId, currentStart, currentEnd),
      this.calculateFinancialSummary(companyId, previousStart, previousEnd),
    ]);

    const calculateChange = (curr: number, prev: number): number => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / Math.abs(prev)) * 100 * 100) / 100;
    };

    return {
      current,
      previous,
      changes: {
        revenue: calculateChange(current.revenue.total, previous.revenue.total),
        expenses: calculateChange(current.expenses.total, previous.expenses.total),
        grossProfit: calculateChange(current.grossProfit, previous.grossProfit),
        netProfit: calculateChange(current.netProfit, previous.netProfit),
        profitMargin: current.profitMargin - previous.profitMargin,
      },
    };
  }

  /**
   * Calculate ROI for a specific investment or period
   */
  static calculateROI(gain: number, cost: number): number {
    if (cost === 0) return 0;
    return Math.round(((gain - cost) / cost) * 100 * 100) / 100;
  }

  /**
   * Get dashboard metrics
   */
  static async getDashboardMetrics(companyId: string): Promise<any> {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const previousMonthStart = startOfMonth(subMonths(now, 1));
    const previousMonthEnd = endOfMonth(subMonths(now, 1));
    const yearStart = startOfYear(now);

    const [
      currentMonth,
      previousMonth,
      yearToDate,
      recentInvoices,
      upcomingPayments,
      lowStockItems,
    ] = await Promise.all([
      this.calculateFinancialSummary(companyId, currentMonthStart, currentMonthEnd),
      this.calculateFinancialSummary(companyId, previousMonthStart, previousMonthEnd),
      this.calculateFinancialSummary(companyId, yearStart, now),
      this.getRecentInvoices(companyId, 5),
      this.getUpcomingPayments(companyId, 5),
      this.getLowStockItems(companyId, 5),
    ]);

    const calculateChange = (curr: number, prev: number): number => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / Math.abs(prev)) * 100);
    };

    return {
      metrics: {
        currentMonth: {
          revenue: currentMonth.revenue.total,
          expenses: currentMonth.expenses.total,
          netProfit: currentMonth.netProfit,
          profitMargin: currentMonth.profitMargin,
        },
        yearToDate: {
          revenue: yearToDate.revenue.total,
          expenses: yearToDate.expenses.total,
          netProfit: yearToDate.netProfit,
          profitMargin: yearToDate.profitMargin,
        },
        changes: {
          revenue: calculateChange(currentMonth.revenue.total, previousMonth.revenue.total),
          expenses: calculateChange(currentMonth.expenses.total, previousMonth.expenses.total),
          netProfit: calculateChange(currentMonth.netProfit, previousMonth.netProfit),
        },
      },
      recentInvoices,
      upcomingPayments,
      lowStockItems,
      expensesByCategory: currentMonth.expenses.byCategory,
      revenueByCategory: currentMonth.revenue.byCategory,
      topVendors: currentMonth.expenses.byVendor,
      topCustomers: currentMonth.revenue.byCustomer,
    };
  }

  private static async getRecentInvoices(companyId: string, limit: number): Promise<any[]> {
    return query(
      `SELECT id, invoice_number, invoice_type, vendor_name, customer_name,
              total_amount, status, invoice_date, due_date
       FROM invoices
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [companyId, limit]
    );
  }

  private static async getUpcomingPayments(companyId: string, limit: number): Promise<any[]> {
    return query(
      `SELECT id, invoice_number, vendor_name, total_amount, due_date
       FROM invoices
       WHERE company_id = $1
         AND invoice_type = 'vendor'
         AND status IN ('pending', 'partial')
         AND due_date >= CURRENT_DATE
       ORDER BY due_date ASC
       LIMIT $2`,
      [companyId, limit]
    );
  }

  private static async getLowStockItems(companyId: string, limit: number): Promise<any[]> {
    return query(
      `SELECT id, sku, name, quantity, reorder_level, unit_cost, selling_price
       FROM inventory_items
       WHERE company_id = $1
         AND is_active = true
         AND track_inventory = true
         AND quantity <= reorder_level
       ORDER BY (reorder_level - quantity) DESC
       LIMIT $2`,
      [companyId, limit]
    );
  }
}

export default CalculationEngine;
