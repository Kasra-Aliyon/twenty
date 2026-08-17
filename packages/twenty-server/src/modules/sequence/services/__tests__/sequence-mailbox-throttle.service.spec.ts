import { type Repository } from 'typeorm';

import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';

describe('SequenceMailboxThrottleService', () => {
  const query = jest.fn();
  const service = new SequenceMailboxThrottleService(
    {
      get: jest.fn(),
      set: jest.fn(),
      acquireLock: jest.fn(),
      releaseLock: jest.fn(),
    } as unknown as CacheStorageService,
    { query } as unknown as Repository<ConnectedAccountEntity>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('atomically reserves every send under the current database limit and UTC date', async () => {
    query.mockResolvedValueOnce([{ id: 'mailbox-id' }]);

    await expect(
      service.reserveUtcDailySend({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        now: new Date('2026-08-17T00:30:00+14:00'),
      }),
    ).resolves.toEqual({ usageDate: '2026-08-16' });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];

    expect(parameters).toEqual(['mailbox-id', 'workspace-id', '2026-08-16']);
    expect(sql).toContain('"sequenceDailyEmailUsageCount" = CASE');
    expect(sql).toContain('WHEN "sequenceDailyEmailUsageDate" = $3::date');
    expect(sql).toContain('"sequenceDailyEmailLimitEnabled" = FALSE');
    expect(sql).toContain('END < "sequenceDailyEmailLimit"');
  });

  it('returns no reservation when the atomic database predicate rejects the send', async () => {
    query.mockResolvedValueOnce([]);

    await expect(
      service.reserveUtcDailySend({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        now: new Date('2026-08-17T12:00:00.000Z'),
      }),
    ).resolves.toBeNull();
  });

  it('releases only a reservation from the same mailbox and UTC date', async () => {
    query.mockResolvedValueOnce([]);

    await service.releaseUtcDailySendReservation({
      workspaceId: 'workspace-id',
      mailboxId: 'mailbox-id',
      usageDate: '2026-08-17',
    });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];

    expect(parameters).toEqual(['mailbox-id', 'workspace-id', '2026-08-17']);
    expect(sql).toContain(
      '"sequenceDailyEmailUsageCount" = "sequenceDailyEmailUsageCount" - 1',
    );
    expect(sql).toContain('"sequenceDailyEmailUsageDate" = $3::date');
    expect(sql).toContain('"sequenceDailyEmailUsageCount" > 0');
  });
});
