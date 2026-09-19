import React from 'react';
import { BrandLogo } from '../bookshelf/BrandLogo.jsx';
import { canManageTeamMember, manageableCapabilities, reviewerAssignmentAction, reviewerIntervention, teamMemberDraft } from './settingsState.js';
import { userFacingError } from '../errors/userFacingError.js';

function Notice({ state, onRetry }) {
  if (!state?.message) return null;
  return <div className={`kdp-settings-notice kdp-settings-notice--${state.kind}`} role={state.kind === 'error' ? 'alert' : 'status'}><span>{state.message}</span>{state.action === 'retry' ? <button type="button" className="kdp-link-button" onClick={onRetry}>Try again</button> : state.action === 'reload' ? <button type="button" className="kdp-link-button" onClick={onRetry}>Reload</button> : null}</div>;
}

function TeamMember({ user, actor, canManage, busy, onSave }) {
  const [draft, setDraft] = React.useState(() => teamMemberDraft(user));
  React.useEffect(() => setDraft(teamMemberDraft(user)), [user]);
  const actorRole = actor.role;
  const editable = canManage && canManageTeamMember(actor, user);
  const visibleCapabilities = manageableCapabilities(actorRole);
  const toggle = (capability) => setDraft((current) => ({ ...current, capabilities: current.capabilities.includes(capability) ? current.capabilities.filter((item) => item !== capability) : [...current.capabilities, capability].sort() }));
  return <article className="kdp-settings-member">
    <div className="kdp-settings-member__identity"><strong>{user.displayName}</strong><span>{user.email || 'Email unavailable'}</span></div>
    <label><span>Role</span><select value={draft.role} disabled={!editable || busy} onChange={(event) => setDraft({ ...draft, role: event.target.value })}><option value="reviewer">Reviewer</option><option value="tech_admin">Tech Admin</option>{actorRole === 'owner' ? <option value="owner">Owner</option> : null}</select></label>
    <label className="kdp-settings-check"><input type="checkbox" checked={draft.active} disabled={!editable || busy} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Active</label>
    <fieldset disabled={!editable || busy}><legend>Capabilities</legend><div className="kdp-settings-capabilities">{visibleCapabilities.map((capability) => <label key={capability}><input type="checkbox" checked={draft.capabilities.includes(capability)} onChange={() => toggle(capability)} /> {capability.replaceAll('_', ' ')}</label>)}</div></fieldset>
    <label className="kdp-settings-reason"><span>Reason for change</span><input value={draft.reason} disabled={!editable || busy} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>
    <button type="button" className="kdp-btn kdp-btn--secondary" disabled={!editable || busy || !draft.reason.trim()} onClick={() => onSave(draft)}>{busy ? 'Saving…' : 'Save permissions'}</button>
    {!editable && canManage ? <p className="kdp-settings-hint">Only an Owner may change this account.</p> : null}
  </article>;
}

function AddTeamMember({ actorRole, busy, onCreate }) {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('reviewer');
  const [capabilities, setCapabilities] = React.useState(['can_review']);
  const [reason, setReason] = React.useState('');
  const visibleCapabilities = manageableCapabilities(actorRole);
  const toggle = (capability) => setCapabilities((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability].sort());
  return <form className="kdp-settings-add-member" onSubmit={(event) => { event.preventDefault(); onCreate({ email, role, capabilities, reason }); }}>
    <h3>Add team member</h3><p>The Google account must sign in once before it can be allowlisted.</p>
    <label><span>Google account email</span><input type="email" required value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} /></label>
    <label><span>Role</span><select value={role} disabled={busy} onChange={(event) => setRole(event.target.value)}><option value="reviewer">Reviewer</option><option value="tech_admin">Tech Admin</option>{actorRole === 'owner' ? <option value="owner">Owner</option> : null}</select></label>
    <fieldset disabled={busy}><legend>Initial capabilities</legend><div className="kdp-settings-capabilities">{visibleCapabilities.map((capability) => <label key={capability}><input type="checkbox" checked={capabilities.includes(capability)} onChange={() => toggle(capability)} /> {capability.replaceAll('_', ' ')}</label>)}</div></fieldset>
    <label><span>Required reason</span><input required value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
    <button className="kdp-btn kdp-btn--secondary" disabled={busy || !email.trim() || !reason.trim()}>{busy ? 'Adding…' : 'Add team member'}</button>
  </form>;
}

