import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, queryOne, transaction } from '../config/database';
import { authenticate, authorize, AuthenticatedRequest, requireCompany } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { asyncHandler, AppError, NotFoundError } from '../middleware/errorHandler';
import { ActivityLogger } from '../services/activityLogger';
import { format, startOfMonth, endOfMonth, addDays } from 'date-fns';

const router = Router();

// Validation schemas
const createPayrollSchema = z.object({
  employeeId: z.string().uuid(),
  payPeriodStart: z.string().transform(s => new Date(s)),
  payPeriodEnd: z.string().transform(s => new Date(s)),
  regularHours: z.number().min(0).default(0),
  overtimeHours: z.number().min(0).default(0),
  ptoHours: z.number().min(0).default(0),
  sickHours: z.number().min(0).default(0),
  holidayHours: z.number().min(0).default(0),
  bonus: z.number().min(0).default(0),
  commission: z.number().min(0).default(0),
  otherEarnings: z.number().min(0).default(0),
  notes: z.string().optional(),
});

const updatePayrollSchema = createPayrollSchema.partial().extend({
  federalTax: z.number().min(0).optional(),
  stateTax: z.number().min(0).optional(),
  localTax: z.number().min(0).optional(),
  socialSecurity: z.number().min(0).optional(),
  medicare: z.number().min(0).optional(),
  healthInsurance: z.number().min(0).optional(),
  dentalInsurance: z.number().min(0).optional(),
  visionInsurance: z.number().min(0).optional(),
  retirement401k: z.number().min(0).optional(),
  otherDeductions: z.number().min(0).optional(),
});

