import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { companyApi, authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Building2, User, Lock, Bell, Palette } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

type TabType = 'company' | 'profile' | 'security' | 'notifications';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('company');
  const user = useAuthStore((state) => state.user);

  const tabs = [
    { id: 'company' as const, name: 'Company', icon: Building2 },
    { id: 'profile' as const, name: 'Profile', icon: User },
    { id: 'security' as const, name: 'Security', icon: Lock },
    { id: 'notifications' as const, name: 'Notifications', icon: Bell },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your account and company settings</p>
      </div>

      <div className="card">
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'company' && <CompanySettings />}
          {activeTab === 'profile' && <ProfileSettings />}
          {activeTab === 'security' && <SecuritySettings />}
          {activeTab === 'notifications' && <NotificationSettings />}
        </div>
      </div>
    </div>
  );
}

function CompanySettings() {
  const queryClient = useQueryClient();
  const { data: company, isLoading } = useQuery({
    queryKey: ['company'],
    queryFn: async () => {
      const response = await companyApi.getCurrent();
      return response.data.data;
    },
  });

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    taxId: '',
    currency: 'USD',
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => companyApi.update(data),
    onSuccess: () => {
      toast.success('Company settings updated');
      queryClient.invalidateQueries({ queryKey: ['company'] });
    },
    onError: () => {
      toast.error('Failed to update settings');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  if (isLoading) {
    return <div className="animate-pulse h-64 bg-gray-100 rounded"></div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      <div>
        <label className="label">Company Name</label>
        <input
          type="text"
          value={formData.name || company?.name || ''}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="input"
        />
      </div>

      <div>
        <label className="label">Email</label>
        <input
          type="email"
          value={formData.email || company?.email || ''}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="input"
        />
      </div>

      <div>
        <label className="label">Phone</label>
        <input
          type="tel"
          value={formData.phone || company?.phone || ''}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          className="input"
        />
      </div>

      <div>
        <label className="label">Address</label>
        <textarea
          value={formData.address || company?.address || ''}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          className="input"
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Tax ID</label>
          <input
            type="text"
            value={formData.taxId || company?.tax_id || ''}
            onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
            className="input"
          />
        </div>
        <div>
          <label className="label">Currency</label>
          <select
            value={formData.currency || company?.currency || 'USD'}
            onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
            className="input"
          >
            <option value="USD">USD - US Dollar</option>
            <option value="EUR">EUR - Euro</option>
            <option value="GBP">GBP - British Pound</option>
            <option value="CAD">CAD - Canadian Dollar</option>
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={updateMutation.isPending}
        className="btn-primary"
      >
        {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}

function ProfileSettings() {
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);

  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateUser(formData);
    toast.success('Profile updated');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">First Name</label>
          <input
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            className="input"
          />
        </div>
        <div>
          <label className="label">Last Name</label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            className="input"
          />
        </div>
      </div>

      <div>
        <label className="label">Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="input"
          disabled
        />
        <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
      </div>

      <div>
        <label className="label">Role</label>
        <input
          type="text"
          value={user?.role || ''}
          className="input bg-gray-50"
          disabled
        />
      </div>

      <button type="submit" className="btn-primary">
        Save Changes
      </button>
    </form>
  );
}

function SecuritySettings() {
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const changeMutation = useMutation({
    mutationFn: () => authApi.changePassword(passwords.currentPassword, passwords.newPassword),
    onSuccess: () => {
      toast.success('Password changed successfully');
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to change password');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (passwords.newPassword !== passwords.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (passwords.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    changeMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      <div>
        <label className="label">Current Password</label>
        <input
          type="password"
          value={passwords.currentPassword}
          onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
          className="input"
          required
        />
      </div>

      <div>
        <label className="label">New Password</label>
        <input
          type="password"
          value={passwords.newPassword}
          onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
          className="input"
          required
          minLength={8}
        />
      </div>

      <div>
        <label className="label">Confirm New Password</label>
        <input
          type="password"
          value={passwords.confirmPassword}
          onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })}
          className="input"
          required
        />
      </div>

      <button
        type="submit"
        disabled={changeMutation.isPending}
        className="btn-primary"
      >
        {changeMutation.isPending ? 'Changing...' : 'Change Password'}
      </button>
    </form>
  );
}

function NotificationSettings() {
  const [notifications, setNotifications] = useState({
    emailInvoices: true,
    emailExpenses: true,
    emailPayroll: false,
    emailLowStock: true,
    emailReports: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success('Notification preferences saved');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      <p className="text-sm text-gray-500 mb-4">
        Choose which notifications you'd like to receive
      </p>

      <div className="space-y-4">
        {[
          { key: 'emailInvoices', label: 'Invoice notifications', desc: 'Get notified when invoices are created or due' },
          { key: 'emailExpenses', label: 'Expense alerts', desc: 'Receive alerts for expense approvals' },
          { key: 'emailPayroll', label: 'Payroll reminders', desc: 'Get reminders for payroll processing' },
          { key: 'emailLowStock', label: 'Low stock alerts', desc: 'Be notified when inventory is running low' },
          { key: 'emailReports', label: 'Weekly reports', desc: 'Receive weekly financial summary emails' },
        ].map((item) => (
          <label key={item.key} className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={(notifications as any)[item.key]}
              onChange={(e) => setNotifications({ ...notifications, [item.key]: e.target.checked })}
              className="mt-1 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <div>
              <p className="font-medium text-gray-900">{item.label}</p>
              <p className="text-sm text-gray-500">{item.desc}</p>
            </div>
          </label>
        ))}
      </div>

      <button type="submit" className="btn-primary">
        Save Preferences
      </button>
    </form>
  );
}
