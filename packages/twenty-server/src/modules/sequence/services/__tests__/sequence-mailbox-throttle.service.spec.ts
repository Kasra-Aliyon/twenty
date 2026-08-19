import { type EntityManager, type Repository } from 'typeorm';

import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';

describe('SequenceMailboxThrottleService', () => {
  const query = jest.fn();
  const cacheGet = jest.fn();
  const cacheSet = jest.fn();
  const acquireLockWithToken = jest.fn();
  const renewLockWithToken = jest.fn();
  const releaseLockWithToken = jest.fn();
  const connectedAccountFindOne = jest.fn();
  const service = new SequenceMailboxThrottleService(
    {
      get: cacheGet,
      set: cacheSet,
      acquireLockWithToken,
      renewLockWithToken,
      releaseLockWithToken,
    } as unknown as CacheStorageService,
    {
      findOne: connectedAccountFindOne,
      query,
      manager: { query },
    } as unknown as Repository<ConnectedAccountEntity>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    cacheGet.mockResolvedValue(undefined);
    connectedAccountFindOne.mockResolvedValue(null);
  });

  it('renews and releases only the mailbox lock token it acquired', async () => {
    acquireLockWithToken.mockResolvedValueOnce(true);
    renewLockWithToken.mockResolvedValueOnce(true);
    releaseLockWithToken.mockResolvedValueOnce(true);

    const token = await service.acquireSendLock({
      workspaceId: 'workspace-id',
      mailboxId: 'mailbox-id',
    });

    expect(token).toEqual(expect.any(String));
    await expect(
      service.renewSendLock({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        token: token!,
      }),
    ).resolves.toBe(true);
    await expect(
      service.releaseSendLock({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        token: token!,
      }),
    ).resolves.toBe(true);

    expect(renewLockWithToken).toHaveBeenCalledWith(
      expect.stringContaining('workspace-id:mailbox-id'),
      token,
      expect.any(Number),
    );
    expect(releaseLockWithToken).toHaveBeenCalledWith(
      expect.stringContaining('workspace-id:mailbox-id'),
      token,
    );
  });

  it('uses bounded enrollment history when no durable pacing watermark exists', async () => {
    const enrollmentRepository = {
      find: jest.fn().mockResolvedValueOnce([
        {
          lastSendAttempt: {
            stepId: 'step-id',
            attemptedAt: '2026-08-17T09:05:00.000Z',
          },
          sentEmailsByStepId: {},
        },
      ]),
    };

    await expect(
      service.getLastSendAt({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        enrollmentRepository: enrollmentRepository as never,
      }),
    ).resolves.toEqual(new Date('2026-08-17T09:05:00.000Z'));

    expect(enrollmentRepository.find).toHaveBeenCalledWith({
      where: { senderConnectedAccountId: 'mailbox-id' },
      select: { lastSendAttempt: true, sentEmailsByStepId: true },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  });

  it('does not scan enrollment history on the durable pacing hot path', async () => {
    const durableWatermark = new Date('2026-08-17T09:07:00.000Z');
    connectedAccountFindOne.mockResolvedValueOnce({
      sequenceEmailLastSendAt: durableWatermark,
    });
    const enrollmentRepository = { find: jest.fn() };

    await expect(
      service.getLastSendAt({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        enrollmentRepository: enrollmentRepository as never,
      }),
    ).resolves.toEqual(durableWatermark);

    expect(enrollmentRepository.find).not.toHaveBeenCalled();
  });

  it('does not pace healthy sends from compensated pre-provider attempts', async () => {
    const enrollmentRepository = {
      find: jest.fn().mockResolvedValueOnce([
        {
          lastSendAttempt: {
            stepId: 'failed-step-id',
            attemptedAt: '2026-08-17T09:10:00.000Z',
            preProviderFailure: {
              attemptCount: 1,
              errorMessage: 'invalid recipient',
              failedAt: '2026-08-17T09:10:00.000Z',
            },
          },
          sentEmailsByStepId: {},
        },
        {
          lastSendAttempt: {
            stepId: 'releasing-step-id',
            attemptedAt: '2026-08-17T09:15:00.000Z',
            reservationReleasePendingAt: '2026-08-17T09:16:00.000Z',
          },
          sentEmailsByStepId: {},
        },
        {
          lastSendAttempt: null,
          sentEmailsByStepId: {
            'legacy-step-id': {
              sentAt: '2026-08-17T09:00:00.000Z',
            },
          },
        },
      ]),
    };

    await expect(
      service.getLastSendAt({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        enrollmentRepository: enrollmentRepository as never,
      }),
    ).resolves.toEqual(new Date('2026-08-17T09:00:00.000Z'));
  });

  it('uses the durable account watermark when Redis and enrollment history are empty', async () => {
    const durableWatermark = new Date('2026-08-17T09:07:00.000Z');
    connectedAccountFindOne.mockResolvedValueOnce({
      sequenceEmailLastSendAt: durableWatermark,
    });
    const enrollmentRepository = { find: jest.fn() };

    await expect(
      service.getLastSendAt({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        enrollmentRepository: enrollmentRepository as never,
      }),
    ).resolves.toEqual(durableWatermark);

    expect(connectedAccountFindOne).toHaveBeenCalledWith({
      where: { id: 'mailbox-id', workspaceId: 'workspace-id' },
      select: { sequenceEmailLastSendAt: true },
    });
    expect(cacheSet).toHaveBeenCalledWith(
      expect.stringContaining('workspace-id:mailbox-id'),
      durableWatermark.toISOString(),
      expect.any(Number),
    );
    expect(enrollmentRepository.find).not.toHaveBeenCalled();
  });

  it('records a monotonic pacing watermark through the account-lock transaction', async () => {
    const transactionQuery = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'mailbox-id' }]);
    const date = new Date('2026-08-17T09:07:00.000Z');

    await service.recordEmailSendClaimWatermark({
      workspaceId: 'workspace-id',
      mailboxId: 'mailbox-id',
      date,
      transactionManager: {
        query: transactionQuery,
      } as unknown as EntityManager,
    });

    expect(transactionQuery).toHaveBeenCalledTimes(1);
    const [sql, parameters] = transactionQuery.mock.calls[0] as [
      string,
      unknown[],
    ];

    expect(parameters).toEqual([
      'mailbox-id',
      'workspace-id',
      date.toISOString(),
    ]);
    expect(sql).toContain('"sequenceEmailLastSendAt" IS NULL');
    expect(sql).toContain('"sequenceEmailLastSendAt" < $3::timestamptz');
    expect(sql).toContain('RETURNING "id"');
  });

  it('records the provider-start watermark through the repository manager', async () => {
    query.mockResolvedValueOnce([{ id: 'mailbox-id' }]);
    const date = new Date('2026-08-17T09:07:00.000Z');

    await service.recordEmailSendClaimWatermark({
      workspaceId: 'workspace-id',
      mailboxId: 'mailbox-id',
      date,
    });

    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'mailbox-id',
      'workspace-id',
      date.toISOString(),
    ]);
  });

  it('atomically reserves every send under the current database limit and UTC date', async () => {
    query.mockResolvedValueOnce([{ id: 'mailbox-id' }]);

    await expect(
      service.reserveUtcDailySend({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        now: new Date('2026-08-17T00:30:00+14:00'),
      }),
    ).resolves.toEqual({
      reservationToken: expect.any(String),
      usageDate: '2026-08-16',
    });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];

    expect(parameters).toEqual([
      'mailbox-id',
      'workspace-id',
      '2026-08-16',
      expect.any(String),
    ]);
    expect(sql).toContain('"sequenceDailyEmailUsageCount" = CASE');
    expect(sql).toContain('WHEN "sequenceDailyEmailUsageDate" = $3::date');
    expect(sql).toContain('"sequenceDailyEmailLimitEnabled" = FALSE');
    expect(sql).toContain('END < "sequenceDailyEmailLimit"');
    expect(sql).toContain('"sequenceDailyEmailReservationTokens"');
    expect(sql).toContain('jsonb_build_array($4::text)');
  });

  it('removes a consumed reservation token without decrementing daily usage', async () => {
    query.mockResolvedValueOnce([]);

    await service.consumeUtcDailySendReservation({
      workspaceId: 'workspace-id',
      mailboxId: 'mailbox-id',
      reservationToken: 'reservation-token',
      usageDate: '2026-08-17',
    });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];

    expect(parameters).toEqual([
      'mailbox-id',
      'workspace-id',
      '2026-08-17',
      'reservation-token',
    ]);
    expect(sql).toContain(
      '"sequenceDailyEmailReservationTokens" = "sequenceDailyEmailReservationTokens" - $4::text',
    );
    expect(sql).not.toContain('"sequenceDailyEmailUsageCount" =');
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

  it('uses the account-lock transaction for the daily reservation', async () => {
    const transactionQuery = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'mailbox-id' }]);

    await expect(
      service.reserveUtcDailySend({
        workspaceId: 'workspace-id',
        mailboxId: 'mailbox-id',
        now: new Date('2026-08-17T12:00:00.000Z'),
        transactionManager: {
          query: transactionQuery,
        } as unknown as EntityManager,
      }),
    ).resolves.toEqual({
      reservationToken: expect.any(String),
      usageDate: '2026-08-17',
    });

    expect(transactionQuery).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });

  it('releases only a reservation from the same mailbox and UTC date', async () => {
    query.mockResolvedValueOnce([]);

    await service.releaseUtcDailySendReservation({
      workspaceId: 'workspace-id',
      mailboxId: 'mailbox-id',
      reservationToken: 'reservation-token',
      usageDate: '2026-08-17',
    });

    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];

    expect(parameters).toEqual([
      'mailbox-id',
      'workspace-id',
      '2026-08-17',
      'reservation-token',
    ]);
    expect(sql).toContain(
      '"sequenceDailyEmailUsageCount" = "sequenceDailyEmailUsageCount" - 1',
    );
    expect(sql).toContain('"sequenceDailyEmailUsageDate" = $3::date');
    expect(sql).toContain('"sequenceDailyEmailUsageCount" > 0');
    expect(sql).toContain('"sequenceDailyEmailReservationTokens" ? $4::text');
  });
});
