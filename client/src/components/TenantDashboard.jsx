import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BankInfo from './BankInfo';
import { Camera, AlertCircle, Bell, Zap, Droplets, ChevronLeft, ChevronRight, FileText } from 'lucide-react';

const ITEMS = [
  { field: 'rent_paid', label: '임대료', amountField: 'rent_amount', itemType: 'rent' },
  { field: 'maintenance_paid', label: '관리비', amountField: 'maintenance_fee', itemType: 'maintenance' },
  { field: 'electricity_paid', label: '전기', amountField: 'electricity_amount', itemType: 'electricity' },
  { field: 'water_paid', label: '수도', amountField: 'water_amount', noVat: true, itemType: 'water' },
];

const vat = (n, noVat) => noVat ? 0 : Math.round((n || 0) * 0.1);
const withVat = (n, noVat) => (n || 0) + vat(n, noVat);

export default function TenantDashboard({ user, settings }) {
  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const kstDay = kst.getDate();
  const kstMonth = kst.getMonth() + 1;
  const prevM = kstMonth === 1 ? 12 : kstMonth - 1;
  const prevY = kstMonth === 1 ? kst.getFullYear() - 1 : kst.getFullYear();
  const [year, setYear] = useState(prevY);
  const [month, setMonth] = useState(prevM);
  const isCurrentMonth = year === kst.getFullYear() && month === kstMonth;
  const isElecPeriod = isCurrentMonth && kstDay === 22;
  const isWaterPeriod = isCurrentMonth && kstMonth % 2 === 1 && kstDay === 6;
  const [bill, setBill] = useState(null);
  const [readings, setReadings] = useState([]);
  const [taxInvoices, setTaxInvoices] = useState([]);

  const goMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y);
    setMonth(m);
  };

  useEffect(() => {
    (async () => {
      try {
        const [bRes, rRes, tRes] = await Promise.all([
          authFetch(`${API_BASE}/monthly-bills?year=${year}&month=${month}`),
          authFetch(`${API_BASE}/meter-readings?year=${year}&month=${month}`),
          authFetch(`${API_BASE}/tax-invoices?year=${year}&month=${month}`),
        ]);
        if (bRes.ok) { const data = await bRes.json(); setBill(data[0] || null); }
        if (rRes.ok) setReadings(await rRes.json());
        if (tRes.ok) setTaxInvoices(await tRes.json());
      } catch {}
    })();
  }, [year, month]);

  const fmt = (n) => (n || 0).toLocaleString();
  const uploadedTypes = new Set(readings.filter((r) => r.uploaded_at).map((r) => r.utility_type));
  // 검침 기간 중인 항목만 미업로드 경고 표시
  const missingTypes = [];
  if (isElecPeriod && !uploadedTypes.has('electricity')) missingTypes.push('electricity');
  if (isWaterPeriod && !uploadedTypes.has('water')) missingTypes.push('water');
  const missingPhotos = missingTypes.length;

  const totalWithVat = bill
    ? ITEMS.reduce((s, { amountField, noVat }) => s + withVat(bill[amountField], noVat), 0)
    : 0;

  return (
    <div>
      {/* 공지사항 */}
      {settings?.notice && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <Bell className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-blue-700 mb-1">공지사항</p>
            <p className="text-sm text-blue-800 whitespace-pre-wrap">{settings.notice}</p>
          </div>
        </div>
      )}

      {/* 검침일 알림 배너 */}
      {isElecPeriod && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <Zap className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-yellow-800 text-sm">오늘은 전기 검침일입니다!</p>
            <p className="text-xs text-yellow-700 mt-0.5">검침 탭에서 전기 계량기 사진을 업로드해주세요.</p>
          </div>
        </div>
      )}
      {isWaterPeriod && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <Droplets className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-blue-800 text-sm">오늘은 수도 검침일입니다!</p>
            <p className="text-xs text-blue-700 mt-0.5">검침 탭에서 수도 계량기 사진을 업로드해주세요.</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{user.name}</h2>
          <p className="text-sm text-gray-500">{(user.floors || []).join(',')}층</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => goMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[90px] text-center">{year}년 {month}월</span>
          <button onClick={() => goMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Photo upload status */}
      {missingPhotos > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <Camera className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-yellow-800 text-sm">계량기 사진을 업로드해주세요</p>
            <p className="text-xs text-yellow-700 mt-1">
              {missingTypes.map(t => t === 'electricity' ? '전기' : '수도').join(', ')} — {missingPhotos}건 미업로드
            </p>
          </div>
        </div>
      )}

      {/* Unpaid warning — 청구금액 위 */}
      {bill && ITEMS.some(({ field, amountField }) => bill[amountField] > 0 && !bill[field]) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700">미납 항목이 있습니다. 아래 계좌로 입금해주세요.</span>
        </div>
      )}

      {/* Current bill */}
      {bill ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="text-center mb-4">
            <p className="text-sm text-gray-500">{year}년 {month}월 청구 금액 <span className="text-xs text-gray-400">(부가세 포함, 수도 면세)</span></p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {fmt(totalWithVat)}원
            </p>
          </div>

          <div className="space-y-3">
            {ITEMS.map(({ field, label, amountField, noVat, itemType }) => {
              const amount = bill[amountField];
              if (amount === 0) return null;
              const isPaid = bill[field];
              const vatAmt = vat(amount, noVat);
              const total = amount + vatAmt;
              const taxInv = taxInvoices.find((t) => t.item_type === itemType);
              const isIssued = taxInv?.is_issued;
              return (
                <div key={field} className="border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{label}</span>
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
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center mb-4">
          <p className="text-gray-400">{year}년 {month}월 청구서가 아직 생성되지 않았습니다</p>
        </div>
      )}

      {/* Bank info */}
      <BankInfo settings={settings} />

      {/* 유의사항 */}
      <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
        <p className="text-xs font-semibold text-gray-700 mb-1">유의사항</p>
        <ul className="text-xs text-gray-600 space-y-0.5 list-disc list-inside">
          <li>임대료·관리비·전기는 부가세 10% 별도이며, 수도세는 면세입니다.</li>
          <li>임대료·관리비 세금계산서는 매월 20일에 발행됩니다. 공과금은 배분 확정 후 발행됩니다.</li>
          <li>전기는 매월 22일에 검침 사진을 업로드해주세요.</li>
          <li>수도는 홀수달(1,3,5,7,9,11월) 6일에 사진을 업로드해주세요.</li>
          <li>수도세는 2개월치가 일괄 부과됩니다.</li>
          <li>검침사진 미제출 시 전월 사용량의 1.5배로 임시 부과됩니다.</li>
          <li>납부기한 경과 시에는 월 2%의 연체이자가 일수 계산으로 가산됩니다.</li>
        </ul>
      </div>
    </div>
  );
}
