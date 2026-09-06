# ReviewStudio API v2.1 — exhaustive research pass for the KDP application

**Research date:** 2026-09-05  
**Account host studied:** `iwdnow.reviewstudio.com`  
**Interactive documentation:** https://iwdnow.reviewstudio.com/api/documentation/  
**Machine-readable contract:** https://iwdnow.reviewstudio.com/api/docs  
**Specification:** Swagger 2.0, API version 2.1  
**Snapshot fingerprint:** SHA-256 `c1f2a4469a01dc03c3769ffba730ba03050a0d90629749656fb884271275de80`

## Executive conclusion

The current account-specific contract contains **91 path templates and 131 operations**: 55 GET, 45 POST, 17 PUT, and 14 DELETE. It covers account review defaults, reviews, files and versions, review members, approval summaries, read-only notes, webhook delivery logs, workflow assignment, users, clients, projects, teams, labels, the authenticated profile, and a restricted `/my` namespace.

For our KDP system, ReviewStudio should remain a specialized proofing and feedback service behind Supabase Edge Functions. Supabase remains authoritative for book state, KDP segment decisions, review rounds, authorization, retries, and audit history. The browser must never receive the ReviewStudio API key or admin identity header.

The most important boundary is that the documented REST API **does not expose methods to create/edit/delete comments or replies, submit an approval decision, create/update/complete tasks, create/edit workflow templates or stages, or register webhooks as independent resources**. The app can read those objects or receive their activity through webhooks, but the codebase must not invent write endpoints.

## Source hierarchy and confidence

1. The account-specific Swagger contract above is the authority for endpoint names, documented inputs, and documented success statuses.
2. ReviewStudio's official webhook support page defines outbound event names and payload fields: https://support.reviewstudio.com/home/reviewstudio-webhooks
3. ReviewStudio's official approval guide documents four user-facing decisions: https://support.reviewstudio.com/home/managing-and-submitting-approvals
4. A live unauthenticated GET to `/api/profile` returned HTTP 401 with `{"error":"The access token is invalid"}`. This confirms authentication is enforced but does not prove OAuth/Bearer authentication is supported for our account.
5. Any behavior not explicitly present in those sources is marked as an inference or a contract-test requirement.

## Transport and authentication contract

Base URL:

`https://iwdnow.reviewstudio.com/api`

Every documented API request uses these account credentials:

- `X-REVIEWSTUDIO-EMAIL: <admin email>`
- `X-REVIEWSTUDIO-TOKEN: <API key>`

For JSON operations, send `Content-Type: application/json` and request JSON with `Accept: application/json`.

Security rules for our app:

- Store the API key and admin email only as Supabase Edge Function secrets.
- Never call ReviewStudio directly from GHL or React browser code.
- Never log credential headers or full signed file URLs.
- The `/my` namespace still uses the same server credential model in this documentation. It is not a client-side end-user authentication mechanism.
- Implement an explicit allowlist of paths/methods in the server adapter.
- Add timeouts, bounded retries for safe operations, structured error logging, and database-backed idempotency because the API contract documents no idempotency key.
- Do not interpret the observed `WWW-Authenticate: Bearer` error header as permission to replace the two documented ReviewStudio headers.

## ReviewStudio resource model

`Client -> Project -> Review -> Review File -> File versions / Notes / Approval activity`

Separately:

- Account users may belong to default, client, project, or review teams.
- Account labels can be enabled for reviews, files, and comments.
- Workflow templates contain stages and users; a workflow can be assigned to a review.
- A review has one `webhook_url`; webhook log resources are read-only through the REST API.

Recommended KDP mapping:

| KDP object | ReviewStudio object | Rule |
|---|---|---|
| IWDNow/customer grouping | Client | Prefer one stable client unless the business needs separate clients. Reuse its stored ID. |
| Book project | Project | One project per book; persist `reviewstudio_project_id` immediately. |
| Editorial review round | Review | One review per KDP review round; persist `reviewstudio_review_id`. |
| Interior manuscript | Review file | Upload first with `order: 0`. |
| Cover/jacket | Review file | Upload second with `order: 1`. |
| Revised manuscript or cover | File version | Update the mapped review file rather than creating an unrelated file when continuity is desired. |
| ReviewStudio comments | Notes/replies | Read and reconcile; the public REST contract has no comment-write method. |
| KDP admin decisions | Supabase review items | Keep authoritative in Supabase; do not equate them automatically with ReviewStudio file approvals. |

## Capability boundary

| Capability | Documented? | API surface / note |
|---|---:|---|
| Create/read/update/delete reviews | Yes | `/reviews`, `/reviews/{id}`; mirrored under `/my/reviews`. |
| Upload initial files from a URL | Yes | `POST /reviews/{review_id}/files` with `review_file_url`. |
| Upload/update a new file version | Yes, but transport needs testing | `PUT /reviews/{review_id}/files/{review_file_id}`; `overwrite` is available. |
| Add a fully remote asset version | Yes | `POST .../{review_file_id}/remote`; requires URL, thumbnail URL, file type, and name. |
| Read file processing state | Yes | `GET .../files/{review_file_id}`; inspect `processing_status`. |
| Lock, unlock, hide, unhide, convert, order, or delete files | Yes | Single-file and batch endpoints. |
| Create HTML live/capture/screenshot proofs | Yes | Three HTML endpoints with page URLs and resolution arrays. |
| Add/remove reviewers and set approver eligibility | Yes | Review-user endpoints. |
| Send a ReviewStudio notification message | Yes | `POST /reviews/{id}/notify_users`. |
| Read approval summaries | Yes | Aggregate and decision-filtered GET endpoints. |
| Submit an approval decision | **No** | No POST/PUT approval endpoint is documented. |
| Read comments/notes and replies | Yes | Review-level and file-level GET endpoints. |
| Create/edit/delete comments or replies | **No** | No note/reply write endpoint is documented. |
| Receive comment/reply/approval/task activity | Yes | Outbound review webhook events. |
| Create/edit/complete tasks through REST | **No** | Task activity exists in webhooks only. |
| Assign/remove an existing workflow | Yes | Review workflow PUT/DELETE. |
| Create/edit/advance workflow templates or stages | **No** | Workflow and stage methods are read-only apart from assignment. |
| CRUD users, clients, projects, labels | Yes | Account-wide endpoints. |
| Assign labels to a review | Yes | `labels` on review create/update replaces the existing set. |
| Assign labels directly to files/comments | Not documented | Label lookup endpoints exist, but no assignment method is exposed. |
| Register/update/delete webhook destinations as resources | **No** | Set `webhook_url` on a review; webhook endpoints only inspect deliveries. |

## Recommended application workflow

1. Authorize the employee/admin and book access in Supabase before any ReviewStudio request.
2. Acquire a database lock/idempotency record for `book_id + review_round_id + operation`.
3. Reuse a stored ReviewStudio project ID. If absent, create the project and persist the returned/resolved ID.
4. Create the review with a stable description, project relationship, reviewers/settings, and webhook URL.
5. Upload manuscript and cover in separate calls using short-lived Supabase signed URLs that remain valid long enough for ReviewStudio to fetch them.
6. Persist each returned review-file ID before continuing.
7. Poll each file's GET endpoint until `processing_status` is `complete` or `error`. Use bounded exponential backoff and an overall deadline.
8. Add/update review users and approver eligibility as needed.
9. Notify users only after required files are complete.
10. Receive webhook events, deduplicate them, validate all referenced IDs against stored mappings, and enqueue reconciliation.
11. On note/reply events, re-fetch notes. On approval events, re-fetch approval summaries because the webhook's legacy boolean cannot represent every modern decision clearly.
12. Keep Supabase as the final source of truth for KDP approval and submission readiness.

Suggested server modules:

- `reviewstudio/client.ts`: base URL, headers, timeout, JSON parsing, error normalization.
- `reviewstudio/projects.ts`
- `reviewstudio/reviews.ts`
- `reviewstudio/files.ts`
- `reviewstudio/users.ts`
- `reviewstudio/notes.ts`
- `reviewstudio/approvals.ts`
- `reviewstudio/workflows.ts`
- `reviewstudio/webhooks.ts`
- `reviewstudio/contracts.ts`: local runtime validation around inconsistent response schemas.
- `reviewstudio/sync.ts`: idempotency, persistence, polling, and reconciliation.

## Complete endpoint inventory

An asterisk marks a documented required parameter. “Success” lists only what the Swagger file documents; absence of a response model means the body shape is unspecified.


### Account settings (4)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /account/review/settings` | `getAccountReviewSettings` | Get Review Settings for Account | none | 200 Api_Entities_Account_Review_Settings |
| `PUT /account/review/settings` | `putAccountReviewSettings` | Update Review Defaults for Account | body:putAccountReviewSettings* | 200 Api_Entities_Account_Review_Settings |
| `GET /account/review/defaults` | `getAccountReviewDefaults` | Get Review Defaults for Account | none | 200 Api_Entities_Account_Review_Defaults |
| `PUT /account/review/defaults` | `putAccountReviewDefaults` | Update Review Defaults for Account | body:putAccountReviewDefaults* | 200 Api_Entities_Account_Review_Defaults |

