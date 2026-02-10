import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../services/api';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Receipt,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import { format } from 'date-fns';
import clsx from 'clsx';

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatPercent = (value: number) => {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
};

export default function DashboardPage() {
  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const response = await dashboardApi.getMetrics();
      return response.data.data;
    },
  });

  const { data: chartData } = useQuery({
    queryKey: ['dashboard-chart'],
    queryFn: async () => {
      const response = await dashboardApi.getRevenueExpenseChart(6);
      return response.data.data;
    },
  });

  const { data: expenseBreakdown } = useQuery({
    queryKey: ['expense-breakdown'],
    queryFn: async () => {
      const response = await dashboardApi.getExpenseBreakdown();
      return response.data.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const metrics = dashboardData?.metrics;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500">Overview of your business performance</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Revenue (This Month)"
          value={formatCurrency(metrics?.currentMonth?.revenue || 0)}
          change={metrics?.changes?.revenue}
          icon={DollarSign}
          color="green"
        />
        <MetricCard
          title="Expenses (This Month)"
          value={formatCurrency(metrics?.currentMonth?.expenses || 0)}
          change={metrics?.changes?.expenses}
          icon={Receipt}
          color="red"
          invertChange
        />
        <MetricCard
          title="Net Profit"
          value={formatCurrency(metrics?.currentMonth?.netProfit || 0)}
          change={metrics?.changes?.netProfit}
          icon={TrendingUp}
          color="blue"
        />
        <MetricCard
          title="Profit Margin"
          value={`${(metrics?.currentMonth?.profitMargin || 0).toFixed(1)}%`}
          icon={TrendingUp}
          color="purple"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue vs Expenses Chart */}
        <div className="lg:col-span-2 card">
          <div className="card-header">
            <h3 className="text-lg font-medium text-gray-900">Revenue vs Expenses</h3>
          </div>
          <div className="card-body">
            <div className="h-80">
              {chartData && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData.labels.map((label: string, i: number) => ({
                    name: label,
                    revenue: chartData.datasets[0]?.data[i] || 0,
                    expenses: chartData.datasets[1]?.data[i] || 0,
                    profit: chartData.datasets[2]?.data[i] || 0,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="name" stroke="#6B7280" fontSize={12} />
                    <YAxis stroke="#6B7280" fontSize={12} tickFormatter={(value) => `$${value / 1000}k`} />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      contentStyle={{ borderRadius: '8px', border: '1px solid #E5E7EB' }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="expenses" stroke="#EF4444" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="profit" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Expense Breakdown */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-medium text-gray-900">Expense Breakdown</h3>
          </div>
          <div className="card-body">
            <div className="h-80">
              {expenseBreakdown && expenseBreakdown.labels.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={expenseBreakdown.labels.map((label: string, i: number) => ({
                        name: label,
                        value: expenseBreakdown.datasets[0]?.data[i] || 0,
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {expenseBreakdown.datasets[0]?.backgroundColor?.map((color: string, index: number) => (
                        <Cell key={`cell-${index}`} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Recent Invoices</h3>
            <a href="/invoices" className="text-sm text-primary-600 hover:text-primary-700">
              View all
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {dashboardData?.recentInvoices?.slice(0, 5).map((invoice: any) => (
                  <tr key={invoice.id}>
                    <td>
                      <div className="font-medium">{invoice.invoice_number}</div>
                      <div className="text-xs text-gray-500">
                        {invoice.vendor_name || invoice.customer_name}
                      </div>
                    </td>
                    <td>
                      <span className={clsx(
                        'badge',
                        invoice.invoice_type === 'vendor' ? 'badge-warning' : 'badge-info'
                      )}>
                        {invoice.invoice_type}
                      </span>
                    </td>
                    <td>{formatCurrency(invoice.total_amount)}</td>
                    <td>
                      <StatusBadge status={invoice.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Stock Items */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Low Stock Alerts</h3>
            <a href="/inventory" className="text-sm text-primary-600 hover:text-primary-700">
              View all
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th>Stock</th>
                  <th>Reorder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {dashboardData?.lowStockItems?.length > 0 ? (
                  dashboardData.lowStockItems.slice(0, 5).map((item: any) => (
                    <tr key={item.id}>
                      <td className="font-medium">{item.name}</td>
                      <td className="text-gray-500">{item.sku}</td>
                      <td>
                        <span className="text-red-600 font-medium">{item.quantity}</span>
                      </td>
                      <td className="text-gray-500">{item.reorder_level}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="text-center text-gray-500 py-8">
                      No low stock items
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Top Vendors & Upcoming Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-medium text-gray-900">Top Vendors by Spending</h3>
          </div>
          <div className="card-body">
            <div className="h-64">
              {dashboardData?.topVendors && Object.keys(dashboardData.topVendors).length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={Object.entries(dashboardData.topVendors).slice(0, 5).map(([name, value]) => ({
                      name: name.length > 20 ? name.substring(0, 20) + '...' : name,
                      value,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis type="number" stroke="#6B7280" fontSize={12} tickFormatter={(v) => `$${v / 1000}k`} />
                    <YAxis type="category" dataKey="name" stroke="#6B7280" fontSize={12} width={100} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="value" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Upcoming Payments</h3>
            <a href="/invoices" className="text-sm text-primary-600 hover:text-primary-700">
              View all
            </a>
          </div>
          <div className="card-body space-y-4">
            {dashboardData?.upcomingPayments?.length > 0 ? (
              dashboardData.upcomingPayments.map((payment: any) => (
                <div key={payment.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{payment.vendor_name}</p>
                    <p className="text-sm text-gray-500">{payment.invoice_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-gray-900">{formatCurrency(payment.total_amount)}</p>
                    <p className="text-sm text-gray-500">
                      Due {format(new Date(payment.due_date), 'MMM d')}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-gray-500 py-8">No upcoming payments</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  change?: number;
  icon: any;
  color: 'green' | 'red' | 'blue' | 'purple';
  invertChange?: boolean;
}

function MetricCard({ title, value, change, icon: Icon, color, invertChange }: MetricCardProps) {
  const colorClasses = {
    green: 'bg-green-100 text-green-600',
    red: 'bg-red-100 text-red-600',
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
  };

  const isPositive = invertChange ? (change || 0) < 0 : (change || 0) > 0;

  return (
    <div className="metric-card">
      <div className="flex items-center justify-between">
        <div className={clsx('p-2 rounded-lg', colorClasses[color])}>
          <Icon className="w-5 h-5" />
        </div>
        {change !== undefined && (
          <div className={clsx(
            'flex items-center text-sm font-medium',
            isPositive ? 'text-green-600' : 'text-red-600'
          )}>
            {isPositive ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
            {formatPercent(Math.abs(change))}
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="metric-card-value">{value}</p>
        <p className="metric-card-label">{title}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusClasses: Record<string, string> = {
    paid: 'badge-success',
    pending: 'badge-warning',
    partial: 'badge-info',
    overdue: 'badge-danger',
    draft: 'badge-gray',
    cancelled: 'badge-gray',
  };

  return (
    <span className={clsx('badge capitalize', statusClasses[status] || 'badge-gray')}>
      {status}
    </span>
  );
}
