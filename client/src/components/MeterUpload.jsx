import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, authFetch, getToken } from '../utils/api';
import { compressImage } from '../utils/imageCompress';
import { Camera, Check, Upload, Flame, Zap, Droplets, AlertTriangle } from 'lucide-react';

const UTILITY_TYPES = [
  { key: 'gas', label: '가스', icon: Flame, color: 'text-orange-500', bg: 'bg-orange-50' },
  { key: 'electricity', label: '전기', icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-50' },
  { key: 'water', label: '수도', icon: Droplets, color: 'text-blue-500', bg: 'bg-blue-50' },
];

export default function MeterUpload({ user }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [readings, setReadings] = useState([]);
  const [uploading, setUploading] = useState(null);
  const [message, setMessage] = useState('');
  const fileRefs = useRef({});

  const loadReadings = async () => {
    try {
      const res = await authFetch(`${API_BASE}/meter-readings?year=${year}&month=${month}`);
      if (res.ok) setReadings(await res.json());
    } catch {}
  };

  useEffect(() => { loadReadings(); }, [year, month]);

  const getReading = (type) => readings.find((r) => r.utility_type === type);

  const handleUpload = async (utilityType, file) => {
    if (!file) return;
    setUploading(utilityType);
    setMessage('');
    try {
      // 이미지 압축 (1280px, JPEG 70%) — 5~10MB → 200~400KB
      const base64 = await compressImage(file);
      const res = await authFetch(`${API_BASE}/meter-readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, month,
          utility_type: utilityType,
          photo_base64: base64,
          photo_filename: file.name,
        }),
      });
      if (res.ok) {
        setMessage(`${UTILITY_TYPES.find(u => u.key === utilityType).label} 사진 업로드 완료`);
        loadReadings();
      } else {
        const data = await res.json();
        setMessage(data.error || '업로드 실패');
      }
    } catch {
      setMessage('업로드 실패');
    } finally {
      setUploading(null);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900 mb-4">계량기 사진 업로드</h2>

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

      {/* 검침 안내 */}
      <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800">
          <p className="font-semibold">매월 22일까지 검침 사진을 업로드해주세요.</p>
          <p className="mt-0.5">미제출 시 전월 사용량의 1.5배로 임시 부과됩니다.</p>
        </div>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-700 text-sm">{message}</div>
      )}

      <div className="space-y-3">
        {UTILITY_TYPES.map(({ key, label, icon: Icon, color, bg }) => {
          const reading = getReading(key);
          const hasPhoto = reading?.uploaded_at;
          return (
            <div key={key} className={`rounded-xl border-2 p-4 ${hasPhoto ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${color}`} />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{label} 계량기</p>
                    {hasPhoto ? (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <Check className="w-3 h-3" /> 업로드 완료
                        <span className="text-gray-400 ml-1">
                          {new Date(reading.uploaded_at).toLocaleDateString('ko-KR')}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">사진을 촬영해주세요</p>
                    )}
                  </div>
                </div>

                <div>
                  <input
                    ref={(el) => (fileRefs.current[key] = el)}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleUpload(key, e.target.files?.[0])}
                  />
                  <button
                    onClick={() => fileRefs.current[key]?.click()}
                    disabled={uploading === key}
                    className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg min-h-[44px] ${
                      hasPhoto
                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    } disabled:opacity-50`}
                  >
                    {uploading === key ? (
                      <Upload className="w-4 h-4 animate-pulse" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                    {hasPhoto ? '재업로드' : '촬영'}
                  </button>
                </div>
              </div>

              {/* Photo preview */}
              {hasPhoto && reading.id && (
                <div className="mt-3">
                  <img
                    src={`${API_BASE}/meter-readings/${reading.id}/photo?token=${getToken()}`}
                    alt={`${label} 계량기`}
                    className="w-full max-h-48 object-contain rounded-lg bg-gray-100"
                    loading="lazy"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
