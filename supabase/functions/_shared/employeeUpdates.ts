type Row = Record<string, any>

const localSectionKey = (value: unknown) => String(value || '').replace(/^[^.]+\./, '')

export function sanitizeEmployeeUpdateContext({ roundNumber, step, items, comments }: Row) {
  const requested = (items || []).filter((item: Row) => item.step_name === step && item.decision === 'needs_updates')
  const requestedIds = new Set(requested.map((item: Row) => item.id))
  return {
    roundNumber: Number(roundNumber) || 1,
    editableSectionKeys: requested.map((item: Row) => localSectionKey(item.section_key)),
    threads: (comments || []).filter((comment: Row) => requestedIds.has(comment.review_item_id) && comment.actionable !== false && !comment.parent_comment_id && !comment.deleted_at).map((comment: Row) => ({
      id: comment.id,
      itemId: comment.review_item_id,
      sectionKey: localSectionKey(requested.find((item: Row) => item.id === comment.review_item_id)?.section_key),
      number: comment.round_comment_number || null,
      body: String(comment.body || comment.comment_text || ''),
      createdAt: comment.created_at || null,
      readyForRereview: Boolean(comment.ready_for_rereview),
    })),
  }
}
