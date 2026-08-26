let redirectingToLogin = false;

function redirectToLogin() {
  if (typeof window === 'undefined' || window.location.pathname === '/login' || redirectingToLogin) return;

  redirectingToLogin = true;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = document.cookie.split('; ').find((entry) => entry.startsWith('operator_csrf='))?.slice('operator_csrf='.length);
    if (csrf) headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) redirectToLogin();
  return response;
}