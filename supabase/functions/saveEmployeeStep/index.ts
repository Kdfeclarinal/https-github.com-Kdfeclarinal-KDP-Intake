// ============================================================
// ======= KDP - SAVE EMPLOYEE STEP EDGE FUNCTION =======
// Function: saveEmployeeStep
//
// Server-authoritative workflow rules:
// - The browser may send page data, but it may NOT replace the whole
//   workflow progress object.
// - Save as Draft records save_type = "draft".
// - A previously completed step stays complete when the newly saved
//   data is still valid.
// - If required data is removed, the current step becomes incomplete.
// - Previously unlocked later steps stay unlocked.
// - Save and Continue marks the current step complete only when the
//   current saved data passes server-side validation.
// - Final submission must rely on is_complete + current saved data,
//   not save_type.
// - This function does NOT create books, review rounds, or review items.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { validatePricingContract } from "./_pricingValidation.js";
import {
  isEmployeeEditableBookStatus,
  isEmployeeStepUnlocked,
  isUnexpiredTokenExpiry,
} from "../_shared/workflowStatus.mjs";
import {
  assertEmployeeUpdateExtractedFields,
  assertEmployeeUpdateSections,
} from "../_shared/adminReviewWorkflow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const STEP_ORDER = ["details", "content", "pricing"] as const;

type StepName = (typeof STEP_ORDER)[number];
type SaveType = "draft" | "complete";
type StepStatus = "locked" | "not_started" | "in_progress" | "complete";

type ProgressStep = {
  status: StepStatus;
  isUnlocked: boolean;
  isComplete: boolean;
};

type ProgressState = {
  activeStep: StepName;
  steps: Record<StepName, ProgressStep>;
};

type JsonObject = Record<string, unknown>;

type StepRow = {
  id?: string;
  book_id?: string;
  step_name?: StepName;
  save_type?: string;
  step_status?: string;
  is_complete?: boolean;
  is_unlocked?: boolean;
  state_json?: JsonObject | null;
  extracted_fields?: JsonObject | null;
  validation_required_keys?: string[] | null;
  validation_errors?: JsonObject | null;
  metadata?: JsonObject | null;
  saved_at?: string | null;
};

