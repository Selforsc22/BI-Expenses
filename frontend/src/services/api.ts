import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

// Use environment variable for production, fallback to /api for local development with proxy
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string; error?: string }>) => {
    const message = error.response?.data?.message || error.response?.data?.error || 'An error occurred';

    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    } else if (error.response?.status === 403) {
      toast.error('You do not have permission to perform this action');
    } else if (error.response?.status !== 400) {
      toast.error(message);
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),

  register: (data: { email: string; password: string; firstName: string; lastName: string; companyName?: string }) =>
    api.post('/auth/register', data),

  me: () => api.get('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),

  logout: () => api.post('/auth/logout'),
};

// Dashboard API
export const dashboardApi = {
  getMetrics: () => api.get('/dashboard'),
  getRevenueExpenseChart: (months?: number) =>
    api.get('/dashboard/revenue-expenses-chart', { params: { months } }),
  getExpenseBreakdown: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/dashboard/expense-breakdown', { params }),
  getTopVendors: (params?: { limit?: number; startDate?: string; endDate?: string }) =>
    api.get('/dashboard/top-vendors', { params }),
  getCashFlow: () => api.get('/dashboard/cash-flow'),
  getInventoryStatus: () => api.get('/dashboard/inventory-status'),
  getPayrollSummary: () => api.get('/dashboard/payroll-summary'),
  getActivity: (limit?: number) => api.get('/dashboard/activity', { params: { limit } }),
};

// Invoices API
export const invoicesApi = {
  list: (params?: Record<string, any>) => api.get('/invoices', { params }),
  get: (id: string) => api.get(`/invoices/${id}`),
  create: (data: any) => api.post('/invoices', data),
  update: (id: string, data: any) => api.put(`/invoices/${id}`, data),
  delete: (id: string) => api.delete(`/invoices/${id}`),
  import: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/invoices/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  recordPayment: (id: string, data: { amount: number; paymentMethod?: string }) =>
    api.post(`/invoices/${id}/pay`, data),
};

