import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeEmployeePageRead, isEmployeeStepReadable } from '../loadEmployeePage/_authorization.ts';
import { frankfurterUrl, normalizeFrankfurterRates, SUPPORTED_PRICING_CURRENCIES } from './_pricingFx.js';

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return json({ ok: true });
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  try {
    const payload = await request.json().catch(() => ({}));
    const bookId = clean(payload.book_id);
    const accessToken = clean(payload.access_token);
    const base = clean(payload.base_currency).toUpperCase();
    if (!bookId || !accessToken || !SUPPORTED_PRICING_CURRENCIES.includes(base)) return json({ ok: false, error: 'Invalid request.' }, 400);
    const url = Deno.env.get('SUPABASE_URL') || '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!url || !key) return json({ ok: false, error: 'Server configuration is unavailable.' }, 500);
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: tokenRow, error: tokenError } = await supabase.from('book_access_tokens').select('*').eq('token_hash', await sha256Hex(accessToken)).maybeSingle();
    if (tokenError) return json({ ok: false, error: 'Could not validate access token.' }, 500);
    const authorization = authorizeEmployeePageRead(tokenRow, bookId);
    if (!authorization.ok) return json({ ok: false, error: authorization.error }, 403);
    const [{ data: book }, { data: step }] = await Promise.all([
      supabase.from('books').select('*').eq('id', bookId).maybeSingle(),
      supabase.from('book_step_data').select('*').eq('book_id', bookId).eq('step_name', 'pricing').maybeSingle(),
    ]);
    if (!book || !isEmployeeStepReadable('pricing', book, step)) return json({ ok: false, error: 'Pricing is not unlocked.' }, 403);
    const providerUrl = Deno.env.get('PRICING_FX_ENDPOINT') || frankfurterUrl(base);
    const provider = await fetch(providerUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    const rows = provider.ok ? await provider.json().catch(() => null) : null;
    const normalized = normalizeFrankfurterRates(rows, base);
    if (!normalized) return json({ ok: false, error: 'Estimated currency rates are unavailable.' }, 503);
    return json({ ok: true, ...normalized });
  } catch {
    return json({ ok: false, error: 'Estimated currency rates are unavailable.' }, 503);
  }
});