type ValidationResult = {
  valid: boolean;
  requiredKeys: string[];
  errors: Record<string, string>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true }, 200);
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          ok: false,
          error: "Missing Supabase server environment variables."
        },
        500
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false
      }
    });

    const rawPayload = await req.json().catch(() => null);
    const payload = asObject(rawPayload);

    const bookId = cleanText(payload.book_id);
    const accessToken = cleanText(payload.access_token);
    const stepName = cleanText(payload.step_name) as StepName;
    const saveType = cleanText(payload.save_type || "draft") as SaveType;
    const stateJson = asObject(payload.state_json);
    const extractedFields = normalizeExtractedFields(
      asObject(payload.extracted_fields)
    );
    const source = cleanText(payload.source || "ghl_employee_page").slice(0, 120);
    const expectedRevision = Number(payload.expected_revision);

    if (!bookId) {
      return jsonResponse({ ok: false, error: "Missing book_id." }, 400);
    }

    if (!accessToken) {
      return jsonResponse({ ok: false, error: "Missing access_token." }, 400);
    }

    if (!isStepName(stepName)) {
      return jsonResponse({ ok: false, error: "Invalid step_name." }, 400);
    }

    if (!isSaveType(saveType)) {
      return jsonResponse({ ok: false, error: "Invalid save_type." }, 400);
    }

    if (payload.expected_revision == null || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return jsonResponse({ ok: false, error: "Missing or invalid expected_revision." }, 400);
    }

    const tokenHash = await sha256Hex(accessToken);

    const { data: tokenRow, error: tokenError } = await supabase
      .from("book_access_tokens")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (tokenError) {
      throw tokenError;
    }

    if (!tokenRow) {
      return jsonResponse({ ok: false, error: "Invalid access token." }, 403);
    }

    if (tokenRow.role !== "employee") {
      return jsonResponse(
        { ok: false, error: "Access token is not an employee token." },
        403
      );
    }

    if (tokenRow.revoked_at) {
      return jsonResponse(
        { ok: false, error: "Access token has been revoked." },
        403
      );
    }

    if (!isUnexpiredTokenExpiry(tokenRow.expires_at)) {
      return jsonResponse(
        { ok: false, error: "Access token has expired or is invalid." },
        403
      );
    }

    if (!tokenRow.book_id) {
      return jsonResponse(
        {
          ok: false,
          error: "A book-specific employee token is required to save a step."
        },
        403
      );
    }

    if (String(tokenRow.book_id) !== String(bookId)) {
      return jsonResponse(
        { ok: false, error: "Access token does not match this book." },
        403
      );
    }

    if (!tokenAllowsPage(tokenRow.allowed_pages, stepName)) {
      return jsonResponse(
        { ok: false, error: "Access token does not allow this page." },
        403
      );
    }

    const requiredAction =
      saveType === "complete"
        ? "complete_employee_step"
        : "save_employee_step";

    if (!tokenAllowsAction(tokenRow.allowed_actions, requiredAction)) {
      return jsonResponse(
        { ok: false, error: "Access token does not allow this action." },
        403
      );
    }

    const { data: bookRow, error: bookError } = await supabase
      .from("books")
      .select(
        [
          "id",
          "overall_status",
          "current_employee_step",
          "progress_state",
          "latest_review_round_id",
          "deleted_at",
          "book_title",
          "subtitle",
          "primary_author_name",
          "primary_marketplace",
          "employee_revision"
        ].join(",")
      )
      .eq("id", bookId)
      .maybeSingle();

    if (bookError) {
      throw bookError;
    }

    if (!bookRow || bookRow.deleted_at) {
      return jsonResponse({ ok: false, error: "Book not found." }, 404);
    }

    if (!isEmployeeEditableBookStatus(bookRow.overall_status)) {
      return jsonResponse(
        {
          ok: false,
          error: "This book is not currently editable by an employee."
        },
        409
      );
    }

    const { data: stepRowsData, error: stepRowsError } = await supabase
      .from("book_step_data")
      .select("*")
      .eq("book_id", bookId);

    if (stepRowsError) {
      throw stepRowsError;
    }

    const stepRows = Array.isArray(stepRowsData)
      ? (stepRowsData as StepRow[])
      : [];

    const stepMap = makeStepMap(stepRows);
    const existingStepRow = stepMap[stepName] || null;

    if (["needs_updates", "EMPLOYEE_UPDATES"].includes(String(bookRow.overall_status))) {
      const { data: editableItems, error: editableError } = await supabase
        .from("book_review_items")
        .select("section_key")
        .eq("review_round_id", bookRow.latest_review_round_id)
        .eq("step_name", stepName)
        .eq("decision", "needs_updates");
      if (editableError) throw editableError;
      try {
        const editableSectionKeys = (editableItems || []).map((item) => String(item.section_key));
        assertEmployeeUpdateSections(
          asObject(existingStepRow?.state_json),
          stateJson,
          editableSectionKeys
        );
        assertEmployeeUpdateExtractedFields(
          asObject(existingStepRow?.extracted_fields),
          extractedFields,
          editableSectionKeys,
          stepName
        );
      } catch {
        return jsonResponse({ ok: false, error: "Approved sections are locked during employee updates." }, 403);
      }
    }

    if (!isEmployeeStepUnlocked(stepName, bookRow, existingStepRow)) {
      return jsonResponse(
        { ok: false, error: "This employee step is not unlocked." },
        403
      );
    }

    let contentFiles: JsonObject[] = [];

    if (stepName === "content") {
      const { data: filesData, error: filesError } = await supabase
        .from("book_files")
        .select(
          [
            "id",
            "book_id",
            "step_name",
            "section_key",
            "file_kind",
            "file_type",
            "is_latest",
            "file_status",
            "file_name",
            "reviewstudio_project_id",
            "reviewstudio_review_id",
            "reviewstudio_file_id",
            "reviewstudio_file_url",
            "download_url"
          ].join(",")
        )
        .eq("book_id", bookId)
        .eq("is_latest", true);

      if (filesError) {
        throw filesError;
      }

      contentFiles = Array.isArray(filesData)
        ? filesData.map((row) => asObject(row))
        : [];
    }

    const validation = validateStepData(
      stepName,
      stateJson,
      extractedFields,
      contentFiles,
      cleanText(bookRow.primary_marketplace)
    );

    const authoritativeProgress = buildAuthoritativeProgressState(
      asObject(bookRow.progress_state),
      stepMap,
      bookRow.current_employee_step
    );

    const previouslyComplete = existingStepRow
      ? existingStepRow.is_complete === true
      : authoritativeProgress.steps[stepName].isComplete === true;

    /*
     * Save and Continue is allowed to complete a step only when the
     * server validates the current data. Do not trust the browser's
     * progress object or save_type alone.
     */
    if (saveType === "complete" && !validation.valid) {
      return jsonResponse(
        {
          ok: false,
          error: "Complete the required fields before continuing.",
          book_id: bookId,
          step_name: stepName,
          save_type: saveType,
          is_complete: false,
          validation_errors: validation.errors,
          validation_required_keys: validation.requiredKeys
        },
        422
      );
    }

    /*
     * Draft behavior:
     * - Never-completed step -> remains incomplete.
     * - Previously completed + still valid -> remains complete.
     * - Previously completed + now invalid -> becomes incomplete.
     *
     * Complete behavior:
     * - Valid data -> complete.
     */
    const resultingComplete =
      saveType === "complete"
        ? true
        : previouslyComplete && validation.valid;

    const resultingStatus: StepStatus = resultingComplete
      ? "complete"
      : "in_progress";

    const now = new Date().toISOString();
    const nextStepName = getNextStepName(stepName);

    const nextProgress = applyCurrentSaveToProgress({
      progress: authoritativeProgress,
      currentStep: stepName,
      resultingComplete,
      requestedSaveType: saveType,
      nextStep: nextStepName,
      existingCurrentEmployeeStep: normalizeStepName(
        bookRow.current_employee_step
      )
    });

    const existingMetadata = asObject(existingStepRow?.metadata);

    const stepDataRow = {
      book_id: bookId,
      step_name: stepName,
      step_label: getStepLabel(stepName),

      // Save type records the button/action used. It does not decide completion.
      save_type: saveType,
      step_status: resultingStatus,
      is_complete: resultingComplete,
      is_unlocked: true,

      state_json: stateJson,
      extracted_fields: extractedFields,
      validation_required_keys: validation.requiredKeys,
      validation_errors: validation.errors,

      saved_by_name: tokenRow.employee_name || null,
      saved_by_email: tokenRow.employee_email || null,
      saved_at: now,

      metadata: {
        ...existingMetadata,
        last_save_source: source,
        last_requested_save_type: saveType,
        last_resulting_is_complete: resultingComplete,
        last_data_valid: validation.valid
      }
    };

    const bookUpdate: Record<string, unknown> = {
      progress_state: nextProgress,
      current_employee_step: nextProgress.activeStep,
      last_saved_at: now,
      last_modified_at: now,
      updated_at: now
    };

    /*
     * Details owns the quick searchable columns on books.
     * Content and Pricing saves must never blank them.
     */
    if (stepName === "details") {
      if (hasOwn(extractedFields, "book_title")) {
        bookUpdate.book_title = nullableText(extractedFields.book_title);
      }

      if (hasOwn(extractedFields, "subtitle")) {
        bookUpdate.subtitle = nullableText(extractedFields.subtitle);
      }

      if (hasOwn(extractedFields, "primary_author_name")) {
        bookUpdate.primary_author_name = nullableText(
          extractedFields.primary_author_name
        );
      }

      if (hasOwn(extractedFields, "primary_marketplace")) {
        bookUpdate.primary_marketplace = nullableText(
          extractedFields.primary_marketplace
        );
      }
    }

    const completionWasPreserved =
      saveType === "draft" && previouslyComplete && resultingComplete;

    const completionWasRemoved =
      saveType === "draft" && previouslyComplete && !resultingComplete;

    const historyAction = completionWasRemoved
      ? "step_marked_incomplete"
      : saveType === "complete"
        ? "step_completed"
        : "draft_saved";

    const historyNote = completionWasRemoved
      ? `${getStepLabel(stepName)} draft saved; required data is now incomplete.`
      : completionWasPreserved
        ? `${getStepLabel(stepName)} draft saved; completed status preserved.`
        : saveType === "complete"
          ? `${getStepLabel(stepName)} completed from GHL intake.`
          : `${getStepLabel(stepName)} draft saved from GHL intake.`;

    const historyRow = {
      action: historyAction,
      actor_name: tokenRow.employee_name || null,
      actor_email: tokenRow.employee_email || null,
      note: historyNote,
      metadata: {
        source,
        requested_save_type: saveType,
        previously_complete: previouslyComplete,
        resulting_complete: resultingComplete,
        completion_preserved: completionWasPreserved,
        completion_removed: completionWasRemoved,
        data_valid: validation.valid,
        validation_errors: validation.errors,
        progress_state: nextProgress
      }
    };

    const { data: committed, error: commitError } = await supabase.rpc(
      "save_employee_step_if_revision",
      {
        p_book_id: bookId,
        p_token_hash: tokenHash,
        p_expected_revision: expectedRevision,
        p_step_name: stepName,
        p_save_type: saveType,
        p_step_data: stepDataRow,
        p_next_step_name: resultingComplete ? nextStepName : null,
        p_next_progress: nextProgress,
        p_book_patch: bookUpdate,
        p_history: historyRow
      }
    );
    if (commitError) {
      if (commitError.code === "40001") {
        return jsonResponse({ ok: false, error: "This book changed elsewhere. Reload and try again." }, 409);
      }
      throw commitError;
    }

    return jsonResponse(
      {
        ok: true,
        book_id: bookId,
        step_name: stepName,
        save_type: saveType,
        step_status: resultingStatus,
        is_complete: resultingComplete,
        is_unlocked: true,
        data_valid: validation.valid,
        validation_errors: validation.errors,
        validation_required_keys: validation.requiredKeys,
        completion_preserved: completionWasPreserved,
        completion_removed: completionWasRemoved,
        progress_state: nextProgress,
        next_step_name:
          saveType === "complete" && resultingComplete
            ? nextStepName
            : null,
        saved_at: now,
        employee_revision: Number(committed?.employee_revision)
      },
      200
    );
  } catch (error) {
    console.error("[saveEmployeeStep] Failed:", error);

    return jsonResponse(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unknown server error."
      },
      500
    );
  }
});

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function nullableText(value: unknown): string | null {
  const text = cleanText(value);
  return text ? text : null;
}

