import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch, getToken } from '../utils/api';
import { Flame, Zap, Droplets, Camera, Check, X, Eye, MessageSquare, Trash2 } from 'lucide-react';

const UTILITY_TYPES = [
  { key: 'gas', label: '가스', unit: 'm³', icon: Flame, color: 'text-orange-500' },
  { key: 'electricity', label: '전기', unit: 'kWh', icon: Zap, color: 'text-yellow-500' },
  { key: 'water', label: '수도', unit: 'm³', icon: Droplets, color: 'text-blue-500' },
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

  const handleCreateAndSave = async (tenantId, utilityType) => {
    try {
      await authFetch(`${API_BASE}/meter-readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          year, month,
          utility_type: utilityType,
          reading_value: editValue ? Number(editValue) : null,
        }),
      });
      setEditingId(null);
      load();
    } catch {}
  };

  const handleDeletePhoto = async (readingId) => {
    if (!confirm('이 사진을 삭제하시겠습니까?')) return;
    try {
      await authFetch(`${API_BASE}/meter-readings/${readingId}/photo`, { method: 'DELETE' });
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

      <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-xs">
        사진을 확인하고 각 층별 사용량을 입력하세요. 사용량 기준으로 공과금이 배분됩니다.
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

      {/* Overview cards — 3열 그리드 (가스 | 전기 | 수도) */}
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
              {UTILITY_TYPES.map(({ key, label, unit, icon: Icon, color }) => {
                const reading = getReading(tenant.id, key);
                const hasPhoto = !!reading?.uploaded_at;
                const hasValue = reading?.reading_value != null;
                const editKey = `${tenant.id}-${key}`;
                const isEditing = editingId === editKey;

                return (
                  <div key={key} className={`rounded-lg p-3 text-center ${hasPhoto ? 'bg-green-50' : 'bg-gray-50'}`}>
                    <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
                    <p className="text-xs text-gray-500 mb-1">{label}</p>

                    {/* 사진 썸네일 / 상태 */}
                    <div className="mb-2">
                      {hasPhoto ? (
                        <div className="relative">
                          <button onClick={() => setPhotoModal(reading.id)} className="w-full">
                            <img
                              src={`${API_BASE}/meter-readings/${reading.id}/photo?token=${getToken()}`}
                              alt={`${label} 계량기`}
                              className="w-full h-16 object-cover rounded bg-gray-100"
                              loading="lazy"
                            />
                          </button>
                          <button
                            onClick={() => handleDeletePhoto(reading.id)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-16 rounded bg-gray-100 flex items-center justify-center">
                          <span className="text-xs text-gray-400 flex items-center gap-0.5">
                            <Camera className="w-3 h-3" /> 미업로드
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 사용량 입력 */}
                    {isEditing ? (
                      <div className="space-y-1">
                        <input
                          type="number"
                          step="0.01"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full px-1 py-1.5 border border-gray-300 rounded text-xs text-center"
                          autoFocus
                          placeholder={unit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (reading) handleSaveReading(reading.id);
                              else handleCreateAndSave(tenant.id, key);
                            }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => {
                              if (reading) handleSaveReading(reading.id);
                              else handleCreateAndSave(tenant.id, key);
                            }}
                            className="text-green-600 text-xs p-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-gray-400 text-xs p-1">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingId(editKey);
                          setEditValue(reading?.reading_value ?? '');
                        }}
                        className={`text-xs w-full py-1.5 rounded ${
                          hasValue
                            ? 'font-mono font-medium text-gray-900 bg-white border border-gray-200 hover:border-blue-400'
                            : 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                        }`}
                      >
                        {hasValue ? `${Number(reading.reading_value).toLocaleString()} ${unit}` : '사용량 입력'}
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
              src={`${API_BASE}/meter-readings/${photoModal}/photo?token=${getToken()}`}
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
