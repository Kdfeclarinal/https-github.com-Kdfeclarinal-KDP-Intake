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
const BOOK_FIELDS = 'id,book_title,book_author_name,primary_author_name,overall_status,updated_at,created_at,assigned_reviewer_user_id,reviewer_assignment_revision,latest_review_round_id,employee_basecamp_person_id,employee_name,employee_revision,deleted_at,deleted_by_privileged_user_id,trash_revision,basecamp_references(reference_kind,review_round_id,provisioning_status),integration_events(event_type,status,created_at)'
const positiveHours = (value: string | undefined) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null }

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
        const { data, error } = await supabase.from('books').select(BOOK_FIELDS)
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
      listUnassignedActiveBookIds: async () => {
        const { data, error } = await supabase.from('book_review_rounds').select('book_id')
          .is('reviewer_user_id', null).in('status', ['submitted', 'in_review']).is('finalized_at', null)
        if (error) throw error
        return [...new Set((data || []).map((row) => row.book_id).filter(Boolean))]
      },
      listBooksByIds: async (ids: string[]) => {
        const { data, error } = await supabase.from('books').select(BOOK_FIELDS).in('id', ids).is('deleted_at', null)
        if (error) throw error
        return data || []
      },
      listActiveRounds: async (ids: string[]) => {
        if (!ids.length) return []
        const { data, error } = await supabase.from('book_review_rounds').select('id,reviewer_user_id,reviewer_name_snapshot,revision,status,submitted_at,started_at,employee_updates_started_at,finalized_at').in('id', ids)
        if (error) throw error
        return data || []
      },
      listEligibleReviewerIds: async () => {
        const { data: grants, error: grantError } = await supabase
          .from('privileged_user_capability_grants')
          .select('privileged_user_id')
          .eq('capability_key', 'can_review')
          .is('revoked_at', null)
        if (grantError) throw grantError
        const ids = [...new Set((grants || []).map((row) => row.privileged_user_id).filter(Boolean))]
        if (!ids.length) return []
        const { data: users, error: userError } = await supabase
          .from('privileged_users')
          .select('id')
          .in('id', ids)
          .is('disabled_at', null)
        if (userError) throw userError
        return (users || []).map((row) => row.id)
      },
      listReviewerProfiles: async (ids: string[]) => {
        if (!ids.length) return []
        const { data, error } = await supabase.from('privileged_users').select('id,display_name').in('id', ids)
        if (error) throw error
        return data || []
      },
      listLatestFiles: async (bookIds: string[]) => {
        if (!bookIds.length) return []
        const { data, error } = await supabase.from('book_files').select('book_id,file_type,file_name,reviewstudio_file_url,download_url,metadata,updated_at').in('book_id', bookIds).eq('is_latest', true)
        if (error) throw error
        return data || []
      },
      attentionPolicy: {
        reviewDueHours: positiveHours(Deno.env.get('KDP_REVIEW_DUE_HOURS')),
        reviewEscalationHours: positiveHours(Deno.env.get('KDP_REVIEW_ESCALATION_HOURS')),
        employeeUpdatesDueHours: positiveHours(Deno.env.get('KDP_EMPLOYEE_UPDATES_DUE_HOURS')),
        employeeUpdatesEscalationHours: positiveHours(Deno.env.get('KDP_EMPLOYEE_UPDATES_ESCALATION_HOURS')),
      },
    })
    return json(result.body, result.status)
  } catch (error) {
    console.error('[loadPrivilegedBookshelf] authorized read failed:', error instanceof Error ? error.message : 'unknown error')
    return json({ ok: false, error: 'Bookshelf data is unavailable.' }, 500)
  }
})