function hasOwn(object: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isStepName(value: string): value is StepName {
  return STEP_ORDER.includes(value as StepName);
}

function isSaveType(value: string): value is SaveType {
  return value === "draft" || value === "complete";
}

function normalizeStepName(value: unknown): StepName {
  const normalized = cleanText(value);
  return isStepName(normalized) ? normalized : "details";
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => cleanText(item)).filter(Boolean);
      }
    } catch (_error) {
      const single = cleanText(value);
      return single ? [single] : [];
    }
  }

  return [];
}

function tokenAllowsAction(allowedActions: unknown, action: string): boolean {
  const actions = parseStringArray(allowedActions);
  return actions.includes(action) || actions.includes("*");
}

function tokenAllowsPage(allowedPages: unknown, stepName: StepName): boolean {
  const pages = parseStringArray(allowedPages);

  // An empty page list means no page-level restriction was configured.
  if (pages.length === 0) return true;

  return (
    pages.includes(stepName) ||
    pages.includes("employee_intake") ||
    pages.includes("*")
  );
}

function getStepLabel(stepName: StepName): string {
  if (stepName === "details") return "Kindle eBook Details";
  if (stepName === "content") return "Kindle eBook Content";
  return "Kindle eBook Pricing";
}

function getNextStepName(stepName: StepName): StepName | null {
  const index = STEP_ORDER.indexOf(stepName);
  return index >= 0 && index < STEP_ORDER.length - 1
    ? STEP_ORDER[index + 1]
    : null;
}

