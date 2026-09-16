import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, '0')).join('')

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
  try {
    const body = await request.json().catch(() => ({}))
    const bookId = String(body.bookId || '').trim()
    const accessToken = String(body.accessToken || '')
    const updateCycleId = String(body.updateCycleId || '').trim()
    const sectionKey = String(body.sectionKey || '').trim()
    const step = String(body.step || '').trim()
    const reason = String(body.reason || '').trim()
    const expectedRevision = Number(body.expectedRevision)
    if (!bookId || !accessToken || !updateCycleId || !sectionKey || !['details', 'content', 'pricing'].includes(step) || reason.length < 1 || reason.length > 1000 || body.expectedRevision == null || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return json({ ok: false, error: 'The section reopen request is invalid.' }, 400)
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } })
    const { data, error } = await supabase.rpc('reopen_employee_review_section', {
      p_book_id: bookId,
      p_token_hash: await sha256(accessToken),
      p_update_cycle_id: updateCycleId,
      p_section_key: sectionKey.includes('.') ? sectionKey : `${step}.${sectionKey}`,
      p_reason: reason,
      p_expected_revision: expectedRevision,
    })
    if (error?.code === '40001') return json({ ok: false, error: 'This book changed elsewhere. Reload and try again.' }, 409)
    if (error) return json({ ok: false, error: 'The approved section could not be reopened.' }, 403)
    return json(data)
  } catch {
    return json({ ok: false, error: 'The approved section could not be reopened.' }, 500)
  }
})
