import { defineConfig } from 'wxt';

import { getDeploymentOrigin } from './utils/deployment';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: () => ({
    name: 'Twenty CRM - LinkedIn Capture',
    description:
      'Safely capture and incrementally sync LinkedIn data with Twenty CRM',
    version: process.env.EXTENSION_VERSION || '1.2.2',
    permissions: [
      'storage',
      'cookies',
      'activeTab',
      'scripting',
      'tabs',
      'alarms',
    ],
    host_permissions: [
      '*://*.linkedin.com/*',
      `${getDeploymentOrigin(process.env.WXT_TWENTY_APP_URL, 'http://localhost:2001')}/*`,
      `${getDeploymentOrigin(process.env.WXT_TWENTY_API_URL, 'http://localhost:2000')}/*`,
      'http://localhost:2000/*',
      'http://localhost:2001/*',
      'http://127.0.0.1:2000/*',
      'http://127.0.0.1:2001/*',
      // Keep the former local defaults during the port-migration window.
      'http://localhost:3000/*',
      'http://localhost:3001/*',
      'http://127.0.0.1:3000/*',
      'http://127.0.0.1:3001/*',
    ],
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      96: '/icon/96.png',
      128: '/icon/128.png',
    },
  }),
});
