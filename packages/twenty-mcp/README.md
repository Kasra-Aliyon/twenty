# Twenty CRM MCP Server

A standalone Model Context Protocol server for Twenty CRM. It gives local coding
agents a metadata-aware interface to standard objects, custom objects, and common
CRM workflows without coupling the MCP process to the Twenty server runtime.

The server exposes 72 tools by default and four additional tools when advanced
mode is enabled. It uses stdio by default and also supports stateless Streamable
HTTP.

For end-to-end setup across Codex, ChatGPT, Claude Code, Claude Desktop, and
web/mobile clients, including long-running service examples, see the
[complete usage and operations guide](./USAGE_GUIDE.md).

## Capabilities

- Discover the live workspace data model and validate generic writes against it.
- List, get, create, update, soft-delete, restore, deduplicate, merge, batch-create,
  group, and aggregate records.
- Work with people, companies, opportunities, tasks, notes, activities, lists,
  and folders through task-specific tools.
- Build outreach sequences, manage ordered steps, activate or pause sequences,
  enroll people, stop enrollments, and read sequence metrics.
- Read LinkedIn connections and threads and queue confirmed message, invitation,
  and withdrawal actions.
- Read Unibox threads and contacts and add confirmed contact selections to CRM.
- Search globally across searchable standard and custom objects.

Twenty generates its APIs from each workspace's data model. Generic tools
therefore discover custom objects and fields at runtime rather than relying on a
compiled schema.

## Requirements

- Node.js 24.5 or newer.
- A reachable Twenty Cloud or self-hosted workspace.
- A Twenty API key with access to the objects the server should use.

