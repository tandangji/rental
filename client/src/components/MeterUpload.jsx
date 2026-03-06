import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, authFetch, getToken } from '../utils/api';
import { compressImage } from '../utils/imageCompress';
import { Camera, Check, Upload, Zap, Droplets, AlertTriangle, Info } from 'lucide-react';

const ALL_UTILITY_TYPES = [
  { key: 'electricity', label: '전기', icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-50' },
  { key: 'water', label: '수도', icon: Droplets, color: 'text-blue-500', bg: 'bg-blue-50' },
];

// KST 기준 현재 날짜
function getKstNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

// 업로드 기간 체크
function isUploadPeriod(utilityType) {
  const kst = getKstNow();
  const day = kst.getDate();
  const month = kst.getMonth() + 1;
  if (utilityType === 'electricity') return day === 22;
  if (utilityType === 'water') return month % 2 === 1 && day === 6;
  return false;
}

export default function MeterUpload({ user }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [readings, setReadings] = useState([]);
  const [uploading, setUploading] = useState(null);
  const [message, setMessage] = useState('');
  const fileRefs = useRef({});

  const userFloors = user.floors || [];

  const kst = getKstNow();
  const kstDay = kst.getDate();
  const kstMonth = kst.getMonth() + 1;
  const isElecPeriod = kstDay === 22;
  const isWaterPeriod = kstMonth % 2 === 1 && kstDay === 6;

  const loadReadings = async () => {
    try {
      const res = await authFetch(`${API_BASE}/meter-readings?year=${year}&month=${month}`);
      if (res.ok) setReadings(await res.json());
    } catch {}
  };

  useEffect(() => { loadReadings(); }, [year, month]);

  const getReading = (type, floor) => readings.find((r) => r.utility_type === type && r.floor === floor);

  const handleUpload = async (utilityType, floor, file) => {
    if (!file) return;
    setUploading(`${floor}-${utilityType}`);
    setMessage('');
    try {
      const base64 = await compressImage(file);
      const res = await authFetch(`${API_BASE}/meter-readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, month,
          utility_type: utilityType,
          photo_base64: base64,
          photo_filename: file.name,
          floor,
        }),
      });
      if (res.ok) {
        setMessage(`${floor}층 ${ALL_UTILITY_TYPES.find(u => u.key === utilityType).label} 사진 업로드 완료`);
        loadReadings();
      } else {
        const data = await res.json();
        setMessage(data.error || '업로드 실패');
      }
    } catch (err) {
      setMessage('업로드 실패: ' + (err.message || err));
    } finally {
      setUploading(null);
    }
  };

  // 현재 선택된 월/년이 오늘 기준 현재월인지 체크 (기간 제한은 현재월에만 적용)
  const isCurrentMonth = year === kst.getFullYear() && month === kstMonth;

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

      {/* 검침 기간 배너 */}
      {isElecPeriod && (
        <div className="mb-3 p-3 rounded-xl bg-yellow-50 border border-yellow-200 flex items-start gap-2">
          <Zap className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-800 font-medium">전기 검침 기간입니다! 사진을 업로드해주세요.</p>
        </div>
      )}
      {isWaterPeriod && (
        <div className="mb-3 p-3 rounded-xl bg-blue-50 border border-blue-200 flex items-start gap-2">
          <Droplets className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800 font-medium">수도 검침 기간입니다! 사진을 업로드해주세요.</p>
        </div>
      )}

      {/* 검침 안내 */}
      <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800">
          <p className="font-semibold">전기는 매월 22일에 검침 사진을 업로드해주세요.</p>
          <p className="mt-0.5">수도는 홀수달(1,3,5,7,9,11월) 6일에 사진을 업로드해주세요.</p>
          <p className="mt-0.5">수도세는 2개월치가 일괄 부과됩니다.</p>
          <p className="mt-0.5">검침사진 미제출 시 전월 사용량의 1.5배로 임시 부과됩니다.</p>
        </div>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-700 text-sm">{message}</div>
      )}

      <div className="space-y-4">
        {userFloors.map((floor) => (
          <div key={floor}>
            {userFloors.length > 1 && (
              <p className="text-sm font-bold text-gray-700 mb-2">{floor}층</p>
            )}
            <div className="space-y-3">
              {ALL_UTILITY_TYPES.filter(u => u.key === 'electricity' || month % 2 === 1).map(({ key, label, icon: Icon, color, bg }) => {
                const reading = getReading(key, floor);
                const hasPhoto = reading?.uploaded_at;
                const canUpload = !isCurrentMonth || isUploadPeriod(key);
                const disabledMsg = key === 'electricity'
                  ? '검침 기간은 매월 22일입니다'
                  : '검침 기간은 홀수달 6일입니다';
                const refKey = `${floor}-${key}`;

                return (
                  <div key={refKey} className={`rounded-xl border-2 p-4 ${hasPhoto ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
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
                          ) : !canUpload ? (
                            <p className="text-xs text-gray-400 flex items-center gap-1">
                              <Info className="w-3 h-3" /> {disabledMsg}
                            </p>
                          ) : (
                            <p className="text-xs text-gray-400">사진을 촬영해주세요</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <input
                          ref={(el) => (fileRefs.current[refKey] = el)}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => handleUpload(key, floor, e.target.files?.[0])}
                        />
                        <button
                          onClick={() => fileRefs.current[refKey]?.click()}
                          disabled={uploading === refKey || !canUpload}
                          className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg min-h-[44px] ${
                            !canUpload
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : hasPhoto
                                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                          } disabled:opacity-50`}
                        >
                          {uploading === refKey ? (
                            <Upload className="w-4 h-4 animate-pulse" />
                          ) : (
                            <Camera className="w-4 h-4" />
                          )}
                          {!canUpload ? '기간 외' : hasPhoto ? '재업로드' : '촬영'}
                        </button>
                      </div>
                    </div>

                    {/* Photo preview */}
                    {hasPhoto && reading.id && (
                      <div className="mt-3">
                        <img
                          src={`${API_BASE}/meter-readings/${reading.id}/photo?token=${getToken()}`}
                          alt={`${floor}층 ${label} 계량기`}
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
        ))}
      </div>
    </div>
  );
}
