import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { X } from 'lucide-react';

const ITEM_TYPES = [
  { type: 'rent', name: '임대료' },
  { type: 'maintenance', name: '관리비' },
  { type: 'electricity', name: '전기' },
  { type: 'water', name: '수도' },
  { type: 'other', name: '기타' },
];

export default function TaxInvoiceForm({ invoice, year, month, onClose, onSaved }) {
  const isEdit = !!invoice;
  const [tenants, setTenants] = useState([]);
  const [form, setForm] = useState({
    tenant_id: invoice?.tenant_id || '',
    item_type: invoice?.item_type || 'rent',
    item_name: invoice?.item_name || '임대료',
    supply_amount: invoice?.supply_amount ?? '',
    memo: invoice?.memo || '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit) {
      authFetch(`${API_BASE}/tenants`).then(async (res) => {
        if (res.ok) setTenants(await res.json());
      }).catch(() => {});
    }
  }, [isEdit]);

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const taxAmount = form.item_type === 'water' ? 0 : Math.round(Number(form.supply_amount || 0) * 0.1);
  const totalAmount = Number(form.supply_amount || 0) + taxAmount;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.supply_amount && form.supply_amount !== 0) {
      setError('공급가액을 입력하세요');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const url = isEdit ? `${API_BASE}/tax-invoices/${invoice.id}` : `${API_BASE}/tax-invoices`;
      const method = isEdit ? 'PUT' : 'POST';
      const body = isEdit
        ? { supply_amount: Number(form.supply_amount), item_name: form.item_name, memo: form.memo }
        : { tenant_id: Number(form.tenant_id), year, month, item_type: form.item_type, item_name: form.item_name, supply_amount: Number(form.supply_amount), memo: form.memo };
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSaved();
        onClose();
      } else {
        const data = await res.json();
        setError(data.error || '저장 실패');
      }
    } catch {
      setError('서버 오류');
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n) => (n || 0).toLocaleString();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-bold text-gray-900">{isEdit ? '세금계산서 수정' : '세금계산서 등록'}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {!isEdit && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">입주사 *</label>
                <select value={form.tenant_id} onChange={(e) => set('tenant_id', e.target.value)} required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">선택</option>
                  {tenants.filter((t) => t.is_active).map((t) => (
                    <option key={t.id} value={t.id}>{t.floor}F {t.company_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">항목유형 *</label>
                <select value={form.item_type} onChange={(e) => {
                  const type = e.target.value;
                  const name = ITEM_TYPES.find((t) => t.type === type)?.name || type;
                  set('item_type', type);
                  set('item_name', name);
                }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  {ITEM_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>{t.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">품목명</label>
            <input type="text" value={form.item_name} onChange={(e) => set('item_name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="임대료" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">공급가액 *</label>
            <input type="number" value={form.supply_amount} onChange={(e) => set('supply_amount', e.target.value)} required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0" />
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">세액{form.item_type === 'water' ? ' (면세)' : ' (10%)'}</span>
              <span className="font-medium">{fmt(taxAmount)}원</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-500">합계</span>
              <span className="font-bold">{fmt(totalAmount)}원</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">메모</label>
            <input type="text" value={form.memo} onChange={(e) => set('memo', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="메모 (선택)" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={saving}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]">
            {saving ? '저장 중...' : isEdit ? '수정' : '등록'}
          </button>
        </form>
      </div>
    </div>
  );
}
