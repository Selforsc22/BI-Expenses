import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../services/api';
import { FileText, TrendingUp, Receipt, Package, Users, DollarSign, Download } from 'lucide-react';
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

const reportTypes = [
  { id: 'profit-loss', name: 'Profit & Loss', icon: TrendingUp, description: 'Revenue, expenses, and profit summary' },
  { id: 'expense', name: 'Expense Report', icon: Receipt, description: 'Detailed expense breakdown' },
  { id: 'revenue', name: 'Revenue Report', icon: DollarSign, description: 'Revenue by category and customer' },
  { id: 'inventory', name: 'Inventory Report', icon: Package, description: 'Stock levels and valuation' },
  { id: 'payroll', name: 'Payroll Report', icon: Users, description: 'Payroll costs and breakdown' },
];

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState('profit-loss');

  const { data: profitLossData, isLoading: plLoading } = useQuery({
    queryKey: ['report', 'profit-loss'],
    queryFn: async () => {
      const response = await reportsApi.profitLoss();
      return response.data.data;
    },
    enabled: selectedReport === 'profit-loss',
  });

  const { data: expenseData, isLoading: expLoading } = useQuery({
    queryKey: ['report', 'expense'],
    queryFn: async () => {
      const response = await reportsApi.expense({ groupBy: 'category' });
      return response.data.data;
    },
    enabled: selectedReport === 'expense',
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500">Generate and view business reports</p>
        </div>
        <button className="btn-secondary flex items-center gap-2">
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {/* Report Type Selection */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {reportTypes.map((report) => (
          <button
            key={report.id}
            onClick={() => setSelectedReport(report.id)}
            className={`card p-4 text-left transition-all ${
              selectedReport === report.id
                ? 'ring-2 ring-primary-500 bg-primary-50'
                : 'hover:bg-gray-50'
            }`}
          >
            <report.icon className={`w-6 h-6 mb-2 ${
              selectedReport === report.id ? 'text-primary-600' : 'text-gray-400'
            }`} />
            <p className="font-medium text-gray-900">{report.name}</p>
            <p className="text-xs text-gray-500 mt-1">{report.description}</p>
          </button>
        ))}
      </div>

      {/* Report Content */}
      <div className="card">
        {selectedReport === 'profit-loss' && (
          <div>
            <div className="card-header">
              <h2 className="text-lg font-semibold">Profit & Loss Statement</h2>
              {profitLossData?.period && (
                <p className="text-sm text-gray-500">
                  {profitLossData.period.start} to {profitLossData.period.end}
                </p>
              )}
            </div>
            <div className="card-body">
              {plLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
              ) : profitLossData?.summary ? (
                <div className="space-y-6">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-green-50 rounded-lg">
                      <p className="text-sm text-green-600">Total Revenue</p>
                      <p className="text-2xl font-bold text-green-700">
                        {formatCurrency(profitLossData.summary.totalRevenue)}
                      </p>
                    </div>
                    <div className="p-4 bg-red-50 rounded-lg">
                      <p className="text-sm text-red-600">Operating Expenses</p>
                      <p className="text-2xl font-bold text-red-700">
                        {formatCurrency(profitLossData.summary.operatingExpenses)}
                      </p>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <p className="text-sm text-blue-600">Gross Profit</p>
                      <p className="text-2xl font-bold text-blue-700">
                        {formatCurrency(profitLossData.summary.grossProfit)}
                      </p>
                    </div>
                    <div className="p-4 bg-purple-50 rounded-lg">
                      <p className="text-sm text-purple-600">Net Profit</p>
                      <p className="text-2xl font-bold text-purple-700">
                        {formatCurrency(profitLossData.summary.netProfit)}
                      </p>
                    </div>
                  </div>

                  {/* Breakdown */}
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-medium text-gray-900 mb-4">Revenue by Category</h3>
                      <div className="space-y-2">
                        {profitLossData.breakdown?.revenueByCategory?.map((cat: any) => (
                          <div key={cat.name} className="flex justify-between items-center">
                            <span className="text-gray-600">{cat.name}</span>
                            <span className="font-medium">{formatCurrency(parseFloat(cat.total))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900 mb-4">Expenses by Category</h3>
                      <div className="space-y-2">
                        {profitLossData.breakdown?.expenseByCategory?.map((cat: any) => (
                          <div key={cat.name} className="flex justify-between items-center">
                            <span className="text-gray-600">{cat.name}</span>
                            <span className="font-medium">{formatCurrency(parseFloat(cat.total))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-center text-gray-500 py-12">No data available</p>
              )}
            </div>
          </div>
        )}

        {selectedReport === 'expense' && (
          <div>
            <div className="card-header">
              <h2 className="text-lg font-semibold">Expense Report</h2>
            </div>
            <div className="card-body">
              {expLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
              ) : expenseData?.breakdown ? (
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={expenseData.breakdown.map((item: any) => ({
                            name: item.group_name,
                            value: parseFloat(item.total),
                          }))}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="value"
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        >
                          {expenseData.breakdown.map((_: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Total: {formatCurrency(expenseData.total)}</p>
                    <div className="space-y-3">
                      {expenseData.breakdown.map((item: any, index: number) => (
                        <div key={item.group_name} className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          <div className="flex-1">
                            <div className="flex justify-between">
                              <span className="font-medium">{item.group_name}</span>
                              <span>{formatCurrency(parseFloat(item.total))}</span>
                            </div>
                            <div className="text-xs text-gray-500">{item.count} transactions</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-center text-gray-500 py-12">No expense data available</p>
              )}
            </div>
          </div>
        )}

        {!['profit-loss', 'expense'].includes(selectedReport) && (
          <div className="card-body text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">Select filters and click Generate to view this report</p>
          </div>
        )}
      </div>
    </div>
  );
}
