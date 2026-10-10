# Contabo + Coolify production

This directory prepares deployment of the customized fork. It does not provision a VPS or enable production automatically. One Contabo x86 VPS with 4 vCPU / 8 GB RAM runs free self-hosted Coolify, the combined CRM frontend/API, worker, PostgreSQL, Redis and MCP. Builds run on GitHub, outside the small production server.

## Release flow

Local changes → commit and push to `main` → tests → immutable app/MCP images and extension ZIP → backup with writers stopped → Coolify deployment → migration and health checks → optional Chrome Web Store submission.

- `.github/workflows/release-production.yaml` builds on `main` and the initial deployment branch. Only `main` can deploy.
- All three artifacts must build before the CRM/MCP deployment runs.
- App and MCP images use Git commit tags and deploy by SHA-256 digest. Both the Compose source and images are pinned to the same release.
- No Watchtower or upstream `latest` updates: upstream releases must first be integrated into this fork, tested and pushed.
- The workflow serializes releases. A migration failure prevents the API and worker from serving the new release. Failed migrations require inspection; do not automatically run an older image against a possibly changed database.
- Expect a short maintenance interval during backup/migration. This is a single-server setup.

## Initial setup (operator/agent)

1. Obtain access to Contabo and the chosen domain's DNS. Confirm the exact VPS invoice before purchase; use EU location, Ubuntu LTS, monthly billing, no unnecessary add-ons. Install Coolify from its [official installation instructions](https://coolify.io/docs/get-started/installation). Do not run its host installer on the developer's Mac.
2. Configure SSH keys, a firewall, security updates, time sync and log/disk monitoring. Expose only HTTPS/HTTP and restricted SSH. Keep database, Redis, CRM port 3000 and MCP port 3333 unbound to host ports. Make the Coolify panel available over HTTPS.
3. Create DNS names for CRM, MCP and Coolify. Create a **Docker Compose application from the fork's public Git repository**, branch `main`, Compose location `/packages/twenty-docker/production/compose.yml`. Disable Coolify's automatic Git webhook deployments; the Actions pipeline is the release authority. This is an application, not a service-stack resource: the automation uses application API endpoints.
4. Set runtime environment values using `.env.example`. Configure Coolify service domains: `server` → `https://crm.DOMAIN:3000`, `mcp` → `https://mcp.DOMAIN:3333`; only the proxy's 443/80 are public. Verify the generated public URLs omit internal port numbers. Use image digests from the successful workflow; set GHCR packages public (their source is already public) or configure a read-only registry credential.
5. Migrate the existing local CRM if it is to remain the source of truth: back up the PostgreSQL database and upload directory, preserve `APP_SECRET` and the effective `ENCRYPTION_KEY` (which may fall back to `APP_SECRET`), restore before starting the app, then run migrations once through the server entrypoint. Verify the database's existing PostgreSQL major version/extensions before restoring. Do not copy a running PostgreSQL data directory or reset production. Preserve Redis queue state when resuming pending work. Review queued email/LinkedIn jobs before starting the worker.
6. For a fresh installation, initially use a random placeholder `TWENTY_API_KEY` and an unreachable/private MCP route, finish CRM owner/workspace creation, then replace it with a real scoped API key. A placeholder passes configuration parsing but cannot perform CRM operations. Validate authenticated CRM requests before making MCP available.
7. Configure SMTP and any existing Google/Microsoft OAuth integrations, including their new HTTPS callback URLs. The `logger` email driver is a bootstrap default and does not deliver mail. OAuth providers remain disabled until configured.
8. Install `backup.sh` root-owned, mode 0700 at `/opt/twenty/backup.sh`. Install the systemd service/timer into `/etc/systemd/system`, reload systemd, and enable the timer **after** the first deployment. Backups briefly stop writers and resume them. The pipeline's `prepare` mode leaves writers stopped for the deployment. Give Actions a separate SSH key with `restrict,command="/opt/twenty/backup.sh prepare"` in root's `authorized_keys`. Verify the SSH host key against the Contabo console; never use unauthenticated `ssh-keyscan` output as the trust decision.
9. Run a backup and restore it into an isolated temporary database. Backups include database, Redis, uploads, MCP session and container configuration/encryption keys, so `/var/backups/twenty` must stay root-only. Set up encrypted off-server copies and retention/disk alerts before calling the setup production-ready. The provided backup script keeps all snapshots; it does **not** provide offsite redundancy or prune them. Contabo VM snapshots alone are not the restore test.
10. Create a Coolify token scoped to this team/application and put it in GitHub's `production` environment. Enable Coolify's built-in MCP at instance/team settings for AI operations; keep its bearer token outside Git. API/SSH access is still needed for host/configuration work. Connect the CRM MCP URL separately using its own bearer token.
11. Populate the GitHub variables/secrets below. Verify a manual first deployment, CRM login/API, worker, MCP tools, and extension capture against a test contact. Enable the automatic gates only after these checks.

