import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { FileText, Check, X, RefreshCw } from 'lucide-react';

export default function TaxInvoiceView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [invoices, setInvoices] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/tax-invoices?year=${year}&month=${month}`);
      if (res.ok) setInvoices(await res.json());
    } catch {}
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (!confirm(`${year}년 ${month}월 세금계산서를 생성하시겠습니까?`)) return;
    setGenerating(true);
    setMessage('');
    try {
      const res = await authFetch(`${API_BASE}/tax-invoices/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month }),
      });
      const data = await res.json();
      setMessage(res.ok ? data.message : data.error);
      if (res.ok) load();
    } catch {
      setMessage('생성 실패');
    } finally {
      setGenerating(false);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  const handleToggleIssue = async (id) => {
    try {
      const res = await authFetch(`${API_BASE}/tax-invoices/${id}/issue`, { method: 'PATCH' });
      if (res.ok) load();
    } catch {}
  };

  const fmt = (n) => (n || 0).toLocaleString();

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-bold text-gray-900">세금계산서</h2>
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

      <div className="flex gap-2 mb-4">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex-1 flex items-center justify-center gap-1 py-2.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 min-h-[44px]"
        >
          <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
          {generating ? '생성 중...' : '세금계산서 생성'}
        </button>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${message.includes('실패') || message.includes('없습니다') ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
          {message}
        </div>
      )}

      {/* Summary */}
      {invoices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-3 gap-4 text-center text-sm">
            <div>
              <p className="text-gray-500">공급가액</p>
              <p className="font-bold">{fmt(invoices.reduce((s, i) => s + i.supply_amount, 0))}원</p>
            </div>
            <div>
              <p className="text-gray-500">세액</p>
              <p className="font-bold">{fmt(invoices.reduce((s, i) => s + i.tax_amount, 0))}원</p>
            </div>
            <div>
              <p className="text-gray-500">합계</p>
              <p className="font-bold">{fmt(invoices.reduce((s, i) => s + i.total_amount, 0))}원</p>
            </div>
          </div>
        </div>
      )}

      {/* Invoice list */}
      <div className="space-y-3">
        {invoices.map((inv) => (
          <div key={inv.id} className={`bg-white rounded-xl border-2 p-4 ${inv.is_issued ? 'border-green-200' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                  {inv.floor}F
                </span>
                <div>
                  <span className="font-semibold text-gray-900 text-sm">{inv.company_name}</span>
                  {inv.business_number && (
                    <p className="text-xs text-gray-400">{inv.business_number}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleToggleIssue(inv.id)}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg min-h-[36px] ${
                  inv.is_issued
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                {inv.is_issued ? <Check className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                {inv.is_issued ? '발행완료' : '발행처리'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-xs text-gray-400">공급가액</p>
                <p className="font-medium">{fmt(inv.supply_amount)}원</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">세액</p>
                <p className="font-medium">{fmt(inv.tax_amount)}원</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">합계</p>
                <p className="font-bold">{fmt(inv.total_amount)}원</p>
              </div>
            </div>
            {inv.is_issued && inv.issued_date && (
              <p className="text-xs text-green-600 mt-2">발행일: {inv.issued_date}</p>
            )}
          </div>
        ))}
      </div>

      {invoices.length === 0 && (
        <p className="text-center py-8 text-gray-400">세금계산서가 없습니다. 청구서 생성 후 세금계산서를 생성하세요.</p>
      )}
    </div>
  );
}