### Account-wide reviews and review resources (51)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /reviews` | `getReviews` | Get all reviews | query:sort_by; query:sort_order; query:filter_by_approval; query:filter_by_status; query:term; query:hide_users; query:hide_files | 200 |
| `POST /reviews` | `postReviews` | Create a new review | body:postReviews* | 201 Api_Entities_Review |
| `GET /reviews/{id}` | `getReviewsId` | Get a review | path:id*; query:hide_users; query:hide_files | 200 Api_Entities_Review |
| `PUT /reviews/{id}` | `putReviewsId` | Update a review | path:id*; body:putReviewsId* | 200 Api_Entities_Review |
| `DELETE /reviews/{id}` | `deleteReviewsId` | Delete a review | path:id* | 204 |
| `POST /reviews/{id}/notify_users` | `postReviewsIdNotifyUsers` | Notify users with a message | path:id*; body:postReviewsIdNotifyUsers* | 201 |
| `GET /reviews/{review_id}/files` | `getReviewsReviewIdFiles` | Get a list of all review files | path:review_id*; query:search; query:nest_files; query:page; query:per_page | 200 Api_Entities_ReviewFile |
| `POST /reviews/{review_id}/files` | `postReviewsReviewIdFiles` | Create a new review file (use either review_file or review_file_url) | path:review_id*; body:postReviewsReviewIdFiles* | 201 Api_Entities_ReviewFile |
| `GET /reviews/{review_id}/files/{review_file_id}` | `getReviewsReviewIdFilesReviewFileId` | Get a single review file | path:review_id*; path:review_file_id* | 200 Api_Entities_ReviewFile |
| `PUT /reviews/{review_id}/files/{review_file_id}` | `putReviewsReviewIdFilesReviewFileId` | Update review file | path:review_id*; path:review_file_id*; body:putReviewsReviewIdFilesReviewFileId* | 200 Api_Entities_ReviewFile |
| `DELETE /reviews/{review_id}/files/{review_file_id}` | `deleteReviewsReviewIdFilesReviewFileId` | Delete a review file | path:review_id*; path:review_file_id*; query:delete_all_versions | 204 |
| `POST /reviews/{review_id}/files/{review_file_id}/remote` | `postReviewsReviewIdFilesReviewFileIdRemote` | Add a new remote version | path:review_id*; path:review_file_id*; body:postReviewsReviewIdFilesReviewFileIdRemote* | 201 |
| `POST /reviews/{review_id}/files/batch/lock` | `postReviewsReviewIdFilesBatchLock` | Batch Lock files | path:review_id*; body:postReviewsReviewIdFilesBatchLock* | 201 |
| `POST /reviews/{review_id}/files/batch/unlock` | `postReviewsReviewIdFilesBatchUnlock` | Batch Unlock files | path:review_id*; body:postReviewsReviewIdFilesBatchUnlock* | 201 |
| `POST /reviews/{review_id}/files/batch/hide` | `postReviewsReviewIdFilesBatchHide` | Batch Hide files | path:review_id*; body:postReviewsReviewIdFilesBatchHide* | 201 |
| `POST /reviews/{review_id}/files/batch/unhide` | `postReviewsReviewIdFilesBatchUnhide` | Batch Unhide files | path:review_id*; body:postReviewsReviewIdFilesBatchUnhide* | 201 |
| `POST /reviews/{review_id}/files/batch/convert_to_external` | `postReviewsReviewIdFilesBatchConvertToExternal` | Batch Convert To External Versions | path:review_id*; body:postReviewsReviewIdFilesBatchConvertToExternal* | 201 |
| `POST /reviews/{review_id}/files/batch/convert_to_internal` | `postReviewsReviewIdFilesBatchConvertToInternal` | Batch Convert To Internal Versions | path:review_id*; body:postReviewsReviewIdFilesBatchConvertToInternal* | 201 |
| `POST /reviews/{review_id}/files/batch/order` | `postReviewsReviewIdFilesBatchOrder` | Batch sort files | path:review_id*; body:postReviewsReviewIdFilesBatchOrder* | 201 |
| `POST /reviews/{review_id}/files/batch/delete` | `postReviewsReviewIdFilesBatchDelete` | Batch delete files | path:review_id*; body:postReviewsReviewIdFilesBatchDelete* | 201 |
| `POST /reviews/{review_id}/files/html/live` | `postReviewsReviewIdFilesHtmlLive` | Create a new HTML Live URL file | path:review_id*; body:postReviewsReviewIdFilesHtmlLive* | 201 |
| `POST /reviews/{review_id}/files/html/capture` | `postReviewsReviewIdFilesHtmlCapture` | Create a new HTML Capture file | path:review_id*; body:postReviewsReviewIdFilesHtmlCapture* | 201 |
| `POST /reviews/{review_id}/files/html/screenshot` | `postReviewsReviewIdFilesHtmlScreenshot` | Create a new HTML Screenshot | path:review_id*; body:postReviewsReviewIdFilesHtmlScreenshot* | 201 |
| `GET /reviews/{review_id}/users` | `getReviewsReviewIdUsers` | Get a list of users for the review | path:review_id* | 200 Api_Entities_ReviewUser |
| `POST /reviews/{review_id}/users` | `postReviewsReviewIdUsers` | Add a single user to the review | path:review_id*; body:postReviewsReviewIdUsers* | 201 Api_Entities_ReviewUser |
| `DELETE /reviews/{review_id}/users` | `deleteReviewsReviewIdUsers` | Delete a single user from the review | path:review_id*; query:email* | 204 |
| `PUT /reviews/{review_id}/users` | `putReviewsReviewIdUsers` | Update user approval status in the review | path:review_id*; body:putReviewsReviewIdUsers* | 200 |
| `GET /reviews/{review_id}/approvals` | `getReviewsReviewIdApprovals` | Get a list of decisions by users for the review | path:review_id* | 200 Api_Entities_ReviewApproval |
| `GET /reviews/{review_id}/approvals/approved` | `getReviewsReviewIdApprovalsApproved` | Get a list of approved by users for the review | path:review_id* | 200 |
| `GET /reviews/{review_id}/approvals/rejected` | `getReviewsReviewIdApprovalsRejected` | Get a list of rejected by users for the review | path:review_id* | 200 |
| `GET /reviews/{review_id}/approvals/approved-changes` | `getReviewsReviewIdApprovalsApprovedChanges` | Get a list of approved-changes by users for the review | path:review_id* | 200 |
| `GET /reviews/{review_id}/approvals/rejectedx` | `getReviewsReviewIdApprovalsRejectedx` | Get a list of rejectedx by users for the review | path:review_id* | 200 |
| `GET /reviews/{review_id}/approvals/pending` | `getReviewsReviewIdApprovalsPending` | Get a list of pending actions by users for the review | path:review_id* | 200 Api_Entities_ReviewApproval |
| `GET /reviews/{review_id}/webhooks` | `getReviewsReviewIdWebhooks` | Get a list of all webhooks | path:review_id*; formData:status | 200 Api_Entities_Webhook |
| `GET /reviews/{review_id}/webhooks/{uid}` | `getReviewsReviewIdWebhooksUid` | Get webhook by UID | path:review_id*; path:uid* | 200 Api_Entities_Webhook |
| `GET /reviews/{review_id}/notes` | `getReviewsReviewIdNotes` | Get a list of all notes from the most recent file versions | path:review_id* | 200 Api_Entities_Note |
| `GET /reviews/{review_id}/notes/all` | `getReviewsReviewIdNotesAll` | Get a list of all notes from all file versions | path:review_id* | 200 |
| `GET /reviews/{review_id}/notes/{note_id}` | `getReviewsReviewIdNotesNoteId` | Get note by note_id | path:review_id*; path:note_id* | 200 Api_Entities_Note |
| `POST /reviews/{review_id}/files/{file_id}/lock` | `postReviewsReviewIdFilesFileIdLock` | Lock file | path:review_id*; path:file_id* | 201 |
| `POST /reviews/{review_id}/files/{file_id}/unlock` | `postReviewsReviewIdFilesFileIdUnlock` | Unlock file | path:review_id*; path:file_id* | 201 |
| `POST /reviews/{review_id}/files/{file_id}/hide` | `postReviewsReviewIdFilesFileIdHide` | Hide file | path:review_id*; path:file_id* | 201 |
| `POST /reviews/{review_id}/files/{file_id}/unhide` | `postReviewsReviewIdFilesFileIdUnhide` | Unhide file | path:review_id*; path:file_id* | 201 |
| `POST /reviews/{review_id}/files/{file_id}/convert_to_external` | `postReviewsReviewIdFilesFileIdConvertToExternal` | Convert to External Version | path:review_id*; path:file_id* | 201 |
| `POST /reviews/{review_id}/files/{file_id}/convert_to_internal` | `postReviewsReviewIdFilesFileIdConvertToInternal` | Convert to internal Version | path:review_id*; path:file_id* | 201 |
| `GET /reviews/{review_id}/files/{file_id}/notes` | `getReviewsReviewIdFilesFileIdNotes` | Get a list of all notes | path:review_id*; path:file_id* | 200 Api_Entities_Note |
| `GET /reviews/{review_id}/files/{file_id}/notes/{note_id}` | `getReviewsReviewIdFilesFileIdNotesNoteId` | Get note by note_id | path:review_id*; path:file_id*; path:note_id* | 200 Api_Entities_Note |
| `GET /reviews/{review_id}/workflow` | `getReviewsReviewIdWorkflow` | Returns the review workflow | path:review_id* | 200 Api_Entities_Reviews_Workflow |
| `PUT /reviews/{review_id}/workflow` | `putReviewsReviewIdWorkflow` | Update workflow assignment | path:review_id*; body:putReviewsReviewIdWorkflow* | 200 |
| `DELETE /reviews/{review_id}/workflow` | `deleteReviewsReviewIdWorkflow` | Delete workflow assignment | path:review_id* | 204 |
| `GET /reviews/{review_id}/workflow/stages` | `getReviewsReviewIdWorkflowStages` | Get all stages | path:review_id*; formData:status | 200 Api_Entities_Reviews_Workflow_Stage |
| `GET /reviews/{review_id}/workflow/stages/{id}` | `getReviewsReviewIdWorkflowStagesId` | Get a stage | path:review_id*; path:id* | 200 Api_Entities_Reviews_Workflow_Stage |

