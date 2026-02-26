import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BankInfo from './BankInfo';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react';

const ITEMS = [
  { field: 'rent_paid', label: '임대료', amountField: 'rent_amount', dateField: 'rent_paid_date' },
  { field: 'maintenance_paid', label: '관리비', amountField: 'maintenance_fee', dateField: 'maintenance_paid_date' },
  { field: 'gas_paid', label: '가스', amountField: 'gas_amount', dateField: 'gas_paid_date' },
  { field: 'electricity_paid', label: '전기', amountField: 'electricity_amount', dateField: 'electricity_paid_date' },
  { field: 'water_paid', label: '수도', amountField: 'water_amount', dateField: 'water_paid_date' },
];

export default function MyBillView({ user, settings }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [bills, setBills] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

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
              <p className="text-sm text-gray-500">{year}년 {month}월</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {fmt(bill.rent_amount + bill.maintenance_fee + bill.gas_amount + bill.electricity_amount + bill.water_amount)}원
              </p>
            </div>

            <div className="space-y-3">
              {ITEMS.map(({ field, label, amountField, dateField }) => {
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
                    <div className="text-right">
                      <span className={`text-sm font-medium ${isPaid ? 'text-green-600' : 'text-gray-900'}`}>
                        {fmt(amount)}원
                      </span>
                      {isPaid && bill[dateField] && (
                        <p className="text-xs text-gray-400">{bill[dateField]}</p>
                      )}
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
