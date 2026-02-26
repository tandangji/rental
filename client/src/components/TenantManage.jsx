import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import TenantForm from './TenantForm';
import { Plus, Pencil, Trash2, Building, Phone, Mail } from 'lucide-react';

export default function TenantManage() {
  const [tenants, setTenants] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadTenants = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/tenants`);
      if (res.ok) setTenants(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  const handleDelete = async (id, name) => {
    if (!confirm(`"${name}" 입주사를 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.`)) return;
    try {
      await authFetch(`${API_BASE}/tenants/${id}`, { method: 'DELETE' });
      loadTenants();
    } catch {}
  };

  const handleSaved = () => {
    setShowForm(false);
    setEditTarget(null);
    loadTenants();
  };

  const fmt = (n) => (n || 0).toLocaleString();

  if (loading) return <div className="text-center py-8 text-gray-400">로딩 중...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">입주사 관리</h2>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 min-h-[44px]"
        >
          <Plus className="w-4 h-4" /> 등록
        </button>
      </div>

      {tenants.length === 0 ? (
        <p className="text-center py-12 text-gray-400">등록된 입주사가 없습니다</p>
      ) : (
        <div className="space-y-3">
          {tenants.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
                    {t.floor}F
                  </span>
                  <div>
                    <p className="font-semibold text-gray-900">{t.company_name}</p>
                    {t.representative && <p className="text-xs text-gray-500">{t.representative}</p>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setEditTarget(t); setShowForm(true); }}
                    className="p-2 text-gray-400 hover:text-blue-600"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id, t.company_name)}
                    className="p-2 text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                <div className="text-gray-500">임대료</div>
                <div className="text-right font-medium">{fmt(t.rent_amount)}원</div>
                <div className="text-gray-500">관리비</div>
                <div className="text-right font-medium">{fmt(t.maintenance_fee)}원</div>
                <div className="text-gray-500">보증금</div>
                <div className="text-right font-medium">{fmt(t.deposit_amount)}원</div>
              </div>

              <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-500">
                {t.contact_phone && (
                  <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{t.contact_phone}</span>
                )}
                {t.email && (
                  <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{t.email}</span>
                )}
                {t.lease_start && t.lease_end && (
                  <span className="flex items-center gap-1"><Building className="w-3 h-3" />{t.lease_start} ~ {t.lease_end}</span>
                )}
              </div>

              {!t.is_active && (
                <span className="inline-block mt-2 px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">비활성</span>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <TenantForm
          tenant={editTarget}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