### Account users (5)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /users` | `getUsers` | Get a list of users for the account | query:role; query:with_hidden; query:search | 200 Api_Entities_User |
| `POST /users` | `postUsers` | Create a new user | body:postUsers* | 201 Api_Entities_User |
| `GET /users/{id}` | `getUsersId` | Get a single user from the account | path:id* | 200 Api_Entities_User |
| `DELETE /users/{id}` | `deleteUsersId` | Delete a single user from the account | path:id* | 204 |
| `PUT /users/{id}` | `putUsersId` | Updates the user details | path:id*; body:putUsersId* | 200 Api_Entities_User |

### Clients and client teams (14)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /clients/default/team` | `getClientsDefaultTeam` | Get all default users | none | 200 |
| `POST /clients/default/team` | `postClientsDefaultTeam` | Create a default user | body:postClientsDefaultTeam* | 201 |
| `PUT /clients/default/team/{user_id}` | `putClientsDefaultTeamUserId` | Update a default user | path:user_id*; body:putClientsDefaultTeamUserId* | 200 Api_Entities_TeamUser |
| `DELETE /clients/default/team/{user_id}` | `deleteClientsDefaultTeamUserId` | No description supplied | path:user_id* | 204 |
| `GET /clients` | `getClients` | Get all clients | query:sort_by; query:sort_order; query:search | 200 |
| `POST /clients` | `postClients` | Create a client | body:postClients* | 201 |
| `GET /clients/{id}` | `getClientsId` | Get a client | path:id* | 200 Api_Entities_Client |
| `PUT /clients/{id}` | `putClientsId` | Update a client | path:id*; body:putClientsId* | 200 |
| `DELETE /clients/{id}` | `deleteClientsId` | Delete a client. Note that at least one of the parameters (delete_all, move_to_client_id) must be sent! | path:id*; query:delete_all; query:move_to_client_id | 204 |
| `GET /clients/{id}/projects` | `getClientsIdProjects` | Get projects from client | path:id* | 200 |
| `GET /clients/{id}/team` | `getClientsIdTeam` | Get all default users | path:id* | 200 |
| `POST /clients/{id}/team` | `postClientsIdTeam` | Create a default user | path:id*; body:postClientsIdTeam* | 201 |
| `PUT /clients/{id}/team/{user_id}` | `putClientsIdTeamUserId` | Update a default user | path:id*; path:user_id*; body:putClientsIdTeamUserId* | 200 Api_Entities_TeamUser |
| `DELETE /clients/{id}/team/{user_id}` | `deleteClientsIdTeamUserId` | No description supplied | path:id*; path:user_id* | 204 |

### Projects and project teams (13)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /projects/default/team` | `getProjectsDefaultTeam` | Get all default users | none | 200 |
| `POST /projects/default/team` | `postProjectsDefaultTeam` | Create a default user | body:postProjectsDefaultTeam* | 201 |
| `PUT /projects/default/team/{user_id}` | `putProjectsDefaultTeamUserId` | Update a default user | path:user_id*; body:putProjectsDefaultTeamUserId* | 200 Api_Entities_TeamUser |
| `DELETE /projects/default/team/{user_id}` | `deleteProjectsDefaultTeamUserId` | No description supplied | path:user_id* | 204 |
| `GET /projects` | `getProjects` | Get all projects | query:sort_by; query:sort_order; query:search | 200 |
| `POST /projects` | `postProjects` | Create a project | body:postProjects* | 201 |
| `GET /projects/{id}` | `getProjectsId` | Get a project | path:id* | 200 Api_Entities_Project |
| `PUT /projects/{id}` | `putProjectsId` | Update a project | path:id*; body:putProjectsId* | 200 |
| `DELETE /projects/{id}` | `deleteProjectsId` | Delete a project. Note that all associated reviews will be deleted | path:id* | 204 |
| `GET /projects/{id}/team` | `getProjectsIdTeam` | Get all default users | path:id* | 200 |
| `POST /projects/{id}/team` | `postProjectsIdTeam` | Create a default user | path:id*; body:postProjectsIdTeam* | 201 |
| `PUT /projects/{id}/team/{user_id}` | `putProjectsIdTeamUserId` | Update a default user | path:id*; path:user_id*; body:putProjectsIdTeamUserId* | 200 Api_Entities_TeamUser |
| `DELETE /projects/{id}/team/{user_id}` | `deleteProjectsIdTeamUserId` | No description supplied | path:id*; path:user_id* | 204 |

### Labels (8)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /labels` | `getLabels` | Get all labels | query:sort_by; query:sort_order; query:search | 200 |
| `POST /labels` | `postLabels` | Create a label | body:postLabels* | 201 |
| `GET /labels/{id}` | `getLabelsId` | Get a label | path:id* | 200 |
| `PUT /labels/{id}` | `putLabelsId` | Update a label | path:id*; body:putLabelsId* | 200 |
| `DELETE /labels/{id}` | `deleteLabelsId` | Delete a label | path:id* | 204 |
| `GET /labels/{id}/reviews` | `getLabelsIdReviews` | Get reviews with label assigned | path:id* | 200 |
| `GET /labels/{id}/files` | `getLabelsIdFiles` | Get files with label assigned | path:id* | 200 |
| `GET /labels/{id}/comments` | `getLabelsIdComments` | Get comments with label assigned | path:id* | 200 |

### Webhook delivery logs (2)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /webhooks` | `getWebhooks` | Get a list of all webhooks | formData:status | 200 Api_Entities_Webhook |
| `GET /webhooks/{uid}` | `getWebhooksUid` | Get webhook by UID | path:uid* | 200 Api_Entities_Webhook |

### Workflow templates (3)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /workflows` | `getWorkflows` | Get a list of all workflows | formData:status; query:sort_by; query:sort_order; query:search | 200 Api_Entities_Workflow |
| `GET /workflows/{id}` | `getWorkflowsId` | Get workflow by ID | path:id* | 200 Api_Entities_Webhook |
| `GET /workflows/{workflow_id}/stages` | `getWorkflowsWorkflowIdStages` | Get all stages | path:workflow_id* | 200 Api_Entities_Workflows_Stage |

### Authenticated profile (2)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /profile` | `getProfile` | Get my profile | none | 200 Api_Entities_Profile |
| `PUT /profile` | `putProfile` | Update my profile | body:putProfile* | 200 Api_Entities_Profile |

### Current-user-visible resources (29)

