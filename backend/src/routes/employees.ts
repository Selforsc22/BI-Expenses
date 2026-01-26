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
const createEmployeeSchema = z.object({
  employeeNumber: z.string().min(1, 'Employee number is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email'),
  phone: z.string().optional(),
  address: z.string().optional(),
  dateOfBirth: z.string().optional().transform(s => s ? new Date(s) : undefined),
  department: z.string().optional(),
  position: z.string().optional(),
  managerId: z.string().uuid().optional(),
  hireDate: z.string().transform(s => new Date(s)),
  employmentType: z.enum(['full_time', 'part_time', 'contractor', 'intern', 'temporary']).default('full_time'),
  payType: z.enum(['hourly', 'salary', 'commission', 'mixed']).default('salary'),
  payRate: z.number().min(0),
  payFrequency: z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']).default('biweekly'),
  overtimeEligible: z.boolean().default(false),
  overtimeRate: z.number().min(1).default(1.5),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
});

const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  status: z.enum(['active', 'inactive', 'on_leave', 'terminated']).optional(),
  terminationDate: z.string().optional().transform(s => s ? new Date(s) : undefined),
});

const timeOffRequestSchema = z.object({
  requestType: z.enum(['vacation', 'sick', 'personal', 'bereavement', 'jury_duty', 'other']),
  startDate: z.string().transform(s => new Date(s)),
  endDate: z.string().transform(s => new Date(s)),
  hoursRequested: z.number().min(0).optional(),
  reason: z.string().optional(),
});

// GET /api/employees
router.get(
  '/',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      page = 1,
      limit = 20,
      department,
      status = 'active',
      employmentType,
      search,
      sortBy = 'last_name',
      sortOrder = 'asc',
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    let whereClause = 'e.company_id = $1';
    const params: any[] = [req.user!.companyId];
    let paramIndex = 2;

    if (status && status !== 'all') {
      whereClause += ` AND e.status = $${paramIndex++}`;
      params.push(status);
    }

    if (department) {
      whereClause += ` AND e.department = $${paramIndex++}`;
      params.push(department);
    }

    if (employmentType) {
      whereClause += ` AND e.employment_type = $${paramIndex++}`;
      params.push(employmentType);
    }

    if (search) {
      whereClause += ` AND (e.first_name ILIKE $${paramIndex} OR e.last_name ILIKE $${paramIndex} OR e.email ILIKE $${paramIndex} OR e.employee_number ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const validSortFields = ['last_name', 'first_name', 'hire_date', 'department', 'position'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'last_name';
    const order = sortOrder === 'desc' ? 'DESC' : 'ASC';

    const [employees, countResult] = await Promise.all([
      query(
        `SELECT e.*, m.first_name as manager_first_name, m.last_name as manager_last_name
         FROM employees e
         LEFT JOIN employees m ON e.manager_id = m.id
         WHERE ${whereClause}
         ORDER BY e.${sortField} ${order}
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        [...params, Number(limit), offset]
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM employees e WHERE ${whereClause}`,
        params
      ),
    ]);

    const total = parseInt(countResult[0]?.count || '0');

    res.json({
      success: true,
      data: employees,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  })
);

// GET /api/employees/departments
router.get(
  '/departments',
  authenticate,
  requireCompany,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const departments = await query(
      `SELECT department, COUNT(*) as employee_count
       FROM employees
       WHERE company_id = $1 AND status = 'active' AND department IS NOT NULL
       GROUP BY department
       ORDER BY department`,
      [req.user!.companyId]
    );

    res.json({
      success: true,
      data: departments,
    });
  })
);

// GET /api/employees/summary
router.get(
  '/summary',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const [countsByStatus, countsByType, payrollSummary] = await Promise.all([
      query(
        `SELECT status, COUNT(*) as count
         FROM employees WHERE company_id = $1
         GROUP BY status`,
        [req.user!.companyId]
      ),
      query(
        `SELECT employment_type, COUNT(*) as count
         FROM employees WHERE company_id = $1 AND status = 'active'
         GROUP BY employment_type`,
        [req.user!.companyId]
      ),
      query<{ total_payroll: string; avg_salary: string }>(
        `SELECT
           SUM(CASE WHEN pay_type = 'salary' THEN pay_rate ELSE pay_rate * 2080 END) as total_payroll,
           AVG(CASE WHEN pay_type = 'salary' THEN pay_rate ELSE pay_rate * 2080 END) as avg_salary
         FROM employees WHERE company_id = $1 AND status = 'active'`,
        [req.user!.companyId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        countsByStatus,
        countsByType,
        totalAnnualPayroll: parseFloat(payrollSummary[0]?.total_payroll || '0'),
        averageSalary: parseFloat(payrollSummary[0]?.avg_salary || '0'),
      },
    });
  })
);

// GET /api/employees/:id
router.get(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const employee = await queryOne(
      `SELECT e.*, m.first_name as manager_first_name, m.last_name as manager_last_name
       FROM employees e
       LEFT JOIN employees m ON e.manager_id = m.id
       WHERE e.id = $1 AND e.company_id = $2`,
      [id, req.user!.companyId]
    );

    if (!employee) {
      throw new NotFoundError('Employee');
    }

    // Get benefits
    const benefits = await query(
      'SELECT * FROM employee_benefits WHERE employee_id = $1 AND is_active = true',
      [id]
    );

    // Get recent time off requests
    const timeOffRequests = await query(
      `SELECT * FROM time_off_requests
       WHERE employee_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [id]
    );

    // Get recent payroll records
    const payrollRecords = await query(
      `SELECT * FROM payroll_records
       WHERE employee_id = $1
       ORDER BY pay_period_end DESC
       LIMIT 5`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...employee,
        benefits,
        timeOffRequests,
        payrollRecords,
      },
    });
  })
);

