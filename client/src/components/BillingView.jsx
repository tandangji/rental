import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BuildingBillForm from './BuildingBillForm';
import { FileText, Check, X, MessageSquare } from 'lucide-react';

const PAY_FIELDS = [
  { field: 'rent_paid', label: '임대료', amountField: 'rent_amount' },
  { field: 'maintenance_paid', label: '관리비', amountField: 'maintenance_fee' },
  { field: 'gas_paid', label: '가스', amountField: 'gas_amount' },
  { field: 'electricity_paid', label: '전기', amountField: 'electricity_amount' },
  { field: 'water_paid', label: '수도', amountField: 'water_amount' },
];

export default function BillingView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [bills, setBills] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [smsResult, setSmsResult] = useState(null);

  const loadBills = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/monthly-bills?year=${year}&month=${month}`);
      if (res.ok) setBills(await res.json());
    } catch {}
  }, [year, month]);

  useEffect(() => { loadBills(); }, [loadBills]);

  const handleGenerate = async () => {
    if (!confirm(`${year}년 ${month}월 공과금을 배분하시겠습니까?\n검침값과 건물 공과금을 기반으로 각 층에 배분합니다.`)) return;
    setGenerating(true);
    setMessage('');
    try {
      const res = await authFetch(`${API_BASE}/monthly-bills/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message);
        loadBills();
      } else {
        setMessage(data.error);
      }
    } catch {
      setMessage('배분 실패');
    } finally {
      setGenerating(false);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  const handleTogglePay = async (billId, field) => {
    try {
      const res = await authFetch(`${API_BASE}/monthly-bills/${billId}/pay`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field }),
      });
      if (res.ok) loadBills();
    } catch {}
  };

  const handleSendReminder = async () => {
    try {
      const res = await authFetch(`${API_BASE}/sms/remind-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      if (res.ok) setSmsResult(await res.json());
    } catch {}
  };

  const fmt = (n) => (n || 0).toLocaleString();

  const totalAll = bills.reduce((s, b) => s + b.rent_amount + b.maintenance_fee + b.gas_amount + b.electricity_amount + b.water_amount, 0);
  const totalPaid = bills.reduce((s, b) => {
    let paid = 0;
    PAY_FIELDS.forEach(({ field, amountField }) => { if (b[field]) paid += b[amountField]; });
    return s + paid;
  }, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-900">청구서 관리</h2>
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
        </div>
      </div>

      {/* Building bill form */}
      <div className="mb-4">
        <BuildingBillForm year={year} month={month} onSaved={loadBills} />
      </div>

      {/* Info: 임대료/관리비 자동생성 안내 */}
      <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-xs">
        임대료/관리비는 각 입주사의 청구일에 자동 생성됩니다. 아래에서 건물 공과금 입력 후 공과금 배분을 실행하세요.
      </div>

      {/* Generate button */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex-1 flex items-center justify-center gap-1 py-2.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 min-h-[44px]"
        >
          <FileText className="w-4 h-4" /> {generating ? '배분 중...' : '공과금 배분'}
        </button>
        {bills.length > 0 && (
          <button
            onClick={handleSendReminder}
            className="flex items-center gap-1 px-3 py-2.5 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 min-h-[44px]"
          >
            <MessageSquare className="w-4 h-4" /> 미납 알림
          </button>
        )}
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">{message}</div>
      )}

      {smsResult && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">
          {smsResult.message}
          {smsResult.targets?.length > 0 && (
            <ul className="mt-1 text-xs">
              {smsResult.targets.map((t, i) => (
                <li key={i}>{t.floor}층 {t.company} — 미납: {t.unpaid.join(', ')}</li>
              ))}
            </ul>
          )}
          <button onClick={() => setSmsResult(null)} className="text-xs text-blue-500 underline mt-1">닫기</button>
        </div>
      )}

      {/* Summary */}
      {bills.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">총 청구액</span>
            <span className="font-bold">{fmt(totalAll)}원</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-500">수납액</span>
            <span className="font-bold text-green-600">{fmt(totalPaid)}원</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-500">미수금</span>
            <span className="font-bold text-red-600">{fmt(totalAll - totalPaid)}원</span>
          </div>
        </div>
      )}

      {/* Bill cards */}
      <div className="space-y-3">
        {bills.map((bill) => {
          const total = bill.rent_amount + bill.maintenance_fee + bill.gas_amount + bill.electricity_amount + bill.water_amount;
          let paid = 0;
          PAY_FIELDS.forEach(({ field, amountField }) => { if (bill[field]) paid += bill[amountField]; });
          const allPaid = PAY_FIELDS.every(({ field, amountField }) => bill[amountField] === 0 || bill[field]);

          return (
            <div key={bill.id} className={`bg-white rounded-xl border-2 p-4 ${allPaid ? 'border-green-200' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                    {bill.floor}F
                  </span>
                  <span className="font-semibold text-gray-900 text-sm">{bill.company_name}</span>
                </div>
                <span className="font-bold text-sm">{fmt(total)}원</span>
              </div>

              <div className="space-y-2">
                {PAY_FIELDS.map(({ field, label, amountField }) => {
                  const amount = bill[amountField];
                  if (amount === 0) return null;
                  const isPaid = bill[field];
                  return (
                    <div key={field} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleTogglePay(bill.id, field)}
                          className={`w-6 h-6 rounded flex items-center justify-center ${
                            isPaid ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-300 hover:bg-gray-200'
                          }`}
                        >
                          {isPaid ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                        </button>
                        <span className="text-sm text-gray-700">{label}</span>
                      </div>
                      <span className={`text-sm font-medium ${isPaid ? 'text-green-600' : 'text-gray-900'}`}>
                        {fmt(amount)}원
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {bills.length === 0 && (
        <p className="text-center py-8 text-gray-400">청구서가 없습니다. 각 입주사의 청구일에 임대료/관리비가 자동 생성됩니다.</p>
      )}
    </div>
  );
}
