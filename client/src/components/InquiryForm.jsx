import React, { useState } from 'react';
import { API_BASE, authFetch } from '../utils/api';
import { Send, CheckCircle } from 'lucide-react';

const CATEGORIES = ['고장신고', '건의사항', '기타'];

export default function InquiryForm({ user }) {
  const [category, setCategory] = useState('고장신고');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) { setError('내용을 입력해주세요'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await authFetch(`${API_BASE}/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, content: content.trim() }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const data = await res.json();
        setError(data.error || '제출 실패');
      }
    } catch {
      setError('서버에 연결할 수 없습니다');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <CheckCircle className="w-16 h-16 text-green-500" />
        <p className="text-lg font-bold text-gray-900">접수 완료</p>
        <p className="text-sm text-gray-500">문의가 정상적으로 접수되었습니다.</p>
        <button
          onClick={() => { setDone(false); setContent(''); setCategory('고장신고'); }}
          className="mt-2 px-4 py-2 text-sm text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50"
        >
          추가 문의하기
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">문의하기</h2>
      <p className="text-sm text-gray-500 mb-4">{user.floor}층 · 고장신고 및 건의사항</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">카테고리</label>
          <div className="flex gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                  category === c
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">내용</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="문의 내용을 자세히 입력해주세요"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
        >
          <Send className="w-4 h-4" />
          {submitting ? '제출 중...' : '문의 제출'}
        </button>
      </form>
    </div>
  );
}
