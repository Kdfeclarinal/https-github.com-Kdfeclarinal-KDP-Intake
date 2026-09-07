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

export function serializePublishingRights(value) {
  if (value === 'copyright') return 'copyright_owner';
  if (value === 'public_domain') return 'public_domain';
  return '';
}
