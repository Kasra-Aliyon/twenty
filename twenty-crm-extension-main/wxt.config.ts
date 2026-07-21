import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Twenty CRM - LinkedIn Capture',
    description: 'Capture LinkedIn profiles and companies to your Twenty CRM',
    version: '1.0.0',
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
  },
});
