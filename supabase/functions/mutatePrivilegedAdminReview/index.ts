import { createClient } from 'npm:@supabase/supabase-js@2'
import { mutatePrivilegedAdminReview } from '../_shared/adminReviewMutation.ts'
import { resolvePrivilegedActor } from '../_shared/privilegedRequest.ts'
import { resolvePrivilegedAdminReview } from '../loadPrivilegedAdminReview/_adminReview.ts'
import { syncReviewOutcomeWithRuntime } from '../_shared/basecampOutcomeRuntime.ts'
import { BasecampError } from '../_shared/basecampClient.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL') || ''
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!url || !key) return json({ ok: false, error: 'Server configuration is unavailable.' }, 500)
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const authorizationHeader = request.headers.get('Authorization')
    const common = {
      authorizationHeader,
      authenticate: async (token: string) => { const { data, error } = await supabase.auth.getUser(token); return error ? null : data.user },
      findPrivilegedUser: async (authId: string) => { const { data, error } = await supabase.from('privileged_users').select('id,display_name,email_snapshot,disabled_at').eq('auth_user_id', authId).maybeSingle(); if (error) throw error; return data },
      listGrants: async (userId: string) => { const { data, error } = await supabase.from('privileged_user_capability_grants').select('capability_key,revoked_at').eq('privileged_user_id', userId); if (error) throw error; return data || [] },
      findBook: async (id: string) => { const { data, error } = await supabase.from('books').select('id,book_title,primary_author_name,overall_status,latest_review_round_id,assigned_reviewer_user_id,deleted_at').eq('id', id).maybeSingle(); if (error) throw error; return data },
      findRound: async (id: string) => { const { data, error } = await supabase.from('book_review_rounds').select('*').eq('id', id).maybeSingle(); if (error) throw error; return data },
      findItem: async (id: string) => { const { data, error } = await supabase.from('book_review_items').select('id,book_id,review_round_id').eq('id', id).maybeSingle(); if (error) throw error; return data },
      listItems: async (roundId: string) => { const { data, error } = await supabase.from('book_review_items').select('*').eq('review_round_id', roundId); if (error) throw error; return data || [] },
      listComments: async (roundId: string) => { const { data, error } = await supabase.from('book_review_comments').select('*').eq('review_round_id', roundId).is('deleted_at', null); if (error) throw error; return data || [] },
      listRounds: async (bookId: string) => { const { data, error } = await supabase.from('book_review_rounds').select('id,round_number,status,outcome,finalized_at').eq('book_id', bookId).order('round_number', { ascending: false }); if (error) throw error; return data || [] },
      listSnapshotFiles: async (fileIds: string[]) => {
        if (!fileIds.length) return []
        const { data, error } = await supabase.from('book_files')
          .select('id,reviewstudio_file_id,reviewstudio_file_url')
          .in('id', fileIds)
        if (error) throw error
        return data || []
      },
      listContinuations: async (roundId: string) => {
        const { data: threads, error: threadError } = await supabase.from('book_review_update_threads')
          .select('id,target_comment_id,target_review_item_id,source_round_number,request_body_snapshot,request_number_snapshot,reviewer_name_snapshot,requested_at,ready_via_reply,ready_via_change,ready_via_file_change,ready_at,readiness_evidence')
          .eq('target_review_round_id', roundId)
        if (threadError) throw threadError
        const threadIds = (threads || []).map((thread) => thread.id)
        if (!threadIds.length) return []
        const { data: replies, error: replyError } = await supabase.from('book_review_update_replies')
          .select('id,update_thread_id,body,author_name_snapshot,created_at')
          .in('update_thread_id', threadIds).order('created_at', { ascending: true })
        if (replyError) throw replyError
        return (threads || []).map((thread) => ({ ...thread, replies: (replies || []).filter((reply) => reply.update_thread_id === thread.id) }))
      },
    }
    const body = await request.json().catch(() => ({}))
    const result = await mutatePrivilegedAdminReview({
      resolveActor: () => resolvePrivilegedActor({ ...common, requiredCapability: 'can_review' }),
      findBook: common.findBook,
      findRound: common.findRound,
      findItem: common.findItem,
      applyAction: async ({ bookId, roundId, actorId, action, expectedRevision, payload }: Record<string, any>) => { const { data, error } = await supabase.rpc('apply_admin_review_action', { p_book_id: bookId, p_review_round_id: roundId, p_actor_user_id: actorId, p_action: action, p_expected_revision: expectedRevision, p_payload: payload }); if (error?.code === '40001') throw new BasecampError(409, 'This review changed elsewhere. Refresh and try again.'); if (error) throw error; return data },
      finalizeRound: async ({ bookId, roundId, actorId, outcome, expectedRevision }: Record<string, any>) => {
        const { data, error } = await supabase.rpc('finalize_kdp_review_round', { p_book_id: bookId, p_review_round_id: roundId, p_actor_user_id: actorId, p_outcome: outcome, p_expected_revision: expectedRevision });
        if (error?.code === '40001') throw new BasecampError(409, 'This review changed elsewhere. Refresh and try again.');
        if (error) throw error;
        if (data?.replayed === true) return data;
        let auditStatus = 'failed';
        let auditError: string | null = 'basecamp_review_outcome_sync_failed';
        try {
          const sync = await syncReviewOutcomeWithRuntime(supabase, roundId, outcome);
          auditStatus = sync.status === 'ready' ? 'success' : 'failed';
          auditError = sync.status === 'ready' ? null : 'basecamp_review_outcome_sync_failed';
        } catch { /* canonical outcome remains committed; the separate retry path remains available */ }
        try {
          await supabase.from('integration_events').update({
            status: auditStatus,
            processed_at: new Date().toISOString(),
            error_message: auditError,
          }).eq('provider', 'basecamp').eq('event_type', 'review_outcome_sync_requested')
            .eq('review_round_id', roundId).eq('status', 'pending');
        } catch { /* audit settlement cannot roll back the canonical outcome */ }
        return data;
      },
      reload: async (bookId: string) => { const loaded = await resolvePrivilegedAdminReview(common, bookId); if (loaded.status !== 200) throw new Error('Authoritative review reload failed.'); return loaded.body },
    }, body)
    return json(result.body, result.status)
  } catch (error) {
    console.error('[mutatePrivilegedAdminReview] failed:', error instanceof Error ? error.message : 'unknown error')
    return json({ ok: false, error: 'The review action could not be completed.' }, 500)
  }
})
