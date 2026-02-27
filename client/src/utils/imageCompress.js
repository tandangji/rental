/**
 * 스마트폰 사진을 업로드 전에 리사이즈+압축하여 용량을 줄입니다.
 * 예: 10MB HEIC/JPG → ~200-400KB JPEG
 */
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 1280;
const QUALITY = 0.7;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function compressImage(file) {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('이미지 파일만 업로드 가능합니다'));
  }
  if (file.size > MAX_FILE_SIZE) {
    return Promise.reject(new Error('파일 크기는 50MB 이하여야 합니다'));
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // 리사이즈 비율 계산
      if (width > MAX_WIDTH || height > MAX_HEIGHT) {
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // JPEG로 압축하여 data URL 반환
      const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
      resolve(dataUrl);
    };
    img.onerror = () => {
      // 압축 실패 시 원본 그대로 반환
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    };
    img.src = URL.createObjectURL(file);
  });
}
