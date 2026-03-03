import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { CheckCircle, Circle, Trash2 } from 'lucide-react';

const CATEGORY_COLOR = {
  '고장신고': 'bg-red-100 text-red-700',
  '건의사항': 'bg-blue-100 text-blue-700',
  '기타': 'bg-gray-100 text-gray-600',
};

export default function InquiryList() {
  const [inquiries, setInquiries] = useState([]);
  const [filter, setFilter] = useState('all'); // all | unresolved | resolved

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE}/inquiries`);
      if (res.ok) setInquiries(await res.json());
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (id) => {
    try {
      const res = await authFetch(`${API_BASE}/inquiries/${id}/resolve`, { method: 'PATCH' });
      if (res.ok) load();
    } catch {}
  };

  const handleDelete = async (id) => {
    if (!window.confirm('이 문의를 삭제하시겠습니까?')) return;
    try {
      const res = await authFetch(`${API_BASE}/inquiries/${id}`, { method: 'DELETE' });
      if (res.ok) load();
    } catch {}
  };

  const fmt = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const filtered = inquiries.filter((i) => {
    if (filter === 'unresolved') return !i.is_resolved;
    if (filter === 'resolved') return i.is_resolved;
    return true;
  });

  const unresolvedCount = inquiries.filter((i) => !i.is_resolved).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-gray-900">문의 목록</h2>
          {unresolvedCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full">{unresolvedCount}</span>
          )}
        </div>
      </div>

      {/* 필터 */}
      <div className="flex gap-2 mb-4">
        {[['all', '전체'], ['unresolved', '미처리'], ['resolved', '처리완료']].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setFilter(val)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              filter === val ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((item) => (
          <div key={item.id} className={`bg-white rounded-xl border p-4 ${item.is_resolved ? 'border-gray-100 opacity-60' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-900">{item.floor}층 {item.company_name}</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${CATEGORY_COLOR[item.category] || 'bg-gray-100 text-gray-600'}`}>
                  {item.category}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleToggle(item.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg whitespace-nowrap border transition-colors ${
                    item.is_resolved
                      ? 'text-green-700 bg-green-50 border-green-200 hover:bg-green-100'
                      : 'text-gray-500 bg-white border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {item.is_resolved
                    ? <><CheckCircle className="w-3 h-3" /> 처리완료</>
                    : <><Circle className="w-3 h-3" /> 미처리</>
                  }
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-200 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.content}</p>
            <p className="text-xs text-gray-400 mt-2">{fmt(item.created_at)}</p>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-center py-12 text-gray-400">문의가 없습니다</p>
        )}
      </div>
    </div>
  );
}
