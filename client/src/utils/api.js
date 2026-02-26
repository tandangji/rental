export const API_BASE = '';

export function getToken() {
  try {
    const saved = localStorage.getItem('rental_session');
    if (saved) return JSON.parse(saved).token || '';
  } catch {}
  return '';
}

export function authFetch(url, options = {}) {
  const token = getToken();
  if (token) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
  }
  return fetch(url, options);
}
