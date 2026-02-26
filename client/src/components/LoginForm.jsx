import React, { useState } from 'react';
import { API_BASE } from '../utils/api';
import { Building2, Lock, User } from 'lucide-react';

export default function LoginForm({ onLogin }) {
  const [mode, setMode] = useState('tenant'); // 'admin' | 'tenant'
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [tenantPassword, setTenantPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = mode === 'admin'
        ? { isAdmin: true, password }
        : { companyName, tenantPassword };
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      onLogin(data);
    } catch {
      setError('서버에 연결할 수 없습니다');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Building2 className="w-12 h-12 text-blue-600 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">임대 관리 시스템</h1>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
          <button
            type="button"
            onClick={() => { setMode('tenant'); setError(''); }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              mode === 'tenant' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            입주사
          </button>
          <button
            type="button"
            onClick={() => { setMode('admin'); setError(''); }}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              mode === 'admin' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            건물주
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          {mode === 'admin' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">관리자 비밀번호</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="비밀번호 입력"
                  required
                />
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">업체명</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="업체명 입력"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="password"
                    value={tenantPassword}
                    onChange={(e) => setTenantPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="비밀번호 입력"
                    required
                  />
                </div>
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
