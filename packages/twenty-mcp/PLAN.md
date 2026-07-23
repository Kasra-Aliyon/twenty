# Twenty CRM MCP Server — Implementation Plan

> A standalone Model Context Protocol server that lets an LLM do (almost) everything a
> human can do in the Twenty main UI: browse and build companies, people, opportunities,
> tasks, notes, lists, and drive the extended outreach features (sequences, LinkedIn,
> Unibox). Settings/admin surfaces are intentionally out of scope.

Status: **Implemented** — see `README.md` for setup, delivered tools, verification,
packaging, and the intentionally deferred upload/direct-email surfaces.

---

## 0. TL;DR / Key Decisions

1. **Build a standalone Node/TypeScript MCP server** in `packages/twenty-mcp` named
   `twenty-mcp-server`. It talks to a running Twenty instance over HTTP — it is _not_
   compiled into the server.
2. **Three back-end channels**, chosen per operation:
   - **REST API** (`/rest/*`) → generic record CRUD for every object (standard + custom).
   - **Core GraphQL** (`/graphql`) → custom resolvers the REST layer can't reach: Unibox,
     global search, file upload, and batched/relational reads.
   - **Metadata API** (`/rest/metadata` + `/metadata` GraphQL) → schema discovery so tools
     work against custom objects/fields and validate input dynamically.
3. **Auth = Twenty API key** (a JWT) sent as `Authorization: Bearer <key>`. This unlocks
   REST + core GraphQL + the built-in MCP endpoint. **One caveat:** a few user-scoped
   resolvers (Unibox) are guarded by `UserAuthGuard` and may require a user access token
   instead of / in addition to an API key — see §7.
4. **Two-layer tool design:** a small set of _generic, metadata-driven_ CRUD tools that
   mechanically cover 100% of objects, **plus** a curated set of _specialized workflow
   tools_ for the high-value surfaces the user named (opportunities pipeline, sequences,
   enrollment, LinkedIn, Unibox, lists). Comprehensive coverage first, ergonomics second.
5. **Transport:** **`stdio` first** — the goal is to drive this from local coding agents
   (**Claude Code** and **Codex**), both of which speak MCP over stdio natively. Also ship
   stateless **streamable HTTP** from the same codebase as an optional single-shared-instance
   mode. See §7.1 for client wiring.
6. Deliver an **evaluation suite** (10 read-only Q&A) and MCPB/DXT packaging.

---

## 1. What the user asked for

> "…essentially I want this MCP to be able to do pretty much everything I can do in the UI:
> building, adding, editing companies, people, opportunities, sequences, lists. No need to
> implement/expose items in the settings, but pretty much everything in the main UI should
> be exposed."

**In scope (main UI):**

- CRM records: **Companies, People, Opportunities** (create / read / update / delete /
  restore / merge / dedupe / relate).
- **Tasks & Notes** (create, edit, complete, attach to records) — core UI objects.
- **Lists** (`recordList` + folders + members).
- **Sequences** (build sequences and steps, activate/pause, enroll people, track metrics).
- **LinkedIn** (connections, threads/messages, invitations, queued actions).
- **Unibox** (unified inbox: threads, contacts, add-to-CRM).
- Records of **any custom object** the workspace has defined.
- Cross-cutting: global search, timeline/activity, favorites-style lists, attachments/files,
  group-by / aggregation (kanban & board views).

**Out of scope (explicitly):** Settings & admin — data model editing (creating
objects/fields), members & roles, API keys, integrations, billing, workspace config,
security, and the workflow/automation builder. (These map to Twenty's Settings area and
the metadata-_write_ API. We still _read_ metadata for discovery.)

---

## 2. Architecture decision

### 2.1 Recommended: standalone external MCP server

We build `twenty-mcp-server` as an independent process that authenticates to a Twenty
instance with an API key and exposes first-class MCP tools.

**Why standalone (vs. extending the in-server MCP):**

- Twenty **already ships an in-server MCP endpoint** at `POST /mcp`
  (`packages/twenty-server/src/engine/api/mcp`). But it is built for Twenty's _internal_
  AI agent: it exposes meta-tools (`get_tool_catalog`, `execute_tool`, `load_skill`,
  `list_object_metadata_names`, `learn_tools`) that funnel all real work through a single
  `execute_tool` indirection over a `ToolRegistryService`. External clients get a poor
  discovery experience — one opaque dispatcher instead of named, typed tools.
- The user wants "everything in the UI" exposed as usable capabilities. First-class,
  well-named tools (`twenty_create_opportunity`, `twenty_enroll_person_in_sequence`) are
  far more discoverable and safer (per-tool schemas, annotations, confirmations) than a
  generic dispatcher.
