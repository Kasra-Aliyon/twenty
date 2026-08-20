# Twenty CRM MCP: Complete Setup and Operations Guide

This guide covers local setup, client configuration, safe day-to-day use, and
long-running operation for:

- Codex CLI, the Codex IDE extension, and the ChatGPT desktop app
- Claude Code
- Claude Desktop
- ChatGPT web and mobile
- Claude web and mobile

The important distinction is transport:

| Client                                     | Recommended connection                  | Must stay running separately?                                            |
| ------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------ |
| Codex CLI / IDE / desktop                  | Local stdio                             | No. The client starts it.                                                |
| Claude Code                                | Local stdio                             | No. Claude Code starts it.                                               |
| Claude Desktop                             | Install the MCPB desktop extension      | No. Claude starts it.                                                    |
| ChatGPT web / mobile                       | OpenAI Secure MCP Tunnel to local stdio | Yes. Keep `tunnel-client` running.                                       |
| Claude web / mobile                        | Public HTTPS remote MCP with OAuth      | Yes. Not turnkey with the server's current static bearer authentication. |
| Codex or Claude Code using a shared server | Streamable HTTP                         | Yes. Keep the HTTP service running.                                      |

For one person using local clients, stdio is the simplest and safest setup.
Do not run the MCP server as a daemon unless a remote client actually needs it.

## 1. Prerequisites

You need:

- Node.js 24.5 or newer when running from source.
- A reachable Twenty Cloud or self-hosted workspace.
- A Twenty API key with a least-privilege role.
- The cloned Twenty repository.

For this checkout, the important paths are:

```text
/Users/kasraaliyon/Documents/GitHub/twenty
/Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js
/Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/twenty-mcp-server.mcpb
```

Build the server:

```bash
cd /Users/kasraaliyon/Documents/GitHub/twenty
yarn install
npx nx build twenty-mcp
```

Optional verification:

```bash
npx nx lint twenty-mcp
npx nx typecheck twenty-mcp
npx nx test twenty-mcp
```

## 2. Connect to local Twenty and create credentials

The MCP is a separate API client, even when Twenty and the MCP are on the same
computer. It must connect to the Twenty **backend** and authenticate with a
Twenty API key. The key is not an OpenAI key, an Anthropic key, the Twenty
`APP_SECRET`, or your browser session.

In this repository's default development configuration:

```text
Twenty backend/API: http://localhost:2000
Twenty frontend/UI: http://localhost:2001
```

You can verify the backend URL in:

```bash
grep '^REACT_APP_SERVER_BASE_URL=' \
  /Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-front/.env
```

The current value in this checkout is:

```text
REACT_APP_SERVER_BASE_URL=http://localhost:2000
```

Always give the MCP that backend value:

```bash
export TWENTY_BASE_URL="http://localhost:2000"
```

If you override `NODE_PORT`, use that backend origin instead. Do not point the
MCP at the frontend.

Start the normal local development environment in one terminal:

```bash
cd /Users/kasraaliyon/Documents/GitHub/twenty
bash packages/twenty-utils/setup-dev-env.sh
yarn start
```

Keep that running. Twenty's backend, database, and Redis must be available while
the MCP is making calls. The MCP itself does not need its own persistent process
when a local stdio client launches it.

### Create a local Twenty API key

In Twenty, create an API key under **Settings → API & Webhooks → Create key**.
Assign it a dedicated role under **Settings → Members → Roles → Assignment**.

Start with the smallest useful permission set:

- Data Model read access for metadata discovery.
- Read access to the object families you want the MCP to inspect.
- Create/update/delete access only where you intend to let an agent make
  changes.
- Access to sequences, LinkedIn, or messaging objects only when you need those
  tools.

Use a separate API key for the MCP instead of reusing an administrator key. This
makes rotation, auditing, and revocation much easier.

The required environment variables are:

```bash
export TWENTY_BASE_URL="http://localhost:2000"
export TWENTY_API_KEY="replace-with-your-role-scoped-key"
```

For Twenty Cloud, use `https://api.twenty.com`. For another self-hosted
workspace, use its API origin without `/rest`, `/graphql`, or `/metadata`:

```bash
export TWENTY_BASE_URL="https://crm.example.com"
```

Optional variables:

```bash
export TWENTY_USER_TOKEN="replace-only-if-you-have-a-user-scoped-token"
export TWENTY_ENABLE_ADVANCED="false"
export TWENTY_METADATA_CACHE_TTL_MS="300000"
export TWENTY_REQUEST_TIMEOUT_MS="15000"
export TWENTY_MAX_RETRIES="2"
```

`TWENTY_USER_TOKEN` is needed for Apollo enrichment, connected-account
discovery, one-off email, drafts, record email/calendar timelines, user-scoped
Unibox operations, and some user-owned LinkedIn data. Do not copy a browser
session token into a shared configuration. If you do not have an intentionally
issued user token, leave it unset and use the API-key-compatible tools.

### Search downloaded LinkedIn data

LinkedIn search tools query the records already downloaded into Twenty. They do
not fetch LinkedIn live, and they require `TWENTY_USER_TOKEN` so results remain
scoped to the owning workspace member.

Search message bodies for one contact and an exact delivered-at range:

```json
{
  "tool": "twenty_search_linkedin_messages",
  "arguments": {
    "contact": "Katrin Zaragoza",
    "search": "publication plan",
    "direction": "OUTBOUND",
    "date_from": "2026-08-01T00:00:00.000Z",
    "date_to": "2026-08-13T23:59:59.999Z",
    "limit": 50,
    "response_format": "json"
  }
}
```

Search sent invitation observations and outbound messages in one time window:

```json
{
  "tool": "twenty_search_linkedin_activity",
  "arguments": {
    "types": ["MESSAGES", "INVITATIONS"],
    "direction": "OUTBOUND",
    "date_from": "2026-08-01T00:00:00.000Z",
    "date_to": "2026-08-13T23:59:59.999Z",
    "limit_per_type": 100,
    "response_format": "json"
  }
}
```

List outbound messages for which LinkedIn supplied a positive recipient read
receipt:

```json
{
  "tool": "twenty_list_linkedin_message_read_receipts",
  "arguments": {
    "status": "READ_CONFIRMED",
    "limit": 50,
    "response_format": "json"
  }
}
```

The tool reports `READ_CONFIRMED` only when the connector observed LinkedIn's
receipt. A missing receipt is `UNKNOWN`, not `UNREAD`, because privacy settings
and some LinkedIn message types can suppress receipts.

The activity tool keeps results separated into messages, connections,
invitations, and actions because those objects have different meanings and event
timestamps. Established connections have no sent/received direction. Invitation
rows are historical observations and do not by themselves prove that a request
is still pending. Runner actions describe queue/execution attempts; downloaded
messages describe delivered message history.

Dedicated search results return `next_cursor`. Pass it as `starting_after` to
continue that resource. Cross-source activity has independent pagination per
resource, so continue through the corresponding dedicated
`twenty_search_linkedin_*` tool.

Keep advanced mode off initially. It exposes permanent record destruction and
high-volume attachment/message reads.

Verify the backend and key before configuring an MCP client:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $TWENTY_API_KEY" \
  "$TWENTY_BASE_URL/rest/metadata/objects?limit=1"
```

A JSON response confirms that the URL and key work. Connection refused means
the backend is not running or the port is wrong. A 401 means the key is missing,
expired, or invalid. A 403 means its assigned role lacks permission.

## 3. Local stdio lifecycle

With stdio, the client launches this command:

```bash
/opt/homebrew/bin/node \
  /Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js
