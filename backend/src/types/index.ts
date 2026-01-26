// Core Types for BusinessHub

export interface User {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  company_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type UserRole = 'admin' | 'manager' | 'accountant' | 'employee';

export interface Company {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  currency: string;
  fiscal_year_start: number;
  created_at: Date;
  updated_at: Date;
}

export interface Invoice {
  id: string;
  company_id: string;
  invoice_number: string;
  invoice_type: 'vendor' | 'customer';
  vendor_name: string | null;
  customer_name: string | null;
  invoice_date: Date;
  due_date: Date | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: InvoiceStatus;
  file_path: string | null;
  notes: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  total: number;
  inventory_item_id: string | null;
  created_at: Date;
}

export interface Expense {
  id: string;
  company_id: string;
  category_id: string;
  vendor_name: string | null;
  description: string;
  amount: number;
  expense_date: Date;
  payment_method: string | null;
  receipt_path: string | null;
  is_recurring: boolean;
  recurrence_interval: string | null;
  invoice_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface Revenue {
  id: string;
  company_id: string;
  category_id: string;
  customer_name: string | null;
  description: string;
  amount: number;
  revenue_date: Date;
  invoice_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface Category {
  id: string;
  company_id: string;
  name: string;
  type: 'expense' | 'revenue';
  parent_id: string | null;
  color: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface InventoryItem {
  id: string;
  company_id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  quantity: number;
  unit_cost: number;
  selling_price: number;
  reorder_level: number;
  location_id: string | null;
  supplier_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface InventoryLocation {
  id: string;
  company_id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface InventoryTransaction {
  id: string;
  inventory_item_id: string;
  transaction_type: 'purchase' | 'sale' | 'adjustment' | 'transfer';
  quantity: number;
  unit_cost: number;
  total_cost: number;
  reference_id: string | null;
  notes: string | null;
  created_by: string;
  created_at: Date;
}

export interface Employee {
  id: string;
  company_id: string;
  user_id: string | null;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department: string | null;
  position: string | null;
  hire_date: Date;
  termination_date: Date | null;
  employment_type: EmploymentType;
  pay_type: PayType;
  pay_rate: number;
  status: EmployeeStatus;
  created_at: Date;
  updated_at: Date;
}

export type EmploymentType = 'full_time' | 'part_time' | 'contractor' | 'intern';
export type PayType = 'hourly' | 'salary' | 'commission';
export type EmployeeStatus = 'active' | 'inactive' | 'terminated';

export interface PayrollRecord {
  id: string;
  employee_id: string;
  pay_period_start: Date;
  pay_period_end: Date;
  gross_pay: number;
  deductions: number;
  net_pay: number;
  hours_worked: number | null;
  overtime_hours: number | null;
  overtime_pay: number;
  bonus: number;
  commission: number;
  taxes: number;
  benefits_deduction: number;
  status: PayrollStatus;
  payment_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type PayrollStatus = 'draft' | 'pending' | 'processed' | 'paid';

export interface OperationalCost {
  id: string;
  company_id: string;
  name: string;
  category: string;
  amount: number;
  frequency: CostFrequency;
  start_date: Date;
  end_date: Date | null;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export type CostFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'one_time';

export interface ActivityLog {
  id: string;
  user_id: string;
  company_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: Date;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Dashboard Types
export interface DashboardMetrics {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  cashFlow: number;
  revenueChange: number;
  expensesChange: number;
  profitChange: number;
}

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string;
  }[];
}

export interface FinancialPeriod {
  startDate: Date;
  endDate: Date;
  revenue: number;
  expenses: number;
  grossProfit: number;
  operatingCosts: number;
  netProfit: number;
  profitMargin: number;
}

// Request Types
export interface AuthRequest {
  email: string;
  password: string;
}

export interface RegisterRequest extends AuthRequest {
  firstName: string;
  lastName: string;
  companyName?: string;
}

export interface InvoiceImportResult {
  success: boolean;
  invoice?: Partial<Invoice>;
  lineItems?: Partial<InvoiceLineItem>[];
  errors?: string[];
  confidence?: number;
}

export interface ExpenseCategorizationResult {
  categoryId: string;
  categoryName: string;
  confidence: number;
  suggestedAlternatives?: { categoryId: string; categoryName: string; confidence: number }[];
}
