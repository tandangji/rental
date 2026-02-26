import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BankInfo from './BankInfo';
import { Check, X, Camera, AlertCircle } from 'lucide-react';

const ITEMS = [
  { field: 'rent_paid', label: '임대료', amountField: 'rent_amount' },
  { field: 'maintenance_paid', label: '관리비', amountField: 'maintenance_fee' },
  { field: 'gas_paid', label: '가스', amountField: 'gas_amount' },
  { field: 'electricity_paid', label: '전기', amountField: 'electricity_amount' },
  { field: 'water_paid', label: '수도', amountField: 'water_amount' },
];

export default function TenantDashboard({ user, settings }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const [bill, setBill] = useState(null);
  const [readings, setReadings] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [bRes, rRes] = await Promise.all([
          authFetch(`${API_BASE}/monthly-bills?year=${year}&month=${month}`),
          authFetch(`${API_BASE}/meter-readings?year=${year}&month=${month}`),
        ]);
        if (bRes.ok) { const data = await bRes.json(); setBill(data[0] || null); }
        if (rRes.ok) setReadings(await rRes.json());
      } catch {}
    })();
  }, []);

  const fmt = (n) => (n || 0).toLocaleString();
  const uploadedTypes = new Set(readings.filter((r) => r.uploaded_at).map((r) => r.utility_type));
  const missingPhotos = 3 - uploadedTypes.size;

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">{user.name}</h2>
      <p className="text-sm text-gray-500 mb-4">{user.floor}층 · {year}년 {month}월</p>

      {/* Photo upload status */}
      {missingPhotos > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <Camera className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-yellow-800 text-sm">계량기 사진을 업로드해주세요</p>
            <p className="text-xs text-yellow-700 mt-1">
              {['가스', '전기', '수도'].filter((_, i) => !uploadedTypes.has(['gas', 'electricity', 'water'][i])).join(', ')} — {missingPhotos}건 미업로드
            </p>
          </div>
        </div>
      )}

      {/* Current bill */}
      {bill ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="text-center mb-4">
            <p className="text-sm text-gray-500">이번 달 청구 금액</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {fmt(bill.rent_amount + bill.maintenance_fee + bill.gas_amount + bill.electricity_amount + bill.water_amount)}원
            </p>
          </div>

          <div className="space-y-2">
            {ITEMS.map(({ field, label, amountField }) => {
              const amount = bill[amountField];
              if (amount === 0) return null;
              const isPaid = bill[field];
              return (
                <div key={field} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded flex items-center justify-center ${
                      isPaid ? 'bg-green-500 text-white' : 'bg-red-100 text-red-400'
                    }`}>
                      {isPaid ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    </span>
                    <span className="text-sm text-gray-700">{label}</span>
                  </div>
                  <span className={`text-sm font-medium ${isPaid ? 'text-green-600' : 'text-gray-900'}`}>
                    {fmt(amount)}원
                  </span>
                </div>
              );
            })}
          </div>

          {/* Unpaid warning */}
          {ITEMS.some(({ field, amountField }) => bill[amountField] > 0 && !bill[field]) && (
            <div className="mt-3 p-3 bg-red-50 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm text-red-700">미납 항목이 있습니다. 아래 계좌로 입금해주세요.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center mb-4">
          <p className="text-gray-400">이번 달 청구서가 아직 생성되지 않았습니다</p>
        </div>
      )}

      {/* Bank info */}
      <BankInfo settings={settings} />
    </div>
  );
}
