// ============================================================
// Edge Function entrypoint for `uploadContentFileToReviewStudio`.
//
// Supabase CLI deploys the file at this path as the function's
// entry. The actual implementation — including the `Deno.serve(...)`
// registration that listens for incoming requests — lives in
// `uploadContentFileToReviewStudio_reviewstudio_flow.ts`.
//
// Importing it here is a side-effect import: when the Edge Function
// runtime loads this file, the flow file's top-level `Deno.serve(...)`
// call runs and registers the HTTP handler. There is no body to
// duplicate and no handler to re-export.
// ============================================================

import "./uploadContentFileToReviewStudio_reviewstudio_flow.ts";
