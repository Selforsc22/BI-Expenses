import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../services/api';
import { Plus, Search, DollarSign, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export default function PayrollPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['payroll', { page, status: statusFilter }],
    queryFn: async () => {
      const response = await payrollApi.list({
        page,
        limit: 20,
        status: statusFilter || undefined,
      });
      return response.data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
          <p className="text-gray-500">Manage employee payroll and payments</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Payroll
        </button>
      </div>

      {/* Summary Cards */}
      {data?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Gross</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.summary.totalGross)}</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <p className="text-sm text-gray-500">Total Net</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.summary.totalNet)}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-gray-500">Total Deductions</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.summary.totalDeductions)}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-gray-500">Employer Cost</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.summary.totalEmployerCost)}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="p-4 flex flex-wrap gap-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input w-auto"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="processed">Processed</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Pay Period</th>
                <th>Gross Pay</th>
                <th>Deductions</th>
                <th>Net Pay</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
                  </td>
                </tr>
              ) : data?.data?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    No payroll records found
                  </td>
                </tr>
              ) : (
                data?.data?.map((record: any) => (
                  <tr key={record.id}>
                    <td>
                      <div>
                        <p className="font-medium">{record.first_name} {record.last_name}</p>
                        <p className="text-sm text-gray-500">{record.employee_number}</p>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span>
                          {format(new Date(record.pay_period_start), 'MMM d')} - {format(new Date(record.pay_period_end), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </td>
                    <td className="font-medium">{formatCurrency(record.gross_pay)}</td>
                    <td className="text-red-600">{formatCurrency(record.total_deductions)}</td>
                    <td className="font-medium text-green-600">{formatCurrency(record.net_pay)}</td>
                    <td>
                      <StatusBadge status={record.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Showing {((page - 1) * 20) + 1} to {Math.min(page * 20, data.pagination.total)} of {data.pagination.total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary text-sm py-1"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= data.pagination.totalPages}
                className="btn-secondary text-sm py-1"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const statusClasses: Record<string, string> = {
    draft: 'badge-gray',
    pending: 'badge-warning',
    approved: 'badge-info',
    processed: 'badge-info',
    paid: 'badge-success',
  };

  return (
    <span className={clsx('badge capitalize', statusClasses[status] || 'badge-gray')}>
      {status}
    </span>
  );
}
