import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { Save, Flame, Zap, Droplets, ChevronDown, ChevronUp } from 'lucide-react';

export default function BuildingBillForm({ year, month, onSaved }) {
  const [form, setForm] = useState({ gas_total: 0, electricity_total: 0, water_total: 0 });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}/building-bills?year=${year}&month=${month}`);
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            setForm({
              gas_total: data[0].gas_total || 0,
              electricity_total: data[0].electricity_total || 0,
              water_total: data[0].water_total || 0,
            });
            // 이미 입력된 데이터가 있으면 접기
            const hasData = (data[0].gas_total || 0) + (data[0].electricity_total || 0) + (data[0].water_total || 0) > 0;
            setOpen(!hasData);
          } else {
            setForm({ gas_total: 0, electricity_total: 0, water_total: 0 });
            setOpen(true);
          }
        }
      } catch {}
      setLoaded(true);
    })();
  }, [year, month]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await authFetch(`${API_BASE}/building-bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, month,
          gas_total: Number(form.gas_total),
          electricity_total: Number(form.electricity_total),
          water_total: Number(form.water_total),
        }),
      });
      if (res.ok) {
        setMessage('저장되었습니다');
        setOpen(false);
        if (onSaved) onSaved();
      }
    } catch {
      setMessage('저장 실패');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const fmt = (n) => Number(n || 0).toLocaleString();
  const total = Number(form.gas_total) + Number(form.electricity_total) + Number(form.water_total);

  const items = [
    { key: 'gas_total', label: '가스', icon: Flame, color: 'text-orange-500' },
    { key: 'electricity_total', label: '전기', icon: Zap, color: 'text-yellow-500' },
    { key: 'water_total', label: '수도', icon: Droplets, color: 'text-blue-500' },
  ];

  if (!loaded) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      {/* Header — 항상 표시 */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4"
      >
        <h3 className="font-semibold text-gray-900 text-sm">건물 전체 공과금</h3>
        <div className="flex items-center gap-2">
          {total > 0 && !open && (
            <span className="text-sm font-bold text-gray-900">{fmt(total)}원</span>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* Body — 접이식 */}
      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          <div className="space-y-3">
            {items.map(({ key, label, icon: Icon, color }) => (
              <div key={key} className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
                <label className="text-sm text-gray-700 w-12">{label}</label>
                <input
                  type="number"
                  value={form[key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-right"
                />
                <span className="text-xs text-gray-400">원</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-500">합계</span>
            <span className="font-bold text-gray-900">{fmt(total)}원</span>
          </div>
          {message && <p className="mt-2 text-sm text-green-600">{message}</p>}
          <button onClick={handleSave} disabled={saving} className="mt-3 w-full flex items-center justify-center gap-1 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]">
            <Save className="w-4 h-4" /> {saving ? '저장 중...' : '공과금 저장'}
          </button>
        </div>
      )}
    </div>
  );
}
