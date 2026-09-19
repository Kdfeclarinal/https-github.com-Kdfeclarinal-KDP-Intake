import { CORS, json, safeError, serverClient } from '../_shared/edgeSupport.ts';
import { createBasecampRuntime, loadActiveBasecampConnection, privilegedDependencies, serverEnvironment } from '../_shared/basecampRuntime.ts';
import { resolvePrivilegedActor } from '../_shared/privilegedRequest.ts';
import { sanitizeOperationalSettings } from '../_shared/operationalAdministration.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  try {
    const supabase = serverClient();
    const actor = await resolvePrivilegedActor({
      ...privilegedDependencies(supabase), authorizationHeader: request.headers.get('Authorization'),
      requiredCapabilities: ['can_manage_users', 'can_change_default_reviewer', 'can_assign_reviewer', 'can_reassign_reviewer', 'can_claim_review', 'can_manage_integrations'],
    });
    const [
      { data: users, error: usersError },
      { data: grants, error: grantsError },
      { data: defaultRow, error: defaultError },
      { data: basecamp, error: basecampError },
      { data: reviewerMappings, error: mappingsError },
    ] = await Promise.all([
      supabase.from('privileged_users').select('id,display_name,email_snapshot,role_key,disabled_at,revision').order('display_name'),
      supabase.from('privileged_user_capability_grants').select('privileged_user_id,capability_key,revoked_at'),
      supabase.from('review_assignment_defaults').select('reviewer_user_id').eq('scope_key', 'kindle_ebook').maybeSingle(),
      supabase.from('basecamp_connections').select('project_id,connection_status,disabled_at').eq('connection_key', 'company').maybeSingle(),
      supabase.from('privileged_user_basecamp_mappings').select('privileged_user_id,basecamp_person_id,display_name_snapshot,project_id'),
    ]);
    if (usersError || grantsError || defaultError || basecampError || mappingsError) throw new Error('Operational settings load failed.');
    const grantMap = new Map<string, string[]>();
    for (const grant of grants || []) if (!grant.revoked_at) grantMap.set(grant.privileged_user_id, [...(grantMap.get(grant.privileged_user_id) || []), grant.capability_key]);
    let employees: Array<Record<string, string>> = [];
    if (basecamp && !basecamp.disabled_at && basecamp.connection_status === 'connected' && actor.capabilities.includes('can_manage_users')) {
      try {
        const connection = await loadActiveBasecampConnection(supabase);
        const runtime = await createBasecampRuntime(supabase, connection, serverEnvironment());
        const people = await runtime.getCollection(`projects/${connection.projectId}/people.json`);
        employees = (people || []).filter((person: Record<string, unknown>) => person.id && person.name).map((person: Record<string, unknown>) => ({ id: String(person.id), displayName: String(person.name), email: String(person.email_address || '') }));
      } catch { employees = []; }
    }
    const body = sanitizeOperationalSettings({
      actor, users: (users || []).map((user) => ({ ...user, capabilities: grantMap.get(user.id) || [] })),
      defaultReviewerId: defaultRow?.reviewer_user_id,
      employees,
      reviewerMappings: reviewerMappings || [],
      integrations: {
        basecamp: { status: basecamp?.disabled_at ? 'disabled' : basecamp?.connection_status || 'disconnected', projectId: basecamp?.project_id || null },
        reviewstudio: { configured: Boolean(Deno.env.get('REVIEWSTUDIO_API_KEY') && Deno.env.get('REVIEWSTUDIO_API_BASE_URL')) },
        ghl: { configured: Boolean(Deno.env.get('GHL_PRIVATE_INTEGRATION_TOKEN')) },
      },
    });
    return json({ ok: true, ...body });
  } catch (error) { return safeError(error); }
});
