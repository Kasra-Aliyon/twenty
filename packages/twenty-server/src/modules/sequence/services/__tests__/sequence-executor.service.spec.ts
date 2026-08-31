import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  MessageParticipantRole,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_CONDITION_BRANCHES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_SEND_WINDOW_TIMEZONE_MODES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  SEQUENCE_WAITING_ON,
  TASK_PRIORITIES,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import type { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import {
  ApolloEnrichmentProviderNotStartedError,
  ApolloEnrichmentProviderRejectedError,
} from 'src/modules/apollo-enrichment/types/apollo-enrichment-error';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { LinkedinInvitationWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-invitation.workspace-entity';
import { LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { type SequenceEmailReplyReconciliationService } from 'src/modules/sequence/services/sequence-email-reply-reconciliation.service';
import {
  SequenceEmailPreparationPermanentError,
  type SequenceEmailSenderService,
} from 'src/modules/sequence/services/sequence-email-sender.service';
import { SequenceExecutorService } from 'src/modules/sequence/services/sequence-executor.service';
import { type SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { type SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import {
  SequenceSenderNotReadyError,
  SequenceSenderUnavailableError,
  type SequenceSenderService,
} from 'src/modules/sequence/services/sequence-sender.service';
import { type SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { type SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';
import {
  DEFAULT_SEQUENCE_SETTINGS,
  SEQUENCE_APOLLO_ENRICHMENT_CLAIM_LEASE_MILLISECONDS,
  SEQUENCE_APOLLO_ENRICHMENT_TIMEOUT_MILLISECONDS,
  SEQUENCE_EXECUTION_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR,
  SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
  SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
  SEQUENCE_SENDER_RETRY_DELAY_MILLISECONDS,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

describe('SequenceExecutorService', () => {
  const workspaceId = 'workspace-id';
  const enrollmentId = 'enrollment-id';
  const stepId = 'step-id';
  const enrollment = {
    id: enrollmentId,
    sequenceId: 'sequence-id',
    personId: 'person-id',
    status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
    currentStepId: null,
    currentStepPosition: -1,
    waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
    nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
    senderConnectedAccountId: 'connected-account-id',
    stopOnReply: true,
    sentEmailsByStepId: {},
    lastSendAttempt: null,
  } as SequenceEnrollmentWorkspaceEntity;
  const sequence = {
    id: 'sequence-id',
    status: SEQUENCE_STATUSES.ACTIVE,
    senderConnectedAccountId: 'connected-account-id',
    settings: {
      ...DEFAULT_SEQUENCE_SETTINGS,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      windowStart: '00:00',
      windowEnd: '23:59',
      emailWindowStart: '00:00',
      emailWindowEnd: '23:59',
      staggerMinutes: 0,
    },
  } as SequenceWorkspaceEntity;
  const step = {
    id: stepId,
    sequenceId: 'sequence-id',
    position: 0,
    type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
    settings: {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      subject: 'Hello {{firstName}}',
      bodyHtml: '<p>Hello {{firstName}}</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: null,
    },
  } as SequenceStepWorkspaceEntity;

  afterEach(() => {
    jest.useRealTimers();
  });

  const buildPerson = (emailOptOut = false, timeZone: string | null = null) =>
    ({
      id: 'person-id',
      name: { firstName: 'Ada', lastName: 'Lovelace' },
      emails: {
        primaryEmail: 'ada@example.com',
        additionalEmails: null,
      },
      emailOptOut,
      timeZone,
      linkedinConnectionState: LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
      linkedinLink: null,
      phones: {
        primaryPhoneNumber: '',
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
      company: null,
    }) as unknown as PersonWorkspaceEntity;

  const setup = ({
    currentEnrollment = enrollment,
    currentSequence = sequence,
    person = buildPerson(),
    steps = [step],
    connectionCount = 0,
    sentInvitationCount = 0,
    sentInvitationAfterLatestActionCount = 0,
    linkedinActionCount = 0,
    observedConnectedActionCount = 0,
    latestLinkedinAction = null,
    dailyEmailReservationAvailable = true,
    existingApolloEnrollment = null,
  }: {
    currentEnrollment?: SequenceEnrollmentWorkspaceEntity;
    currentSequence?: SequenceWorkspaceEntity;
    person?: PersonWorkspaceEntity;
    steps?: SequenceStepWorkspaceEntity[];
    connectionCount?: number;
    sentInvitationCount?: number;
    sentInvitationAfterLatestActionCount?: number;
    linkedinActionCount?: number;
    observedConnectedActionCount?: number;
    latestLinkedinAction?: LinkedinActionWorkspaceEntity | null;
    dailyEmailReservationAvailable?: boolean;
    existingApolloEnrollment?: SequenceEnrollmentWorkspaceEntity | null;
  } = {}) => {
    const enrollmentRepository = {
      findOne: jest
        .fn()
        .mockImplementation(async ({ where }) =>
          typeof where?.id === 'string'
            ? currentEnrollment
            : existingApolloEnrollment,
        ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const sequenceRepository = {
      findOne: jest.fn().mockResolvedValue(currentSequence),
    };
    const stepRepository = {
      find: jest.fn().mockResolvedValue(steps),
    };
    const personRepository = {
      findOne: jest.fn().mockResolvedValue(person),
    };
    const linkedinActionRepository = {
      insert: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest
        .fn()
        .mockImplementation(async ({ where }) =>
          where?.connectionState === LINKEDIN_CONNECTION_STATES.CONNECTED
            ? observedConnectedActionCount
            : linkedinActionCount,
        ),
      findOne: jest.fn().mockResolvedValue(latestLinkedinAction),
    };
    const linkedinConnectionRepository = {
      count: jest.fn().mockResolvedValue(connectionCount),
    };
    const linkedinInvitationRepository = {
      count: jest
        .fn()
        .mockImplementation(
          async ({ where }: { where?: Record<string, unknown> }) =>
            where && 'sentAt' in where
              ? sentInvitationAfterLatestActionCount
              : sentInvitationCount,
        ),
    };
    const linkedinMessageRepository = {
      count: jest.fn().mockResolvedValue(0),
    };
    const linkedinThreadParticipantRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const messageParticipantRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const repositories = new Map<object, object>([
      [SequenceEnrollmentWorkspaceEntity, enrollmentRepository],
      [SequenceWorkspaceEntity, sequenceRepository],
      [SequenceStepWorkspaceEntity, stepRepository],
      [PersonWorkspaceEntity, personRepository],
      [LinkedinActionWorkspaceEntity, linkedinActionRepository],
      [LinkedinConnectionWorkspaceEntity, linkedinConnectionRepository],
      [LinkedinInvitationWorkspaceEntity, linkedinInvitationRepository],
      [LinkedinMessageWorkspaceEntity, linkedinMessageRepository],
      [MessageParticipantWorkspaceEntity, messageParticipantRepository],
      [
        LinkedinThreadParticipantWorkspaceEntity,
        linkedinThreadParticipantRepository,
      ],
    ]);
    const transactionManager = {} as WorkspaceEntityManager;
    const transaction = jest.fn(
      async (callback: (manager: WorkspaceEntityManager) => Promise<void>) =>
        callback(transactionManager),
    );
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<void>) => callback(),
      ),
      getGlobalWorkspaceDataSource: jest.fn().mockResolvedValue({
        transaction,
      }),
      getRepository: jest.fn(
        async (_workspaceId: string, entity: object) =>
          repositories.get(entity) ?? {},
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const emitCustomBatchEvent = jest.fn();
    const workspaceEventEmitter = {
      emitCustomBatchEvent,
    } as unknown as WorkspaceEventEmitter;
    const reconcileBeforeEnrollmentProgress = jest
      .fn()
      .mockResolvedValue(false);
    const sequenceEmailReplyReconciliationService = {
      reconcileBeforeEnrollmentProgress,
    } as unknown as SequenceEmailReplyReconciliationService;
    const reconcileEnrollmentBeforeProviderStart = jest
      .fn()
      .mockResolvedValue(false);
    const sequenceLinkedinReplyListener = {
      reconcileEnrollmentBeforeProviderStart,
    } as unknown as SequenceLinkedinReplyListener;
    const persistSentMessage = jest.fn().mockResolvedValue(undefined);
    const send = jest.fn(
      async ({
        onProviderStart,
      }: Parameters<SequenceEmailSenderService['send']>[0]) => {
        await onProviderStart();

        return {
          headerMessageId: 'header-message-id',
          threadExternalId: 'thread-external-id',
          sentAt: new Date().toISOString(),
          persistSentMessage,
        };
      },
    );
    const sequenceEmailSenderService = {
      send,
    } as unknown as SequenceEmailSenderService;
    const createTask = jest.fn();
    const sequenceTaskCreatorService = {
      createTask,
    } as unknown as SequenceTaskCreatorService;
    const acquireSendLock = jest.fn().mockResolvedValue('mailbox-lock-token');
    const renewSendLock = jest.fn().mockResolvedValue(true);
    const releaseSendLock = jest.fn();
    const getLastSendAt = jest.fn().mockResolvedValue(null);
    const setLastSendAt = jest.fn();
    const recordEmailSendClaimWatermark = jest.fn();
    const reserveUtcDailySend = jest.fn(async ({ now }: { now: Date }) =>
      dailyEmailReservationAvailable
        ? {
            reservationToken: 'daily-reservation-token',
            usageDate: now.toISOString().slice(0, 10),
          }
        : null,
    );
    const releaseUtcDailySendReservation = jest.fn();
    const consumeUtcDailySendReservation = jest.fn();
    const sequenceMailboxThrottleService = {
      acquireSendLock,
      renewSendLock,
      releaseSendLock,
      getLastSendAt,
      setLastSendAt,
      recordEmailSendClaimWatermark,
      reserveUtcDailySend,
      releaseUtcDailySendReservation,
      consumeUtcDailySendReservation,
    } as unknown as SequenceMailboxThrottleService;
    const reserveSlot = jest.fn().mockResolvedValue(new Date());
    const sequenceLinkedinThrottleService = {
      reserveSlot,
    } as unknown as SequenceLinkedinThrottleService;
    const enqueueProcess = jest.fn();
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;
    const getReadySenderOrThrow = jest.fn().mockResolvedValue({
      connectedAccount: { id: 'connected-account-id' },
      messageChannel: { id: 'message-channel-id' },
    });
    const getSenderAccountOrThrow = jest.fn().mockResolvedValue({
      id: 'connected-account-id',
      userWorkspaceId: 'user-workspace-id',
    });
    const getOwnerWorkspaceMemberIdOrThrow = jest
      .fn()
      .mockResolvedValue('owner-workspace-member-id');
    const getSenderOwnerWorkspaceMemberIdOrThrow = jest
      .fn()
      .mockResolvedValue('owner-workspace-member-id');
    const coreTransactionManager = { query: jest.fn() };
    const withLockedSenderAccountOrThrow = jest.fn(async ({ operation }) =>
      operation(
        {
          id: 'connected-account-id',
          userWorkspaceId: 'user-workspace-id',
        },
        coreTransactionManager,
      ),
    );
    const sequenceSenderService = {
      getSenderAccountOrThrow,
      getReadySenderOrThrow,
      getOwnerWorkspaceMemberIdOrThrow,
      getSenderOwnerWorkspaceMemberIdOrThrow,
      withLockedSenderAccountOrThrow,
      coreTransactionManager,
    } as unknown as SequenceSenderService;
    const buildVariables = jest.fn().mockResolvedValue({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const sequenceVariableService = {
      buildVariables,
    } as unknown as SequenceVariableService;
    const enrichPerson = jest.fn<
      ReturnType<ApolloEnrichmentService['enrichPerson']>,
      Parameters<ApolloEnrichmentService['enrichPerson']>
    >(async (input: Parameters<ApolloEnrichmentService['enrichPerson']>[0]) => {
      await input.onProviderStart?.();

      return 'updated' as const;
    });
    const apolloEnrichmentService = {
      enrichPerson,
    } as unknown as ApolloEnrichmentService;
    const service = new SequenceExecutorService(
      globalWorkspaceOrmManager,
      workspaceEventEmitter,
      sequenceEmailReplyReconciliationService,
      sequenceLinkedinReplyListener,
      sequenceEmailSenderService,
      sequenceTaskCreatorService,
      sequenceMailboxThrottleService,
      sequenceLinkedinThrottleService,
      sequenceQueueService,
      sequenceSenderService,
      sequenceVariableService,
      apolloEnrichmentService,
    );

    return {
      service,
      enrollmentRepository,
      sequenceRepository,
      personRepository,
      send,
      persistSentMessage,
      createTask,
      transaction,
      transactionManager,
      acquireSendLock,
      releaseSendLock,
      getLastSendAt,
      setLastSendAt,
      recordEmailSendClaimWatermark,
      reserveUtcDailySend,
      releaseUtcDailySendReservation,
      consumeUtcDailySendReservation,
      linkedinActionRepository,
      linkedinConnectionRepository,
      linkedinMessageRepository,
      linkedinThreadParticipantRepository,
      messageParticipantRepository,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      emitCustomBatchEvent,
      reserveSlot,
      enqueueProcess,
      getSenderAccountOrThrow,
      getReadySenderOrThrow,
      getOwnerWorkspaceMemberIdOrThrow,
      getSenderOwnerWorkspaceMemberIdOrThrow,
      withLockedSenderAccountOrThrow,
      coreTransactionManager,
      buildVariables,
      enrichPerson,
    };
  };

  it('claims the email step before sending and advances only after success', async () => {
    const {
      service,
      enrollmentRepository,
      sequenceRepository,
      send,
      reserveUtcDailySend,
      consumeUtcDailySendReservation,
      recordEmailSendClaimWatermark,
      transactionManager,
    } = setup();

    send.mockImplementation(async ({ onProviderStart }) => {
      expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
      expect(enrollmentRepository.update.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          currentStepId: stepId,
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          nextActionAt: expect.any(Date),
          lastSendAttempt: expect.objectContaining({ stepId }),
        }),
      );
      const claimUpdate = enrollmentRepository.update.mock.calls[0][1];

      expect(claimUpdate.nextActionAt.getTime()).toBe(
        Date.parse(claimUpdate.lastSendAttempt.attemptedAt) +
          SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
      );
      expect(enrollmentRepository.update.mock.calls[0][1]).not.toHaveProperty(
        'currentStepPosition',
      );

      await onProviderStart();

      return {
        headerMessageId: 'header-message-id',
        threadExternalId: 'thread-external-id',
        sentAt: new Date().toISOString(),
        persistSentMessage: jest.fn(),
      };
    });

    await service.process({ workspaceId, enrollmentId });

    expect(reserveUtcDailySend).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        mailboxId: 'connected-account-id',
      }),
    );
    expect(reserveUtcDailySend.mock.invocationCallOrder[0]).toBeLessThan(
      enrollmentRepository.update.mock.invocationCallOrder[0],
    );
    expect(recordEmailSendClaimWatermark).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      date: expect.any(Date),
    });
    expect(consumeUtcDailySendReservation).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      reservationToken: 'daily-reservation-token',
      usageDate: expect.any(String),
    });
    expect(
      enrollmentRepository.update.mock.invocationCallOrder[1],
    ).toBeLessThan(recordEmailSendClaimWatermark.mock.invocationCallOrder[0]);
    expect(sequenceRepository.findOne).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: sequence.id,
          status: SEQUENCE_STATUSES.ACTIVE,
        },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      transactionManager,
    );
    expect(enrollmentRepository.findOne).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: enrollment.id,
          sequenceId: sequence.id,
          status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
          currentStepPosition: enrollment.currentStepPosition,
          currentStepId: expect.anything(),
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          nextActionAt: expect.anything(),
        },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      transactionManager,
    );
    expect(sequenceRepository.findOne.mock.invocationCallOrder[1]).toBeLessThan(
      enrollmentRepository.findOne.mock.invocationCallOrder[1],
    );
    expect(
      enrollmentRepository.findOne.mock.invocationCallOrder[1],
    ).toBeLessThan(enrollmentRepository.update.mock.invocationCallOrder[0]);
    expect(enrollmentRepository.update.mock.calls[0][2]).toBe(
      transactionManager,
    );
    expect(
      enrollmentRepository.update.mock.invocationCallOrder[0],
    ).toBeLessThan(send.mock.invocationCallOrder[0]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(4);
    expect(enrollmentRepository.update.mock.calls[3][1]).toEqual(
      expect.objectContaining({
        currentStepPosition: 0,
        sentEmailsByStepId: {
          [stepId]: expect.objectContaining({
            headerMessageId: 'header-message-id',
            threadExternalId: 'thread-external-id',
          }),
        },
      }),
    );
  });

  it('reconciles a durable reply before a lost participant event can allow another send', async () => {
    const currentEnrollment = {
      ...enrollment,
      sentEmailsByStepId: {
        'previous-email-step-id': {
          headerMessageId: 'previous-header-message-id',
          threadExternalId: 'previous-thread-id',
          sentAt: '2026-08-16T10:00:00.000Z',
          connectedAccountId: 'connected-account-id',
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      sequenceRepository,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      send,
    } = setup({ currentEnrollment });

    reconcileBeforeEnrollmentProgress.mockResolvedValueOnce(true);

    await service.process({ workspaceId, enrollmentId });

    expect(reconcileBeforeEnrollmentProgress).toHaveBeenCalledWith({
      workspaceId,
      enrollment: currentEnrollment,
      enrollmentRepository,
    });
    expect(reconcileEnrollmentBeforeProviderStart).not.toHaveBeenCalled();
    expect(sequenceRepository.findOne).toHaveBeenCalledWith({
      where: { id: sequence.id },
    });
    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('reconciles a durable LinkedIn reply before advancing the enrollment', async () => {
    const {
      service,
      enrollmentRepository,
      sequenceRepository,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      send,
    } = setup();

    reconcileEnrollmentBeforeProviderStart.mockResolvedValueOnce(true);

    await service.process({ workspaceId, enrollmentId });

    expect(reconcileBeforeEnrollmentProgress).toHaveBeenCalled();
    expect(reconcileEnrollmentBeforeProviderStart).toHaveBeenCalledWith({
      sequenceEnrollmentId: enrollmentId,
      workspaceId,
    });
    expect(sequenceRepository.findOne).toHaveBeenCalledWith({
      where: { id: sequence.id },
    });
    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('replays a participant event that arrived before send metadata became durable', async () => {
    const sendStartedAt = new Date('2026-08-17T10:00:00.000Z');
    const participantCreatedAt = '2026-08-17T10:00:05.000Z';

    jest.useFakeTimers({ now: sendStartedAt });

    const {
      service,
      enrollmentRepository,
      send,
      messageParticipantRepository,
      emitCustomBatchEvent,
    } = setup();
    const inFlightParticipant = {
      id: 'in-flight-participant-id',
      createdAt: participantCreatedAt,
      messageId: 'in-flight-incoming-message-id',
      personId: 'person-id',
      role: MessageParticipantRole.FROM,
      workspaceMemberId: null,
    } as MessageParticipantWorkspaceEntity;

    send.mockImplementation(async ({ onProviderStart }) => {
      // The original participant event can run while the provider call is in
      // flight, before sentEmailsByStepId contains this send.
      await onProviderStart();
      jest.setSystemTime(new Date('2026-08-17T10:00:10.000Z'));

      return {
        headerMessageId: 'header-message-id',
        threadExternalId: 'thread-external-id',
        sentAt: sendStartedAt.toISOString(),
        persistSentMessage: jest.fn(),
      };
    });
    messageParticipantRepository.find.mockResolvedValue([inFlightParticipant]);

    await service.process({ workspaceId, enrollmentId });

    const persistedSend =
      enrollmentRepository.update.mock.calls[3][1].sentEmailsByStepId[stepId];
    const participantFindOptions =
      messageParticipantRepository.find.mock.calls[0][0];

    expect(persistedSend.sentAt).toBe(sendStartedAt.toISOString());
    expect(participantFindOptions.where).toEqual(
      expect.objectContaining({
        personId: 'person-id',
        role: MessageParticipantRole.FROM,
      }),
    );
    expect(participantFindOptions.where.createdAt.value).toBe(
      sendStartedAt.toISOString(),
    );
    expect(emitCustomBatchEvent).toHaveBeenCalledWith(
      'messageParticipant_matched',
      [{ workspaceMemberId: null, participants: [inFlightParticipant] }],
      workspaceId,
    );
    expect(
      enrollmentRepository.update.mock.invocationCallOrder[3],
    ).toBeLessThan(emitCustomBatchEvent.mock.invocationCallOrder[0]);
  });

  it('does not claim or send when pause wins the sequence lock race', async () => {
    const {
      service,
      enrollmentRepository,
      sequenceRepository,
      send,
      setLastSendAt,
      recordEmailSendClaimWatermark,
      reserveUtcDailySend,
      releaseUtcDailySendReservation,
      transactionManager,
    } = setup();

    sequenceRepository.findOne
      .mockResolvedValueOnce(sequence)
      .mockResolvedValueOnce(null);

    await service.process({ workspaceId, enrollmentId });

    expect(sequenceRepository.findOne).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: sequence.id,
          status: SEQUENCE_STATUSES.ACTIVE,
        },
        select: ['id'],
        lock: { mode: 'pessimistic_write' },
      },
      transactionManager,
    );
    expect(reserveUtcDailySend).toHaveBeenCalledTimes(1);
    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        mailboxId: 'connected-account-id',
        reservationToken: 'daily-reservation-token',
        usageDate: expect.any(String),
        transactionManager: expect.anything(),
      }),
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(setLastSendAt).not.toHaveBeenCalled();
    expect(recordEmailSendClaimWatermark).not.toHaveBeenCalled();
  });

  it('releases a live unstarted email reservation while its sequence is paused', async () => {
    const now = new Date('2026-08-19T10:00:00.000Z');
    const pausedSendAttempt = {
      stepId,
      attemptedAt: now.toISOString(),
      dailyReservation: {
        mailboxId: 'connected-account-id',
        token: 'paused-reservation-token',
        usageDate: '2026-08-19',
      },
      previousCursor: {
        currentStepId: enrollment.currentStepId,
        currentStepPosition: enrollment.currentStepPosition,
        waitingOn: enrollment.waitingOn,
        nextActionAt: enrollment.nextActionAt?.toISOString() ?? null,
        stopOnReply: enrollment.stopOnReply,
      },
    } as NonNullable<SequenceEnrollmentWorkspaceEntity['lastSendAttempt']>;
    const {
      service,
      enrollmentRepository,
      send,
      enqueueProcess,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      releaseUtcDailySendReservation,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date(
          now.getTime() + SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
        ),
        lastSendAttempt: pausedSendAttempt,
      },
      currentSequence: {
        ...sequence,
        status: SEQUENCE_STATUSES.PAUSED,
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      reservationToken: 'paused-reservation-token',
      usageDate: '2026-08-19',
    });
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(2);
    expect(enrollmentRepository.update.mock.calls[0][1]).toEqual({
      lastSendAttempt: {
        ...pausedSendAttempt,
        reservationReleasePendingAt: expect.any(String),
      },
    });
    expect(enrollmentRepository.update.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        currentStepId: enrollment.currentStepId,
        currentStepPosition: enrollment.currentStepPosition,
        lastSendAttempt: null,
      }),
    );
    expect(reconcileBeforeEnrollmentProgress).not.toHaveBeenCalled();
    expect(reconcileEnrollmentBeforeProviderStart).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('releases and clears an unstarted reservation on a terminal enrollment', async () => {
    const terminalSendAttempt = {
      stepId,
      attemptedAt: '2026-08-19T10:00:00.000Z',
      dailyReservation: {
        mailboxId: 'connected-account-id',
        token: 'terminal-reservation-token',
        usageDate: '2026-08-19',
      },
    } as NonNullable<SequenceEnrollmentWorkspaceEntity['lastSendAttempt']>;
    const {
      service,
      enrollmentRepository,
      send,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      releaseUtcDailySendReservation,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
        waitingOn: null,
        nextActionAt: null,
        lastSendAttempt: terminalSendAttempt,
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      reservationToken: 'terminal-reservation-token',
      usageDate: '2026-08-19',
    });
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(2);
    const [markPendingCriteria, markPendingValues] =
      enrollmentRepository.update.mock.calls[0];
    const releasePendingAttempt = markPendingValues.lastSendAttempt;

    expect(markPendingCriteria).toEqual(
      expect.objectContaining({
        id: enrollmentId,
        status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
      }),
    );
    expect(markPendingCriteria.lastSendAttempt.value).toEqual(
      terminalSendAttempt,
    );
    expect(releasePendingAttempt).toEqual({
      ...terminalSendAttempt,
      reservationReleasePendingAt: expect.any(String),
    });
    expect(enrollmentRepository.update.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        id: enrollmentId,
        status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
        lastSendAttempt: expect.objectContaining({
          value: releasePendingAttempt,
        }),
      }),
    );
    expect(enrollmentRepository.update.mock.calls[1][1]).toEqual({
      lastSendAttempt: null,
    });
    expect(reconcileBeforeEnrollmentProgress).not.toHaveBeenCalled();
    expect(reconcileEnrollmentBeforeProviderStart).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a terminal provider-started reservation because delivery may have occurred', async () => {
    const providerStartedAt = '2026-08-19T10:00:00.000Z';
    const {
      service,
      enrollmentRepository,
      send,
      releaseUtcDailySendReservation,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        waitingOn: null,
        nextActionAt: null,
        lastSendAttempt: {
          stepId,
          attemptedAt: providerStartedAt,
          providerStartedAt,
          dailyReservation: {
            mailboxId: 'connected-account-id',
            token: 'provider-started-reservation-token',
            usageDate: '2026-08-19',
          },
        },
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(releaseUtcDailySendReservation).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a terminal release marker durable when quota cleanup fails', async () => {
    const releaseError = new Error('core quota ledger unavailable');
    const terminalSendAttempt = {
      stepId,
      attemptedAt: '2026-08-19T10:00:00.000Z',
      dailyReservation: {
        mailboxId: 'connected-account-id',
        token: 'retryable-terminal-token',
        usageDate: '2026-08-19',
      },
    } as NonNullable<SequenceEnrollmentWorkspaceEntity['lastSendAttempt']>;
    const { service, enrollmentRepository, releaseUtcDailySendReservation } =
      setup({
        currentEnrollment: {
          ...enrollment,
          status: SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
          waitingOn: null,
          nextActionAt: null,
          lastSendAttempt: terminalSendAttempt,
        },
      });

    releaseUtcDailySendReservation.mockRejectedValueOnce(releaseError);

    await expect(service.process({ workspaceId, enrollmentId })).rejects.toBe(
      releaseError,
    );

    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update.mock.calls[0][1]).toEqual({
      lastSendAttempt: {
        ...terminalSendAttempt,
        reservationReleasePendingAt: expect.any(String),
      },
    });
  });

  it('retries an active release-pending reservation before its send lease expires', async () => {
    const now = new Date('2026-08-19T10:00:00.000Z');
    const releasePendingAttempt = {
      stepId,
      attemptedAt: now.toISOString(),
      providerStartedAt: now.toISOString(),
      reservationReleasePendingAt: now.toISOString(),
      dailyReservation: {
        mailboxId: 'connected-account-id',
        token: 'active-release-pending-token',
        usageDate: '2026-08-19',
      },
      previousCursor: {
        currentStepId: null,
        currentStepPosition: -1,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: now.toISOString(),
        stopOnReply: true,
      },
    } as NonNullable<SequenceEnrollmentWorkspaceEntity['lastSendAttempt']>;
    const {
      service,
      enrollmentRepository,
      send,
      enqueueProcess,
      releaseUtcDailySendReservation,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date(
          now.getTime() + SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
        ),
        lastSendAttempt: releasePendingAttempt,
      },
    });

    jest.useFakeTimers({ now });

    try {
      await service.process({ workspaceId, enrollmentId });
    } finally {
      jest.useRealTimers();
    }

    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      reservationToken: 'active-release-pending-token',
      usageDate: '2026-08-19',
    });
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        lastSendAttempt: expect.objectContaining({
          value: releasePendingAttempt,
        }),
      }),
      expect.objectContaining({
        currentStepId: null,
        currentStepPosition: -1,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        lastSendAttempt: null,
      }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({ workspaceId, enrollmentId });
    expect(send).not.toHaveBeenCalled();
  });

  it('cancels an email before provider start when pause wins after the durable claim', async () => {
    const {
      service,
      enrollmentRepository,
      sequenceRepository,
      send,
      releaseUtcDailySendReservation,
    } = setup();
    let providerCallReached = false;

    sequenceRepository.findOne
      .mockResolvedValueOnce(sequence)
      .mockResolvedValueOnce(sequence)
      .mockResolvedValueOnce(null);
    send.mockImplementationOnce(async ({ onProviderStart }) => {
      await onProviderStart();
      providerCallReached = true;

      return {
        headerMessageId: 'should-not-send',
        threadExternalId: 'should-not-send',
        sentAt: new Date().toISOString(),
        persistSentMessage: jest.fn(),
      };
    });

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).rejects.toThrow('claim changed before the provider could start');

    expect(providerCallReached).toBe(false);
    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        mailboxId: 'connected-account-id',
        reservationToken: 'daily-reservation-token',
      }),
    );
    expect(
      enrollmentRepository.update.mock.calls.some(([, values]) =>
        isDefined(values.lastSendAttempt?.providerStartedAt),
      ),
    ).toBe(false);
  });

  it('does not carry an email reservation across the UTC day boundary', async () => {
    const claimedAt = new Date('2026-08-17T23:59:30.000Z');

    jest.useFakeTimers({ now: claimedAt });

    const { service, send, releaseUtcDailySendReservation } = setup();
    let providerCallReached = false;

    send.mockImplementationOnce(async ({ onProviderStart }) => {
      jest.setSystemTime(new Date('2026-08-18T00:00:01.000Z'));
      await onProviderStart();
      providerCallReached = true;

      return {
        headerMessageId: 'should-not-send',
        threadExternalId: 'should-not-send',
        sentAt: new Date().toISOString(),
        persistSentMessage: jest.fn(),
      };
    });

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).rejects.toThrow('claim changed before the provider could start');

    expect(providerCallReached).toBe(false);
    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      reservationToken: 'daily-reservation-token',
      usageDate: '2026-08-17',
    });
  });

  it('does not start an email after its configured send window closes', async () => {
    const claimedAt = new Date('2026-08-19T09:59:00.000Z');

    jest.useFakeTimers({ now: claimedAt });

    const { service, send, releaseUtcDailySendReservation } = setup({
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          timezone: 'UTC',
          windowStart: '09:00',
          windowEnd: '10:00',
          emailWindowStart: '09:00',
          emailWindowEnd: '10:00',
        },
      },
    });
    let providerCallReached = false;

    send.mockImplementationOnce(async ({ onProviderStart }) => {
      jest.setSystemTime(new Date('2026-08-19T10:01:00.000Z'));
      await onProviderStart();
      providerCallReached = true;

      return {
        headerMessageId: 'should-not-send',
        threadExternalId: 'should-not-send',
        sentAt: new Date().toISOString(),
        persistSentMessage: jest.fn(),
      };
    });

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).rejects.toThrow('claim changed before the provider could start');

    expect(providerCallReached).toBe(false);
    expect(releaseUtcDailySendReservation).toHaveBeenCalledTimes(1);
  });

  it('does not claim or send when sender archival wins the account lock race', async () => {
    const {
      service,
      enrollmentRepository,
      send,
      getReadySenderOrThrow,
      withLockedSenderAccountOrThrow,
      releaseUtcDailySendReservation,
    } = setup();

    withLockedSenderAccountOrThrow.mockRejectedValueOnce(
      new SequenceSenderUnavailableError(
        'Choose an active sender account that belongs to your workspace account',
      ),
    );

    await service.process({ workspaceId, enrollmentId });

    expect(getReadySenderOrThrow).toHaveBeenCalledTimes(1);
    expect(withLockedSenderAccountOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        connectedAccountId: 'connected-account-id',
        shouldRequireReadyMailbox: true,
        workspaceId,
      }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(releaseUtcDailySendReservation).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: expect.stringContaining('active sender account'),
      }),
    );
  });

  it('defers without sending when inbox sync starts before the account lock', async () => {
    const {
      service,
      enrollmentRepository,
      send,
      withLockedSenderAccountOrThrow,
      releaseUtcDailySendReservation,
    } = setup();

    withLockedSenderAccountOrThrow.mockRejectedValueOnce(
      new SequenceSenderNotReadyError(
        'Wait for the selected sender mailbox to finish its current sync',
      ),
    );

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(releaseUtcDailySendReservation).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      {
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: expect.any(Date),
      },
    );
  });

  it('commits the sender claim before starting the provider call', async () => {
    const {
      service,
      enrollmentRepository,
      send,
      withLockedSenderAccountOrThrow,
    } = setup();
    const timeline: string[] = [];

    withLockedSenderAccountOrThrow.mockImplementationOnce(
      async ({ operation }) => {
        timeline.push('account-locked');
        const result = await operation(
          { id: 'connected-account-id' },
          { query: jest.fn() },
        );
        timeline.push('account-released');

        return result;
      },
    );
    send.mockImplementationOnce(async ({ onProviderStart }) => {
      await onProviderStart();
      timeline.push('provider-sent');

      return {
        headerMessageId: 'header-message-id',
        threadExternalId: 'thread-external-id',
        sentAt: new Date().toISOString(),
        persistSentMessage: jest.fn(),
      };
    });

    await service.process({ workspaceId, enrollmentId });

    expect(timeline).toEqual([
      'account-locked',
      'account-released',
      'provider-sent',
    ]);
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(4);
  });

  it('continues a provider-started email when the durable pacing watermark fails', async () => {
    const coreError = new Error('core watermark unavailable');
    const {
      service,
      enrollmentRepository,
      send,
      recordEmailSendClaimWatermark,
      releaseUtcDailySendReservation,
    } = setup();

    recordEmailSendClaimWatermark.mockRejectedValueOnce(coreError);

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).resolves.toBeUndefined();

    expect(recordEmailSendClaimWatermark).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(releaseUtcDailySendReservation).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      }),
      expect.objectContaining({
        sentEmailsByStepId: expect.objectContaining({
          [stepId]: expect.anything(),
        }),
      }),
    );
  });

  it('continues a provider-started email when reservation token cleanup fails', async () => {
    const cleanupError = new Error('reservation token cleanup unavailable');
    const {
      service,
      consumeUtcDailySendReservation,
      releaseUtcDailySendReservation,
      send,
    } = setup();

    consumeUtcDailySendReservation.mockRejectedValueOnce(cleanupError);

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).resolves.toBeUndefined();

    expect(consumeUtcDailySendReservation).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(releaseUtcDailySendReservation).not.toHaveBeenCalled();
  });

  it('immediately restores an unstarted email claim when the outer core transaction rejects after the workspace commit', async () => {
    const coreCommitError = new Error('core transaction commit failed');
    const {
      service,
      enrollmentRepository,
      send,
      recordEmailSendClaimWatermark,
      releaseUtcDailySendReservation,
      withLockedSenderAccountOrThrow,
      coreTransactionManager,
    } = setup();

    withLockedSenderAccountOrThrow.mockImplementationOnce(
      async ({ operation }) => {
        await operation({ id: 'connected-account-id' }, coreTransactionManager);

        throw coreCommitError;
      },
    );

    await expect(service.process({ workspaceId, enrollmentId })).rejects.toBe(
      coreCommitError,
    );

    expect(recordEmailSendClaimWatermark).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      reservationToken: 'daily-reservation-token',
      usageDate: expect.any(String),
    });
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(3);

    const claimValues = enrollmentRepository.update.mock.calls[0][1];
    const [releasePendingCriteria, releasePendingValues] =
      enrollmentRepository.update.mock.calls[1];
    const [compensationCriteria, compensationValues] =
      enrollmentRepository.update.mock.calls[2];

    expect(releasePendingCriteria.lastSendAttempt.value).toEqual(
      claimValues.lastSendAttempt,
    );
    expect(releasePendingValues.lastSendAttempt).toEqual({
      ...claimValues.lastSendAttempt,
      reservationReleasePendingAt: expect.any(String),
    });

    expect(compensationCriteria.lastSendAttempt.type).toBe('equal');
    expect(compensationCriteria.lastSendAttempt.value).toEqual(
      releasePendingValues.lastSendAttempt,
    );
    expect(compensationValues).toEqual({
      currentStepId: enrollment.currentStepId,
      currentStepPosition: enrollment.currentStepPosition,
      waitingOn: enrollment.waitingOn,
      nextActionAt: enrollment.nextActionAt,
      stopOnReply: enrollment.stopOnReply,
      lastSendAttempt: null,
    });
    expect(compensationValues.nextActionAt.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it('recovers an expired pre-provider claim after immediate compensation failed', async () => {
    const coreError = new Error('core transaction commit failed');
    const compensationError = new Error('workspace compensation unavailable');
    const firstAttempt = setup();

    firstAttempt.withLockedSenderAccountOrThrow.mockImplementationOnce(
      async ({ operation }) => {
        await operation(
          { id: 'connected-account-id' },
          firstAttempt.coreTransactionManager,
        );

        throw coreError;
      },
    );
    firstAttempt.enrollmentRepository.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockRejectedValueOnce(compensationError);

    await expect(
      firstAttempt.service.process({ workspaceId, enrollmentId }),
    ).rejects.toBe(compensationError);

    const claimedValues = firstAttempt.enrollmentRepository.update.mock
      .calls[0][1] as {
      lastSendAttempt: SequenceEnrollmentWorkspaceEntity['lastSendAttempt'];
    };
    const expiredSendAttempt = {
      ...claimedValues.lastSendAttempt,
      attemptedAt: '2020-01-01T00:00:00.000Z',
    } as NonNullable<SequenceEnrollmentWorkspaceEntity['lastSendAttempt']>;
    const recoveryAttempt = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date('2020-01-01T00:10:00.000Z'),
        lastSendAttempt: expiredSendAttempt,
      } as SequenceEnrollmentWorkspaceEntity,
    });

    await recoveryAttempt.service.process({ workspaceId, enrollmentId });

    expect(recoveryAttempt.send).not.toHaveBeenCalled();
    expect(recoveryAttempt.releaseUtcDailySendReservation).toHaveBeenCalledWith(
      {
        workspaceId,
        mailboxId: 'connected-account-id',
        reservationToken: 'daily-reservation-token',
        usageDate: expect.any(String),
      },
    );
    expect(recoveryAttempt.enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        lastSendAttempt: expect.anything(),
      }),
      expect.objectContaining({
        currentStepId: enrollment.currentStepId,
        currentStepPosition: enrollment.currentStepPosition,
        waitingOn: enrollment.waitingOn,
        lastSendAttempt: null,
      }),
    );
    expect(recoveryAttempt.enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId,
    });
    expect(
      recoveryAttempt.enrollmentRepository.update.mock.calls,
    ).not.toContainEqual(
      expect.arrayContaining([
        expect.anything(),
        expect.objectContaining({
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        }),
      ]),
    );
  });

  it('keeps an expired unstarted claim durable when exact quota release fails', async () => {
    const releaseError = new Error('core quota ledger unavailable');
    const expiredSendAttempt = {
      stepId,
      attemptedAt: '2020-01-01T00:00:00.000Z',
      dailyReservation: {
        mailboxId: 'connected-account-id',
        token: 'reservation-token',
        usageDate: '2026-08-17',
      },
      previousCursor: {
        currentStepId: enrollment.currentStepId,
        currentStepPosition: enrollment.currentStepPosition,
        waitingOn: enrollment.waitingOn,
        nextActionAt: enrollment.nextActionAt?.toISOString() ?? null,
        stopOnReply: enrollment.stopOnReply,
      },
    } as NonNullable<SequenceEnrollmentWorkspaceEntity['lastSendAttempt']>;
    const {
      service,
      enrollmentRepository,
      enqueueProcess,
      releaseUtcDailySendReservation,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date('2020-01-01T00:10:00.000Z'),
        lastSendAttempt: expiredSendAttempt,
      },
    });

    releaseUtcDailySendReservation.mockRejectedValueOnce(releaseError);

    await expect(service.process({ workspaceId, enrollmentId })).rejects.toBe(
      releaseError,
    );

    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      reservationToken: 'reservation-token',
      usageDate: '2026-08-17',
    });
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        lastSendAttempt: expect.anything(),
      }),
      {
        lastSendAttempt: {
          ...expiredSendAttempt,
          reservationReleasePendingAt: expect.any(String),
        },
      },
    );
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('waits for a syncing mailbox instead of ending the enrollment', async () => {
    const { service, enrollmentRepository, send, getReadySenderOrThrow } =
      setup();

    getReadySenderOrThrow.mockRejectedValue(
      new SequenceSenderNotReadyError(
        'Enable inbox sync and wait for the selected sender mailbox to finish syncing',
      ),
    );

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    // The cursor stays on this step so the next tick retries the same send.
    expect(enrollmentRepository.update.mock.calls[0][1]).toEqual({
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
      nextActionAt: expect.any(Date),
    });
    expect(enrollmentRepository.update.mock.calls[0][1]).not.toHaveProperty(
      'status',
    );
  });

  it('still fails the enrollment when the sender itself is unusable', async () => {
    const { service, enrollmentRepository, send, getReadySenderOrThrow } =
      setup();

    getReadySenderOrThrow.mockRejectedValue(
      new SequenceSenderUnavailableError(
        'The selected account cannot send sequence email',
      ),
    );

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
      }),
    );
  });

  it('propagates sender readiness infrastructure errors without burning the enrollment', async () => {
    const { service, enrollmentRepository, send, getReadySenderOrThrow } =
      setup();
    const databaseError = new Error('database unavailable');

    getReadySenderOrThrow.mockRejectedValue(databaseError);

    await expect(service.process({ workspaceId, enrollmentId })).rejects.toBe(
      databaseError,
    );

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('preserves reply attribution when a reply wins the send persistence race', async () => {
    const previousSentEmailsByStepId = {
      'previous-step-id': {
        headerMessageId: 'previous-header-message-id',
        threadExternalId: 'previous-thread-external-id',
        sentAt: '2026-08-16T10:00:00.000Z',
      },
    };
    const currentEnrollment = {
      ...enrollment,
      sentEmailsByStepId: previousSentEmailsByStepId,
    } as SequenceEnrollmentWorkspaceEntity;
    const repliedEnrollment = {
      ...currentEnrollment,
      status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
      sentEmailsByStepId: {
        'previous-step-id': {
          ...previousSentEmailsByStepId['previous-step-id'],
          repliedAt: '2026-08-17T10:00:00.000Z',
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository } = setup({ currentEnrollment });

    enrollmentRepository.findOne
      .mockResolvedValueOnce(currentEnrollment)
      .mockResolvedValueOnce(currentEnrollment)
      .mockResolvedValueOnce(repliedEnrollment);
    enrollmentRepository.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenCalledTimes(5);
    expect(enrollmentRepository.update.mock.calls[4][1]).toEqual({
      sentEmailsByStepId: {
        'previous-step-id': expect.objectContaining({
          repliedAt: '2026-08-17T10:00:00.000Z',
        }),
        [stepId]: expect.objectContaining({
          headerMessageId: 'header-message-id',
          threadExternalId: 'thread-external-id',
        }),
      },
    });
  });

  it('persists send metadata without reopening an enrollment archived during delivery', async () => {
    const archivedEnrollment = {
      ...enrollment,
      status: SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
      waitingOn: null,
      nextActionAt: null,
      sentEmailsByStepId: {},
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository } = setup();

    enrollmentRepository.findOne
      .mockResolvedValueOnce(enrollment)
      .mockResolvedValueOnce(enrollment)
      .mockResolvedValueOnce(archivedEnrollment);
    enrollmentRepository.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenCalledTimes(5);
    expect(enrollmentRepository.update.mock.calls[4]).toEqual([
      expect.objectContaining({ id: enrollmentId }),
      {
        sentEmailsByStepId: {
          [stepId]: expect.objectContaining({
            headerMessageId: 'header-message-id',
            threadExternalId: 'thread-external-id',
          }),
        },
      },
    ]);
    expect(enrollmentRepository.update.mock.calls[4][1]).not.toHaveProperty(
      'status',
    );
    expect(enrollmentRepository.update.mock.calls[4][1]).not.toHaveProperty(
      'waitingOn',
    );
  });

  it('reschedules without claiming when the mailbox daily cap is reached', async () => {
    const { service, enrollmentRepository, send, reserveUtcDailySend } = setup({
      dailyEmailReservationAvailable: false,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(reserveUtcDailySend).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        mailboxId: 'connected-account-id',
      }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({ nextActionAt: expect.any(Date) }),
    );
    expect(
      enrollmentRepository.update.mock.calls[0][1].nextActionAt.getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it('pins a legacy sender before reserving mailbox usage', async () => {
    const { service, enrollmentRepository, send, reserveUtcDailySend } = setup({
      currentEnrollment: {
        ...enrollment,
        senderConnectedAccountId: null,
      },
      dailyEmailReservationAvailable: false,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update.mock.calls[0][1]).toEqual({
      senderConnectedAccountId: 'connected-account-id',
    });
    expect(
      enrollmentRepository.update.mock.invocationCallOrder[0],
    ).toBeLessThan(reserveUtcDailySend.mock.invocationCallOrder[0]);
    expect(send).not.toHaveBeenCalled();
  });

  it('fails opted-out people without claiming or sending', async () => {
    const { service, enrollmentRepository, send } = setup({
      person: buildPerson(true),
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: SEQUENCE_EXECUTION_ERROR.EMAIL_OPT_OUT,
      }),
    );
  });

  it('fails an expired claimed send without replaying it', async () => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        lastSendAttempt: {
          stepId,
          attemptedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: SEQUENCE_EXECUTION_ERROR.SEND_INTERRUPTED,
      }),
    );
  });

  it('ignores a duplicate worker while the send claim lease is fresh', async () => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date(
          Date.now() + SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
        ),
        lastSendAttempt: {
          stepId,
          attemptedAt: new Date().toISOString(),
        },
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('keeps a provider send live beyond ten minutes when its heartbeat renewed the lease', async () => {
    const originalAttemptAt = new Date('2026-08-17T10:00:00.000Z');
    const renewedAttemptAt = new Date('2026-08-17T10:11:00.000Z');

    jest.useFakeTimers({ now: new Date('2026-08-17T10:15:00.000Z') });

    try {
      const { service, enrollmentRepository, send } = setup({
        currentEnrollment: {
          ...enrollment,
          currentStepId: stepId,
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
          nextActionAt: new Date(
            originalAttemptAt.getTime() +
              SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
          ),
          lastSendAttempt: {
            stepId,
            attemptedAt: renewedAttemptAt.toISOString(),
          },
        },
      });

      await service.process({ workspaceId, enrollmentId });

      expect(send).not.toHaveBeenCalled();
      expect(enrollmentRepository.update).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('refreshes the durable lease exactly when the provider starts', async () => {
    const claimStartedAt = new Date('2026-08-17T10:00:00.000Z');

    jest.useFakeTimers({ now: claimStartedAt });

    try {
      const { service, enrollmentRepository, send } = setup();

      send.mockImplementationOnce(async ({ onProviderStart }) => {
        jest.setSystemTime(
          new Date(
            claimStartedAt.getTime() +
              SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS -
              1_000,
          ),
        );
        await onProviderStart();

        return {
          headerMessageId: 'header-message-id',
          threadExternalId: 'thread-external-id',
          sentAt: new Date().toISOString(),
          persistSentMessage: jest.fn(),
        };
      });

      await service.process({ workspaceId, enrollmentId });

      const providerStartUpdate = enrollmentRepository.update.mock.calls.find(
        ([, values]) =>
          isDefined(values.lastSendAttempt?.providerStartedAt) &&
          !isDefined(values.lastSendAttempt?.deliveredEmail),
      );
      const providerStartValues = providerStartUpdate?.[1];

      if (!isDefined(providerStartValues?.lastSendAttempt)) {
        throw new Error('Expected a durable provider-start update');
      }

      expect(providerStartValues.lastSendAttempt.attemptedAt).toBe(
        providerStartValues.lastSendAttempt.providerStartedAt,
      );
      expect(providerStartValues.nextActionAt).toEqual(
        new Date(
          Date.parse(providerStartValues.lastSendAttempt.attemptedAt) +
            SEQUENCE_SEND_ATTEMPT_LEASE_MILLISECONDS,
        ),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves an expired send claim untouched while the sequence is paused', async () => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: stepId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
        lastSendAttempt: {
          stepId,
          attemptedAt: '2020-01-01T00:00:00.000Z',
        },
      },
      currentSequence: {
        ...sequence,
        status: SEQUENCE_STATUSES.PAUSED,
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not send when another worker wins the email claim', async () => {
    const {
      service,
      enrollmentRepository,
      send,
      setLastSendAt,
      recordEmailSendClaimWatermark,
      reserveUtcDailySend,
      releaseUtcDailySendReservation,
    } = setup();

    enrollmentRepository.update.mockResolvedValueOnce({ affected: 0 });

    await service.process({ workspaceId, enrollmentId });

    expect(reserveUtcDailySend).toHaveBeenCalledTimes(1);
    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        mailboxId: 'connected-account-id',
        reservationToken: 'daily-reservation-token',
        usageDate: expect.any(String),
        transactionManager: expect.anything(),
      }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(setLastSendAt).not.toHaveBeenCalled();
    expect(recordEmailSendClaimWatermark).not.toHaveBeenCalled();
  });

  it('conservatively keeps the reservation when the provider fails after the claim', async () => {
    const {
      service,
      enrollmentRepository,
      send,
      reserveUtcDailySend,
      releaseUtcDailySendReservation,
    } = setup();

    send.mockImplementationOnce(async ({ onProviderStart }) => {
      await onProviderStart();
      throw new Error('provider rejected the message');
    });

    await service.process({ workspaceId, enrollmentId });

    expect(reserveUtcDailySend).toHaveBeenCalledTimes(1);
    expect(releaseUtcDailySendReservation).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: 'provider rejected the message',
      }),
    );
  });

  it('restores and retries when email preparation fails before provider start', async () => {
    const {
      service,
      enrollmentRepository,
      send,
      releaseUtcDailySendReservation,
    } = setup();
    const preparationError = new Error('template variables unavailable');

    send.mockRejectedValueOnce(preparationError);

    await expect(service.process({ workspaceId, enrollmentId })).rejects.toBe(
      preparationError,
    );

    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      reservationToken: 'daily-reservation-token',
      usageDate: expect.any(String),
    });
    expect(enrollmentRepository.update.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        expect.anything(),
        expect.objectContaining({
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        }),
      ]),
    );
  });

  it('terminalizes a permanent email preparation failure after restoring its claim', async () => {
    const {
      service,
      enrollmentRepository,
      send,
      releaseUtcDailySendReservation,
    } = setup();
    const preparationError = new SequenceEmailPreparationPermanentError(
      'Invalid email addresses: invalid-address',
    );

    send.mockRejectedValueOnce(preparationError);

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).resolves.toBeUndefined();

    expect(releaseUtcDailySendReservation).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      reservationToken: 'daily-reservation-token',
      usageDate: expect.any(String),
    });
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        currentStepId: expect.anything(),
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: 'Invalid email addresses: invalid-address',
      }),
    );
  });

  it('terminalizes a repeatedly failing driver preflight at the durable retry limit', async () => {
    const previousCursor = {
      currentStepId: enrollment.currentStepId,
      currentStepPosition: enrollment.currentStepPosition,
      waitingOn: enrollment.waitingOn,
      nextActionAt: enrollment.nextActionAt?.toISOString() ?? null,
      stopOnReply: enrollment.stopOnReply,
    };
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        lastSendAttempt: {
          stepId,
          attemptedAt: '2026-08-17T09:00:00.000Z',
          preProviderFailure: {
            attemptCount: 4,
            errorMessage: 'email-group domain unavailable',
            failedAt: '2026-08-17T09:00:00.000Z',
          },
          previousCursor,
        },
      },
    });

    send.mockRejectedValueOnce(
      new Error('email-group domain remains unavailable'),
    );

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        currentStepId: stepId,
      }),
      expect.objectContaining({
        lastSendAttempt: expect.objectContaining({
          preProviderFailure: expect.objectContaining({
            attemptCount: 5,
          }),
        }),
      }),
    );
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: expect.stringContaining(
          'Email preparation failed 5 times before provider start',
        ),
      }),
    );
  });

  it('does not fail a delivered email when message-history persistence fails', async () => {
    const { service, enrollmentRepository, persistSentMessage, send } = setup();

    persistSentMessage.mockRejectedValueOnce(
      new Error('message history database unavailable'),
    );

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    expect(persistSentMessage).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sentEmailsByStepId: expect.objectContaining({
          [stepId]: expect.objectContaining({
            headerMessageId: 'header-message-id',
          }),
        }),
      }),
    );
    expect(enrollmentRepository.update.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        expect.anything(),
        expect.objectContaining({
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        }),
      ]),
    );
  });

  it('bounds delivered-email attribution retries and releases the mailbox lock', async () => {
    jest.useFakeTimers();

    const { service, enrollmentRepository, releaseSendLock } = setup();
    const attributionError = new Error('attribution database unavailable');

    enrollmentRepository.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 1 })
      .mockRejectedValue(attributionError);

    const processPromise = service.process({ workspaceId, enrollmentId });
    const rejectionExpectation =
      expect(processPromise).rejects.toBe(attributionError);

    await jest.advanceTimersByTimeAsync(20_000);
    await rejectionExpectation;

    expect(enrollmentRepository.update).toHaveBeenCalledTimes(8);
    expect(enrollmentRepository.update.mock.calls[2][1]).toEqual({
      lastSendAttempt: expect.objectContaining({
        deliveredEmail: expect.objectContaining({
          stepPosition: step.position,
          metadata: expect.objectContaining({
            headerMessageId: 'header-message-id',
          }),
        }),
      }),
    });
    expect(releaseSendLock).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: 'connected-account-id',
      token: 'mailbox-lock-token',
    });
  });

  it('recovers a checkpointed provider delivery before the live lease expires', async () => {
    const sentEmailMetadata = {
      headerMessageId: 'checkpointed-header-message-id',
      threadExternalId: 'checkpointed-thread-external-id',
      sentAt: '2026-08-17T10:00:00.000Z',
      connectedAccountId: 'connected-account-id',
    };
    const currentEnrollment = {
      ...enrollment,
      currentStepId: stepId,
      nextActionAt: new Date(Date.now() + 10 * 60 * 1000),
      lastSendAttempt: {
        stepId,
        attemptedAt: new Date().toISOString(),
        providerStartedAt: new Date().toISOString(),
        previousCursor: {
          currentStepId: enrollment.currentStepId,
          currentStepPosition: enrollment.currentStepPosition,
          waitingOn: enrollment.waitingOn,
          nextActionAt: enrollment.nextActionAt?.toISOString() ?? null,
          stopOnReply: enrollment.stopOnReply,
        },
        deliveredEmail: {
          stepPosition: step.position,
          metadata: sentEmailMetadata,
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        currentStepId: stepId,
      }),
      expect.objectContaining({
        currentStepPosition: step.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        sentEmailsByStepId: {
          [stepId]: sentEmailMetadata,
        },
      }),
    );
    expect(enrollmentRepository.update.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        expect.anything(),
        expect.objectContaining({
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        }),
      ]),
    );
  });

  it('checkpoints delivery against a heartbeat-renewed send attempt', async () => {
    const providerStartedAt = new Date('2026-08-17T10:00:00.000Z');
    const heartbeatAttempt = {
      stepId,
      attemptedAt: '2026-08-17T10:01:00.000Z',
      providerStartedAt: providerStartedAt.toISOString(),
      previousCursor: {
        currentStepId: enrollment.currentStepId,
        currentStepPosition: enrollment.currentStepPosition,
        waitingOn: enrollment.waitingOn,
        nextActionAt: enrollment.nextActionAt?.toISOString() ?? null,
        stopOnReply: enrollment.stopOnReply,
      },
    };

    jest.useFakeTimers({ now: providerStartedAt });

    const { service, enrollmentRepository } = setup();

    enrollmentRepository.findOne
      .mockResolvedValueOnce(enrollment)
      .mockResolvedValueOnce(enrollment)
      .mockResolvedValueOnce({
        ...enrollment,
        currentStepId: stepId,
        lastSendAttempt: heartbeatAttempt,
      })
      .mockResolvedValue(enrollment);
    enrollmentRepository.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 1 });

    await service.process({ workspaceId, enrollmentId });

    const [heartbeatCheckpointCriteria, heartbeatCheckpointValues] =
      enrollmentRepository.update.mock.calls[3];

    expect(heartbeatCheckpointCriteria.lastSendAttempt.value).toEqual(
      heartbeatAttempt,
    );
    expect(heartbeatCheckpointValues.lastSendAttempt).toEqual(
      expect.objectContaining({
        attemptedAt: heartbeatAttempt.attemptedAt,
        deliveredEmail: expect.objectContaining({
          stepPosition: step.position,
          metadata: expect.objectContaining({
            headerMessageId: 'header-message-id',
          }),
        }),
      }),
    );
  });

  it('continues the claimed provider send when the cache watermark write fails', async () => {
    const {
      service,
      enrollmentRepository,
      send,
      setLastSendAt,
      releaseUtcDailySendReservation,
    } = setup();

    setLastSendAt.mockRejectedValueOnce(new Error('redis unavailable'));

    await service.process({ workspaceId, enrollmentId });

    expect(send).toHaveBeenCalledTimes(1);
    expect(releaseUtcDailySendReservation).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(4);
    expect(enrollmentRepository.update.mock.calls[3][1]).toEqual(
      expect.objectContaining({
        sentEmailsByStepId: expect.objectContaining({
          [stepId]: expect.objectContaining({
            headerMessageId: 'header-message-id',
          }),
        }),
      }),
    );
  });

  it('reschedules against the actual mailbox send floor', async () => {
    const lastSendAt = new Date();
    const {
      service,
      enrollmentRepository,
      send,
      getLastSendAt,
      reserveUtcDailySend,
    } = setup({
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          staggerMinutes: 5,
        },
      },
    });

    getLastSendAt.mockResolvedValue(lastSendAt);

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(reserveUtcDailySend).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      }),
      {
        nextActionAt: new Date(lastSendAt.getTime() + 5 * 60 * 1000),
      },
    );
  });

  it.each([
    {
      label: 'a future delay',
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
      nextActionAt: new Date(Date.now() + 20_000),
    },
    {
      label: 'task completion',
      waitingOn: SEQUENCE_WAITING_ON.TASK_DONE,
      nextActionAt: null,
    },
  ])('ignores a stale job while waiting on $label', async (waitingState) => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: waitingState.waitingOn,
        nextActionAt: waitingState.nextActionAt,
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('does not send a due email until the scheduler authorizes it', async () => {
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('reschedules a recipient-mode email outside the receiver local window', async () => {
    const recipientNow = new Date('2024-01-01T16:00:00.000Z');

    jest.useFakeTimers({ now: recipientNow });

    const { service, enrollmentRepository, send, acquireSendLock } = setup({
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          activeDays: [1],
          windowStart: '09:00',
          windowEnd: '17:00',
          emailWindowStart: '09:00',
          emailWindowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
      },
      person: buildPerson(false, 'America/Los_Angeles'),
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(acquireSendLock).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      }),
      {
        nextActionAt: new Date('2024-01-01T17:00:00.000Z'),
      },
    );
  });

  it('uses UTC as the executor fallback when the recipient timezone is unknown', async () => {
    const recipientNow = new Date('2024-01-01T16:00:00.000Z');

    jest.useFakeTimers({ now: recipientNow });

    const { service, send, reserveUtcDailySend } = setup({
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          activeDays: [1],
          windowStart: '09:00',
          windowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
      },
      person: buildPerson(false, null),
    });

    await service.process({ workspaceId, enrollmentId });

    expect(reserveUtcDailySend).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('creates the task and advances the enrollment in one transaction', async () => {
    const taskStep = {
      id: 'task-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: SEQUENCE_TASK_TYPES.TODO,
        titleTemplate: 'Follow up',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'IMMEDIATE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, createTask, transactionManager } =
      setup({
        currentEnrollment: {
          ...enrollment,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
        },
        steps: [taskStep],
      });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        currentStepPosition: -1,
      }),
      expect.objectContaining({
        currentStepId: taskStep.id,
        currentStepPosition: taskStep.position,
      }),
      transactionManager,
    );
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        step: taskStep,
        entityManager: transactionManager,
      }),
    );
  });

  it('turns a manual email step into a sequence task', async () => {
    const manualEmailStep = {
      ...step,
      settings: {
        ...step.settings,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        manualTaskTitle: 'Write a personal note to {{ fullName }}',
        manualTaskDescription: 'Use the research in the contact record.',
      },
    } as SequenceStepWorkspaceEntity;
    const { service, createTask, send } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [manualEmailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          taskType: SEQUENCE_TASK_TYPES.EMAIL,
          titleTemplate: 'Write a personal note to {{ fullName }}',
          notesTemplate: 'Use the research in the contact record.',
          continueMode: 'ON_DONE',
        }),
      }),
    );
  });

  it('does not surface a manual email task before the recipient local window', async () => {
    const now = new Date('2024-01-01T10:00:00.000Z');

    jest.useFakeTimers({ now });

    const manualEmailStep = {
      ...step,
      settings: {
        ...step.settings,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
      },
    } as SequenceStepWorkspaceEntity;
    const { createTask, enrollmentRepository, service } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          activeDays: [1],
          windowStart: '09:00',
          windowEnd: '17:00',
          emailWindowStart: '09:00',
          emailWindowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
      },
      person: buildPerson(false, 'America/Los_Angeles'),
      steps: [manualEmailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      { nextActionAt: new Date('2024-01-01T17:00:00.000Z') },
    );
  });

  it('surfaces a manual email task inside the recipient window while Helsinki is closed', async () => {
    jest.useFakeTimers({ now: new Date('2024-01-01T18:00:00.000Z') });

    const manualEmailStep = {
      ...step,
      settings: {
        ...step.settings,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
      },
    } as SequenceStepWorkspaceEntity;
    const { createTask, service } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          activeDays: [1],
          windowStart: '09:00',
          windowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
      },
      person: buildPerson(false, 'America/Los_Angeles'),
      steps: [manualEmailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          taskType: SEQUENCE_TASK_TYPES.EMAIL,
        }),
      }),
    );
  });

  it('puts the configured email draft into the default manual task', async () => {
    const manualEmailStep = {
      ...step,
      settings: {
        ...step.settings,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        manualTaskTitle: '',
        manualTaskDescription: '',
      },
    } as SequenceStepWorkspaceEntity;
    const { service, createTask, send } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [manualEmailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          taskType: SEQUENCE_TASK_TYPES.EMAIL,
          titleTemplate: 'Send email to {{ fullName }}',
          notesTemplate:
            'Recipient: {{ email }}\n\nSubject: Hello {{firstName}}\n\nDraft:\n<p>Hello {{firstName}}</p>',
        }),
      }),
    );
  });

  it('renders spintax before putting a draft into a manual email task', async () => {
    const manualEmailStep = {
      ...step,
      settings: {
        ...step.settings,
        subject: '{Hi|Hello} {{firstName}}',
        bodyHtml: '<p>{Quick|Short} note for {{firstName}}</p>',
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        manualTaskTitle: '',
        manualTaskDescription: '',
      },
    } as SequenceStepWorkspaceEntity;
    const { service, createTask, send } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [manualEmailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    const notesTemplate = createTask.mock.calls[0][0].settings.notesTemplate;

    expect(notesTemplate).toMatch(
      /^Recipient: \{\{ email \}\}\n\nSubject: (Hi|Hello) \{\{firstName\}\}\n\nDraft:\n<p>(Quick|Short) note for \{\{firstName\}\}<\/p>$/,
    );
    expect(notesTemplate).not.toContain('|');
  });

  it('does not create a manual email task for an opted-out person', async () => {
    const manualEmailStep = {
      ...step,
      settings: {
        ...step.settings,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, createTask, enrollmentRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person: buildPerson(true),
      steps: [manualEmailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: SEQUENCE_EXECUTION_ERROR.EMAIL_OPT_OUT,
      }),
    );
  });

  it('advances a condition so its branch can be evaluated next', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.HAS_EMAIL_ADDRESS,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, enqueueProcess } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [conditionStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: expect.any(Date),
      }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId,
    });
  });

  it('executes only the branch selected by the contact condition', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CONDITION,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.HAS_PHONE_NUMBER,
      },
    } as SequenceStepWorkspaceEntity;
    const yesStep = {
      id: 'yes-step-id',
      sequenceId: sequence.id,
      position: 1,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'Phone available',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const noStep = {
      ...yesStep,
      id: 'no-step-id',
      position: 2,
      settings: {
        ...yesStep.settings,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.NO,
        },
        titleTemplate: 'Phone missing',
      },
    } as SequenceStepWorkspaceEntity;
    const whitespacePhonePerson = {
      ...buildPerson(),
      phones: {
        ...buildPerson().phones,
        primaryPhoneNumber: '   ',
      },
    } as PersonWorkspaceEntity;
    const { service, createTask } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person: whitespacePhonePerson,
      steps: [conditionStep, yesStep, noStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        step: noStep,
        settings: expect.objectContaining({
          titleTemplate: 'Phone missing',
        }),
      }),
    );
    expect(createTask).not.toHaveBeenCalledWith(
      expect.objectContaining({ step: yesStep }),
    );
  });

  it('accepts a valid LinkedIn profile URL with a percent-encoded symbol', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CONDITION,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.HAS_LINKEDIN_URL,
      },
    } as SequenceStepWorkspaceEntity;
    const yesStep = {
      id: 'yes-step-id',
      sequenceId: sequence.id,
      position: 1,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'LinkedIn profile available',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const noStep = {
      ...yesStep,
      id: 'no-step-id',
      position: 2,
      settings: {
        ...yesStep.settings,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.NO,
        },
        titleTemplate: 'LinkedIn profile missing',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl:
          'https://linkedin.com/in/rebecca-dawson-lamond-phd-cmpp%E2%84%A2-224259162',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, createTask } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [conditionStep, yesStep, noStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        step: yesStep,
        settings: expect.objectContaining({
          titleTemplate: 'LinkedIn profile available',
        }),
      }),
    );
    expect(createTask).not.toHaveBeenCalledWith(
      expect.objectContaining({ step: noStep }),
    );
  });

  it('sends an automated email that a condition branch selects', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CONDITION,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.HAS_EMAIL_ADDRESS,
      },
    } as SequenceStepWorkspaceEntity;
    const branchEmailStep = {
      id: 'branch-email-step-id',
      sequenceId: sequence.id,
      position: 1,
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      settings: {
        ...step.settings,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
      },
    } as SequenceStepWorkspaceEntity;
    // The scheduler resolves the next step without a condition outcome, so it
    // can never recognise this enrollment as due for email. The executor has to
    // claim the send slot itself or the branch is never reached.
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [conditionStep, branchEmailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        currentStepId: conditionStep.id,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('hands back a branch send slot when the condition outcome flips', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CONDITION,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.HAS_PHONE_NUMBER,
      },
    } as SequenceStepWorkspaceEntity;
    const yesEmailStep = {
      id: 'yes-email-step-id',
      sequenceId: sequence.id,
      position: 1,
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      settings: {
        ...step.settings,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
      },
    } as SequenceStepWorkspaceEntity;
    const noTaskStep = {
      id: 'no-task-step-id',
      sequenceId: sequence.id,
      position: 2,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.NO,
        },
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'Find a number',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    // The slot was claimed while the contact still had a phone number; the
    // number is gone by the time the send is retried.
    const { service, enrollmentRepository, send, createTask, enqueueProcess } =
      setup({
        currentEnrollment: {
          ...enrollment,
          currentStepId: conditionStep.id,
          currentStepPosition: conditionStep.position,
          waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        },
        steps: [conditionStep, yesEmailStep, noTaskStep],
      });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
        currentStepId: conditionStep.id,
      }),
      expect.objectContaining({ waitingOn: SEQUENCE_WAITING_ON.DELAY }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({ workspaceId, enrollmentId });
  });

  it('leaves an unresolvable email cursor to the scheduler', async () => {
    const delayStep = {
      id: 'delay-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.DELAY,
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 0,
        hours: 0,
        minutes: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const emailStep = {
      ...step,
      position: 1,
    } as SequenceStepWorkspaceEntity;
    // This cursor is resolvable, so the scheduler still owns the pacing for it.
    const { service, enrollmentRepository, send } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: delayStep.id,
        currentStepPosition: delayStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [delayStep, emailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('starts an elapsed-time delay even when the fixed execution window is closed', async () => {
    const now = new Date('2026-07-20T03:00:00.000Z');

    jest.useFakeTimers({ now });

    const delayStep = {
      id: 'elapsed-delay-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.DELAY,
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 0,
        hours: 1,
        minutes: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const { enrollmentRepository, service } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          activeDays: [1],
          windowStart: '09:00',
          windowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
      },
      person: buildPerson(false, 'America/Los_Angeles'),
      steps: [delayStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        currentStepId: delayStep.id,
        nextActionAt: new Date('2026-07-20T04:00:00.000Z'),
      }),
    );
  });

  it('continues past a task step whose deadline elapsed', async () => {
    const taskStep = {
      id: 'task-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: SEQUENCE_TASK_TYPES.CALL,
        titleTemplate: 'Call {{ fullName }}',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DEADLINE',
        deadlineDays: 1,
      },
    } as SequenceStepWorkspaceEntity;
    const nextDelayStep = {
      id: 'delay-step-id',
      sequenceId: sequence.id,
      position: 1,
      type: SEQUENCE_STEP_TYPES.DELAY,
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 1,
        hours: 0,
        minutes: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, enqueueProcess } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: taskStep.id,
        currentStepPosition: taskStep.position,
        waitingOn: SEQUENCE_WAITING_ON.TASK_DEADLINE,
      },
      steps: [taskStep, nextDelayStep],
    });

    await service.process({ workspaceId, enrollmentId });

    // Every step claim below expects the neutral DELAY wait, so the elapsed
    // deadline has to be normalised before the next step is attempted.
    expect(enrollmentRepository.update).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.TASK_DEADLINE,
        currentStepId: taskStep.id,
      }),
      expect.objectContaining({ waitingOn: SEQUENCE_WAITING_ON.DELAY }),
    );
    expect(enqueueProcess).toHaveBeenCalledWith({
      workspaceId,
      enrollmentId,
    });
  });

  it('scopes LinkedIn read and reply conditions to the sender and recipient thread', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CONDITION,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.OPENED_LINKEDIN_MESSAGE,
      },
    } as SequenceStepWorkspaceEntity;
    const yesStep = {
      id: 'yes-step-id',
      sequenceId: sequence.id,
      position: 1,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'LinkedIn activity received',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const {
      service,
      createTask,
      linkedinMessageRepository,
      linkedinThreadParticipantRepository,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [conditionStep, yesStep],
      latestLinkedinAction: {
        type: 'SEND_MESSAGE',
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        executedAt: new Date('2026-07-20T08:00:00.000Z'),
      } as LinkedinActionWorkspaceEntity,
    });

    linkedinThreadParticipantRepository.find.mockResolvedValue([
      {
        linkedinUrn: 'recipient-linkedin-urn',
        threadId: 'thread-id',
      },
    ]);
    linkedinMessageRepository.count.mockResolvedValue(1);

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinThreadParticipantRepository.find).toHaveBeenCalledWith({
      where: {
        personId: enrollment.personId,
        isSelf: false,
        ownerWorkspaceMemberId: 'owner-workspace-member-id',
      },
      select: ['linkedinUrn', 'threadId'],
    });
    expect(linkedinMessageRepository.count).toHaveBeenCalledWith({
      where: [
        {
          direction: 'OUTBOUND',
          ownerWorkspaceMemberId: 'owner-workspace-member-id',
          threadId: expect.anything(),
          deliveredAt: expect.anything(),
          recipientReadAt: expect.anything(),
        },
        {
          direction: 'INBOUND',
          ownerWorkspaceMemberId: 'owner-workspace-member-id',
          senderLinkedinUrn: 'recipient-linkedin-urn',
          threadId: 'thread-id',
          deliveredAt: expect.anything(),
        },
      ],
    });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ step: yesStep }),
    );
  });

  it('does not treat a LinkedIn reply from before this enrollment as activity', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.OPENED_LINKEDIN_MESSAGE,
      },
    } as SequenceStepWorkspaceEntity;
    const yesStep = {
      id: 'yes-step-id',
      sequenceId: sequence.id,
      position: 1,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'Reply received',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const {
      service,
      createTask,
      linkedinMessageRepository,
      linkedinThreadParticipantRepository,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [conditionStep, yesStep],
    });

    linkedinThreadParticipantRepository.find.mockResolvedValue([
      { linkedinUrn: 'old-sender-urn', threadId: 'old-thread-id' },
    ]);
    linkedinMessageRepository.count.mockResolvedValue(1);

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinThreadParticipantRepository.find).not.toHaveBeenCalled();
    expect(linkedinMessageRepository.count).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it('does not treat a withdrawn invitation as an accepted invitation', async () => {
    const conditionStep = {
      id: 'condition-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.ACCEPTED_LINKEDIN_INVITE,
      },
    } as SequenceStepWorkspaceEntity;
    const yesStep = {
      id: 'yes-step-id',
      sequenceId: sequence.id,
      position: 1,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'Invite accepted',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, createTask } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: conditionStep.id,
        currentStepPosition: conditionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [conditionStep, yesStep],
      connectionCount: 1,
      sentInvitationCount: 1,
      latestLinkedinAction: {
        type: 'WITHDRAW_CONNECTION_REQUEST',
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        executedAt: new Date('2026-07-19T08:00:00.000Z'),
      } as LinkedinActionWorkspaceEntity,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).not.toHaveBeenCalled();
  });

  it('enriches a missing phone number through Apollo before continuing', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      phones: {
        ...buildPerson().phones,
        primaryPhoneNumber: '   ',
      },
    } as PersonWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson, personRepository } =
      setup({
        currentEnrollment: {
          ...enrollment,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
        },
        person,
        steps: [enrichStep],
      });

    personRepository.findOne
      .mockResolvedValueOnce(person)
      .mockResolvedValueOnce(person)
      .mockResolvedValueOnce(person)
      .mockResolvedValueOnce({
        ...person,
        phones: {
          ...person.phones,
          primaryPhoneNumber: '+358401234567',
        },
      });

    await service.process({ workspaceId, enrollmentId });

    expect(enrichPerson).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        personId: person.id,
        mode: 'phone',
        onProviderStart: expect.any(Function),
      }),
    );
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: person.id,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      expect.anything(),
    );
  });

  it('waits for an Apollo callback when phone enrichment is pending', async () => {
    const now = new Date('2026-08-19T10:00:00.000Z');

    jest.useFakeTimers({ now });

    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const currentEnrollment = {
      ...enrollment,
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
    } as SequenceEnrollmentWorkspaceEntity;
    const pendingEnrollment = {
      ...currentEnrollment,
      currentStepId: enrichStep.id,
      currentStepPosition: enrichStep.position,
      waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      nextActionAt: new Date(
        now.getTime() + SEQUENCE_APOLLO_ENRICHMENT_TIMEOUT_MILLISECONDS,
      ),
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson, enqueueProcess } =
      setup({
        currentEnrollment,
        steps: [enrichStep],
      });

    enrollmentRepository.findOne
      .mockResolvedValueOnce(currentEnrollment)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pendingEnrollment);
    enrichPerson.mockImplementation(async ({ onProviderStart }) => {
      await onProviderStart?.();

      return 'pending';
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        currentStepPosition: currentEnrollment.currentStepPosition,
      }),
      {
        currentStepId: enrichStep.id,
        currentStepPosition: enrichStep.position,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
        nextActionAt: new Date(
          now.getTime() + SEQUENCE_APOLLO_ENRICHMENT_CLAIM_LEASE_MILLISECONDS,
        ),
      },
      expect.anything(),
    );
    expect(enrollmentRepository.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
        nextActionAt: pendingEnrollment.nextActionAt,
      }),
      expect.anything(),
    );
    expect(enrichPerson).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
      }),
    );
    expect(enqueueProcess).not.toHaveBeenCalled();
  });

  it('continues a pending Apollo step when the phone is later present', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const currentEnrollment = {
      ...enrollment,
      currentStepId: enrichStep.id,
      currentStepPosition: enrichStep.position,
      waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
    } as SequenceEnrollmentWorkspaceEntity;
    const person = {
      ...buildPerson(),
      phones: {
        ...buildPerson().phones,
        primaryPhoneNumber: '+358401234567',
      },
    } as PersonWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment,
      person,
      steps: [enrichStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrichPerson).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        currentStepId: enrichStep.id,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      }),
      expect.objectContaining({
        currentStepId: enrichStep.id,
        currentStepPosition: enrichStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
    );
  });

  it('times out a lost Apollo callback without charging again', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const currentEnrollment = {
      ...enrollment,
      currentStepId: enrichStep.id,
      currentStepPosition: enrichStep.position,
      waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment,
      steps: [enrichStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrichPerson).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: SEQUENCE_EXECUTION_ERROR.PHONE_ENRICHMENT_NOT_FOUND,
      }),
      expect.anything(),
    );
  });

  it('advances instead of failing when the Apollo webhook commits a phone at timeout', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const currentEnrollment = {
      ...enrollment,
      currentStepId: enrichStep.id,
      currentStepPosition: enrichStep.position,
      waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
    } as SequenceEnrollmentWorkspaceEntity;
    const personWithoutPhone = buildPerson();
    const personWithPhone = {
      ...personWithoutPhone,
      phones: {
        ...personWithoutPhone.phones,
        primaryPhoneNumber: '+358401234567',
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      personRepository,
      enrichPerson,
      transactionManager,
    } = setup({
      currentEnrollment,
      person: personWithoutPhone,
      steps: [enrichStep],
    });

    personRepository.findOne
      .mockResolvedValueOnce(personWithoutPhone)
      .mockResolvedValueOnce(personWithPhone);

    await service.process({ workspaceId, enrollmentId });

    expect(enrichPerson).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: expect.any(Date),
      }),
      transactionManager,
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
      }),
      expect.anything(),
    );
  });

  it('does not call Apollo when another worker already claimed the step', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [enrichStep],
    });

    enrollmentRepository.update.mockResolvedValueOnce({ affected: 0 });

    await service.process({ workspaceId, enrollmentId });

    expect(enrichPerson).not.toHaveBeenCalled();
  });

  it('joins a live person-level Apollo claim instead of buying a second reveal', async () => {
    const now = new Date('2026-08-19T10:00:00.000Z');

    jest.useFakeTimers({ now });

    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const existingRequestExpiresAt = new Date(
      now.getTime() + SEQUENCE_APOLLO_ENRICHMENT_CLAIM_LEASE_MILLISECONDS,
    );
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      existingApolloEnrollment: {
        ...enrollment,
        id: 'other-enrollment-id',
        currentStepId: 'other-enrich-step-id',
        currentStepPosition: 3,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
        nextActionAt: existingRequestExpiresAt,
      },
      steps: [enrichStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrichPerson).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_JOINED,
        nextActionAt: existingRequestExpiresAt,
      }),
      expect.anything(),
    );
  });

  it('joins a provider-started Apollo cohort using its existing callback deadline', async () => {
    const now = new Date('2026-08-19T10:00:00.000Z');

    jest.useFakeTimers({ now });

    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const callbackDeadline = new Date(
      now.getTime() + SEQUENCE_APOLLO_ENRICHMENT_TIMEOUT_MILLISECONDS,
    );
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      existingApolloEnrollment: {
        ...enrollment,
        id: 'other-enrollment-id',
        currentStepId: 'other-enrich-step-id',
        currentStepPosition: 3,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
        nextActionAt: callbackDeadline,
      },
      steps: [enrichStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrichPerson).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
        nextActionAt: callbackDeadline,
      }),
      expect.anything(),
    );
  });

  it('restores an expired pre-provider Apollo claim without another charge', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const expiredAt = new Date('2026-08-19T09:00:00.000Z');
    const currentEnrollment = {
      ...enrollment,
      currentStepId: enrichStep.id,
      currentStepPosition: enrichStep.position,
      waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
      nextActionAt: expiredAt,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment,
      steps: [enrichStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrichPerson).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: expect.any(Date),
      }),
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
      }),
    );
  });

  it('rejects an Apollo owner whose provider-start callback arrives after its claim expires', async () => {
    const now = new Date('2026-08-19T10:00:00.000Z');

    jest.useFakeTimers({ now });

    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [enrichStep],
    });
    let providerCallReached = false;

    enrichPerson.mockImplementation(async ({ onProviderStart }) => {
      jest.setSystemTime(
        new Date(
          now.getTime() + SEQUENCE_APOLLO_ENRICHMENT_CLAIM_LEASE_MILLISECONDS,
        ),
      );
      await onProviderStart?.();
      providerCallReached = true;

      return 'pending';
    });

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).resolves.toBeUndefined();

    expect(providerCallReached).toBe(false);
    expect(
      enrollmentRepository.update.mock.calls.some(
        ([, values]) =>
          values.waitingOn === SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      ),
    ).toBe(false);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'person-id',
        waitingOn: expect.anything(),
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      expect.anything(),
    );
  });

  it('keeps waiting without a second charge when the Apollo request throws ambiguously', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const currentEnrollment = {
      ...enrollment,
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
    } as SequenceEnrollmentWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment,
      steps: [enrichStep],
    });

    enrichPerson.mockImplementation(async ({ onProviderStart }) => {
      await onProviderStart?.();

      throw new Error('Apollo request failed');
    });

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).resolves.toBeUndefined();
    expect(enrichPerson).toHaveBeenCalledTimes(1);
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      expect.objectContaining({
        currentStepId: enrichStep.id,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT_CLAIMED,
        nextActionAt: expect.any(Date),
      }),
      expect.anything(),
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
      }),
    );
  });

  it('restores an Apollo cohort when the global lease fails before HTTP starts', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [enrichStep],
    });

    enrichPerson.mockImplementation(async ({ onProviderStart }) => {
      await onProviderStart?.();

      throw new ApolloEnrichmentProviderNotStartedError(
        'Apollo request lease could not be renewed',
      );
    });

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).resolves.toBeUndefined();

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'person-id',
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: expect.any(Date),
      }),
      expect.anything(),
    );
  });

  it.each([
    { retryable: false, statusCode: 401, expectedStatus: 'FAILED' },
    { retryable: true, statusCode: 429, expectedStatus: 'ACTIVE' },
  ])(
    'resolves a definitive Apollo $statusCode rejection without a 24-hour wait',
    async ({ expectedStatus, retryable, statusCode }) => {
      const enrichStep = {
        id: 'enrich-step-id',
        sequenceId: sequence.id,
        position: 0,
        settings: {
          type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
          executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
        },
      } as SequenceStepWorkspaceEntity;
      const { service, enrollmentRepository, enrichPerson } = setup({
        currentEnrollment: {
          ...enrollment,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
        },
        steps: [enrichStep],
      });

      enrichPerson.mockImplementation(async ({ onProviderStart }) => {
        await onProviderStart?.();

        throw new ApolloEnrichmentProviderRejectedError(
          `Apollo API request failed with status ${statusCode}`,
          retryable,
          statusCode,
        );
      });

      await expect(
        service.process({ workspaceId, enrollmentId }),
      ).resolves.toBeUndefined();

      expect(enrollmentRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          personId: 'person-id',
          waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
        }),
        expect.objectContaining(
          expectedStatus === 'FAILED'
            ? {
                status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
                waitingOn: null,
                nextActionAt: null,
              }
            : {
                waitingOn: SEQUENCE_WAITING_ON.DELAY,
                nextActionAt: expect.any(Date),
              },
        ),
        expect.anything(),
      );
    },
  );

  it('retries Apollo enrichment when the person identity changes during the request', async () => {
    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, enrichPerson } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [enrichStep],
    });

    enrichPerson.mockImplementation(async ({ onProviderStart }) => {
      await onProviderStart?.();

      return 'identity-changed';
    });

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).resolves.toBeUndefined();

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: 'person-id',
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: expect.any(Date),
      }),
      expect.anything(),
    );
    expect(enrollmentRepository.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
      }),
      expect.anything(),
    );
  });

  it('propagates a transient task persistence failure for a queue retry', async () => {
    const taskStep = {
      id: 'task-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.CREATE_TASK,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: SEQUENCE_TASK_TYPES.TODO,
        titleTemplate: 'Follow up',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'IMMEDIATE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, createTask } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [taskStep],
    });

    const taskInsertError = new Error('task insert failed');

    createTask.mockRejectedValue(taskInsertError);

    await expect(service.process({ workspaceId, enrollmentId })).rejects.toBe(
      taskInsertError,
    );

    expect(enrollmentRepository.update.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        expect.anything(),
        expect.objectContaining({
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        }),
      ]),
    );
  });

  it('fails a connection request when the person has no LinkedIn URL', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: 'Hi {{ firstName }}',
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, linkedinActionRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [connectionStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_LINKEDIN_URL,
      }),
    );
  });

  it('fails a LinkedIn action before queueing when the stored profile URL is invalid', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://example.com/ada-lovelace',
        primaryLinkLabel: 'Not LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, enrollmentRepository, linkedinActionRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: SEQUENCE_EXECUTION_ERROR.MISSING_LINKEDIN_URL,
      }),
    );
  });

  it('fails a LinkedIn action when its sender account was archived after activation', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      getSenderAccountOrThrow,
      linkedinActionRepository,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
    });

    getSenderAccountOrThrow.mockRejectedValue(
      new SequenceSenderUnavailableError(
        'Choose an active sender mailbox that belongs to your workspace account',
      ),
    );

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage:
          'Choose an active sender mailbox that belongs to your workspace account',
      }),
    );
  });

  it('propagates a transient LinkedIn sender lookup failure for a queue retry', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      getSenderAccountOrThrow,
      linkedinActionRepository,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
    });
    const databaseError = new Error('connected account database unavailable');

    getSenderAccountOrThrow.mockRejectedValue(databaseError);

    await expect(service.process({ workspaceId, enrollmentId })).rejects.toBe(
      databaseError,
    );

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        expect.anything(),
        expect.objectContaining({
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        }),
      ]),
    );
  });

  it('propagates a transient LinkedIn quota failure for a queue retry', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      reserveSlot,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
    });
    const redisError = new Error('LinkedIn quota store unavailable');

    reserveSlot.mockRejectedValue(redisError);

    await expect(service.process({ workspaceId, enrollmentId })).rejects.toBe(
      redisError,
    );

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update.mock.calls).not.toContainEqual(
      expect.arrayContaining([
        expect.anything(),
        expect.objectContaining({
          status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        }),
      ]),
    );
  });

  it('uses the exact current step id when claiming a tied-position next step', async () => {
    const currentStep = {
      id: 'current-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.DELAY,
        days: 0,
        hours: 0,
        minutes: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const tiedTaskStep = {
      id: 'tied-task-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: SEQUENCE_TASK_TYPES.TODO,
        titleTemplate: 'Review {{ fullName }}',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const { service, enrollmentRepository, transactionManager } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: currentStep.id,
        currentStepPosition: currentStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      steps: [currentStep, tiedTaskStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        currentStepId: currentStep.id,
        currentStepPosition: currentStep.position,
      }),
      expect.objectContaining({ currentStepId: tiedTaskStep.id }),
      transactionManager,
    );
  });

  it('uses a runner-observed connection before connector sync for a manual message', async () => {
    const messageStep = {
      id: 'manual-message-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        messageTemplate: 'Hello {{ firstName }}',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, createTask } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [messageStep],
      observedConnectedActionCount: 1,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          taskType: SEQUENCE_TASK_TYPES.LINKEDIN_MESSAGE,
          titleTemplate: 'Send LinkedIn message to {{ fullName }}',
          notesTemplate:
            'LinkedIn profile: {{ linkedinUrl }}\n\nMessage:\nHello {{ firstName }}',
          continueMode: 'ON_DONE',
        }),
      }),
    );
  });

  it('preserves the configured timing on a manual withdrawal task', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T09:00:00.000Z'));
    const withdrawStep = {
      id: 'manual-withdraw-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
        withdrawAfterDays: 1,
        withdrawAfterHours: 12,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, createTask } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [withdrawStep],
      sentInvitationCount: 1,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        dueAt: new Date('2026-07-21T21:00:00.000Z'),
        settings: expect.objectContaining({ deadlineDays: 1.5 }),
      }),
    );

    jest.useRealTimers();
  });

  it('renders and schedules a direct LinkedIn message', async () => {
    const messageStep = {
      id: 'message-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
        messageTemplate: 'Hi {{ firstName }}, thanks for connecting.',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository, transactionManager } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [messageStep],
      connectionCount: 1,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SEND_MESSAGE',
        linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        noteText: 'Hi Ada, thanks for connecting.',
        ownerWorkspaceMemberId: 'owner-workspace-member-id',
      }),
      transactionManager,
    );
  });

  it('fails a LinkedIn message step instead of queueing an unsendable action', async () => {
    const messageStep = {
      id: 'message-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
        messageTemplate: 'Hi {{ firstName }}, thanks for connecting.',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      linkedinActionRepository,
      linkedinConnectionRepository,
      enrollmentRepository,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [messageStep],
      connectionCount: 0,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(linkedinConnectionRepository.count).toHaveBeenCalledWith({
      where: [
        expect.objectContaining({ personId: person.id }),
        expect.objectContaining({
          ownerWorkspaceMemberId: 'owner-workspace-member-id',
          handle: expect.anything(),
        }),
      ],
    });
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: SEQUENCE_ENROLLMENT_STATUSES.FAILED,
        errorMessage: 'LINKEDIN_NOT_CONNECTED',
      }),
    );
  });

  it('skips a connection request when an invitation is already outstanding', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: 'Hi {{ firstName }}',
        skipIfAlreadyConnected: false,
      },
    } as unknown as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository, enrollmentRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
      sentInvitationCount: 1,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentStepId: 'connection-step-id',
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      expect.anything(),
    );
  });

  it('skips a connection request when a prior request action was already completed', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: 'Hi {{ firstName }}',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository, enrollmentRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
    });

    linkedinActionRepository.findOne.mockResolvedValue({
      type: 'SEND_CONNECTION_REQUEST',
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentStepId: 'connection-step-id',
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      expect.anything(),
    );
  });

  it('allows a new request after a completed withdrawal supersedes request history', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
      sentInvitationCount: 1,
      latestLinkedinAction: {
        type: 'WITHDRAW_CONNECTION_REQUEST',
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        executedAt: new Date('2026-07-19T08:00:00.000Z'),
      } as LinkedinActionWorkspaceEntity,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SEND_CONNECTION_REQUEST' }),
      expect.anything(),
    );
  });

  it('uses the fixed Helsinki window for LinkedIn despite the recipient timezone', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-20T07:00:00.000Z') });
    const connectionStep = {
      id: 'recipient-window-connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(false, 'America/Los_Angeles'),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { reserveSlot, service } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          activeDays: [1],
          windowStart: '09:00',
          windowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
      },
      person,
      steps: [connectionStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(reserveSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          timezone: 'Europe/Helsinki',
        }),
      }),
    );
  });

  it('defers LinkedIn work when Helsinki is closed even if the recipient window is open', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-20T16:00:00.000Z') });
    const connectionStep = {
      id: 'recipient-window-deferred-connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(false, 'America/Los_Angeles'),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { enrollmentRepository, reserveSlot, service } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      currentSequence: {
        ...sequence,
        settings: {
          ...sequence.settings,
          activeDays: [1, 2],
          windowStart: '09:00',
          windowEnd: '17:00',
          timezone: 'Europe/Helsinki',
          sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        },
      },
      person,
      steps: [connectionStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(reserveSlot).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: enrollmentId }),
      { nextActionAt: new Date('2026-07-21T06:00:00.000Z') },
    );
  });

  it.each([
    LINKEDIN_ACTION_STATUSES.FAILED,
    LINKEDIN_ACTION_STATUSES.CANCELLED,
  ])(
    'allows a replacement after an invitation action becomes %s',
    async (status) => {
      const connectionStep = {
        id: 'replacement-connection-step-id',
        sequenceId: sequence.id,
        position: 0,
        settings: {
          type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
          noteTemplate: '',
        },
      } as SequenceStepWorkspaceEntity;
      const person = {
        ...buildPerson(),
        linkedinLink: {
          primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
          primaryLinkLabel: 'LinkedIn',
          secondaryLinks: null,
        },
      } as PersonWorkspaceEntity;
      const { service, linkedinActionRepository } = setup({
        currentEnrollment: {
          ...enrollment,
          waitingOn: SEQUENCE_WAITING_ON.DELAY,
        },
        person,
        steps: [connectionStep],
        latestLinkedinAction: {
          id: 'terminal-invitation-action-id',
          type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
          status,
          connectionState: LINKEDIN_CONNECTION_STATES.UNKNOWN,
          executedAt: null,
          errorMessage: 'Provider did not confirm the invitation',
        } as LinkedinActionWorkspaceEntity,
      });

      await service.process({ workspaceId, enrollmentId });

      expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          sequenceEnrollmentId: enrollment.id,
          sequenceStepId: connectionStep.id,
          status: LINKEDIN_ACTION_STATUSES.SCHEDULED,
          type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        }),
        expect.anything(),
      );
    },
  );

  it('retries the cancelled LinkedIn step after a paused sequence resumes', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const followingTaskStep = {
      id: 'following-task-step-id',
      sequenceId: sequence.id,
      position: 1,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: SEQUENCE_TASK_TYPES.TODO,
        titleTemplate: 'This must not run before the invitation',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository, createTask } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: connectionStep.id,
        currentStepPosition: connectionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep, followingTaskStep],
      latestLinkedinAction: {
        id: 'paused-action-id',
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
      } as LinkedinActionWorkspaceEntity,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).not.toHaveBeenCalled();
    expect(linkedinActionRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
    );
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'paused-action-id',
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
      }),
      {
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR,
      },
      expect.anything(),
    );
    expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        sequenceStepId: connectionStep.id,
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      }),
      expect.anything(),
    );
  });

  it('does not schedule a LinkedIn action when pause wins before the scheduling transaction', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository, sequenceRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
    });

    sequenceRepository.findOne
      .mockResolvedValueOnce(sequence)
      .mockResolvedValueOnce(null);

    await service.process({ workspaceId, enrollmentId });

    expect(sequenceRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: sequence.id,
          status: SEQUENCE_STATUSES.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      }),
      expect.anything(),
    );
    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
  });

  it('does not consume a paused retry marker when the sequence pauses before a skip commits', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      sequenceRepository,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: connectionStep.id,
        currentStepPosition: connectionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
      connectionCount: 1,
      latestLinkedinAction: {
        id: 'paused-action-id',
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
      } as LinkedinActionWorkspaceEntity,
    });

    sequenceRepository.findOne
      .mockResolvedValueOnce(sequence)
      .mockResolvedValueOnce(null);

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.update).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).not.toHaveBeenCalled();
  });

  it('consumes a paused retry atomically when the current connection step now skips', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const followingTaskStep = {
      id: 'following-task-step-id',
      sequenceId: sequence.id,
      position: 1,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        taskType: SEQUENCE_TASK_TYPES.TODO,
        titleTemplate: 'Continue after the skipped retry',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      transactionManager,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: connectionStep.id,
        currentStepPosition: connectionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep, followingTaskStep],
      connectionCount: 1,
      latestLinkedinAction: {
        id: 'paused-action-id',
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
      } as LinkedinActionWorkspaceEntity,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'paused-action-id' }),
      {
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSE_RETRY_CONSUMED_ERROR,
      },
      transactionManager,
    );
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollment.id,
        currentStepId: connectionStep.id,
      }),
      expect.objectContaining({
        currentStepId: connectionStep.id,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      transactionManager,
    );
  });

  it('allows only one worker to replace a paused LinkedIn action', async () => {
    const messageStep = {
      id: 'message-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE,
        messageTemplate: 'Hello {{ firstName }}',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository, reserveSlot } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: messageStep.id,
        currentStepPosition: messageStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [messageStep],
      connectionCount: 1,
      latestLinkedinAction: {
        id: 'paused-action-id',
        type: LINKEDIN_ACTION_TYPES.SEND_MESSAGE,
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
      } as LinkedinActionWorkspaceEntity,
    });

    linkedinActionRepository.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });

    await service.process({ workspaceId, enrollmentId });
    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).toHaveBeenCalledTimes(1);
    expect(reserveSlot).toHaveBeenCalledTimes(1);
  });

  it('keeps a paused retry marker while another invitation mutation is in flight', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');

    jest.useFakeTimers({ now });

    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      transactionManager,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        currentStepId: connectionStep.id,
        currentStepPosition: connectionStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
      sentInvitationCount: 1,
      latestLinkedinAction: {
        id: 'paused-action-id',
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.CANCELLED,
        errorMessage: SEQUENCE_LINKEDIN_ACTION_PAUSED_ERROR,
      } as LinkedinActionWorkspaceEntity,
    });
    linkedinActionRepository.count.mockImplementation(
      async ({ where }, currentTransactionManager) => {
        if (where?.connectionState === LINKEDIN_CONNECTION_STATES.CONNECTED) {
          return 0;
        }

        return currentTransactionManager === transactionManager ? 1 : 0;
      },
    );

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(linkedinActionRepository.update).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: enrollment.id,
        currentStepId: connectionStep.id,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(
          now.getTime() + SEQUENCE_SENDER_RETRY_DELAY_MILLISECONDS,
        ),
      }),
      transactionManager,
    );
    expect(
      enrollmentRepository.update.mock.calls[
        enrollmentRepository.update.mock.calls.length - 1
      ]?.[1],
    ).not.toHaveProperty('currentStepId');
  });

  it('keeps a new manual invitation outstanding when it was sent after a withdrawal', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository, enrollmentRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
      sentInvitationCount: 1,
      sentInvitationAfterLatestActionCount: 1,
      latestLinkedinAction: {
        type: 'WITHDRAW_CONNECTION_REQUEST',
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        executedAt: new Date('2026-07-19T08:00:00.000Z'),
      } as LinkedinActionWorkspaceEntity,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentStepId: connectionStep.id,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      expect.anything(),
    );
  });

  it('does not advance a connection request behind an in-flight mutation', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');

    jest.useFakeTimers({ now });

    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      personRepository,
      reserveSlot,
      transactionManager,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
      sentInvitationCount: 1,
    });

    linkedinActionRepository.count.mockImplementation(
      async ({ where }, currentTransactionManager) => {
        if (where?.connectionState === LINKEDIN_CONNECTION_STATES.CONNECTED) {
          return 0;
        }

        return currentTransactionManager === transactionManager ? 1 : 0;
      },
    );

    await service.process({ workspaceId, enrollmentId });

    expect(personRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: person.id },
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(reserveSlot).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: enrollment.id,
        currentStepPosition: enrollment.currentStepPosition,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(
          now.getTime() + SEQUENCE_SENDER_RETRY_DELAY_MILLISECONDS,
        ),
      }),
      transactionManager,
    );
    expect(
      enrollmentRepository.update.mock.calls[
        enrollmentRepository.update.mock.calls.length - 1
      ]?.[1],
    ).not.toHaveProperty('currentStepId');
  });

  it('waits when an outstanding invitation also has an in-flight withdrawal', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');

    jest.useFakeTimers({ now });

    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      personRepository,
      reserveSlot,
      transactionManager,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
      sentInvitationCount: 1,
    });

    linkedinActionRepository.count.mockImplementation(async ({ where }) => {
      if (where?.connectionState === LINKEDIN_CONNECTION_STATES.CONNECTED) {
        return 0;
      }

      const invitationTypes = (where?.type as { value?: string[] } | undefined)
        ?.value;

      return invitationTypes?.includes(
        LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      )
        ? 1
        : 0;
    });

    await service.process({ workspaceId, enrollmentId });

    expect(personRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: person.id },
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(linkedinActionRepository.count).toHaveBeenLastCalledWith(
      {
        where: expect.objectContaining({
          personId: person.id,
          ownerWorkspaceMemberId: 'owner-workspace-member-id',
          type: expect.objectContaining({
            value: [
              LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
              LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
            ],
          }),
        }),
      },
      transactionManager,
    );
    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(reserveSlot).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentStepPosition: enrollment.currentStepPosition,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(
          now.getTime() + SEQUENCE_SENDER_RETRY_DELAY_MILLISECONDS,
        ),
      }),
      transactionManager,
    );
    expect(
      enrollmentRepository.update.mock.calls[
        enrollmentRepository.update.mock.calls.length - 1
      ]?.[1],
    ).not.toHaveProperty('currentStepId');
  });

  it('deduplicates a withdrawal against an in-flight connection request under the person lock', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');

    jest.useFakeTimers({ now });

    const withdrawStep = {
      id: 'withdraw-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
        withdrawAfterDays: 0,
        withdrawAfterHours: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      enrollmentRepository,
      linkedinActionRepository,
      personRepository,
      reserveSlot,
      transactionManager,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [withdrawStep],
    });

    linkedinActionRepository.count.mockImplementation(async ({ where }) => {
      if (where?.connectionState === LINKEDIN_CONNECTION_STATES.CONNECTED) {
        return 0;
      }

      if (where?.type === LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST) {
        return 1;
      }

      const invitationTypes = (where?.type as { value?: string[] } | undefined)
        ?.value;

      return invitationTypes?.includes(
        LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      )
        ? 1
        : 0;
    });

    await service.process({ workspaceId, enrollmentId });

    expect(personRepository.findOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: person.id },
        lock: { mode: 'pessimistic_write' },
      }),
      transactionManager,
    );
    expect(linkedinActionRepository.count).toHaveBeenLastCalledWith(
      {
        where: expect.objectContaining({
          personId: person.id,
          ownerWorkspaceMemberId: 'owner-workspace-member-id',
          type: expect.objectContaining({
            value: [
              LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
              LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
            ],
          }),
        }),
      },
      transactionManager,
    );
    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(reserveSlot).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentStepPosition: enrollment.currentStepPosition,
      }),
      expect.objectContaining({
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(
          now.getTime() + SEQUENCE_SENDER_RETRY_DELAY_MILLISECONDS,
        ),
      }),
      transactionManager,
    );
    expect(
      enrollmentRepository.update.mock.calls[
        enrollmentRepository.update.mock.calls.length - 1
      ]?.[1],
    ).not.toHaveProperty('currentStepId');
  });

  it('skips a person whose synced connection state is connected', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: 'Hi {{ firstName }}',
      } as unknown as SequenceStepWorkspaceEntity['settings'],
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinConnectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository, enrollmentRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
      connectionCount: 1,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentStepId: 'connection-step-id',
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
    );
  });

  it('always skips an existing connection even when legacy settings disabled the skip', async () => {
    const connectionStep = {
      id: 'connection-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST,
        noteTemplate: '',
        skipIfAlreadyConnected: false,
      },
    } as unknown as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, enrollmentRepository, linkedinActionRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [connectionStep],
      connectionCount: 1,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentStepId: connectionStep.id,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
    );
  });

  it('skips a withdrawal when there is no outstanding invitation', async () => {
    const withdrawStep = {
      id: 'withdraw-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
        withdrawAfterDays: 7,
        withdrawAfterHours: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, enrollmentRepository, linkedinActionRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [withdrawStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentStepId: withdrawStep.id,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      expect.anything(),
    );
  });

  it('does not treat an already-connected skipped request as pending', async () => {
    const withdrawStep = {
      id: 'withdraw-step-id',
      sequenceId: sequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
        withdrawAfterDays: 0,
        withdrawAfterHours: 0,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const { service, linkedinActionRepository } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [withdrawStep],
      latestLinkedinAction: {
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.SKIPPED,
        connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
        executedAt: new Date('2026-07-20T09:00:00.000Z'),
      } as LinkedinActionWorkspaceEntity,
    });

    await service.process({ workspaceId, enrollmentId });

    expect(linkedinActionRepository.insert).not.toHaveBeenCalled();
  });

  it('floors a withdrawal slot at the configured custom delay', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T09:00:00.000Z'));
    const withdrawStep = {
      id: 'withdraw-step-id',
      sequenceId: sequence.id,
      position: 0,
      type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
      settings: {
        type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
        withdrawAfterDays: 1,
        withdrawAfterHours: 2,
      },
    } as SequenceStepWorkspaceEntity;
    const person = {
      ...buildPerson(),
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
    } as PersonWorkspaceEntity;
    const {
      service,
      reserveSlot,
      linkedinActionRepository,
      transactionManager,
    } = setup({
      currentEnrollment: {
        ...enrollment,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      },
      person,
      steps: [withdrawStep],
      sentInvitationCount: 1,
    });

    reserveSlot.mockImplementation(async ({ now }: { now: Date }) => now);

    await service.process({ workspaceId, enrollmentId });

    expect(reserveSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        now: new Date('2026-07-21T11:00:00.000Z'),
        transactionManager,
      }),
    );
    expect(linkedinActionRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
        scheduledAt: new Date('2026-07-21T11:00:00.000Z'),
      }),
      transactionManager,
    );

    jest.useRealTimers();
  });
});
