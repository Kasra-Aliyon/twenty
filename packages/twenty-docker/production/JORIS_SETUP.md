# Joris: your personal 7Scholar CRM MCP

This connects your agents to the existing shared 7Scholar CRM. You do not need a local CRM, source checkout, database, or Docker.

## Connection details

| Item | Value |
| --- | --- |
| CRM | `https://crm.sevenscholar.com` |
| Your MCP endpoint | `https://crm.sevenscholar.com/mcp-joris/mcp` |
| Your account connection page | `https://crm.sevenscholar.com/mcp-joris/connect` |
| MCP transport | Streamable HTTP |
| Authentication | `Authorization: Bearer <YOUR_PERSONAL_MCP_TOKEN>` |
| Agent server name | `twenty` |
| Chrome extension App URL | `https://crm.sevenscholar.com` |
| Chrome extension API URL | `https://crm.sevenscholar.com` |

Kasra supplies your new personal MCP token privately. The earlier shared token and `mcp.sevenscholar.com/mcp` endpoint belong to Kasra's connection; replace them in your clients. Do not use a CRM API key, CRM password, or Google/Microsoft password as the MCP token.

Deployment and personal authorization are separate: a running endpoint can access shared records before you connect your personal session. Email and LinkedIn tools fail closed until that session is authorized. Do not report personal setup complete until the connection page identifies `joris@7scholar.com` and the account-specific tests pass.

## 1. Sign into your existing workspace

Open the CRM in your work Chrome profile and sign in as `joris@7scholar.com` using your existing account. You should see the team's People, Companies, Tasks, and other shared records. Do not create a new workspace.

## 2. Authorize your personal MCP session

1. In the same browser profile, open the account connection page above.
2. Paste your **new personal MCP token** into the password field.
3. Click **Connect my account**.
4. Confirm the page says **Connected as joris@7scholar.com**.

The page checks your signed-in CRM identity, then obtains and stores a dedicated renewable MCP session on the server. The browser and LinkedIn extension retain their own independent sessions. This does not send messages, activate sequences, or start LinkedIn outreach.

If the page says another CRM user is signed in, sign into the CRM as yourself and retry. Your connector is pinned to your CRM user ID and the shared workspace; it rejects another user's session. If the browser session has expired, sign into CRM again and reload the connection page.

To check an existing connection, enter the personal token and choose **Check connection**. The page clears its token field after each request and does not save the token. After session expiry or revocation, repeat the connection step.

## 3. Connect your email account

In CRM, open **Settings → Account → Connected accounts**, add your own Google/Microsoft account, and grant the required email permissions. CRM sign-in and mailbox authorization are separate steps. Wait for the account's email synchronization to become active.

Review mailbox visibility explicitly. The UI's **Everything** option shares subjects, bodies, and attachments with your team. Other options share subject/metadata or metadata only. Choose the team's intended policy; a personal MCP session does not override email visibility settings on shared contact activity timelines.

Never reconnect Kasra's mailbox under your user or choose his sending account to test your setup.

## 4. Connect your LinkedIn account

1. Obtain the approved `Twenty CRM - LinkedIn Capture` production ZIP from Kasra.
2. Extract it into a permanent folder that directly contains `manifest.json`.
3. Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose that folder.
4. Keep one installed copy. Use the same work Chrome profile for CRM and your LinkedIn login.
5. Set both extension URLs to `https://crm.sevenscholar.com`.
6. With the signed-in CRM tab active, open the popup and choose **Test Connection**; it should say **Connected**.
7. Sign into your own LinkedIn account. Opening LinkedIn can start automatic sync into CRM; use **Sync now** if necessary and leave the tab/browser open.
8. Keep outbound execution paused: the panel should offer **Start runner**. If it offers **Pause runner**, pause it during setup.

The extension syncs your LinkedIn records under your CRM user. Your MCP searches that stored data. Closing Chrome stops browser-based syncing/actions; it does not shut down the hosted MCP or prevent reads of data already stored in CRM.

For extension updates, replace files in the same folder and click **Reload** in `chrome://extensions`, then refresh CRM and LinkedIn tabs. The production connector version supplied with the original guide, 1.2.2.22, remains compatible with this deployment; use a newer approved production build when supplied.

## 5. Configure each agent client

Use your personal endpoint and token in every client. Installing MCP in one app does not configure separate apps or hosted agent runtimes. Merge entries into existing configuration and preserve other servers.

### Codex

In your private user `~/.codex/config.toml`:

```toml
[mcp_servers.twenty]
url = "https://crm.sevenscholar.com/mcp-joris/mcp"
bearer_token_env_var = "TWENTY_MCP_HTTP_BEARER_TOKEN"
startup_timeout_sec = 30
tool_timeout_sec = 120
default_tools_approval_mode = "writes"
```

Provide the raw personal token, without `Bearer `, in that environment variable to the actual process launching Codex. A variable exported in a terminal is not automatically available to an app opened from the Dock/Start menu.

If needed, use this alternative in the private local file instead of `bearer_token_env_var`:

```toml
http_headers = { Authorization = "Bearer <YOUR_PERSONAL_MCP_TOKEN>" }
```

Keep credential-bearing files owner-only and out of repositories/shared folders. Restart the app/MCP and start a fresh chat after updating configuration.

### Claude Code

Set the same environment variable in the terminal that launches Claude, then add/update a user-scoped connection:

```bash
claude mcp add-json --scope user twenty '{"type":"http","url":"https://crm.sevenscholar.com/mcp-joris/mcp","headers":{"Authorization":"Bearer ${TWENTY_MCP_HTTP_BEARER_TOKEN}"}}'
```

Use the client's update/remove-and-readd flow if `twenty` already exists. Restart Claude Code and inspect `/mcp`.

### Claude Desktop or stdio-only clients

Use a current `mcp-remote` bridge with Node.js LTS. This installs only a bridge, not CRM. Create an owner-only header file containing `Authorization: Bearer <YOUR_PERSONAL_MCP_TOKEN>`, then merge this configuration with its actual absolute path:

```json
{
  "mcpServers": {
    "twenty": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://crm.sevenscholar.com/mcp-joris/mcp",
        "--transport", "http-only",
        "--header-file", "<ABSOLUTE_PATH_TO_PRIVATE_HEADER_FILE>"
      ]
    }
  }
}
```

Use the app's **Edit Config** action and fully quit/reopen it. Escape Windows backslashes in JSON; some Windows setups require `npx.cmd` or its absolute path.

### Other clients and hosted agents

Configure Streamable HTTP with your personal endpoint and a private `Authorization` bearer header. This endpoint does not offer MCP OAuth sign-in. Hosted agents need the endpoint/secret configured in their own runtime; they cannot read your laptop's environment or config automatically.

## 6. Verify actual access

Give your setup agent this prompt:

```text
Use only my personal Twenty MCP. Run read-only verification and do not display
credentials. Call twenty_health_check, list the tool catalog, and discover the
live shared objects with twenty_list_objects and twenty_describe_object.
Confirm the intended record, note/task, view/dashboard, email, LinkedIn,
sequence, Apollo, and enabled schema-tool families are available.

Call twenty_list_connected_accounts with a small read and confirm only my
intended sending accounts are returned. Search LinkedIn participants with
is_self=true and a small limit; once synced, the identity should be mine.
Empty LinkedIn results before sync are not proof that the connection failed.

Report shared-record access, personal-session status, mailbox ownership,
LinkedIn ownership/sync coverage, and pending steps separately. Do not create
test contacts, send messages, enroll/activate sequences, spend Apollo credits,
or start a LinkedIn runner as connectivity tests.
```

Your MCP publishes the same tool families and enabled feature flags as Kasra's. Personal operations execute with your dedicated user session and its CRM permissions. Paid/outbound/destructive operations retain their confirmation requirements; tool availability does not authorize those actions.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `401` | Check your personal endpoint/token and whether the running app receives the credential. The old shared token will not work on your endpoint. |
| `USER_SESSION_REQUIRED` | Complete **Connect my account** on your connection page. |
| Session expired/refresh failed | Sign into CRM as yourself and repeat the connection step. |
| Identity mismatch | Another user is signed in, the wrong session was supplied, or the service's identity configuration needs operator review. |
| Shared records work but personal data is absent | Verify your dedicated session, mailbox authorization, and LinkedIn sync separately. |
| Extension Not logged in | Same Chrome profile, correct URLs, CRM tab active; reload CRM and Test Connection. |
| Missing tools after updating | Restart/reconnect MCP and open a new chat; check live tool availability. |
| Email/LinkedIn permissions fail | Report the actual permission error to Kasra; do not substitute another user's credentials. |

The public process-health URL is `https://crm.sevenscholar.com/mcp-joris/health`. Its `ok` response does not establish that your personal session or mailbox is connected. Never paste the personal token into ordinary chat, a URL, or a support log.