// GET /api/payroll
router.get(
  '/',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      page = 1,
      limit = 20,
      employeeId,
      status,
      startDate,
      endDate,
      sortBy = 'pay_period_end',
      sortOrder = 'desc',
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    let whereClause = 'e.company_id = $1';
    const params: any[] = [req.user!.companyId];
    let paramIndex = 2;

    if (employeeId) {
      whereClause += ` AND pr.employee_id = $${paramIndex++}`;
      params.push(employeeId);
    }

    if (status) {
      whereClause += ` AND pr.status = $${paramIndex++}`;
      params.push(status);
    }

    if (startDate) {
      whereClause += ` AND pr.pay_period_start >= $${paramIndex++}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND pr.pay_period_end <= $${paramIndex++}`;
      params.push(endDate);
    }

    const validSortFields = ['pay_period_end', 'gross_pay', 'net_pay', 'created_at'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'pay_period_end';
    const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [records, countResult] = await Promise.all([
      query(
        `SELECT pr.*, e.employee_number, e.first_name, e.last_name, e.department
         FROM payroll_records pr
         JOIN employees e ON pr.employee_id = e.id
         WHERE ${whereClause}
         ORDER BY pr.${sortField} ${order}
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, Number(limit), offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM payroll_records pr
         JOIN employees e ON pr.employee_id = e.id
         WHERE ${whereClause}`,
        params
      ),
    ]);

    const total = parseInt(countResult[0]?.count || '0');

    // Calculate totals for the filtered records
    const totals = await query<{
      total_gross: string;
      total_net: string;
      total_deductions: string;
      total_employer_cost: string;
    }>(
      `SELECT
         COALESCE(SUM(pr.gross_pay), 0) as total_gross,
         COALESCE(SUM(pr.net_pay), 0) as total_net,
         COALESCE(SUM(pr.total_deductions), 0) as total_deductions,
         COALESCE(SUM(pr.total_employer_cost), 0) as total_employer_cost
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE ${whereClause}`,
      params
    );

    res.json({
      success: true,
      data: records,
      summary: {
        totalGross: parseFloat(totals[0]?.total_gross || '0'),
        totalNet: parseFloat(totals[0]?.total_net || '0'),
        totalDeductions: parseFloat(totals[0]?.total_deductions || '0'),
        totalEmployerCost: parseFloat(totals[0]?.total_employer_cost || '0'),
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

// GET /api/payroll/summary
router.get(
  '/summary',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { year, month } = req.query;

    const now = new Date();
    const targetYear = year ? parseInt(year as string) : now.getFullYear();
    const targetMonth = month ? parseInt(month as string) - 1 : now.getMonth();

    const monthStart = startOfMonth(new Date(targetYear, targetMonth));
    const monthEnd = endOfMonth(new Date(targetYear, targetMonth));

    // Monthly summary
    const monthlySummary = await query<{
      total_gross: string;
      total_net: string;
      total_employer_cost: string;
      record_count: string;
    }>(
      `SELECT
         COALESCE(SUM(pr.gross_pay), 0) as total_gross,
         COALESCE(SUM(pr.net_pay), 0) as total_net,
         COALESCE(SUM(pr.total_employer_cost), 0) as total_employer_cost,
         COUNT(*) as record_count
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE e.company_id = $1
         AND pr.pay_period_start >= $2
         AND pr.pay_period_end <= $3`,
      [req.user!.companyId, monthStart, monthEnd]
    );

    // By department
    const byDepartment = await query(
      `SELECT
         COALESCE(e.department, 'No Department') as department,
         COUNT(DISTINCT e.id) as employee_count,
         SUM(pr.gross_pay) as total_gross,
         SUM(pr.net_pay) as total_net
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE e.company_id = $1
         AND pr.pay_period_start >= $2
         AND pr.pay_period_end <= $3
       GROUP BY e.department
       ORDER BY total_gross DESC`,
      [req.user!.companyId, monthStart, monthEnd]
    );

    // By status
    const byStatus = await query(
      `SELECT
         pr.status,
         COUNT(*) as count,
         SUM(pr.gross_pay) as total_gross
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE e.company_id = $1
         AND pr.pay_period_start >= $2
         AND pr.pay_period_end <= $3
       GROUP BY pr.status`,
      [req.user!.companyId, monthStart, monthEnd]
    );

    res.json({
      success: true,
      data: {
        period: {
          year: targetYear,
          month: targetMonth + 1,
          startDate: format(monthStart, 'yyyy-MM-dd'),
          endDate: format(monthEnd, 'yyyy-MM-dd'),
        },
        summary: {
          totalGross: parseFloat(monthlySummary[0]?.total_gross || '0'),
          totalNet: parseFloat(monthlySummary[0]?.total_net || '0'),
          totalEmployerCost: parseFloat(monthlySummary[0]?.total_employer_cost || '0'),
          recordCount: parseInt(monthlySummary[0]?.record_count || '0'),
        },
        byDepartment,
        byStatus,
      },
    });
  })
);

// GET /api/payroll/:id
router.get(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin', 'manager', 'accountant'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const record = await queryOne(
      `SELECT pr.*, e.employee_number, e.first_name, e.last_name, e.email,
              e.department, e.position, e.pay_type, e.pay_rate
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE pr.id = $1 AND e.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!record) {
      throw new NotFoundError('Payroll record');
    }

    res.json({
      success: true,
      data: record,
    });
  })
);

// POST /api/payroll
router.post(
  '/',
  authenticate,
  requireCompany,
  authorize('admin', 'accountant'),
  validateBody(createPayrollSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;

    // Verify employee belongs to company
    const employee = await queryOne<{
      id: string;
      pay_type: string;
      pay_rate: number;
      overtime_eligible: boolean;
      overtime_rate: number;
    }>(
      'SELECT id, pay_type, pay_rate, overtime_eligible, overtime_rate FROM employees WHERE id = $1 AND company_id = $2',
      [data.employeeId, req.user!.companyId]
    );

    if (!employee) {
      throw new NotFoundError('Employee');
    }

    // Calculate pay
    let regularPay = 0;
    let overtimePay = 0;
    let ptoPay = 0;
    let sickPay = 0;
    let holidayPay = 0;

    if (employee.pay_type === 'hourly') {
      regularPay = data.regularHours * employee.pay_rate;
      overtimePay = employee.overtime_eligible
        ? data.overtimeHours * employee.pay_rate * employee.overtime_rate
        : 0;
      ptoPay = data.ptoHours * employee.pay_rate;
      sickPay = data.sickHours * employee.pay_rate;
      holidayPay = data.holidayHours * employee.pay_rate;
    } else {
      // Salary - calculate per pay period (assuming biweekly)
      const periodDays = Math.ceil(
        (data.payPeriodEnd.getTime() - data.payPeriodStart.getTime()) / (1000 * 60 * 60 * 24)
      );
      regularPay = (employee.pay_rate / 26) * (periodDays / 14);
    }

    const grossPay = regularPay + overtimePay + ptoPay + sickPay + holidayPay +
      data.bonus + data.commission + data.otherEarnings;

    // Estimate taxes (simplified - in production would use proper tax tables)
    const federalTax = grossPay * 0.22; // Simplified federal rate
    const stateTax = grossPay * 0.05; // Simplified state rate
    const localTax = grossPay * 0.01;
    const socialSecurity = Math.min(grossPay * 0.062, 9932.40 / 26); // 2023 limits
    const medicare = grossPay * 0.0145;

    const totalDeductions = federalTax + stateTax + localTax + socialSecurity + medicare;
    const netPay = grossPay - totalDeductions;

    // Employer costs
    const employerTaxes = socialSecurity + medicare + (grossPay * 0.06); // FUTA/SUTA estimate

    const recordId = uuidv4();

    await query(
      `INSERT INTO payroll_records (
        id, employee_id, pay_period_start, pay_period_end,
        regular_hours, overtime_hours, pto_hours, sick_hours, holiday_hours,
        regular_pay, overtime_pay, pto_pay, sick_pay, holiday_pay,
        bonus, commission, other_earnings, gross_pay,
        federal_tax, state_tax, local_tax, social_security, medicare,
        total_deductions, net_pay, employer_taxes, total_employer_cost, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
      [
        recordId,
        data.employeeId,
        data.payPeriodStart,
        data.payPeriodEnd,
        data.regularHours,
        data.overtimeHours,
        data.ptoHours,
        data.sickHours,
        data.holidayHours,
        regularPay,
        overtimePay,
        ptoPay,
        sickPay,
        holidayPay,
        data.bonus,
        data.commission,
        data.otherEarnings,
        grossPay,
        federalTax,
        stateTax,
        localTax,
        socialSecurity,
        medicare,
        totalDeductions,
        netPay,
        employerTaxes,
        grossPay + employerTaxes,
        data.notes || null,
      ]
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'create',
      entityType: 'payroll',
      entityId: recordId,
      newValues: { employeeId: data.employeeId, grossPay, netPay },
      ipAddress: req.ip,
    });

    const record = await queryOne('SELECT * FROM payroll_records WHERE id = $1', [recordId]);

    res.status(201).json({
      success: true,
      message: 'Payroll record created successfully',
      data: record,
    });
  })
);