// POST /api/employees
router.post(
  '/',
  authenticate,
  requireCompany,
  authorize('admin'),
  validateBody(createEmployeeSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;

    // Check for duplicate employee number
    const existing = await queryOne(
      'SELECT id FROM employees WHERE company_id = $1 AND employee_number = $2',
      [req.user!.companyId, data.employeeNumber]
    );

    if (existing) {
      throw new AppError('An employee with this number already exists', 409);
    }

    const employeeId = uuidv4();

    await query(
      `INSERT INTO employees (
        id, company_id, employee_number, first_name, last_name, email, phone,
        address, date_of_birth, department, position, manager_id, hire_date,
        employment_type, pay_type, pay_rate, pay_frequency, overtime_eligible,
        overtime_rate, emergency_contact_name, emergency_contact_phone
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        employeeId,
        req.user!.companyId,
        data.employeeNumber,
        data.firstName,
        data.lastName,
        data.email,
        data.phone || null,
        data.address || null,
        data.dateOfBirth || null,
        data.department || null,
        data.position || null,
        data.managerId || null,
        data.hireDate,
        data.employmentType,
        data.payType,
        data.payRate,
        data.payFrequency,
        data.overtimeEligible,
        data.overtimeRate,
        data.emergencyContactName || null,
        data.emergencyContactPhone || null,
      ]
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'create',
      entityType: 'employee',
      entityId: employeeId,
      newValues: { ...data, payRate: '[REDACTED]' },
      ipAddress: req.ip,
    });

    const employee = await queryOne('SELECT * FROM employees WHERE id = $1', [employeeId]);

    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      data: employee,
    });
  })
);

// PUT /api/employees/:id
router.put(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin'),
  validateBody(updateEmployeeSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const updates = req.body;

    const currentEmployee = await queryOne(
      'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!currentEmployee) {
      throw new NotFoundError('Employee');
    }

    const fieldMapping: Record<string, string> = {
      employeeNumber: 'employee_number',
      firstName: 'first_name',
      lastName: 'last_name',
      email: 'email',
      phone: 'phone',
      address: 'address',
      dateOfBirth: 'date_of_birth',
      department: 'department',
      position: 'position',
      managerId: 'manager_id',
      hireDate: 'hire_date',
      terminationDate: 'termination_date',
      employmentType: 'employment_type',
      payType: 'pay_type',
      payRate: 'pay_rate',
      payFrequency: 'pay_frequency',
      overtimeEligible: 'overtime_eligible',
      overtimeRate: 'overtime_rate',
      status: 'status',
      emergencyContactName: 'emergency_contact_name',
      emergencyContactPhone: 'emergency_contact_phone',
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
        `UPDATE employees SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'update',
      entityType: 'employee',
      entityId: id,
      oldValues: { ...currentEmployee, pay_rate: '[REDACTED]' },
      newValues: { ...updates, payRate: updates.payRate ? '[REDACTED]' : undefined },
      ipAddress: req.ip,
    });

    const employee = await queryOne('SELECT * FROM employees WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Employee updated successfully',
      data: employee,
    });
  })
);

// POST /api/employees/:id/time-off - Request time off
router.post(
  '/:id/time-off',
  authenticate,
  requireCompany,
  validateBody(timeOffRequestSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const data = req.body;

    const employee = await queryOne(
      'SELECT id FROM employees WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!employee) {
      throw new NotFoundError('Employee');
    }

    const requestId = uuidv4();

    await query(
      `INSERT INTO time_off_requests (
        id, employee_id, request_type, start_date, end_date, hours_requested, reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        requestId,
        id,
        data.requestType,
        data.startDate,
        data.endDate,
        data.hoursRequested || null,
        data.reason || null,
      ]
    );

    const request = await queryOne('SELECT * FROM time_off_requests WHERE id = $1', [requestId]);

    res.status(201).json({
      success: true,
      message: 'Time off request submitted',
      data: request,
    });
  })
);

// PUT /api/employees/:id/time-off/:requestId - Approve/reject time off
router.put(
  '/:id/time-off/:requestId',
  authenticate,
  requireCompany,
  authorize('admin', 'manager'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id, requestId } = req.params;
    const { status, notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      throw new AppError('Status must be approved or rejected', 400);
    }

    const request = await queryOne(
      `SELECT tor.* FROM time_off_requests tor
       JOIN employees e ON tor.employee_id = e.id
       WHERE tor.id = $1 AND e.id = $2 AND e.company_id = $3`,
      [requestId, id, req.user!.companyId]
    );

    if (!request) {
      throw new NotFoundError('Time off request');
    }

    await query(
      `UPDATE time_off_requests
       SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, notes = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [status, req.user!.id, notes || null, requestId]
    );

    const updatedRequest = await queryOne('SELECT * FROM time_off_requests WHERE id = $1', [requestId]);

    res.json({
      success: true,
      message: `Time off request ${status}`,
      data: updatedRequest,
    });
  })
);

// DELETE /api/employees/:id
router.delete(
  '/:id',
  authenticate,
  requireCompany,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const employee = await queryOne(
      'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
      [id, req.user!.companyId]
    );

    if (!employee) {
      throw new NotFoundError('Employee');
    }

    // Soft delete by terminating
    await query(
      `UPDATE employees
       SET status = 'terminated', termination_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    await ActivityLogger.log({
      userId: req.user!.id,
      companyId: req.user!.companyId!,
      action: 'delete',
      entityType: 'employee',
      entityId: id,
      oldValues: { status: 'terminated' },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: 'Employee terminated successfully',
    });
  })
);

export default router;
