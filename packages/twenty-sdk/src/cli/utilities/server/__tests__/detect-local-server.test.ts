import {
  checkServerHealth,
  detectLocalServer,
} from '@/cli/utilities/server/detect-local-server';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('detectLocalServer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should detect the migrated development server port', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' })));

    await expect(detectLocalServer()).resolves.toBe('http://localhost:2000');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:2020/healthz',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:2000/healthz',
      expect.any(Object),
    );
  });

  it('should retain the legacy server port as a final fallback', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' })));

    await expect(detectLocalServer()).resolves.toBe('http://localhost:3000');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:3000/healthz',
      expect.any(Object),
    );
  });

  it('should honor an explicit preferred port without probing defaults', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'ok' })));

    await expect(detectLocalServer(4321)).resolves.toBe(
      'http://localhost:4321',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should return false when the health response is not valid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not-json'));

    await expect(checkServerHealth(2000)).resolves.toBe(false);
  });
});
