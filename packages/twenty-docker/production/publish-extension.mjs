import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

const required = [
  'CHROME_CLIENT_ID',
  'CHROME_CLIENT_SECRET',
  'CHROME_REFRESH_TOKEN',
  'CHROME_PUBLISHER_ID',
  'CHROME_EXTENSION_ID',
];
for (const key of required)
  if (!process.env[key]) throw new Error(`Missing ${key}`);
if (!process.argv[2]) throw new Error('Pass the extension ZIP path');
const credentials = new URLSearchParams({
  client_id: process.env.CHROME_CLIENT_ID,
  client_secret: process.env.CHROME_CLIENT_SECRET,
  refresh_token: process.env.CHROME_REFRESH_TOKEN,
  grant_type: 'refresh_token',
});
const auth = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: credentials,
  redirect: 'error',
  signal: AbortSignal.timeout(30_000),
});
if (!auth.ok) throw new Error(`Chrome OAuth failed: HTTP ${auth.status}`);
const { access_token: token } = await auth.json();
if (!token) throw new Error('Chrome OAuth did not return an access token');
const item = `publishers/${encodeURIComponent(process.env.CHROME_PUBLISHER_ID)}/items/${encodeURIComponent(process.env.CHROME_EXTENSION_ID)}`;
const request = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error(`Chrome Web Store request failed: HTTP ${response.status}`);
  return response.json();
};
const upload = await request(
  `https://chromewebstore.googleapis.com/upload/v2/${item}:upload`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: await readFile(process.argv[2]),
  },
);
let state = upload.uploadState;
for (
  let attempt = 0;
  ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(state) && attempt < 60;
  attempt++
) {
  await wait(5_000);
  state = (
    await request(
      `https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`,
    )
  ).lastAsyncUploadState;
}
if (state !== 'SUCCEEDED')
  throw new Error(`Chrome upload did not succeed: ${state}`);
await request(`https://chromewebstore.googleapis.com/v2/${item}:publish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
console.log(
  'Extension submitted to Chrome Web Store. Google review and browser rollout are still pending.',
);
