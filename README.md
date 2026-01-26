# BusinessHub - Comprehensive Business Management Platform

A full-featured business management platform combining HR, inventory, and financial tracking in a unified dashboard.

## Features

### Invoice Management
- Import invoices from PDF, CSV, and Excel files
- Automatic data extraction with pattern recognition
- Payment tracking and status management
- Vendor management with spending analytics

### Expense Tracking
- Auto-categorization with keyword matching
- Duplicate detection and unusual expense flagging
- Multi-level category hierarchy
- Receipt attachment support
- Approval workflow for expenses

### Revenue Calculation Engine
- Gross Profit, Net Profit, Profit Margin, and ROI calculations
- Period comparison (month-over-month, year-over-year)
- Time series data for trend analysis
- COGS and operational cost tracking

### Inventory Management
- Multi-location inventory tracking
- Stock level monitoring with low stock alerts
- FIFO/LIFO/Weighted Average costing methods
- Stock adjustment and transaction history
- Inventory valuation reports

### HR & Payroll Integration
- Employee directory management
- Payroll processing with tax calculations
- Time-off request management
- Department organization
- Benefits and deductions tracking

### Dashboard & Reporting
- Real-time financial metrics
- Revenue vs Expenses line charts
- Expense breakdown pie charts
- Top vendors bar charts
- Profit & Loss statements
- Customizable date range reports

### Authentication & Security
- JWT-based authentication
- Role-based access control (Admin, Manager, Accountant, Employee)
- Multi-company support
- Activity logging for audit trails

## Tech Stack

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript
- **Database**: PostgreSQL
- **Authentication**: JWT with bcrypt
- **File Processing**: pdf-parse, xlsx, csv-parse
- **Validation**: Zod

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Data Fetching**: TanStack Query (React Query)
- **Charts**: Recharts
- **Routing**: React Router v6
- **HTTP Client**: Axios

## Project Structure

```
BI-Expenses/
├── backend/
│   ├── src/
│   │   ├── config/         # Database and app configuration
│   │   ├── middleware/     # Auth, error handling, validation
│   │   ├── migrations/     # Database schema and seeds
│   │   ├── routes/         # API route handlers
│   │   ├── services/       # Business logic services
│   │   ├── types/          # TypeScript interfaces
│   │   └── index.ts        # Express server entry point
│   ├── uploads/            # File upload directory
│   └── package.json
├── frontend/
│   ├── public/             # Static assets
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── services/       # API service layer
│   │   ├── store/          # Zustand state management
│   │   ├── types/          # TypeScript interfaces
│   │   ├── App.tsx         # Main app with routing
│   │   └── main.tsx        # React entry point
│   └── package.json
└── package.json            # Root package with workspaces
```

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd BI-Expenses
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your database credentials
```

4. Create the database:
```bash
createdb businesshub
```

5. Run database migrations:
```bash
npm run migrate -w backend
```

6. Seed the database (optional, for demo data):
```bash
npm run seed -w backend
```

### Running the Application

Development mode (runs both frontend and backend):
```bash
npm run dev
```

Or run separately:
```bash
# Backend only
npm run dev -w backend

# Frontend only
npm run dev -w frontend
```

### Default Credentials (after seeding)
- **Email**: admin@demo.com
- **Password**: password123

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `PUT /api/auth/change-password` - Change password

### Invoices
- `GET /api/invoices` - List invoices
- `POST /api/invoices` - Create invoice
- `POST /api/invoices/import` - Import invoice file
- `PUT /api/invoices/:id/payment` - Record payment

### Expenses
- `GET /api/expenses` - List expenses
- `POST /api/expenses` - Create expense
- `PUT /api/expenses/:id/approve` - Approve expense
- `GET /api/expenses/flagged` - Get flagged expenses

### Revenue
- `GET /api/revenue` - List revenue entries
- `POST /api/revenue` - Create revenue entry

### Inventory
- `GET /api/inventory` - List inventory items
- `POST /api/inventory/:id/adjust` - Adjust stock
- `GET /api/inventory/valuation` - Get inventory valuation

### Employees
- `GET /api/employees` - List employees
- `POST /api/employees` - Create employee
- `GET /api/employees/:id/time-off` - Get time-off requests

### Payroll
- `GET /api/payroll` - List payroll records
- `POST /api/payroll/generate` - Generate payroll
- `PUT /api/payroll/:id/approve` - Approve payroll

### Dashboard
- `GET /api/dashboard/metrics` - Get dashboard metrics
- `GET /api/dashboard/charts` - Get chart data
- `GET /api/dashboard/activity` - Get recent activity

### Reports
- `GET /api/reports/profit-loss` - Profit & Loss report
- `GET /api/reports/expenses` - Expense report
- `GET /api/reports/revenue` - Revenue report
- `GET /api/reports/inventory` - Inventory report
- `GET /api/reports/payroll` - Payroll report

## Database Schema

The application uses PostgreSQL with the following main tables:
- `users` - User accounts and authentication
- `companies` - Multi-tenant company support
- `invoices` - Invoice records with line items
- `expenses` - Expense tracking with categories
- `revenue` - Revenue entries
- `categories` - Hierarchical expense categories
- `inventory_items` - Inventory with locations
- `inventory_transactions` - Stock movement history
- `employees` - Employee directory
- `payroll_records` - Payroll with deductions
- `activity_logs` - Audit trail

## License

MIT
