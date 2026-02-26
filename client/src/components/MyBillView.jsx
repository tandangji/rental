import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BankInfo from './BankInfo';

const ITEMS = [
  { field: 'rent_paid', label: '임대료', amountField: 'rent_amount', dateField: 'rent_paid_date' },
  { field: 'maintenance_paid', label: '관리비', amountField: 'maintenance_fee', dateField: 'maintenance_paid_date' },
  { field: 'gas_paid', label: '가스', amountField: 'gas_amount', dateField: 'gas_paid_date' },
  { field: 'electricity_paid', label: '전기', amountField: 'electricity_amount', dateField: 'electricity_paid_date' },
  { field: 'water_paid', label: '수도', amountField: 'water_amount', dateField: 'water_paid_date' },
];

const vat = (n) => Math.round((n || 0) * 0.1);
const withVat = (n) => (n || 0) + vat(n);

export default function MyBillView({ user, settings }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [bills, setBills] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}/monthly-bills?year=${year}&month=${month}`);
        if (res.ok) setBills(await res.json());
        else setBills([]);
      } catch { setBills([]); }
    })();
  }, [year, month]);

  const bill = bills[0];
  const fmt = (n) => (n || 0).toLocaleString();

  const totalWithVat = bill
    ? ITEMS.reduce((s, { amountField }) => s + withVat(bill[amountField]), 0)
    : 0;

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-4">청구서</h2>

      <div className="flex items-center gap-2 mb-4">
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
      </div>

      {bill ? (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <div className="text-center mb-4">
              <p className="text-sm text-gray-500">{year}년 {month}월 <span className="text-xs text-gray-400">(부가세 포함)</span></p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {fmt(totalWithVat)}원
              </p>
            </div>

            <div className="space-y-3">
              {ITEMS.map(({ field, label, amountField, dateField }) => {
                const amount = bill[amountField];
                if (amount === 0) return null;
                const isPaid = bill[field];
                const vatAmt = vat(amount);
                const total = amount + vatAmt;
                return (
                  <div key={field} className="border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900">{label}</span>
                      <div className="text-right">
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                          isPaid
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {isPaid ? '납부완료' : '납부대기'}
                        </span>
                        {isPaid && bill[dateField] && (
                          <p className="text-xs text-gray-400 mt-0.5">{bill[dateField]}</p>
                        )}
                      </div>
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
          </div>

          <BankInfo settings={settings} />
        </>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center mb-4">
          <p className="text-gray-400">이번 달 청구서가 아직 생성되지 않았습니다</p>
        </div>
      )}
    </div>
  );
}
