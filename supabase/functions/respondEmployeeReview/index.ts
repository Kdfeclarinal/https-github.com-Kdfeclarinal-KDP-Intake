import { createClient } from 'npm:@supabase/supabase-js@2'

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
    const commentId = String(body.commentId || '')
    const text = String(body.body || '')
    const expectedRevision = Number(body.expectedRevision)
    if (!bookId || !token || !commentId || !text.trim() || body.expectedRevision == null || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return json({ ok: false, error: 'Employee reply is invalid.' }, 400)
    const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } })
    const { data, error } = await supabase.rpc('add_employee_review_reply', { p_book_id: bookId, p_token_hash: await sha256(token), p_comment_id: commentId, p_body: text, p_expected_revision: expectedRevision })
    if (error?.code === '40001') return json({ ok: false, error: 'This book changed elsewhere. Reload and try again.' }, 409)
    if (error) return json({ ok: false, error: 'Employee reply could not be saved.' }, 403)
    return json(data)
  } catch { return json({ ok: false, error: 'Employee reply could not be saved.' }, 500) }
})
