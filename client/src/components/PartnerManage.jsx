import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp, Phone, Building2, Banknote, Check, Clock } from 'lucide-react';
import PartnerForm from './PartnerForm';

const TYPE_LABELS = { employee: '직원', vendor: '외주업체' };
const FILTER_TABS = [
  { id: 'all', label: '전체' },
  { id: 'employee', label: '직원' },
  { id: 'vendor', label: '외주업체' },
];

export default function PartnerManage() {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [payments, setPayments] = useState({});
  const [paymentForm, setPaymentForm] = useState(null);

  const fmt = (n) => (n || 0).toLocaleString();

  const loadPartners = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/partners`);
      if (res.ok) setPartners(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPartners(); }, [loadPartners]);

  const loadPayments = async (partnerId) => {
    try {
      const res = await authFetch(`${API_BASE}/partner-payments?partner_id=${partnerId}`);
      if (res.ok) {
        const data = await res.json();
        setPayments((prev) => ({ ...prev, [partnerId]: data }));
      }
    } catch {}
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`"${name}"을(를) 삭제하시겠습니까?\n지급 내역도 모두 삭제됩니다.`)) return;
    try {
      await authFetch(`${API_BASE}/partners/${id}`, { method: 'DELETE' });
      loadPartners();
    } catch {}
  };

  const handleSaved = () => {
    setShowForm(false);
    setEditTarget(null);
    loadPartners();
  };

  const toggleExpand = (id) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!payments[id]) loadPayments(id);
    }
  };

  const handlePayToggle = async (paymentId, partnerId) => {
    try {
      await authFetch(`${API_BASE}/partner-payments/${paymentId}/pay`, { method: 'PATCH' });
      loadPayments(partnerId);
    } catch {}
  };

  const handlePayDelete = async (paymentId, partnerId) => {
    if (!confirm('지급 내역을 삭제하시겠습니까?')) return;
    try {
      await authFetch(`${API_BASE}/partner-payments/${paymentId}`, { method: 'DELETE' });
      loadPayments(partnerId);
    } catch {}
  };

  const handlePaySubmit = async (partnerId) => {
    if (!paymentForm) return;
    try {
      await authFetch(`${API_BASE}/partner-payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: partnerId,
          year: paymentForm.year,
          month: paymentForm.month,
          amount: Number(paymentForm.amount) || 0,
          memo: paymentForm.memo || '',
          is_paid: false,
        }),
      });
      setPaymentForm(null);
      loadPayments(partnerId);
    } catch {}
  };

  const filtered = filter === 'all' ? partners : partners.filter((p) => p.type === filter);

  if (loading) return <div className="text-center py-8 text-gray-400">로딩 중...</div>;

  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const nowYear = kst.getFullYear();
  const nowMonth = kst.getMonth() + 1;

  return (
    <div>
      {/* 필터 + 등록 버튼 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === tab.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true); }}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 min-h-[44px]"
        >
          <Plus className="w-4 h-4" /> 등록
        </button>
      </div>

      {/* 목록 */}
      {filtered.length === 0 ? (
        <p className="text-center py-8 text-gray-400">등록된 협력사가 없습니다</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => {
            const isExpanded = expandedId === p.id;
            const partnerPayments = payments[p.id] || [];
            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4">
                  {/* 상단: 이름, 유형, 활성 */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{p.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        p.type === 'employee' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {TYPE_LABELS[p.type]}
                      </span>
                      {!p.is_active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">비활성</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setEditTarget(p); setShowForm(true); }} className="p-1.5 text-gray-400 hover:text-blue-600">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(p.id, p.name)} className="p-1.5 text-gray-400 hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 정보 */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    {p.contact_phone && (
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.contact_phone}</span>
                    )}
                    {p.company_name && (
                      <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{p.company_name}</span>
                    )}
                    {p.bank_name && p.bank_account && (
                      <span className="flex items-center gap-1"><Banknote className="w-3 h-3" />{p.bank_name} {p.bank_account} ({p.bank_holder || '-'})</span>
                    )}
                  </div>

                  {/* 지급내역 토글 */}
                  <button
                    onClick={() => toggleExpand(p.id)}
                    className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    지급내역
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* 지급내역 펼침 */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                    {partnerPayments.length === 0 && !paymentForm ? (
                      <p className="text-xs text-gray-400 text-center py-2">지급 내역이 없습니다</p>
                    ) : (
                      <div className="space-y-2">
                        {partnerPayments.map((pay) => (
                          <div key={pay.id} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-700 font-medium">{pay.year}년 {pay.month}월</span>
                              <span className="text-gray-900 font-semibold">{fmt(pay.amount)}원</span>
                              {pay.memo && <span className="text-gray-400">"{pay.memo}"</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {pay.is_paid ? (
                                <span className="flex items-center gap-0.5 text-green-600">
                                  <Check className="w-3 h-3" /> 완료
                                  {pay.payment_date && <span className="text-gray-400 ml-1">{pay.payment_date.slice(0, 10)}</span>}
                                </span>
                              ) : (
                                <span className="flex items-center gap-0.5 text-amber-600">
                                  <Clock className="w-3 h-3" /> 미지급
                                </span>
                              )}
                              <button onClick={() => handlePayToggle(pay.id, p.id)} className="px-1.5 py-0.5 text-[10px] border border-gray-200 rounded hover:bg-gray-100">
                                {pay.is_paid ? '취소' : '지급'}
                              </button>
                              <button onClick={() => handlePayDelete(pay.id, p.id)} className="px-1.5 py-0.5 text-[10px] text-red-500 border border-red-200 rounded hover:bg-red-50">
                                삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 지급 추가 폼 */}
                    {paymentForm && paymentForm.partnerId === p.id ? (
                      <div className="mt-2 flex flex-wrap items-end gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200">
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">연도</label>
                          <input type="number" value={paymentForm.year} onChange={(e) => setPaymentForm({ ...paymentForm, year: e.target.value })} className="w-16 px-2 py-1 text-xs border border-gray-300 rounded" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">월</label>
                          <input type="number" min="1" max="12" value={paymentForm.month} onChange={(e) => setPaymentForm({ ...paymentForm, month: e.target.value })} className="w-12 px-2 py-1 text-xs border border-gray-300 rounded" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">금액</label>
                          <input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="w-28 px-2 py-1 text-xs border border-gray-300 rounded" placeholder="0" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-0.5">메모</label>
                          <input type="text" value={paymentForm.memo} onChange={(e) => setPaymentForm({ ...paymentForm, memo: e.target.value })} className="w-24 px-2 py-1 text-xs border border-gray-300 rounded" placeholder="인건비" />
                        </div>
                        <button onClick={() => handlePaySubmit(p.id)} className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">추가</button>
                        <button onClick={() => setPaymentForm(null)} className="px-3 py-1 text-xs text-gray-500 border border-gray-300 rounded hover:bg-gray-100">취소</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPaymentForm({ partnerId: p.id, year: nowYear, month: nowMonth, amount: '', memo: '' })}
                        className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                      >
                        <Plus className="w-3 h-3" /> 지급 추가
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <PartnerForm
          partner={editTarget}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
