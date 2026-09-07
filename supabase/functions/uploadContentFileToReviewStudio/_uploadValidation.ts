export const MANUSCRIPT_MAX_BYTES = 1.5 * 1024 * 1024 * 1024;
export const COVER_MAX_BYTES = 50 * 1024 * 1024;

type UploadLike = {
  name: string;
  size: number;
  type: string;
};

const MANUSCRIPT_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

const COVER_TYPES: Record<string, string[]> = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".tif": ["image/tiff"],
  ".tiff": ["image/tiff"],
};

function extension(name: string): string {
  const normalized = String(name || "").trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index) : "";
}

export function validateContentUpload(fileType: string, file: UploadLike): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) return "The selected file is empty.";

  const rules = fileType === "manuscript"
    ? MANUSCRIPT_TYPES
    : fileType === "cover"
      ? COVER_TYPES
      : null;
  if (!rules) return "Invalid file_type. Use manuscript or cover.";

  const maxBytes = fileType === "manuscript" ? MANUSCRIPT_MAX_BYTES : COVER_MAX_BYTES;
  if (file.size > maxBytes) {
    return fileType === "manuscript"
      ? "Manuscript exceeds the 1.5 GB limit."
      : "Cover exceeds the 50 MB limit.";
  }

  const ext = extension(file.name);
  const allowedMimes = rules[ext];
  if (!allowedMimes) {
    return fileType === "manuscript"
      ? "Manuscript must be PDF, DOC, or DOCX."
      : "Cover must be JPG, JPEG, TIF, or TIFF.";
  }

  const mime = String(file.type || "").trim().toLowerCase().split(";", 1)[0];
  if (!mime || !allowedMimes.includes(mime)) {
    return fileType === "manuscript"
      ? "Manuscript file type does not match its extension."
      : "Cover file type does not match its extension.";
  }

  return null;
}