- A standalone server decouples release cadence from the monorepo, works against any Twenty
  instance (self-hosted or cloud), and matches the empty `packages/twenty-mcp` scaffold.
- The MCP best-practices/reference stack (TS SDK, stdio + streamable HTTP, Zod) is designed
  for exactly this shape.

**Alternative (secondary option, documented for completeness):** register the same
capabilities as tools inside Twenty's `ToolRegistryService`. Then _both_ the internal agent
and the in-server MCP's `execute_tool` gain them "for free," and an external client could
reach them via `execute_tool`. Downside: everything stays behind `execute_tool`, coupling
to server internals, and no clean per-tool schemas for third-party MCP clients. **We keep
the standalone server as the primary deliverable and treat the in-server registry as a
possible future backend, not the interface.**

### 2.2 How the server reaches Twenty (channel selection)

```
                         ┌────────────────────────────────────────────┐
   MCP client            │              twenty-mcp-server              │
 (Claude Desktop, ...) ──┤  tools/  services/  schemas/  formatting/   │
        MCP (stdio/HTTP) │                                             │
                         └───────┬───────────────┬───────────────┬─────┘
                                 │ REST           │ core GraphQL  │ metadata
                                 ▼                ▼               ▼
                    /rest/{object}...     /graphql (unibox,   /rest/metadata,
                    CRUD, batch, merge,   search, uploadFile, /metadata GraphQL
                    duplicates, groupBy   relational reads)   (objects & fields)
                                 └───────── Twenty server ─────────┘
```

- **REST** is the default for record CRUD — clean verbs, one endpoint per object, supports
  `filter`, `orderBy`, `limit`, `depth`, `starting_after`/`ending_before` cursors,
  `groupBy`, `duplicates`, `merge`, `restore`, and `batch`.
- **Core GraphQL** is used only where REST cannot reach: `uniboxThreads`, `uniboxContacts`,
  `addUniboxContactsToCrm`, global `search`, `uploadFile`, and any place we want to fetch a
  record with several nested relations in one round trip.
- **Metadata** drives dynamic schema/validation and object discovery (so custom objects and
  custom fields Just Work).

### 2.3 Discovered Twenty API surface (reference)

REST core (`packages/twenty-server/src/engine/api/rest/core`), base path `/rest`:

| Operation           | Method + path                                                        |
| ------------------- | -------------------------------------------------------------------- |
| List / find many    | `GET /rest/{objectPlural}` (filter, order_by, limit, depth, cursors) |
| Find one            | `GET /rest/{objectPlural}/{id}`                                      |
| Group by            | `GET /rest/{objectPlural}/groupBy`                                   |
| Find duplicates     | `POST /rest/{objectPlural}/duplicates`                               |
| Create one          | `POST /rest/{objectPlural}`                                          |
| Create many (batch) | `POST /rest/batch/{objectPlural}`                                    |
| Update (partial)    | `PATCH /rest/{objectPlural}/{id}` (PUT also accepted)                |
| Merge               | `PATCH /rest/{objectPlural}/merge`                                   |
| Delete (soft)       | `DELETE /rest/{objectPlural}/{id}`                                   |
| Restore             | `PATCH /rest/restore/{objectPlural}/{id}`                            |

- Auth guard: `JwtAuthGuard` + `WorkspaceAuthGuard` + `CustomPermissionGuard`. API keys are
  JWTs (`ApiKeyTokenJwtPayload`, `jti` = key id) → `Authorization: Bearer <api-key>`.
- Hard delete / destroy handlers exist server-side (`rest-api-destroy-*`); confirm exposure.

Core GraphQL (`/graphql`): auto-generated per-object queries/mutations
(`createX`, `updateX`, `deleteX`, `xCollection`, `findDuplicates`, `merge`, aggregations),
**plus** custom resolvers: `UniboxResolver` (`uniboxThreads`, `uniboxContacts`,
`addUniboxContactsToCrm`), global `SearchResolver`, and `uploadFile`.

Metadata: `/rest/metadata` and `/metadata` GraphQL expose `objects` and `fields`
(names, types, enum options, relations) — the source of truth for dynamic tooling.

---

## 3. Data model coverage

Twenty is metadata-driven: every object is a `*.workspace-entity.ts` extending
`BaseWorkspaceEntity` (which supplies `id`, `createdAt`, `updatedAt`, `deletedAt`). The
server auto-generates REST + GraphQL for all of them. Below are the objects the MCP must
cover, with the fields that matter for tool design.

### 3.1 Core CRM objects

- **Company** — `name`, `domainName`, `linkedinLink`, `annualRevenue`, `employees`,
  `industry`, `keywords`, `companyPhone`, `technologies`, `segments`, `accountStatus`,
  `companyType`, `address`, `accountOwner(Id)`; relations: `people`, `opportunities`,
  `taskTargets`, `noteTargets`, `attachments`, `timelineActivities`, `recordListMemberships`.
