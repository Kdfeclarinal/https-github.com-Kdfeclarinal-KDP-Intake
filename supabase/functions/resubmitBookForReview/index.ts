import { createClient } from 'npm:@supabase/supabase-js@2'
import { syncReviewRoundWithRuntime } from '../_shared/basecampReviewRuntime.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, '0')).join('')

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
  try {
    const body = await request.json().catch(() => ({}))
    const bookId = String(body.bookId || '')
    const token = String(body.accessToken || '')
    const updateCycleId = String(body.updateCycleId || '')
    const expectedRevision = Number(body.expectedRevision)
    if (!bookId || !token || !updateCycleId || body.expectedRevision == null || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return json({ ok: false, error: 'Resubmission is not authorized.' }, 400)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } })
    const { data, error } = await supabase.rpc('resubmit_kdp_book_for_review', { p_book_id: bookId, p_token_hash: await sha256(token), p_update_cycle_id: updateCycleId, p_expected_revision: expectedRevision, p_source: 'employee_react_resubmit' })
    if (error?.code === '40001') return json({ ok: false, error: 'This book changed elsewhere. Reload and try again.' }, 409)
    if (error || !data?.review_round_id) return json({ ok: false, error: 'The book is not ready for re-review.' }, 409)
    let basecamp = { status: 'pending', retryAvailable: true }
    try { basecamp = await syncReviewRoundWithRuntime(supabase, data.review_round_id) } catch { /* canonical resubmission remains committed */ }
    return json({ ...data, basecamp })
  } catch { return json({ ok: false, error: 'The book could not be resubmitted.' }, 500) }
})
