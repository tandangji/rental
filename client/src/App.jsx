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
import TenantPasswordSetup from './components/TenantPasswordSetup';
import { Building2, LogOut, LayoutDashboard, Users, Gauge, Receipt, FileText, Settings, Home, Camera, CreditCard, KeyRound } from 'lucide-react';

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
  const [showPasswordSetup, setShowPasswordSetup] = useState(true);

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
    if (currentUser && !currentUser.mustChangePassword) loadSettings();
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
  const needsPasswordSetup = currentUser.role === 'tenant' && currentUser.mustChangePassword;
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
      if (needsPasswordSetup) {
        return (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-600">
            비밀번호 초기 설정을 완료하면 서비스를 이용할 수 있습니다.
          </div>
        );
      }
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
            {needsPasswordSetup && !showPasswordSetup && (
              <button
                onClick={() => setShowPasswordSetup(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
              >
                <KeyRound className="w-3 h-3" />
                비밀번호 설정
              </button>
            )}
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
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 z-30">
        <div className="max-w-5xl mx-auto flex">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex flex-col items-center py-2 min-h-[56px] transition-colors relative ${
                  isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-blue-400 rounded-b-full" />
                )}
                <Icon className={`w-5 h-5 ${isActive ? 'text-blue-400' : ''}`} />
                <span className="text-xs mt-1">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {needsPasswordSetup && showPasswordSetup && (
        <TenantPasswordSetup
          onDone={() => {
            const updated = { ...currentUser, mustChangePassword: false };
            localStorage.setItem('rental_session', JSON.stringify(updated));
            setCurrentUser(updated);
            setActiveTab('home');
            loadSettings();
          }}
          onClose={() => setShowPasswordSetup(false)}
        />
      )}
    </div>
  );
}
