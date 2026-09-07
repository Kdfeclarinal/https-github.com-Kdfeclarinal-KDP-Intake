type PublicResponseInput = {
  cleanupPending?: unknown;
};

export function publicFirstUploadResponse(input: PublicResponseInput & Record<string, unknown>) {
  void input;
  return {
    ok: true,
    operation: "upload",
  };
}

export function publicReplacementResponse(
  input: PublicResponseInput & Record<string, unknown>,
) {
  return {
    ok: true,
    operation: "replace",
    cleanup_pending: !!input.cleanupPending,
  };
}

export function publicUploadError(status: number, message: string): string {
  if (status === 400) return message || "Invalid upload request.";
  if (status === 401 || status === 403) return "This upload is not authorized.";
  if (status === 409) return "This file cannot be changed in the book's current state.";
  return "The file could not be uploaded. Please try again later.";
}
