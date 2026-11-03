import type { UserSessionIdentity } from '../types.js';

export const renderConnectPage = (nonce: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect your CRM account · 7Scholar</title>
<style nonce="${nonce}">
body{font:16px/1.6 system-ui,sans-serif;color:#18252d;background:#f5f7f8;margin:0;padding:40px 20px}
main{max-width:560px;margin:40px auto;background:white;padding:32px;border:1px solid #dce3e6;border-radius:14px}
h1{line-height:1.2}label{display:block;font-weight:600;margin-top:24px}input{box-sizing:border-box;width:100%;padding:12px;margin:8px 0 16px;border:1px solid #85959c;border-radius:6px;font-size:16px}
button{padding:12px 18px;border:0;border-radius:6px;background:#145d65;color:white;font-size:16px;cursor:pointer;margin:0 8px 8px 0}
button:disabled{opacity:.5}a{color:#145d65}#status{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#53636b}
</style><script src="./connect.js" defer></script></head><body><main>
<small>7Scholar CRM · Personal MCP connection</small><h1>Connect your CRM account</h1>
<p>Sign in to <a href="/" target="_blank" rel="noopener">7Scholar CRM</a> as yourself in this browser profile, then return here.</p>
<p>This connects your agents to your own email and LinkedIn data, alongside the shared CRM directory. Your mailbox and LinkedIn extension must also be connected under your account.</p>
<label for="token">Your personal MCP access token</label><input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the token Kasra supplied privately">
<button id="connect" type="button">Connect my account</button><button id="check" type="button">Check connection</button>
<p id="status" role="status" aria-live="polite">Your token is used for this request and is not saved by this page.</p>
<small>Connecting creates a dedicated renewable session for this MCP. It does not send messages or start outreach.</small>
</main></body></html>`;

export const renderConnectScript = (
  origin: string,
  identity: UserSessionIdentity,
): string => `
'use strict';
const expectedOrigin = ${JSON.stringify(origin)};
const expectedUserId = ${JSON.stringify(identity.userId)};
const expectedWorkspaceId = ${JSON.stringify(identity.workspaceId)};
const tokenInput = document.getElementById('token');
const status = document.getElementById('status');
const connect = document.getElementById('connect');
const check = document.getElementById('check');
const metadata = async (accessToken, query) => {
  const response = await fetch('/metadata', {
    method: 'POST', credentials: 'omit', redirect: 'error',
    headers: {'Content-Type':'application/json', Authorization:'Bearer '+accessToken},
    body: JSON.stringify({query}),
  });
  const result = await response.json();
  if (!response.ok || result.errors || !result.data) throw new Error('Sign in to the CRM again, then reload this page.');
  return result.data;
};
const run = async (shouldConnect) => {
  connect.disabled = check.disabled = true;
  const token = tokenInput.value.trim();
  try {
    if (location.origin !== expectedOrigin) throw new Error('Open this page on '+expectedOrigin+' using the connection link Kasra provided.');
    if (!token) throw new Error('Enter your personal MCP access token first.');
    const headers = {Authorization: 'Bearer '+token};
    let options = {headers, cache:'no-store', credentials:'omit', redirect:'error'};
    if (shouldConnect) {
      status.textContent = 'Checking your signed-in CRM account…';
      let browserSession;
      try { browserSession = JSON.parse(localStorage.getItem('tokenPairState')); } catch {}
      const accessToken = browserSession?.accessOrWorkspaceAgnosticToken?.token;
      if (!accessToken) throw new Error('Sign in to the CRM in this browser profile, then return here.');
      const data = await metadata(accessToken, 'query McpBrowserConnection { currentUser { id email currentWorkspace { id } availableWorkspaces { availableWorkspacesForSignIn { id loginToken } } } }');
      if (data.currentUser.id !== expectedUserId || data.currentUser.currentWorkspace?.id !== expectedWorkspaceId) throw new Error('This MCP is assigned to a different CRM user. Sign in as the assigned user and retry.');
      const workspace = data.currentUser.availableWorkspaces.availableWorkspacesForSignIn.find(item => item.id === expectedWorkspaceId);
      if (!workspace?.loginToken) throw new Error('Your CRM workspace is not available for sign-in.');
      options = {...options, method:'POST', headers:{...headers,'Content-Type':'application/json'}, body:JSON.stringify({login_token:workspace.loginToken})};
      status.textContent = 'Connecting your dedicated MCP session…';
    }
    const response = await fetch(new URL('session', location.href), options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Connection request failed.');
    status.textContent = result.connected ? 'Connected as '+result.user.email+'. Your agents can now use this personal MCP connection.' : result.message;
  } catch (error) { status.textContent = error.message || 'Connection failed. Try again.'; }
  finally { tokenInput.value = ''; connect.disabled = check.disabled = false; }
};
connect.addEventListener('click', () => run(true));
check.addEventListener('click', () => run(false));
`;