function getCanonicalRequiredKeys(stepName: StepName): string[] {
  if (stepName === "details") {
    return [
      "book_title",
      "primary_author",
      "description",
      "publishing_rights",
      "categories"
    ];
  }

  if (stepName === "content") {
    return [
      "content.manuscript",
      "content.drm",
      "content.cover",
      "content.accessibility"
    ];
  }

  return [
    "pricing.territories",
    "pricing.primary_marketplace",
    "pricing.royalty_and_pricing"
  ];
}

function makeStepMap(
  rows: StepRow[]
): Partial<Record<StepName, StepRow>> {
  const map: Partial<Record<StepName, StepRow>> = {};

  rows.forEach((row) => {
    const stepName = cleanText(row.step_name);
    if (isStepName(stepName)) {
      map[stepName] = row;
    }
  });

  return map;
}

function normalizeStepStatus(
  value: unknown,
  isUnlocked: boolean,
  isComplete: boolean
): StepStatus {
  if (isComplete) return "complete";
  if (!isUnlocked) return "locked";

  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "in_progress") return "in_progress";
  if (normalized === "not_started") return "not_started";

  return "not_started";
}

function getDefaultProgressState(): ProgressState {
  return {
    activeStep: "details",
    steps: {
      details: {
        status: "in_progress",
        isUnlocked: true,
        isComplete: false
      },
      content: {
        status: "locked",
        isUnlocked: false,
        isComplete: false
      },
      pricing: {
        status: "locked",
        isUnlocked: false,
        isComplete: false
      }
    }
  };
}

