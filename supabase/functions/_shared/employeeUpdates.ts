type Row = Record<string, any>

const localSectionKey = (value: unknown) => String(value || '').replace(/^[^.]+\./, '')

function normalized(value: any): any {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(normalized)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]))
  }
  return value ?? null
}

function fileIdentity(row: Row) {
  return {
    id: row.id || null,
    version_number: row.version_number ?? row.versionNumber ?? null,
    reviewstudio_file_id: row.reviewstudio_file_id || row.reviewStudioFileId || null,
    reviewstudio_review_id: row.reviewstudio_review_id || row.reviewStudioReviewId || null,
  }
}

function normalizedFiles(files: Row[] = []) {
  return files.map(fileIdentity).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

export function deriveReadyForRereview({ baselineValue, currentValue, baselineFiles = [], currentFiles = [], replies = [], requestedAt }: Row) {
  const viaChange = JSON.stringify(normalized(baselineValue)) !== JSON.stringify(normalized(currentValue))
  const viaFileChange = JSON.stringify(normalizedFiles(baselineFiles)) !== JSON.stringify(normalizedFiles(currentFiles))
  const requestedTime = Date.parse(String(requestedAt || '')) || 0
  const viaReply = replies.some((reply: Row) => (Date.parse(String(reply.created_at || reply.createdAt || '')) || 0) > requestedTime)
  return { ready: viaReply || viaChange || viaFileChange, viaReply, viaChange, viaFileChange }
}

export function sanitizeEmployeeUpdateContext({ updateCycleId, roundNumber, step, items, comments, threads, replies, currentSections = {}, currentFiles = [] }: Row) {
  const requested = (items || []).filter((item: Row) => item.step_name === step && item.decision === 'needs_updates')
  const requestedIds = new Set(requested.map((item: Row) => item.id))
  const continuationThreads = Array.isArray(threads)
    ? threads.filter((thread: Row) => thread.step_name === step && requestedIds.has(thread.source_item_id) && thread.status === 'active')
    : (comments || []).filter((comment: Row) => requestedIds.has(comment.review_item_id) && comment.actionable !== false && !comment.parent_comment_id && !comment.deleted_at).map((comment: Row) => ({
        id: comment.id,
        source_item_id: comment.review_item_id,
        source_comment_id: comment.id,
        section_key: requested.find((item: Row) => item.id === comment.review_item_id)?.section_key,
        request_body_snapshot: comment.body || comment.comment_text,
        request_number_snapshot: comment.round_comment_number,
        requested_at: comment.created_at,
        baseline_value: comment.baseline_value,
        baseline_file_references: comment.baseline_file_references || [],
      }))

  return {
    updateCycleId: updateCycleId || null,
    roundNumber: Number(roundNumber) || 1,
    editableSectionKeys: requested.map((item: Row) => localSectionKey(item.section_key)),
    threads: continuationThreads.map((thread: Row) => {
      const sectionKey = localSectionKey(thread.section_key)
      const threadReplies = (replies || []).filter((reply: Row) => reply.update_thread_id === thread.id)
      const sectionFiles = (currentFiles || []).filter((file: Row) => {
        const fileSection = String(file.section_key || file.sectionKey || file.file_type || file.fileType || '')
        return fileSection === thread.section_key || fileSection === sectionKey
      })
      const readiness = deriveReadyForRereview({
        baselineValue: thread.baseline_value,
        currentValue: currentSections[thread.section_key] ?? currentSections[sectionKey] ?? null,
        baselineFiles: thread.baseline_file_references || [],
        currentFiles: sectionFiles,
        replies: threadReplies,
        requestedAt: thread.requested_at,
      })
      return {
        id: thread.source_comment_id,
        continuationId: thread.id,
        sourceCommentId: thread.source_comment_id,
        itemId: thread.source_item_id,
        sectionKey,
        number: thread.request_number_snapshot || null,
        body: String(thread.request_body_snapshot || ''),
        createdAt: thread.requested_at || null,
        replies: threadReplies.map((reply: Row) => ({
          id: reply.id,
          body: String(reply.body || ''),
          author: String(reply.author_name_snapshot || 'Employee'),
          createdAt: reply.created_at || null,
        })),
        readyForRereview: readiness.ready,
        readiness: { viaReply: readiness.viaReply, viaChange: readiness.viaChange, viaFileChange: readiness.viaFileChange },
      }
    }),
  }
}