- **Person** — `name` (first/last), `emails`, `phones`, `linkedinLink`,
  `linkedinConnectionState`, `jobTitle`, `avatarUrl`, `company(Id)`, `emailOptOut`;
  relations: `pointOfContactForOpportunities`, `taskTargets`, `noteTargets`, `attachments`,
  `messageParticipants`, `calendarEventParticipants`, `sequenceEnrollments`,
  `linkedinActions`, `linkedinThreadParticipants`, `linkedinConnections`,
  `recordListMemberships`, `timelineActivities`.
- **Opportunity** — `name`, `amount` (currency), `closeDate`, `stage` (enum), `probability`,
  `company(Id)`, `pointOfContact(Id)`, `owner(Id)`; relations: `taskTargets`, `noteTargets`,
  `attachments`, `recordListMemberships`, `timelineActivities`.
- **Task** — title, body, status, `dueAt`, priority, assignee; `taskTargets` join to any
  record.
- **Note** — title, body; `noteTargets` join to any record.
- **Attachment** — file ref + polymorphic target; created via `uploadFile` then linking.
- **TimelineActivity** — read-only activity feed per record.
- **WorkspaceMember** — read for assignment pickers (owner/assignee).

### 3.2 Join / relationship objects (how the UI "attaches" things)

- **noteTarget / taskTarget** — attach a note/task to a company/person/opportunity/custom.
- **recordListMember** — membership of a record in a list.
- **sequenceEnrollment** — a person's enrollment in a sequence (see §3.4).

The MCP hides these behind intent tools (`twenty_attach_note`, `twenty_add_to_list`,
`twenty_enroll_person_in_sequence`) rather than exposing raw join CRUD, but generic CRUD can
still reach them.

### 3.3 Lists (`recordList`)

- **recordList** — `name`, `type` (`COMPANY | PERSON | OPPORTUNITY`), `position`,
  `folder(Id)`, `members`.
- **recordListFolder** — grouping of lists.
- **recordListMember** — record ↔ list membership (the join). Also referenced on records as
  `recordListMemberships`.

### 3.4 Sequences (outreach engine)

- **sequence** — `name`, `status` (`DRAFT | ACTIVE | PAUSED`), `senderConnectedAccountId`,
  `settings` (JSON), plus denormalized metrics: `enrolledCount`, `activeCount`,
  `completedCount`, `repliedCount`, `failedCount`, `position`; relations `steps`,
  `enrollments`.
  - `settings: SequenceSettings` = `{ activeDays[], windowStart, windowEnd, timezone,
dailyStarts, staggerMinutes, linkedinDailyActions, linkedinDelayPatternMinutes[],
stopOnReply }`.
- **sequenceStep** — `name`, `type`, `settings` (discriminated union), `position`,
  `sequence(Id)`. The canonical `settings.type` ∈ `SEND_EMAIL | DELAY | CREATE_TASK |
SEND_CONNECTION_REQUEST | SEND_LINKEDIN_MESSAGE | WITHDRAW_CONNECTION_REQUEST |
CONDITION | ENRICH_PHONE_NUMBER`. Every step may include
  `branch: { conditionStepId, outcome: YES | NO }`; action steps may include
  `{ executionMode: AUTOMATED | MANUAL, manualTaskTitle, manualTaskDescription }`.
  Per-type settings:
  - `SEND_EMAIL`: `{ subject, bodyHtml, threadAsReplyToPreviousEmail, stopOnReply, ...execution }`
  - `DELAY`: `{ days, hours, minutes, branch? }`
  - `CREATE_TASK`: `{ taskType, titleTemplate, notesTemplate, priority,
assigneeWorkspaceMemberId, continueMode, deadlineDays, branch? }`
  - `SEND_CONNECTION_REQUEST`: `{ noteTemplate, skipIfAlreadyConnected, ...execution }`
  - `SEND_LINKEDIN_MESSAGE`: `{ messageTemplate, ...execution }`
  - `WITHDRAW_CONNECTION_REQUEST`: `{ withdrawAfterDays, withdrawAfterHours, ...execution }`
  - `CONDITION`: `{ condition, branch? }`; supported conditions cover LinkedIn network/
    invite/message state and the presence of email, LinkedIn URL, or phone.
  - `ENRICH_PHONE_NUMBER`: `{ ...execution }`; automated execution uses Apollo.
