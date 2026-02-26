import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { FileText, Check, Download, Clock, CheckCircle } from 'lucide-react';

export default function TaxInvoiceView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [invoices, setInvoices] = useState([]);
  const [tab, setTab] = useState('pending'); // 'pending' | 'issued'
  const [settings, setSettings] = useState({});

  const load = useCallback(async () => {
    try {
      const [invRes, setRes] = await Promise.all([
        authFetch(`${API_BASE}/tax-invoices?year=${year}&month=${month}`),
        authFetch(`${API_BASE}/settings`),
      ]);
      if (invRes.ok) setInvoices(await invRes.json());
      if (setRes.ok) setSettings(await setRes.json());
    } catch {}
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const handleToggleIssue = async (billId) => {
    try {
      const res = await authFetch(`${API_BASE}/tax-invoices/${billId}/issue`, { method: 'PATCH' });
      if (res.ok) load();
    } catch {}
  };

  const fmt = (n) => (n || 0).toLocaleString();

  const pending = invoices.filter((i) => !i.is_issued);
  const issued = invoices.filter((i) => i.is_issued);
  const filtered = tab === 'pending' ? pending : issued;

  // ─── Excel CSV Download (홈택스 일괄등록양식) ────────────
  const downloadCSV = () => {
    if (pending.length === 0) return;

    // 홈택스 세금계산서 일괄등록양식(일반) 표준 컬럼
    const headers = [
      '세금계산서종류', '작성일자', '공급자등록번호', '공급받는자등록번호',
      '공급받는자상호', '공급받는자성명', '공급받는자주소',
      '공급가액합계', '세액합계', '비고',
      '품목일자1', '품목명1', '품목규격1', '품목수량1', '품목단가1', '품목공급가액1', '품목세액1', '품목비고1',
      '품목일자2', '품목명2', '품목규격2', '품목수량2', '품목단가2', '품목공급가액2', '품목세액2', '품목비고2',
      '품목일자3', '품목명3', '품목규격3', '품목수량3', '품목단가3', '품목공급가액3', '품목세액3', '품목비고3',
      '품목일자4', '품목명4', '품목규격4', '품목수량4', '품목단가4', '품목공급가액4', '품목세액4', '품목비고4',
    ];

    const dateStr = `${year}${String(month).padStart(2, '0')}01`;
    const supplierBizNo = (settings.landlord_business_number || '').replace(/-/g, '');

    const rows = pending.map((inv) => {
      const buyerBizNo = (inv.business_number || '').replace(/-/g, '');

      // Build item rows (max 4)
      const itemCols = [];
      inv.items.forEach((item, idx) => {
        if (idx >= 4) return;
        const itemSupply = Math.round(item.amount / 1.1);
        const itemTax = item.amount - itemSupply;
        itemCols.push(dateStr, item.name, '', '1', itemSupply, itemSupply, itemTax, '');
      });
      // Pad remaining item slots
      for (let i = inv.items.length; i < 4; i++) {
        itemCols.push('', '', '', '', '', '', '', '');
      }

      return [
        '01', // 01=일반
        dateStr,
        supplierBizNo,
        buyerBizNo,
        inv.company_name,
        inv.representative,
        inv.address,
        inv.supply_amount,
        inv.tax_amount,
        `${year}년 ${month}월분`,
        ...itemCols,
      ];
    });

    // BOM + CSV
    const csvContent = '\uFEFF' + [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `세금계산서_${year}년${month}월_발행대기.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

      {/* Tabs */}
      <div className="flex rounded-lg bg-gray-100 p-1 mb-4">
        <button
          onClick={() => setTab('pending')}
          className={`flex-1 flex items-center justify-center gap-1 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'pending' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          <Clock className="w-3.5 h-3.5" /> 발행대기 ({pending.length})
        </button>
        <button
          onClick={() => setTab('issued')}
          className={`flex-1 flex items-center justify-center gap-1 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'issued' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          <CheckCircle className="w-3.5 h-3.5" /> 발행완료 ({issued.length})
        </button>
      </div>

      {/* Download button (pending tab only) */}
      {tab === 'pending' && pending.length > 0 && (
        <button
          onClick={downloadCSV}
          className="w-full flex items-center justify-center gap-2 py-2.5 mb-4 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 min-h-[44px]"
        >
          <Download className="w-4 h-4" /> 홈택스 양식 다운로드 (CSV)
        </button>
      )}

      {/* Summary */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-3 gap-4 text-center text-sm">
            <div>
              <p className="text-gray-500">공급가액</p>
              <p className="font-bold">{fmt(filtered.reduce((s, i) => s + i.supply_amount, 0))}원</p>
            </div>
            <div>
              <p className="text-gray-500">세액</p>
              <p className="font-bold">{fmt(filtered.reduce((s, i) => s + i.tax_amount, 0))}원</p>
            </div>
            <div>
              <p className="text-gray-500">합계</p>
              <p className="font-bold">{fmt(filtered.reduce((s, i) => s + i.total_amount, 0))}원</p>
            </div>
          </div>
        </div>
      )}

      {/* Invoice list */}
      <div className="space-y-3">
        {filtered.map((inv) => (
          <div key={inv.bill_id} className={`bg-white rounded-xl border-2 p-4 ${inv.is_issued ? 'border-green-200' : 'border-gray-200'}`}>
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
                onClick={() => handleToggleIssue(inv.bill_id)}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg min-h-[36px] ${
                  inv.is_issued
                    ? 'bg-green-100 text-green-700 hover:bg-yellow-50 hover:text-yellow-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                {inv.is_issued ? <Check className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                {inv.is_issued ? '발행완료' : '발행처리'}
              </button>
            </div>

            {/* Item breakdown */}
            <div className="space-y-1 mb-2">
              {inv.items.map((item, idx) => (
                <div key={idx} className="flex justify-between text-xs text-gray-600">
                  <span>{item.name}</span>
                  <span>{fmt(item.amount)}원</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 text-sm border-t border-gray-100 pt-2">
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

      {filtered.length === 0 && (
        <p className="text-center py-8 text-gray-400">
          {invoices.length === 0
            ? '청구서가 없습니다. 먼저 청구서를 생성하세요.'
            : tab === 'pending' ? '발행대기 건이 없습니다.' : '발행완료 건이 없습니다.'}
        </p>
      )}
    </div>
  );
}
