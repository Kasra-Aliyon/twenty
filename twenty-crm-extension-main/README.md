# Twenty CRM - LinkedIn Capture Extension

A Chrome extension to capture LinkedIn profiles and companies directly into your self-hosted [Twenty CRM](https://twenty.com).

---

## 📥 Download & Install

### Quick Install (Recommended)

1. **[⬇️ Download Latest Release](../../releases/latest)**
2. Download the `twenty-crm-linkedin-extension-*-chrome.zip` file
3. **Unzip** the file - you should see `manifest.json` and other files directly inside
4. Open Chrome → `chrome://extensions`
5. Enable **Developer mode** (toggle top right)
6. Click **Load unpacked** → select the **unzipped folder** (the one containing `manifest.json`)
7. Click the extension icon and enter your Twenty CRM URL

> **Note**: You must be logged into your Twenty CRM in the same browser for the extension to work.
>
> **Tip**: After unzipping, verify the folder contains `manifest.json` at the root level, not inside a subfolder.

---

## ✨ Features

| Feature                    | Description                                                |
| -------------------------- | ---------------------------------------------------------- |
| 🔗 **LinkedIn Capture**    | One-click capture of LinkedIn profiles to your CRM         |
| 🏢 **Company Auto-Create** | Automatically creates company records when adding contacts |
| 📸 **Photo Upload**        | Uploads LinkedIn profile photos directly to Twenty storage |
| 🔍 **Duplicate Detection** | Checks if contact/company exists by LinkedIn URL or name   |
| 🔄 **Update Existing**     | Refresh CRM records with latest LinkedIn data              |
| 🔎 **Manual Linking**      | Search and link LinkedIn profiles to existing CRM contacts |
| 🌍 **Multi-language**      | Extracts company names in EN, FR, DE, ES headlines         |
| 🔄 **Incremental Sync**    | Syncs connections, invites, threads, and new messages      |
| 🛡️ **Safety Guardrails**   | Durable read budgets, outbound caps, cooldowns, and locks  |

---

## 🚀 Usage

### Capturing a LinkedIn Profile

1. Visit any LinkedIn profile (`linkedin.com/in/username`)
2. A button appears in the **bottom-left corner**:

   | Button State       | Meaning                               |
   | ------------------ | ------------------------------------- |
   | **Add to Twenty**  | Profile not in CRM - click to add     |
   | **Open in Twenty** | Profile exists - click to view in CRM |

3. Click `•••` for more options:
   - **Link to existing contact** - Search and link to existing record
   - **Update from LinkedIn** - Refresh CRM with current LinkedIn data

### Capturing a Company

Same process - visit any LinkedIn company page (`linkedin.com/company/name`)

### Syncing LinkedIn data

- Open LinkedIn and use **Sync now** in the Twenty runner or extension popup.
- Sync every 30 mins while a LinkedIn tab is open.
- Stored totals are scoped to the signed-in LinkedIn account. During a sync,
  the runner separately shows how many records were processed in that run.
- Messages use activity and per-thread message checkpoints. Connections use a
  resumable historical cursor, and all records are upserted by stable external
  IDs so interrupted syncs can safely resume.
- Current releases write to Twenty's standard LinkedIn objects. If a workspace
  used an older extension that created custom LinkedIn objects at runtime,
  the Twenty 2.15 upgrade preserves them under `legacy...` API names, creates
  the standard LinkedIn objects, and copies supported legacy connections,
  invitations, threads, participants, and messages into the new model. Review
  the upgrade logs before starting a new sync; the preserved legacy objects
  remain available for verification and are not deleted automatically.

### Outbound actions

Outbound sequence actions remain explicitly opt-in through **Start runner**.
The extension applies a configurable browser-side cap of 1–20 attempts per
local day and at least 15 minutes between attempts, in addition to the
workspace-wide server schedule. Configure the local cap in the extension popup
or choose a lower per-sequence limit in Twenty. An action is recorded before
the final LinkedIn UI operation and is never silently replayed after an
uncertain outcome.

Sequences can also send direct LinkedIn messages through the visible LinkedIn
composer. The runner sends only when it recognizes the profile as a
first-degree connection. Direct messages share the same daily cap, minimum
interval, restriction detection, and no-replay behavior as connection actions.

### LinkedIn account-safety boundaries

The connector uses LinkedIn's unofficial internal endpoints for read-only sync,
so no implementation can guarantee that LinkedIn will never restrict an
account. The extension minimizes activity instead of trying to conceal it:

- one sync owner across tabs, persisted across service-worker restarts;
- no more than 8 read requests per minute, 60 per hour, or 200 per local day;
- 6–12 seconds between read requests;
- a 24-hour fail-closed cooldown after rate-limit, challenge, or restriction
  signals;
- no automatic retries for outbound actions with an uncertain outcome;
- direct messages are limited to recognized first-degree connections and use
  the visible composer rather than a hidden bulk-send endpoint.

---

## 📋 Data Captured

### People

- ✅ First name & Last name
- ✅ Job title / headline
- ✅ Profile photo (uploaded to Twenty)
- ✅ Location
- ✅ LinkedIn URL
- ✅ Current company (auto-created if needed)

### Companies

- ✅ Company name
- ✅ LinkedIn URL
- ✅ Website (when available)
- ✅ Employee count
- ✅ Industry
- ✅ Company logo

---

## 🛠️ Build from Source

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/twenty-crm-extension.git
cd twenty-crm-extension

# Install dependencies
npm install

# Development with hot reload
npm run dev

# Build for production
npm run build

# Create distributable ZIP
npm run zip
```

The built extension is in `.output/chrome-mv3/`

### Local Twenty Development

From the Twenty repository root, start the local app:

```bash
yarn start
```

Then run the extension separately:

```bash
cd twenty-crm-extension-main
npm install
npm run dev
```

Load the unpacked extension from `.output/chrome-mv3-dev` for development. For a production build, run `npm run build` and load `.output/chrome-mv3`.

The extension defaults to:

- Twenty App URL: `http://localhost:3001`
- Twenty API URL: `http://localhost:3000`

Log in to `http://localhost:3001` in the same browser profile. The extension syncs the local `tokenPairState` session from that page and uses `http://localhost:3000/graphql` directly.

---

## 🏷️ Creating a Release

**Option 1: Git Tag**

```bash
git tag v1.0.0
git push origin v1.0.0
```

**Option 2: Manual**

1. Go to GitHub → Actions → "Build and Release Extension"
2. Click "Run workflow"
3. Enter version (e.g., `v1.0.0`)

GitHub Actions will automatically build and create a release with the ZIP file.

---

## 🔧 Requirements

- Chrome or Chromium-based browser
- Self-hosted Twenty CRM instance
- Logged into Twenty CRM in the same browser

---

## ❓ Troubleshooting

| Issue                     | Solution                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| "Failed to save settings" | Check your Twenty URL is correct and you're logged in                |
| Button not appearing      | Refresh the LinkedIn page, check extension is enabled                |
| Profile photo not showing | Check Twenty's file storage is configured                            |
| Company not created       | Headline may not have recognizable pattern (`at/chez/@/bei` Company) |

### Debug Logs

- **Page console** (F12): Shows scraping logs
- **Service Worker**: Go to `chrome://extensions` → click "Service Worker" under the extension

---

## 📚 Tech Stack

- [WXT](https://wxt.dev/) - Web Extension Framework
- [Vue 3](https://vuejs.org/) - Popup UI
- TypeScript
- Twenty CRM GraphQL API

---

## 📄 License

MIT

---

## 🔗 Links

- [Twenty CRM](https://twenty.com)
- [WXT Documentation](https://wxt.dev)
- [Report an Issue](../../issues)
