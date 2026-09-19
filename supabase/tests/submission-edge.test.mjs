import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const submit = readFileSync(
  new URL(
    "../functions/submitBookForApproval/index.ts",
    import.meta.url
  ),
  "utf8"
);

const mapping = readFileSync(
  new URL(
    "../functions/saveReviewerBasecampMapping/index.ts",
    import.meta.url
  ),
  "utf8"
);

const retry = readFileSync(
  new URL(
    "../functions/retryBasecampReviewLifecycle/index.ts",
    import.meta.url
  ),
  "utf8"
);

const outcomeRetry = readFileSync(
  new URL(
    "../functions/retryBasecampReviewOutcome/index.ts",
    import.meta.url
  ),
  "utf8"
);

const reviewMutation = readFileSync(
  new URL(
    "../functions/mutatePrivilegedAdminReview/index.ts",
    import.meta.url
  ),
  "utf8"
);

const reviewRuntime = readFileSync(
  new URL(
    "../functions/_shared/basecampReviewRuntime.ts",
    import.meta.url
  ),
  "utf8"
);

const config = readFileSync(
  new URL(
    "../config.toml",
    import.meta.url
  ),
  "utf8"
);

test(
  "employee submission hashes the opaque token and delegates persisted-state validation to the RPC",
  () => {
    assert.match(
      submit,
      /tokenHash = await sha256\(accessToken\)/
    );

    assert.match(
      submit,
      /p_token_hash: tokenHash/
    );

    assert.doesNotMatch(
      submit,
      /pricing_state|p_pricing_state/
    );

    assert.doesNotMatch(
      submit,
      /access_token:\s*accessToken/
    );

    assert.match(
      config,
      /\[functions\.submitBookForApproval\]\s*verify_jwt = false/
    );

    assert.match(
      config,
      /\[functions\.loadEmployeePage\]\s*verify_jwt = false/
    );

    assert.match(
      config,
      /\[functions\.saveEmployeeStep\]\s*verify_jwt = false/
    );

    assert.match(
      config,
      /\[functions\.uploadContentFileToReviewStudio\]\s*verify_jwt = false/
    );
  }
);

test(
  "reviewer mapping and lifecycle retry require privileged capabilities",
  () => {
    assert.match(
      mapping,
      /requiredCapability: "can_manage_users"/
    );

    assert.match(
      mapping,
      /validateReviewerMapping/
    );

    assert.match(
      mapping,
      /projects\/\$\{connection\.projectId\}\/people\.json/
    );

    assert.doesNotMatch(
      mapping,
      /email_address\s*===|email_snapshot\s*===/
    );

    assert.match(
      retry,
      /requiredCapabilities:\s*\["can_manage_integrations",\s*"can_assign_reviewer"\]/
    );

    assert.match(
      config,
      /\[functions\.saveReviewerBasecampMapping\]\s*verify_jwt = true/
    );

    assert.match(
      config,
      /\[functions\.retryBasecampReviewLifecycle\]\s*verify_jwt = true/
    );

    assert.match(
      config,
      /\[functions\.retryBasecampReviewOutcome\]\s*verify_jwt = true/
    );

    assert.match(
      outcomeRetry,
      /syncReviewOutcomeWithRuntime/
    );
  }
);

test(
  "initial and retried finalized outcomes settle their durable Basecamp audit events",
  () => {
    assert.match(
      reviewMutation,
      /review_outcome_sync_requested/
    );

    assert.match(
      reviewMutation,
      /auditStatus = 'failed'/
    );

    assert.match(
      reviewMutation,
      /processed_at:/
    );

    assert.match(
      outcomeRetry,
      /review_outcome_retry_requested/
    );

    assert.match(
      outcomeRetry,
      /eventError\s*\|\|\s*!event\?\.id/
    );

    assert.match(
      outcomeRetry,
      /status:\s*"failed"/
    );

    assert.match(
      outcomeRetry,
      /processed_at:/
    );
  }
);

test(
  "review round runtime uses the correct employee-side source task for Round 1 and Round 2+",
  () => {
    /*
     * The runtime must know the previous review round so it can choose:
     *
     * Round 1
     *   Employee Intake
     *
     * Round 2+
     *   Employee Updates from the previous round
     */
    assert.match(
      reviewRuntime,
      /previous_round_id/
    );

    assert.match(
      reviewRuntime,
      /selectReviewSourceReference/
    );

    assert.match(
      reviewRuntime,
      /employee_update/
    );

    /*
     * The selected source reference must be carried into the sync attempt,
     * rather than being inferred again from browser or external state.
     */
    assert.match(
      reviewRuntime,
      /source_reference_id/
    );

    assert.match(
      reviewRuntime,
      /sourceReference\.id/
    );

    /*
     * The lifecycle runtime must update the selected source reference after
     * completing its task. This is what lets a later retry know the transition
     * already made partial progress.
     */
    assert.match(
      reviewRuntime,
      /updateEmployeeReference/
    );

    assert.match(
      reviewRuntime,
      /sourceReference\.source_todo_completed_at/
    );
  }
);