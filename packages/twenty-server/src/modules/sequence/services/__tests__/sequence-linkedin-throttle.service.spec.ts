import { type SequenceSettings } from 'twenty-shared/types';

import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { DEFAULT_SEQUENCE_SETTINGS } from 'src/modules/sequence/sequence.constants';
import { isWithinSendingWindow } from 'src/modules/sequence/utils/sequence-window.util';

describe('SequenceLinkedinThrottleService', () => {
  const workspaceId = 'workspace-id';
  const sequenceId = 'sequence-id';

  const buildService = () => {
    const values = new Map<string, unknown>();
    const cacheStorageService = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn(),
      get: jest.fn(async (key: string) => values.get(key)),
      set: jest.fn(
        async (key: string, value: unknown) => void values.set(key, value),
      ),
    } as unknown as CacheStorageService;

    return {
      service: new SequenceLinkedinThrottleService(cacheStorageService),
      cacheStorageService,
      values,
    };
  };

  const buildSettings = (
    overrides: Partial<SequenceSettings> = {},
  ): SequenceSettings => ({
    ...DEFAULT_SEQUENCE_SETTINGS,
    timezone: 'UTC',
    activeDays: [1, 2, 3, 4, 5],
    windowStart: '09:00',
    windowEnd: '17:00',
    linkedinDailyActionLimitEnabled: true,
    ...overrides,
  });

  const gapsInMinutes = (slots: Date[], now: Date): number[] =>
    slots.map((slot, index) =>
      index === 0
        ? (slot.getTime() - now.getTime()) / 60_000
        : (slot.getTime() - slots[index - 1].getTime()) / 60_000,
    );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps consecutive delays when only the daily cap is disabled', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { service, values } = buildService();
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActionLimitEnabled: false,
      linkedinDailyActions: 1,
      linkedinDelayPatternMinutes: [15],
    });

    const firstSlot = await service.reserveSlot({
      workspaceId,
      sequenceId,
      settings,
      now,
    });
    const secondSlot = await service.reserveSlot({
      workspaceId,
      sequenceId,
      settings,
      now,
    });

    expect(firstSlot.toISOString()).toBe('2026-07-20T09:15:00.000Z');
    expect(secondSlot.toISOString()).toBe('2026-07-20T09:30:00.000Z');
    expect([...values.keys()].some((key) => key.includes('daily-count'))).toBe(
      false,
    );
  });

  it('cycles the configured delay pattern and wraps', async () => {
    // A midpoint draw produces a neutral jitter factor, isolating the cycle.
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const { service } = buildService();
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActions: 20,
      linkedinDelayPatternMinutes: [1, 3, 5, 2, 8, 4, 6],
    });
    const slots: Date[] = [];

    for (let index = 0; index < 8; index += 1) {
      slots.push(
        await service.reserveSlot({ workspaceId, sequenceId, settings, now }),
      );
    }

    expect(gapsInMinutes(slots, now)).toEqual([1, 3, 5, 2, 8, 4, 6, 1]);
  });

  it('jitters delays without leaving the configured pattern bounds', async () => {
    const { service } = buildService();
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActions: 20,
      linkedinDelayPatternMinutes:
        DEFAULT_SEQUENCE_SETTINGS.linkedinDelayPatternMinutes,
    });
    const slots: Date[] = [];

    for (let index = 0; index < 14; index += 1) {
      slots.push(
        await service.reserveSlot({ workspaceId, sequenceId, settings, now }),
      );
    }

    const gaps = gapsInMinutes(slots, now);

    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(5);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('rolls actions beyond the daily cap to the next active day', async () => {
    const { service } = buildService();
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActions: 3,
      linkedinDelayPatternMinutes: [1],
    });
    const slots: Date[] = [];

    for (let index = 0; index < 5; index += 1) {
      slots.push(
        await service.reserveSlot({ workspaceId, sequenceId, settings, now }),
      );
    }

    expect(slots.slice(0, 3).map((slot) => slot.getUTCDate())).toEqual([
      20, 20, 20,
    ]);
    expect(slots.slice(3).map((slot) => slot.getUTCDate())).toEqual([21, 21]);
    expect(slots[3].toISOString()).toBe('2026-07-21T09:00:00.000Z');
  });

  it('shares the daily cap and safety gap across sequences', async () => {
    const { service } = buildService();
    const now = new Date('2026-07-20T09:00:00.000Z');
    const settings = buildSettings({
      linkedinDailyActions: 2,
      linkedinDelayPatternMinutes: [15],
    });

    const firstSlot = await service.reserveSlot({
      workspaceId,
      sequenceId: 'first-sequence',
      settings,
      now,
    });
    const secondSlot = await service.reserveSlot({
      workspaceId,
      sequenceId: 'second-sequence',
      settings,
      now,
    });
    const thirdSlot = await service.reserveSlot({
      workspaceId,
      sequenceId: 'third-sequence',
      settings,
      now,
    });

    expect(firstSlot.toISOString()).toBe('2026-07-20T09:15:00.000Z');
    expect(secondSlot.toISOString()).toBe('2026-07-20T09:30:00.000Z');
    expect(thirdSlot.toISOString()).toBe('2026-07-21T09:00:00.000Z');
  });

  it('always returns a slot inside the configured sending window', async () => {
    const { service } = buildService();
    const settings = buildSettings({
      activeDays: [1, 3, 5],
      windowStart: '10:30',
      windowEnd: '11:00',
      linkedinDelayPatternMinutes: [180],
    });

    const slot = await service.reserveSlot({
      workspaceId,
      sequenceId,
      settings,
      now: new Date('2026-07-20T17:00:00.000Z'),
    });

    expect(slot.toISOString()).toBe('2026-07-22T10:30:00.000Z');
    expect(isWithinSendingWindow(slot, settings)).toBe(true);
  });
});
