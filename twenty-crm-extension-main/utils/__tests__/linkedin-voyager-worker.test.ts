import { afterEach, expect, it, vi } from 'vitest';

import { linkedInVoyagerClient } from '../linkedin-voyager-client';

afterEach(() => vi.unstubAllGlobals());

it('reads the signed-in LinkedIn identity from the worker without a page', async () => {
  const storage = {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const getCookie = vi.fn().mockResolvedValue({ value: '"test-session"' });
  const fetchResponse = vi.fn().mockResolvedValue(
    Response.json({
      data: {
        plainId: '123',
        '*miniProfile': 'urn:li:fs_miniProfile:member-id',
      },
      included: [{ firstName: 'Test', lastName: 'Member' }],
    }),
  );

  vi.stubGlobal('browser', {
    cookies: { get: getCookie },
    storage: { local: storage },
  });
  vi.stubGlobal('fetch', fetchResponse);

  await linkedInVoyagerClient.initialize(Date.now() + 60_000);
  await expect(linkedInVoyagerClient.getIdentity()).resolves.toMatchObject({
    linkedinId: '123',
    linkedinUrn: 'member-id',
  });

  expect(fetchResponse).toHaveBeenCalledExactlyOnceWith(
    'https://www.linkedin.com/voyager/api/me',
    expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({ 'csrf-token': 'test-session' }),
    }),
  );
  expect(storage.set).toHaveBeenCalledTimes(1);
});
