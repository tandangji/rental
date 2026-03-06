import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { Download, Clock, CheckCircle, Trash2 } from 'lucide-react';

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

  // ─── XLSX Download (홈택스 전자세금계산서 일괄등록양식) ────────
  const downloadXLSX = async () => {
    if (pending.length === 0) return;
    const XLSX = (await import('xlsx')).default || (await import('xlsx'));

    const lastDay = new Date(year, month, 0).getDate();
    const dateStr = `${year}${String(month).padStart(2, '0')}${String(lastDay).padStart(2, '0')}`;
    const dayStr = String(lastDay).padStart(2, '0');

    const s = settings;
    const supplier = {
      bizNo: (s.tax_supplier_biz_no || '').replace(/-/g, ''),
      company: s.tax_supplier_company || '',
      name: s.tax_supplier_name || '',
      address: s.tax_supplier_address || '',
      bizType: s.tax_supplier_business_type || '',
      bizItem: s.tax_supplier_business_item || '',
      email: s.tax_supplier_email || '',
    };

    const taxableItems = pending.filter((i) => i.item_type !== 'water');
    const grouped = {};
    taxableItems.forEach((inv) => {
      const key = inv.tenant_id;
      if (!grouped[key]) grouped[key] = { ...inv, items: [] };
      grouped[key].items.push(inv);
    });

    const headerRows = [
      ['엑셀 업로드 양식(전자세금계산서-일반(영세율)) - 100건 이하', ...Array(58).fill('')],
      ['○ 필수항목(주황색)은 반드시 입력하셔야 합니다.', ...Array(58).fill('')],
      ['○ 임의로 양식을 변경하는 경우 발급시 오류가 발생할 수 있으므로, 정해진 양식으로 작성하시기 바랍니다.', ...Array(58).fill('')],
      ['○ 품목은 1건 이상 입력해야 합니다.', ...Array(58).fill('')],
      ['○ 발급가능한 파일 확장자는 XLS, XLSX 입니다.', ...Array(58).fill('')],
    ];
    const colHeaders = [
      '전자(세금)계산서 종류\r\n(01:일반, 02:영세율)', '작성일자',
      '공급자 등록번호\r\n("-" 없이 입력)', '공급자\r\n 종사업장번호', '공급자 상호', '공급자 성명', '공급자 사업장주소', '공급자 업태', '공급자 종목', '공급자 이메일',
      '공급받는자 등록번호\r\n("-" 없이 입력)', '공급받는자 \r\n종사업장번호', '공급받는자 상호', '공급받는자 성명', '공급받는자 사업장주소', '공급받는자 업태', '공급받는자 종목', '공급받는자 이메일1', '공급받는자 이메일2',
      '공급가액\r\n합계', '세액\r\n합계', '비고',
      '일자1\r\n(2자리, 작성년월 제외)', '품목1', '규격1', '수량1', '단가1', '공급가액1', '세액1', '품목비고1',
      '일자2\r\n(2자리, 작성년월 제외)', '품목2', '규격2', '수량2', '단가2', '공급가액2', '세액2', '품목비고2',
      '일자3\r\n(2자리, 작성년월 제외)', '품목3', '규격3', '수량3', '단가3', '공급가액3', '세액3', '품목비고3',
      '일자4\r\n(2자리, 작성년월 제외)', '품목4', '규격4', '수량4', '단가4', '공급가액4', '세액4', '품목비고4',
      '현금', '수표', '어음', '외상미수금', '영수(01),\r\n청구(02)',
    ];

    const dataRows = Object.values(grouped).map((g) => {
      const buyerBizNo = (g.business_number || '').replace(/-/g, '');
      const buyerCompany = g.tax_company_name || g.company_name;
      const buyerName = g.tax_representative || g.representative;
      const buyerAddr = g.tax_address || g.address;
      const buyerBizType = g.tax_business_type || g.business_type || '';
      const buyerBizItem = g.tax_business_item || g.business_item || '';
      const buyerEmail1 = g.tax_email || g.email || '';
      const buyerEmail2 = g.tax_email2 || '';

      const totalSupply = g.items.reduce((s, i) => s + i.supply_amount, 0);
      const totalTax = g.items.reduce((s, i) => s + i.tax_amount, 0);

      const itemSlots = [];
      for (let i = 0; i < 4; i++) {
        const item = g.items[i];
        if (item) {
          itemSlots.push(dayStr, `${month}월 ${item.item_name}`, '', '', '', item.supply_amount, item.tax_amount, '');
        } else {
          itemSlots.push('', '', '', '', '', '', '', '');
        }
      }

      return [
        '01', dateStr,
        supplier.bizNo, '', supplier.company, supplier.name, supplier.address, supplier.bizType, supplier.bizItem, supplier.email,
        buyerBizNo, '', buyerCompany, buyerName, buyerAddr, buyerBizType, buyerBizItem, buyerEmail1, buyerEmail2,
        totalSupply, totalTax, '',
        ...itemSlots,
        '', '', '', '', '02',
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([...headerRows, colHeaders, ...dataRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '엑셀업로드양식');
    XLSX.writeFile(wb, `세금계산서_${year}년${month}월.xlsx`);
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

      {/* 안내 */}
      <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-xs">
        임대료·관리비 세금계산서는 <b>매월 20일</b>에 발행합니다. 공과금은 배분 확정 후 발행합니다.
      </div>

      {/* Action buttons */}
      {tab === 'pending' && pending.length > 0 && (
        <div className="mb-4">
          <button
            onClick={downloadXLSX}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 min-h-[44px]"
          >
            <Download className="w-4 h-4" /> 홈택스 양식 다운로드
          </button>
        </div>
      )}

      {/* Summary */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-3 gap-1 text-center">
            <div>
              <p className="text-xs text-gray-500">공급가액</p>
              <p className="font-bold text-[11px]">{fmt(filtered.reduce((s, i) => s + i.supply_amount, 0))}원</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">세액</p>
              <p className="font-bold text-[11px]">{fmt(filtered.reduce((s, i) => s + i.tax_amount, 0))}원</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">합계</p>
              <p className="font-bold text-[11px]">{fmt(filtered.reduce((s, i) => s + i.total_amount, 0))}원</p>
            </div>
          </div>
        </div>
      )}

      {/* Invoice list — 입주사별 그룹 + 항목 테이블 */}
      <div className="space-y-3">
        {(() => {
          const grouped = {};
          filtered.forEach((inv) => {
            const key = `${inv.tenant_id}`;
            if (!grouped[key]) grouped[key] = { floors: inv.floors, company_name: inv.company_name, business_number: inv.business_number, items: [] };
            grouped[key].items.push(inv);
          });
          return Object.values(grouped).map((group) => {
            const totalAmount = group.items.reduce((s, i) => s + i.total_amount, 0);
            const issuedCount = group.items.filter((i) => i.is_issued).length;
            const allIssued = issuedCount === group.items.length;

            return (
              <div key={`${(group.floors||[]).join(',')}-${group.company_name}`} className={`bg-white rounded-xl border-2 p-4 ${allIssued ? 'border-green-200' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                      {(group.floors || []).join(',')}F
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

                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  {group.items.map((inv) => (
                    <div key={`${inv.bill_id}-${inv.item_type}`} className="flex items-center justify-between px-3 py-2.5 border-t border-gray-50 first:border-t-0">
                      <span className="text-sm text-gray-900 min-w-[40px]">{inv.item_name}</span>
                      <div className="flex-1 text-right mr-2">
                        <span className={`text-sm font-medium ${inv.is_issued ? 'text-green-600' : 'text-gray-900'}`}>{fmt(inv.total_amount)}원</span>
                        <p className="text-[11px] text-gray-400">공급 {fmt(inv.supply_amount)} / 세액 {fmt(inv.tax_amount)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggleIssue(inv.bill_id, inv.item_type)}
                          className={`px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${
                            inv.is_issued
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          }`}
                        >
                          {inv.is_issued ? '발행' : '대기'}
                        </button>
                        {!inv.is_issued && (
                          <button
                            onClick={() => alert('세금계산서는 청구서에서 파생됩니다.\n청구서 탭에서 해당 항목의 금액을 0으로 수정하거나 청구건을 삭제하면 자동 반영됩니다.')}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
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
            ? '청구서 데이터가 없습니다. 청구서 탭에서 먼저 청구서를 생성해주세요.'
            : tab === 'pending' ? '발행대기 건이 없습니다.' : '발행완료 건이 없습니다.'}
        </p>
      )}
    </div>
  );
}
