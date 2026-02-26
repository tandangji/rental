import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { Save, Building2, CreditCard, MessageSquare, CalendarDays } from 'lucide-react';

const FIELDS = [
  { section: 'building', icon: Building2, title: '건물 정보', fields: [
    { key: 'building_name', label: '건물명' },
    { key: 'landlord_name', label: '건물주명' },
    { key: 'landlord_business_number', label: '사업자등록번호' },
    { key: 'landlord_phone', label: '연락처' },
  ]},
  { section: 'billing', icon: CalendarDays, title: '청구 설정', fields: [
    { key: 'billing_day', label: '매월 청구일 (임대료/관리비 자동 생성일)', type: 'select',
      options: Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}일` })) },
  ]},
  { section: 'bank', icon: CreditCard, title: '입금 계좌', fields: [
    { key: 'bank_name', label: '은행명' },
    { key: 'bank_account', label: '계좌번호' },
    { key: 'bank_holder', label: '예금주' },
  ]},
  { section: 'sms', icon: MessageSquare, title: 'SMS 설정', fields: [
    { key: 'sms_api_key', label: 'API Key' },
    { key: 'sms_sender_number', label: '발신번호' },
  ]},
];

export default function SettingsView({ settings, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setForm({ ...settings });
  }, [settings]);

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await authFetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setMessage('저장되었습니다');
        onSaved();
      } else {
        setMessage('저장 실패');
      }
    } catch {
      setMessage('서버 오류');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">시스템 설정</h2>
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]">
          <Save className="w-4 h-4" /> {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${message.includes('실패') || message.includes('오류') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      <div className="space-y-4">
        {FIELDS.map(({ section, icon: Icon, title, fields }) => (
          <div key={section} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Icon className="w-4 h-4 text-gray-500" />
              <h3 className="font-semibold text-gray-900">{title}</h3>
            </div>
            <div className="space-y-3">
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="block text-sm text-gray-600 mb-1">{f.label}</label>
                  {f.type === 'select' ? (
                    <select
                      value={form[f.key] || '1'}
                      onChange={(e) => set(f.key, e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={form[f.key] || ''}
                      onChange={(e) => set(f.key, e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
