import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { revenueApi, categoriesApi } from '../services/api';
import { Plus, Search, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export default function RevenuePage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  const { data: categories } = useQuery({
    queryKey: ['categories', 'revenue'],
    queryFn: async () => {
      const response = await categoriesApi.listFlat('revenue');
      return response.data.data;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['revenue', { page, search, categoryId: categoryFilter }],
    queryFn: async () => {
      const response = await revenueApi.list({
        page,
        limit: 20,
        search: search || undefined,
        categoryId: categoryFilter || undefined,
      });
      return response.data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Revenue</h1>
          <p className="text-gray-500">Track income and revenue streams</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Revenue
        </button>
      </div>

      {/* Summary Cards */}
      {data?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Revenue</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.summary.total)}</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <p className="text-sm text-gray-500">Tax Collected</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.summary.taxTotal)}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-gray-500">Total Records</p>
            <p className="text-2xl font-bold text-gray-900">{data.pagination?.total || 0}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="p-4 flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search revenue..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-10"
              />
            </div>
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="input w-auto"
          >
            <option value="">All Categories</option>
            {categories?.map((cat: any) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Customer</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="text-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
                  </td>
                </tr>
              ) : data?.data?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    No revenue records found
                  </td>
                </tr>
              ) : (
                data?.data?.map((revenue: any) => (
                  <tr key={revenue.id}>
                    <td>{format(new Date(revenue.revenue_date), 'MMM d, yyyy')}</td>
                    <td className="max-w-xs truncate">{revenue.description}</td>
                    <td>
                      {revenue.category_name && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: `${revenue.category_color}20`,
                            color: revenue.category_color,
                          }}
                        >
                          {revenue.category_name}
                        </span>
                      )}
                    </td>
                    <td className="text-gray-500">{revenue.customer_name || '-'}</td>
                    <td className="font-medium text-green-600">{formatCurrency(revenue.amount)}</td>
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
