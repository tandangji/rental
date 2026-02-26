export const API_BASE = '';

export function authFetch(url, options = {}) {
  try {
    const saved = localStorage.getItem('rental_session');
    if (saved) {
      const session = JSON.parse(saved);
      if (session.token) {
        options.headers = {
          ...options.headers,
          'Authorization': `Bearer ${session.token}`
        };
      }
    }
  } catch {}
  return fetch(url, options);
}
