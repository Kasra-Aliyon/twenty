import {
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
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
import { type FindOperator } from 'typeorm';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { type ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { LinkedinConnectionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-connection.workspace-entity';
import { LinkedinInvitationWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-invitation.workspace-entity';
import { LinkedinMessageWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-message.workspace-entity';
import { LinkedinThreadParticipantWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-thread-participant.workspace-entity';
import { MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';
import { PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type SequenceLinkedinReplyListener } from 'src/modules/sequence/listeners/sequence-linkedin-reply.listener';
import { type SequenceEmailReplyReconciliationService } from 'src/modules/sequence/services/sequence-email-reply-reconciliation.service';
import { type SequenceEmailSenderService } from 'src/modules/sequence/services/sequence-email-sender.service';
import { SequenceExecutorService } from 'src/modules/sequence/services/sequence-executor.service';
import { type SequenceLinkedinThrottleService } from 'src/modules/sequence/services/sequence-linkedin-throttle.service';
import { type SequenceMailboxThrottleService } from 'src/modules/sequence/services/sequence-mailbox-throttle.service';
import { type SequenceQueueService } from 'src/modules/sequence/services/sequence-queue.service';
import { type SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { type SequenceTaskCreatorService } from 'src/modules/sequence/services/sequence-task-creator.service';
import { type SequenceVariableService } from 'src/modules/sequence/services/sequence-variable.service';
import {
  DEFAULT_SEQUENCE_SETTINGS,
  LINKEDIN_CONNECTION_OBSERVATION_MAX_AGE_MS,
} from 'src/modules/sequence/sequence.constants';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';

type SequenceExecutorPrivateApi = {
  hasOutstandingConnectionRequest: (input: {
    workspaceId: string;
    person: PersonWorkspaceEntity;
    ownerWorkspaceMemberId: string;
  }) => Promise<boolean>;
  isPersonConnectedToSender: (input: {
    workspaceId: string;
    person: PersonWorkspaceEntity;
    senderConnectedAccountId: string | null;
  }) => Promise<boolean>;
  wasLinkedinInvitationSent: (input: {
    workspaceId: string;
    person: PersonWorkspaceEntity;
    ownerWorkspaceMemberId: string;
  }) => Promise<boolean>;
};

describe('SequenceExecutorService safety regressions', () => {
  const workspaceId = 'workspace-id';
  const enrollmentId = 'enrollment-id';
  const connectedAccountId = 'connected-account-id';
  const ownerWorkspaceMemberId = 'owner-workspace-member-id';
  const emailStep = {
    id: 'email-step-id',
    sequenceId: 'sequence-id',
    position: 0,
    settings: {
      type: SEQUENCE_STEP_TYPES.SEND_EMAIL,
      executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      subject: 'Hello {{ firstName }}',
      bodyHtml: '<p>Hello {{ firstName }}</p>',
      threadAsReplyToPreviousEmail: false,
      stopOnReply: null,
    },
  } as SequenceStepWorkspaceEntity;
  const baseEnrollment = {
    id: enrollmentId,
    sequenceId: 'sequence-id',
    personId: 'person-id',
    status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
    currentStepId: null,
    currentStepPosition: -1,
    waitingOn: SEQUENCE_WAITING_ON.EMAIL_SCHEDULED,
    nextActionAt: new Date('2020-01-01T00:00:00.000Z'),
    senderConnectedAccountId: connectedAccountId,
    stopOnReply: true,
    sentEmailsByStepId: {},
    lastSendAttempt: null,
  } as SequenceEnrollmentWorkspaceEntity;
  const baseSequence = {
    id: 'sequence-id',
    status: SEQUENCE_STATUSES.ACTIVE,
    senderConnectedAccountId: connectedAccountId,
    settings: {
      ...DEFAULT_SEQUENCE_SETTINGS,
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      windowStart: '00:00',
      windowEnd: '23:59',
      staggerMinutes: 0,
    },
  } as SequenceWorkspaceEntity;

  const buildPerson = ({
    emailOptOut = false,
    primaryEmail = 'ada@example.com',
    primaryPhoneNumber = '',
    timeZone = null,
  }: {
    emailOptOut?: boolean;
    primaryEmail?: string;
    primaryPhoneNumber?: string;
    timeZone?: string | null;
  } = {}) =>
    ({
      id: 'person-id',
      name: { firstName: 'Ada', lastName: 'Lovelace' },
      emails: { primaryEmail, additionalEmails: null },
      emailOptOut,
      timeZone,
      linkedinConnectionState: LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
      linkedinLink: {
        primaryLinkUrl: 'https://www.linkedin.com/in/ada-lovelace/',
        primaryLinkLabel: 'LinkedIn',
        secondaryLinks: null,
      },
      phones: {
        primaryPhoneNumber,
        primaryPhoneCountryCode: '',
        primaryPhoneCallingCode: '',
        additionalPhones: null,
      },
      company: null,
    }) as unknown as PersonWorkspaceEntity;

  const setup = ({
    boundaryPerson,
    currentEnrollment = baseEnrollment,
    currentSequence = baseSequence,
    latestLinkedinAction = null,
    person = buildPerson(),
    steps = [emailStep],
  }: {
    boundaryPerson?: PersonWorkspaceEntity;
    currentEnrollment?: SequenceEnrollmentWorkspaceEntity;
    currentSequence?: SequenceWorkspaceEntity;
    latestLinkedinAction?: LinkedinActionWorkspaceEntity | null;
    person?: PersonWorkspaceEntity;
    steps?: SequenceStepWorkspaceEntity[];
  } = {}) => {
    const enrollmentRepository = {
      findOne: jest.fn().mockResolvedValue(currentEnrollment),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const sequenceRepository = {
      findOne: jest.fn().mockResolvedValue(currentSequence),
    };
    const stepRepository = {
      find: jest.fn().mockResolvedValue(steps),
    };
    const personRepository = {
      findOne: jest.fn().mockImplementation(async (options) => {
        const selectedFields = Array.isArray(options?.select)
          ? options.select
          : [];

        return selectedFields.includes('emailOptOut')
          ? (boundaryPerson ?? person)
          : person;
      }),
    };
    const linkedinActionRepository = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockImplementation(async (options) => {
        if (latestLinkedinAction === null) {
          return null;
        }

        const whereClauses: Array<{
          executedAt?: FindOperator<Date | null>;
        }> = Array.isArray(options?.where) ? options.where : [options?.where];
        const executedAtOperators = whereClauses
          .map(
            (whereClause) =>
              whereClause?.executedAt as FindOperator<Date | null> | undefined,
          )
          .filter(
            (operator): operator is FindOperator<Date | null> =>
              operator !== undefined,
          );
        const acceptsNullExecutedAt = executedAtOperators.some(
          ({ type }) => type === 'isNull',
        );
        const acceptsExecutedAt = executedAtOperators.some(
          ({ type }) => type === 'not',
        );

        if (latestLinkedinAction.executedAt === null) {
          return acceptsNullExecutedAt ? latestLinkedinAction : null;
        }

        if (executedAtOperators.length > 0) {
          return acceptsExecutedAt ? latestLinkedinAction : null;
        }

        return latestLinkedinAction;
      }),
      insert: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const linkedinConnectionRepository = {
      count: jest.fn().mockResolvedValue(0),
    };
    const linkedinInvitationRepository = {
      count: jest.fn().mockResolvedValue(0),
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
      [
        LinkedinThreadParticipantWorkspaceEntity,
        linkedinThreadParticipantRepository,
      ],
      [MessageParticipantWorkspaceEntity, messageParticipantRepository],
    ]);
    const transactionManager = {} as WorkspaceEntityManager;
    const transaction = jest.fn(
      async (callback: (manager: WorkspaceEntityManager) => Promise<unknown>) =>
        callback(transactionManager),
    );
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(
        async (callback: () => Promise<unknown>) => callback(),
      ),
      getGlobalWorkspaceDataSource: jest
        .fn()
        .mockResolvedValue({ transaction }),
      getRepository: jest.fn(
        async (_workspaceId: string, entity: object) =>
          repositories.get(entity) ?? {},
      ),
    } as unknown as GlobalWorkspaceOrmManager;
    const workspaceEventEmitter = {
      emitCustomBatchEvent: jest.fn(),
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
    const send = jest.fn<
      ReturnType<SequenceEmailSenderService['send']>,
      Parameters<SequenceEmailSenderService['send']>
    >(async ({ onProviderStart }) => {
      await onProviderStart();

      return {
        headerMessageId: 'header-message-id',
        threadExternalId: 'thread-external-id',
        sentAt: new Date().toISOString(),
        persistSentMessage: jest.fn(),
      };
    });
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
    const reserveUtcDailySend = jest.fn(async ({ now }: { now: Date }) => ({
      reservationToken: 'daily-reservation-token',
      usageDate: now.toISOString().slice(0, 10),
    }));
    const releaseUtcDailySendReservation = jest.fn();
    const sequenceMailboxThrottleService = {
      acquireSendLock,
      renewSendLock,
      releaseSendLock,
      getLastSendAt: jest.fn().mockResolvedValue(null),
      setLastSendAt: jest.fn(),
      recordEmailSendClaimWatermark: jest.fn(),
      reserveUtcDailySend,
      releaseUtcDailySendReservation,
      consumeUtcDailySendReservation: jest.fn(),
    } as unknown as SequenceMailboxThrottleService;
    const sequenceLinkedinThrottleService = {
      reserveSlot: jest.fn().mockResolvedValue(new Date()),
    } as unknown as SequenceLinkedinThrottleService;
    const enqueueProcess = jest.fn();
    const sequenceQueueService = {
      enqueueProcess,
    } as unknown as SequenceQueueService;
    const getSenderAccountOrThrow = jest.fn().mockResolvedValue({
      id: connectedAccountId,
      userWorkspaceId: 'user-workspace-id',
    });
    const getOwnerWorkspaceMemberIdOrThrow = jest
      .fn()
      .mockResolvedValue(ownerWorkspaceMemberId);
    const withLockedSenderAccountOrThrow = jest.fn(
      async ({ operation }: { operation: (...args: unknown[]) => unknown }) =>
        operation(
          {
            id: connectedAccountId,
            userWorkspaceId: 'user-workspace-id',
          },
          {},
        ),
    );
    const sequenceSenderService = {
      getReadySenderOrThrow: jest.fn().mockResolvedValue({
        connectedAccount: { id: connectedAccountId },
        messageChannel: { id: 'message-channel-id' },
      }),
      getSenderAccountOrThrow,
      getOwnerWorkspaceMemberIdOrThrow,
      getSenderOwnerWorkspaceMemberIdOrThrow: jest
        .fn()
        .mockResolvedValue(ownerWorkspaceMemberId),
      withLockedSenderAccountOrThrow,
    } as unknown as SequenceSenderService;
    const sequenceVariableService = {
      buildVariables: jest.fn().mockResolvedValue({
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    } as unknown as SequenceVariableService;
    const enrichPerson = jest.fn<
      ReturnType<ApolloEnrichmentService['enrichPerson']>,
      Parameters<ApolloEnrichmentService['enrichPerson']>
    >(async ({ onProviderStart }) => {
      await onProviderStart?.();

      return 'updated';
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
      createTask,
      enrichPerson,
      enrollmentRepository,
      linkedinActionRepository,
      linkedinConnectionRepository,
      linkedinInvitationRepository,
      personRepository,
      reconcileBeforeEnrollmentProgress,
      reconcileEnrollmentBeforeProviderStart,
      releaseUtcDailySendReservation,
      renewSendLock,
      send,
      service,
      transactionManager,
    };
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('trusts a fresh pre-provider SKIPPED and CONNECTED observation by updatedAt', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');

    jest.useFakeTimers({ now });

    const { linkedinActionRepository, linkedinConnectionRepository, service } =
      setup();

    linkedinActionRepository.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    await expect(
      (
        service as unknown as SequenceExecutorPrivateApi
      ).isPersonConnectedToSender({
        workspaceId,
        person: buildPerson(),
        senderConnectedAccountId: connectedAccountId,
      }),
    ).resolves.toBe(true);

    const preProviderWhere = linkedinActionRepository.count.mock.calls[1][0]
      .where as {
      connectionState: string;
      executedAt: FindOperator<Date | null>;
      status: string;
      updatedAt: FindOperator<string>;
    };

    expect(preProviderWhere).toEqual(
      expect.objectContaining({
        status: LINKEDIN_ACTION_STATUSES.SKIPPED,
        connectionState: LINKEDIN_CONNECTION_STATES.CONNECTED,
      }),
    );
    expect(preProviderWhere.executedAt.type).toBe('isNull');
    expect(preProviderWhere.updatedAt.type).toBe('moreThanOrEqual');
    expect(preProviderWhere.updatedAt.value).toEqual(
      new Date(
        now.getTime() - LINKEDIN_CONNECTION_OBSERVATION_MAX_AGE_MS,
      ).toISOString(),
    );
    expect(linkedinConnectionRepository.count).toHaveBeenCalled();
  });

  it('treats a fresh pre-provider SKIPPED and PENDING invitation as outstanding', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');

    jest.useFakeTimers({ now });

    const { linkedinActionRepository, service } = setup({
      latestLinkedinAction: {
        id: 'pending-observation-id',
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.SKIPPED,
        connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
        executedAt: null,
        updatedAt: now,
      } as unknown as LinkedinActionWorkspaceEntity,
    });

    await expect(
      (
        service as unknown as SequenceExecutorPrivateApi
      ).hasOutstandingConnectionRequest({
        workspaceId,
        person: buildPerson(),
        ownerWorkspaceMemberId,
      }),
    ).resolves.toBe(true);

    const executedLookup = linkedinActionRepository.findOne.mock.calls[0][0];
    const preProviderLookup = linkedinActionRepository.findOne.mock.calls[1][0];
    const preProviderWhere = preProviderLookup.where[0] as {
      connectionState: string;
      executedAt: FindOperator<Date | null>;
      status: string;
      type: string;
      updatedAt: FindOperator<string>;
    };

    expect(executedLookup.order).toEqual({ executedAt: 'DESC', id: 'DESC' });
    expect(preProviderLookup.order).toEqual({
      updatedAt: 'DESC',
      id: 'DESC',
    });
    expect(preProviderWhere.status).toBe(LINKEDIN_ACTION_STATUSES.SKIPPED);
    expect(preProviderWhere.type).toBe(
      LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
    );
    expect(preProviderWhere.connectionState).toBe(
      LINKEDIN_CONNECTION_STATES.PENDING,
    );
    expect(preProviderWhere.executedAt.type).toBe('isNull');
    expect(preProviderWhere.updatedAt.value).toEqual(
      new Date(
        now.getTime() - LINKEDIN_CONNECTION_OBSERVATION_MAX_AGE_MS,
      ).toISOString(),
    );
  });

  it('uses a historical SKIPPED and PENDING send as proof for a later accepted-invite condition', async () => {
    const conditionStep = {
      id: 'accepted-condition-step-id',
      sequenceId: baseSequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.CONDITION,
        condition: SEQUENCE_CONDITION_TYPES.ACCEPTED_LINKEDIN_INVITE,
      },
    } as SequenceStepWorkspaceEntity;
    const yesStep = {
      id: 'accepted-yes-step-id',
      sequenceId: baseSequence.id,
      position: 1,
      settings: {
        type: SEQUENCE_STEP_TYPES.CREATE_TASK,
        branch: {
          conditionStepId: conditionStep.id,
          outcome: SEQUENCE_CONDITION_BRANCHES.YES,
        },
        taskType: SEQUENCE_TASK_TYPES.CUSTOM,
        titleTemplate: 'Invitation accepted',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      },
    } as SequenceStepWorkspaceEntity;
    const currentEnrollment = {
      ...baseEnrollment,
      currentStepId: conditionStep.id,
      currentStepPosition: conditionStep.position,
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
    } as SequenceEnrollmentWorkspaceEntity;
    const { createTask, linkedinActionRepository, service } = setup({
      currentEnrollment,
      latestLinkedinAction: {
        id: 'historical-pending-observation-id',
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.SKIPPED,
        connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
        executedAt: null,
        updatedAt: '2026-08-19T10:00:00.000Z',
      } as LinkedinActionWorkspaceEntity,
      steps: [conditionStep, yesStep],
    });

    // Current CONNECTED state and historical invitation authorship are two
    // separate facts; the condition requires both.
    linkedinActionRepository.count.mockResolvedValue(1);

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ step: yesStep }),
    );
    expect(linkedinActionRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({
            type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
            status: LINKEDIN_ACTION_STATUSES.SKIPPED,
            connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
          }),
        ]),
        order: { updatedAt: 'DESC', id: 'DESC' },
      }),
    );
  });

  it('orders provider actions by executedAt before comparing pre-provider observations', async () => {
    const { linkedinActionRepository, service } = setup();
    const laterWithdrawal = {
      id: 'later-withdrawal-id',
      type: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.COMPLETED,
      connectionState: LINKEDIN_CONNECTION_STATES.WITHDRAWN,
      executedAt: new Date('2026-08-20T12:00:00.000Z'),
      updatedAt: '2026-08-20T12:00:00.000Z',
    } as LinkedinActionWorkspaceEntity;
    const earlierPendingObservation = {
      id: 'earlier-pending-id',
      type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
      status: LINKEDIN_ACTION_STATUSES.SKIPPED,
      connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
      executedAt: null,
      updatedAt: '2026-08-20T11:00:00.000Z',
    } as LinkedinActionWorkspaceEntity;

    linkedinActionRepository.findOne
      .mockResolvedValueOnce(laterWithdrawal)
      .mockResolvedValueOnce(earlierPendingObservation);

    await expect(
      (
        service as unknown as SequenceExecutorPrivateApi
      ).wasLinkedinInvitationSent({
        workspaceId,
        person: buildPerson(),
        ownerWorkspaceMemberId,
      }),
    ).resolves.toBe(false);

    expect(linkedinActionRepository.findOne.mock.calls[0][0].order).toEqual({
      executedAt: 'DESC',
      id: 'DESC',
    });
    expect(linkedinActionRepository.findOne.mock.calls[1][0].order).toEqual({
      updatedAt: 'DESC',
      id: 'DESC',
    });
  });

  it.each([
    'hasOutstandingConnectionRequest',
    'wasLinkedinInvitationSent',
  ] as const)(
    'lets a newer skipped withdrawal observation supersede send history and a retained connector row in %s',
    async (methodName) => {
      const {
        linkedinActionRepository,
        linkedinInvitationRepository,
        service,
      } = setup();
      const completedSend = {
        id: 'completed-send-id',
        type: LINKEDIN_ACTION_TYPES.SEND_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.COMPLETED,
        connectionState: LINKEDIN_CONNECTION_STATES.PENDING,
        executedAt: new Date('2026-08-20T10:00:00.000Z'),
        updatedAt: '2026-08-20T12:00:00.000Z',
      } as LinkedinActionWorkspaceEntity;
      const skippedWithdrawal = {
        id: 'skipped-withdrawal-id',
        type: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
        status: LINKEDIN_ACTION_STATUSES.SKIPPED,
        connectionState: LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
        executedAt: null,
        updatedAt: '2026-08-20T11:00:00.000Z',
      } as LinkedinActionWorkspaceEntity;
      const retainedConnectorSentAt = new Date('2026-08-20T09:00:00.000Z');

      linkedinActionRepository.findOne
        .mockResolvedValueOnce(completedSend)
        .mockResolvedValueOnce(skippedWithdrawal);
      linkedinInvitationRepository.count.mockImplementation(
        async ({ where }) => {
          const sentAt = where.sentAt as FindOperator<Date> | undefined;

          return sentAt === undefined || retainedConnectorSentAt > sentAt.value
            ? 1
            : 0;
        },
      );

      await expect(
        (service as unknown as SequenceExecutorPrivateApi)[methodName]({
          workspaceId,
          person: buildPerson(),
          ownerWorkspaceMemberId,
        }),
      ).resolves.toBe(false);

      const preProviderLookup =
        linkedinActionRepository.findOne.mock.calls[1][0];
      const withdrawalWhere = preProviderLookup.where[1] as {
        connectionState: FindOperator<string>;
        executedAt: FindOperator<Date | null>;
        status: string;
        type: string;
      };

      expect(withdrawalWhere).toEqual(
        expect.objectContaining({
          type: LINKEDIN_ACTION_TYPES.WITHDRAW_CONNECTION_REQUEST,
          status: LINKEDIN_ACTION_STATUSES.SKIPPED,
        }),
      );
      expect(withdrawalWhere.connectionState.type).toBe('in');
      expect(withdrawalWhere.connectionState.value).toEqual(
        expect.arrayContaining([
          LINKEDIN_CONNECTION_STATES.NOT_CONNECTED,
          LINKEDIN_CONNECTION_STATES.WITHDRAWN,
        ]),
      );
      expect(withdrawalWhere.executedAt.type).toBe('isNull');

      const connectorWhere =
        linkedinInvitationRepository.count.mock.calls[0][0].where;
      const connectorSentAt = connectorWhere.sentAt as FindOperator<Date>;

      expect(connectorSentAt.type).toBe('moreThan');
      expect(connectorSentAt.value).toEqual(
        new Date(skippedWithdrawal.updatedAt),
      );
    },
  );

  it('records the inherited email policy while restoring the sequence-wide reply policy', async () => {
    const inheritedEnrollment = {
      ...baseEnrollment,
      stopOnReply: false,
    } as SequenceEnrollmentWorkspaceEntity;
    const { enrollmentRepository, service } = setup({
      currentEnrollment: inheritedEnrollment,
    });

    await service.process({ workspaceId, enrollmentId });

    const claimCall = enrollmentRepository.update.mock.calls.find(
      ([, values]) => 'lastSendAttempt' in values && 'stopOnReply' in values,
    );

    expect(claimCall?.[1]).toEqual(
      expect.objectContaining({ stopOnReply: true }),
    );

    const sentMetadataCall = enrollmentRepository.update.mock.calls.find(
      ([, values]) => values.sentEmailsByStepId?.[emailStep.id],
    );

    expect(sentMetadataCall?.[1].sentEmailsByStepId[emailStep.id]).toEqual(
      expect.objectContaining({ stopOnReply: true }),
    );
  });

  it('keeps an email override out of the sequence-wide reply policy', async () => {
    const stopDisabledEmailStep = {
      ...emailStep,
      settings: {
        ...emailStep.settings,
        stopOnReply: false,
      },
    } as SequenceStepWorkspaceEntity;
    const { enrollmentRepository, service } = setup({
      steps: [stopDisabledEmailStep],
    });

    await service.process({ workspaceId, enrollmentId });

    const claimCall = enrollmentRepository.update.mock.calls.find(
      ([, values]) => 'lastSendAttempt' in values && 'stopOnReply' in values,
    );
    const sentMetadataCall = enrollmentRepository.update.mock.calls.find(
      ([, values]) =>
        values.sentEmailsByStepId?.[stopDisabledEmailStep.id] !== undefined,
    );

    expect(claimCall?.[1]).toEqual(
      expect.objectContaining({ stopOnReply: true }),
    );
    expect(
      sentMetadataCall?.[1].sentEmailsByStepId[stopDisabledEmailStep.id],
    ).toEqual(expect.objectContaining({ stopOnReply: false }));
  });

  it('records a delivered checkpoint without rewinding an ACTIVE cursor that already moved', async () => {
    const sentEmailMetadata = {
      headerMessageId: 'delivered-header-id',
      threadExternalId: 'delivered-thread-id',
      sentAt: '2026-08-20T10:00:00.000Z',
      connectedAccountId,
    };
    const movedEnrollment = {
      ...baseEnrollment,
      currentStepId: 'later-step-id',
      currentStepPosition: 3,
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
      lastSendAttempt: {
        stepId: emailStep.id,
        attemptedAt: '2026-08-20T10:00:00.000Z',
        providerStartedAt: '2026-08-20T10:00:00.000Z',
        deliveredEmail: {
          stepPosition: emailStep.position,
          metadata: sentEmailMetadata,
        },
      },
    } as SequenceEnrollmentWorkspaceEntity;
    const { enrollmentRepository, send, service } = setup({
      currentEnrollment: movedEnrollment,
    });

    enrollmentRepository.update
      .mockResolvedValueOnce({ affected: 0 })
      .mockResolvedValueOnce({ affected: 1 });

    await service.process({ workspaceId, enrollmentId });

    expect(send).not.toHaveBeenCalled();
    expect(enrollmentRepository.update.mock.calls[1][1]).toEqual({
      sentEmailsByStepId: {
        [emailStep.id]: sentEmailMetadata,
      },
    });
    expect(enrollmentRepository.update.mock.calls[1][1]).not.toHaveProperty(
      'currentStepId',
    );
  });

  it('does not cross the email provider boundary after losing the exact mailbox lock', async () => {
    const {
      reconcileBeforeEnrollmentProgress,
      releaseUtcDailySendReservation,
      renewSendLock,
      send,
      service,
    } = setup();
    let providerCallReached = false;

    renewSendLock.mockResolvedValueOnce(false);
    send.mockImplementationOnce(async ({ onProviderStart }) => {
      await onProviderStart();
      providerCallReached = true;

      return {
        headerMessageId: 'must-not-send',
        persistSentMessage: jest.fn(),
        threadExternalId: 'must-not-send',
        sentAt: new Date().toISOString(),
      };
    });

    await expect(
      service.process({ workspaceId, enrollmentId }),
    ).rejects.toThrow('claim changed before the provider could start');

    expect(renewSendLock).toHaveBeenCalledWith({
      workspaceId,
      mailboxId: connectedAccountId,
      token: 'mailbox-lock-token',
    });
    expect(reconcileBeforeEnrollmentProgress).toHaveBeenCalledTimes(1);
    expect(providerCallReached).toBe(false);
    expect(releaseUtcDailySendReservation).toHaveBeenCalled();
  });

  it.each([
    ['email', true, false],
    ['LinkedIn', false, true],
  ])(
    'reconciles a late durable %s reply again before email provider start',
    async (_channel, stopForEmailReply, stopForLinkedinReply) => {
      const {
        enrollmentRepository,
        reconcileBeforeEnrollmentProgress,
        reconcileEnrollmentBeforeProviderStart,
        send,
        service,
      } = setup();
      let providerCallReached = false;

      reconcileBeforeEnrollmentProgress
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(stopForEmailReply);
      reconcileEnrollmentBeforeProviderStart
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(stopForLinkedinReply);
      send.mockImplementationOnce(async ({ onProviderStart }) => {
        await onProviderStart();
        providerCallReached = true;

        return {
          headerMessageId: 'must-not-send',
          persistSentMessage: jest.fn(),
          threadExternalId: 'must-not-send',
          sentAt: new Date().toISOString(),
        };
      });

      await expect(
        service.process({ workspaceId, enrollmentId }),
      ).rejects.toThrow('claim changed before the provider could start');

      expect(reconcileBeforeEnrollmentProgress).toHaveBeenCalledTimes(2);
      expect(reconcileEnrollmentBeforeProviderStart).toHaveBeenCalledTimes(
        stopForEmailReply ? 1 : 2,
      );
      expect(providerCallReached).toBe(false);
      expect(enrollmentRepository.update.mock.calls).toContainEqual([
        expect.objectContaining({
          id: enrollmentId,
          status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
        }),
        expect.objectContaining({
          lastSendAttempt: expect.objectContaining({
            reservationReleasePendingAt: expect.any(String),
          }),
        }),
      ]);
    },
  );

  it.each([
    ['opted out', buildPerson({ emailOptOut: true })],
    [
      'changed primary recipient',
      buildPerson({ primaryEmail: 'new@example.com' }),
    ],
  ])(
    'does not cross the email provider boundary when the Person has %s',
    async (_scenario, boundaryPerson) => {
      const { enrollmentRepository, personRepository, send, service } = setup({
        boundaryPerson,
      });
      let providerCallReached = false;

      send.mockImplementationOnce(async ({ onProviderStart }) => {
        await onProviderStart();
        providerCallReached = true;

        return {
          headerMessageId: 'must-not-send',
          persistSentMessage: jest.fn(),
          threadExternalId: 'must-not-send',
          sentAt: new Date().toISOString(),
        };
      });

      await expect(
        service.process({ workspaceId, enrollmentId }),
      ).rejects.toThrow('claim changed before the provider could start');

      expect(personRepository.findOne).toHaveBeenLastCalledWith(
        {
          where: { id: baseEnrollment.personId },
          select: ['id', 'emailOptOut', 'emails'],
          lock: { mode: 'pessimistic_write' },
        },
        expect.anything(),
      );
      expect(providerCallReached).toBe(false);
      expect(
        enrollmentRepository.update.mock.calls.some(([, values]) =>
          Boolean(values.lastSendAttempt?.providerStartedAt),
        ),
      ).toBe(false);
    },
  );

  it('uses the sequence stop-on-reply default and leaves automated email on its recipient-aware window gate', async () => {
    const now = new Date('2026-08-20T20:00:00.000Z');

    jest.useFakeTimers({ now });

    const currentEnrollment = {
      ...baseEnrollment,
      stopOnReply: false,
    } as SequenceEnrollmentWorkspaceEntity;
    const currentSequence = {
      ...baseSequence,
      settings: {
        ...baseSequence.settings,
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        windowStart: '12:00',
        windowEnd: '14:00',
        timezone: 'UTC',
        sendWindowTimezoneMode: SEQUENCE_SEND_WINDOW_TIMEZONE_MODES.RECIPIENT,
        stopOnReply: true,
      },
    } as SequenceWorkspaceEntity;
    const { enrollmentRepository, send, service } = setup({
      currentEnrollment,
      currentSequence,
      person: buildPerson({ timeZone: 'America/Los_Angeles' }),
    });

    await service.process({ workspaceId, enrollmentId });

    const claimValues = enrollmentRepository.update.mock.calls
      .map(([, values]) => values)
      .find(
        (values) =>
          values.currentStepId === emailStep.id &&
          values.waitingOn === SEQUENCE_WAITING_ON.EMAIL_SCHEDULED &&
          values.lastSendAttempt,
      );

    expect(send).toHaveBeenCalledTimes(1);
    expect(claimValues).toEqual(expect.objectContaining({ stopOnReply: true }));
    expect(enrollmentRepository.update.mock.calls).not.toContainEqual([
      expect.objectContaining({ sequenceId: baseSequence.id }),
      { nextActionAt: expect.any(Date) },
    ]);
  });

  it('defers a task reached by an immediate continuation until the fixed sequence window', async () => {
    const now = new Date('2026-08-20T20:00:00.000Z');

    jest.useFakeTimers({ now });

    const taskStep = {
      id: 'task-step-id',
      sequenceId: baseSequence.id,
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
    const currentEnrollment = {
      ...baseEnrollment,
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
    } as SequenceEnrollmentWorkspaceEntity;
    const currentSequence = {
      ...baseSequence,
      settings: {
        ...baseSequence.settings,
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        windowStart: '09:00',
        windowEnd: '10:00',
        timezone: 'UTC',
      },
    } as SequenceWorkspaceEntity;
    const { createTask, enrollmentRepository, service } = setup({
      currentEnrollment,
      currentSequence,
      steps: [taskStep],
    });

    await service.process({ workspaceId, enrollmentId });

    expect(createTask).not.toHaveBeenCalled();
    expect(enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        sequenceId: baseSequence.id,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
      { nextActionAt: new Date('2026-08-21T09:00:00.000Z') },
    );
  });

  it('defers a new Apollo reveal but not active Apollo recovery outside the fixed window', async () => {
    const now = new Date('2026-08-20T20:00:00.000Z');

    jest.useFakeTimers({ now });

    const enrichStep = {
      id: 'enrich-step-id',
      sequenceId: baseSequence.id,
      position: 0,
      settings: {
        type: SEQUENCE_STEP_TYPES.ENRICH_PHONE_NUMBER,
        executionMode: SEQUENCE_ACTION_EXECUTION_MODES.AUTOMATED,
      },
    } as SequenceStepWorkspaceEntity;
    const currentSequence = {
      ...baseSequence,
      settings: {
        ...baseSequence.settings,
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        windowStart: '09:00',
        windowEnd: '10:00',
        timezone: 'UTC',
      },
    } as SequenceWorkspaceEntity;
    const newRevealEnrollment = {
      ...baseEnrollment,
      waitingOn: SEQUENCE_WAITING_ON.DELAY,
    } as SequenceEnrollmentWorkspaceEntity;
    const newReveal = setup({
      currentEnrollment: newRevealEnrollment,
      currentSequence,
      steps: [enrichStep],
    });

    await newReveal.service.process({ workspaceId, enrollmentId });

    expect(newReveal.enrichPerson).not.toHaveBeenCalled();
    expect(newReveal.enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ sequenceId: baseSequence.id }),
      { nextActionAt: new Date('2026-08-21T09:00:00.000Z') },
    );

    const recoveryEnrollment = {
      ...baseEnrollment,
      currentStepId: enrichStep.id,
      currentStepPosition: enrichStep.position,
      waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
    } as SequenceEnrollmentWorkspaceEntity;
    const recovery = setup({
      currentEnrollment: recoveryEnrollment,
      currentSequence,
      person: buildPerson({ primaryPhoneNumber: '+358401234567' }),
      steps: [enrichStep],
    });

    await recovery.service.process({ workspaceId, enrollmentId });

    expect(recovery.enrichPerson).not.toHaveBeenCalled();
    expect(recovery.enrollmentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: enrollmentId,
        waitingOn: SEQUENCE_WAITING_ON.APOLLO_ENRICHMENT,
      }),
      expect.objectContaining({
        currentStepId: enrichStep.id,
        currentStepPosition: enrichStep.position,
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
      }),
    );
    expect(recovery.enrollmentRepository.update.mock.calls).not.toContainEqual([
      expect.objectContaining({ sequenceId: baseSequence.id }),
      { nextActionAt: new Date('2026-08-21T09:00:00.000Z') },
    ]);
  });
});