```

The process remains attached to the client session and exits when the client
disconnects. This means:

- You do not start it in another terminal.
- You do not need `launchd`, `systemd`, Docker, or PM2.
- Rebuilding the package takes effect the next time the client starts it.
- After changing configuration or rebuilding, restart the client or reconnect
  the MCP server.

Running the command manually appears to do nothing because stdio MCP waits for
JSON-RPC input on standard input. That is normal.

## 4. Connect Codex

Codex CLI, the Codex IDE extension, and the ChatGPT desktop app share the same
Codex MCP configuration. You can configure the server globally in
`~/.codex/config.toml` or only for this trusted repository in
`.codex/config.toml`.

### Recommended configuration

Make the variables available to the process that launches Codex, then add:

```toml
[mcp_servers.twenty]
command = "/opt/homebrew/bin/node"
args = [
  "/Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js",
]
env_vars = [
  "TWENTY_BASE_URL",
  "TWENTY_API_KEY",
  "TWENTY_USER_TOKEN",
  "TWENTY_ENABLE_ADVANCED",
]
startup_timeout_sec = 20
tool_timeout_sec = 60
required = false
default_tools_approval_mode = "writes"
```

`default_tools_approval_mode = "writes"` allows read-only tools without a
confirmation dialog and asks before tools that are marked as writes.

Keep `required = false` until the first successful connection. If a required
server exits before completing its MCP handshake, Codex cannot start or resume
any chat that loads it. After verification, you can set `required = true` if
you deliberately want Codex startup to depend on Twenty.

If you launch Codex from a shell, export the variables in that shell first:

```bash
export TWENTY_BASE_URL="http://localhost:2000"
export TWENTY_API_KEY="replace-me"
codex
```

These shell exports normally do **not** reach the Codex or ChatGPT desktop app
when it is opened from Finder, Spotlight, or the Dock. For the desktop app, use
the wrapper below or set the values directly in `[mcp_servers.twenty.env]`.

### Desktop-safe wrapper

Desktop applications may not inherit variables from your interactive shell. A
simple alternative is an owner-readable environment file and a wrapper.

Create `~/.config/twenty-mcp/env`:

```bash
TWENTY_BASE_URL='http://localhost:2000'
TWENTY_API_KEY='replace-me'
TWENTY_ENABLE_ADVANCED='false'
```

Protect it:

```bash
chmod 600 ~/.config/twenty-mcp/env
```

Create `~/.local/bin/twenty-mcp`:

```bash
#!/bin/zsh
set -a
source "$HOME/.config/twenty-mcp/env"
set +a
exec /opt/homebrew/bin/node \
  /Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js
```

Then:

```bash
chmod 700 ~/.local/bin/twenty-mcp
```

Use the wrapper in `config.toml`:

```toml
[mcp_servers.twenty]
command = "/Users/kasraaliyon/.local/bin/twenty-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 60
required = false
default_tools_approval_mode = "writes"
```

This still stores the Twenty key on disk, but the file is restricted to your
operating-system user. Do not commit it.

### Configure through the UI

In the ChatGPT desktop app:

1. Open **Settings → MCP servers**.
2. Select **Add server**.
3. Choose **STDIO**.
4. Use `/Users/kasraaliyon/.local/bin/twenty-mcp` as the command, or use the
   Node command and entry-point path directly.
5. Save and select **Restart**.

In the Codex IDE extension, use **MCP servers → Add server**, save, and restart
the extension.

### Recover Codex when Twenty prevents chats from opening

If Codex reports `required MCP servers failed to initialize`:

1. Open **Settings → MCP servers → Twenty** and disable the server, or remove
   it temporarily. If you can edit the config directly, set
   `required = false` or `enabled = false`.
2. Fully quit and reopen Codex.
3. Confirm the wrapper's environment file contains `TWENTY_API_KEY` and that
   `TWENTY_BASE_URL` points to the backend API. In the standard local Twenty
   setup, the API is `http://localhost:2000` and the frontend is
   `http://localhost:2001`.
