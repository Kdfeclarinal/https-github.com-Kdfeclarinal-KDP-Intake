import { BasecampError } from '../_shared/basecampClient.ts'
import { employeeDeepLink } from '../_shared/basecampBookRuntime.ts'
import { CORS, json, safeError, serverClient } from '../_shared/edgeSupport.ts'
import { createBasecampRuntime, loadActiveBasecampConnection, privilegedDependencies, serverEnvironment } from '../_shared/basecampRuntime.ts'
import { sha256Token } from '../_shared/createPrivilegedBook.ts'
import { deriveEmployeeReassignmentToken } from '../_shared/operationalAdministration.ts'
import { syncEmployeeReassignment } from '../_shared/operationalBasecamp.ts'
import { resolvePrivilegedActor } from '../_shared/privilegedRequest.ts'

const uuid = (value: unknown) => /^[0-9a-f-]{36}$/i.test(String(value || ''))

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405)
  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '')
    const expectedRevision = Number(body.expectedRevision)
    const reason = String(body.reason || '').trim()
    if (!uuid(body.bookId) || !['trash', 'recover'].includes(action) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || reason.length < 3 || reason.length > 1000) {
      throw new BasecampError(422, 'The Trash request is invalid.')
    }
    const supabase = serverClient()
    const actor = await resolvePrivilegedActor({ ...privilegedDependencies(supabase), authorizationHeader: request.headers.get('Authorization'), requiredCapability: 'can_manage_users' })
    if (!['owner', 'tech_admin'].includes(actor.role_key)) throw new BasecampError(403, 'Trash management is not authorized.')
    let rawToken = ''
    const integrationEventId = action === 'recover' ? crypto.randomUUID() : ''
    if (action === 'recover') {
      const secret = Deno.env.get('EMPLOYEE_ACCESS_TOKEN_DERIVATION_SECRET') || ''
      rawToken = await deriveEmployeeReassignmentToken(secret, integrationEventId)
    }
    const tokenHash = rawToken ? await sha256Token(rawToken) : null
    const { data, error } = await supabase.rpc('set_kdp_book_trash_state', {
      p_book_id: body.bookId,
      p_actor_user_id: actor.id,
      p_action: action,
      p_expected_revision: expectedRevision,
      p_reason: reason,
      p_recovery_token_hash: tokenHash,
      p_recovery_token_prefix: rawToken ? rawToken.slice(0, 12) : null,
      p_recovery_integration_event_id: integrationEventId || null,
    })
    if (error?.code === '40001') throw new BasecampError(409, 'Book Trash state changed elsewhere. Refresh and try again.')
    if (error) throw error
    let basecamp = { status: 'ready', retryAvailable: false }
    if (data.recovery_event_id) {
      const deliveryClaimId = crypto.randomUUID()
      const settle = async (status: string) => {
        const { data: settled, error: settleError } = await supabase.rpc('settle_employee_access_delivery', {
          p_book_id: body.bookId, p_event_id: data.recovery_event_id, p_claim_id: deliveryClaimId,
          p_status: status, p_error_message: status === 'failed' ? 'employee_access_sync_failed' : null,
        })
        if (settleError || !settled?.ok) throw new BasecampError(502, 'Integration event settlement failed.', 'integration_settlement_failed')
      }
      try {
        const connection = await loadActiveBasecampConnection(supabase)
        const env = serverEnvironment()
        if (!env.userAgent || !env.employeeIntakeUrl) throw new BasecampError(500, 'Basecamp employee access delivery configuration is incomplete.')
        const runtime = await createBasecampRuntime(supabase, connection, env)
        const { data: reference } = await supabase.from('basecamp_references').select('id,todo_id,project_id')
          .eq('book_id', body.bookId).eq('reference_kind', data.recovery_reference_kind).order('created_at', { ascending: false }).limit(1).maybeSingle()
        basecamp = await syncEmployeeReassignment({
          event: { id: data.recovery_event_id, status: 'pending' }, reference,
          projectId: connection.projectId, employeePersonId: data.employee_person_id,
          employeeDeepLink: employeeDeepLink(env.employeeIntakeUrl, body.bookId, rawToken),
          claim: async () => { const { data: claimed, error: claimError } = await supabase.rpc('claim_employee_access_delivery', { p_book_id: body.bookId, p_event_id: data.recovery_event_id, p_claim_id: deliveryClaimId }); if (claimError || !claimed?.ok) throw new BasecampError(409, 'Employee access delivery is already in progress.'); },
          loadTodo: (id: string) => runtime.getJson(`todos/${id}.json`),
          updateTodo: (id: string, payload: Record<string, unknown>) => runtime.putJson(`todos/${id}.json`, payload),
          settle,
        })
      } catch (syncError) {
        if (syncError instanceof BasecampError && syncError.code === 'integration_settlement_failed') throw syncError
        const { data: claimed } = await supabase.rpc('claim_employee_access_delivery', { p_book_id: body.bookId, p_event_id: data.recovery_event_id, p_claim_id: deliveryClaimId })
        if (claimed?.ok) await settle('failed')
        basecamp = { status: 'failed', retryAvailable: true }
      }
    }
    return json({
      ok: true,
      deleted: data.deleted,
      trashRevision: data.trash_revision,
      employeeAccessReestablished: basecamp.status === 'ready' && Boolean(data.recovery_event_id),
      basecampSyncRequired: data.recovery_event_id ? basecamp.status !== 'ready' : data.basecamp_sync_required === true,
      basecamp,
    })
  } catch (error) {
    return safeError(error)
  }
})
