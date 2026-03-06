import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BuildingBillForm from './BuildingBillForm';
import { FileText, MessageSquare, Plus, Pencil } from 'lucide-react';

const PAY_FIELDS = [
  { field: 'rent_paid', label: '임대료', amountField: 'rent_amount' },
  { field: 'maintenance_paid', label: '관리비', amountField: 'maintenance_fee' },
  { field: 'electricity_paid', label: '전기', amountField: 'electricity_amount' },
  { field: 'water_paid', label: '수도', amountField: 'water_amount', noVat: true },
];

const vatOf = (n, noVat) => noVat ? 0 : Math.round((n || 0) * 0.1);
const withVat = (n, noVat) => (n || 0) + vatOf(n, noVat);

export default function BillingView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [bills, setBills] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [generatingRent, setGeneratingRent] = useState(false);
  const [message, setMessage] = useState('');
  const [smsResult, setSmsResult] = useState(null);
  const [editingOther, setEditingOther] = useState(null); // billId
  const [otherLabel, setOtherLabel] = useState('');
  const [otherAmount, setOtherAmount] = useState('');

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

  const handleGenerateRent = async () => {
    if (!confirm(`${year}년 ${month}월 임대료/관리비를 발행하시겠습니까?`)) return;
    setGeneratingRent(true);
    setMessage('');
    try {
      const res = await authFetch(`${API_BASE}/monthly-bills/generate-rent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      const data = await res.json();
      setMessage(data.message || data.error);
      if (res.ok) loadBills();
    } catch {
      setMessage('발행 실패');
    } finally {
      setGeneratingRent(false);
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

  const handleSaveOther = async (billId) => {
    try {
      const res = await authFetch(`${API_BASE}/monthly-bills/${billId}/other`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ other_amount: Number(otherAmount) || 0, other_label: otherLabel || null }),
      });
      if (res.ok) {
        setEditingOther(null);
        loadBills();
      }
    } catch {}
  };

  const startEditOther = (bill) => {
    setEditingOther(bill.id);
    setOtherLabel(bill.other_label || '');
    setOtherAmount(String(bill.other_amount || ''));
  };

  const fmt = (n) => (n || 0).toLocaleString();

  const billTotal = (b) => {
    const base = PAY_FIELDS.reduce((ss, { amountField, noVat }) => ss + withVat(b[amountField], noVat), 0);
    return base + withVat(b.other_amount || 0, false);
  };

  const billPaid = (b) => {
    let paid = 0;
    PAY_FIELDS.forEach(({ field, amountField, noVat }) => { if (b[field]) paid += withVat(b[amountField], noVat); });
    if (b.other_paid && b.other_amount > 0) paid += withVat(b.other_amount, false);
    return paid;
  };

  const totalAll = bills.reduce((s, b) => s + billTotal(b), 0);
  const totalPaid = bills.reduce((s, b) => s + billPaid(b), 0);

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

      {/* Info */}
      <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-xs">
        임대료/관리비는 각 입주사의 청구일에 자동 생성됩니다. 건물 공과금 입력 후 공과금 배분을 실행하세요.
      </div>

      {/* Generate buttons */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleGenerateRent}
          disabled={generatingRent}
          className="flex items-center justify-center gap-1 px-3 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
        >
          <Plus className="w-4 h-4" /> {generatingRent ? '발행 중...' : '임대료/관리비'}
        </button>
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
          <p className="text-xs text-gray-400 mb-2">부가세 10% 포함 (수도 면세)</p>
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
          const totalWithVat = billTotal(bill);
          const activeFields = PAY_FIELDS.filter(({ amountField }) => bill[amountField] > 0);
          const otherActive = (bill.other_amount || 0) > 0;
          const totalCount = activeFields.length + (otherActive ? 1 : 0);
          const paidCount = activeFields.filter(({ field }) => bill[field]).length + (otherActive && bill.other_paid ? 1 : 0);
          const allPaid = totalCount > 0 && paidCount === totalCount;

          return (
            <div key={bill.id} className={`bg-white rounded-xl border-2 p-4 ${allPaid ? 'border-green-200' : 'border-gray-200'}`}>
              {/* Header: 업체명 + 상태 + 합계 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                    {bill.floor}F
                  </span>
                  <span className="font-semibold text-gray-900 text-sm">{bill.company_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                    allPaid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {allPaid ? '완납' : `${paidCount}/${totalCount}`}
                  </span>
                  <span className="font-bold text-sm">{fmt(totalWithVat)}원</span>
                </div>
              </div>

              {/* 항목 리스트 */}
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                {PAY_FIELDS.map(({ field, label, amountField, noVat }) => {
                  const amount = bill[amountField];
                  if (amount === 0) return null;
                  const isPaid = bill[field];
                  const v = vatOf(amount, noVat);
                  const t = amount + v;
                  return (
                    <div key={field} className="flex items-center justify-between px-3 py-2.5 border-t border-gray-50 first:border-t-0">
                      <span className="text-sm text-gray-900 min-w-[40px]">{label}</span>
                      <div className="flex-1 text-right mr-3">
                        <span className={`text-sm font-medium ${isPaid ? 'text-green-600' : 'text-gray-900'}`}>{fmt(t)}원</span>
                        <p className="text-[11px] text-gray-400">공급 {fmt(amount)}</p>
                        <p className="text-[11px] text-gray-400">세액 {fmt(v)}</p>
                      </div>
                      <button
                        onClick={() => handleTogglePay(bill.id, field)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap ${
                          isPaid
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        }`}
                      >
                        {isPaid ? '완료' : '대기'}
                      </button>
                    </div>
                  );
                })}

                {/* 기타 항목 */}
                {otherActive && editingOther !== bill.id && (
                  <div className="flex items-center justify-between px-3 py-2.5 border-t border-gray-50">
                    <div className="flex items-center gap-1 min-w-[40px]">
                      <span className="text-sm text-gray-900">{bill.other_label || '기타'}</span>
                      <button onClick={() => startEditOther(bill)} className="text-gray-400 hover:text-gray-600">
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex-1 text-right mr-3">
                      <span className={`text-sm font-medium ${bill.other_paid ? 'text-green-600' : 'text-gray-900'}`}>{fmt(withVat(bill.other_amount, false))}원</span>
                      <p className="text-[11px] text-gray-400">공급 {fmt(bill.other_amount)}</p>
                      <p className="text-[11px] text-gray-400">세액 {fmt(vatOf(bill.other_amount, false))}</p>
                    </div>
                    <button
                      onClick={() => handleTogglePay(bill.id, 'other_paid')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap ${
                        bill.other_paid
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      }`}
                    >
                      {bill.other_paid ? '완료' : '대기'}
                    </button>
                  </div>
                )}

                {/* 기타 항목 편집 UI */}
                {editingOther === bill.id && (
                  <div className="px-3 py-2.5 border-t border-gray-50 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={otherLabel}
                        onChange={(e) => setOtherLabel(e.target.value)}
                        placeholder="항목명 (예: 재활용비)"
                        className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                      <input
                        type="number"
                        value={otherAmount}
                        onChange={(e) => setOtherAmount(e.target.value)}
                        placeholder="금액"
                        className="w-28 px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditingOther(null)}
                        className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => handleSaveOther(bill.id)}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                )}

                {/* 기타 추가 버튼 (기타 금액이 0일 때) */}
                {!otherActive && editingOther !== bill.id && (
                  <div className="px-3 py-2 border-t border-gray-50">
                    <button
                      onClick={() => startEditOther(bill)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600"
                    >
                      <Plus className="w-3 h-3" /> 기타 추가
                    </button>
                  </div>
                )}
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