- **sequenceEnrollment** — `person(Id)`, `sequence(Id)`, `status`
  (`PENDING | ACTIVE | COMPLETED | REPLIED | FAILED | REMOVED`), `currentStepId/Position`,
  `waitingOn` (`DELAY | EMAIL_SCHEDULED | TASK_DONE | TASK_DEADLINE | LINKEDIN_ACTION`),
  `nextActionAt`, `senderConnectedAccountId`, `stopOnReply`, `startedAt`, `endedAt`,
  `errorMessage`, `lastSendAttempt`.
  - **Enrolling = creating a `sequenceEnrollment`.** `sequence-invariant.service` +
    `sequence.query-hooks` enforce validity on write. Execution is async (cron + jobs).

### 3.5 LinkedIn

- **linkedinConnection**, **linkedinInvitation**, **linkedinMessageThread**,
  **linkedinMessage**, **linkedinThreadParticipant**.
- **linkedinAction** — the queued-action record that drives sends: `type`, `status`,
  `scheduledAt`, `claimedAt/By`, `executedAt`, `attemptCount`, `errorMessage`, `linkedinUrl`,
  `noteText`, `connectionState`, `person(Id)`, `sequenceEnrollmentId`, `sequenceStepId`.
  - **Sending an invitation / message outside a sequence = creating a `linkedinAction`** of
    the right type; a worker claims and executes it. (Confirm the enum literals for `type`
    from the field metadata at implementation time; sequence step types imply
    `SEND_CONNECTION_REQUEST` / `SEND_LINKEDIN_MESSAGE` / `WITHDRAW_CONNECTION_REQUEST`.)

### 3.6 Unibox (unified inbox) — custom GraphQL, user-scoped

- Queries: `uniboxThreads(input)` → threads across `EMAIL`/`LINKEDIN` channels with folder &
  filter support; `uniboxContacts(input)` → contacts with CRM filters.
- Mutation: `addUniboxContactsToCrm(input)` → bulk-create People/Company from inbox contacts.
- Guarded by `WorkspaceAuthGuard + UserAuthGuard + CustomPermissionGuard` and needs
  `workspaceMemberId` / `userWorkspaceId` → **user-token territory** (see §7).

### 3.7 Custom objects

Because tools are metadata-driven, any custom object (its plural REST slug + field set) is
automatically reachable through the generic CRUD tools once discovered via the metadata API.
No per-object code needed.

---

## 4. Tool catalog (the heart of the plan)

Design principle: **generic tools guarantee completeness; specialized tools guarantee
ergonomics.** Naming: `twenty_{action}_{resource}`, snake_case, verb-first. Every tool ships
`title`, a rich `description` (args + return schema + examples + error notes), a `.strict()`
Zod `inputSchema`, an `outputSchema`, and MCP `annotations`.

Legend — **P0** = must-have foundation, **P1** = core UI parity, **P2** = polish/advanced.
Annotations shown as (read-only? / destructive? / idempotent?).

### 4.1 Discovery & metadata (P0)

| Tool                     | Purpose                                                                                                              | Annotations   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------- |
| `twenty_list_objects`    | List all objects (standard + custom): name, plural slug, icon, description, whether system.                          | ro / no / yes |
| `twenty_describe_object` | Full field list for one object: field name, type, required, enum options, relations, default. Powers input building. | ro / no / yes |
| `twenty_global_search`   | Cross-object search (via `SearchResolver`): query → matched records with object + label + id.                        | ro / no / yes |

### 4.2 Generic record CRUD — works for **every** object (P0)

These accept an `object` (plural slug) + typed payload validated against live metadata.

| Tool                          | Maps to                                                                                | Annotations           |
| ----------------------------- | -------------------------------------------------------------------------------------- | --------------------- |
| `twenty_list_records`         | `GET /rest/{object}` — filter, order_by, limit, cursor, depth, fields                  | ro / no / yes         |
| `twenty_get_record`           | `GET /rest/{object}/{id}` (depth control for relations)                                | ro / no / yes         |
| `twenty_create_record`        | `POST /rest/{object}`                                                                  | write / no / no       |
| `twenty_update_record`        | `PATCH /rest/{object}/{id}`                                                            | write / no / no       |
| `twenty_delete_record`        | `DELETE /rest/{object}/{id}` (soft delete → trash)                                     | write / **yes** / yes |
| `twenty_restore_record`       | `PATCH /rest/restore/{object}/{id}`                                                    | write / no / yes      |
| `twenty_batch_create_records` | `POST /rest/batch/{object}`                                                            | write / no / no       |
| `twenty_find_duplicates`      | `POST /rest/{object}/duplicates`                                                       | ro / no / yes         |
| `twenty_merge_records`        | `PATCH /rest/{object}/merge`                                                           | write / **yes** / no  |
| `twenty_group_by`             | `GET /rest/{object}/groupBy` — counts/aggregations per group (kanban, board, pipeline) | ro / no / yes         |

Notes:

