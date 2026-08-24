let redirectingToLogin = false;

function redirectToLogin() {
  if (typeof window === 'undefined' || window.location.pathname === '/login' || redirectingToLogin) return;

  redirectingToLogin = true;
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) redirectToLogin();
  return response;
}