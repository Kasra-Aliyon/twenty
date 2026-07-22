# LinkedIn connector review

This review compares Twenty's connector with the locally installed Zero.inc
2.7.4 extension. The comparison is behavioral; no Zero source code is copied.

## Outcome

Twenty keeps its richer CRM capture, linking, list, update, and sequence
features while adopting Zero's useful sync properties: manual sync, automatic
freshness checks, account-scoped checkpoints, stable-ID upserts, and a
cross-tab lock. Twenty is intentionally more conservative for read frequency
and outbound automation.

## Capability comparison

| Capability                  | Zero.inc 2.7.4                                           | Twenty after review                                                                                              | Decision                                                   |
| --------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Profile and company capture | Yes                                                      | Yes, including update, manual linking, lists, photo upload, and company creation                                 | Keep Twenty behavior                                       |
| Connection sync             | Recent-first pages with known-record early stop          | Recent-first incremental reads plus a resumable historical checkpoint                                            | Strengthened                                               |
| Invitations                 | Sent invitations                                         | Sent and received invitations, with DOM fallback for received invites                                            | Extended                                                   |
| Threads and messages        | Activity high-water mark and per-thread message boundary | Equivalent high-water and per-thread incremental boundaries, plus resumable historical thread backfill           | Aligned                                                    |
| Stored totals               | Server totals                                            | Signed-in-account totals queried directly from each synced object                                                | Fixed                                                      |
| Manual sync                 | Sync action                                              | **Sync now** in the LinkedIn panel and popup                                                                     | Aligned                                                    |
| Automatic sync              | About every 10 minutes while active                      | About every 30 minutes while a LinkedIn tab is open, plus a background alarm dispatch                            | More conservative                                          |
| Cross-tab exclusion         | Background lock                                          | Serialized session-storage lock with heartbeat and tab cleanup                                                   | Strengthened for MV3 restarts                              |
| Connection sends            | Internal API, randomized 30–60 second spacing            | Visible LinkedIn UI, server schedule, workspace-wide cap, local 15-minute floor, and configurable 1–20 daily cap | More conservative                                          |
| Direct-message sends        | Supported                                                | Visible composer, first-degree connections only, and the same safety limits as other outbound actions            | Added with fail-closed limits                              |
| Search-result bulk capture  | Supported                                                | Individual profile/company capture only                                                                          | Intentionally omitted to avoid bulk collection patterns    |
| Page-follower harvesting    | Supported                                                | Not implemented                                                                                                  | Intentionally omitted to avoid expanding collection volume |
| Side-panel AI chat          | Supported                                                | Not part of the LinkedIn connector                                                                               | Out of scope                                               |

## Always-on safety controls

- Read requests are serialized at 6–12 second intervals and limited to 8 per
  minute, 60 per hour, and 200 per local day.
- The read ledger is durable in browser local storage, so a tab reload or
  extension service-worker restart does not reset the budget.
- HTTP 403, 429, 999, challenge/restriction redirects, and known limit signals
  activate a 24-hour fail-closed cooldown.
- Sync ownership is persisted in browser session storage and heartbeated. Only
  one tab can sync a LinkedIn account at a time.
- Outbound actions are checked before claim, recorded before the final UI
  action, limited to a user-configurable 1–20 attempts per local day, and
  separated by at least 15 minutes across all sequences.
- Server scheduling uses a workspace-wide lock and daily counter. New sequence
  defaults use 20 actions per day with 15–45 minute gaps and weekday sending
  windows.
- Restriction, identity-verification, commercial-use-limit, and invitation-limit
  pages stop the runner. An action with an uncertain outcome is not replayed.
- Connection notes are rejected above 200 characters.
- Direct messages are rejected when empty, over 2000 characters, or when the
  runner cannot recognize a first-degree connection.

These controls reduce activity and stop on risk signals. They do not conceal
automation and cannot guarantee that LinkedIn will never restrict an account,
because read-only sync still relies on unofficial LinkedIn endpoints.

## Incremental data guarantees

- Connections: the initial backfill saves its next offset after every
  successful page and overlaps one page on resume to avoid gaps if the list
  changes. Completed accounts scan recent pages and stop after a known-record
  boundary.
- Invitations: stable external IDs include account, direction, and profile.
  Normal runs stop at a known-record boundary; a sync-revision change performs
  a full refresh.
- Threads: the newest activity timestamp advances only after the previous
  boundary is crossed. Historical work resumes from the oldest stored thread.
- Messages: each thread compares LinkedIn's last activity with the newest
  stored message and asks only for messages after that boundary.
- All writes use upserts with unique external IDs, making retries and overlap
  idempotent.

## Verification performed

- `npm run compile`
- `npm run build`
- Six safety-policy unit tests covering hourly limits, configurable daily limits,
  cross-sequence spacing, replay prevention, cooldown expiry, and restriction
  URLs
- Four server throttle tests, including a cross-sequence workspace cap test

No live invitation, withdrawal, or direct message was sent during validation.
Live Chrome validation requires the ChatGPT Chrome Extension to be enabled in
Profile 4.
