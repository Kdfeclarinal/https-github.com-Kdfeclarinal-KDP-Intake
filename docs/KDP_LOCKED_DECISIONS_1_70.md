# KDP Locked Decisions 1–70

## Authority

This file is the canonical product/workflow decision authority for KDP Intake through Decision 70. It supersedes partial brainstorming notes and earlier decision dumps where the supersession and clarification rules below refine them.

The supplied final handoff expresses Decisions 1–67 as a continuous locked sequence rather than separate numbered headings. Decisions 68–70 below are later explicit product/workflow additions and refinements. Do not invent additional numbered decisions for ordinary implementation details.

## D7/D8 clarification

A review round may temporarily have no assigned reviewer while awaiting reviewer assignment. Once a reviewer is assigned, exactly one active reviewer owns normal review mutations.

Owner or a properly capable Tech Admin may deliberately reassign or take over under the existing capability rules. Submission remains valid when no reviewer is available. This clarifies Decisions 7 and 8; it is not a new numbered decision.

## Locked decision sequence

Book creation starts from the privileged React Bookshelf:
Create Book → Book Type → Employee → Reviewer/default → Create
Supabase creates the canonical book first. Basecamp provisioning happens afterward through the backend/integration layer.
Basecamp is not canonical book storage.
The employee selector may use people available in the designated Basecamp Pre-Press project.
KDP Intake does not automatically add/remove people from the Basecamp project.
Project membership remains managed in Basecamp.
Use one dedicated Basecamp Pre-Press project.
Each KDP book gets:
- one Basecamp To-do List
- dynamic workflow to-dos underneath it
Do not create a separate Basecamp project per book.
The React Bookshelf is privileged-user only.
Employees do not need Google login or Bookshelf access.
Employees enter their assigned book through a secure book-scoped launcher/deep link, normally surfaced through Basecamp.
Use capability-based privileged access.
Operational model:
- Owner — global business/operations authority
- Tech Admin — broad system/support/admin authority and may review/finalize when capable
- Reviewer — review authority for assigned reviews and may claim unassigned reviews only when capability allows
Capabilities include concepts such as:
- can_review
- can_claim_review
- can_assign_reviewer
- can_reassign_reviewer
- can_change_default_reviewer
- can_create_book
- can_view_all_books
- can_finalize_book
- can_manage_users
Backend capability checks are authoritative.
Use:
- configurable default reviewer
- optional per-book reviewer override
Owner/Tech Admin with proper capability may assign or reassign eligible reviewers.
An ordinary reviewer may claim an unassigned review only if allowed.
An ordinary reviewer cannot replace an already assigned reviewer or assign arbitrary people.
All assignment/reassignment actions are audited.
Each review round has exactly one active assigned reviewer.
Other privileged users may observe if authorized.
Only the currently assigned reviewer may perform normal review mutations.
Owner/Tech Admin may deliberately reassign/take over.
Submit for Approval is an authoritative server transition.
The backend must:
- validate employee authorization
- validate current workflow state
- validate required employee steps/data
- create the immutable employee submission snapshot/review round
- close normal employee editing
- select the reviewer
- transition workflow state
- create the integration/outbox event
Reviewer fallback order:
book reviewer override → configured default reviewer → Owner/Mario fallback
If no valid reviewer exists, submission itself does not become invalid.
The book enters an awaiting-reviewer-assignment/attention condition instead.
The same employee normally remains assigned throughout intake.
Employee reassignment is a deliberate KDP Bookshelf/admin action.
Basecamp assignment is not authoritative for reassignment.
Reassignment must:
- revoke old employee access
- issue/update replacement access
- preserve workflow progress
- audit the change
Basecamp tasks are dynamic by review round.
Example:
Employee Intake
Admin Review — R1
if updates requested:
Employee Updates — R1
then:
Admin Review — R2
and so on.
Do not use one recycled/fixed Final Review task.
Do not recreate every field/file/checklist item inside Basecamp.
Basecamp coordinates people and milestones.
React/Supabase owns detailed completeness and workflow truth.
Approve Book means:
KDP Intake is complete and ready for publishing/KDP handoff.
It does not mean Amazon has published the book.
The active Basecamp Admin Review task may be completed.
The book's Basecamp To-do List remains visible; do not automatically archive/delete it.
Manual completion/reopening of Basecamp tasks is informational/mirrored only.
Checking a Basecamp checkbox must never execute a KDP state transition.
Major workflow transitions occur only through the KDP application/backend.
Employees use a stable logical book-scoped entry point.
The backend may exchange it for short-lived sessions.
Drafts persist server-side.
Employee reassignment revokes the previous employee's access and establishes new access for the replacement.
Privileged users authenticate using:
Google authentication → Supabase privileged-user allowlist/profile → capabilities
A Gmail/Google identity alone does not grant authority.
Basecamp OAuth is not KDP login.
Bookshelf Settings should support privileged management such as:
- Team & Permissions
- Review Defaults
- Integrations
Manual Supabase provisioning should only remain as bootstrap/development fallback, not the intended everyday user-management workflow.
Bookshelf is the privileged operational dashboard.
Book cards should expose useful operational information such as:
- title
- author
- book type
- compact workflow status
- assigned employee
- assigned reviewer
- role/state-aware primary action
- latest relevant downloads/files
Privileged users do not normally directly edit submitted employee metadata.
Deletion is soft-delete.
Assignment/reviewer management remains privileged.
Final book approval is controlled by can_finalize_book.
An assigned reviewer may finalize if their capabilities permit it.
Owner authority always remains available.
Normal admin review is:
view → comment → request correction → approve
not:
reviewer directly rewrites employee-submitted metadata
The employee owns corrections.
Previously approved sections are locked by default during Employee Updates.
An employee may deliberately reopen an approved section when a legitimate related correction is necessary.
Reopening requires a reason and is audited.
Its approval is invalidated.
Only known deterministic dependencies are automatically invalidated.
See Decision 55 for the later dependency clarification.
Use a ReviewStudio-inspired interaction model without cloning ReviewStudio pixel-for-pixel.
Core concepts retained:
- right panel with Comments | Approvals
- numbered section-linked comment threads
- replies inside the existing thread
- stable database IDs
- navigation between comment and section
- comment controls such as Reply/Edit/Resolve/Delete
- employee may reply during Employee Updates
- reviewer controls review decisions
- Approve All exists
- no Update All
Later Decisions 60–64 refine and supersede the earlier comment-entry and Approve-All details.
Every reviewable section has exactly:
- Pending
- Approved
- Changes Requested
An unresolved actionable section issue causes Changes Requested.
Resolving the final actionable issue does not produce approval.
It returns the section to Pending.
Explicit reviewer approval is always required.
Whole-book rules:
- Pending > 0 blocks terminal review action
- Pending = 0 and Changes Requested > 0 permits Request Updates
- all required sections Approved permits Approve Book, subject to authorization
During Employee Updates, each requested-change thread becomes Ready for Re-review when either:
- the employee makes a meaningful normalized change to the affected section, or
- the employee replies after the reviewer's latest request
The employee does not have to do both.
There is no manual Mark Addressed button.
Normalization is field-specific and must ignore irrelevant/cosmetic differences while preserving meaningful structure such as intentional paragraph breaks.
The reviewer must review the entire Details + Content + Pricing submission before ending the round.
Do not send individual pages back independently.
For Request Updates:
- global Pending count must be zero
- at least one section must be Changes Requested
For Approve Book:
- all required sections must be Approved
Reviewer page concept remains:
Details → Content → Pricing
Reviewer actions save immediately.
No reviewer Save Draft or Save & Continue.
Use Review Next Page.
If the reviewer attempts to advance while prerequisite sections remain Pending:
- block navigation
- show an incomplete-review error
- identify the pending sections
- allow navigation/highlight to those sections
Once a review page has legitimately been reached during the current round, it remains accessible for the rest of that round even if a previous decision is later reopened.
The final whole-book gate remains authoritative.
Every reviewer mutation saves immediately to the backend.
Never show an approval/comment state as successful before the backend confirms success.
On failure, retain the prior state.
Reload/resume restores:
- decisions
- comments
- replies
- page progress/reached pages
During an active round, the assigned reviewer may revise decisions.
Adding an actionable change-request comment to an Approved section moves it to Changes Requested.
Resolving the final issue returns it to Pending.
After Request Updates or Approve Book finalizes the round, that round becomes immutable.
Later review rounds inherit the previous round's reviewer by default.
First-round selection uses the book override/default/fallback rules.
Owner/Tech Admin may deliberately reassign.
Reassignment is audited.
A previously approved section may carry approval into the next round only when its reviewed value and deterministic dependencies are unchanged.
Approval does not carry when the section:
- was requested for change
- was explicitly reopened
- meaningfully changed
- was invalidated by a deterministic dependency
The reviewer may inspect/overturn a carried-forward approval in an active later round.
Each new review/update round gets a new Basecamp lifecycle task under the same book To-do List.
Do not recycle/rename the previous round's task.
Each review round is its own review version.
Current Comments defaults to the current round.
Older rounds remain available through history/previous-round views.
Visible comment numbering may reset per round.
Historical snapshots preserve:
- reviewer
- employee
- timestamps
- section statuses
- actual section values
- comments/replies
- approvals
- file/version IDs
- hashes/metadata
Unchanged binary files need not be physically duplicated.
Historical review must show the actual values that were reviewed, not merely the comments.
Decision 63 further clarifies how requested-change threads continue into the next review cycle.
Detailed review comments and replies live in KDP Intake.
Basecamp receives only operational milestone summaries.
Example:
Updates Requested — R1
with useful operational information such as reviewer, issue count/section names, and deep link.
Do not duplicate full detailed comment conversations into Basecamp.
Keep canonical workflow states small:
- EMPLOYEE_INTAKE
- AWAITING_REVIEW
- IN_REVIEW
- EMPLOYEE_UPDATES
- KDP_INTAKE_APPROVED
More detailed conditions belong in separate fields/status metadata rather than multiplying canonical states.
UI status may be compact and dynamic.
On book creation, canonical Supabase creation commits first.
Basecamp provisioning is retryable/idempotent afterward.
Basecamp failure must not roll back or delete the canonical book.
Expose an integration warning/retry state rather than a fake canonical Setup Pending workflow state.
Delete means soft-delete to Trash.
Trash records:
- deleted date/time
- deleted by
- previous status
Recovery requires confirmation.
Recovery restores the previous workflow state/assignments/round instead of replaying the workflow.
Do not duplicate Basecamp structures during recovery.
Basecamp history is not deleted.
Any active Basecamp task may be paused/unassigned rather than falsely completed.
Employee access is revoked on delete.
Recovery generates/re-establishes valid employee access where necessary.
Do not use hard browser/session locks.
Use optimistic concurrency.
Reviewer mutation must validate:
- authorization
- current assigned reviewer
- active round/state
- expected round revision
Successful mutation increments revision.
Stale requests are rejected and require refresh.
Reviewer reassignment immediately removes the old reviewer's mutation authority.
Authoritative workflow transitions commit to Supabase first.
The same transaction records a durable integration event/outbox item.
External Basecamp work occurs afterward.
Applies to major transitions including:
- Submit for Approval
- Request Updates
- Resubmit
- Approve Book
External failure never rolls back canonical state.
Use:
- stable event/idempotency keys
- bounded retries/backoff
- persistent integration warning
- manual Retry
- reconnect flow for revoked OAuth
Employee-facing notification failure should be surfaced prominently where appropriate.
AWAITING_REVIEW → IN_REVIEW occurs on the first successful meaningful reviewer mutation, such as:
- Approve Section
- add actionable requested-change comment
- Approve All
Opening the review or merely assigning the reviewer does not start it.
Record started_at and started_by.
No separate Start Review button.
Review mutations save immediately.
A review page is complete when every required section is not Pending.
Both:
- Approved
- Changes Requested
count as reviewed outcomes for page progression.
Show useful progress such as:
Details — 2 remaining
No separate Finish Page action.
Approval is not a toggle.
During an active round, assigned reviewer uses explicit:
Reopen Decision
with confirmation.
This changes:
Approved → Pending
and is audited.
If there is an actual problem requiring employee correction, create a section-bound actionable comment instead, producing Changes Requested.
Do not automatically reassign reviewers simply because time elapsed.
Use derived attention/reminder/escalation indicators.
Actual reassignment remains deliberate Owner/Tech Admin action.
If the current reviewer becomes ineligible:
- preserve all prior valid review work
- immediately block further mutations
- mark the book as requiring reviewer intervention
- Owner/Tech Admin deliberately assigns a replacement
- replacement continues the same active round
- historical attribution of prior actions remains intact
Restoring the previous reviewer's eligibility does not automatically return ownership.
Employee saves also use optimistic concurrency.
Multiple devices/tabs are permitted.
A stale employee save must never silently overwrite newer canonical state.
Reject stale writes and require latest state/reload.
Employee reassignment transfers the existing workflow.
Do not reset the book.
Requirements:
- immediate revocation of old access
- replacement employee receives fresh access
- active Basecamp task reassigned rather than recreated
- replacement notified
- required reason
- full audit history
Initial manuscript and cover are Version 1.
A genuine later replacement becomes V2/V3/etc. under the same logical ReviewStudio file/review.
Do not overwrite/disconnect file history.
Supabase maps KDP review rounds to the exact ReviewStudio version used, including useful hashes/metadata.
KDP round numbers and ReviewStudio version numbers are independent.
Unchanged assets are not re-uploaded.
The exact ReviewStudio API overwrite behavior must be contract-tested in staging before relying on it.
Use the existing author/book ReviewStudio area with separate persistent reviews such as:
- Book - Manuscript Review
- Book - Cover Review
Later replacements create new versions in the corresponding existing review.
KDP review rounds remain separate Supabase concepts pointing at exact ReviewStudio versions.
During initial provisioning:
- compare normalized First Name + Last Name under the existing ReviewStudio Clients & Projects structure
- reuse an existing entry only when confident
- otherwise create one
Once mapped, the stored ReviewStudio ID becomes identity.
Later name changes rename the mapped ReviewStudio entity.
Do not re-search and silently switch identity.
Do not automatically merge same-name entries.
Duplicate visible names are safer than incorrect identity merging.
After a successful authoritative Details save that changes the normalized author name:
- Supabase commits first
- async integration sync follows
Both Save Draft and Continue may trigger this when relevant.
Failure never rolls back the canonical Details save.
Retries converge toward the latest authoritative name rather than replaying obsolete intermediate rename requests.
Post-approval KDP Upload Assistant uses isolated Playwright browser sessions because different books may belong to different author KDP accounts.
Do not store/share Amazon credentials, cookies, or 2FA secrets in Supabase across authors.
Flow:
- show expected author/book
- open KDP
- operator signs into the appropriate account
- verify authenticated account before automation
- resume mapped existing KDP draft when available
- never create duplicate drafts on retry
- final Amazon Publish action remains human/manual
Use a packaged local helper rather than requiring console scripts or a Chrome extension.
An already approved review round stays immutable.
If a correction is required before final KDP submission:
Reopen for Correction with required reason
creates a new correction/update cycle and eventually a new numbered review round.
Only changed/reopened/dependency-invalidated sections lose carried approval.
If a mapped Amazon KDP draft already exists, later KDP upload updates that same draft rather than creating another.
Authoritative corrections should return through KDP Intake rather than being silently changed only in the Amazon UI.
KDP Intake ends at the successful handoff/submission of the approved package into official Amazon KDP.
Human performs the final KDP submission/publish action.
Amazon's later review/publication/account issues are outside this intake workflow.
A lightweight audited marker such as Submitted to KDP with actor/time/approved round is acceptable.
No Amazon publication-status tracking is required.
Changing Primary Marketplace deterministically invalidates Pricing approval.
Pricing returns to a state requiring re-review.
This is a real dependency.
Internally the application may calculate/show marketplace conversions and estimates.
For Amazon upload, authoritative pricing core is:
- selected Primary Marketplace
- main list price
- existing actual pricing choices such as royalty/territories/KDP Select where applicable
Do not populate converted per-market prices as authoritative overrides unless explicitly required later.
Let Amazon calculate corresponding marketplace prices from the primary price.
Each submitted review round stores pricing/FX estimates exactly as seen at submission time, including useful FX source/timestamp/value information.
Historical pricing snapshots never recalculate.
Normal FX movement alone does not invalidate a previously approved section.
Do not automatically reopen Cover or Manuscript because metadata such as title/subtitle/author changed.
The reviewer visually verifies actual assets.
If the asset no longer matches, reviewer requests an explicit correction/new version.
Automatic invalidation is limited to deterministic dependencies such as Primary Marketplace → Pricing.
This clarifies the dependency language from Decision 20.
AI disclosure requires an explicit server/client Yes or No.
If No, additional AI-detail fields are not required.
If Yes, show and require the actual current KDP-required follow-up choices before Content can be complete.
Incomplete drafts remain saveable.
Frontend and backend validation must agree.
Store the full disclosure in submission snapshots/review history.
Do not invent AI disclosure fields beyond KDP's actual required choices.
If the employee changes AI disclosure from Yes to No, clear now-hidden AI follow-up values from the active canonical state so stale data cannot later be submitted.
Historical snapshots/audit retain what had previously existed.
The employee submission snapshot becomes immutable when Submit commits.
Review activity remains mutable during the active review round.
The whole review round becomes permanently immutable when the authoritative terminal transaction succeeds for:
- Request Updates
- Approve Book
External integration success/failure does not control the immutability boundary.
Terminal endpoints must be idempotent.
Any later correction creates new round/workflow state rather than modifying finalized history.
Owner-level authority is protected from normal capability administration.
Tech Admin may manage users/reviewers and an approved subset of capabilities but cannot:
- create/demote Owners arbitrarily
- self-escalate into Owner-only power
At least one active Owner must always remain.
Disabling a user takes effect immediately even if they currently own work.
Affected books become attention/intervention cases as needed.
Historical attribution remains intact.
All permission, disable, and ownership changes are audited.
There are two comment entry paths.
Reviewer clicks a reviewable section body.
This opens the section comment composer.
Clicking the section alone changes nothing.
When the reviewer actually posts the comment:
- create an actionable section-bound thread
- create its numbered section marker
- set the section to Changes Requested
No separate individual Update button exists.
The Comments panel retains Add Comment for general/non-section notes such as:
Great work overall on this submission.
General comments:
- are not tied to a section
- do not create section markers
- do not change section state
- do not block review/resubmission
Resolve applies to actionable review threads and is separate from approval.
Resolving the final actionable issue for a section returns:
Changes Requested → Pending
never directly to Approved.
The reviewer must explicitly approve afterward.
The Approvals tab represents section review states, not resolved-comment history.
No Update All.
Before approval:
[ APPROVE ]
After successful backend approval, the action is replaced in the same area by a compact:
APPROVED ✓
The section does not remain permanently glowing.
Glow/highlight is reserved for temporary interaction feedback such as:
- selected section
- comment navigation
- jump-to-section
During an active review round, the approved state exposes a subtle:
Reopen Decision
action.
Reopen Decision returns the section to Pending.
During an active review round:
- comment/reply authors may edit their own content
- edits are audited
- editing retains the same thread/visible marker identity
Delete is soft-delete/tombstone, not destructive erasure.
Preserve audit information including original content and deletion metadata.
If deleting an actionable root thread removes the final unresolved actionable issue on that section:
Changes Requested → Pending
not Approved.
Replies do not independently control section review state.
Once the review round is finalized, comments/replies become immutable.
Posting a section-bound actionable comment automatically sets the affected section to Changes Requested.
There is no additional section-level Request Update button.
After the entire book is reviewed and Pending reaches zero, the reviewer uses the whole-book:
Request Updates
action to finalize the review round and return the book to the employee.
During Employee Updates, every active requested-change thread automatically becomes:
Ready for Re-review
when either:
- a meaningful saved change is made to its affected section, or
- the employee replies after the reviewer's latest request
No manual employee readiness button.
Ready for Re-review does not mean resolved.
Only the reviewer resolves it after re-checking.
Requested-change context remains linked through the update cycle into the next review round so the reviewer can see:
- what was requested
- what the employee changed/replied
- whether the issue is now acceptable
The previous finalized round remains immutable.
Approve All is current-page only.
It approves only currently Pending sections on the active review page that have no unresolved actionable requested-change threads.
It does not:
- override Changes Requested
- change already Approved sections unnecessarily
- affect sections on another page
If no sections are eligible, no state changes occur.
When workflow enters EMPLOYEE_UPDATES, the employee returns to the normal:
Details → Content → Pricing
flow in a clear Update Requested mode.
Requested-change sections are:
- visually highlighted
- editable
- linked to the relevant reviewer threads
Previously approved sections remain locked by default.
Employee may:
- read reviewer requests
- reply to threads
- edit requested sections
- save drafts
Employee may not:
- approve
- resolve reviewer issues
- edit/delete reviewer comments
- manually set review states
Approved sections may only be deliberately reopened with a required reason.
Resubmit remains blocked until all active requested-change threads are automatically Ready for Re-review.
No separate Requested Updates landing page.
Both terminal review-round actions require confirmation:
Confirmation summarizes the sections being returned and clearly explains that the current round will be finalized.
Confirmation states that:
- all required sections are approved
- the current review round will become final
- this marks KDP Intake approved/ready for publishing handoff
- this does not publish the book on Amazon KDP
Only after confirmation and successful authoritative backend execution does the transition occur.
Ordinary reversible review actions do not need unnecessary confirmation dialogs.
After successful Request Updates or Approve Book, that review round becomes permanently read-only.
Historical view retains:
- exact submitted snapshot
- section decisions
- comments
- replies
- comment numbering
- reviewer attribution
- timestamps
- approvals
- associated file/version information
Mutation controls are absent/unavailable, including:
- Approve
- Approve All
- Reopen Decision
- Post Comment
- Reply
- Edit
- Resolve
- Delete
- Request Updates
- Approve Book
Show a clear historical/finalized banner identifying the round and outcome.
Later employee updates, resubmissions, or correction cycles create new workflow/round state.
Never reopen a finalized round.
These do not need new decision numbers. They are concrete interpretations of the locked decisions above.
Clicking the section body:
select/highlight section → open composer
does not itself change review state.
The composer appears near the selected section.
While the composer is open:
- the rest of the page is dimmed/blurred
- background UI is non-interactive
- focus stays on the composer
On successful Post:
- actionable thread is created
- section enters Changes Requested
- composer closes
- overlay/blur disappears
- normal interaction resumes
Closing/canceling does not alter section state.
Dragging the composer is not required for MVP.
Clicking the section's Approve button:
- approves the section
- does not open the composer
- does not require a comment
Prevent click propagation from the Approve control into the section-body click handler.
Section-bound actionable threads show markers such as:
① ② ③
Clicking the marker focuses its corresponding comment.
Clicking a linked comment smooth-scrolls/highlights its section.
Clicking a section itself may create another independent issue/thread.
Replying to an existing issue is done through that thread/Reply control rather than by creating a new root issue.
General panel comments do not create section markers.
Current intended controls:
- search by comment text
- sort Latest / Oldest
- < previous selected comment
- > next selected comment
- ∨ / ∧ collapse/expand comment bodies
Collapsed comments remain present in compact form.
Approvals is a section-state navigator, not a list of resolved comments.
Show reviewable sections with:
- Pending
- Approved
- Changes Requested
Clicking an entry navigates/highlights the corresponding section.
Reviewer/comment identity comes from the authenticated KDP privileged identity:
Google auth → Supabase privileged user/profile
Do not derive KDP reviewer identity from Basecamp.
Basecamp person identity is an integration/operational mapping only.
Details/Content review pages use reviewer actions such as:
Approve All + Review Next Page
Do not show employee:
- Save as Draft
- Save and Continue
Do not show:
- Update All
At the final whole-book stage, use the appropriate terminal actions:
- Request Updates
- Approve Book
according to state/capability.
Use this when older project notes appear to conflict with the final decisions.
Any earlier architecture note saying ReviewStudio files are simply replaced/overwritten is superseded by Decisions 45–46.
Use ReviewStudio-native version history for genuine asset replacements.
Decision 20's mention of dependent sections is constrained by Decision 55.
Only deterministic dependencies automatically invalidate approval.
Do not automatically invalidate Cover/Manuscript because Title/Author/etc. changed.
Any earlier Decision 21 concept implying a generic + Add Comment can select arbitrary sections is refined by Decision 60:
- section body → actionable section comment
- panel Add Comment → general non-blocking note
Decision 21 allowed Approve All for clear Pending sections.
Decision 64 now additionally locks its scope to the current page only.
Do not treat Resolve as Approve.
Decisions 22, 60, 62 and 63 make this explicit.
Resolve addresses a thread.
Approve addresses a section.
Decision 31's historical/carry-forward concept is clarified by Decision 63.
Requested-change context follows the Employee Updates cycle into the next active review for re-checking while the old round itself remains immutable.
Decision 58 defines the backend immutability boundary.
Decision 67 defines its historical UI representation.
Do not implement a finalized round that remains editable merely because the UI is still open in an old browser tab.
Backend state wins.
Do not turn this into a new product decision unless the business explicitly chooses an identity policy.
Basecamp access is through OAuth.
For development/testing, Kein's existing Basecamp member account may authorize the integration if that account has sufficient access to the EA Publishing account and designated Pre-Press project.
Preferred production arrangement, if the company accepts the extra Basecamp user/seat cost:
Automations@eaepub.com
as a dedicated company-controlled Basecamp user with only the necessary project access.
That automation user would perform the OAuth authorization.
Mario does not need to give the application his Basecamp password.
If the company chooses not to maintain a dedicated automation user, an authorized company member may remain the OAuth connection.
This does not change the authority model:
Supabase = canonical workflow authority
Basecamp = operational integration
Preserve all existing security architecture and verify these through implementation:
- browser/frontend is never workflow authority
- privileged authorization is server-side
- employee book/page/action scope is server-side
- review assignment is server-side
- capability checks are server-side
- state-transition legality is server-side
- service-role secrets never enter browser code
- Basecamp OAuth client secret/tokens remain server-side
- ReviewStudio API credentials remain server-side
- GHL secrets remain server-side
- signed file URLs are temporary
- uploads are validated
- cross-book access is prevented
- stale/replayed/duplicate mutations are rejected/idempotent as appropriate
- terminal review transitions are idempotent
- optimistic concurrency protects reviewer and employee writes
- audit attribution survives reassignment, deletion, disabling and historical finalization
- Basecamp or ReviewStudio failure must not corrupt/roll back canonical Supabase state


