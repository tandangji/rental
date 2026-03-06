import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BankInfo from './BankInfo';
import { Download, FileText } from 'lucide-react';

const ITEMS = [
  { field: 'rent_paid', label: '임대료', amountField: 'rent_amount', dateField: 'rent_paid_date', itemType: 'rent' },
  { field: 'maintenance_paid', label: '관리비', amountField: 'maintenance_fee', dateField: 'maintenance_paid_date', itemType: 'maintenance' },
  { field: 'electricity_paid', label: '전기', amountField: 'electricity_amount', dateField: 'electricity_paid_date', itemType: 'electricity' },
  { field: 'water_paid', label: '수도', amountField: 'water_amount', dateField: 'water_paid_date', noVat: true, itemType: 'water' },
  { field: 'other_paid', label: '기타', amountField: 'other_amount', dateField: 'other_paid_date', dynamic: true, itemType: 'other' },
];

const vat = (n, noVat) => noVat ? 0 : Math.round((n || 0) * 0.1);
const withVat = (n, noVat) => (n || 0) + vat(n, noVat);

export default function MyBillView({ user, settings }) {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const prevMonth = kst.getMonth() === 0 ? 12 : kst.getMonth(); // 전월 (0-indexed이므로 getMonth()가 전월)
  const prevYear = kst.getMonth() === 0 ? kst.getFullYear() - 1 : kst.getFullYear();
  const [year, setYear] = useState(prevYear);
  const [month, setMonth] = useState(prevMonth);
  const [bills, setBills] = useState([]);
  const [taxInvoices, setTaxInvoices] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const billRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [bRes, tRes] = await Promise.all([
          authFetch(`${API_BASE}/monthly-bills?year=${year}&month=${month}`),
          authFetch(`${API_BASE}/tax-invoices?year=${year}&month=${month}`),
        ]);
        if (bRes.ok) setBills(await bRes.json()); else setBills([]);
        if (tRes.ok) setTaxInvoices(await tRes.json()); else setTaxInvoices([]);
      } catch { setBills([]); setTaxInvoices([]); }
    })();
  }, [year, month]);

  const bill = bills[0];
  const fmt = (n) => (n || 0).toLocaleString();

  const totalWithVat = bill
    ? ITEMS.reduce((s, { amountField, noVat }) => s + withVat(bill[amountField], noVat), 0)
    : 0;

  const handleDownloadPDF = async () => {
    if (!bill || !billRef.current) return;
    setDownloading(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(billRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
      });
      const imgData = canvas.toDataURL('image/png');
      const imgW = canvas.width;
      const imgH = canvas.height;
      const pdfW = 210;
      const pdfH = (imgH * pdfW) / imgW;
      const pdf = new jsPDF('p', 'mm', [pdfW, Math.max(pdfH + 20, 297)]);
      pdf.addImage(imgData, 'PNG', 0, 10, pdfW, pdfH);
      pdf.save(`청구서_${year}년${month}월_${user.name}.pdf`);
    } catch (err) {
      console.error('PDF 생성 실패:', err);
    } finally {
      setDownloading(false);
    }
  };

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

      {/* 유의사항 — 상단 고정 */}
      <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
        <p className="font-semibold mb-1">유의사항</p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>청구서 보관이 필요한 경우 PDF 다운로드하여 직접 보관하시기 바랍니다.</li>
          <li>관리사무소에서는 별도의 청구서 사본을 제공하지 않습니다.</li>
          <li>납부기한 경과 시 월 2%의 연체이자가 일수 계산으로 가산됩니다.</li>
          <li>임대료·관리비 세금계산서는 매월 20일에 발행됩니다. 공과금은 배분 확정 후 발행됩니다.</li>
          <li>전자세금계산서는 홈택스를 통해 직접 조회하실 수 있습니다.</li>
        </ul>
      </div>

      {bill ? (
        <>
          <div ref={billRef} className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
            <div className="text-center mb-4">
              <p className="text-sm text-gray-500">{year}년 {month}월 <span className="text-xs text-gray-400">(부가세 포함, 수도 면세)</span></p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {fmt(totalWithVat)}원
              </p>
            </div>

            <div className="space-y-3">
              {ITEMS.map(({ field, label, amountField, dateField, noVat, dynamic, itemType }) => {
                const amount = bill[amountField];
                if (amount === 0) return null;
                const displayLabel = dynamic ? (bill.other_label || label) : label;
                const isPaid = bill[field];
                const vatAmt = vat(amount, noVat);
                const total = amount + vatAmt;
                const taxInv = taxInvoices.find((t) => t.item_type === itemType);
                const isIssued = taxInv?.is_issued;
                return (
                  <div key={field} className="border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900">{displayLabel}</span>
                      <div className="flex items-center gap-1.5">
                        {isIssued && (
                          <span className="flex items-center gap-0.5 px-2 py-0.5 text-[11px] font-medium rounded-full bg-blue-100 text-blue-700">
                            <FileText className="w-3 h-3" />발행
                          </span>
                        )}
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                          isPaid
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {isPaid ? '납부완료' : '납부대기'}
                        </span>
                        {isPaid && bill[dateField] && (
                          <span className="text-[11px] text-gray-400">{new Date(bill[dateField]).toLocaleDateString('ko-KR')}</span>
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

          {/* PDF 다운로드 버튼 */}
          <button
            onClick={handleDownloadPDF}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2 py-2.5 mb-3 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
          >
            <Download className="w-4 h-4" /> {downloading ? 'PDF 생성 중...' : '청구서 PDF 다운로드'}
          </button>

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