- `twenty_delete_record` is soft (recoverable via trash/restore). A separate hard-delete
  (`twenty_destroy_record`) is **P2 and gated** behind an explicit `confirm: true` because
  it's irreversible.
- Generic tools alone technically satisfy "everything," but the specialized tools below make
  the common UI journeys reliable and self-documenting.

### 4.3 People (P0/P1)

- `twenty_create_person` — name, emails, phones, jobTitle, linkedinLink, companyId, ownerId.
- `twenty_update_person`
- `twenty_find_people` — search + structured filters (company, jobTitle, email domain).
- `twenty_get_person` — with chosen relations (company, opportunities, notes, tasks,
  enrollments) in one call.
- `twenty_set_person_company` — link/unlink to a company.

### 4.4 Companies (P0/P1)

- `twenty_create_company` — name, domainName, industry, employees, annualRevenue, address,
  accountOwnerId, segments, technologies.
- `twenty_update_company`
- `twenty_find_companies` — search + filters (industry, size, accountStatus, owner).
- `twenty_get_company` — with people/opportunities/notes/tasks.
- `twenty_set_company_owner`

### 4.5 Opportunities (P0/P1)

- `twenty_create_opportunity` — name, amount, closeDate, stage, probability, companyId,
  pointOfContactId, ownerId.
- `twenty_update_opportunity`
- `twenty_set_opportunity_stage` — move across pipeline (validates stage enum from metadata).
- `twenty_find_opportunities` — filters (stage, owner, company, close-date range, amount).
- `twenty_get_opportunity`
- `twenty_get_pipeline` — `group_by(stage)` with sums of `amount` and counts → the Kanban
  board as structured data.

### 4.6 Tasks & Notes (P1)

- `twenty_create_task` / `twenty_update_task` / `twenty_complete_task` — title, body, dueAt,
  priority, assigneeId.
- `twenty_create_note` / `twenty_update_note` — title, body.
- `twenty_attach_note` / `twenty_attach_task` — link a note/task to any record (creates the
  `noteTarget` / `taskTarget`).
- `twenty_list_activities` — tasks + notes + timeline for a given record.

### 4.7 Lists (P1)

- `twenty_list_lists` — all `recordList`s (+ folder grouping, type).
- `twenty_create_list` — name, type (`COMPANY|PERSON|OPPORTUNITY`), folderId.
- `twenty_get_list` — list + its members (resolved records).
- `twenty_add_record_to_list` / `twenty_remove_record_from_list` — manage `recordListMember`.
- `twenty_list_folders` / `twenty_create_folder` — (P2).

### 4.8 Sequences (P1)

- `twenty_list_sequences` — name, status, metrics (enrolled/active/completed/replied/failed).
- `twenty_get_sequence_capabilities` — current settings, step schemas, conditions, branch and
  merge semantics, execution modes, limits, and enrollment controls.
- `twenty_get_sequence` — sequence + ordered steps + settings + metrics.
- `twenty_list_sequence_steps` — exact global position and branch placement for all steps.
- `twenty_create_sequence` — name, `settings` (with sane defaults), senderConnectedAccountId.
- `twenty_update_sequence` — rename / edit settings.
- `twenty_set_sequence_status` — `DRAFT` ↔ `ACTIVE` ↔ `PAUSED` (activate/pause/draft).
- `twenty_add_sequence_step` — all current action/condition/enrichment types, position,
  branch placement, and automated/manual execution.
- `twenty_update_sequence_step` / `twenty_reorder_sequence_step` / `twenty_delete_sequence_step`.
- `twenty_enroll_person_in_sequence` — create a `sequenceEnrollment` (person + sequence +
  optional sender override). **Primary outreach action.** Surfaces invariant errors clearly.
- `twenty_bulk_enroll_people` — enroll many (batch create), reporting per-person success.
- `twenty_list_enrollments` — filter by sequence and/or status; shows `waitingOn`,
  `nextActionAt`, `currentStepPosition`.
- `twenty_mark_enrollment_replied`, `twenty_skip_enrollment_to_next_step`, and
  `twenty_stop_enrollment` — the supported enrollment controls; confirm each.
- `twenty_get_sequence_metrics` — roll-up per sequence/step.

### 4.9 LinkedIn (P1/P2)

- `twenty_list_linkedin_connections` / `twenty_get_linkedin_connection`.
- `twenty_list_linkedin_threads` / `twenty_get_linkedin_thread` — thread + messages.
- `twenty_send_linkedin_message` — create a `linkedinAction` (SEND_LINKEDIN_MESSAGE) for a
  person; **async/queued** — the tool returns the created action + explains it's scheduled.
- `twenty_send_linkedin_invitation` — create a `linkedinAction` (SEND_CONNECTION_REQUEST)
  with optional `noteText`.