function readProgressStep(
  rawProgress: JsonObject,
  stepName: StepName
): JsonObject {
  const steps = asObject(rawProgress.steps);
  return asObject(steps[stepName]);
}

function buildAuthoritativeProgressState(
  rawProgress: JsonObject,
  stepMap: Partial<Record<StepName, StepRow>>,
  currentEmployeeStep: unknown
): ProgressState {
  const fallback = getDefaultProgressState();
  const state: ProgressState = {
    activeStep: normalizeStepName(
      rawProgress.activeStep ||
        rawProgress.active_step ||
        currentEmployeeStep ||
        fallback.activeStep
    ),
    steps: {
      details: { ...fallback.steps.details },
      content: { ...fallback.steps.content },
      pricing: { ...fallback.steps.pricing }
    }
  };

  STEP_ORDER.forEach((stepName) => {
    const row = stepMap[stepName];
    const progressStep = readProgressStep(rawProgress, stepName);

    const rowExists = Boolean(row);

    const isComplete = rowExists
      ? row?.is_complete === true
      : progressStep.isComplete === true ||
        progressStep.is_complete === true ||
        cleanText(progressStep.status) === "complete";

    const progressUnlocked =
      progressStep.isUnlocked === true || progressStep.is_unlocked === true;

    const isUnlocked =
      stepName === "details"
        ? true
        : rowExists
          ? row?.is_unlocked === true || isComplete || progressUnlocked
          : progressUnlocked || isComplete;

    const statusSource = rowExists
      ? row?.step_status
      : progressStep.status || progressStep.step_status;

    state.steps[stepName] = {
      isComplete,
      isUnlocked,
      status: normalizeStepStatus(statusSource, isUnlocked, isComplete)
    };
  });

  // Dependencies may unlock later steps, but never relock anything.
  if (state.steps.details.isComplete) {
    state.steps.content.isUnlocked = true;
  }

  if (state.steps.content.isComplete) {
    state.steps.pricing.isUnlocked = true;
  }

  STEP_ORDER.forEach((stepName) => {
    const step = state.steps[stepName];
    step.status = normalizeStepStatus(
      step.status,
      step.isUnlocked,
      step.isComplete
    );
  });

  return state;
}

function furthestStep(a: StepName, b: StepName): StepName {
  return STEP_ORDER.indexOf(a) >= STEP_ORDER.indexOf(b) ? a : b;
}

