import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import BuildingBillForm from './BuildingBillForm';
import { MessageSquare, Plus, Pencil, Upload, Download, Trash2, Check, X } from 'lucide-react';

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
  const [editingOther, setEditingOther] = useState(null);
  const [otherLabel, setOtherLabel] = useState('');
  const [otherAmount, setOtherAmount] = useState('');
  const [compareData, setCompareData] = useState(null);
  const [applying, setApplying] = useState(false);
  const [editingBill, setEditingBill] = useState(null); // billId for inline edit
  const [editForm, setEditForm] = useState({});

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

  // ─── 인라인 금액 편집 ─────────────────
  const startEditBill = (bill) => {
    setEditingBill(bill.id);
    setEditForm({
      rent_amount: bill.rent_amount || 0,
      maintenance_fee: bill.maintenance_fee || 0,
      electricity_amount: bill.electricity_amount || 0,
      water_amount: bill.water_amount || 0,
      other_amount: bill.other_amount || 0,
      other_label: bill.other_label || '',
    });
  };

  const handleSaveBill = async (billId) => {
    try {
      const res = await authFetch(`${API_BASE}/monthly-bills/${billId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditingBill(null);
        loadBills();
      }
    } catch {}
  };

  // ─── 청구건 삭제 ─────────────────
  const handleDeleteBill = async (billId) => {
    if (!confirm('이 청구건을 삭제하시겠습니까?')) return;
    try {
      const res = await authFetch(`${API_BASE}/monthly-bills/${billId}`, { method: 'DELETE' });
      if (res.ok) loadBills();
    } catch {}
  };

  const HEADER_MAP = { '층': 'floor', '업체명': 'company_name', '임대료': 'rent_amount', '관리비': 'maintenance_fee', '전기': 'electricity_amount', '수도': 'water_amount', '기타명': 'other_label', '기타': 'other_amount' };
  const COMPARE_FIELDS = [
    { key: 'rent_amount', label: '임대료' },
    { key: 'maintenance_fee', label: '관리비' },
    { key: 'electricity_amount', label: '전기' },
    { key: 'water_amount', label: '수도' },
    { key: 'other_amount', label: '기타' },
  ];

  const handleDownloadTemplate = async () => {
    const XLSX = (await import('xlsx')).default || (await import('xlsx'));
    const data = bills.map((b) => ({
      '층': (b.floors || []).join(','),
      '업체명': b.company_name,
      '임대료': b.rent_amount || 0,
      '관리비': b.maintenance_fee || 0,
      '전기': b.electricity_amount || 0,
      '수도': b.water_amount || 0,
      '기타명': b.other_label || '',
      '기타': b.other_amount || 0,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '청구서');
    XLSX.writeFile(wb, `청구서_${year}년${month}월.xlsx`);
  };

  const handleUploadExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const XLSX = (await import('xlsx')).default || (await import('xlsx'));
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet);

    const uploaded = raw.map((row) => {
      const mapped = {};
      for (const [k, v] of Object.entries(row)) {
        const field = HEADER_MAP[k.trim()];
        if (field) mapped[field] = field === 'other_label' || field === 'company_name' ? String(v || '') : Number(v) || 0;
      }
      if (mapped.other_amount > 0 && !mapped.other_label) mapped.other_label = '기타';
      return mapped;
    }).filter((r) => r.floor != null);

    const rows = [];
    let matchCount = 0, diffCount = 0, newCount = 0, unmatchedFloors = [];
    for (const u of uploaded) {
      // floor → tenant의 bill 찾기 (다중층: floors 배열에 포함된 bill)
      const bill = bills.find((b) => (b.floors || []).includes(u.floor));
      if (!bill) { unmatchedFloors.push(u.floor); continue; }
      for (const { key, label } of COMPARE_FIELDS) {
        const existing = bill[key] || 0;
        const upload = u[key] || 0;
        let status = 'match';
        if (existing === 0 && upload > 0) { status = 'new'; newCount++; }
        else if (existing !== upload) { status = 'diff'; diffCount++; }
        else { matchCount++; }
        rows.push({ floor: u.floor, label: key === 'other_amount' ? (u.other_label || bill.other_label || '기타') : label, key, existing, upload, status });
      }
    }
    setCompareData({ rows, uploaded, matchCount, diffCount, newCount, unmatchedFloors });
  };

  const handleApplyAll = async () => {
    if (!compareData) return;
    const hasDiff = compareData.rows.some((r) => r.status !== 'match');
    if (!hasDiff) { setMessage('모든 항목이 일치합니다'); setCompareData(null); setTimeout(() => setMessage(''), 3000); return; }
    setApplying(true);
    try {
      const res = await authFetch(`${API_BASE}/monthly-bills/bulk-update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, updates: compareData.uploaded }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`${data.updated}건 반영 완료${data.errors?.length ? ` (오류: ${data.errors.join(', ')})` : ''}`);
        setCompareData(null);
        loadBills();
      } else {
        setMessage(data.error);
      }
    } catch {
      setMessage('반영 실패');
    } finally {
      setApplying(false);
      setTimeout(() => setMessage(''), 5000);
    }
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

      {/* 청구서 발행 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleGenerateRent}
          disabled={generatingRent}
          className="flex items-center justify-center gap-1 px-3 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
        >
          <Plus className="w-4 h-4" /> {generatingRent ? '발행 중...' : '자동 청구'}
        </button>
        <label className="flex items-center gap-1 px-3 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 cursor-pointer min-h-[44px]">
          <Upload className="w-4 h-4" /> 수동 청구
          <input type="file" accept=".xlsx,.xls" onChange={handleUploadExcel} className="hidden" />
        </label>
        {bills.length > 0 && (
          <>
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1 px-3 py-2.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 min-h-[44px]"
            >
              <Download className="w-3.5 h-3.5" /> 양식
            </button>
            <button
              onClick={handleSendReminder}
              className="flex items-center gap-1 px-3 py-2.5 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 min-h-[44px]"
            >
              <MessageSquare className="w-4 h-4" /> 미납
            </button>
          </>
        )}
      </div>

      {/* 공과금 입력 + 배분 */}
      <div className="mb-4">
        <BuildingBillForm year={year} month={month} onSaved={loadBills} onDistribute={handleGenerate} distributing={generating} />
      </div>

      {/* 대조 결과 */}
      {compareData && (
        <div className="mb-4 bg-white rounded-xl border-2 border-blue-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-gray-900">파일 대조 결과</h3>
            <div className="flex gap-2">
              <button
                onClick={handleApplyAll}
                disabled={applying || !compareData.rows.some((r) => r.status !== 'match')}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {applying ? '반영 중...' : '전체 반영'}
              </button>
              <button
                onClick={() => setCompareData(null)}
                className="px-3 py-1.5 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                취소
              </button>
            </div>
          </div>
          {compareData.unmatchedFloors.length > 0 && (
            <div className="mb-2 p-2 bg-red-50 text-red-700 text-xs rounded">
              매칭 안 됨: {compareData.unmatchedFloors.map((f) => `${f}층`).join(', ')}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="text-left py-1.5 px-2">층</th>
                  <th className="text-left py-1.5 px-2">항목</th>
                  <th className="text-right py-1.5 px-2">기존값</th>
                  <th className="text-right py-1.5 px-2">업로드값</th>
                  <th className="text-center py-1.5 px-2">상태</th>
                </tr>
              </thead>
              <tbody>
                {compareData.rows.map((r, i) => (
                  <tr
                    key={i}
                    className={
                      r.status === 'diff' ? 'bg-amber-50' :
                      r.status === 'new' ? 'bg-blue-50' : ''
                    }
                  >
                    <td className="py-1.5 px-2 font-medium">{r.floor || ''}F</td>
                    <td className="py-1.5 px-2">{r.label}</td>
                    <td className={`py-1.5 px-2 text-right ${r.status === 'match' ? 'text-gray-400' : ''}`}>{fmt(r.existing)}</td>
                    <td className={`py-1.5 px-2 text-right ${r.status === 'match' ? 'text-gray-400' : 'font-medium'}`}>{fmt(r.upload)}</td>
                    <td className="py-1.5 px-2 text-center">
                      {r.status === 'match' && <span className="text-gray-400">일치</span>}
                      {r.status === 'diff' && <span className="text-amber-600 font-medium">차이</span>}
                      {r.status === 'new' && <span className="text-blue-600 font-medium">신규 +</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            차이 {compareData.diffCount}건 / 신규 {compareData.newCount}건 / 일치 {compareData.matchCount}건
          </p>
        </div>
      )}

      {message && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">{message}</div>
      )}

      {smsResult && (
        <div className="mb-4 p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">
          {smsResult.message}
          {smsResult.targets?.length > 0 && (
            <ul className="mt-1 text-xs">
              {smsResult.targets.map((t, i) => (
                <li key={i}>{t.floors || t.floor}층 {t.company} — 미납: {t.unpaid.join(', ')}</li>
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
          const isEditing = editingBill === bill.id;

          return (
            <div key={bill.id} className={`bg-white rounded-xl border-2 p-4 ${allPaid ? 'border-green-200' : 'border-gray-200'}`}>
              {/* Header: 업체명 + 수정/삭제 + 상태 + 합계 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                    {(bill.floors || []).join(',')}F
                  </span>
                  <span className="font-semibold text-gray-900 text-sm">{bill.company_name}</span>
                  {!isEditing && (
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => startEditBill(bill)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="금액 수정">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteBill(bill.id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="삭제">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
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

              {/* 인라인 편집 모드 */}
              {isEditing && (
                <div className="mb-3 border border-blue-200 rounded-lg p-3 bg-blue-50/30 space-y-2">
                  {[
                    { key: 'rent_amount', label: '임대료' },
                    { key: 'maintenance_fee', label: '관리비' },
                    { key: 'electricity_amount', label: '전기' },
                    { key: 'water_amount', label: '수도' },
                    { key: 'other_amount', label: '기타 금액' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 w-16">{label}</span>
                      <input
                        type="number"
                        value={editForm[key] || ''}
                        onChange={(e) => setEditForm({ ...editForm, [key]: Number(e.target.value) || 0 })}
                        className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
                      />
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 w-16">기타명</span>
                    <input
                      type="text"
                      value={editForm.other_label || ''}
                      onChange={(e) => setEditForm({ ...editForm, other_label: e.target.value })}
                      placeholder="예: 재활용비"
                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div className="flex gap-2 justify-end pt-1">
                    <button onClick={() => setEditingBill(null)} className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">
                      <X className="w-3.5 h-3.5" /> 취소
                    </button>
                    <button onClick={() => handleSaveBill(bill.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                      <Check className="w-3.5 h-3.5" /> 저장
                    </button>
                  </div>
                </div>
              )}

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
                        {isPaid ? '입금완료' : '대기'}
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
                      {bill.other_paid ? '입금완료' : '대기'}
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
