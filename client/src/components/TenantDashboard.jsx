import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BankInfo from './BankInfo';
import { Camera, AlertCircle } from 'lucide-react';

const ITEMS = [
  { field: 'rent_paid', label: '임대료', amountField: 'rent_amount' },
  { field: 'maintenance_paid', label: '관리비', amountField: 'maintenance_fee' },
  { field: 'gas_paid', label: '가스', amountField: 'gas_amount' },
  { field: 'electricity_paid', label: '전기', amountField: 'electricity_amount' },
  { field: 'water_paid', label: '수도', amountField: 'water_amount' },
];

const vat = (n) => Math.round((n || 0) * 0.1);
const withVat = (n) => (n || 0) + vat(n);

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

  const totalWithVat = bill
    ? ITEMS.reduce((s, { amountField }) => s + withVat(bill[amountField]), 0)
    : 0;

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
            <p className="text-sm text-gray-500">이번 달 청구 금액 <span className="text-xs text-gray-400">(부가세 포함)</span></p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {fmt(totalWithVat)}원
            </p>
          </div>

          <div className="space-y-3">
            {ITEMS.map(({ field, label, amountField }) => {
              const amount = bill[amountField];
              if (amount === 0) return null;
              const isPaid = bill[field];
              const vatAmt = vat(amount);
              const total = amount + vatAmt;
              return (
                <div key={field} className="border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{label}</span>
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                      isPaid
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {isPaid ? '납부완료' : '납부대기'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 text-xs text-gray-500">
                    <div>
                      <span className="text-gray-400">공급가액</span>
                      <p className="font-medium text-gray-700">{fmt(amount)}</p>
                    </div>
                    <div>
                      <span className="text-gray-400">부가세</span>
                      <p className="font-medium text-gray-700">{fmt(vatAmt)}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-gray-400">합계</span>
                      <p className={`font-bold ${isPaid ? 'text-green-600' : 'text-gray-900'}`}>{fmt(total)}</p>
                    </div>
                  </div>
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

      {/* 유의사항 */}
      <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
        <p className="text-xs font-semibold text-gray-700 mb-1">유의사항</p>
        <ul className="text-xs text-gray-600 space-y-0.5 list-disc list-inside">
          <li>모든 금액은 부가세 10% 별도이며, 합계 금액으로 입금해주세요.</li>
          <li>매월 22일까지 계량기 검침 사진을 업로드해주세요. 미제출 시 전월 사용량의 1.5배로 임시 부과됩니다.</li>
          <li>납부기한 경과 시에는 월 2%의 연체이자가 일수 계산으로 가산됩니다.</li>
        </ul>
      </div>
    </div>
  );
}