function ReviewerBasecampMapping({ reviewers, employees, mappings, busy, onSave }) {
  const [reviewerId, setReviewerId] = React.useState(reviewers[0]?.id || '');
  const mapped = (mappings || []).find((item) => item.reviewerId === reviewerId);
  const [personId, setPersonId] = React.useState(mapped?.personId || '');
  React.useEffect(() => {
    const next = (mappings || []).find((item) => item.reviewerId === reviewerId);
    setPersonId(next?.personId || '');
  }, [reviewerId, mappings]);

  if (!reviewers.length || !employees.length) {
    return <p className="kdp-settings-hint">Reviewer mapping becomes available when Basecamp has current Pre-Press members and an eligible reviewer exists.</p>;
  }

  return <form className="kdp-settings-inline kdp-settings-reviewer-mapping" onSubmit={(event) => { event.preventDefault(); onSave({ reviewerId, personId }); }}>
    <label><span>KDP reviewer</span><select value={reviewerId} disabled={busy} onChange={(event) => setReviewerId(event.target.value)}>{reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.displayName}</option>)}</select></label>
    <label><span>Basecamp person</span><select value={personId} required disabled={busy} onChange={(event) => setPersonId(event.target.value)}><option value="">Select Pre-Press member</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName}</option>)}</select></label>
    <button className="kdp-btn kdp-btn--secondary" disabled={busy || !reviewerId || !personId}>{busy ? 'Saving…' : mapped ? 'Update mapping' : 'Save mapping'}</button>
  </form>;
}

function BookAssignment({ book, users, employees, capabilities, actor, busy, onMutate }) {
  const eligibleReviewers = users.filter((user) => user.active && user.capabilities.includes('can_review'));
  const intervention = reviewerIntervention(book);
  const [reviewerId, setReviewerId] = React.useState(book.reviewerId || actor.id || '');
  const [employeeId, setEmployeeId] = React.useState(book.employeePersonId || '');
  const [reason, setReason] = React.useState('');
  const canReassignEmployee = capabilities.includes('can_manage_users') && ['owner', 'tech_admin'].includes(actor.role);
  const preSubmission = ['draft', 'EMPLOYEE_INTAKE'].includes(String(book.status));
  React.useEffect(() => { setReviewerId(book.reviewerId || actor.id || ''); setEmployeeId(book.employeePersonId || ''); setReason(''); }, [book, actor.id]);
  const reviewerAction = book.activeReview
    ? reviewerAssignmentAction(book, { ...actor, capabilities }, reviewerId)
    : preSubmission && ['owner', 'tech_admin'].includes(actor.role) && ((!book.reviewerId && capabilities.includes('can_assign_reviewer')) || (book.reviewerId && capabilities.includes('can_reassign_reviewer') && reviewerId !== book.reviewerId))
      ? 'set_override'
      : null;
  return <article className={`kdp-settings-book${intervention ? ' kdp-settings-book--attention' : ''}`}>
    <div><strong>{book.title}</strong><span>{book.status}</span>{intervention ? <em>{intervention === 'unassigned' ? 'Reviewer assignment required' : 'Current reviewer is ineligible'}</em> : null}</div>
    <div className="kdp-settings-assignment-control"><label><span>{book.activeReview ? 'Reviewer' : 'Pre-submission reviewer override'}</span><select value={reviewerId} disabled={!reviewerAction || busy} onChange={(event) => setReviewerId(event.target.value)}><option value="">Select reviewer</option>{eligibleReviewers.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label><button type="button" className="kdp-btn kdp-btn--secondary" disabled={!reviewerAction || !reviewerId || !reason.trim() || busy} onClick={() => onMutate({ action: reviewerAction, bookId: book.id, targetReviewerId: reviewerAction === 'claim' ? actor.id : reviewerId, expectedRevision: book.activeReview ? book.reviewRevision : book.reviewerAssignmentRevision, expectedReviewerUserId: book.reviewerId, reason })}>{reviewerAction === 'claim' ? 'Claim review' : reviewerAction === 'assign' || reviewerAction === 'set_override' && !book.reviewerId ? 'Assign reviewer' : 'Reassign reviewer'}</button></div>
    <div className="kdp-settings-assignment-control"><label><span>Employee</span><select value={employeeId} disabled={!canReassignEmployee || busy} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName}</option>)}</select></label><button type="button" className="kdp-btn kdp-btn--secondary" disabled={!canReassignEmployee || !employeeId || employeeId === book.employeePersonId || !reason.trim() || busy} onClick={() => onMutate({ action: 'reassign_employee', bookId: book.id, replacementEmployeePersonId: employeeId, expectedEmployeeRevision: book.employeeRevision, expectedEmployeePersonId: book.employeePersonId, reason })}>Reassign employee</button></div>
    <label className="kdp-settings-reason"><span>Required reason</span><input value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
  </article>;
}

