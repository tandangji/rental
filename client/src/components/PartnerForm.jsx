import React, { useState, useRef } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { X, Upload } from 'lucide-react';
import { compressImage } from '../utils/imageCompress';

export default function PartnerForm({ partner, onClose, onSaved }) {
  const isEdit = !!partner;
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    type: partner?.type || 'employee',
    name: partner?.name || '',
    contact_phone: partner?.contact_phone || '',
    memo: partner?.memo || '',
    business_number: partner?.business_number || '',
    company_name: partner?.company_name || '',
    representative: partner?.representative || '',
    bank_name: partner?.bank_name || '',
    bank_account: partner?.bank_account || '',
    bank_holder: partner?.bank_holder || '',
    is_active: partner?.is_active ?? true,
  });
  const [bizDocPreview, setBizDocPreview] = useState(
    partner?.biz_doc_filename ? `${API_BASE}/partners/${partner.id}/biz-doc` : null
  );
  const [bizDocBase64, setBizDocBase64] = useState(null);
  const [bizDocFilename, setBizDocFilename] = useState(partner?.biz_doc_filename || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('이미지 파일만 업로드 가능합니다');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('파일 크기는 50MB 이하여야 합니다');
      return;
    }
    setError('');
    try {
      const compressed = await compressImage(file);
      setBizDocPreview(URL.createObjectURL(compressed));
      const reader = new FileReader();
      reader.onload = () => {
        setBizDocBase64(reader.result);
        setBizDocFilename(file.name);
      };
      reader.readAsDataURL(compressed);
    } catch {
      setError('이미지 처리 실패');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = { ...form };
      if (bizDocBase64) {
        body.biz_doc_base64 = bizDocBase64;
        body.biz_doc_filename = bizDocFilename;
      }
      const url = isEdit ? `${API_BASE}/partners/${partner.id}` : `${API_BASE}/partners`;
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
          <h3 className="font-bold text-gray-900">{isEdit ? '협력사 수정' : '협력사 등록'}</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">유형 *</label>
              <select value={form.type} onChange={(e) => set('type', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
                <option value="employee">직원</option>
                <option value="vendor">외주업체</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이름/업체명 *</label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">연락처</label>
              <input type="tel" value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="010-0000-0000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">회사명</label>
              <input type="text" value={form.company_name} onChange={(e) => set('company_name', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">대표자</label>
              <input type="text" value={form.representative} onChange={(e) => set('representative', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사업자등록번호</label>
              <input type="text" value={form.business_number} onChange={(e) => set('business_number', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="000-00-00000" />
            </div>
          </div>

          <hr className="border-gray-200" />

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">은행명</label>
              <input type="text" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">계좌번호</label>
              <input type="text" value={form.bank_account} onChange={(e) => set('bank_account', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">예금주</label>
              <input type="text" value={form.bank_holder} onChange={(e) => set('bank_holder', e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">메모</label>
            <textarea value={form.memo} onChange={(e) => set('memo', e.target.value)} rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm resize-none" />
          </div>

          {/* 사업자등록증 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">사업자등록증</label>
            <input type="file" ref={fileRef} accept="image/*" onChange={handleFileChange} className="hidden" />
            <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
              <Upload className="w-4 h-4 text-gray-500" />
              {bizDocFilename || '파일 선택'}
            </button>
            {bizDocPreview && (
              <img src={bizDocPreview} alt="사업자등록증" className="mt-2 max-h-40 rounded-lg border border-gray-200" />
            )}
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
