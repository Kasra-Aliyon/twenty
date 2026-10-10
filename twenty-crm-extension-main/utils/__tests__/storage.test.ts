import { beforeEach, describe, expect, it, vi } from 'vitest';

const values = vi.hoisted(() => new Map<string, unknown>());
vi.mock('#imports', () => ({
  storage: {
    defineItem: <TValue>(key: string, options: { fallback: TValue }) => ({
      getValue: async (): Promise<TValue> =>
        (values.has(key) ? values.get(key) : options.fallback) as TValue,
      setValue: async (value: TValue): Promise<void> => {
        values.set(key, value);
      },
    }),
  },
}));

import { saveSettings } from '../storage';

describe('CRM deployment session isolation', () => {
  beforeEach(() => {
    values.clear();
  });

  it('removes local credentials before switching the API to production', async () => {
    values.set('sync:twentyAppUrl', 'http://localhost:2001');
    values.set('sync:twentyApiUrl', 'http://localhost:2000');
    values.set('local:twentyTokenPair', { sensitive: 'local-session' });
    await saveSettings({
      twentyAppUrl: 'https://crm.sevenscholar.com',
      twentyApiUrl: 'https://crm.sevenscholar.com',
    });
    expect(values.get('local:twentyTokenPair')).toBeNull();
    expect(values.get('sync:twentyApiUrl')).toBe(
      'https://crm.sevenscholar.com',
    );
  });

  it('preserves credentials when the selected CRM does not change', async () => {
    values.set('sync:twentyAppUrl', 'https://crm.sevenscholar.com');
    values.set('sync:twentyApiUrl', 'https://crm.sevenscholar.com');
    const session = { sensitive: 'production-session' };
    values.set('local:twentyTokenPair', session);
    await saveSettings({ twentyAppUrl: 'https://crm.sevenscholar.com' });
    expect(values.get('local:twentyTokenPair')).toEqual(session);
  });
});
