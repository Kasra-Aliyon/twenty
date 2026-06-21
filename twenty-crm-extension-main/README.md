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
