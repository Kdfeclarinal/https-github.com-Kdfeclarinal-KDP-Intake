type FileRow = Record<string, unknown>;

export function publicEmployeeFile(file: FileRow) {
  return {
    section_key: file.section_key || "",
    file_type: file.file_type || "",
    reviewstudio_file_url: file.reviewstudio_file_url || "",
    preview_url: file.preview_url || null,
    created_at: file.created_at || null,
    updated_at: file.updated_at || null,
  };
}
