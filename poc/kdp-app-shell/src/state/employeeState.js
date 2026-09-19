function hasCurrentFile(files, fileType, sectionKey) {
  return Array.isArray(files) && files.some(function (file) {
    if (!file || file.file_type !== fileType) return false;
    return !file.section_key || file.section_key === sectionKey;
  });
}

export function authoritativeContentState(state, files) {
  return Object.assign({}, state || {}, {
    manuscriptHasFile: hasCurrentFile(files, 'manuscript', 'content.manuscript'),
    coverHasFile: hasCurrentFile(files, 'cover', 'content.cover'),
  });
}

export function serializeOptionalChoice(value, allowedValues) {
  return Array.isArray(allowedValues) && allowedValues.includes(value) ? value : '';
}

export function serializeContentExtractedFields(state) {
  const content = state || {};
  const drm = content.drmChoice === 'yes'
    ? 'yes_apply_drm'
    : content.drmChoice === 'no'
      ? 'no_do_not_apply_drm'
      : null;
  const coverOption = content.coverOption === 'upload'
    ? 'upload_cover_file'
    : content.coverOption === 'cover_creator'
      ? 'cover_creator'
      : null;

  const aiAnswer = content.aiChoice === 'yes' || content.aiChoice === 'no'
    ? content.aiChoice
    : null;
  const aiGeneratedContent = aiAnswer === 'yes'
    ? {
        answer: 'yes',
        texts: content.aiTexts || '',
        images: content.aiImages || '',
        translations: content.aiTranslations || '',
      }
    : aiAnswer === 'no'
      ? { answer: 'no', texts: null, images: null, translations: null }
      : null;

  return {
    drm,
    cover_option: coverOption,
    ai_generated_content: aiGeneratedContent,
    accessibility: typeof content.accessibleImages === 'string' && content.accessibleImages
      ? content.accessibleImages
      : null,
  };
}

export function serializePublishingRights(value) {
  if (value === 'copyright') return 'copyright_owner';
  if (value === 'public_domain') return 'public_domain';
  return '';
}
