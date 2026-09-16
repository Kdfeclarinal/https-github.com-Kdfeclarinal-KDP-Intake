import { BasecampError } from '../_shared/basecampClient.ts';
import { CORS, json, safeError, serverClient } from '../_shared/edgeSupport.ts';
import { privilegedDependencies } from '../_shared/basecampRuntime.ts';
import { manageTeamMember } from '../_shared/operationalAdministration.ts';
import { resolvePrivilegedActor } from '../_shared/privilegedRequest.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  try {
    const supabase = serverClient();
    const body = await request.json().catch(() => ({}));
    const actor = await resolvePrivilegedActor({ ...privilegedDependencies(supabase), authorizationHeader: request.headers.get('Authorization') });
    if (body.action === 'change_default_reviewer') {
      if (!actor.capabilities.includes('can_change_default_reviewer')) throw new BasecampError(403, 'Default reviewer change is not authorized.');
      const { data, error } = await supabase.rpc('set_default_reviewer', { p_actor_user_id: actor.id, p_target_reviewer_user_id: body.targetReviewerId, p_reason: body.reason });
      if (error) throw error;
      return json({ ok: true, ...data });
    }
    if (body.action === 'create_team_member') {
      if (!actor.capabilities.includes('can_manage_users')) throw new BasecampError(403, 'User management is not authorized.');
      const { data, error } = await supabase.rpc('create_privileged_user', {
        p_actor_user_id:actor.id,p_email:String(body.email || ''),p_role_key:String(body.role || 'reviewer'),
        p_capabilities:Array.isArray(body.capabilities) ? body.capabilities.map(String) : [],p_reason:String(body.reason || ''),
      });
      if (error) throw error;
      return json({ ok: true, ...data });
    }
    if (body.action !== 'update_team_member') throw new BasecampError(422, 'Settings action is invalid.');
    const { data: target, error: targetError } = await supabase.from('privileged_users').select('id,role_key,revision').eq('id', body.targetUserId).maybeSingle();
    if (targetError || !target) throw new BasecampError(404, 'Team member was not found.');
    const { data: targetGrants, error: targetGrantsError } = await supabase.from('privileged_user_capability_grants').select('capability_key').eq('privileged_user_id', target.id).is('revoked_at', null);
    if (targetGrantsError) throw targetGrantsError;
    const data = await manageTeamMember({
      actor, target: { ...target, capabilities: (targetGrants || []).map((grant) => grant.capability_key) }, input: body,
      persist: async (input: Record<string, unknown>) => {
        const { data: result, error } = await supabase.rpc('manage_privileged_user', {
          p_actor_user_id: input.actorId, p_target_user_id: input.targetUserId, p_expected_revision: input.expectedRevision,
          p_role_key: input.role, p_active: input.active, p_capabilities: input.capabilities, p_reason: input.reason,
        });
        if (error?.code === '40001') throw new BasecampError(409, 'This team member changed elsewhere. Refresh and try again.');
        if (error) throw error;
        return result;
      },
    });
    return json({ ok: true, ...data });
  } catch (error) { return safeError(error); }
});