- `twenty_withdraw_linkedin_invitation` — WITHDRAW_CONNECTION_REQUEST action.
- `twenty_list_linkedin_actions` — queued/executed actions with status & errors.

> ⚠️ These create _outbound_ actions on the user's behalf. They are annotated
> `destructive: true, openWorld: true` and the description instructs the model to confirm
> intent + recipient before calling. Exact `linkedinAction.type` enum literals to be read
> from field metadata during implementation.

### 4.10 Unibox (P1) — user-token dependent (see §7)

- `twenty_unibox_list_threads` — channel (`EMAIL|LINKEDIN`), folder, filters, pagination.
- `twenty_unibox_get_thread` — messages in a thread.
- `twenty_unibox_list_contacts` — inbox contacts with CRM-status filters.
- `twenty_unibox_add_contacts_to_crm` — bulk-create People/Companies from selected contacts.

### 4.11 Messaging / Email (P2, if a send path is exposed)

- `twenty_list_messages` / `twenty_list_message_threads` (read).
- Direct email _send_ outside a sequence: only if the server exposes a send mutation for a
  connected account. If not exposed, the sanctioned path is a one-step `SEND_EMAIL` sequence
  — document this rather than fabricate an endpoint.

### 4.12 Files / attachments (P2)

- `twenty_list_attachments` (per record).
- `twenty_upload_attachment` — `uploadFile` (multipart via GraphQL) then link as attachment.
  Deferred because file I/O over MCP needs care (path handling, size limits).

**Tool count:** ~13 generic/discovery (P0) + ~45 specialized (P1/P2) ≈ **55–60 tools**.
Consider grouping into MCP "tool namespaces" or gating advanced sets behind a
`TWENTY_ENABLE_ADVANCED` flag to keep the default surface lean for context efficiency.

---

## 5. Shared infrastructure (`src/services`, `src/schemas`, `src/formatting`)

1. **`TwentyClient`** — single HTTP client wrapping REST + GraphQL:
   - Base URL from `TWENTY_BASE_URL`; `Authorization: Bearer ${TWENTY_API_KEY}`.
   - `rest(method, path, {query, body})` and `graphql(query, variables)` helpers.
   - Timeouts, limited retry with backoff on 429/5xx, and a single error-normalizer.
2. **Metadata cache + dynamic Zod** — on first use, fetch objects/fields from the metadata
   API; cache (TTL + manual refresh tool). Build Zod schemas per object so
   `create/update_record` validate field names/types/enums _before_ hitting the server and
   return actionable messages ("field `stagee` not found; did you mean `stage`?").
3. **Pagination helper** — normalize Twenty cursor pagination into
   `{ total, count, items, has_more, next_cursor }` (§ best-practices).
4. **Field projection & `depth`** — default to a compact field set + `depth=0/1`; let tools
   request specific relations. Keeps payloads small for the model's context.
5. **Response formatter** — every read tool supports `response_format: "markdown" | "json"`.
   Markdown shows `Display Name (id)`, humanized dates/currency; JSON returns full structured
   data + `structuredContent`. Enforce a `CHARACTER_LIMIT` (~25k) with explicit truncation
   messaging and a hint to filter/paginate.
6. **Error mapping** — translate Twenty's REST/GraphQL error shapes (permission,
   validation, invariant hooks like sequence/LinkedIn) into guidance the model can act on.
7. **ID resolution helpers** — accept human input (person name, company domain, sequence
   name) and resolve to IDs via search, so the model isn't forced to pre-fetch IDs for every
   call (with disambiguation when multiple match).

---

## 6. Project structure

```
packages/twenty-mcp/
├── package.json            # name: "twenty-mcp-server", type: module, bin
├── tsconfig.json           # strict, ES2022, Node16
├── README.md               # setup, API-key creation, config, tool list
├── PLAN.md                 # this document
├── .env.example            # TWENTY_BASE_URL, TWENTY_API_KEY, TWENTY_USER_TOKEN?, TRANSPORT
├── src/
│   ├── index.ts            # server bootstrap; transport switch (stdio | http)
│   ├── constants.ts        # base paths, CHARACTER_LIMIT, defaults, enums
│   ├── types.ts            # shared TS types
│   ├── services/
│   │   ├── twenty-client.ts     # REST + GraphQL client, auth, retry
│   │   ├── metadata.service.ts  # objects/fields discovery + cache
│   │   ├── errors.ts            # error normalization
│   │   └── pagination.ts
│   ├── schemas/            # Zod: shared + dynamic-from-metadata builders
│   ├── formatting/         # markdown/json formatters, truncation
│   └── tools/
│       ├── discovery.tools.ts
│       ├── records.tools.ts      # generic CRUD
│       ├── people.tools.ts
│       ├── companies.tools.ts
│       ├── opportunities.tools.ts
│       ├── tasks-notes.tools.ts
│       ├── lists.tools.ts
│       ├── sequences.tools.ts
│       ├── linkedin.tools.ts
│       ├── unibox.tools.ts
│       └── register-all.ts       # wires every tool into the McpServer
├── eval/
│   └── evaluation.xml       # 10 read-only Q&A (see §10)
└── dist/                    # build output (bin: dist/index.js)
```

