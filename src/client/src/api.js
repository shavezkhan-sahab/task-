const BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!text) {
    throw Object.assign(new Error(`Server error (${res.status})`), { status: res.status });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Object.assign(
      new Error(`Non-JSON response (${res.status}): ${text.slice(0, 120)}`),
      { status: res.status }
    );
  }

  if (!res.ok) {
    throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  }

  return data;
}

export const api = {
  // username + email + password on register; username-or-email + password on login
  register: (username, email, password) =>
    request('POST', '/auth/register', { username, email, password }),
  login: (username, password) =>
    request('POST', '/auth/login', { username, password }),

  getStatus:     () => request('GET',    '/sale/status'),
  getState:      () => request('GET',    '/sale/state'),
  buy:           () => request('POST',   '/sale/buy'),
  joinWaitlist:  () => request('POST',   '/sale/waitlist'),
  leaveWaitlist: () => request('DELETE', '/sale/waitlist'),
  pay:           () => request('POST',   '/payment/pay'),
};
