import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { ChevronLeft, ChevronRight, Check, Clock, Plus, Trash2, Calendar } from 'lucide-react';

const TYPE_LABELS = { employee: '직원', vendor: '외주업체' };

export default function PaymentManage() {
  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const [year, setYear] = useState(kst.getFullYear());
  const [month, setMonth] = useState(kst.getMonth() + 1);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState(null); // { partnerId, amount, memo }

  const fmt = (n) => (n || 0).toLocaleString();

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/partner-payments/schedule?year=${year}&month=${month}`);
      if (res.ok) setSchedule(await res.json());
    } catch {} finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  const goMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y);
    setMonth(m);
  };

  const handlePayToggle = async (paymentId) => {
    try {
      await authFetch(`${API_BASE}/partner-payments/${paymentId}/pay`, { method: 'PATCH' });
      loadSchedule();
    } catch {}
  };

  const handlePayDelete = async (paymentId) => {
    if (!confirm('지급 내역을 삭제하시겠습니까?')) return;
    try {
      await authFetch(`${API_BASE}/partner-payments/${paymentId}`, { method: 'DELETE' });
      loadSchedule();
    } catch {}
  };

  const handleAddSubmit = async (partnerId) => {
    if (!addForm || !addForm.amount) return;
    try {
      await authFetch(`${API_BASE}/partner-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: partnerId,
          year,
          month,
          amount: Number(addForm.amount) || 0,
          memo: addForm.memo || '',
          is_paid: false,
        }),
      });
      setAddForm(null);
      loadSchedule();
    } catch {}
  };

  // 요약 계산
  const withPayment = schedule.filter((s) => s.payment_id);
  const totalAmount = withPayment.reduce((sum, s) => sum + (s.amount || 0), 0);
  const paidAmount = withPayment.filter((s) => s.is_paid).reduce((sum, s) => sum + (s.amount || 0), 0);
  const unpaidAmount = totalAmount - paidAmount;
  const paidCount = withPayment.filter((s) => s.is_paid).length;
  const unpaidCount = withPayment.filter((s) => !s.is_paid).length;

  if (loading) return <div className="text-center py-8 text-gray-400">로딩 중...</div>;

  return (
    <div>
      {/* 월 선택기 */}
      <div className="flex items-center justify-center gap-2 mb-4">
        <button onClick={() => goMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-gray-700 min-w-[90px] text-center">{year}년 {month}월</span>
        <button onClick={() => goMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">총 지급 예정</p>
          <p className="text-sm font-bold text-gray-900">{fmt(totalAmount)}원</p>
          <p className="text-[10px] text-gray-400">{withPayment.length}건</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-3 text-center">
          <p className="text-[10px] text-gray-500">완료</p>
          <p className="text-sm font-bold text-green-700">{fmt(paidAmount)}원</p>
          <p className="text-[10px] text-gray-400">{paidCount}건</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${unpaidCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
          <p className="text-[10px] text-gray-500">미지급</p>
          <p className={`text-sm font-bold ${unpaidCount > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{fmt(unpaidAmount)}원</p>
          <p className="text-[10px] text-gray-400">{unpaidCount}건</p>
        </div>
      </div>

      {/* 파트너별 카드 */}
      {schedule.length === 0 ? (
        <p className="text-center py-8 text-gray-400">등록된 활성 협력사가 없습니다</p>
      ) : (
        <div className="space-y-3">
          {schedule.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-4">
              {/* 헤더 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {s.payment_day ? (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                      <Calendar className="w-3 h-3" />
                      매월 {s.payment_day}일
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">납기일 미정</span>
                  )}
                  <span className="font-semibold text-gray-900 text-sm">{s.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    s.type === 'employee' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                    {TYPE_LABELS[s.type]}
                  </span>
                </div>
              </div>

              {/* 지급 정보 */}
              {s.payment_id ? (
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-900">{fmt(s.amount)}원</span>
                    {s.memo && <span className="text-xs text-gray-400">"{s.memo}"</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {s.is_paid ? (
                      <span className="flex items-center gap-0.5 text-xs text-green-600">
                        <Check className="w-3 h-3" /> 완료
                        {s.payment_date && <span className="text-gray-400 ml-1">{s.payment_date.slice(0, 10)}</span>}
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-xs text-amber-600">
                        <Clock className="w-3 h-3" /> 미지급
                      </span>
                    )}
                    <button onClick={() => handlePayToggle(s.payment_id)} className="px-2 py-1 text-[10px] border border-gray-200 rounded hover:bg-gray-100">
                      {s.is_paid ? '취소' : '지급'}
                    </button>
                    <button onClick={() => handlePayDelete(s.payment_id)} className="px-2 py-1 text-[10px] text-red-500 border border-red-200 rounded hover:bg-red-50">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : addForm && addForm.partnerId === s.id ? (
                <div className="flex flex-wrap items-end gap-2 bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">금액</label>
                    <input type="number" value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} className="w-28 px-2 py-1 text-xs border border-gray-300 rounded" placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">메모</label>
                    <input type="text" value={addForm.memo} onChange={(e) => setAddForm({ ...addForm, memo: e.target.value })} className="w-24 px-2 py-1 text-xs border border-gray-300 rounded" />
                  </div>
                  <button onClick={() => handleAddSubmit(s.id)} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">추가</button>
                  <button onClick={() => setAddForm(null)} className="px-3 py-1 text-xs text-gray-500 border border-gray-300 rounded hover:bg-gray-100">취소</button>
                </div>
              ) : (
                <button
                  onClick={() => setAddForm({ partnerId: s.id, amount: '', memo: '' })}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                >
                  <Plus className="w-3 h-3" /> 지급 추가
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
