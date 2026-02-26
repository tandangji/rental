import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { Users, Receipt, Camera, AlertTriangle, Check, TrendingUp } from 'lucide-react';

export default function AdminDashboard() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const [tenants, setTenants] = useState([]);
  const [bills, setBills] = useState([]);
  const [readings, setReadings] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [tRes, bRes, rRes] = await Promise.all([
          authFetch(`${API_BASE}/tenants`),
          authFetch(`${API_BASE}/monthly-bills?year=${year}&month=${month}`),
          authFetch(`${API_BASE}/meter-readings?year=${year}&month=${month}`),
        ]);
        if (tRes.ok) setTenants(await tRes.json());
        if (bRes.ok) setBills(await bRes.json());
        if (rRes.ok) setReadings(await rRes.json());
      } catch {}
    })();
  }, []);

  const activeTenants = tenants.filter((t) => t.is_active);
  const fmt = (n) => (n || 0).toLocaleString();

  // Meter upload stats
  const uploadedCount = new Set(readings.filter((r) => r.uploaded_at).map((r) => r.tenant_id)).size;
  const totalExpected = activeTenants.length;
  const allUploaded = uploadedCount === totalExpected && totalExpected > 0;

  // Billing stats (부가세 10% 포함)
  const withVat = (n) => (n || 0) + Math.round((n || 0) * 0.1);
  const payFields = ['rent_paid', 'maintenance_paid', 'gas_paid', 'electricity_paid', 'water_paid'];
  const amtFields = ['rent_amount', 'maintenance_fee', 'gas_amount', 'electricity_amount', 'water_amount'];
  const totalBilled = bills.reduce((s, b) => {
    return s + amtFields.reduce((ss, f) => ss + withVat(b[f]), 0);
  }, 0);
  const totalPaid = bills.reduce((s, b) => {
    let p = 0;
    payFields.forEach((f, i) => { if (b[f]) p += withVat(b[amtFields[i]]); });
    return s + p;
  }, 0);
  const unpaidTenants = bills.filter((b) => !payFields.every((f, i) => b[amtFields[i]] === 0 || b[f])).length;

  const cards = [
    { label: '활성 입주사', value: activeTenants.length, sub: `총 ${tenants.length}개`, icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: '사진 업로드', value: `${uploadedCount}/${totalExpected}`, sub: allUploaded ? '모두 완료' : '진행 중', icon: Camera, color: allUploaded ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600' },
    { label: '이번 달 청구', value: bills.length > 0 ? `${fmt(totalBilled)}원` : '미생성', sub: bills.length > 0 ? `수납 ${fmt(totalPaid)}원` : '', icon: Receipt, color: 'bg-purple-50 text-purple-600' },
    { label: '미납', value: unpaidTenants > 0 ? `${unpaidTenants}건` : '없음', sub: unpaidTenants > 0 ? `${fmt(totalBilled - totalPaid)}원` : '', icon: unpaidTenants > 0 ? AlertTriangle : Check, color: unpaidTenants > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600' },
  ];

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">대시보드</h2>
      <p className="text-sm text-gray-500 mb-4">{year}년 {month}월 현황</p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {cards.map(({ label, value, sub, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center mb-2`}>
              <Icon className="w-4 h-4" />
            </div>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-lg font-bold text-gray-900">{value}</p>
            {sub && <p className="text-xs text-gray-400">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Quick tenant overview */}
      <h3 className="font-semibold text-gray-900 mb-2 text-sm">입주사 현황</h3>
      <div className="space-y-2">
        {activeTenants.map((t) => {
          const bill = bills.find((b) => b.tenant_id === t.id);
          const tenantReadings = readings.filter((r) => r.tenant_id === t.id && r.uploaded_at);
          const photoCount = tenantReadings.length;
          const allPaid = bill && payFields.every((f, i) => bill[amtFields[i]] === 0 || bill[f]);
          return (
            <div key={t.id} className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-700 bg-blue-50 rounded-full w-6 h-6 flex items-center justify-center">
                  {t.floor}
                </span>
                <span className="text-sm text-gray-900">{t.company_name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded ${photoCount >= 3 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  사진 {photoCount}/3
                </span>
                {bill ? (
                  <span className={`text-xs px-2 py-0.5 rounded ${allPaid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {allPaid ? '완납' : '미납'}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-400">청구서 없음</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {activeTenants.length === 0 && (
        <p className="text-center py-8 text-gray-400">입주사를 등록해주세요</p>
      )}
    </div>
  );
}
