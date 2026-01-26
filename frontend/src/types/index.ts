// User Types
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  companyId: string | null;
  companyName?: string;
}

export type UserRole = 'admin' | 'manager' | 'accountant' | 'employee';

// Company Types
export interface Company {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  currency: string;
  fiscalYearStart: number;
}

// Invoice Types
export interface Invoice {
  id: string;
  invoiceNumber: string;
  invoiceType: 'vendor' | 'customer';
  vendorName?: string;
  customerName?: string;
  invoiceDate: string;
  dueDate?: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  amountPaid: number;
  status: InvoiceStatus;
  createdAt: string;
}

export type InvoiceStatus = 'draft' | 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
}

// Expense Types
export interface Expense {
  id: string;
  categoryId?: string;
  categoryName?: string;
  categoryColor?: string;
  vendorName?: string;
  description: string;
  amount: number;
  taxAmount: number;
  expenseDate: string;
  paymentMethod?: string;
  status: 'pending' | 'approved' | 'rejected' | 'reimbursed';
  isRecurring: boolean;
  isTaxDeductible: boolean;
  createdAt: string;
}

// Revenue Types
export interface Revenue {
  id: string;
  categoryId?: string;
  categoryName?: string;
  customerName?: string;
  description: string;
  amount: number;
  revenueDate: string;
  createdAt: string;
}

// Category Types
export interface Category {
  id: string;
  name: string;
  type: 'expense' | 'revenue';
  color?: string;
  icon?: string;
  isActive: boolean;
  children?: Category[];
}

// Inventory Types
export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;
  quantity: number;
  unitCost: number;
  sellingPrice: number;
  reorderLevel: number;
  locationName?: string;
  supplierName?: string;
  isActive: boolean;
  trackInventory: boolean;
}

export interface InventoryTransaction {
  id: string;
  transactionType: 'purchase' | 'sale' | 'adjustment' | 'transfer' | 'return' | 'write_off';
  quantity: number;
  unitCost: number;
  totalCost: number;
  notes?: string;
  createdAt: string;
}

// Employee Types
export interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  department?: string;
  position?: string;
  hireDate: string;
  terminationDate?: string;
  employmentType: 'full_time' | 'part_time' | 'contractor' | 'intern' | 'temporary';
  payType: 'hourly' | 'salary' | 'commission' | 'mixed';
  payRate: number;
  status: 'active' | 'inactive' | 'on_leave' | 'terminated';
}

export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeNumber?: string;
  firstName?: string;
  lastName?: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  status: 'draft' | 'pending' | 'approved' | 'processed' | 'paid';
}

// Dashboard Types
export interface DashboardMetrics {
  currentMonth: {
    revenue: number;
    expenses: number;
    netProfit: number;
    profitMargin: number;
  };
  yearToDate: {
    revenue: number;
    expenses: number;
    netProfit: number;
    profitMargin: number;
  };
  changes: {
    revenue: number;
    expenses: number;
    netProfit: number;
  };
}

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string;
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Filter Types
export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface TableFilters {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  [key: string]: string | number | boolean | undefined;
}