| Method and path | Operation ID | Documented function | Inputs | Success |
|---|---|---|---|---|
| `GET /my/clients` | `getMyClients` | Get all visible clients for the current user | query:sort_by; query:sort_order; query:search | 200 |
| `GET /my/clients/{id}` | `getMyClientsId` | Get a client | path:id* | 200 Api_Entities_Client |
| `GET /my/clients/{id}/projects` | `getMyClientsIdProjects` | Get all projects for the client | path:id* | 200 |
| `GET /my/projects` | `getMyProjects` | Get all projects | query:sort_by; query:sort_order; query:search | 200 |
| `GET /my/projects/{id}` | `getMyProjectsId` | Get a project | path:id* | 200 Api_Entities_Project |
| `GET /my/projects/{id}/reviews` | `getMyProjectsIdReviews` | Get reviews for a project | path:id* | 200 Api_Entities_Review |
| `GET /my/reviews` | `getMyReviews` | Get all reviews | query:sort_by; query:sort_order; query:filter_by_approval; query:filter_by_status; query:term; query:hide_users; query:hide_files | 200 |
| `POST /my/reviews` | `postMyReviews` | Create a new review | body:postMyReviews* | 201 Api_Entities_Review |
| `GET /my/reviews/{id}` | `getMyReviewsId` | Get a review | path:id*; query:hide_users; query:hide_files | 200 Api_Entities_Review |
| `PUT /my/reviews/{id}` | `putMyReviewsId` | Update a review | path:id*; body:putMyReviewsId* | 200 Api_Entities_Review |
| `DELETE /my/reviews/{id}` | `deleteMyReviewsId` | Delete a review | path:id* | 204 |
| `POST /my/reviews/{id}/notify_users` | `postMyReviewsIdNotifyUsers` | Notify users with a message | path:id*; body:postMyReviewsIdNotifyUsers* | 201 |
| `GET /my/reviews/{review_id}/files` | `getMyReviewsReviewIdFiles` | Get a list of all review files | path:review_id*; query:search; query:nest_files; query:page; query:per_page | 200 Api_Entities_ReviewFile |
| `POST /my/reviews/{review_id}/files` | `postMyReviewsReviewIdFiles` | Create a new review file (use either review_file or review_file_url) | path:review_id*; body:postMyReviewsReviewIdFiles* | 201 Api_Entities_ReviewFile |
| `GET /my/reviews/{review_id}/files/{review_file_id}` | `getMyReviewsReviewIdFilesReviewFileId` | Get a single review file | path:review_id*; path:review_file_id* | 200 Api_Entities_ReviewFile |
| `PUT /my/reviews/{review_id}/files/{review_file_id}` | `putMyReviewsReviewIdFilesReviewFileId` | Update review file | path:review_id*; path:review_file_id*; body:putMyReviewsReviewIdFilesReviewFileId* | 200 Api_Entities_ReviewFile |
| `DELETE /my/reviews/{review_id}/files/{review_file_id}` | `deleteMyReviewsReviewIdFilesReviewFileId` | Delete a review file | path:review_id*; path:review_file_id*; query:delete_all_versions | 204 |
| `POST /my/reviews/{review_id}/files/{review_file_id}/remote` | `postMyReviewsReviewIdFilesReviewFileIdRemote` | Add a new remote version | path:review_id*; path:review_file_id*; body:postMyReviewsReviewIdFilesReviewFileIdRemote* | 201 |
| `POST /my/reviews/{review_id}/files/batch/lock` | `postMyReviewsReviewIdFilesBatchLock` | Batch Lock files | path:review_id*; body:postMyReviewsReviewIdFilesBatchLock* | 201 |
| `POST /my/reviews/{review_id}/files/batch/unlock` | `postMyReviewsReviewIdFilesBatchUnlock` | Batch Unlock files | path:review_id*; body:postMyReviewsReviewIdFilesBatchUnlock* | 201 |
| `POST /my/reviews/{review_id}/files/batch/hide` | `postMyReviewsReviewIdFilesBatchHide` | Batch Hide files | path:review_id*; body:postMyReviewsReviewIdFilesBatchHide* | 201 |
| `POST /my/reviews/{review_id}/files/batch/unhide` | `postMyReviewsReviewIdFilesBatchUnhide` | Batch Unhide files | path:review_id*; body:postMyReviewsReviewIdFilesBatchUnhide* | 201 |
| `POST /my/reviews/{review_id}/files/batch/convert_to_external` | `postMyReviewsReviewIdFilesBatchConvertToExternal` | Batch Convert To External Versions | path:review_id*; body:postMyReviewsReviewIdFilesBatchConvertToExternal* | 201 |
| `POST /my/reviews/{review_id}/files/batch/convert_to_internal` | `postMyReviewsReviewIdFilesBatchConvertToInternal` | Batch Convert To Internal Versions | path:review_id*; body:postMyReviewsReviewIdFilesBatchConvertToInternal* | 201 |
| `POST /my/reviews/{review_id}/files/batch/order` | `postMyReviewsReviewIdFilesBatchOrder` | Batch sort files | path:review_id*; body:postMyReviewsReviewIdFilesBatchOrder* | 201 |
| `POST /my/reviews/{review_id}/files/batch/delete` | `postMyReviewsReviewIdFilesBatchDelete` | Batch delete files | path:review_id*; body:postMyReviewsReviewIdFilesBatchDelete* | 201 |
| `POST /my/reviews/{review_id}/files/html/live` | `postMyReviewsReviewIdFilesHtmlLive` | Create a new HTML Live URL file | path:review_id*; body:postMyReviewsReviewIdFilesHtmlLive* | 201 |
| `POST /my/reviews/{review_id}/files/html/capture` | `postMyReviewsReviewIdFilesHtmlCapture` | Create a new HTML Capture file | path:review_id*; body:postMyReviewsReviewIdFilesHtmlCapture* | 201 |
| `POST /my/reviews/{review_id}/files/html/screenshot` | `postMyReviewsReviewIdFilesHtmlScreenshot` | Create a new HTML Screenshot | path:review_id*; body:postMyReviewsReviewIdFilesHtmlScreenshot* | 201 |


## Non-body parameter contract

| Parameter | Type / allowed values | Default | Used by |
|---|---|---|---|
| `query:sort_by` — Sort reviews by | string enum(updated_at, description, created_at, deadline_at, storage_used, created_by) | `updated_at` | `GET /reviews`, `GET /my/reviews` |
| `query:sort_order` — Order reviews | string enum(asc, desc) | `desc` | `GET /reviews`, `GET /my/reviews` |
| `query:filter_by_approval` — Filter reviews by approval | array<string enum(approved, approved-changes, pending, rejected, rejectedx)> | `approved, approved-changes, pending, rejected, rejectedx` | `GET /reviews`, `GET /my/reviews` |
| `query:filter_by_status` — Filter reviews by status | array<string enum(active, inactive, locked)> | `active, inactive, locked` | `GET /reviews`, `GET /my/reviews` |
| `query:term` — Search term here | string | not specified | `GET /reviews`, `GET /my/reviews` |
| `query:hide_users` — Hide users from response | boolean | not specified | `GET /reviews`, `GET /reviews/{id}`, `GET /my/reviews`, `GET /my/reviews/{id}` |
| `query:hide_files` — Hide files from response | boolean | not specified | `GET /reviews`, `GET /reviews/{id}`, `GET /my/reviews`, `GET /my/reviews/{id}` |
| `query:search` — Search term | string | not specified | `GET /reviews/{review_id}/files`, `GET /users`, `GET /clients`, `GET /projects`, `GET /labels`, `GET /workflows`, `GET /my/clients`, `GET /my/projects`, `GET /my/reviews/{review_id}/files` |
| `query:nest_files` — Return the list with nested files like the UI | boolean | `false` | `GET /reviews/{review_id}/files`, `GET /my/reviews/{review_id}/files` |
| `query:page` — Page of results to fetch | integer:int32 | not specified | `GET /reviews/{review_id}/files`, `GET /my/reviews/{review_id}/files` |
| `query:per_page` — Number of results to return per page | integer:int32 | not specified | `GET /reviews/{review_id}/files`, `GET /my/reviews/{review_id}/files` |
| `query:delete_all_versions` — Specify if you want to delete all versions or not | string | not specified | `DELETE /reviews/{review_id}/files/{review_file_id}`, `DELETE /my/reviews/{review_id}/files/{review_file_id}` |
| `query:email*` —  | string | not specified | `DELETE /reviews/{review_id}/users` |
| `formData:status` — Status of the Webhook | array<string enum(queued, success, error, retrying)> | `queued, success, error, retrying` | `GET /reviews/{review_id}/webhooks`, `GET /webhooks` |
| `formData:status` — Status of the stages | array<string enum(queued, current, approved)> | `queued, current, approved` | `GET /reviews/{review_id}/workflow/stages` |
| `query:role` — Filter by role | array<string enum(ADMIN, MANAGER, USER, REVIEWER, GUEST)> | `ADMIN, MANAGER, USER, REVIEWER, GUEST` | `GET /users` |
| `query:with_hidden` — Also return hidden users | boolean | `false` | `GET /users` |
| `query:sort_by` — Sort by | string enum(id, name) | `id` | `GET /clients`, `GET /projects`, `GET /labels`, `GET /workflows`, `GET /my/clients`, `GET /my/projects` |
| `query:sort_order` — Sort order | string enum(asc, desc) | `asc` | `GET /clients`, `GET /projects`, `GET /labels`, `GET /workflows`, `GET /my/clients`, `GET /my/projects` |
| `query:delete_all` — Set this to true if you want to delete the client and all associated projects/reviews | boolean | not specified | `DELETE /clients/{id}` |
| `query:move_to_client_id` — Specify the ID of the new client where projects/reviews should be moved to | integer:int32 | not specified | `DELETE /clients/{id}` |
| `formData:status` — Status of the workflow | array<string enum(inactive, active)> | `inactive, active` | `GET /workflows` |


