import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { FileText, Check, Download, Clock, CheckCircle } from 'lucide-react';

export default function TaxInvoiceView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [invoices, setInvoices] = useState([]);
  const [tab, setTab] = useState('pending');
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

  const handleToggleIssue = async (billId, itemType) => {
    try {
      const res = await authFetch(`${API_BASE}/tax-invoices/${billId}/issue`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_type: itemType }),
      });
      if (res.ok) load();
    } catch {}
  };

  const fmt = (n) => (n || 0).toLocaleString();

  const pending = invoices.filter((i) => !i.is_issued);
  const issued = invoices.filter((i) => i.is_issued);
  const filtered = tab === 'pending' ? pending : issued;

  // ─── CSV Download (홈택스 일괄등록양식 — 항목별 1행) ────────
  const downloadCSV = () => {
    if (pending.length === 0) return;

    const headers = [
      '세금계산서종류', '작성일자', '공급자등록번호', '공급받는자등록번호',
      '공급받는자상호', '공급받는자성명', '공급받는자주소',
      '공급가액합계', '세액합계', '비고',
      '품목일자1', '품목명1', '품목규격1', '품목수량1', '품목단가1', '품목공급가액1', '품목세액1', '품목비고1',
    ];

    const dateStr = `${year}${String(month).padStart(2, '0')}01`;
    const supplierBizNo = (settings.landlord_business_number || '').replace(/-/g, '');

    const rows = pending.map((inv) => {
      const buyerBizNo = (inv.business_number || '').replace(/-/g, '');
      return [
        '01',
        dateStr,
        supplierBizNo,
        buyerBizNo,
        inv.company_name,
        inv.representative,
        inv.address,
        inv.supply_amount,
        inv.tax_amount,
        `${year}년 ${month}월 ${inv.item_name}`,
        dateStr, inv.item_name, '', '1', inv.supply_amount, inv.supply_amount, inv.tax_amount, '',
      ];
    });

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

      {/* Download button */}
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

      {/* Invoice list — 입주사별 그룹 + 항목 테이블 */}
      <div className="space-y-3">
        {(() => {
          // 입주사별 그룹핑
          const grouped = {};
          filtered.forEach((inv) => {
            const key = `${inv.floor}-${inv.company_name}`;
            if (!grouped[key]) grouped[key] = { floor: inv.floor, company_name: inv.company_name, business_number: inv.business_number, items: [] };
            grouped[key].items.push(inv);
          });
          return Object.values(grouped).map((group) => {
            const totalAmount = group.items.reduce((s, i) => s + i.total_amount, 0);
            const issuedCount = group.items.filter((i) => i.is_issued).length;
            const allIssued = issuedCount === group.items.length;

            return (
              <div key={`${group.floor}-${group.company_name}`} className={`bg-white rounded-xl border-2 p-4 ${allIssued ? 'border-green-200' : 'border-gray-200'}`}>
                {/* Header: 업체명 + 상태 + 합계 */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                      {group.floor}F
                    </span>
                    <div>
                      <span className="font-semibold text-gray-900 text-sm">{group.company_name}</span>
                      {group.business_number && (
                        <p className="text-xs text-gray-400">{group.business_number}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      allIssued ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {allIssued ? '전체발행' : `${issuedCount}/${group.items.length}`}
                    </span>
                    <span className="font-bold text-sm">{fmt(totalAmount)}원</span>
                  </div>
                </div>

                {/* 항목 테이블: 항목명 | 공급가액 | 세액 | 합계 | 상태 */}
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 px-3 py-1.5 bg-gray-50 text-xs text-gray-400">
                    <span>항목</span>
                    <span className="w-20 text-right">공급가액</span>
                    <span className="w-16 text-right">세액</span>
                    <span className="w-20 text-right">합계</span>
                    <span className="w-16 text-center">상태</span>
                  </div>
                  {group.items.map((inv) => (
                    <div key={`${inv.bill_id}-${inv.item_type}`} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 items-center px-3 py-2 border-t border-gray-50 text-xs">
                      <span className="text-sm text-gray-900">{inv.item_name}</span>
                      <span className="w-20 text-right text-gray-700">{fmt(inv.supply_amount)}</span>
                      <span className="w-16 text-right text-gray-500">{fmt(inv.tax_amount)}</span>
                      <span className={`w-20 text-right font-medium ${inv.is_issued ? 'text-green-600' : 'text-gray-900'}`}>{fmt(inv.total_amount)}</span>
                      <span className="w-16 text-center">
                        <button
                          onClick={() => handleToggleIssue(inv.bill_id, inv.item_type)}
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            inv.is_issued
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          }`}
                        >
                          {inv.is_issued ? '발행' : '대기'}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          });
        })()}
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