4. Re-enable the server and restart Codex.

An error ending in `connection closed: initialize response` means the MCP
process exited before replying to Codex's initialization request. The most
common cause for this server is a missing `TWENTY_API_KEY`, especially when
shell exports were used for a desktop-launched app.

### Verify Codex

From the terminal:

```bash
codex mcp list
```

Inside Codex, run `/mcp` and confirm that `twenty` is connected and exposes 126
tools. Then ask:

```text
Use the Twenty MCP health check. Do not modify anything.
```

Follow with:

```text
List the available Twenty objects, then describe the people object. Read only.
```

## 5. Connect Claude Code

### Project configuration without committed secrets

Add `.mcp.json` at the repository root:

```json
{
  "mcpServers": {
    "twenty": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/node",
      "args": [
        "/Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js"
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

Claude Code expands `${VAR}` and `${VAR:-default}`. Export the required
variables before launching Claude Code:

```bash
export TWENTY_BASE_URL="https://api.twenty.com"
export TWENTY_API_KEY="replace-me"
claude
```

Claude Code asks you to approve a project-scoped MCP configuration the first
time it sees it.

### Add it with the Claude CLI

The following stores the configuration in your user scope:

```bash
claude mcp add \
  --transport stdio \
  --scope user \
  --env TWENTY_BASE_URL=https://api.twenty.com \
  --env TWENTY_API_KEY=replace-me \
  --env TWENTY_ENABLE_ADVANCED=false \
  twenty -- \
  /opt/homebrew/bin/node \
  /Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js
```

Be aware that values supplied with `--env` are stored in Claude's local
configuration. Prefer environment-variable references in a project `.mcp.json`
when the file will be shared, and never commit real credentials.

### Verify Claude Code

```bash
claude mcp list
claude mcp get twenty
```

Inside Claude Code, run `/mcp`. Then ask for the health check and object list.

Useful management commands:

```bash
claude mcp remove twenty
claude mcp reset-project-choices
```

## 6. Connect Claude Desktop

Claude Desktop is the easiest graphical client because the package already
includes a self-contained MCPB desktop extension.

Rebuild the bundle when needed:

```bash
cd /Users/kasraaliyon/Documents/GitHub/twenty
yarn workspace twenty-mcp-server mcpb:pack
```

Install it:

1. Open **Claude Desktop → Settings → Extensions**.
2. Open **Advanced settings**.
3. Under **Extension Developer**, select **Install Extension…**.
4. Select
   `/Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/twenty-mcp-server.mcpb`.
5. Enter the Twenty base URL and API key.
6. Leave the optional user token blank unless you intentionally have one.
7. Leave advanced tools disabled initially.
8. Complete installation and restart Claude Desktop if the tools do not appear
   immediately.

Claude Desktop stores manifest fields marked `sensitive` in operating-system
secure storage. The extension uses Claude's bundled Node runtime, so users who
install the MCPB do not need this source checkout or a separate Node
installation.

To verify it, click the `+` near the chat composer, open **Connectors**, and
confirm that Twenty is enabled. Extension status and logs are available under
**Settings → Extensions**.

For a private MCPB update, rebuild the bundle and reinstall it. For a
distributed update, increment the version in both `package.json` and
`manifest.json` before packing so Claude recognizes it as a newer version.

## 7. Connect ChatGPT web and mobile

ChatGPT web cannot read your local Codex `config.toml` and cannot directly
launch a local stdio process. The recommended private route is OpenAI Secure MCP
Tunnel. It creates an outbound-only connection and avoids exposing the server
to the public internet.

### Set up a private Secure MCP Tunnel

1. Open the OpenAI Platform tunnel settings and create a tunnel.
2. Associate it with the Platform organization and ChatGPT workspace that
   should use it.
3. Ensure your account has Tunnels Read + Use; creating the tunnel also needs
   Tunnels Manage.
4. Download the current `tunnel-client` from the Platform page.
5. Enable ChatGPT developer mode under **Settings → Security and login**.

Export the credentials that the child MCP process needs:

```bash
export TWENTY_BASE_URL="https://api.twenty.com"
export TWENTY_API_KEY="replace-me"
export TWENTY_ENABLE_ADVANCED="false"
export CONTROL_PLANE_API_KEY="replace-with-the-runtime-platform-key"
```

Initialize the tunnel profile:

```bash
tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile twenty \
  --tunnel-id tunnel_replace_me \
  --mcp-command "/opt/homebrew/bin/node /Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js"