---

## Decision 68 — Basecamp task usability + internal book identity

When a privileged user creates a book, the Create Book flow must also capture a required operational **Book Author** used to identify whose book/project it is before the employee completes authoritative KDP Details.

Keep these concepts separate:

- `Book Author` = privileged-creator operational identity for the book/project
- `Assigned Employee` = person doing the intake work
- `Reviewer` = eligible privileged reviewer from Supabase
- `primary_author_name` = authoritative KDP author captured later during employee Details

Create Book for Kindle eBook contains:

```text
Book Type
Book Author
Assigned Employee
Reviewer
Due Date

[Create Book]
```

Basecamp-facing workflow is human-readable:

```text
<Book Author> — KDP Pre-Press
    ↓
KDP Pre-Press — Stage 1
    ↓
Review — Round 1
    ↓
KDP Pre-Press — Stage 2   [only when updates are requested]
    ↓
Review — Round 2
```

The internal Book ID remains a non-secret deterministic reconciliation/support marker and must not be the primary human-facing title or subtitle.

On successful canonical Supabase book creation, Basecamp provisioning must:

- create/reuse the book To-do List
- create the Stage 1 KDP Pre-Press task
- assign it to the selected employee
- attach the resolved due date
- provide the human-readable **Open KDP Intake** link
- preserve the deterministic internal marker for idempotent reconciliation
- never display a raw employee credential as visible text