Create an API key under **Settings → API & Webhooks → Create key**. Copy it
immediately, then assign a least-privilege role under **Settings → Members →
Roles → Assignment**. Metadata discovery needs Data Model read access.
See [Twenty's API documentation](https://docs.twenty.com/developers/extend/api)
and [permissions guide](https://docs.twenty.com/user-guide/permissions-access/capabilities/permissions).

## Build

From the repository root:

```bash
yarn install
npx nx build twenty-mcp
```

The executable entry point is `packages/twenty-mcp/dist/index.js`.

## Configuration

Required:

| Variable | Description |
|---|---|
| `TWENTY_BASE_URL` | Twenty backend origin, without `/rest` or `/graphql`. Local default: `http://localhost:3000`; Twenty Cloud: `https://api.twenty.com`. |
| `TWENTY_API_KEY` | Role-scoped Twenty API key. |

Optional:

| Variable | Default | Description |
|---|---:|---|
| `TWENTY_USER_TOKEN` | unset | User-scoped token for Unibox and user-owned LinkedIn data. |
| `TWENTY_METADATA_CACHE_TTL_MS` | `300000` | Live metadata cache lifetime. |
| `TWENTY_REQUEST_TIMEOUT_MS` | `15000` | Per-request timeout. |
| `TWENTY_MAX_RETRIES` | `2` | Retries for rate limits, 5xx responses, and transient fetch failures. |
| `TWENTY_ENABLE_ADVANCED` | `false` | Enables permanent destruction and high-volume message/attachment reads. |
| `TRANSPORT` | `stdio` | `stdio` or `http`. |
| `HOST` | `127.0.0.1` | HTTP bind host. |
| `PORT` | `3333` | HTTP bind port. |
| `TWENTY_MCP_HTTP_BEARER_TOKEN` | unset | MCP HTTP bearer token. Required for non-loopback binds. |

`TWENTY_USER_TOKEN` is deliberately optional. API-key-only tools continue to
work without it; user-scoped resolvers return guidance when the configured
credential does not provide a user context. Treat user tokens as short-lived
secrets and do not commit them.

## Codex setup

Build the package, export the credentials in the environment that launches
Codex, and add this to `~/.codex/config.toml` or a trusted project's
`.codex/config.toml`:

```toml
[mcp_servers.twenty]
command = "node"
args = ["/absolute/path/to/twenty/packages/twenty-mcp/dist/index.js"]
env_vars = [
  "TWENTY_BASE_URL",
  "TWENTY_API_KEY",
  "TWENTY_USER_TOKEN",
  "TWENTY_ENABLE_ADVANCED",
]
startup_timeout_sec = 20
tool_timeout_sec = 60
default_tools_approval_mode = "writes"
```

Restart Codex after changing the configuration. The Codex app, CLI, and IDE
extension share this MCP configuration. See the
[Codex MCP documentation](https://developers.openai.com/codex/mcp/).

## Claude Code setup

Claude Code expands environment variables in project `.mcp.json` files:

```json
{
  "mcpServers": {
    "twenty": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/twenty/packages/twenty-mcp/dist/index.js"
      ],
      "env": {
        "TWENTY_BASE_URL": "${TWENTY_BASE_URL}",
        "TWENTY_API_KEY": "${TWENTY_API_KEY}",
        "TWENTY_USER_TOKEN": "${TWENTY_USER_TOKEN:-}",
        "TWENTY_ENABLE_ADVANCED": "${TWENTY_ENABLE_ADVANCED:-false}"
      }
    }
  }
}
```

Use an absolute entry-point path because relative MCP paths depend on the
directory from which Claude Code was launched. See the
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## Streamable HTTP

For a local HTTP endpoint:

```bash
TWENTY_BASE_URL=https://api.twenty.com \
TWENTY_API_KEY=replace-me \
TRANSPORT=http \
node packages/twenty-mcp/dist/index.js
```

The MCP endpoint is `http://127.0.0.1:3333/mcp`; the process health endpoint is
`http://127.0.0.1:3333/health`.

Non-loopback binds require `TWENTY_MCP_HTTP_BEARER_TOKEN`. Configure the client
to send `Authorization: Bearer <token>`. The HTTP transport does not provide
TLS; place it behind a trusted TLS reverse proxy before crossing a machine or
network boundary.

Example Codex client entry:

```toml
[mcp_servers.twenty_http]
url = "https://mcp.internal.example/mcp"
bearer_token_env_var = "TWENTY_MCP_HTTP_BEARER_TOKEN"
default_tools_approval_mode = "writes"
```

## Tool families

| Family | Representative tools |
|---|---|
| Discovery | `twenty_health_check`, `twenty_list_objects`, `twenty_describe_object`, `twenty_refresh_metadata`, `twenty_global_search` |
| Generic records | `twenty_list_records`, `twenty_get_record`, `twenty_create_record`, `twenty_update_record`, `twenty_delete_record`, `twenty_restore_record`, `twenty_batch_create_records`, `twenty_find_duplicates`, `twenty_merge_records`, `twenty_group_by` |
| People and companies | `twenty_find_people`, `twenty_create_person`, `twenty_set_person_company`, `twenty_find_companies`, `twenty_set_company_owner` |
| Opportunities | `twenty_find_opportunities`, `twenty_set_opportunity_stage`, `twenty_get_pipeline` |
| Work and activity | `twenty_create_task`, `twenty_complete_task`, `twenty_create_note`, `twenty_attach_task`, `twenty_attach_note`, `twenty_list_activities` |
| Lists | `twenty_list_lists`, `twenty_create_list`, `twenty_add_record_to_list`, `twenty_remove_record_from_list`, `twenty_create_folder` |
| Sequences | `twenty_create_sequence`, `twenty_add_sequence_step`, `twenty_set_sequence_status`, `twenty_enroll_person_in_sequence`, `twenty_bulk_enroll_people`, `twenty_stop_enrollment`, `twenty_get_sequence_metrics` |
| LinkedIn | `twenty_list_linkedin_connections`, `twenty_list_linkedin_threads`, `twenty_send_linkedin_message`, `twenty_send_linkedin_invitation`, `twenty_withdraw_linkedin_invitation`, `twenty_list_linkedin_actions` |
| Unibox | `twenty_unibox_list_threads`, `twenty_unibox_get_thread`, `twenty_unibox_list_contacts`, `twenty_unibox_add_contacts_to_crm` |

Advanced mode additionally exposes:

- `twenty_destroy_record`
- `twenty_list_attachments`
- `twenty_list_messages`
- `twenty_list_message_threads`

## Usage guidance

Start unfamiliar generic workflows with `twenty_list_objects`, then call
`twenty_describe_object`. Create and update tools validate field names, scalar
types, composite values, and live select options before calling Twenty. A typo
such as `stagee` returns the nearest valid field suggestion.

List responses use:

```json
{
  "total": 120,
  "count": 20,
  "items": [],
  "has_more": true,
  "next_cursor": "..."
}
```

Pass `starting_after` with `next_cursor` to continue. Keep relation `depth` at
zero or one unless nested records are necessary. Use `fields` to project generic
record reads. Every read tool supports `response_format` as `markdown` or
`json`; responses over 25,000 characters are truncated with a narrowing or
pagination hint.

REST filters and ordering use Twenty syntax, for example:

```text
stage[eq]:"PROPOSAL"
and(stage[eq]:"PROPOSAL",amount.amountMicros[gte]:50000000000)
createdAt[DescNullsLast]
```

## Safety behavior

- `twenty_delete_record` always sends `soft_delete=true`; restore it with
  `twenty_restore_record`.
- Permanent `twenty_destroy_record` is advanced-only and requires the literal
  `confirm=true`.
- Soft deletion, list removal, step deletion, real merges, batch writes, bulk
  enrollment, sequence activation, Unibox imports, and LinkedIn actions require
  confirmation.
- Merge defaults to `dry_run=true`.
- LinkedIn actions are queued asynchronously; a browser runner performs them.
- A sequence must have a sender and at least one step before activation.
- Sequence settings and steps cannot be changed while active. Pause first.
- Twenty has no paused enrollment state. `twenty_stop_enrollment` preserves
  history by transitioning a pending or active enrollment to `REMOVED`.

## Intentional limitations

- Attachment upload is not exposed. Accepting arbitrary local file paths over
  MCP needs an explicit path allow-list and size policy. Attachment reads are
  available in advanced mode.
- Direct one-off email sending is not exposed. Use Twenty sequences or the
  Twenty UI so sender choice, opt-out checks, scheduling, and audit behavior
  remain explicit.
- Generic metadata validation covers writable field shapes but Twenty remains
  the authority for permission checks, uniqueness, business invariants, and
  workspace-specific hooks.
- HTTP mode is stateless and supports JSON POST requests at `/mcp`; it does not
  expose legacy SSE sessions.

## Development and verification

```bash
npx nx typecheck twenty-mcp
npx nx test twenty-mcp
npx nx lint twenty-mcp
npx nx build twenty-mcp
```

Unit tests cover configuration, API error mapping, filters, pagination,
metadata normalization/cache fallback, dynamic schemas, response formatting,
REST envelope handling, deletion semantics, and a full in-memory MCP tool-list
handshake.

The read-only evaluation suite is in `eval/evaluation.xml`. Its answer key is
based on Twenty's deterministic standard workspace prefill records; see
`eval/README.md`.

## MCP Bundle

The package contains an MCPB manifest and a reproducible packing command:

```bash
yarn workspace twenty-mcp-server mcpb:validate
yarn workspace twenty-mcp-server mcpb:pack
```

Packing builds a self-contained ESM server bundle, validates the staged
manifest, and writes `packages/twenty-mcp/twenty-mcp-server.mcpb`. The bundle
collects the base URL and credentials through sensitive installer fields.

MCPB is the current name for the format formerly called DXT. See the
[official MCPB repository and specification](https://github.com/modelcontextprotocol/mcpb).
