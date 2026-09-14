import { createClient } from 'npm:@supabase/supabase-js@2'
import { resolvePrivilegedAdminReview } from './_adminReview.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
})

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return json({ ok: true })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !serviceRoleKey) return json({ ok: false, error: 'Server configuration is unavailable.' }, 500)
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const body = await request.json().catch(() => ({}))
    const result = await resolvePrivilegedAdminReview({
      authorizationHeader: request.headers.get('Authorization'),
      authenticate: async (token: string) => {
        const { data, error } = await supabase.auth.getUser(token)
        return error ? null : data.user
      },
      findPrivilegedUser: async (authUserId: string) => {
        const { data, error } = await supabase.from('privileged_users')
          .select('id,display_name,disabled_at').eq('auth_user_id', authUserId).maybeSingle()
        if (error) throw error
        return data
      },
      listGrants: async (privilegedUserId: string) => {
        const { data, error } = await supabase.from('privileged_user_capability_grants')
          .select('capability_key,revoked_at').eq('privileged_user_id', privilegedUserId)
        if (error) throw error
        return data || []
      },
      findBook: async (bookId: string) => {
        const { data, error } = await supabase.from('books')
          .select('id,book_title,primary_author_name,overall_status,latest_review_round_id,assigned_reviewer_user_id,deleted_at')
          .eq('id', bookId).maybeSingle()
        if (error) throw error
        return data
      },
      findRound: async (roundId: string | null) => {
        if (!roundId) return null
        const { data, error } = await supabase.from('book_review_rounds').select('*').eq('id', roundId).maybeSingle()
        if (error) throw error
        return data
      },
      listItems: async (roundId: string) => {
        const { data, error } = await supabase.from('book_review_items').select('*').eq('review_round_id', roundId)
        if (error) throw error
        return data || []
      },
      listComments: async (roundId: string) => {
        const { data, error } = await supabase.from('book_review_comments').select('*').eq('review_round_id', roundId).is('deleted_at', null)
        if (error) throw error
        return data || []
      },
      listRounds: async (bookId: string) => {
        const { data, error } = await supabase.from('book_review_rounds').select('id,round_number,status,outcome,finalized_at').eq('book_id', bookId).order('round_number', { ascending: false })
        if (error) throw error
        return data || []
      },
    }, body.bookId, body.reviewRoundId)
    return json(result.body, result.status)
  } catch (error) {
    console.error('[loadPrivilegedAdminReview] authorized read failed:', error instanceof Error ? error.message : 'unknown error')
    return json({ ok: false, error: 'Admin review data is unavailable.' }, 500)
  }
})
