import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { Flame, Zap, Droplets, Camera, Check, X, Eye, MessageSquare } from 'lucide-react';

const UTILITY_TYPES = [
  { key: 'gas', label: '가스', icon: Flame, color: 'text-orange-500' },
  { key: 'electricity', label: '전기', icon: Zap, color: 'text-yellow-500' },
  { key: 'water', label: '수도', icon: Droplets, color: 'text-blue-500' },
];

export default function MeterOverview() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [readings, setReadings] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [photoModal, setPhotoModal] = useState(null);
  const [smsResult, setSmsResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const [readingsRes, tenantsRes] = await Promise.all([
        authFetch(`${API_BASE}/meter-readings?year=${year}&month=${month}`),
        authFetch(`${API_BASE}/tenants`),
      ]);
      if (readingsRes.ok) setReadings(await readingsRes.json());
      if (tenantsRes.ok) setTenants(await tenantsRes.json());
    } catch {}
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const getReading = (tenantId, utype) =>
    readings.find((r) => r.tenant_id === tenantId && r.utility_type === utype);

  const handleSaveReading = async (readingId) => {
    try {
      await authFetch(`${API_BASE}/meter-readings/${readingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reading_value: editValue ? Number(editValue) : null }),
      });
      setEditingId(null);
      load();
    } catch {}
  };

  const handleSendReminder = async () => {
    try {
      const res = await authFetch(`${API_BASE}/sms/remind-meter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      if (res.ok) setSmsResult(await res.json());
    } catch {}
  };

  const activeTenants = tenants.filter((t) => t.is_active);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-900">계량기 검침</h2>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
          <button onClick={handleSendReminder} className="flex items-center gap-1 px-3 py-2 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 min-h-[44px]">
            <MessageSquare className="w-4 h-4" /> 촬영 알림
          </button>
        </div>
      </div>

      {smsResult && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">
          {smsResult.message}
          {smsResult.targets?.length > 0 && (
            <ul className="mt-1 text-xs">
              {smsResult.targets.map((t, i) => (
                <li key={i}>{t.floor}층 {t.company} — 미업로드 {t.missing}건</li>
              ))}
            </ul>
          )}
          <button onClick={() => setSmsResult(null)} className="text-xs text-blue-500 underline mt-1">닫기</button>
        </div>
      )}

      {/* Overview cards */}
      <div className="space-y-3">
        {activeTenants.map((tenant) => (
          <div key={tenant.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                {tenant.floor}F
              </span>
              <span className="font-semibold text-gray-900 text-sm">{tenant.company_name}</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {UTILITY_TYPES.map(({ key, label, icon: Icon, color }) => {
                const reading = getReading(tenant.id, key);
                const hasPhoto = !!reading?.uploaded_at;
                const hasValue = reading?.reading_value != null;

                return (
                  <div key={key} className={`rounded-lg p-3 text-center ${hasPhoto ? 'bg-green-50' : 'bg-gray-50'}`}>
                    <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                    <p className="text-xs text-gray-500 mb-1">{label}</p>

                    {/* Photo status */}
                    <div className="mb-1">
                      {hasPhoto ? (
                        <button
                          onClick={() => setPhotoModal(reading.id)}
                          className="text-xs text-green-600 flex items-center justify-center gap-0.5"
                        >
                          <Check className="w-3 h-3" /> <Eye className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 flex items-center justify-center gap-0.5">
                          <X className="w-3 h-3" /> 미업로드
                        </span>
                      )}
                    </div>

                    {/* Reading value */}
                    {reading && editingId === reading.id ? (
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.01"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full px-1 py-1 border border-gray-300 rounded text-xs text-center"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveReading(reading.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <button onClick={() => handleSaveReading(reading.id)} className="text-green-600 text-xs">
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (!reading) return;
                          setEditingId(reading.id);
                          setEditValue(reading.reading_value ?? '');
                        }}
                        className={`text-xs font-mono ${hasValue ? 'text-gray-900' : 'text-gray-400'} hover:text-blue-600`}
                        disabled={!reading}
                      >
                        {hasValue ? Number(reading.reading_value).toLocaleString() : '입력'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {activeTenants.length === 0 && (
        <p className="text-center py-12 text-gray-400">등록된 입주사가 없습니다</p>
      )}

      {/* Photo Modal */}
      {photoModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPhotoModal(null)}>
          <div className="max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={`${API_BASE}/meter-readings/${photoModal}/photo`}
              alt="계량기 사진"
              className="w-full rounded-xl"
            />
            <button onClick={() => setPhotoModal(null)} className="mt-3 w-full py-3 bg-white text-gray-900 rounded-xl font-medium">
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
