-- BusinessHub Database Schema
-- Initial migration: Core tables for the business management platform

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- COMPANIES TABLE
-- =====================================================
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    tax_id VARCHAR(100),
    currency VARCHAR(3) DEFAULT 'USD',
    fiscal_year_start INTEGER DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
    logo_path VARCHAR(500),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_companies_name ON companies(name);

-- =====================================================
-- USERS TABLE
-- =====================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'employee'
        CHECK (role IN ('admin', 'manager', 'accountant', 'employee')),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_login TIMESTAMP WITH TIME ZONE,
    reset_token VARCHAR(255),
    reset_token_expires TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_role ON users(role);

-- =====================================================
-- USER_COMPANY_ACCESS (Multi-company access support)
-- =====================================================
CREATE TABLE user_company_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'employee'
        CHECK (role IN ('admin', 'manager', 'accountant', 'employee')),
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, company_id)
);

CREATE INDEX idx_user_company_access_user ON user_company_access(user_id);
CREATE INDEX idx_user_company_access_company ON user_company_access(company_id);

-- =====================================================
-- CATEGORIES TABLE (Expense/Revenue categories)
-- =====================================================
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('expense', 'revenue')),
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    color VARCHAR(7),
    icon VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, name, type)
);

CREATE INDEX idx_categories_company ON categories(company_id);
CREATE INDEX idx_categories_type ON categories(type);
CREATE INDEX idx_categories_parent ON categories(parent_id);

-- =====================================================
-- INVOICES TABLE
-- =====================================================
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    invoice_number VARCHAR(100) NOT NULL,
    invoice_type VARCHAR(20) NOT NULL CHECK (invoice_type IN ('vendor', 'customer')),
    vendor_name VARCHAR(255),
    customer_name VARCHAR(255),
    vendor_id UUID,
    customer_id UUID,
    invoice_date DATE NOT NULL,
    due_date DATE,
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    discount_amount DECIMAL(15, 2) DEFAULT 0,
    shipping_amount DECIMAL(15, 2) DEFAULT 0,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(15, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('draft', 'pending', 'partial', 'paid', 'overdue', 'cancelled')),
    currency VARCHAR(3) DEFAULT 'USD',
    payment_terms VARCHAR(100),
    file_path VARCHAR(500),
    original_filename VARCHAR(255),
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, invoice_number, invoice_type)
);

CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_type ON invoices(invoice_type);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_vendor ON invoices(vendor_name);
CREATE INDEX idx_invoices_customer ON invoices(customer_name);

-- =====================================================
-- INVOICE_LINE_ITEMS TABLE
-- =====================================================
CREATE TABLE invoice_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity DECIMAL(15, 4) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 4) NOT NULL,
    tax_rate DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    discount_amount DECIMAL(15, 2) DEFAULT 0,
    total DECIMAL(15, 2) NOT NULL,
    inventory_item_id UUID,
    category_id UUID REFERENCES categories(id),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX idx_line_items_inventory ON invoice_line_items(inventory_item_id);

-- =====================================================
-- EXPENSES TABLE
-- =====================================================
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    vendor_name VARCHAR(255),
    vendor_id UUID,
    description TEXT NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    expense_date DATE NOT NULL,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(255),
    receipt_path VARCHAR(500),
    is_recurring BOOLEAN DEFAULT false,
    recurrence_interval VARCHAR(20),
    recurrence_end_date DATE,
    parent_expense_id UUID REFERENCES expenses(id),
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    is_tax_deductible BOOLEAN DEFAULT true,
    tags TEXT[],
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'reimbursed')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_expenses_company ON expenses(company_id);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_date ON expenses(expense_date);
CREATE INDEX idx_expenses_vendor ON expenses(vendor_name);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_recurring ON expenses(is_recurring);

-- =====================================================
-- REVENUE TABLE
-- =====================================================
CREATE TABLE revenue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    customer_name VARCHAR(255),
    customer_id UUID,
    description TEXT NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    revenue_date DATE NOT NULL,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(255),
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    is_recurring BOOLEAN DEFAULT false,
    recurrence_interval VARCHAR(20),
    tags TEXT[],
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_revenue_company ON revenue(company_id);
CREATE INDEX idx_revenue_category ON revenue(category_id);
CREATE INDEX idx_revenue_date ON revenue(revenue_date);
CREATE INDEX idx_revenue_customer ON revenue(customer_name);

-- =====================================================
-- INVENTORY_LOCATIONS TABLE
-- =====================================================
CREATE TABLE inventory_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, name)
);

CREATE INDEX idx_inventory_locations_company ON inventory_locations(company_id);

-- =====================================================
-- SUPPLIERS TABLE
-- =====================================================
CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    website VARCHAR(255),
    tax_id VARCHAR(100),
    payment_terms VARCHAR(100),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, name)
);

CREATE INDEX idx_suppliers_company ON suppliers(company_id);
CREATE INDEX idx_suppliers_name ON suppliers(name);