function applyCurrentSaveToProgress(args: {
  progress: ProgressState;
  currentStep: StepName;
  resultingComplete: boolean;
  requestedSaveType: SaveType;
  nextStep: StepName | null;
  existingCurrentEmployeeStep: StepName;
}): ProgressState {
  const next: ProgressState = JSON.parse(JSON.stringify(args.progress));

  next.steps[args.currentStep].isUnlocked = true;
  next.steps[args.currentStep].isComplete = args.resultingComplete;
  next.steps[args.currentStep].status = args.resultingComplete
    ? "complete"
    : "in_progress";

  if (args.resultingComplete && args.nextStep) {
    next.steps[args.nextStep].isUnlocked = true;

    if (!next.steps[args.nextStep].isComplete) {
      const currentStatus = next.steps[args.nextStep].status;
      next.steps[args.nextStep].status =
        currentStatus === "locked" || currentStatus === "not_started"
          ? "in_progress"
          : currentStatus;
    }
  }

  // A draft save never moves the workflow backward.
  if (
    args.requestedSaveType === "complete" &&
    args.resultingComplete &&
    args.nextStep
  ) {
    next.activeStep = furthestStep(
      args.existingCurrentEmployeeStep,
      args.nextStep
    );
  } else {
    next.activeStep = args.existingCurrentEmployeeStep;
  }

  // Preserve all existing unlocks and derive any new unlocks.
  next.steps.details.isUnlocked = true;

  if (next.steps.details.isComplete) {
    next.steps.content.isUnlocked = true;
  }

  if (next.steps.content.isComplete) {
    next.steps.pricing.isUnlocked = true;
  }

  STEP_ORDER.forEach((stepName) => {
    const step = next.steps[stepName];
    step.status = normalizeStepStatus(
      step.status,
      step.isUnlocked,
      step.isComplete
    );
  });

  return next;
}

function normalizeExtractedFields(fields: JsonObject): JsonObject {
  const normalized: JsonObject = {
    ...fields
  };

  [
    "book_title",
    "subtitle",
    "primary_author_name",
    "primary_marketplace"
  ].forEach((key) => {
    if (hasOwn(fields, key)) {
      normalized[key] = nullableText(fields[key]);
    }
  });

  return normalized;
}

function validateStepData(
  stepName: StepName,
  stateJson: JsonObject,
  extractedFields: JsonObject,
  contentFiles: JsonObject[],
  authoritativePrimaryMarketplace: string
): ValidationResult {
  if (stepName === "details") {
    return validateDetailsData(stateJson, extractedFields);
  }

  if (stepName === "content") {
    return validateContentData(extractedFields, contentFiles);
  }

  return validatePricingData(stateJson, authoritativePrimaryMarketplace);
}

function getSection(stateJson: JsonObject, key: string): JsonObject {
  const sections = asObject(stateJson.sections);
  return asObject(sections[key]);
}

function getSectionValue(stateJson: JsonObject, key: string): unknown {
  return getSection(stateJson, key).value;
}

function validateDetailsData(
  stateJson: JsonObject,
  extractedFields: JsonObject
): ValidationResult {
  const errors: Record<string, string> = {};
  const requiredKeys = getCanonicalRequiredKeys("details");

  const title =
    cleanText(getSectionValue(stateJson, "book_title")) ||
    cleanText(extractedFields.book_title);

  const primaryAuthor =
    cleanText(getSectionValue(stateJson, "primary_author")) ||
    cleanText(extractedFields.primary_author_name);

  const descriptionValue = getSectionValue(stateJson, "description");
  const descriptionObject = asObject(descriptionValue);
  const description =
    cleanText(descriptionObject.text) ||
    (typeof descriptionValue === "string" ? cleanText(descriptionValue) : "");

  const publishingRights = cleanText(
    getSectionValue(stateJson, "publishing_rights")
  );

  const categoriesValue = asObject(
    getSectionValue(stateJson, "categories")
  );
  const categorySelections = Array.isArray(categoriesValue.selections)
    ? categoriesValue.selections
    : [];

  if (!title) {
    errors.book_title = "Enter a title.";
  }

  if (!primaryAuthor) {
    errors.primary_author = "Add the author's name.";
  }

  if (!description || description.length > 4000) {
    errors.description = "Enter a description of 4,000 characters or fewer.";
  }

  if (!publishingRights) {
    errors.publishing_rights = "Enter a selection for publishing rights.";
  }

  if (categorySelections.length === 0) {
    errors.categories = "Add a category for your book.";
  }

  const preorderValue = asObject(getSectionValue(stateJson, "preorder"));
  const releaseMode = cleanText(
    preorderValue.releaseMode || preorderValue.release_mode || "release_now"
  );
  const releaseDate = cleanText(
    preorderValue.releaseDateGMT ||
      preorderValue.release_date_gmt ||
      preorderValue.releaseDate ||
      preorderValue.release_date
  );

  if (releaseMode === "preorder" && !releaseDate) {
    errors.preorder = "Release date is required when Pre-order is selected.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    requiredKeys,
    errors
  };
}

