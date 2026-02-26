import React, { useState } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { X } from 'lucide-react';

export default function TenantForm({ tenant, onClose, onSaved }) {
  const isEdit = !!tenant;
  const [form, setForm] = useState({
    floor: tenant?.floor || '',
    company_name: tenant?.company_name || '',
    business_number: tenant?.business_number || '',
    representative: tenant?.representative || '',
    business_type: tenant?.business_type || '',
    business_item: tenant?.business_item || '',
    address: tenant?.address || '',
    contact_phone: tenant?.contact_phone || '',
    email: tenant?.email || '',
    password: '',
    rent_amount: tenant?.rent_amount || 0,
    maintenance_fee: tenant?.maintenance_fee || 0,
    deposit_amount: tenant?.deposit_amount || 0,
    lease_start: tenant?.lease_start?.slice(0, 10) || '',
    lease_end: tenant?.lease_end?.slice(0, 10) || '',
    billing_day: tenant?.billing_day || 1,
    payment_type: tenant?.payment_type || 'prepaid',
    is_active: tenant?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = { ...form, rent_amount: Number(form.rent_amount), maintenance_fee: Number(form.maintenance_fee), deposit_amount: Number(form.deposit_amount), floor: Number(form.floor), billing_day: Number(form.billing_day) };
      const url = isEdit ? `${API_BASE}/tenants/${tenant.id}` : `${API_BASE}/tenants`;
      const method = isEdit ? 'PUT' : 'POST';
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      onSaved();
    } catch {
      setError('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">{isEdit ? '입주사 수정' : '입주사 등록'}</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">층수 *</label>
              <input type="number" min="1" max="99" value={form.floor} onChange={(e) => set('floor', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">업체명 *</label>
              <input type="text" value={form.company_name} onChange={(e) => set('company_name', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">대표자명</label>
              <input type="text" value={form.representative} onChange={(e) => set('representative', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사업자등록번호</label>
              <input type="text" value={form.business_number} onChange={(e) => set('business_number', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="000-00-00000" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">업종</label>
              <input type="text" value={form.business_type} onChange={(e) => set('business_type', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">업태</label>
              <input type="text" value={form.business_item} onChange={(e) => set('business_item', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">사업장 주소</label>
            <input type="text" value={form.address} onChange={(e) => set('address', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
              <input type="tel" value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="010-0000-0000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{isEdit ? '비밀번호 변경' : '비밀번호'}</label>
            <input type="text" value={form.password} onChange={(e) => set('password', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder={isEdit ? '변경 시에만 입력' : '미입력 시 층수 4자리 (예: 0001)'} />
          </div>

          <hr className="border-gray-200" />

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">임대료 (원)</label>
              <input type="number" value={form.rent_amount} onChange={(e) => set('rent_amount', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">관리비 (원)</label>
              <input type="number" value={form.maintenance_fee} onChange={(e) => set('maintenance_fee', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">보증금 (원)</label>
              <input type="number" value={form.deposit_amount} onChange={(e) => set('deposit_amount', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">계약 시작일</label>
              <input type="date" value={form.lease_start} onChange={(e) => set('lease_start', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">계약 종료일</label>
              <input type="date" value={form.lease_end} onChange={(e) => set('lease_end', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">청구일</label>
              <select value={form.billing_day} onChange={(e) => set('billing_day', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}일</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">납부 방식</label>
              <select value={form.payment_type} onChange={(e) => set('payment_type', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                <option value="prepaid">선불 (당월 청구)</option>
                <option value="postpaid">후불 (전월 청구)</option>
              </select>
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="rounded border-gray-300" />
              <span className="text-sm text-gray-700">활성 상태</span>
            </label>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

          <button type="submit" disabled={saving} className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]">
            {saving ? '저장 중...' : isEdit ? '수정' : '등록'}
          </button>
        </form>
      </div>
    </div>
  );
}
