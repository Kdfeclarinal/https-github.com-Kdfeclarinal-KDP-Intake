import { createClient } from 'npm:@supabase/supabase-js@2'
import { resolvePrivilegedBookshelf } from './_privilegedBookshelf.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
})
const BOOK_FIELDS = 'id,book_title,primary_author_name,overall_status,updated_at,created_at,assigned_reviewer_user_id,latest_review_round_id,deleted_at,basecamp_references(reference_kind,review_round_id,provisioning_status)'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return json({ ok: true })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !serviceRoleKey) return json({ ok: false, error: 'Server configuration is unavailable.' }, 500)
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const result = await resolvePrivilegedBookshelf({
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
      listAllBooks: async () => {
        const { data, error } = await supabase.from('books').select(BOOK_FIELDS).is('deleted_at', null)
        if (error) throw error
        return data || []
      },
      listDirectAssignedBooks: async (privilegedUserId: string) => {
        const { data, error } = await supabase.from('books').select(BOOK_FIELDS)
          .eq('assigned_reviewer_user_id', privilegedUserId).is('deleted_at', null)
        if (error) throw error
        return data || []
      },
      listRoundBookIds: async (privilegedUserId: string) => {
        const { data, error } = await supabase.from('book_review_rounds').select('book_id')
          .eq('reviewer_user_id', privilegedUserId).in('status', ['submitted', 'in_review'])
        if (error) throw error
        return [...new Set((data || []).map((row) => row.book_id).filter(Boolean))]
      },
      listBooksByIds: async (ids: string[]) => {
        const { data, error } = await supabase.from('books').select(BOOK_FIELDS).in('id', ids).is('deleted_at', null)
        if (error) throw error
        return data || []
      },
    })
    return json(result.body, result.status)
  } catch (error) {
    console.error('[loadPrivilegedBookshelf] authorized read failed:', error instanceof Error ? error.message : 'unknown error')
    return json({ ok: false, error: 'Bookshelf data is unavailable.' }, 500)
  }
})
