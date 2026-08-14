# Changelog

All notable changes to Twenty CRM LinkedIn Capture Extension.

## [Unreleased]

### Changed

- Wait for LinkedIn's delayed Pending or sent confirmation after an invitation
  dialog closes instead of immediately failing on stale Connect controls.
- Restored **Add to Twenty** on current LinkedIn company pages, including
  company-specific duplicate matching, website, employee count, and industry
  capture across signed-in and public layouts.
- Replaced start/pause harvesting with manual **Sync now** and automatic
  30-minute sync dispatch.
- Made connection history resumable and retained incremental thread/message
  checkpoints and stable-ID upserts.
- Scoped connection, invite, thread, and message totals to the signed-in
  LinkedIn account and included both sent and received invitations.
- Persisted the cross-tab sync lock through Manifest V3 service-worker restarts.
- Added durable read budgets, a fail-closed restriction cooldown, a local
  cross-sequence outbound cap, and a 15-minute minimum outbound gap.
- Changed new sequence defaults to 20 LinkedIn actions per day with conservative
  15–45 minute spacing; server throttling is now workspace-wide.
- Made the sequence daily automation cap configurable from 1–40 in Twenty and
  clamped the server and MCP settings to the same maximum.
- Added direct LinkedIn message sequence steps for recognized first-degree
  connections using LinkedIn's visible composer UI and existing safety limits.
- Compacted the runner so outbound controls, sync totals, and status remain
  visible within the browser viewport.

## [1.0.0] - 2024-12-17

### ✨ Features

- **LinkedIn Profile Capture** - One-click capture of LinkedIn profiles to Twenty CRM
- **Company Page Capture** - Capture LinkedIn company pages
- **Auto Company Creation** - Automatically creates company records when adding contacts
- **Profile Photo Upload** - Uploads LinkedIn profile photos to Twenty's storage via GraphQL
- **Duplicate Detection** - Checks for existing records by LinkedIn URL and name matching
- **Manual Linking** - Search CRM and link LinkedIn profile to existing contacts
- **Update from LinkedIn** - Refresh existing CRM records with current LinkedIn data
- **Multi-language Support** - Extracts company names from headlines in multiple languages:
  - English: "at Company"
  - French: "chez Company", "à Company"
  - German: "bei Company"
  - Spanish: "en Company"
  - Symbol: "@ Company"

### 🔧 Technical

- Session-based authentication using Twenty's existing login cookie
- GraphQL API integration for all CRM operations
- GraphQL multipart upload for profile photos
- Floating UI button with status indicators
- Menu dropdown for additional actions
- URL change detection for LinkedIn SPA navigation

### 📋 Data Captured

**People:**

- First name & Last name
- Job title / headline
- Profile photo (uploaded)
- Location
- LinkedIn URL
- Current company (linked or created)

**Companies:**

- Company name
- LinkedIn URL
- Website
- Employee count
