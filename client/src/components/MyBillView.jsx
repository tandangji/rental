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
  const prevMonth = kst.getMonth() === 0 ? 12 : kst.getMonth();
  const prevYear = kst.getMonth() === 0 ? kst.getFullYear() - 1 : kst.getFullYear();
  const [year, setYear] = useState(prevYear);
  const [month, setMonth] = useState(prevMonth);
  const [bills, setBills] = useState([]);
  const [taxInvoices, setTaxInvoices] = useState([]);
  const [tenantInfo, setTenantInfo] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const pdfRef = useRef(null);

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

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API_BASE}/tenants`);
        if (res.ok) {
          const data = await res.json();
          setTenantInfo(data[0] || null);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const bill = bills[0];
  const fmt = (n) => (n || 0).toLocaleString();

  const totalWithVat = bill
    ? ITEMS.reduce((s, { amountField, noVat }) => s + withVat(bill[amountField], noVat), 0)
    : 0;

  // PDF용 항목 필터링 (0원 제외)
  const pdfItems = bill ? ITEMS.filter(({ amountField }) => bill[amountField] > 0).map(({ label, amountField, noVat, dynamic }) => {
    const amount = bill[amountField];
    const displayLabel = dynamic ? (bill.other_label || label) : label;
    const vatAmt = vat(amount, noVat);
    return { label: displayLabel + (noVat ? ' (면세)' : ''), supply: amount, tax: vatAmt, total: amount + vatAmt };
  }) : [];

  const totalSupply = pdfItems.reduce((s, i) => s + i.supply, 0);
  const totalTax = pdfItems.reduce((s, i) => s + i.tax, 0);
  const totalAmount = pdfItems.reduce((s, i) => s + i.total, 0);

  // 문서번호, 청구일, 납부기한
  const docNumber = bill ? `${String(year).slice(2)}${String(month).padStart(2, '0')}${String(bill.id).padStart(4, '0')}` : '';
  const billingDay = tenantInfo?.billing_day || 1;
  const billingDate = `${year}-${String(month).padStart(2, '0')}-${String(billingDay).padStart(2, '0')}`;
  const lastDay = new Date(year, month, 0).getDate();
  const dueDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const handleDownloadPDF = async () => {
    if (!bill || !pdfRef.current) return;
    setDownloading(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(pdfRef.current, {
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

  // 인라인 스타일 헬퍼 (html2canvas 호환)
  const s = {
    page: { width: 794, padding: 48, fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1a1a1a', fontSize: 13, lineHeight: 1.6, boxSizing: 'border-box', background: '#fff' },
    title: { fontSize: 28, fontWeight: 700, letterSpacing: 2, marginBottom: 0 },
    headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 },
    companyInfo: { textAlign: 'right', fontSize: 12, color: '#555', lineHeight: 1.8 },
    companyName: { fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 },
    divider: { borderTop: '2px solid #1a1a1a', margin: '0 0 24px 0' },
    thinDivider: { borderTop: '1px solid #ddd', margin: '0 0 24px 0' },
    infoGrid: { display: 'flex', justifyContent: 'space-between', marginBottom: 32 },
    infoLeft: { flex: 1 },
    infoRight: { flex: 1, textAlign: 'right' },
    infoRow: { display: 'flex', marginBottom: 6 },
    infoLabel: { width: 72, color: '#888', fontSize: 12 },
    infoValue: { fontSize: 13, fontWeight: 500 },
    bankLabel: { color: '#888', fontSize: 12, marginBottom: 2 },
    bankValue: { fontSize: 13, fontWeight: 500 },
    table: { width: '100%', borderCollapse: 'collapse', marginBottom: 24 },
    th: { background: '#f5f5f5', borderTop: '2px solid #1a1a1a', borderBottom: '1px solid #ddd', padding: '10px 12px', fontSize: 12, fontWeight: 600, textAlign: 'right' },
    thLeft: { background: '#f5f5f5', borderTop: '2px solid #1a1a1a', borderBottom: '1px solid #ddd', padding: '10px 12px', fontSize: 12, fontWeight: 600, textAlign: 'left' },
    td: { borderBottom: '1px solid #eee', padding: '10px 12px', fontSize: 13, textAlign: 'right' },
    tdLeft: { borderBottom: '1px solid #eee', padding: '10px 12px', fontSize: 13, textAlign: 'left' },
    totalSection: { textAlign: 'right', marginBottom: 32, paddingRight: 12 },
    totalRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 4 },
    totalLabel: { width: 100, textAlign: 'right', color: '#555', fontSize: 13, marginRight: 16 },
    totalValue: { width: 120, textAlign: 'right', fontSize: 13, fontWeight: 500 },
    grandTotalRow: { display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTop: '2px solid #1a1a1a' },
    grandTotalLabel: { width: 100, textAlign: 'right', fontSize: 15, fontWeight: 700, marginRight: 16 },
    grandTotalValue: { width: 120, textAlign: 'right', fontSize: 15, fontWeight: 700 },
    notes: { background: '#fafafa', borderRadius: 6, padding: '14px 18px', fontSize: 11, color: '#777', lineHeight: 1.8 },
    notesTitle: { fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 },
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
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
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
                            <FileText className="w-3 h-3" />계산서 발행완료
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

          {/* 숨겨진 PDF 템플릿 */}
          <div style={{ position: 'absolute', left: -9999, top: 0 }}>
            <div ref={pdfRef} style={s.page}>
              {/* 헤더 */}
              <div style={s.headerRow}>
                <div style={s.title}>청 구 서</div>
                <div style={s.companyInfo}>
                  <div style={s.companyName}>{settings?.tax_supplier_company || settings?.building_name || ''}</div>
                  <div>{settings?.tax_supplier_biz_no || settings?.landlord_business_number || ''}</div>
                  <div>{settings?.landlord_phone || ''}</div>
                  <div>{settings?.tax_supplier_email || ''}</div>
                  <div>{settings?.tax_supplier_address || ''}</div>
                </div>
              </div>

              <div style={s.divider} />

              {/* 고객 정보 + 입금 계좌 */}
              <div style={s.infoGrid}>
                <div style={s.infoLeft}>
                  <div style={s.infoRow}>
                    <span style={s.infoLabel}>고객명</span>
                    <span style={s.infoValue}>
                      {user.name}{tenantInfo?.representative ? ` (${tenantInfo.representative})` : ''}
                    </span>
                  </div>
                  <div style={s.infoRow}>
                    <span style={s.infoLabel}>문서번호</span>
                    <span style={s.infoValue}>{docNumber}</span>
                  </div>
                  <div style={s.infoRow}>
                    <span style={s.infoLabel}>청구일</span>
                    <span style={s.infoValue}>{billingDate}</span>
                  </div>
                  <div style={s.infoRow}>
                    <span style={s.infoLabel}>납부기한</span>
                    <span style={s.infoValue}>{dueDate}</span>
                  </div>
                </div>
                <div style={s.infoRight}>
                  <div style={s.bankLabel}>입금 계좌 정보</div>
                  <div style={s.bankValue}>{settings?.bank_name || ''}</div>
                  <div style={{ ...s.bankValue, fontSize: 15 }}>{settings?.bank_account || ''}</div>
                  <div style={s.bankValue}>예금주: {settings?.bank_holder || ''}</div>
                </div>
              </div>

              {/* 품목 테이블 */}
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.thLeft}>품목</th>
                    <th style={s.th}>공급가액</th>
                    <th style={s.th}>세액</th>
                    <th style={s.th}>합계</th>
                  </tr>
                </thead>
                <tbody>
                  {pdfItems.map((item, i) => (
                    <tr key={i}>
                      <td style={s.tdLeft}>{item.label}</td>
                      <td style={s.td}>{fmt(item.supply)}</td>
                      <td style={s.td}>{fmt(item.tax)}</td>
                      <td style={{ ...s.td, fontWeight: 600 }}>{fmt(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 합계 */}
              <div style={s.totalSection}>
                <div style={s.totalRow}>
                  <span style={s.totalLabel}>총 공급가액</span>
                  <span style={s.totalValue}>{fmt(totalSupply)}</span>
                </div>
                <div style={s.totalRow}>
                  <span style={s.totalLabel}>총 세액</span>
                  <span style={s.totalValue}>{fmt(totalTax)}</span>
                </div>
                <div style={s.grandTotalRow}>
                  <span style={s.grandTotalLabel}>총 합계</span>
                  <span style={s.grandTotalValue}>{fmt(totalAmount)}원</span>
                </div>
              </div>

              {/* 비고 */}
              <div style={s.notes}>
                <div style={s.notesTitle}>비고</div>
                <div>· 수도세는 면세 항목입니다.</div>
                <div>· 납부기한 경과 시 월 2%의 연체이자가 일수 계산으로 가산됩니다.</div>
                <div>· 전자세금계산서는 홈택스(hometax.go.kr)를 통해 조회하실 수 있습니다.</div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center mb-4">
          <p className="text-gray-400">이번 달 청구서가 아직 생성되지 않았습니다</p>
        </div>
      )}
    </div>
  );
}
