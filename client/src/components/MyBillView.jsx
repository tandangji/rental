import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BankInfo from './BankInfo';
import { Download } from 'lucide-react';

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
  const [downloading, setDownloading] = useState(false);
  const billRef = useRef(null);

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

      {bill ? (
        <>
          <div ref={billRef} className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
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

          {/* PDF 다운로드 버튼 */}
          <button
            onClick={handleDownloadPDF}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2 py-2.5 mb-3 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
          >
            <Download className="w-4 h-4" /> {downloading ? 'PDF 생성 중...' : '청구서 PDF 다운로드'}
          </button>

          {/* 유의사항 */}
          <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
            <p className="font-semibold mb-1">유의사항</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>청구서 보관이 필요한 경우 PDF 다운로드하여 직접 보관하시기 바랍니다.</li>
              <li>관리사무소에서는 별도의 청구서 사본을 제공하지 않습니다.</li>
              <li>납부기한 경과 시 월 2%의 연체이자가 일수 계산으로 가산됩니다.</li>
            </ul>
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