export function SettingsPage({ context, privilegedApi, onNavigate, onSignOut }) {
  const [settings, setSettings] = React.useState(null);
  const [books, setBooks] = React.useState([]);
  const [notice, setNotice] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const load = React.useCallback(async () => {
    setNotice(null);
    try {
      const next = await privilegedApi.call('loadOperationalSettings', {});
      setSettings(next);
      if (next.capabilities.some((capability) => ['can_view_all_books', 'can_review', 'can_create_book'].includes(capability))) {
        const bookshelf = await privilegedApi.call('loadPrivilegedBookshelf', {});
        setBooks(bookshelf.books || []);
      } else setBooks([]);
    }
    catch (error) { const safe = userFacingError(error, 'Settings could not be loaded. Try again.'); setNotice({ kind: 'error', message: safe.message, action: safe.action }); }
  }, [privilegedApi]);
  React.useEffect(() => { load(); }, [load]);
  const mutate = async (functionName, body, key = body.bookId || body.targetUserId || body.action) => {
    setBusy(key); setNotice(null);
    try { const result = await privilegedApi.call(functionName, body); await Promise.all([load(), privilegedApi.refresh()]); setNotice({ kind: result.basecamp?.status === 'failed' ? 'warning' : 'success', message: result.basecamp?.status === 'failed' ? 'The KDP assignment is saved. Basecamp sync needs a retry.' : 'Changes saved.' }); }
    catch (error) { const safe = userFacingError(error, 'The change could not be saved. Try again.'); setNotice({ kind: 'error', message: safe.message, action: safe.action }); }
    finally { setBusy(null); }
  };
  const reconnect = async () => {
    setBusy('basecamp');
    try { const result = await privilegedApi.call('initiateBasecampOAuth', {}); window.location.assign(result.authorizationUrl); }
    catch (error) { const safe = userFacingError(error, 'Basecamp connection could not be started. Try again.'); setNotice({ kind: 'error', message: safe.message, action: safe.action }); setBusy(null); }
  };
  const capabilities = settings?.capabilities || context.capabilities || [];
  const reviewers = (settings?.users || []).filter((user) => user.active && user.capabilities.includes('can_review'));
  return <main className="kdp-app kdp-app--privileged kdp-settings">
    <header className="kdp-settings-header"><div><button type="button" className="kdp-back-link" onClick={() => onNavigate('bookshelf')}>← Back to Bookshelf</button><h1>Settings</h1><p>Manage publishing workflow authority and operational integrations.</p></div><BrandLogo /><div className="kdp-privileged-session"><span>{context.identity?.displayName}</span><button type="button" className="kdp-link-button" onClick={onSignOut}>Sign out</button></div></header>
    <Notice state={notice} onRetry={load} />
    {!settings ? <section className="kdp-settings-section"><p>{notice ? 'Settings could not be loaded.' : 'Loading settings…'}</p></section> : <>
      <section className="kdp-settings-section"><div className="kdp-settings-section__heading"><h2>Team &amp; Permissions</h2><p>Role labels describe responsibility. Capabilities control server-authorized actions.</p></div>{capabilities.includes('can_manage_users') ? <AddTeamMember actorRole={settings.identity.role} busy={busy === 'new-user'} onCreate={(draft) => mutate('mutateOperationalSettings', { action: 'create_team_member', ...draft }, 'new-user')} /> : null}<div className="kdp-settings-members">{settings.users.map((user) => <TeamMember key={user.id} user={user} actor={settings.identity} canManage={capabilities.includes('can_manage_users')} busy={busy === user.id} onSave={(draft) => mutate('mutateOperationalSettings', { action: 'update_team_member', targetUserId: draft.id, expectedRevision: draft.revision, role: draft.role, active: draft.active, capabilities: draft.capabilities, reason: draft.reason }, user.id)} />)}</div></section>
      <section className="kdp-settings-section"><div className="kdp-settings-section__heading"><h2>Review Defaults</h2><p>The default applies only to future submissions and never silently changes an active review.</p></div><form className="kdp-settings-inline" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); mutate('mutateOperationalSettings', { action: 'change_default_reviewer', targetReviewerId: data.get('reviewer'), reason: data.get('reason') }, 'default'); }}><label><span>Default reviewer</span><select name="reviewer" defaultValue={settings.defaultReviewerId || ''} disabled={!capabilities.includes('can_change_default_reviewer') || busy === 'default'}><option value="">Select reviewer</option>{reviewers.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}</select></label><label><span>Required reason</span><input name="reason" required disabled={!capabilities.includes('can_change_default_reviewer') || busy === 'default'} /></label><button className="kdp-btn kdp-btn--secondary" disabled={!capabilities.includes('can_change_default_reviewer') || busy === 'default'}>Save default</button></form></section>
      {books.length ? <section className="kdp-settings-section"><div className="kdp-settings-section__heading"><h2>Book Assignments</h2><p>Interventions preserve the current workflow and review round. Every change is checked and audited by the server.</p></div><div className="kdp-settings-books">{books.map((book) => <BookAssignment key={book.id} book={book} users={settings.users} employees={settings.employees || []} capabilities={capabilities} actor={settings.identity} busy={busy === book.id} onMutate={(body) => mutate('mutateBookAssignment', body, book.id)} />)}</div></section> : null}
      <section className="kdp-settings-section"><div className="kdp-settings-section__heading"><h2>Integrations</h2><p>Configuration presence is shown without exposing credentials.</p></div><div className="kdp-settings-integrations"><article><strong>Basecamp</strong><span>{settings.integrations.basecamp.status}</span><small>Pre-Press project: {settings.integrations.basecamp.projectId || 'Not configured'}</small>{capabilities.includes('can_manage_integrations') ? <button type="button" className="kdp-btn kdp-btn--secondary" disabled={busy === 'basecamp'} onClick={reconnect}>{settings.integrations.basecamp.status === 'connected' ? 'Reconnect' : 'Connect'}</button> : null}</article><article><strong>ReviewStudio</strong><span>{settings.integrations.reviewstudio.configured ? 'Configured' : 'Not configured'}</span></article><article><strong>GHL</strong><span>{settings.integrations.ghl.configured ? 'Configured' : 'Not configured'}</span></article></div>{capabilities.includes('can_manage_users') && settings.integrations.basecamp.status === 'connected' ? <div className="kdp-settings-integration-mapping"><h3>Reviewer Basecamp mapping</h3><p>Map each eligible KDP reviewer to the current Pre-Press Basecamp member who should receive Review tasks.</p><ReviewerBasecampMapping reviewers={reviewers} employees={settings.employees || []} mappings={settings.reviewerMappings || []} busy={busy === 'reviewer-mapping'} onSave={(body) => mutate('saveReviewerBasecampMapping', body, 'reviewer-mapping')} /></div> : null}</section>
    </>}
  </main>;
}
