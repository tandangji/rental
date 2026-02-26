import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from './utils/api';
import LoginForm from './components/LoginForm';
import AdminDashboard from './components/AdminDashboard';
import TenantManage from './components/TenantManage';
import MeterOverview from './components/MeterOverview';
import BillingView from './components/BillingView';
import TaxInvoiceView from './components/TaxInvoiceView';
import SettingsView from './components/SettingsView';
import TenantDashboard from './components/TenantDashboard';
import MeterUpload from './components/MeterUpload';
import MyBillView from './components/MyBillView';
import { Building2, LogOut, LayoutDashboard, Users, Gauge, Receipt, FileText, Settings, Home, Camera, CreditCard } from 'lucide-react';

const ADMIN_TABS = [
  { id: 'dashboard', label: '대시보드', icon: LayoutDashboard },
  { id: 'tenants', label: '입주사', icon: Users },
  { id: 'meters', label: '검침', icon: Gauge },
  { id: 'billing', label: '청구', icon: Receipt },
  { id: 'tax', label: '세금계산서', icon: FileText },
  { id: 'settings', label: '설정', icon: Settings },
];

const TENANT_TABS = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'upload', label: '검침', icon: Camera },
  { id: 'bills', label: '청구서', icon: CreditCard },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('rental_session');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [settings, setSettings] = useState({});

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('rental_session', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('rental_session');
    }
  }, [currentUser]);

  // Load settings for bank info display
  const loadSettings = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/settings`);
      if (res.status === 401) { setCurrentUser(null); return; }
      if (res.ok) setSettings(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (currentUser) loadSettings();
  }, [currentUser, loadSettings]);

  const handleLogin = (user) => {
    localStorage.setItem('rental_session', JSON.stringify(user));
    setCurrentUser(user);
    setActiveTab(user.role === 'admin' ? 'dashboard' : 'home');
  };

  const handleLogout = async () => {
    try { await authFetch(`${API_BASE}/logout`, { method: 'POST' }); } catch {}
    setCurrentUser(null);
    setActiveTab('dashboard');
  };

  if (!currentUser) {
    return <LoginForm onLogin={handleLogin} />;
  }

  const isAdmin = currentUser.role === 'admin';
  const tabs = isAdmin ? ADMIN_TABS : TENANT_TABS;

  const renderContent = () => {
    if (isAdmin) {
      switch (activeTab) {
        case 'dashboard': return <AdminDashboard />;
        case 'tenants': return <TenantManage />;
        case 'meters': return <MeterOverview />;
        case 'billing': return <BillingView />;
        case 'tax': return <TaxInvoiceView />;
        case 'settings': return <SettingsView settings={settings} onSaved={loadSettings} />;
        default: return <AdminDashboard />;
      }
    } else {
      switch (activeTab) {
        case 'home': return <TenantDashboard user={currentUser} settings={settings} />;
        case 'upload': return <MeterUpload user={currentUser} />;
        case 'bills': return <MyBillView user={currentUser} settings={settings} />;
        default: return <TenantDashboard user={currentUser} settings={settings} />;
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            <span className="font-bold text-gray-900">
              {settings.building_name || '임대 관리'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              {currentUser.name}{currentUser.floor ? ` (${currentUser.floor}층)` : ''}
            </span>
            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-500">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-4">
        {renderContent()}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-30">
        <div className="max-w-5xl mx-auto flex">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex flex-col items-center py-2 min-h-[56px] transition-colors ${
                  isActive ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs mt-1">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
