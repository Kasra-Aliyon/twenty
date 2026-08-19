import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { type EntityManager, type Repository } from 'typeorm';

import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import {
  SEQUENCE_LAST_SEND_AT_CACHE_KEY_PREFIX,
  SEQUENCE_LAST_SEND_AT_CACHE_TTL,
  SEQUENCE_MAILBOX_SEND_LOCK_KEY_PREFIX,
  SEQUENCE_MAILBOX_SEND_LOCK_TTL,
} from 'src/modules/sequence/sequence.constants';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

const SEQUENCE_MAILBOX_PACING_HISTORY_FALLBACK_LIMIT = 100;

@Injectable()
export class SequenceMailboxThrottleService {
  constructor(
    @InjectCacheStorage(CacheStorageNamespace.ModuleMessaging)
    private readonly cacheStorageService: CacheStorageService,
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
  ) {}

  async acquireSendLock({
    workspaceId,
    mailboxId,
  }: {
    workspaceId: string;
    mailboxId: string;
  }): Promise<string | null> {
    const token = randomUUID();
    const acquired = await this.cacheStorageService.acquireLockWithToken(
      this.getSendLockKey(workspaceId, mailboxId),
      token,
      SEQUENCE_MAILBOX_SEND_LOCK_TTL,
    );

    return acquired ? token : null;
  }

  async renewSendLock({
    workspaceId,
    mailboxId,
    token,
  }: {
    workspaceId: string;
    mailboxId: string;
    token: string;
  }): Promise<boolean> {
    return this.cacheStorageService.renewLockWithToken(
      this.getSendLockKey(workspaceId, mailboxId),
      token,
      SEQUENCE_MAILBOX_SEND_LOCK_TTL,
    );
  }

  async releaseSendLock({
    workspaceId,
    mailboxId,
    token,
  }: {
    workspaceId: string;
    mailboxId: string;
    token: string;
  }): Promise<boolean> {
    return this.cacheStorageService.releaseLockWithToken(
      this.getSendLockKey(workspaceId, mailboxId),
      token,
    );
  }

  async getLastSendAt({
    workspaceId,
    mailboxId,
    enrollmentRepository,
  }: {
    workspaceId: string;
    mailboxId: string;
    enrollmentRepository: WorkspaceRepository<SequenceEnrollmentWorkspaceEntity>;
  }): Promise<Date | null> {
    const cachedValue = await this.cacheStorageService.get<string>(
      this.getLastSendAtCacheKey(workspaceId, mailboxId),
    );
    const cachedTimestamp = isDefined(cachedValue)
      ? Date.parse(cachedValue)
      : 0;
    const connectedAccount = await this.connectedAccountRepository.findOne({
      where: { id: mailboxId, workspaceId },
      select: { sequenceEmailLastSendAt: true },
    });
    const durableTimestamp =
      connectedAccount?.sequenceEmailLastSendAt?.getTime() ?? 0;
    const authoritativeTimestamp = Math.max(
      Number.isNaN(cachedTimestamp) ? 0 : cachedTimestamp,
      durableTimestamp,
    );

    // Current claims and provider starts update the connected-account
    // watermark under its row lock. Enrollment history is only a bounded
    // compatibility fallback for accounts created before that watermark
    // existed; scanning every historical JSON payload made this hot path grow
    // without bound.
    const enrollments =
      authoritativeTimestamp === 0
        ? await enrollmentRepository.find({
            where: { senderConnectedAccountId: mailboxId },
            select: { lastSendAttempt: true, sentEmailsByStepId: true },
            order: { updatedAt: 'DESC' },
            take: SEQUENCE_MAILBOX_PACING_HISTORY_FALLBACK_LIMIT,
          })
        : [];
    const mostRecentTimestamp = enrollments.reduce(
      (latestTimestamp, enrollment) => {
        const enrollmentLatestTimestamp = Object.values(
          enrollment.sentEmailsByStepId ?? {},
        ).reduce((latestSentTimestamp, sentEmail) => {
          const sentTimestamp = Date.parse(sentEmail.sentAt);

          return Number.isNaN(sentTimestamp)
            ? latestSentTimestamp
            : Math.max(latestSentTimestamp, sentTimestamp);
        }, 0);
        const lastSendAttempt = enrollment.lastSendAttempt;
        const sendAttemptTimestamp =
          isDefined(lastSendAttempt?.preProviderFailure) ||
          isDefined(lastSendAttempt?.reservationReleasePendingAt)
            ? Number.NaN
            : Date.parse(lastSendAttempt?.attemptedAt ?? '');

        return Math.max(
          latestTimestamp,
          enrollmentLatestTimestamp,
          Number.isNaN(sendAttemptTimestamp) ? 0 : sendAttemptTimestamp,
        );
      },
      authoritativeTimestamp,
    );

    if (mostRecentTimestamp === 0) {
      return null;
    }

    const mostRecentDate = new Date(mostRecentTimestamp);

    await this.setLastSendAt({
      workspaceId,
      mailboxId,
      date: mostRecentDate,
    });

    return mostRecentDate;
  }

  async setLastSendAt({
    workspaceId,
    mailboxId,
    date,
  }: {
    workspaceId: string;
    mailboxId: string;
    date: Date;
  }): Promise<void> {
    const key = this.getLastSendAtCacheKey(workspaceId, mailboxId);
    const existingValue = await this.cacheStorageService.get<string>(key);
    const existingTimestamp = isDefined(existingValue)
      ? Date.parse(existingValue)
      : 0;

    if (
      !Number.isNaN(existingTimestamp) &&
      existingTimestamp > date.getTime()
    ) {
      return;
    }

    await this.cacheStorageService.set(
      key,
      date.toISOString(),
      SEQUENCE_LAST_SEND_AT_CACHE_TTL,
    );
  }

