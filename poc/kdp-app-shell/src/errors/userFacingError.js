const NETWORK_MESSAGES = new Set(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']);

export function userFacingError(error, fallback = 'The requested action could not be completed. Try again.') {
  const status = Number(error?.status) || 0;
  const raw = String(error?.message || '').trim();
  if (status === 401) return { kind: 'auth', message: 'Your session has expired. Sign in again to continue.', action: 'sign_in' };
  if (status === 403) return { kind: 'permission', message: 'You do not have permission to perform this action.', action: null };
  if (status === 409) return { kind: 'stale', message: 'This information changed elsewhere. Reload the latest version and try again.', action: 'reload' };
  if (error instanceof TypeError || NETWORK_MESSAGES.has(raw)) {
    return { kind: 'network', message: 'The service could not be reached. Check your connection and try again.', action: 'retry' };
  }
  return { kind: 'server', message: fallback, action: 'retry' };
}
