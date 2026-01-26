import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { employeesApi } from '../services/api';
import { Plus, Search, Users } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export default function EmployeesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const response = await employeesApi.getDepartments();
      return response.data.data;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['employees', { page, search, status: statusFilter, department: departmentFilter }],
    queryFn: async () => {
      const response = await employeesApi.list({
        page,
        limit: 20,
        search: search || undefined,
        status: statusFilter || undefined,
        department: departmentFilter || undefined,
      });
      return response.data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500">Manage your team and HR records</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Employee
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Employees</p>
              <p className="text-2xl font-bold text-gray-900">{data?.pagination?.total || 0}</p>
            </div>
          </div>
        </div>
        {departments?.slice(0, 3).map((dept: any) => (
          <div key={dept.department} className="card p-4">
            <p className="text-sm text-gray-500">{dept.department}</p>
            <p className="text-2xl font-bold text-gray-900">{dept.employee_count}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="p-4 flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search employees..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-10"
              />
            </div>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input w-auto"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="on_leave">On Leave</option>
            <option value="terminated">Terminated</option>
          </select>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="input w-auto"
          >
            <option value="">All Departments</option>
            {departments?.map((dept: any) => (
              <option key={dept.department} value={dept.department}>
                {dept.department}
              </option>
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
                <th>Employee</th>
                <th>Department</th>
                <th>Position</th>
                <th>Type</th>
                <th>Hire Date</th>
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
                    No employees found
                  </td>
                </tr>
              ) : (
                data?.data?.map((employee: any) => (
                  <tr key={employee.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                          <span className="text-primary-700 font-medium text-sm">
                            {employee.first_name?.[0]}{employee.last_name?.[0]}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium">{employee.first_name} {employee.last_name}</p>
                          <p className="text-sm text-gray-500">{employee.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-gray-500">{employee.department || '-'}</td>
                    <td className="text-gray-500">{employee.position || '-'}</td>
                    <td>
                      <span className="badge badge-gray capitalize">
                        {employee.employment_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td>{format(new Date(employee.hire_date), 'MMM d, yyyy')}</td>
                    <td>
                      <StatusBadge status={employee.status} />
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
    active: 'badge-success',
    inactive: 'badge-gray',
    on_leave: 'badge-warning',
    terminated: 'badge-danger',
  };

  return (
    <span className={clsx('badge capitalize', statusClasses[status] || 'badge-gray')}>
      {status.replace('_', ' ')}
    </span>
  );
}