// POST /api/payroll/generate - Generate payroll for all employees
router.post(
  '/generate',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { payPeriodStart, payPeriodEnd, hoursPerEmployee = 80 } = req.body;

    const start = new Date(payPeriodStart);
    const end = new Date(payPeriodEnd);

    // Get all active employees
    const employees = await query<{
      id: string;
      pay_type: string;
      pay_rate: number;
      overtime_eligible: boolean;
      overtime_rate: number;
    }>(
      `SELECT id, pay_type, pay_rate, overtime_eligible, overtime_rate
       FROM employees
       WHERE company_id = $1 AND status = 'active'`,
      [req.user!.companyId]
    );

    const created: string[] = [];

    for (const emp of employees) {
      // Check if already has a record for this period
      const existing = await queryOne(
        `SELECT id FROM payroll_records
         WHERE employee_id = $1 AND pay_period_start = $2 AND pay_period_end = $3`,
        [emp.id, start, end]
      );

      if (existing) continue;

      let regularPay = 0;
      let regularHours = 0;

      if (emp.pay_type === 'hourly') {
        regularHours = hoursPerEmployee;
        regularPay = regularHours * emp.pay_rate;
      } else {
        regularPay = emp.pay_rate / 26; // Biweekly
      }

      const grossPay = regularPay;
      const federalTax = grossPay * 0.22;
      const stateTax = grossPay * 0.05;
      const localTax = grossPay * 0.01;
      const socialSecurity = grossPay * 0.062;
      const medicare = grossPay * 0.0145;
      const totalDeductions = federalTax + stateTax + localTax + socialSecurity + medicare;
      const netPay = grossPay - totalDeductions;
      const employerTaxes = socialSecurity + medicare + (grossPay * 0.06);

      const recordId = uuidv4();

      await query(
        `INSERT INTO payroll_records (
          id, employee_id, pay_period_start, pay_period_end,
          regular_hours, regular_pay, gross_pay,
          federal_tax, state_tax, local_tax, social_security, medicare,
          total_deductions, net_pay, employer_taxes, total_employer_cost
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          recordId, emp.id, start, end, regularHours, regularPay, grossPay,
          federalTax, stateTax, localTax, socialSecurity, medicare,
          totalDeductions, netPay, employerTaxes, grossPay + employerTaxes,
        ]
      );

      created.push(recordId);
    }

    res.status(201).json({
      success: true,
      message: `Generated ${created.length} payroll records`,
      data: { createdIds: created },
    });
  })
);

// PUT /api/payroll/:id
router.put(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin', 'accountant'),
  validateBody(updatePayrollSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;

    const currentRecord = await queryOne(
      `SELECT pr.* FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE pr.id = $1 AND e.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!currentRecord) {
      throw new NotFoundError('Payroll record');
    }

    if ((currentRecord as any).status === 'paid') {
      throw new AppError('Cannot modify a paid payroll record', 400);
    }

    const fieldMapping: Record<string, string> = {
      regularHours: 'regular_hours',
      overtimeHours: 'overtime_hours',
      ptoHours: 'pto_hours',
      sickHours: 'sick_hours',
      holidayHours: 'holiday_hours',
      bonus: 'bonus',
      commission: 'commission',
      otherEarnings: 'other_earnings',
      federalTax: 'federal_tax',
      stateTax: 'state_tax',
      localTax: 'local_tax',
      socialSecurity: 'social_security',
      medicare: 'medicare',
      healthInsurance: 'health_insurance',
      dentalInsurance: 'dental_insurance',
      visionInsurance: 'vision_insurance',
      retirement401k: 'retirement_401k',
      otherDeductions: 'other_deductions',
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
        `UPDATE payroll_records SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      // Recalculate totals
      await query(
        `UPDATE payroll_records SET
           gross_pay = regular_pay + overtime_pay + pto_pay + sick_pay + holiday_pay + bonus + commission + other_earnings,
           total_deductions = federal_tax + state_tax + local_tax + social_security + medicare + health_insurance + dental_insurance + vision_insurance + retirement_401k + other_deductions,
           net_pay = (regular_pay + overtime_pay + pto_pay + sick_pay + holiday_pay + bonus + commission + other_earnings) - (federal_tax + state_tax + local_tax + social_security + medicare + health_insurance + dental_insurance + vision_insurance + retirement_401k + other_deductions)
         WHERE id = $1`,
        [id]
      );
    }

    const record = await queryOne('SELECT * FROM payroll_records WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Payroll record updated successfully',
      data: record,
    });
  })
);

// POST /api/payroll/:id/approve
router.post(
  '/:id/approve',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const record = await queryOne(
      `SELECT pr.* FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE pr.id = $1 AND e.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!record) {
      throw new NotFoundError('Payroll record');
    }

    await query(
      `UPDATE payroll_records
       SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [req.user!.id, id]
    );

    res.json({
      success: true,
      message: 'Payroll record approved',
    });
  })
);

// POST /api/payroll/:id/process
router.post(
  '/:id/process',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { paymentDate, paymentMethod, checkNumber } = req.body;

    const record = await queryOne<{ status: string }>(
      `SELECT pr.status FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE pr.id = $1 AND e.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!record) {
      throw new NotFoundError('Payroll record');
    }

    if (record.status !== 'approved') {
      throw new AppError('Payroll must be approved before processing', 400);
    }

    await query(
      `UPDATE payroll_records
       SET status = 'paid', payment_date = $1, payment_method = $2, check_number = $3,
           processed_by = $4, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [paymentDate || new Date(), paymentMethod || 'direct_deposit', checkNumber || null, req.user!.id, id]
    );

    res.json({
      success: true,
      message: 'Payroll processed successfully',
    });
  })
);

// DELETE /api/payroll/:id
router.delete(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const record = await queryOne<{ status: string }>(
      `SELECT pr.* FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE pr.id = $1 AND e.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!record) {
      throw new NotFoundError('Payroll record');
    }

    if (record.status === 'paid') {
      throw new AppError('Cannot delete a paid payroll record', 400);
    }

    await query('DELETE FROM payroll_records WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Payroll record deleted successfully',
    });
  })
);

export default router;