```

Validate and start it:

```bash
tunnel-client doctor --profile twenty --explain
tunnel-client run --profile twenty
```

Keep that final process running. The tunnel client launches and communicates
with the stdio MCP server.

In ChatGPT:

1. Open **Settings → Plugins** or `https://chatgpt.com/plugins`.
2. Select the plus button to create a developer-mode app.
3. Choose **Tunnel** for the connection.
4. Select the Twenty tunnel.
5. Confirm that ChatGPT discovers the tool list.
6. In a new conversation, use `+ → More` and enable the Twenty app.

Once linked, the app can also be available in ChatGPT mobile for that account
and workspace.

Keep tunnel access narrow. Everyone allowed to use this developer-mode app acts
through the same configured Twenty credential. Use a dedicated role and do not
associate the tunnel with workspaces that should not reach that CRM account.

### Public ChatGPT deployment

ChatGPT can also connect to a public HTTPS `/mcp` endpoint. For authenticated
customer data and write actions, ChatGPT expects MCP-compliant OAuth 2.1
discovery and token validation.

The current Twenty MCP HTTP transport supports a static bearer token, not OAuth
2.1. Therefore:

- Use Secure MCP Tunnel for private ChatGPT use today.
- Do not publish the endpoint without authentication.
- Before public or multi-user ChatGPT distribution, add an OAuth 2.1
  authorization layer, per-user Twenty credential mapping, scopes, revocation,
  and audit policy.

## 8. Connect Claude web and mobile

Claude web custom connectors are remote: Anthropic's cloud connects to the MCP
server, even when you configure the connector from Claude Desktop. The endpoint
must therefore be reachable over public HTTPS from Anthropic's network.

After the server has public HTTPS and MCP-compatible OAuth:

1. Open **Customize → Connectors**.
2. Select `+ → Add custom connector`.
3. Enter the public URL, such as `https://mcp.example.com/mcp`.
4. Complete OAuth configuration and authentication.
5. Enable the connector for a conversation from `+ → Connectors`.

The current server's static bearer-token HTTP authentication is directly usable
by Claude Code, but Claude's web connector setup does not provide the same
arbitrary-header configuration. Consequently, Claude web/mobile is not turnkey
with the current server.

Do not work around this by making the server anonymous. Add an OAuth-aware
gateway or extend the server with MCP OAuth before using it from claude.ai.
Until then, use Claude Desktop's MCPB or Claude Code's stdio setup.

## 9. Run a shared Streamable HTTP service

Use HTTP when multiple local clients need one shared server, when a trusted
private network needs it, or when a tunnel/reverse proxy needs an HTTP target.

Start locally:

```bash
export TWENTY_BASE_URL="https://api.twenty.com"
export TWENTY_API_KEY="replace-me"
export TRANSPORT="http"
export HOST="127.0.0.1"
export PORT="3333"
export TWENTY_MCP_HTTP_BEARER_TOKEN="generate-a-long-random-value"

node \
  /Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js
```

Endpoints:

```text
http://127.0.0.1:3333/health
http://127.0.0.1:3333/mcp
```

The health endpoint checks the MCP process, not the full Twenty API permission
set. Use `twenty_health_check` through an MCP client for an authenticated CRM
check.

Connect Codex:

```toml
[mcp_servers.twenty_http]
url = "http://127.0.0.1:3333/mcp"
bearer_token_env_var = "TWENTY_MCP_HTTP_BEARER_TOKEN"
required = true
default_tools_approval_mode = "writes"
```

Connect Claude Code:

```bash
claude mcp add \
  --transport http \
  --scope user \
  --header "Authorization: Bearer replace-with-the-http-token" \
  twenty-http \
  http://127.0.0.1:3333/mcp
```

Non-loopback binds require `TWENTY_MCP_HTTP_BEARER_TOKEN`. The server does not
provide TLS, so use a trusted HTTPS reverse proxy for any network boundary.

## 10. Keep an HTTP deployment running

You do not need this section for stdio. It is only for shared HTTP or remote
operation.

### macOS with `launchd`

Create a protected environment file as shown earlier and add:

```bash
TRANSPORT='http'
HOST='127.0.0.1'
PORT='3333'
TWENTY_MCP_HTTP_BEARER_TOKEN='replace-with-a-long-random-token'
```

Create `~/.local/bin/twenty-mcp-http`:

```bash
#!/bin/zsh
set -a
source "$HOME/.config/twenty-mcp/env"
set +a
exec /opt/homebrew/bin/node \
  /Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js
```

Protect it:

```bash
chmod 700 ~/.local/bin/twenty-mcp-http
mkdir -p ~/Library/Logs/TwentyMcp
```

Create `~/Library/LaunchAgents/com.twenty.mcp-http.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.twenty.mcp-http</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/kasraaliyon/.local/bin/twenty-mcp-http</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>/Users/kasraaliyon/Library/Logs/TwentyMcp/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/kasraaliyon/Library/Logs/TwentyMcp/stderr.log</string>
  </dict>
</plist>
```

Load it:

```bash
launchctl bootstrap \
  "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.twenty.mcp-http.plist
```

Inspect or restart it:

```bash
launchctl print "gui/$(id -u)/com.twenty.mcp-http"
launchctl kickstart -k "gui/$(id -u)/com.twenty.mcp-http"
tail -f ~/Library/Logs/TwentyMcp/stderr.log
```

Stop and unload it:

```bash
launchctl bootout \
  "gui/$(id -u)" \
  ~/Library/LaunchAgents/com.twenty.mcp-http.plist
```

Use a similar LaunchAgent for `tunnel-client run --profile twenty` when ChatGPT
depends on the tunnel. Store the control-plane API key in an owner-readable
environment file, not in the plist.

### Linux with `systemd`

Store secrets in `/etc/twenty-mcp.env`, readable only by root and the service
account:

```bash
TWENTY_BASE_URL=https://api.twenty.com
TWENTY_API_KEY=replace-me
TWENTY_ENABLE_ADVANCED=false
TRANSPORT=http
HOST=127.0.0.1
PORT=3333
TWENTY_MCP_HTTP_BEARER_TOKEN=replace-with-a-long-random-token
```

Example `/etc/systemd/system/twenty-mcp.service`:

```ini
[Unit]
Description=Twenty CRM MCP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=twenty-mcp
Group=twenty-mcp
WorkingDirectory=/opt/twenty
EnvironmentFile=/etc/twenty-mcp.env
ExecStart=/usr/bin/node /opt/twenty/packages/twenty-mcp/dist/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now twenty-mcp
sudo systemctl status twenty-mcp
sudo journalctl -u twenty-mcp -f
```

Place Caddy, nginx, or another TLS reverse proxy in front of
`127.0.0.1:3333`. Preserve the `Authorization` header and keep the application
bearer token enabled. Static bearer authentication is suitable for controlled
Codex/Claude Code clients, but it does not replace OAuth for public ChatGPT or
Claude connectors.

## 11. How to use the tools

Start each unfamiliar workflow with discovery:

```text
Use Twenty to list the available CRM objects. Then describe the people,
companies, and opportunities schemas. Do not modify anything.
```

