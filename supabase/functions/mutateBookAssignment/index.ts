import { BasecampError, enabledTodoset } from '../_shared/basecampClient.ts';
import { employeeDeepLink } from '../_shared/basecampBookRuntime.ts';
import { CORS, json, safeError, serverClient } from '../_shared/edgeSupport.ts';
import { loadCreateBookOptions } from '../_shared/basecampProvisioning.ts';
import { createBasecampRuntime, listEligibleReviewers, loadActiveBasecampConnection, loadDefaultReviewerId, privilegedDependencies, serverEnvironment } from '../_shared/basecampRuntime.ts';
import { authorizeBookReviewerOverride, deriveEmployeeReassignmentToken, manageReviewerAssignment, reassignEmployee } from '../_shared/operationalAdministration.ts';
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
    const actor = await resolvePrivilegedActor({ ...privilegedDependencies(supabase), authorizationHeader: request.headers.get('Authorization') });
    const { data: bookRow, error: bookError } = await supabase.from('books')
      .select('id,overall_status,latest_review_round_id,assigned_reviewer_user_id,reviewer_assignment_revision,employee_basecamp_person_id,employee_revision,deleted_at')
      .eq('id', body.bookId).is('deleted_at', null).maybeSingle();
    if (bookError || !bookRow) throw new BasecampError(404, 'Book was not found.');

    if (body.action === 'set_override') {
      if (Number(body.expectedRevision) !== Number(bookRow.reviewer_assignment_revision)) throw new BasecampError(409, 'Reviewer override changed elsewhere. Refresh and try again.');
      authorizeBookReviewerOverride({ actor, currentReviewerId: bookRow.assigned_reviewer_user_id, targetReviewerId: body.targetReviewerId });
      const { data, error } = await supabase.rpc('set_book_reviewer_override', {
        p_actor_user_id:actor.id,p_book_id:bookRow.id,p_expected_revision:body.expectedRevision,
        p_target_reviewer_user_id:body.targetReviewerId,p_reason:body.reason,
      });
      if (error?.code === '40001') throw new BasecampError(409, 'Reviewer override changed elsewhere. Refresh and try again.');
      if (error) throw error;
      return json({ ok: true, ...data });
    }

    if (['claim', 'assign', 'reassign'].includes(body.action)) {
      const { data: round, error: roundError } = await supabase.from('book_review_rounds').select('id,book_id,status,reviewer_user_id,revision,finalized_at').eq('id', bookRow.latest_review_round_id).maybeSingle();
      if (roundError || !round) throw new BasecampError(409, 'Active review assignment is unavailable.');
      if (Number(body.expectedRevision) !== Number(round.revision) || (body.expectedReviewerUserId || null) !== (round.reviewer_user_id || bookRow.assigned_reviewer_user_id || null)) throw new BasecampError(409, 'Review assignment changed elsewhere. Refresh and try again.');
      const reviewers = await listEligibleReviewers(supabase);
      const result = await manageReviewerAssignment({
        actor, book: { id: bookRow.id, assignedReviewerId: bookRow.assigned_reviewer_user_id },
        round: { id: round.id, revision: round.revision, reviewerId: round.reviewer_user_id }, input: body, eligibleReviewers: reviewers,
        persist: async (input: Record<string, unknown>) => {
          const { data, error } = await supabase.rpc('manage_review_assignment', {
            p_actor_user_id: input.actorId,p_book_id: input.bookId,p_review_round_id: input.reviewRoundId,p_expected_revision: input.expectedRevision,
            p_expected_reviewer_user_id: input.expectedReviewerUserId,p_target_reviewer_user_id: input.targetReviewerUserId,p_action: input.action,p_reason: input.reason,
          });
          if (error?.code === '40001') throw new BasecampError(409, 'Review assignment changed elsewhere. Refresh and try again.');
          if (error) throw error;
          return data;
        },
      });
      return json({ ok: true, ...result });
    }

    if (body.action !== 'reassign_employee') throw new BasecampError(422, 'Assignment action is invalid.');
    if (Number(body.expectedEmployeeRevision) !== Number(bookRow.employee_revision) || String(body.expectedEmployeePersonId || '') !== String(bookRow.employee_basecamp_person_id || '')) throw new BasecampError(409, 'Employee assignment changed elsewhere. Refresh and try again.');
    const connection = await loadActiveBasecampConnection(supabase);
    const env = serverEnvironment();
    if (!env.userAgent || !env.employeeIntakeUrl) throw new BasecampError(500, 'Basecamp employee assignment configuration is incomplete.');
    const runtime = await createBasecampRuntime(supabase, connection, env);
    const project = await runtime.getJson(`projects/${connection.projectId}.json`);
    if (String(project?.id) !== connection.projectId || enabledTodoset(project) !== connection.todosetId) throw new BasecampError(409, 'The configured Pre-Press project is not accessible.');
    const projectPeople = await runtime.getCollection(`projects/${connection.projectId}/people.json`);
    const options = await loadCreateBookOptions({ connection, listProjectPeople: () => projectPeople, listEligibleReviewers: () => listEligibleReviewers(supabase), loadDefaultReviewerId: () => loadDefaultReviewerId(supabase) });
    const employees = options.employees.map((employee: Record<string, unknown>) => ({ ...employee, email: String(projectPeople.find((person: Record<string, unknown>) => String(person.id) === String(employee.id))?.email_address || '') }));
    const integrationEventId = crypto.randomUUID();
    const reassignmentSecret = Deno.env.get('EMPLOYEE_ACCESS_TOKEN_DERIVATION_SECRET') || '';
    const derivedToken = await deriveEmployeeReassignmentToken(reassignmentSecret, integrationEventId);
    const result = await reassignEmployee({
      actor, book: { id: bookRow.id, employeeRevision: bookRow.employee_revision, employeePersonId: bookRow.employee_basecamp_person_id }, input: body, employees,
      tokenFactory: () => derivedToken,
      persist: async (input: Record<string, unknown>) => {
        const { data, error } = await supabase.rpc('reassign_book_employee', {
          p_actor_user_id:input.actorId,p_book_id:input.bookId,p_expected_employee_revision:input.expectedEmployeeRevision,p_expected_employee_person_id:input.expectedEmployeePersonId,
          p_replacement_employee_person_id:input.replacementEmployeePersonId,p_replacement_employee_name:input.replacementEmployeeName,p_replacement_employee_email:input.replacementEmployeeEmail,
          p_token_hash:input.tokenHash,p_token_prefix:input.tokenPrefix,p_integration_event_id:integrationEventId,p_reason:input.reason,
        });
        if (error?.code === '40001') throw new BasecampError(409, 'Employee assignment changed elsewhere. Refresh and try again.');
        if (error) throw error;
        return data;
      },
      syncBasecamp: async ({ employee, rawEmployeeToken, integrationEventId }: Record<string, any>) => {
        const deliveryClaimId = crypto.randomUUID();
        const kind = ['needs_updates','EMPLOYEE_UPDATES'].includes(String(bookRow.overall_status)) ? 'employee_update' : 'book_todo_list';
        const { data: reference } = await supabase.from('basecamp_references').select('id,todo_id,project_id').eq('book_id',bookRow.id).eq('reference_kind',kind).order('created_at',{ascending:false}).limit(1).maybeSingle();
        return syncEmployeeReassignment({
          event:{id:integrationEventId,status:'pending'},reference,projectId:connection.projectId,employeePersonId:employee.id,
          employeeDeepLink:employeeDeepLink(env.employeeIntakeUrl,bookRow.id,rawEmployeeToken),loadTodo:(id:string)=>runtime.getJson(`todos/${id}.json`),
          updateTodo:(id:string,payload:Record<string,unknown>)=>runtime.putJson(`todos/${id}.json`,payload),
          claim:async()=>{ const { data,error }=await supabase.rpc('claim_employee_access_delivery',{p_book_id:bookRow.id,p_event_id:integrationEventId,p_claim_id:deliveryClaimId}); if(error||!data?.ok) throw new BasecampError(409,'Employee access delivery is already in progress.'); },
          settle:async(status:string)=>{ const { data,error }=await supabase.rpc('settle_employee_access_delivery',{p_book_id:bookRow.id,p_event_id:integrationEventId,p_claim_id:deliveryClaimId,p_status:status,p_error_message:status==='failed'?'employee_reassignment_sync_failed':null}); if(error||!data?.ok) throw new BasecampError(502,'Integration event settlement failed.','integration_settlement_failed'); },
        });
      },
    });
    return json({ ok: true, employeeRevision: result.employeeRevision, basecamp: result.basecamp });
  } catch (error) { return safeError(error); }
});