-- =====================================================
-- INVENTORY_ITEMS TABLE
-- =====================================================
CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    unit VARCHAR(50) DEFAULT 'unit',
    quantity DECIMAL(15, 4) DEFAULT 0,
    reserved_quantity DECIMAL(15, 4) DEFAULT 0,
    unit_cost DECIMAL(15, 4) DEFAULT 0,
    selling_price DECIMAL(15, 4) DEFAULT 0,
    reorder_level DECIMAL(15, 4) DEFAULT 0,
    reorder_quantity DECIMAL(15, 4) DEFAULT 0,
    location_id UUID REFERENCES inventory_locations(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    barcode VARCHAR(100),
    image_path VARCHAR(500),
    weight DECIMAL(10, 4),
    dimensions VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    is_service BOOLEAN DEFAULT false,
    track_inventory BOOLEAN DEFAULT true,
    tags TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, sku)
);

CREATE INDEX idx_inventory_company ON inventory_items(company_id);
CREATE INDEX idx_inventory_sku ON inventory_items(sku);
CREATE INDEX idx_inventory_name ON inventory_items(name);
CREATE INDEX idx_inventory_category ON inventory_items(category);
CREATE INDEX idx_inventory_location ON inventory_items(location_id);
CREATE INDEX idx_inventory_supplier ON inventory_items(supplier_id);
CREATE INDEX idx_inventory_low_stock ON inventory_items(quantity) WHERE quantity <= reorder_level;

-- =====================================================
-- INVENTORY_TRANSACTIONS TABLE
-- =====================================================
CREATE TABLE inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    transaction_type VARCHAR(20) NOT NULL
        CHECK (transaction_type IN ('purchase', 'sale', 'adjustment', 'transfer', 'return', 'write_off')),
    quantity DECIMAL(15, 4) NOT NULL,
    unit_cost DECIMAL(15, 4),
    total_cost DECIMAL(15, 2),
    from_location_id UUID REFERENCES inventory_locations(id),
    to_location_id UUID REFERENCES inventory_locations(id),
    reference_type VARCHAR(50),
    reference_id UUID,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_inv_trans_item ON inventory_transactions(inventory_item_id);
CREATE INDEX idx_inv_trans_type ON inventory_transactions(transaction_type);
CREATE INDEX idx_inv_trans_date ON inventory_transactions(created_at);

-- =====================================================
-- EMPLOYEES TABLE
-- =====================================================
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    employee_number VARCHAR(50) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    date_of_birth DATE,
    ssn_last_four VARCHAR(4),
    department VARCHAR(100),
    position VARCHAR(100),
    manager_id UUID REFERENCES employees(id),
    hire_date DATE NOT NULL,
    termination_date DATE,
    employment_type VARCHAR(20) NOT NULL DEFAULT 'full_time'
        CHECK (employment_type IN ('full_time', 'part_time', 'contractor', 'intern', 'temporary')),
    pay_type VARCHAR(20) NOT NULL DEFAULT 'salary'
        CHECK (pay_type IN ('hourly', 'salary', 'commission', 'mixed')),
    pay_rate DECIMAL(15, 4) NOT NULL DEFAULT 0,
    pay_frequency VARCHAR(20) DEFAULT 'biweekly'
        CHECK (pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
    overtime_eligible BOOLEAN DEFAULT false,
    overtime_rate DECIMAL(5, 2) DEFAULT 1.5,
    status VARCHAR(20) DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'on_leave', 'terminated')),
    bank_account_number VARCHAR(50),
    bank_routing_number VARCHAR(50),
    tax_filing_status VARCHAR(50),
    allowances INTEGER DEFAULT 0,
    additional_withholding DECIMAL(15, 2) DEFAULT 0,
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(50),
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, employee_number)
);

CREATE INDEX idx_employees_company ON employees(company_id);
CREATE INDEX idx_employees_user ON employees(user_id);
CREATE INDEX idx_employees_department ON employees(department);
CREATE INDEX idx_employees_status ON employees(status);
CREATE INDEX idx_employees_manager ON employees(manager_id);

-- =====================================================
-- EMPLOYEE_BENEFITS TABLE
-- =====================================================
CREATE TABLE employee_benefits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    benefit_type VARCHAR(100) NOT NULL,
    plan_name VARCHAR(255),
    coverage_type VARCHAR(50),
    employee_contribution DECIMAL(15, 2) DEFAULT 0,
    employer_contribution DECIMAL(15, 2) DEFAULT 0,
    start_date DATE NOT NULL,
    end_date DATE,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_emp_benefits_employee ON employee_benefits(employee_id);
CREATE INDEX idx_emp_benefits_type ON employee_benefits(benefit_type);