## GitHub configuration

Use repository variables for URLs needed by the extension build. Secrets belong in the `production` environment.

| Kind | Names | Purpose |
| --- | --- | --- |
| Repository variables | `TWENTY_PUBLIC_URL`, `TWENTY_MCP_PUBLIC_URL`, `COOLIFY_URL`, `COOLIFY_APP_UUID` | Production HTTPS origins and application identifier |
| Repository variables | `PRODUCTION_DEPLOY_ENABLED=true`, `CHROME_PUBLISH_ENABLED=true` | Separate opt-in gates; leave unset during bootstrap |
| Production secrets | `COOLIFY_TOKEN`, `TWENTY_MCP_HTTP_BEARER_TOKEN` | Deployment and authenticated MCP verification |
| Production secrets | `PRODUCTION_SSH_TARGET`, `PRODUCTION_SSH_KEY`, `PRODUCTION_SSH_KNOWN_HOSTS` | Restricted backup command; target `root@HOST`; verified host key |
| Repository variables | `CHROME_PUBLISHER_ID`, `CHROME_EXTENSION_ID` | Existing store listing |
| Production secrets | `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` | Chrome Web Store API authorization |

Default placeholder extension URLs are for build verification only. Set the real repository variable before enabling deployment or distributing the ZIP. Builds are named `1.2.2.<workflow run number>`; adjust the version scheme before run number 65536 or publishing a higher manually assigned version.

## MCP sessions

The API key handles ordinary CRM tools. User-scoped LinkedIn/email tools additionally need a dedicated user session. Store its token-pair JSON (the `tokens` object returned by Twenty sign-in) at `/state/user-session.json` in the MCP volume, owned by UID 1000 with mode 0600. Set `TWENTY_USER_SESSION_FILE=/state/user-session.json`. The server renews expiring access tokens and atomically persists rotated refresh tokens. Reauthentication is still required after session revocation or refresh-token expiry. Run a single MCP replica with this session file.

Use a dedicated session rather than sharing the browser extension's rotating refresh token. The old `TWENTY_USER_TOKEN` mode remains available for local development but is not durable. MCP access grants the CRM permissions of its configured keys/session; give the endpoint only to authorized clients.

## LinkedIn extension updates

The extension runs in the user's Chrome browser with their LinkedIn session. Hosting does not move that browser session onto the VPS. Local development still defaults to ports 2001/2000. Production builds include the configured HTTPS CRM origin in defaults, host permissions and the token bridge.

The workflow creates a ZIP on every successful build. Automatic installed-extension updates require a Chrome Web Store listing and one-time publisher setup/sign-in; an unpacked extension does not automatically update from a ZIP. Configure an unlisted listing if appropriate, privacy disclosures, OAuth publishing credentials and the first installation. Follow the [official API setup](https://developer.chrome.com/docs/webstore/using-api). Avoid an OAuth testing configuration that expires its refresh token after seven days.

After the deployment passes, the optional job uploads and submits that ZIP for review. Google approval and client rollout are separate from server deployment. Maintain backward-compatible extension/API contracts during that window. The job does not cancel an existing review automatically; investigate store conflicts instead of silently replacing a pending submission.

## Recovery

If backup fails, the script attempts to restart the existing writers and the deployment job stops. If deployment/migration fails after backup, inspect Coolify logs and leave writers stopped until the database state is understood. For a destructive migration rollback, restore the matching backup, uploads, Redis/session state and old image digests together. Never use `docker compose down -v` in production.

Useful official references: [Coolify Compose](https://coolify.io/docs/applications/build-packs/docker-compose), [deployment API](https://coolify.io/docs/api/endpoints/deployments/deploy-by-tag-or-uuid), [environment API](https://coolify.io/docs/api/endpoints/applications/update-envs-by-application-uuid), [Chrome upload states](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/UploadState).