The employee launcher credential may appear temporarily in the initial deep link, but it must not remain a long-lived bearer credential in the visible browser URL throughout the session. Preferred behavior remains:

```text
Basecamp Open KDP Intake link
→ scoped opaque employee credential
→ backend validates book / employee / scope / expiry / revocation
→ establish short-lived employee session
→ remove/sanitize credential from visible URL
→ continue on harmless book route/session
```

Preserve the existing security model:

- credential scoped to one book/employee
- revocable
- expiry enforced
- stale/reassigned employee access rejected
- no raw credential printed in Basecamp

Supabase remains canonical workflow authority. Basecamp remains an operational integration.

## Decision 69 — Submitted employee link becomes read-only

After a successful **Submit for Approval**, the same employee book link remains valid but changes to a read-only **Submitted for Review** experience.

While the authoritative book state is `AWAITING_REVIEW` or `IN_REVIEW`:

- no editable Details / Content / Pricing controls
- no file upload or replacement controls
- no Save Draft
- no Save and Continue
- no Submit for Approval
- the employee may see submission/read-only status only

The same employee book link becomes editable again only when authoritative workflow state enters `EMPLOYEE_UPDATES`.

Approved/final states remain read-only.

This is a UI/interaction rule in addition to the existing server-side mutation checks. The browser never becomes workflow authority.

## Decision 70 — Configurable Stage 1 due date

The initial employee-intake turnaround default is **7 calendar days**.

Requirements:

- the default is stored/configured server-side rather than permanently hard-coded into one UI
- Create Book shows the resolved default due date
- the privileged creator may override the due date for that book
- the resolved due date is stored on the canonical book
- Basecamp Stage 1 receives that resolved due date
- changing the global default affects future books only
- changing the global default never retroactively changes existing book or Basecamp task due dates
- existing books are not backfilled merely because this decision is introduced