## Request-body contracts

An asterisk in this section is represented by placement in “Required fields.” Models with identical contracts are grouped. Swagger's declared requirements are recorded exactly even when contradictory.

| Request model(s) | Required fields | Optional fields and constraints |
|---|---|---|
| `putAccountReviewSettings` | none declared | `time_limit_to_edit_annotations` (integer:int32 enum(0, 300000, 1800000, 3600000, 5400000, 7200000, 21600000, 86400000)) — Time in milliseconds to allow editing annotations. Pass null for unlimited time; `time_limit_to_edit_approval` (integer:int32 enum(0, 300000, 1800000, 3600000, 5400000, 7200000, 21600000, 86400000)) — Time in milliseconds to allow editing approval decisions. Pass null for unlimited time; `offer_extension` (boolean) — Offer to install extension; `print_all_pages` (boolean) — Whether all pages should be printed or only pages with comments; `approvals` (array<string enum(rejected, approved-changes, rejectedx)>) — Available Approval Options; `one_click_approval` (boolean) — Enable condensed approval panel; `allow_approval_confirmation` (boolean) — Allow users to leave a message when approving content; `show_confirmation_message` (boolean) — Show confirmation message when approving content; `confirmation_message` (string) — Confirmation Message |
| `putAccountReviewDefaults` | none declared | `allow_download` (boolean) — Allow File Downloads; `allow_guest_access` (boolean) — Anyone with the link can access; `deadline_active` (boolean) — Set Review Deadline; `enable_private_mode` (boolean) — Activate Privacy Options; `private_mode` (string enum(exclusive, inclusive)) — Private mode; `enable_ratings` (boolean) — Activate File Ratings; `guests_can_approve` (boolean) — Newly added Guests are Approvers; `number_of_approvals` (string enum(all_approvers, any_approver)) — Activate File Ratings; `reminder_type` (string enum(multiple, single)) — Deadline Reminder Frequency; `send_deadline_reminder` (boolean) — Send Reminder; `status_after_deadline` (string enum(active, inactive, locked)) — After deadline set Review status to:; `thumb_size` (string enum(cover, contain)) — Fit Image in Thumbnail; `video_encoding_enabled` (boolean) — Enable Video Encoding |
| `postReviews`, `postMyReviews` | `deadline_at` (string:date-time) — Deadline date (This parameter is only required if deadline_active is set to true); `status_after_deadline` (string enum(active, inactive, locked)) — Status to set after deadline (This parameter is only required if deadline_active is set to true) | `description` (string) — Review description; `video_encoding_enabled` (boolean) — Enable video encoding?; `allow_download` (boolean) — Allow download?; `allow_guest_access` (boolean) — Allow guest access?; `guests_can_approve` (boolean) — Guests can approve?; `reviewers` (array<string>) — Array of reviewer emails.; `enable_private_mode` (boolean) — Enable private mode for the review; `private_mode` (string enum(exclusive, inclusive)) — Private mode type; `guests_are_external_users` (boolean) — Whether guests are external users or not; `password` (string) — Password for guest access; `labels` (array<string>) — Array of labels to add to the review (note that this will replace all existing labels); `deadline_active` (boolean) — Enable deadline; `send_deadline_reminder` (boolean) — Whether a deadline reminder should be sent; `sort_files_by` (string enum(manual, name, created_at)) — Sort files by the following field; `sort_files_order` (string enum(asc, desc)) — Sort files order; `webhook_url` (string) — URL to send webhook events for this review; `number_of_approvals` (string enum(all_approvers, any_approver)) — Approval requirement for the review; `thumb_size` (string enum(cover, contain)) — Fit (contain) the thumbnail; `status` (string enum(active, inactive, locked)) — Status of the review; `enable_ratings` (boolean) — Enable star ratings; `project_id` (integer:int32) — ID of the project.; `project_name` (string) — Name of the project.; `review_files` (array<string>) — Array of review files.; `urls` (array<string>) — Array of URLs to create review files.; `skip_team` (boolean) — Don't apply the default team to this review |
| `putReviewsId`, `putMyReviewsId` | `deadline_at` (string:date-time) — Deadline date (This parameter is only required if deadline_active is set to true); `status_after_deadline` (string enum(active, inactive, locked)) — Status to set after deadline (This parameter is only required if deadline_active is set to true) | `project_id` (integer:int32) — ID of the project.; `description` (string) — Review description; `video_encoding_enabled` (boolean) — Enable video encoding?; `allow_download` (boolean) — Allow download?; `allow_guest_access` (boolean) — Allow guest access?; `guests_can_approve` (boolean) — Guests can approve?; `reviewers` (array<string>) — Array of reviewer emails.; `enable_private_mode` (boolean) — Enable private mode for the review; `private_mode` (string enum(exclusive, inclusive)) — Private mode type; `guests_are_external_users` (boolean) — Whether guests are external users or not; `password` (string) — Password for guest access; `labels` (array<string>) — Array of labels to add to the review (note that this will replace all existing labels); `deadline_active` (boolean) — Enable deadline; `send_deadline_reminder` (boolean) — Whether a deadline reminder should be sent; `sort_files_by` (string enum(manual, name, created_at)) — Sort files by the following field; `sort_files_order` (string enum(asc, desc)) — Sort files order; `webhook_url` (string) — URL to send webhook events for this review; `number_of_approvals` (string enum(all_approvers, any_approver)) — Approval requirement for the review; `thumb_size` (string enum(cover, contain)) — Fit (contain) the thumbnail; `status` (string enum(active, inactive, locked)) — Status of the review; `enable_ratings` (boolean) — Enable star ratings |
| `postReviewsIdNotifyUsers`, `postMyReviewsIdNotifyUsers` | `emails` (array<string>) — Emails of the users to notify | `message` (string) — Message to include |
| `postReviewsReviewIdFiles`, `postMyReviewsReviewIdFiles` | none declared | `name` (string) — Name of the file; `review_file` (file) — Local file to upload; `review_file_url` (string) — URL to a remote file; `file_type` (string) — The file type of the file. If this parameter is empty we will try to find the appropriate file type; `source` (string enum(file, html-zip, html-live, html-capture, html-image-capture, stq-banner)) — This parameter can be used to specify what the file might contain or be. For example, you might be uploading a zip that contains a HTML page so you would pass html_zip here.; `order` (integer:int32) — File order in list |
| `putReviewsReviewIdFilesReviewFileId`, `putMyReviewsReviewIdFilesReviewFileId` | none declared | `name` (string) — Name of the file; `review_file` (file) — Local file to upload; `review_file_url` (string) — URL to a remote file; `file_type` (string) — The file type of the file. If this parameter is empty we will try to find the appropriate file type; `source` (string enum(file, html-zip, html-live, html-capture, html-image-capture, stq-banner)) — This parameter can be used to specify what the file might contain or be. For example, you might be uploading a zip that contains a HTML page so you would pass html_zip here.; `order` (integer:int32) — File order in list; `overwrite` (boolean) — Should the file be overwritten |
| `postReviewsReviewIdFilesReviewFileIdRemote`, `postMyReviewsReviewIdFilesReviewFileIdRemote` | `url` (string) — URL for the file; `thumbnail_url` (string) — URL for the file thumbnail; `file_type` (string) — File type; `name` (string) — File name | `size` (integer:int32) — Size of the file; `source` (string enum(file, html-zip, html-live, html-capture, html-image-capture, stq-banner)) — This parameter can be used to specify what the file might contain or be. For example, you might be uploading a zip that contains a HTML page so you would pass html_zip here.; `uuid` (string) — UUID of the asset; `version_uuid` (string) — UUID of the asset version; `details` (json) |
| `postReviewsReviewIdFilesBatchLock`, `postMyReviewsReviewIdFilesBatchLock` | `ids` (array<string>) — IDs of files to apply batch actions | none |
| `postReviewsReviewIdFilesBatchUnlock`, `postMyReviewsReviewIdFilesBatchUnlock` | `ids` (array<string>) — IDs of files to apply batch actions | none |
| `postReviewsReviewIdFilesBatchHide`, `postMyReviewsReviewIdFilesBatchHide` | `ids` (array<string>) — IDs of files to apply batch actions | none |
| `postReviewsReviewIdFilesBatchUnhide`, `postMyReviewsReviewIdFilesBatchUnhide` | `ids` (array<string>) — IDs of files to apply batch actions | none |
| `postReviewsReviewIdFilesBatchConvertToExternal`, `postMyReviewsReviewIdFilesBatchConvertToExternal` | `ids` (array<string>) — IDs of files to apply batch actions | none |
| `postReviewsReviewIdFilesBatchConvertToInternal`, `postMyReviewsReviewIdFilesBatchConvertToInternal` | `ids` (array<string>) — IDs of files to apply batch actions | none |
| `postReviewsReviewIdFilesBatchOrder`, `postMyReviewsReviewIdFilesBatchOrder` | `ids` (array<string>) — IDs of files to apply batch actions | none |
| `postReviewsReviewIdFilesBatchDelete`, `postMyReviewsReviewIdFilesBatchDelete` | `ids` (array<string>) — IDs of files to apply batch actions | none |
| `postReviewsReviewIdFilesHtmlLive`, `postMyReviewsReviewIdFilesHtmlLive` | `resolutions` (array<string enum(1024x768, 1280x800, 1280x1024, 1366x768, 1920x1080, 2560x1440, 3840x2160, 320x480, 375x667, 480x800, 480x854, 540x960, 640x960, 640x1136, 720x1280, 750x1334, 1080x1920, 1440x2560, 2160x3840)>) — Specify the resolutions to capture; `pages` (array<string>) — List of URLs to capture (each URL needs to start with http:// or https://) | `restrict` (boolean) — Live URL Navigation: |
| `postReviewsReviewIdFilesHtmlCapture`, `postMyReviewsReviewIdFilesHtmlCapture` | `resolutions` (array<string enum(1024x768, 1280x800, 1280x1024, 1366x768, 1920x1080, 2560x1440, 3840x2160, 320x480, 375x667, 480x800, 480x854, 540x960, 640x960, 640x1136, 720x1280, 750x1334, 1080x1920, 1440x2560, 2160x3840)>) — Specify the resolutions to capture; `pages` (array<string>) — List of URLs to capture (each URL needs to start with http:// or https://) | none |
| `postReviewsReviewIdFilesHtmlScreenshot`, `postMyReviewsReviewIdFilesHtmlScreenshot` | `resolutions` (array<string enum(1024x768, 1280x800, 1280x1024, 1366x768, 1920x1080, 2560x1440, 3840x2160, 320x480, 375x667, 480x800, 480x854, 540x960, 640x960, 640x1136, 720x1280, 750x1334, 1080x1920, 1440x2560, 2160x3840)>) — Specify the resolutions to capture; `pages` (array<string>) — List of URLs to capture (each URL needs to start with http:// or https://) | none |
| `postReviewsReviewIdUsers` | `email` (string) | `can_approve` (boolean); `external` (boolean) — Define whether user is external or not (note that for guests this parameter is ignored and the review guests_are_external_users is used instead) |
| `putReviewsReviewIdUsers` | `email` (string); `can_approve` (boolean) | none |
| `putReviewsReviewIdWorkflow` | `workflow_id` (integer:int32) — ID of the workflow to assign | none |
| `postUsers` | `email` (string); `role` (string); `first_name` (string) — Required only if role is not GUEST; `last_name` (string) — Required only if role is not GUEST; `password` (string) — Required only if role is not GUEST | `notify_on_tasks` (string); `notify_on_approval` (string); `notify_on_new_notes` (string); `hidden` (boolean) — Whether user should be shown in dropdowns |
| `putUsersId` | none declared | `first_name` (string); `last_name` (string); `email` (string); `role` (string); `password` (string); `notify_on_tasks` (string); `notify_on_approval` (string); `notify_on_new_notes` (string); `hidden` (boolean) — Whether user should be shown in dropdowns |
| `postClientsDefaultTeam`, `postClientsIdTeam`, `postProjectsDefaultTeam`, `postProjectsIdTeam` | none declared | `user_id` (integer:int32) — ID of the user; `email` (string) — Email of the user; `approver` (boolean) — Should user be an approver |
| `putClientsDefaultTeamUserId`, `putClientsIdTeamUserId`, `putProjectsDefaultTeamUserId`, `putProjectsIdTeamUserId` | `approver` (boolean) — Should user be an approver | none |
| `postClients` | `name` (string) — Name of the client | none |
| `putClientsId` | none declared | `name` (string) — New name |
| `postProjects` | `name` (string) — Name of the project; `client_id` (integer:int32) — ID of the client | none |
| `putProjectsId` | none declared | `name` (string) — New name; `client_id` (integer:int32) — ID of the client |
| `postLabels` | `name` (string) — Label name | `color` (string enum(#C7F1DC, #F4E7A6, #F9E0CB, #F8D9D4, #DED9FB, #73CA9A, #EED15B, #F0AA6C, #E67C6D, #9E8FEB, #43835C, #8E711E, #B45C1C, #B84835, #6D5DC1, #D1DFFD, #CFECFB, #D9F0AE, #F6D2EB, #EDEDED, #6D9AFA, #83C0DE, #9FC755, #D77CB9, #8890A2, #3563DF, #417A98, #637D30, #A14F85, #667084)) — Label color; `reviews` (boolean) — Enable label for reviews; `files` (boolean) — Enable label for files; `comments` (boolean) — Enable label for comments |
| `putLabelsId` | `name` (string) — Label name | `color` (string enum(#C7F1DC, #F4E7A6, #F9E0CB, #F8D9D4, #DED9FB, #73CA9A, #EED15B, #F0AA6C, #E67C6D, #9E8FEB, #43835C, #8E711E, #B45C1C, #B84835, #6D5DC1, #D1DFFD, #CFECFB, #D9F0AE, #F6D2EB, #EDEDED, #6D9AFA, #83C0DE, #9FC755, #D77CB9, #8890A2, #3563DF, #417A98, #637D30, #A14F85, #667084)) — Label color; `reviews` (boolean) — Enable label for reviews; `files` (boolean) — Enable label for files; `comments` (boolean) — Enable label for comments |
| `putProfile` | none declared | `first_name` (string) — My first name; `last_name` (string) — My last name; `notify_on_approval` (string) — Notify me on approval; `notify_on_new_notes` (string) — Notify me on new notes; `notify_on_tasks` (string) — Notify me on tasks; `password` (string) — My password |


## Documented response entities

An asterisk marks a field listed in the entity's Swagger `required` array. Several models contain obvious type inconsistencies; use this as a discovery schema, not as unchecked production validation.

| Response model | Documented fields |
|---|---|
| `Api_Entities_Account_Review_Settings` | `time_limit_to_edit_annotations*` (integer:int32); `time_limit_to_edit_approval*` (integer:int32); `approvals*` (string); `allow_approval_confirmation*` (boolean); `show_confirmation_message*` (boolean); `confirmation_message*` (string); `one_click_approval*` (boolean); `print_all_pages*` (boolean); `offer_extension*` (boolean) |
| `Api_Entities_Account_Review_Defaults` | `allow_download*` (boolean); `allow_guest_access*` (boolean); `deadline_active*` (boolean); `enable_private_mode` (boolean); `private_mode` (string); `enable_ratings*` (boolean); `guests_can_approve*` (boolean); `number_of_approvals*` (string); `reminder_type*` (string); `send_deadline_reminder*` (boolean); `status_after_deadline*` (string); `thumb_size*` (string); `video_encoding_enabled*` (boolean) |
| `Api_Entities_Review` | `id*` (integer:int32 enum(1, 2, 3, 4)); `client*` (Api_Entities_Client); `client_name*` (string); `project*` (Api_Entities_Project); `project_name*` (string); `description*` (string); `url*` (string); `guest_url` (string); `featured_file_thumbnail` (string); `enable_private_mode*` (boolean); `private_mode` (string enum(exclusive, inclusive)); `video_encoding_enabled*` (boolean); `allow_download*` (boolean); `allow_guest_access*` (boolean); `guests_can_approve*` (boolean); `guests_are_external_users*` (boolean); `password*` (string); `status*` (string enum(active, inactive, locked)); `approval*` (string enum(pending, approved, rejected)); `reviewers` (string); `users` (Api_Entities_ReviewUser); `review_files` (Api_Entities_ReviewFile); `file_count*` (integer:int32); `has_files*` (boolean); `webhook_url*` (string); `deadline_active*` (boolean); `status_after_deadline*` (string enum(active, inactive, locked)); `deadline_at*` (string:date-time); `labels*` (string); `sort_files_by*` (string enum(manual, name, created_at)); `sort_files_order*` (string enum(asc, desc)); `owner*` (unknown); `comments_count*` (string); `tasks_count*` (integer:int32); `open_tasks_count*` (integer:int32); `completed_tasks_count*` (integer:int32); `my_open_tasks_count` (integer:int32); `number_of_approvals*` (string); `thumb_size*` (string); `send_deadline_reminder*` (boolean); `enable_ratings*` (boolean); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_Client` | `id*` (integer:int32); `name*` (string); `projects_count*` (integer:int32); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_Project` | `id*` (integer:int32); `name*` (string); `client_id*` (integer:int32); `client_name*` (string); `reviews_count*` (integer:int32); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_ReviewUser` | `id*` (integer:int32); `name*` (string); `email*` (string); `role*` (string); `approvals*` (string); `can_approve*` (boolean); `external` (boolean); `initials*` (string); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_ReviewFile` | `id*` (integer:int32 enum(1, 2, 3, 4)); `review_id*` (integer:int32 enum(1, 2, 3, 4)); `original_name*` (string); `name*` (string); `order*` (integer:int32 enum(0, 1, 2)); `size*` (integer:int32 enum(1099, 46890)); `file_type*` (string enum(image/svg+xml, application/pdf, image/jpeg)); `video_frame_rate*` (string enum(30.0)); `url*` (string); `thumbnail_url*` (string); `encoding_size*` (integer:int32 enum(3467280)); `video_bitrate*` (integer:int32 enum(818138)); `video_dimensions*` (string enum(368x272)); `version_number*` (integer:int32 enum(1, 2, 3)); `approval*` (string); `previous_version_id` (integer:int32); `previous_versions` (Api_Entities_ReviewFileChildren); `review_url*` (string); `hidden*` (boolean); `locked*` (boolean enum(active, locked)); `processing_status*` (string enum(processing, complete, error)); `metadata*` (object); `owner*` (unknown); `uuid` (string); `version_uuid` (string); `media_id` (string); `template_id` (string); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_ReviewFileChildren` | `id*` (integer:int32 enum(1, 2, 3, 4)); `original_name*` (string); `name*` (string); `order*` (integer:int32 enum(0, 1, 2)); `size*` (integer:int32 enum(1099, 46890)); `file_type*` (string enum(image/svg+xml, application/pdf, image/jpeg)); `video_frame_rate*` (string enum(30.0)); `url*` (string); `thumbnail_url*` (string); `encoding_size*` (integer:int32 enum(3467280)); `video_bitrate*` (integer:int32 enum(818138)); `video_dimensions*` (string enum(368x272)); `version_number*` (integer:int32 enum(1, 2, 3)); `approval*` (string); `hidden*` (boolean); `locked*` (boolean enum(active, locked)); `processing_status*` (string enum(processing, complete, error)); `metadata*` (object); `owner*` (unknown); `uuid` (string); `version_uuid` (string); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_UserBrief` | `id*` (integer:int32); `name*` (string); `email*` (string) |
| `Api_Entities_ReviewApproval` | `id*` (integer:int32); `name*` (string); `email*` (string); `approved` (string); `rejected` (string); `approved-changes` (string); `rejectedx` (string); `pending` (string) |
| `Api_Entities_Webhook` | `id*` (string); `uid*` (string); `body*` (json); `response*` (json); `status*` (string); `url*` (string); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_Note` | `note_id*` (string); `parent_id` (string); `file*` (Api_Entities_ReviewFileBrief); `user*` (Api_Entities_UserBrief); `html*` (string); `plain_text*` (string); `frame` (number:float); `replies*` (Api_Entities_Reply); `url*` (string) |
| `Api_Entities_ReviewFileBrief` | `id*` (integer:int32 enum(1, 2, 3, 4)); `review_id*` (integer:int32 enum(1, 2, 3, 4)); `original_name*` (string) |
| `Api_Entities_Reply` | `note_id*` (string); `user*` (Api_Entities_UserBrief); `html*` (string); `plain_text*` (string); `url*` (string) |
| `Api_Entities_Reviews_Workflow` | `current_stage_id*` (integer:int32); `completed_at` (string:date-time); `workflow_id*` (integer:int32); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_Reviews_Workflow_Stage` | `id*` (integer:int32); `position*` (integer:int32); `status*` (string); `ended_at` (string:date-time); `next_stage_id*` (integer:int32); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_User` | `id*` (integer:int32); `name*` (string); `email*` (string); `role*` (string enum(ADMIN, COLLABORATOR, REVIEWER, GUEST)); `notify_on_approval*` (string); `notify_on_new_notes*` (string); `notify_on_tasks*` (string); `files*` (string); `approvals*` (string); `hidden*` (boolean); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_TeamUser` | `user*` (Api_Entities_User); `approver*` (boolean) |
| `Api_Entities_Workflow` | `id*` (integer:int32); `name*` (string); `status*` (string); `active_reviews_count*` (integer:int32); `completed_reviews_count*` (integer:int32); `reviews_count*` (integer:int32); `stages*` (Api_Entities_Workflows_Stage); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_Workflows_Stage` | `id*` (integer:int32); `name*` (string); `allow_guest_access*` (boolean); `deadline_active*` (boolean); `deadline_time*` (string:date-time); `deadline_days*` (integer:int32); `goal*` (string); `guests_are_private_users*` (boolean); `current_reviews_count*` (integer:int32); `approved_reviews_count*` (integer:int32); `queued_reviews_count*` (integer:int32); `position*` (integer:int32); `stage_users*` (Api_Entities_Workflows_Stages_User); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_Workflows_Stages_User` | `id*` (integer:int32); `approver*` (boolean); `private_user*` (boolean); `template` (string); `user*` (Api_Entities_User); `created_at*` (string:date-time); `updated_at*` (string:date-time) |
| `Api_Entities_Profile` | `name*` (string); `email*` (string); `role*` (string enum(ADMIN, COLLABORATOR, REVIEWER, GUEST)); `notify_on_approval*` (string); `notify_on_new_notes*` (string); `notify_on_tasks*` (string); `created_at*` (string:date-time); `updated_at*` (string:date-time) |


## File upload and versioning guidance

### Initial file

Preferred production request:

~~~http
POST /api/reviews/{review_id}/files
X-REVIEWSTUDIO-EMAIL: <server secret>
X-REVIEWSTUDIO-TOKEN: <server secret>
Content-Type: application/json
Accept: application/json
~~~

~~~json
{
  "name": "manuscript.pdf",
  "review_file_url": "<short-lived-signed-url>",
  "source": "file",
  "order": 0
}
~~~

Use a second call for the cover with `order: 1`.

### Why URL upload is preferred

The Swagger operation declares `application/json`, yet the request model contains `review_file` with Swagger type `file`. In Swagger 2.0, a normal binary file parameter is generally a `formData` member consumed as `multipart/form-data`, not a property inside a JSON body. The field name is documented, but the direct-binary transport is internally inconsistent. Do not finalize multipart code without an isolated live contract test or written confirmation from ReviewStudio.

### Processing

Store the returned `Api_Entities_ReviewFile.id`, then poll:

`GET /reviews/{review_id}/files/{review_file_id}`

Terminal states documented by the response entity:

- `complete`
- `error`

Nonterminal state:

- `processing`

The API does not document a file-processing-complete webhook. Polling is therefore required unless live evidence establishes an additional event.

### New versions

Two documented mechanisms exist:

- `PUT /reviews/{review_id}/files/{review_file_id}` accepts `review_file` or `review_file_url`, plus `overwrite`.
- `POST /reviews/{review_id}/files/{review_file_id}/remote` adds a remote version but requires a permanent asset URL, thumbnail URL, file type, and name.

For normal manuscript/cover revisions, contract-test the PUT route first. Treat `overwrite` semantics as unconfirmed until tested; do not assume whether `false`, `true`, or omission preserves prior versions.

## Review settings and decisions

Review status values:

- `active`
- `inactive`
- `locked`

Review approval filters:

- `approved`
- `approved-changes`
- `pending`
- `rejected`
- `rejectedx`

The official product guide currently describes four user-facing decisions: Approved, Approve with Changes, Revisions Required, and Rejected. The API's likely mapping is:

| API token | Likely UI label | Confidence |
|---|---|---|
| `approved` | Approved | High |
| `approved-changes` | Approve with Changes | High |
| `rejected` | Rejected | High |
| `rejectedx` | Revisions Required | Inference; confirm with one fixture |
| `pending` | No decision yet | High |

Keep `rejectedx` exactly as the server token. Do not “correct” its spelling in URLs or payload parsing. Separate raw API tokens from user-facing labels.

The account settings update model allows the optional approval choices `rejected`, `approved-changes`, and `rejectedx`; Approved appears to be the always-present base action. This is an inference from the contract and should not be used to rewrite account settings without a deliberate admin action.

## Outbound webhook contract

Documented event names:

- `note_added`
- `note_edited`
- `note_removed`
- `reply_added`
- `reply_edited`
- `reply_removed`
- `approval`
- `task_added`
- `task_edited`
- `task_completed`

Fields documented on all events:

- `review_id`
- `review_file_id`
- `client_id`
- `project_id`
- `event`
- `permalink`

Conditional fields:

- `reviewer_id` on note, reply, and approval activity.
- `note` on note add/edit, reply add/edit, and approval.
- `note_id` on note add/edit/remove.
- `parent_id` and `reply_id` on reply add/edit/remove.
- `task` on task add/edit/complete.
- `assignee_user_id`, `assignee_name`, and `assignee_email` on task_added.
- `approved` boolean on approval.

Important webhook limitations:

- The public webhook page does not document a signature header, shared-secret algorithm, delivery ID, timestamp, replay window, retry count, retry schedule, or required success response.
- The REST webhook-log status filter lists `queued`, `success`, `error`, and `retrying`, which suggests delivery retries but does not define their timing.
- The `approval` payload's boolean is too narrow to distinguish all four current UI decisions. Reconcile using the approval GET endpoints.
- No file-processing event is documented.
- Task edited/completed payloads do not document a task ID or assignee fields.

Receiver rules:

- Use an unguessable per-environment webhook URL.
- If ReviewStudio account configuration permits a static secret in the URL or a custom header, use it; this is not promised by the published contract and must be verified.
- Reject unsupported methods and oversized bodies.
- Parse and store the raw payload plus a content hash before processing.
- Validate `event` against the allowlist and validate all ReviewStudio IDs against the book/review mappings.
- Deduplicate by delivery UID if one appears in real traffic; otherwise use a hash of stable payload fields plus a short time bucket and make every handler idempotent.
- Return success quickly, then process asynchronously.
- Periodically reconcile from ReviewStudio GET endpoints because webhooks are not a complete source of truth.
- Ask ReviewStudio support for official signature verification and retry documentation before calling the receiver cryptographically authenticated.

## Known specification defects and ambiguities

1. The file-upload operations claim JSON consumption while their models contain a `file` property.
2. Review create/update marks `deadline_at` and `status_after_deadline` required, while each description says it is required only when `deadline_active=true`.
3. `POST /projects` documents HTTP 201 but no response schema.
4. Many collection, mutation, and filtered-approval responses have no schema.
5. No 4xx/5xx response schemas are documented anywhere; only 200, 201, and 204 appear.
6. `GET /workflows/{id}` incorrectly declares `Api_Entities_Webhook` as its response model instead of a workflow model.
7. `GET /webhooks`, `GET /reviews/{id}/webhooks`, `GET /workflows`, and review-workflow stage listing describe `status` as `formData` on GET requests. Treat it as unverified; test whether the server expects repeated query keys, CSV, or another encoding.
8. Project IDs are integers in entities/create bodies but strings on several project update/delete/team path parameters.
9. The review entity models `users` and `review_files` as direct object references rather than arrays, even though the descriptions and operations imply collections.
10. The review entity models `reviewers` and `labels` as strings, while request models use arrays.
11. Account review settings returns `approvals` as a string but updates it as an array.
12. `ReviewFile.locked` is typed boolean but carries string enum examples `active` and `locked`.
13. User role filtering uses `ADMIN, MANAGER, USER, REVIEWER, GUEST`, while response entities document `ADMIN, COLLABORATOR, REVIEWER, GUEST`. User create/update has no enum.
14. Batch `ids` are typed as arrays of strings although file IDs are documented as integers.
15. `delete_all_versions` is typed as a string rather than a boolean.
16. The `rejectedx` decision token and path are unusual but consistently present. Preserve them verbatim.
17. HTML creation responses describe `error[]` and `success_ids[]` but provide no schema.
18. Pagination is only documented for file lists; page envelope shapes and total-count headers are not defined.
19. Rate limits, request-size limits, supported upload sizes, timeout guidance, and idempotency behavior are absent.
20. The API provides no documented webhook registration endpoint; `webhook_url` is a review property.
21. The source values include `html-image-capture`, while descriptions mention `html_zip` although the enum actually contains `html-zip`. Use enum values exactly.
22. No archival endpoint is documented. Deleting clients/projects/reviews/files is destructive; project deletion explicitly cascades to associated reviews.

## Defensive client rules

- Maintain local runtime validators that accept documented fields plus unknown fields; log schema drift without crashing.
- Do not generate a strict client from the Swagger file and trust it blindly.
- Parse IDs as opaque values at the adapter boundary, then normalize to strings in local persistence to tolerate integer/string inconsistencies.
- Treat 204 as success with no JSON body.
- For 200/201, inspect the content type and tolerate empty bodies where the schema is absent.
- Keep raw API token values separate from display labels.
- Encode array query parameters only after live tests establish the expected serialization.
- Never retry DELETE automatically.
- Retry GET safely. Retry POST/PUT only through a database idempotency record and reconciliation check.
- Before any destructive operation, confirm the stored ReviewStudio ID belongs to the current book/review round.
- Use `hide_users=true` and/or `hide_files=true` when only review metadata is needed.
- Prefer explicit file endpoints over nested `review_files` or `urls` in review creation because those arrays are under-specified.
- Treat labels on review update as full replacement, not append.
- For a client delete, require exactly one deliberate strategy: `delete_all=true` or `move_to_client_id=<id>`.
- Do not expose generic arbitrary-path proxying to browser clients.

## Contract-test checklist

Run these against a staging ReviewStudio project with throwaway resources and record sanitized fixtures:

1. Authenticate with the two documented headers; capture 401 and 403 formats.
2. List/create/get/update/delete a throwaway client.
3. Create a project and record the exact 201 body.
4. Create a no-deadline review and test omitted versus null deadline fields.
5. Create a review using `project_id`; separately test whether `project_name` creates/reuses a project.
6. Upload a PDF with `review_file_url`; confirm signed-URL fetch timing and response fields.
7. Test direct multipart upload only in staging and record the exact encoding.
8. Poll file processing through success and through a deliberately invalid URL.
9. Update a file with a new URL using each `overwrite` value and inspect version history.
10. Test remote-version creation and determine whether URLs must remain permanently accessible.
11. Verify file order on initial upload and exact `batch/order` semantics.
12. Add an existing user by ID, an existing user by email, and a guest by email; enforce exactly one identifier in our wrapper.
13. Toggle `can_approve`; confirm this changes eligibility only, not a submitted decision.
14. Trigger each approval choice in the UI and save GET responses to map `rejectedx`.
15. Add/edit/remove a note and reply in the UI; compare webhook payloads with note GET responses.
16. Trigger task add/edit/complete and determine stable task identity.
17. Record webhook headers, retries, duplicate behavior, timeouts, and what response code stops retries.
18. Test webhook status filters and array serialization.
19. Assign/remove an existing workflow and observe stage state changes.
20. Test `/my` visibility against account-wide endpoints.
21. Capture empty-body behavior for 201 mutations without response schemas.
22. Determine actual rate limits with vendor guidance, not aggressive load testing.
23. Confirm whether list endpoints paginate despite lacking page parameters.
24. Verify whether notifications reject emails not already shared on the review.

## Paste-ready research pass for the codebase

~~~text
REVIEWSTUDIO API RESEARCH PASS — API v2.1, account host iwdnow.reviewstudio.com, researched 2026-09-05

Use the attached/full ReviewStudio_API_v2.1_Research_Pass_2026-09-05.md as the API inventory. The authoritative live contract is:
- UI: https://iwdnow.reviewstudio.com/api/documentation/
- Swagger JSON: https://iwdnow.reviewstudio.com/api/docs

Hard rules:
1. Do not invent ReviewStudio endpoints. The documented surface contains 131 operations.
2. All ReviewStudio calls must run in Supabase Edge Functions/server code. Never expose X-REVIEWSTUDIO-EMAIL, X-REVIEWSTUDIO-TOKEN, signed webhook secrets, or service-role credentials to GHL/React/browser code.
3. Supabase remains authoritative for users/roles, book state, KDP segment decisions, review rounds, retries, and audit history.
4. There is no documented REST write method for comments/replies, approval decisions, tasks, workflow templates/stages, or standalone webhook registrations.
5. Use POST /reviews/{review_id}/files with review_file_url for normal uploads. Direct binary upload is contract-ambiguous and must not be implemented without a staging test.
6. Persist project_id, review_id, and review_file_id mappings immediately. Poll each file GET until processing_status is complete or error.
7. Handle webhooks as hints and reconcile through GET endpoints. No signature algorithm or file-processing event is officially documented.
8. Preserve raw tokens such as approved-changes and rejectedx verbatim. Do not rename them inside API requests.
9. Treat review labels on create/update as a full replacement.
10. Never build a generic browser-callable ReviewStudio proxy. Expose narrow business operations only.

First task:
- Audit the current codebase for every ReviewStudio call and produce a table with file, function, method/path, caller, credentials location, idempotency, persistence, and contract status.
- Compare those calls against the exhaustive endpoint registry in this research.
- Flag unsupported/invented endpoints, browser-exposed secrets, assumptions about undocumented response bodies, missing processing polling, missing ID persistence, unsafe retries, and webhook trust assumptions.
- Do not refactor yet.

Second task after the audit is approved:
- Centralize transport in a small reviewstudio/client module.
- Add narrow modules for projects, reviews, files, users, notes, approvals, workflows, and webhook reconciliation.
- Add runtime response validation that permits unknown fields.
- Add database-backed idempotency and structured operation logs.
- Add isolated staging contract tests for the ambiguities listed in the research.
- Preserve all existing KDP/Supabase business rules and avoid unrelated rewrites.
~~~

## Final decision for our app

The API is broad enough to support project/review creation, manuscript and cover transfer, version tracking, reviewer assignment, ReviewStudio notifications, read-only feedback synchronization, approval-status reconciliation, file controls, and workflow assignment.

It is **not** a general remote-control API for everything visible in the ReviewStudio UI. Our integration must use the documented REST methods for resource management, receive human activity through webhooks, reconcile through GET endpoints, and keep KDP business state in Supabase. That boundary will keep the implementation stable even when ReviewStudio UI behavior evolves.