-- =====================================================
-- TIME_OFF_REQUESTS TABLE
-- =====================================================
CREATE TABLE time_off_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    request_type VARCHAR(50) NOT NULL
        CHECK (request_type IN ('vacation', 'sick', 'personal', 'bereavement', 'jury_duty', 'other')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    hours_requested DECIMAL(6, 2),
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reason TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_time_off_employee ON time_off_requests(employee_id);
CREATE INDEX idx_time_off_dates ON time_off_requests(start_date, end_date);
CREATE INDEX idx_time_off_status ON time_off_requests(status);

-- =====================================================
-- PAYROLL_RECORDS TABLE
-- =====================================================
CREATE TABLE payroll_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    pay_period_start DATE NOT NULL,
    pay_period_end DATE NOT NULL,
    regular_hours DECIMAL(6, 2) DEFAULT 0,
    overtime_hours DECIMAL(6, 2) DEFAULT 0,
    pto_hours DECIMAL(6, 2) DEFAULT 0,
    sick_hours DECIMAL(6, 2) DEFAULT 0,
    holiday_hours DECIMAL(6, 2) DEFAULT 0,
    regular_pay DECIMAL(15, 2) DEFAULT 0,
    overtime_pay DECIMAL(15, 2) DEFAULT 0,
    pto_pay DECIMAL(15, 2) DEFAULT 0,
    sick_pay DECIMAL(15, 2) DEFAULT 0,
    holiday_pay DECIMAL(15, 2) DEFAULT 0,
    bonus DECIMAL(15, 2) DEFAULT 0,
    commission DECIMAL(15, 2) DEFAULT 0,
    other_earnings DECIMAL(15, 2) DEFAULT 0,
    gross_pay DECIMAL(15, 2) NOT NULL,
    federal_tax DECIMAL(15, 2) DEFAULT 0,
    state_tax DECIMAL(15, 2) DEFAULT 0,
    local_tax DECIMAL(15, 2) DEFAULT 0,
    social_security DECIMAL(15, 2) DEFAULT 0,
    medicare DECIMAL(15, 2) DEFAULT 0,
    health_insurance DECIMAL(15, 2) DEFAULT 0,
    dental_insurance DECIMAL(15, 2) DEFAULT 0,
    vision_insurance DECIMAL(15, 2) DEFAULT 0,
    retirement_401k DECIMAL(15, 2) DEFAULT 0,
    other_deductions DECIMAL(15, 2) DEFAULT 0,
    total_deductions DECIMAL(15, 2) NOT NULL,
    net_pay DECIMAL(15, 2) NOT NULL,
    employer_taxes DECIMAL(15, 2) DEFAULT 0,
    employer_benefits DECIMAL(15, 2) DEFAULT 0,
    total_employer_cost DECIMAL(15, 2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending', 'approved', 'processed', 'paid', 'void')),
    payment_date DATE,
    payment_method VARCHAR(50),
    check_number VARCHAR(50),
    notes TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    processed_by UUID REFERENCES users(id),
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payroll_employee ON payroll_records(employee_id);
CREATE INDEX idx_payroll_period ON payroll_records(pay_period_start, pay_period_end);
CREATE INDEX idx_payroll_status ON payroll_records(status);
CREATE INDEX idx_payroll_payment_date ON payroll_records(payment_date);

-- =====================================================
-- OPERATIONAL_COSTS TABLE (Fixed costs)
-- =====================================================
CREATE TABLE operational_costs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT,
    amount DECIMAL(15, 2) NOT NULL,
    frequency VARCHAR(20) NOT NULL
        CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'one_time')),
    start_date DATE NOT NULL,
    end_date DATE,
    vendor_name VARCHAR(255),
    vendor_id UUID REFERENCES suppliers(id),
    is_active BOOLEAN DEFAULT true,
    is_variable BOOLEAN DEFAULT false,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_op_costs_company ON operational_costs(company_id);
CREATE INDEX idx_op_costs_category ON operational_costs(category);
CREATE INDEX idx_op_costs_active ON operational_costs(is_active);

-- =====================================================
-- ACTIVITY_LOG TABLE (Audit trail)
-- =====================================================
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_user ON activity_logs(user_id);
CREATE INDEX idx_activity_company ON activity_logs(company_id);
CREATE INDEX idx_activity_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_date ON activity_logs(created_at);

-- =====================================================
-- VENDOR_CATEGORY_RULES TABLE (Auto-categorization)
-- =====================================================
CREATE TABLE vendor_category_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    vendor_pattern VARCHAR(255) NOT NULL,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, vendor_pattern)
);

CREATE INDEX idx_vendor_rules_company ON vendor_category_rules(company_id);

-- =====================================================
-- SAVED_REPORTS TABLE
-- =====================================================
CREATE TABLE saved_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    report_type VARCHAR(50) NOT NULL,
    filters JSONB DEFAULT '{}',
    columns JSONB DEFAULT '[]',
    is_public BOOLEAN DEFAULT false,
    schedule VARCHAR(50),
    last_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_saved_reports_company ON saved_reports(company_id);
CREATE INDEX idx_saved_reports_user ON saved_reports(created_by);

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update trigger to all tables with updated_at
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_revenue_updated_at BEFORE UPDATE ON revenue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_items_updated_at BEFORE UPDATE ON inventory_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payroll_records_updated_at BEFORE UPDATE ON payroll_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_operational_costs_updated_at BEFORE UPDATE ON operational_costs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_benefits_updated_at BEFORE UPDATE ON employee_benefits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_time_off_requests_updated_at BEFORE UPDATE ON time_off_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_saved_reports_updated_at BEFORE UPDATE ON saved_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