Stack: `@modelcontextprotocol/sdk`, `zod`, `undici`/`axios`, `graphql-request` (or hand-
rolled fetch). Strict TS, no `any`, named exports, kebab-case files — consistent with repo
conventions. Register tools with `server.registerTool` (modern API only).

---

## 7. Auth & security

- **Primary:** Twenty **API key** (create in Settings → Developers) as
  `Authorization: Bearer <key>`. Stored only in env (`TWENTY_API_KEY`), never in code or
  logs. Works for REST, core GraphQL (auto-generated), metadata, and the in-server MCP.
- **User-scoped resolvers:** `UniboxResolver` uses `UserAuthGuard` and reads
  `workspaceMemberId`/`userWorkspaceId`. An API key JWT _can_ carry a `workspaceMemberId`,
  so it **may** satisfy these — **must be verified during Phase 4.** If it doesn't, support
  an optional `TWENTY_USER_TOKEN` (user access token) used only for Unibox tools, and
  degrade gracefully (Unibox tools report "requires a user token" instead of failing
  opaquely).
- **Permissions:** all calls run under the key's role (`CustomPermissionGuard`). Surface
  403s as "your API key's role lacks permission for X."
- **Safety annotations & confirmations:** destructive tools (`delete`, `merge`, `destroy`,
  `stop_enrollment`) and outbound tools (LinkedIn sends, bulk enroll, add-to-CRM) are
  annotated and their descriptions instruct the model to confirm target + intent first.
  These map to the "explicit permission required" category — sending messages, publishing,
  bulk mutations.
- **Transport hardening (HTTP mode):** stateless JSON, validate `Origin`, bind `127.0.0.1`
  for local, DNS-rebinding protection; secrets via env only.
- **Multi-tenancy:** one API key = one workspace. Document running multiple server instances
  (or a key-per-workspace map) for multi-workspace use.

### 7.1 MCP client integration (Claude Code + Codex)

The intended workflow is: use this MCP to inspect/build CRM data and drive a "write a plan,
then ask **Claude Code** or **Codex** to execute it" loop. Both are local MCP clients that
launch the server as a **stdio subprocess**, so `stdio` is the shared baseline — no network
setup, and each agent spawns its own instance independently.

- **Claude Code** — register via the project `.mcp.json` (this repo already uses one for the
  Postgres MCP) or `claude mcp add`:
  ```jsonc
  // .mcp.json
  {
    "mcpServers": {
      "twenty": {
        "command": "node",
        "args": ["packages/twenty-mcp/dist/index.js"],
        "env": {
          "TWENTY_BASE_URL": "http://localhost:3000",
          "TWENTY_API_KEY": "...",
        },
      },
    },
  }
  ```
- **Codex** — register in `~/.codex/config.toml` under `[mcp_servers.twenty]` with the same
  `command`/`args`/`env`. (Codex also speaks MCP over stdio.)
- **Optional HTTP mode** — if you'd rather run one long-lived server both agents connect to
  (e.g. shared across projects, or remote), start it with `TRANSPORT=http` and point each
  client at the URL. stdio remains the recommended default for two local coding agents.
- Because secrets live in `env`, avoid committing a real `TWENTY_API_KEY` in `.mcp.json`;
  prefer env-var interpolation or a local, git-ignored config.

---

## 8. Response & context strategy

- Default read tools return **compact** records (key fields + `Name (id)`), `depth` opt-in
  for relations, `fields` allow-list to trim payloads.
- Always include pagination metadata; never dump unbounded result sets.
- `group_by`/pipeline/metrics tools return **aggregates**, not raw rows, when the user wants
  a board/summary — big context savings.
- Enum-bearing fields (opportunity `stage`, sequence `status`, step `type`) validated against
  live metadata so the model gets the exact allowed values in error messages.

---

## 9. Delivery roadmap (phased)

**Phase 0 — Scaffold & spine (P0).** Package, tsconfig, `TwentyClient`, auth, error
normalizer, transport switch (stdio + HTTP), health check tool; `npm run build` green;
smoke-test against a local instance with MCP Inspector.

**Phase 1 — Discovery + generic CRUD (P0).** `list_objects`, `describe_object`,
`global_search`, and the 10 generic record tools. Metadata cache + dynamic Zod. At the end
of this phase the MCP can technically create/read/update/delete **any** object.