  async recordEmailSendClaimWatermark({
    workspaceId,
    mailboxId,
    date,
    transactionManager,
  }: {
    workspaceId: string;
    mailboxId: string;
    date: Date;
    transactionManager?: EntityManager;
  }): Promise<void> {
    const queryRunner =
      transactionManager ?? this.connectedAccountRepository.manager;
    const updatedRows = (await queryRunner.query(
      `UPDATE "core"."connectedAccount"
       SET "sequenceEmailLastSendAt" = CASE
             WHEN "sequenceEmailLastSendAt" IS NULL
               OR "sequenceEmailLastSendAt" < $3::timestamptz
             THEN $3::timestamptz
             ELSE "sequenceEmailLastSendAt"
           END,
           "updatedAt" = NOW()
       WHERE "id" = $1
         AND "workspaceId" = $2
       RETURNING "id"`,
      [mailboxId, workspaceId, date.toISOString()],
    )) as { id: string }[];

    if (updatedRows.length !== 1) {
      throw new Error(
        `Could not record the sequence email pacing watermark for mailbox ${mailboxId}`,
      );
    }
  }

  async reserveUtcDailySend({
    workspaceId,
    mailboxId,
    now,
    transactionManager,
  }: {
    workspaceId: string;
    mailboxId: string;
    now: Date;
    transactionManager?: EntityManager;
  }): Promise<{ reservationToken: string; usageDate: string } | null> {
    const usageDate = now.toISOString().slice(0, 10);
    const reservationToken = randomUUID();
    const queryRunner =
      transactionManager ?? this.connectedAccountRepository.manager;
    const reservedRows = (await queryRunner.query(
      `UPDATE "core"."connectedAccount"
       SET "sequenceDailyEmailUsageDate" = $3::date,
           "sequenceDailyEmailUsageCount" = CASE
             WHEN "sequenceDailyEmailUsageDate" = $3::date
               THEN "sequenceDailyEmailUsageCount" + 1
             ELSE 1
           END,
           "sequenceDailyEmailReservationTokens" = CASE
             WHEN "sequenceDailyEmailUsageDate" = $3::date
               THEN "sequenceDailyEmailReservationTokens" || jsonb_build_array($4::text)
             ELSE jsonb_build_array($4::text)
           END,
           "updatedAt" = NOW()
       WHERE "id" = $1
         AND "workspaceId" = $2
         AND (
           "sequenceDailyEmailLimitEnabled" = FALSE
           OR CASE
             WHEN "sequenceDailyEmailUsageDate" = $3::date
               THEN "sequenceDailyEmailUsageCount"
             ELSE 0
           END < "sequenceDailyEmailLimit"
         )
         AND NOT (
           CASE
             WHEN "sequenceDailyEmailUsageDate" = $3::date
               THEN "sequenceDailyEmailReservationTokens"
             ELSE '[]'::jsonb
           END ? $4::text
         )
       RETURNING "id"`,
      [mailboxId, workspaceId, usageDate, reservationToken],
    )) as { id: string }[];

    return reservedRows.length === 1 ? { reservationToken, usageDate } : null;
  }

  async releaseUtcDailySendReservation({
    workspaceId,
    mailboxId,
    reservationToken,
    usageDate,
    transactionManager,
  }: {
    workspaceId: string;
    mailboxId: string;
    reservationToken: string;
    usageDate: string;
    transactionManager?: EntityManager;
  }): Promise<void> {
    const queryRunner =
      transactionManager ?? this.connectedAccountRepository.manager;

    await queryRunner.query(
      `UPDATE "core"."connectedAccount"
       SET "sequenceDailyEmailUsageCount" = "sequenceDailyEmailUsageCount" - 1,
           "sequenceDailyEmailReservationTokens" = "sequenceDailyEmailReservationTokens" - $4::text,
           "updatedAt" = NOW()
       WHERE "id" = $1
         AND "workspaceId" = $2
         AND "sequenceDailyEmailUsageDate" = $3::date
         AND "sequenceDailyEmailUsageCount" > 0
         AND "sequenceDailyEmailReservationTokens" ? $4::text`,
      [mailboxId, workspaceId, usageDate, reservationToken],
    );
  }

  async consumeUtcDailySendReservation({
    workspaceId,
    mailboxId,
    reservationToken,
    usageDate,
  }: {
    workspaceId: string;
    mailboxId: string;
    reservationToken: string;
    usageDate: string;
  }): Promise<void> {
    await this.connectedAccountRepository.query(
      `UPDATE "core"."connectedAccount"
       SET "sequenceDailyEmailReservationTokens" = "sequenceDailyEmailReservationTokens" - $4::text,
           "updatedAt" = NOW()
       WHERE "id" = $1
         AND "workspaceId" = $2
         AND "sequenceDailyEmailUsageDate" = $3::date
         AND "sequenceDailyEmailReservationTokens" ? $4::text`,
      [mailboxId, workspaceId, usageDate, reservationToken],
    );
  }

  private getLastSendAtCacheKey(
    workspaceId: string,
    mailboxId: string,
  ): string {
    return `${SEQUENCE_LAST_SEND_AT_CACHE_KEY_PREFIX}:${workspaceId}:${mailboxId}`;
  }

  private getSendLockKey(workspaceId: string, mailboxId: string): string {
    return `${SEQUENCE_MAILBOX_SEND_LOCK_KEY_PREFIX}:${workspaceId}:${mailboxId}`;
  }
}