Read examples:

```text
Find people whose email domain is example.com. Return their name, title,
company, and email. Do not make changes.
```

```text
Show the opportunity pipeline grouped by stage, including count and total
amount. Read only.
```

```text
Find all overdue incomplete tasks owned by me and group them by priority.
```

Safe write example:

```text
Create a company named Acme Test with domain acme.test. Before calling any
write tool, show me the exact record payload and wait for my approval.
```

Relationship example:

```text
Find Jane Doe and Acme Test. If both are unambiguous, show me their IDs and ask
for confirmation before setting Jane's company.
```

Sequence example:

```text
Call the sequence capabilities tool, then create a draft sequence called July
Follow-up. First branch on whether the contact has an email. On Yes, add an
automated email; on No, add a manual task to find the right address. Merge both
paths into a two-day delay. Do not activate or enroll anyone. Show me the final
ordered draft, including branch placement and execution modes. Then call the
read-only sequence validation tool and show the feature-flag blocker, the first
activation-invariant blocker, and timing warnings without changing the sequence
status.
```

Outbound example:

```text
Preview the audience for this campaign, then show me the list, sender,
unsubscribe topic, subject, body, and sendable/skipped counts. Do not send
until I explicitly confirm.
```

Apollo enrichment example:

```text
Find the exact IDs for the selected people and show them to me. Explain the
maximum Apollo credit usage. Do not call the enrichment tool until I explicitly
confirm the complete ID list.
```

The server itself requires `confirm=true` for destructive, bulk, sequence
activation/enrollment, email/campaign sending, draft sending, Unibox import,
Apollo enrichment, and LinkedIn actions. Keep the host's own write-approval
policy enabled as a second layer.

## 12. Safety and operational policy

- Use one least-privilege Twenty key per environment.
- Keep production and testing keys separate.
- Keep advanced mode disabled unless permanent deletion or high-volume reads
  are explicitly required.
- Review the exact targets before merges, deletion, bulk enrollment, sequence
  activation, email/campaign sending, Apollo enrichment, or outbound LinkedIn
  actions.
- Apollo enrichment uses an external paid service. General person and company
  enrichment can consume up to one credit per matched record; phone enrichment
  can consume up to nine credits per matched person and may complete
  asynchronously.
- Start merge operations with `dry_run=true`.
- Prefer `twenty_delete_record`, which moves records to trash, over the advanced
  permanent destroy tool.
- Rotate keys after suspected exposure and remove old keys from every client
  configuration.
- Do not place API keys in committed `.mcp.json`, `.codex/config.toml`, shell
  history, tickets, or chat prompts.
- Treat tool output as CRM customer data and apply your normal data-retention
  rules to agent conversations.
- Keep the server and Twenty API on trusted, patched hosts.

Attachment upload remains intentionally unavailable until the MCP has a
configured local-path allow-list and file-size policy. One-off email and
campaign sending are available, require a user token, and require explicit
confirmation.

## 13. Updating the server

For source-based stdio clients:

```bash
cd /Users/kasraaliyon/Documents/GitHub/twenty
git pull
yarn install
npx nx lint twenty-mcp
npx nx typecheck twenty-mcp
npx nx test twenty-mcp
npx nx build twenty-mcp
```

Restart or reconnect Codex/Claude Code afterward.

For Claude Desktop:

```bash
yarn workspace twenty-mcp-server mcpb:pack
```

Reinstall the new MCPB. Increment its version before distributing updates to
other users.

For a long-running HTTP service, deploy the new build and restart the service:

```bash
launchctl kickstart -k "gui/$(id -u)/com.twenty.mcp-http"
```

or:

```bash
sudo systemctl restart twenty-mcp
```

When tool names, descriptions, or schemas change:

- Restart local clients.
- Reinstall an updated MCPB.
- Refresh the developer-mode app metadata in ChatGPT.
- Reconnect or refresh Claude remote connectors after deployment.