**Phase 2 — Core CRM ergonomics (P0/P1).** People, Companies, Opportunities (incl.
`get_pipeline`), Tasks & Notes (+ attach). This is "add/edit companies, people,
opportunities" done well.

**Phase 3 — Lists + Sequences (P1).** Lists & members; sequence + step builder;
enrollment + bulk enroll; enrollment management; metrics. Handle invariant-hook errors.

**Phase 4 — LinkedIn + Unibox (P1/P2).** LinkedIn reads + queued action sends; Unibox
threads/contacts/add-to-CRM. **Resolve the API-key-vs-user-token question here.**

**Phase 5 — Advanced (P2).** Hard-delete (gated), merge/dedupe UX, group-by dashboards,
attachments/upload, messaging reads.

**Phase 6 — Hardening & ship.** Eval suite (§10), README + tool reference, MCPB/DXT
package, CI (build + lint + typecheck via Nx), example client configs (Claude Desktop).

---

## 10. Testing & evaluation

- **Unit:** schema validation, error mapping, pagination, metadata→Zod, formatter
  truncation. `jest` per repo convention.
- **Integration:** run against a seeded local Twenty (`yarn start` +
  `setup-dev-env.sh`); exercise create→read→update→delete→restore round-trips and one
  sequence enrollment end-to-end.
- **MCP Inspector:** manual tool-by-tool verification of schemas & annotations.
- **Evaluation suite (`eval/evaluation.xml`):** 10 independent, **read-only**, verifiable,
  stable questions that require multiple tool calls — e.g. "How many opportunities are in the
  `PROPOSAL` stage and what is their total amount?" (list_objects → describe_object →
  get_pipeline/group_by), "Which sequence has the highest `repliedCount`?" (list_sequences),
  "How many people at companies in the `SaaS` industry are enrolled in an ACTIVE sequence?"
  (find_companies → find_people → list_enrollments). Author + self-verify answers against a
  seeded dataset.

---

## 11. Implementation decisions

1. **Deployment target:** _Resolved_ — driven by local coding agents (**Claude Code** +
   **Codex**), so **stdio-first**, HTTP as an optional shared-instance mode (§7.1).
2. **Auth scope:** API key by default, with an optional user token for Unibox and
   user-owned LinkedIn records.
3. **Write safety:** destructive, bulk, and outbound operations require explicit
   confirmation. Permanent destruction and high-volume reads are advanced-only.
4. **Custom objects:** automatically included in metadata-driven generic tools.
5. **Runtime boundary:** standalone MCP server only; no duplicate registrations in
   Twenty's in-server `ToolRegistryService`.

---

## 12. Appendix — capability ↔ UI map

| UI surface                       | MCP tools                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Companies table / record page    | `create/update/find/get_company`, generic CRUD, `set_company_owner`, `get_company` relations                                                                                                                                         |
| People table / record page       | `create/update/find/get_person`, `set_person_company`                                                                                                                                                                                |
| Opportunities / Kanban pipeline  | `create/update/find/get_opportunity`, `set_opportunity_stage`, `get_pipeline`, `group_by`                                                                                                                                            |
| Tasks & Notes tabs               | `create/update/complete_task`, `create/update_note`, `attach_note/task`, `list_activities`                                                                                                                                           |
| Lists (+ folders)                | `list/create/get_list`, `add/remove_record_from_list`, `list/create_folder`                                                                                                                                                          |
| Sequences builder & enrollment   | `get_sequence_capabilities`, `list/get/create/update_sequence`, `list/add/update/reorder/delete_sequence_step`, `set_sequence_status`, `enroll_person/bulk_enroll`, `list/mark_replied/skip/stop_enrollment`, `get_sequence_metrics` |
| LinkedIn                         | `list_connections/threads/actions`, `get_thread`, `send_message/invitation`, `withdraw_invitation`                                                                                                                                   |
| Unibox                           | `unibox_list_threads/get_thread/list_contacts/add_contacts_to_crm`                                                                                                                                                                   |
| Global search                    | `global_search`                                                                                                                                                                                                                      |
| Trash / restore / merge / dedupe | `delete/restore_record`, `merge_records`, `find_duplicates`                                                                                                                                                                          |
| Any custom object                | generic record tools + `describe_object`                                                                                                                                                                                             |

_Field/enum specifics in this plan were read from the current codebase
(`packages/twenty-server/src/modules/*`, `packages/twenty-shared/src/types/*`,
`packages/twenty-server/src/engine/api/{rest,mcp,graphql}`). Re-verify enum literals for
`linkedinAction.type` and the exact metadata REST shape at implementation time._
