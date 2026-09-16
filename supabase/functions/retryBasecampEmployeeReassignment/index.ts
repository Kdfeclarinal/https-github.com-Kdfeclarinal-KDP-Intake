import { BasecampError } from '../_shared/basecampClient.ts';
import { employeeDeepLink } from '../_shared/basecampBookRuntime.ts';
import { createBasecampRuntime, loadActiveBasecampConnection, privilegedDependencies, serverEnvironment } from '../_shared/basecampRuntime.ts';
import { sha256Token } from '../_shared/createPrivilegedBook.ts';
import { CORS, json, safeError, serverClient } from '../_shared/edgeSupport.ts';
import { resolveEmployeeReassignmentToken } from '../_shared/operationalAdministration.ts';
import { syncEmployeeReassignment } from '../_shared/operationalBasecamp.ts';
import { resolvePrivilegedActor } from '../_shared/privilegedRequest.ts';

const uuid = (value: unknown) => /^[0-9a-f-]{36}$/i.test(String(value || ''));

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  try {
    const supabase = serverClient();
    const body = await request.json().catch(() => ({}));
    if (!uuid(body.bookId)) throw new BasecampError(422, 'A valid book is required.');
    const actor = await resolvePrivilegedActor({ ...privilegedDependencies(supabase), authorizationHeader: request.headers.get('Authorization'), requiredCapability: 'can_manage_users' });
    if (!['owner', 'tech_admin'].includes(actor.role_key)) throw new BasecampError(403, 'Employee reassignment retry is not authorized.');
    const { data: event } = await supabase.from('integration_events').select('id,event_type,status,payload_json').eq('book_id', body.bookId).in('event_type', ['employee_reassignment_requested', 'employee_access_recovery_requested']).in('status', ['pending', 'failed']).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!event?.id) throw new BasecampError(409, 'No incomplete employee reassignment sync is available.');
    const { data: book } = await supabase.from('books').select('id,overall_status,employee_basecamp_person_id').eq('id', body.bookId).is('deleted_at', null).maybeSingle();
    const employeePersonId = String(book?.employee_basecamp_person_id || '');
    const intendedEmployeePersonId = String(event.event_type === 'employee_access_recovery_requested' ? event.payload_json?.employee_person_id : event.payload_json?.replacement_employee_person_id || '');
    if (!book?.id || employeePersonId !== intendedEmployeePersonId) throw new BasecampError(409, 'The employee assignment changed after this retry was created.');
    const { data: activeToken } = await supabase.from('book_access_tokens').select('id,token_hash').eq('book_id', book.id).eq('basecamp_person_id', employeePersonId).contains('metadata', { integration_event_id: event.id }).is('revoked_at', null).maybeSingle();
    if (!activeToken?.id) throw new BasecampError(409, 'The replacement employee access has changed.');
    const rawToken = await resolveEmployeeReassignmentToken({
      secrets: [Deno.env.get('EMPLOYEE_ACCESS_TOKEN_DERIVATION_SECRET') || '', Deno.env.get('EMPLOYEE_ACCESS_TOKEN_DERIVATION_PREVIOUS_SECRET') || ''],
      eventId: event.id, expectedHash: activeToken.token_hash, hashToken: sha256Token,
    });
    const connection = await loadActiveBasecampConnection(supabase);
    const env = serverEnvironment();
    if (!env.userAgent || !env.employeeIntakeUrl) throw new BasecampError(500, 'Basecamp employee assignment configuration is incomplete.');
    const runtime = await createBasecampRuntime(supabase, connection, env);
    const kind = ['needs_updates', 'EMPLOYEE_UPDATES'].includes(String(book.overall_status)) ? 'employee_update' : 'book_todo_list';
    const { data: reference } = await supabase.from('basecamp_references').select('id,todo_id,project_id').eq('book_id', book.id).eq('reference_kind', kind).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const deliveryClaimId = crypto.randomUUID();
    const result = await syncEmployeeReassignment({
      event, reference, projectId: connection.projectId, employeePersonId,
      employeeDeepLink: employeeDeepLink(env.employeeIntakeUrl, book.id, rawToken),
      claim: async () => { const { data, error } = await supabase.rpc('claim_employee_access_delivery', { p_book_id: book.id, p_event_id: event.id, p_claim_id: deliveryClaimId }); if (error || !data?.ok) throw new BasecampError(409, 'Employee access delivery is already in progress.'); },
      loadTodo: (id: string) => runtime.getJson(`todos/${id}.json`),
      updateTodo: (id: string, payload: Record<string, unknown>) => runtime.putJson(`todos/${id}.json`, payload),
      settle: async (status: string) => { const { data, error } = await supabase.rpc('settle_employee_access_delivery', { p_book_id: book.id, p_event_id: event.id, p_claim_id: deliveryClaimId, p_status: status, p_error_message: status === 'failed' ? 'employee_access_sync_failed' : null }); if (error || !data?.ok) throw new BasecampError(502, 'Integration event settlement failed.', 'integration_settlement_failed'); },
    });
    return json({ ok: true, basecamp: result });
  } catch (error) { return safeError(error); }
});