## 14. Troubleshooting

### The client cannot start the server

Check:

```bash
/opt/homebrew/bin/node --version
test -f \
  /Users/kasraaliyon/Documents/GitHub/twenty/packages/twenty-mcp/dist/index.js
```

Use absolute executable and entry-point paths. Rebuild with:

```bash
npx nx build twenty-mcp
```

### The server exits with a missing variable error

The GUI client probably did not inherit your shell environment. Use the
owner-readable wrapper approach or configure the variables in the client's MCP
settings.

### Health check returns 401 or 403

- Confirm the base URL is the origin and does not include `/rest`.
- Regenerate or rotate the API key.
- Confirm the key's role is assigned and has the required object permissions.
- Confirm the key belongs to the intended workspace.

### Metadata discovery fails

Grant Data Model read access. Use `twenty_refresh_metadata` after changing
fields, options, roles, or workspace schema.

### User-scoped tools report that a user token is required

The configured API key does not provide a user context. Configure an
intentionally issued `TWENTY_USER_TOKEN`, or leave Apollo enrichment, connected
accounts, email, drafts, record timelines, and Unibox unavailable.
API-key-compatible tool families continue working.

### Only 126 tools appear

That is the normal safe configuration for MCP `0.3.0` and sequence contract
`2026-08-20.2`. Set `TWENTY_ENABLE_ADVANCED=true` and restart the server to
expose 131 tools, including permanent-destroy operations. Call
`twenty_get_sequence_capabilities` and inspect `contract_version` after every
sequence-schema deployment; a missing or older value means the running MCP was
not rebuilt/restarted.

### A change is not reflected

- Source stdio: rebuild and restart the client.
- MCPB: rebuild, increment the bundle version, and reinstall.
- ChatGPT developer app: select **Refresh** in plugin settings.
- HTTP: restart the service.
- Metadata-only change: call `twenty_refresh_metadata`.

### ChatGPT cannot find the private tunnel

- Keep `tunnel-client run --profile twenty` running.
- Run `tunnel-client doctor --profile twenty --explain`.
- Confirm the tunnel is associated with the target ChatGPT workspace.
- Confirm Tunnels Read + Use permissions.
- Check the tunnel client's local health/admin UI.

### Claude web cannot authenticate

This is expected with the current static bearer-only HTTP server. Use Claude
Desktop or Claude Code, or add MCP-compatible OAuth before configuring a Claude
web custom connector.

### Find logs

- Codex: `/mcp`, `codex mcp list`, and the desktop MCP settings.
- Claude Code: `/mcp`, `claude mcp list`, and `claude mcp get twenty`.
- Claude Desktop: **Settings → Extensions → Twenty → Logs**.
- `launchd`: `~/Library/Logs/TwentyMcp/`.
- `systemd`: `journalctl -u twenty-mcp`.

Never log API keys, bearer tokens, or full authorization headers.

## 15. Recommended rollout

1. Build the package.
2. Create a read-mostly Twenty API role and dedicated key.
3. Connect one local client over stdio.
4. Verify health, metadata discovery, list, and get operations.
5. Test one harmless create/update in a non-production workspace.
6. Enable only the workflow permissions you need.
7. Install the MCPB for Claude Desktop if desired.
8. Use Secure MCP Tunnel only when ChatGPT web/mobile access is needed.
9. Add OAuth before any public or multi-user remote connector deployment.
10. Document key ownership, rotation, allowed workflows, and incident response.

## Current client documentation

- [Codex and ChatGPT MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
- [Connect an MCP app from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)
- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [OpenAI Apps SDK authentication](https://developers.openai.com/apps-sdk/build/auth)
- [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp)
- [Claude Desktop local MCP servers](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Claude custom remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [MCPB specification and tooling](https://github.com/modelcontextprotocol/mcpb)
