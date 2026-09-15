const VALID_DECISIONS = new Set(['pending', 'approved', 'needs_updates']);

function decisionOf(item) {
  const value = String(item?.decision || item?.status || 'pending').toLowerCase();
  return VALID_DECISIONS.has(value) ? value : 'pending';
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberComments(comments) {
  let next = 1;
  const byItem = new Map();
  return comments.map((comment) => {
    const itemId = comment.itemId || comment.review_item_id || null;
    const actionable = Boolean(itemId) && comment.actionable !== false;
    let issueNumber = null;
    if (actionable) {
      if (!byItem.has(itemId)) byItem.set(itemId, next++);
      issueNumber = byItem.get(itemId);
    }
    return {
      id: comment.id || `local-${crypto.randomUUID?.() || `${Date.now()}-${next}`}`,
      itemId,
      parentCommentId: comment.parentCommentId || comment.parent_comment_id || null,
      body: String(comment.body || comment.comment_text || comment.comment || ''),
      author: String(comment.author || comment.admin_name || 'Reviewer'),
      createdAt: comment.createdAt || comment.created_at || new Date().toISOString(),
      actionable,
      resolved: Boolean(comment.resolved),
      resolvedAt: comment.resolvedAt || comment.resolved_at || null,
      editedAt: comment.editedAt || comment.edited_at || null,
      authorActorType: comment.authorActorType || comment.author_actor_type || 'privileged',
      continuation: comment.continuation || null,
      issueNumber: comment.issueNumber || comment.round_comment_number || issueNumber,
      persisted: comment.persisted !== false,
    };
  });
}

export function createReviewDraft(payload, step) {
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .filter((item) => item.step === step || item.step_name === step)
    .map((item) => ({
      ...item,
      step: item.step || item.step_name,
      sectionKey: item.sectionKey || item.section_key,
      label: item.label || item.section_label || 'Review section',
      decision: decisionOf(item),
      snapshot: item.snapshot || item.section_snapshot || {},
    }));
  return {
    step,
    items,
    decisions: Object.fromEntries(items.map((item) => [item.id, item.decision])),
    comments: numberComments(Array.isArray(payload?.comments) ? payload.comments : []),
    dirty: false,
  };
}

export function setReviewDecision(draft, itemId, decision) {
  if (!draft?.decisions || !Object.hasOwn(draft.decisions, itemId) || !VALID_DECISIONS.has(decision)) return draft;
  if (draft.decisions[itemId] === decision) return draft;
  return { ...draft, decisions: { ...draft.decisions, [itemId]: decision }, dirty: true };
}

export function addReviewComment(draft, input) {
  const itemId = input?.itemId || null;
  const comment = {
    id: `local-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${draft.comments.length}`}`,
    itemId,
    body: String(input?.body || '').trim(),
    author: String(input?.author || 'Reviewer'),
    createdAt: new Date().toISOString(),
    actionable: Boolean(itemId),
    persisted: false,
  };
  if (!comment.body) return draft;
  const comments = numberComments([...draft.comments, comment]);
  const decisions = itemId && Object.hasOwn(draft.decisions, itemId)
    ? { ...draft.decisions, [itemId]: 'needs_updates' }
    : draft.decisions;
  return { ...draft, comments, decisions, dirty: true };
}

export function filterReviewComments(comments, options = {}) {
  const query = String(options.query || '').trim().toLocaleLowerCase();
  const direction = options.sort === 'oldest' ? 1 : -1;
  return (Array.isArray(comments) ? comments : [])
    .filter((comment) => !query || String(comment.body || '').toLocaleLowerCase().includes(query))
    .toSorted((a, b) => direction * (timestamp(a.createdAt) - timestamp(b.createdAt)));
}

export function reviewPageProgress(items, step) {
  const pageItems = (Array.isArray(items) ? items : []).filter((item) => (item.step || item.step_name) === step);
  if (!pageItems.length) return 'locked';
  return pageItems.every((item) => decisionOf(item) !== 'pending') ? 'complete' : 'in_progress';
}

const REVIEW_STEPS = ['details', 'content', 'pricing'];

export function reviewStepAccessible(items, step, reachedSteps = []) {
  const targetIndex = REVIEW_STEPS.indexOf(step);
  if (targetIndex < 0) return false;
  if (targetIndex === 0 || (Array.isArray(reachedSteps) && reachedSteps.includes(step))) return true;
  return REVIEW_STEPS.slice(0, targetIndex).every((priorStep) => {
    const priorItems = (Array.isArray(items) ? items : []).filter((item) => (item.step || item.step_name) === priorStep);
    return priorItems.length > 0 && priorItems.every((item) => decisionOf(item) !== 'pending');
  });
}

export function reviewIssueNumber(comments, itemId) {
  return numberComments(Array.isArray(comments) ? comments : []).find((comment) => comment.itemId === itemId)?.issueNumber || null;
}

export function reviewMutationControlsVisible(payload) {
  return !payload?.reviewRound?.finalizedAt && payload?.permissions?.canMutate === true;
}
