import { GoTrueClient } from '@supabase/auth-js';

const DEFAULT_SUPABASE_URL = 'https://wpuexhsrhuxieobeanjr.supabase.co';

export function privilegedConfig() {
  const config = window.KDP_INTAKE_CONFIG || {};
  return {
    supabaseUrl: config.supabaseUrl || DEFAULT_SUPABASE_URL,
    publishableKey: String(config.supabasePublishableKey || '').trim(),
  };
}

export function createPrivilegedAuthClient(config = privilegedConfig()) {
  if (!config.publishableKey) return null;
  return {
    auth: new GoTrueClient({
      url: `${config.supabaseUrl}/auth/v1`,
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${config.publishableKey}`,
      },
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    }),
  };
}

export async function callPrivilegedFunction({ functionName, accessToken, body = {}, config = privilegedConfig(), fetchImpl = fetch }) {
  if (!accessToken || !config.publishableKey) throw new Error('Authentication configuration is unavailable.');
  const response = await fetchImpl(`${config.supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: config.publishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => null);
  if (!response.ok || responseBody?.ok !== true) {
    const error = new Error(responseBody?.error || 'Privileged access could not be verified.');
    error.status = response.status;
    throw error;
  }
  return responseBody;
}

export async function loadPrivilegedContext(options) {
  return callPrivilegedFunction({ ...options, functionName: 'loadPrivilegedBookshelf' });
}
