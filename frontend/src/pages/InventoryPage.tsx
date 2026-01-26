import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../services/api';
import { Plus, Search, AlertTriangle, Package } from 'lucide-react';
import clsx from 'clsx';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', { page, search, lowStock: lowStockOnly }],
    queryFn: async () => {
      const response = await inventoryApi.list({
        page,
        limit: 20,
        search: search || undefined,
        lowStock: lowStockOnly ? 'true' : 'false',
      });
      return response.data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-gray-500">Manage products and stock levels</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Item
        </button>
      </div>

      {/* Summary Cards */}
      {data?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Items</p>
                <p className="text-2xl font-bold text-gray-900">{data.summary.totalItems}</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <p className="text-sm text-gray-500">Total Value</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.summary.totalValue)}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-gray-500">Total Quantity</p>
            <p className="text-2xl font-bold text-gray-900">{data.summary.totalQuantity?.toLocaleString()}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Low Stock</p>
                <p className="text-2xl font-bold text-red-600">{data.summary.lowStockCount}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="p-4 flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search inventory..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-10"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Low stock only</span>
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>Quantity</th>
                <th>Unit Cost</th>
                <th>Selling Price</th>
                <th>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
                  </td>
                </tr>
              ) : data?.data?.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-500">
                    No inventory items found
                  </td>
                </tr>
              ) : (
                data?.data?.map((item: any) => (
                  <tr key={item.id}>
                    <td className="font-mono text-sm">{item.sku}</td>
                    <td className="font-medium">{item.name}</td>
                    <td className="text-gray-500">{item.category || '-'}</td>
                    <td>
                      <span className={clsx(
                        'font-medium',
                        item.quantity <= item.reorder_level ? 'text-red-600' : 'text-gray-900'
                      )}>
                        {item.quantity}
                      </span>
                      {item.quantity <= item.reorder_level && (
                        <AlertTriangle className="w-4 h-4 text-red-500 inline ml-1" />
                      )}
                    </td>
                    <td>{formatCurrency(item.unit_cost)}</td>
                    <td>{formatCurrency(item.selling_price)}</td>
                    <td className="font-medium">{formatCurrency(item.total_value)}</td>
                    <td>
                      {item.quantity <= item.reorder_level ? (
                        <span className="badge badge-danger">Low Stock</span>
                      ) : (
                        <span className="badge badge-success">In Stock</span>
                      )}
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