function hasStoredFileMetadata(value: unknown): boolean {
  const object = asObject(value);
  const nested = asObject(object.metadata);
  const coverFile = asObject(object.coverFile || object.cover_file);

  const candidates = [object, nested, coverFile, asObject(coverFile.metadata)];

  return candidates.some((candidate) => {
    const fileName = cleanText(
      candidate.fileName || candidate.file_name || candidate.name
    );
    const reviewstudioFileId = cleanText(
      candidate.reviewstudioFileId || candidate.reviewstudio_file_id
    );
    const reviewstudioFileUrl = cleanText(
      candidate.reviewstudioFileUrl || candidate.reviewstudio_file_url
    );

    return Boolean(fileName && (reviewstudioFileId || reviewstudioFileUrl));
  });
}

function isFileType(file: JsonObject, type: "manuscript" | "cover"): boolean {
  const fileType = cleanText(file.file_type || file.file_kind).toLowerCase();
  const sectionKey = cleanText(file.section_key).toLowerCase();

  return fileType === type || sectionKey.includes(type);
}

function hasStoredBookFile(
  files: JsonObject[],
  type: "manuscript" | "cover"
): boolean {
  return files.some((file) => {
    if (!isFileType(file, type)) return false;

    const fileName = cleanText(file.file_name);
    const reviewstudioFileId = cleanText(file.reviewstudio_file_id);
    const reviewstudioFileUrl = cleanText(file.reviewstudio_file_url);

    return Boolean(fileName && (reviewstudioFileId || reviewstudioFileUrl));
  });
}

function validateContentData(
  extractedFields: JsonObject,
  contentFiles: JsonObject[]
): ValidationResult {
  const errors: Record<string, string> = {};
  const requiredKeys = getCanonicalRequiredKeys("content");

  const manuscriptPresent =
    hasStoredBookFile(contentFiles, "manuscript") ||
    hasStoredFileMetadata(extractedFields.manuscript_metadata);

  const coverOption = cleanText(extractedFields.cover_option);
  const coverPresent =
    hasStoredBookFile(contentFiles, "cover") ||
    hasStoredFileMetadata(extractedFields.cover_metadata);

  const drm = cleanText(extractedFields.drm);
  const accessibility = cleanText(extractedFields.accessibility);

  if (!manuscriptPresent) {
    errors["content.manuscript"] = "Upload your manuscript.";
  }

  if (
    drm !== "yes_apply_drm" &&
    drm !== "no_do_not_apply_drm"
  ) {
    errors["content.drm"] = "Choose a Digital Rights Management option.";
  }

  if (!coverOption) {
    errors["content.cover"] = "Choose a cover option.";
  } else if (coverOption === "upload_cover_file" && !coverPresent) {
    errors["content.cover"] = "Upload your book cover file.";
  }

  if (!accessibility) {
    errors["content.accessibility"] = "Choose an accessibility option.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    requiredKeys,
    errors
  };
}

function parsePositiveNumber(value: unknown): number | null {
  const numeric = Number(
    String(value ?? "")
      .replace(/[^0-9.-]/g, "")
      .trim()
  );

  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function validatePricingData(stateJson: JsonObject, authoritativePrimaryMarketplace: string): ValidationResult {
  const errors = validatePricingContract(stateJson, authoritativePrimaryMarketplace) as Record<string, string>;
  const requiredKeys = getCanonicalRequiredKeys("pricing");

  return {
    valid: Object.keys(errors).length === 0,
    requiredKeys,
    errors
  };
}