// Expenses API
export const expensesApi = {
  list: (params?: Record<string, any>) => api.get('/expenses', { params }),
  get: (id: string) => api.get(`/expenses/${id}`),
  create: (data: any) => api.post('/expenses', data),
  update: (id: string, data: any) => api.put(`/expenses/${id}`, data),
  delete: (id: string) => api.delete(`/expenses/${id}`),
  categorize: (data: { vendorName?: string; description?: string; amount?: number }) =>
    api.post('/expenses/categorize', data),
  getFlagged: () => api.get('/expenses/flagged'),
  approve: (id: string) => api.post(`/expenses/${id}/approve`),
  uploadReceipt: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('receipt', file);
    return api.post(`/expenses/${id}/receipt`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getByCategory: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/expenses/categories', { params }),
};

// Revenue API
export const revenueApi = {
  list: (params?: Record<string, any>) => api.get('/revenue', { params }),
  get: (id: string) => api.get(`/revenue/${id}`),
  create: (data: any) => api.post('/revenue', data),
  update: (id: string, data: any) => api.put(`/revenue/${id}`, data),
  delete: (id: string) => api.delete(`/revenue/${id}`),
  getByCategory: (params?: { startDate?: string; endDate?: string }) =>
    api.get('/revenue/categories', { params }),
};

// Categories API
export const categoriesApi = {
  list: (params?: { type?: string; includeInactive?: boolean }) =>
    api.get('/categories', { params }),
  listFlat: (type?: string) => api.get('/categories/flat', { params: { type } }),
  get: (id: string) => api.get(`/categories/${id}`),
  create: (data: any) => api.post('/categories', data),
  update: (id: string, data: any) => api.put(`/categories/${id}`, data),
  delete: (id: string) => api.delete(`/categories/${id}`),
};

// Inventory API
export const inventoryApi = {
  list: (params?: Record<string, any>) => api.get('/inventory', { params }),
  get: (id: string) => api.get(`/inventory/${id}`),
  create: (data: any) => api.post('/inventory', data),
  update: (id: string, data: any) => api.put(`/inventory/${id}`, data),
  delete: (id: string) => api.delete(`/inventory/${id}`),
  adjust: (id: string, data: { quantity: number; type: string; unitCost?: number; notes?: string }) =>
    api.post(`/inventory/${id}/adjust`, data),
  getTransactions: (id: string, params?: { page?: number; limit?: number }) =>
    api.get(`/inventory/${id}/transactions`, { params }),
  getLowStock: () => api.get('/inventory/low-stock'),
  getValuation: () => api.get('/inventory/valuation'),
  getLocations: () => api.get('/inventory/locations/list'),
};

// Employees API
export const employeesApi = {
  list: (params?: Record<string, any>) => api.get('/employees', { params }),
  get: (id: string) => api.get(`/employees/${id}`),
  create: (data: any) => api.post('/employees', data),
  update: (id: string, data: any) => api.put(`/employees/${id}`, data),
  delete: (id: string) => api.delete(`/employees/${id}`),
  getDepartments: () => api.get('/employees/departments'),
  getSummary: () => api.get('/employees/summary'),
  requestTimeOff: (id: string, data: any) => api.post(`/employees/${id}/time-off`, data),
  approveTimeOff: (employeeId: string, requestId: string, data: { status: string; notes?: string }) =>
    api.put(`/employees/${employeeId}/time-off/${requestId}`, data),
};

// Payroll API
export const payrollApi = {
  list: (params?: Record<string, any>) => api.get('/payroll', { params }),
  get: (id: string) => api.get(`/payroll/${id}`),
  create: (data: any) => api.post('/payroll', data),
  update: (id: string, data: any) => api.put(`/payroll/${id}`, data),
  delete: (id: string) => api.delete(`/payroll/${id}`),
  generate: (data: { payPeriodStart: string; payPeriodEnd: string; hoursPerEmployee?: number }) =>
    api.post('/payroll/generate', data),
  approve: (id: string) => api.post(`/payroll/${id}/approve`),
  process: (id: string, data?: { paymentDate?: string; paymentMethod?: string }) =>
    api.post(`/payroll/${id}/process`, data),
  getSummary: (params?: { year?: number; month?: number }) =>
    api.get('/payroll/summary', { params }),
};

// Reports API
export const reportsApi = {
  profitLoss: (params?: { startDate?: string; endDate?: string; compareWithPrevious?: boolean }) =>
    api.get('/reports/profit-loss', { params }),
  expense: (params?: Record<string, any>) => api.get('/reports/expense', { params }),
  revenue: (params?: Record<string, any>) => api.get('/reports/revenue', { params }),
  inventory: (params?: { category?: string; lowStockOnly?: boolean }) =>
    api.get('/reports/inventory', { params }),
  payroll: (params?: { year?: number; month?: number; department?: string }) =>
    api.get('/reports/payroll', { params }),
  taxSummary: (year?: number) => api.get('/reports/tax-summary', { params: { year } }),
  saveReport: (data: any) => api.post('/reports/save', data),
  getSavedReports: () => api.get('/reports/saved'),
  deleteSavedReport: (id: string) => api.delete(`/reports/saved/${id}`),
};

// Company API
export const companyApi = {
  getCurrent: () => api.get('/companies/current'),
  update: (data: any) => api.put('/companies/current', data),
  getSettings: () => api.get('/companies/settings'),
  updateSettings: (settings: any) => api.put('/companies/settings', { settings }),
  inviteUser: (email: string, role: string) => api.post('/companies/invite', { email, role }),
  revokeAccess: (userId: string) => api.delete(`/companies/access/${userId}`),
};

// Users API
export const usersApi = {
  list: (params?: Record<string, any>) => api.get('/users', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: any) => api.post('/users', data),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
};

export default api;
