import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { Users, Receipt, Camera, AlertTriangle, Check, TrendingUp, Zap, Droplets, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

export default function AdminDashboard() {
  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const kstDay = kst.getDate();
  const kstMonth = kst.getMonth() + 1;
  const prevM = kstMonth === 1 ? 12 : kstMonth - 1;
  const prevY = kstMonth === 1 ? kst.getFullYear() - 1 : kst.getFullYear();
  const [year, setYear] = useState(prevY);
  const [month, setMonth] = useState(prevM);
  const [tenants, setTenants] = useState([]);
  const [bills, setBills] = useState([]);
  const [readings, setReadings] = useState([]);

  const load = useCallback(async () => {
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
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // 월 이동
  const goMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y);
    setMonth(m);
  };

  const activeTenants = tenants.filter((t) => t.is_active);
  const fmt = (n) => (n || 0).toLocaleString();

  // Meter upload stats
  const isWaterMonth = month % 2 === 1;
  const requiredPerTenant = isWaterMonth ? 2 : 1;
  const fullyUploadedCount = activeTenants.filter((t) => {
    const tenantUploads = readings.filter((r) => r.tenant_id === t.id && r.uploaded_at);
    return tenantUploads.length >= requiredPerTenant;
  }).length;
  const totalExpected = activeTenants.length;
  const allUploaded = fullyUploadedCount === totalExpected && totalExpected > 0;

  // Billing stats (부가세 10% 포함, 수도세 면세)
  const withVat = (n, noVat) => (n || 0) + (noVat ? 0 : Math.round((n || 0) * 0.1));
  const payFields = ['rent_paid', 'maintenance_paid', 'electricity_paid', 'water_paid'];
  const amtFields = ['rent_amount', 'maintenance_fee', 'electricity_amount', 'water_amount'];
  const noVatFlags = [false, false, false, true]; // 수도만 면세
  const totalBilled = bills.reduce((s, b) => {
    return s + amtFields.reduce((ss, f, i) => ss + withVat(b[f], noVatFlags[i]), 0);
  }, 0);
  const totalPaid = bills.reduce((s, b) => {
    let p = 0;
    payFields.forEach((f, i) => { if (b[f]) p += withVat(b[amtFields[i]], noVatFlags[i]); });
    return s + p;
  }, 0);
  const unpaidTenants = bills.filter((b) => !payFields.every((f, i) => b[amtFields[i]] === 0 || b[f])).length;

  const isCurrentMonth = year === kst.getFullYear() && month === kst.getMonth() + 1;

  const cards = [
    { label: '활성 입주사', value: activeTenants.length, sub: `총 ${tenants.length}개`, icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: '사진 업로드', value: `${fullyUploadedCount}/${totalExpected}`, sub: allUploaded ? '모두 완료' : '진행 중', icon: Camera, color: allUploaded ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600' },
    { label: '청구', value: bills.length > 0 ? `${fmt(totalBilled)}원` : '미생성', sub: bills.length > 0 ? `수납 ${fmt(totalPaid)}원` : '', icon: Receipt, color: 'bg-purple-50 text-purple-600' },
    { label: '미납', value: unpaidTenants > 0 ? `${unpaidTenants}건` : '없음', sub: unpaidTenants > 0 ? `${fmt(totalBilled - totalPaid)}원` : '', icon: unpaidTenants > 0 ? AlertTriangle : Check, color: unpaidTenants > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600' },
  ];

  return (
    <div>
      {/* 헤더 + 월 선택 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">대시보드</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => goMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[90px] text-center">{year}년 {month}월</span>
          <button onClick={() => goMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

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

      {/* 검침 기간 안내 — 현재월일 때만 */}
      {isCurrentMonth && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-2 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-gray-500" /> 검침 일정
          </h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-gray-700">
                전기: 매월 22~23일 업로드 → <b>24일 자동 배분</b>
              </span>
              {kstDay >= 22 && kstDay <= 23 ? (
                <span className="ml-auto px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-[10px] font-medium">진행 중</span>
              ) : kstDay < 22 ? (
                <span className="ml-auto px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">{22 - kstDay}일 후</span>
              ) : kstDay === 24 ? (
                <span className="ml-auto px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">배분일</span>
              ) : (
                <span className="ml-auto px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">완료</span>
              )}
            </div>
            {month % 2 === 1 && (
              <div className="flex items-center gap-2">
                <Droplets className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-gray-700">
                  수도: 홀수달 6~7일 업로드 → <b>8일 자동 배분</b>
                </span>
                {kstDay >= 6 && kstDay <= 7 ? (
                  <span className="ml-auto px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">진행 중</span>
                ) : kstDay < 6 ? (
                  <span className="ml-auto px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">{6 - kstDay}일 후</span>
                ) : kstDay === 8 ? (
                  <span className="ml-auto px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">배분일</span>
                ) : (
                  <span className="ml-auto px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">완료</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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
                <span className={`text-xs px-2 py-0.5 rounded ${photoCount >= requiredPerTenant ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  사진 {photoCount}/{requiredPerTenant}
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
