import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import {
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_CONDITION_BRANCHES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  SEQUENCE_WAITING_ON,
  TASK_PRIORITIES,
  type SequenceConditionType,
  type SequenceEnrollmentStatus,
  type SequenceSettings,
  type SequenceStatus,
} from 'twenty-shared/types';
import { validateSpintax } from 'twenty-shared/utils';
import { In } from 'typeorm';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { isUserAuthContext } from 'src/engine/core-modules/auth/guards/is-user-auth-context.guard';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import {
  PermissionsException,
  PermissionsExceptionCode,
  PermissionsExceptionMessage,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { getWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import {
  LINKEDIN_CONNECTION_NOTE_MAX_LENGTH,
  LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH,
  SEQUENCE_SENDER_POOL_MAXIMUM,
} from 'src/modules/sequence/sequence.constants';
import { SequenceSenderService } from 'src/modules/sequence/services/sequence-sender.service';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { SequenceStepWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-step.workspace-entity';
import { SequenceWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence.workspace-entity';
import { parseSequenceSettings } from 'src/modules/sequence/utils/parse-sequence-settings.util';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const SEQUENCE_ENGINE_FIELDS = new Set([
  'activeCount',
  'completedCount',
  'enrolledCount',
  'failedCount',
  'repliedCount',
]);

const ALLOWED_SEQUENCE_STATUS_TRANSITIONS: Record<
  SequenceStatus,
  ReadonlySet<SequenceStatus>
> = {
  [SEQUENCE_STATUSES.DRAFT]: new Set([
    SEQUENCE_STATUSES.DRAFT,
    SEQUENCE_STATUSES.ACTIVE,
  ]),
  [SEQUENCE_STATUSES.ACTIVE]: new Set([
    SEQUENCE_STATUSES.ACTIVE,
    SEQUENCE_STATUSES.PAUSED,
  ]),
  [SEQUENCE_STATUSES.PAUSED]: new Set([
    SEQUENCE_STATUSES.PAUSED,
    SEQUENCE_STATUSES.ACTIVE,
    SEQUENCE_STATUSES.DRAFT,
  ]),
};

const TERMINAL_USER_STATUSES: ReadonlySet<SequenceEnrollmentStatus> = new Set([
  SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
  SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
]);

const SENDER_DEPENDENT_CONDITIONS: ReadonlySet<SequenceConditionType> = new Set(
  [
    SEQUENCE_CONDITION_TYPES.IS_IN_LINKEDIN_NETWORK,
    SEQUENCE_CONDITION_TYPES.ACCEPTED_LINKEDIN_INVITE,
    SEQUENCE_CONDITION_TYPES.OPENED_LINKEDIN_MESSAGE,
  ],
);

const KNOWN_STEP_TYPES: ReadonlySet<string> = new Set(
  Object.values(SEQUENCE_STEP_TYPES),
);
const KNOWN_CONDITION_TYPES: ReadonlySet<string> = new Set(
  Object.values(SEQUENCE_CONDITION_TYPES),
);
const KNOWN_CONDITION_BRANCHES: ReadonlySet<string> = new Set(
  Object.values(SEQUENCE_CONDITION_BRANCHES),
);
const KNOWN_EXECUTION_MODES: ReadonlySet<string> = new Set(
  Object.values(SEQUENCE_ACTION_EXECUTION_MODES),
);
const KNOWN_TASK_TYPES: ReadonlySet<string> = new Set(
  Object.values(SEQUENCE_TASK_TYPES),
);
const KNOWN_TASK_PRIORITIES: ReadonlySet<string> = new Set(
  Object.values(TASK_PRIORITIES),
);
const KNOWN_TASK_CONTINUE_MODES: ReadonlySet<string> = new Set([
  'IMMEDIATE',
  'ON_DONE',
  'ON_DEADLINE',
]);

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;
const MAXIMUM_DATE_TIMESTAMP = 8_640_000_000_000_000;

const isSupportedFutureDuration = ({
  days = 0,
  hours = 0,
  minutes = 0,
}: {
  days?: number;
  hours?: number;
  minutes?: number;
}): boolean => {
  const durationMilliseconds =
    days * MILLISECONDS_PER_DAY +
    hours * MILLISECONDS_PER_HOUR +
    minutes * MILLISECONDS_PER_MINUTE;

  return (
    Number.isFinite(durationMilliseconds) &&
    durationMilliseconds <= MAXIMUM_DATE_TIMESTAMP - Date.now()
  );
};

@Injectable()
export class SequenceInvariantService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly sequenceSenderService: SequenceSenderService,
  ) {}

  normalizeSequenceCreate(
    data: Partial<SequenceWorkspaceEntity>,
  ): Partial<SequenceWorkspaceEntity> {
    this.assertSenderPoolSize(data.settings);

    return {
      ...data,
      settings: parseSequenceSettings(data.settings),
      status: SEQUENCE_STATUSES.DRAFT,
      enrolledCount: 0,
      activeCount: 0,
      completedCount: 0,
      repliedCount: 0,
      failedCount: 0,
    };
  }

  normalizeSequenceUpdate(
    data: Partial<SequenceWorkspaceEntity>,
  ): Partial<SequenceWorkspaceEntity> {
    if (data.settings === undefined) {
      return data;
    }

    return {
      ...data,
      settings: parseSequenceSettings(data.settings),
    };
  }

  async normalizeEnrollmentCreates({
    authContext,
    data,
  }: {
    authContext: WorkspaceAuthContext;
    data: Partial<SequenceEnrollmentWorkspaceEntity>[];
  }): Promise<Partial<SequenceEnrollmentWorkspaceEntity>[]> {
    const sequenceIds = [
      ...new Set(data.map(({ sequenceId }) => sequenceId).filter(Boolean)),
    ] as string[];

    if (data.some(({ sequenceId }) => !sequenceId)) {
      this.throwBadRequest('Every enrollment requires a sequence');
    }

    const sequences = await this.getSequences({ authContext, sequenceIds });
    const sequenceById = new Map(
      sequences.map((sequence) => [sequence.id, sequence]),
    );

    return data.map((input) => {
      const sequence = sequenceById.get(input.sequenceId as string);

      if (!sequence) {
        this.throwBadRequest('The sequence for this enrollment was not found');
      }

      if (sequence.deletedAt) {
        this.throwBadRequest(
          'People cannot be enrolled in an archived sequence',
        );
      }

      return {
        id: input.id,
        sequenceId: input.sequenceId,
        personId: input.personId,
        position: input.position,
        status: SEQUENCE_ENROLLMENT_STATUSES.PENDING,
        currentStepId: null,
        currentStepPosition: -1,
        waitingOn: null,
        nextActionAt: null,
        senderConnectedAccountId:
          (parseSequenceSettings(sequence.settings).senderConnectedAccountIds
            ?.length ?? 0) > 0
            ? null
            : sequence.senderConnectedAccountId,
        stopOnReply: parseSequenceSettings(sequence.settings).stopOnReply,
        startedAt: null,
        endedAt: null,
        errorMessage: null,
        sentEmailsByStepId: {},
        lastSendAttempt: null,
      };
    });
  }

  async normalizeEnrollmentUpdate({
    authContext,
    enrollmentId,
    data,
  }: {
    authContext: WorkspaceAuthContext;
    enrollmentId: string;
    data: Partial<SequenceEnrollmentWorkspaceEntity>;
  }): Promise<Partial<SequenceEnrollmentWorkspaceEntity>> {
    const enrollment = await this.getEnrollment({
      authContext,
      enrollmentId,
    });
    const fieldNames = Object.keys(data);

    const requestedStatus = data.status;

    if (
      requestedStatus &&
      TERMINAL_USER_STATUSES.has(requestedStatus) &&
      fieldNames.every((fieldName) =>
        ['endedAt', 'status'].includes(fieldName),
      ) &&
      new Set<SequenceEnrollmentStatus>([
        SEQUENCE_ENROLLMENT_STATUSES.PENDING,
        SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
      ]).has(enrollment.status)
    ) {
      return {
        status: requestedStatus,
        endedAt: new Date(),
        waitingOn: null,
        nextActionAt: null,
      };
    }

    if (
      enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE &&
      data.waitingOn === SEQUENCE_WAITING_ON.DELAY &&
      fieldNames.every((fieldName) =>
        ['nextActionAt', 'waitingOn'].includes(fieldName),
      )
    ) {
      return {
        waitingOn: SEQUENCE_WAITING_ON.DELAY,
        nextActionAt: new Date(),
      };
    }

    this.throwBadRequest(
      'Enrollment execution state can only be changed through a supported enrollment action',
    );
  }

  async assertStepCreateAllowed({
    authContext,
    sequenceIds,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: (string | undefined)[];
  }): Promise<void> {
    if (sequenceIds.some((sequenceId) => !sequenceId)) {
      this.throwBadRequest('Every sequence step requires a sequence');
    }

    await this.assertSequencesEditable({
      authContext,
      sequenceIds: sequenceIds as string[],
    });
  }

  async assertStepUpdateAllowed({
    authContext,
    stepId,
    nextSequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    stepId: string;
    nextSequenceId?: string;
  }): Promise<void> {
    const steps = await this.getSteps({ authContext, stepIds: [stepId] });
    const step = steps[0];

    if (!step) {
      this.throwBadRequest('The sequence step was not found');
    }

    await this.assertSequencesEditable({
      authContext,
      sequenceIds: [step.sequenceId, nextSequenceId].filter(
        Boolean,
      ) as string[],
    });
  }

  async assertStepMutationAllowed({
    authContext,
    stepId,
  }: {
    authContext: WorkspaceAuthContext;
    stepId: string;
  }): Promise<void> {
    await this.assertStepUpdateAllowed({ authContext, stepId });
  }

  async assertStepDeletionAllowed({
    authContext,
    stepId,
  }: {
    authContext: WorkspaceAuthContext;
    stepId: string;
  }): Promise<void> {
    const [step] = await this.getSteps({ authContext, stepIds: [stepId] });

    if (!step) {
      this.throwBadRequest('The sequence step was not found');
    }

    await this.assertSequencesEditable({
      authContext,
      sequenceIds: [step.sequenceId],
    });

    const sequenceSteps = await this.getSequenceSteps({
      authContext,
      sequenceId: step.sequenceId,
    });
    const hasBranchChildren = sequenceSteps.some(
      ({ settings }) => settings.branch?.conditionStepId === stepId,
    );

    if (hasBranchChildren) {
      this.throwBadRequest(
        'Delete the condition branch steps before deleting their condition',
      );
    }
  }

  async assertSequenceUpdateAllowed({
    authContext,
    sequenceId,
    data,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    data: Partial<SequenceWorkspaceEntity>;
  }): Promise<void> {
    const [sequence] = await this.getSequences({
      authContext,
      sequenceIds: [sequenceId],
    });

    if (!sequence) {
      this.throwBadRequest('The sequence was not found');
    }

    const fieldNames = Object.keys(data);

    this.assertSenderPoolSize(data.settings);

    if (
      data.status !== undefined &&
      !ALLOWED_SEQUENCE_STATUS_TRANSITIONS[sequence.status].has(data.status)
    ) {
      this.throwBadRequest(
        sequence.status === SEQUENCE_STATUSES.ACTIVE &&
          data.status === SEQUENCE_STATUSES.DRAFT
          ? 'Pause the sequence before moving it back to draft'
          : `Cannot move a sequence from ${sequence.status} to ${data.status}`,
      );
    }

    if (fieldNames.some((fieldName) => SEQUENCE_ENGINE_FIELDS.has(fieldName))) {
      this.throwBadRequest(
        'Sequence counters are managed by the sequence engine',
      );
    }

    const changesSettingsOrSender = fieldNames.some((fieldName) =>
      ['senderConnectedAccountId', 'settings'].includes(fieldName),
    );

    if (
      sequence.status === SEQUENCE_STATUSES.ACTIVE &&
      changesSettingsOrSender
    ) {
      this.throwBadRequest('Pause the sequence before changing its settings');
    }

    const currentSettings = parseSequenceSettings(sequence.settings);
    const nextSettings = parseSequenceSettings(
      data.settings ?? sequence.settings,
    );
    const nextSenderConnectedAccountId = fieldNames.includes(
      'senderConnectedAccountId',
    )
      ? (data.senderConnectedAccountId ?? null)
      : sequence.senderConnectedAccountId;
    const currentSenderPool = this.getEffectiveSenderPool({
      senderConnectedAccountId: sequence.senderConnectedAccountId,
      settings: currentSettings,
    });
    const nextSenderPool = this.getEffectiveSenderPool({
      senderConnectedAccountId: nextSenderConnectedAccountId,
      settings: nextSettings,
    });
    const changesSenderPool =
      currentSenderPool.length !== nextSenderPool.length ||
      currentSenderPool.some(
        (senderId, index) => senderId !== nextSenderPool[index],
      );

    if (
      (fieldNames.includes('senderConnectedAccountId') || changesSenderPool) &&
      (await this.hasActiveEnrollments({
        authContext,
        sequenceIds: [sequenceId],
      }))
    ) {
      this.throwBadRequest(
        'Wait for active enrollments to finish before changing the sender',
      );
    }

    if (data.status === SEQUENCE_STATUSES.ACTIVE) {
      await this.assertSequenceActivationRequirements({
        authContext,
        sequenceId,
        settings: nextSettings,
        senderConnectedAccountId: nextSenderConnectedAccountId,
      });
    }
  }

  async assertSequenceActivationReady({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    const [sequence] = await this.getSequences({
      authContext,
      sequenceIds: [sequenceId],
    });

    if (!sequence) {
      this.throwBadRequest('The sequence was not found');
    }

    const settings = parseSequenceSettings(sequence.settings);

    this.assertSenderPoolSize(settings);
    await this.assertSequenceActivationRequirements({
      authContext,
      sequenceId,
      settings,
      senderConnectedAccountId: sequence.senderConnectedAccountId,
    });
  }

  async assertSequenceReadable({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const workspaceContext = getWorkspaceContext();
      const rolePermissionConfig = resolveRolePermissionConfig({
        authContext,
        userWorkspaceRoleMap: workspaceContext.userWorkspaceRoleMap,
        apiKeyRoleMap: workspaceContext.apiKeyRoleMap,
      });

      if (!rolePermissionConfig) {
        throw new PermissionsException(
          PermissionsExceptionMessage.PERMISSION_DENIED,
          PermissionsExceptionCode.PERMISSION_DENIED,
        );
      }

      const sequenceRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          authContext.workspace.id,
          SequenceWorkspaceEntity,
          rolePermissionConfig,
        );
      const sequence = await sequenceRepository.findOne({
        where: { id: sequenceId },
        select: ['id', 'senderConnectedAccountId', 'settings'],
      });

      if (!sequence) {
        this.throwBadRequest('The sequence was not found');
      }

      const permittedStepRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          authContext.workspace.id,
          SequenceStepWorkspaceEntity,
          rolePermissionConfig,
        );
      const readableSteps = await permittedStepRepository.find({
        where: { sequenceId },
        select: ['id', 'position', 'sequenceId', 'settings', 'type'],
      });
      const internalStepRepository =
        await this.globalWorkspaceOrmManager.getRepository(
          authContext.workspace.id,
          SequenceStepWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );
      const internalStepCount = await internalStepRepository.count({
        where: { sequenceId },
      });

      if (readableSteps.length !== internalStepCount) {
        throw new PermissionsException(
          PermissionsExceptionMessage.PERMISSION_DENIED,
          PermissionsExceptionCode.PERMISSION_DENIED,
        );
      }
    }, authContext);
  }

  private async assertSequenceActivationRequirements({
    authContext,
    sequenceId,
    settings,
    senderConnectedAccountId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
    settings: SequenceSettings;
    senderConnectedAccountId: string | null;
  }): Promise<void> {
    const steps = await this.getSequenceSteps({
      authContext,
      sequenceId,
    });
    const senderConnectedAccountIds = this.getEffectiveSenderPool({
      senderConnectedAccountId,
      settings,
    });

    if (steps.length === 0) {
      this.throwBadRequest('Add a step before activating the sequence');
    }

    // Every scheduling path is gated on the sending window. With no active
    // day the window never opens, so the sequence would sit ACTIVE and never
    // advance a single enrollment.
    if (settings.activeDays.length === 0) {
      this.throwBadRequest(
        'Choose at least one sending day before activating the sequence',
      );
    }

    this.assertSequenceStepsValid(steps, settings);
    await this.assertTaskAssigneesExist({ authContext, steps });

    const hasAutomatedEmailStep = steps.some(
      ({ settings }) =>
        settings.type === SEQUENCE_STEP_TYPES.SEND_EMAIL &&
        settings.executionMode !== SEQUENCE_ACTION_EXECUTION_MODES.MANUAL,
    );
    const hasLinkedinActionStep = steps.some(
      ({ settings }) =>
        settings.type === SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST ||
        settings.type === SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE ||
        settings.type === SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
    );
    const hasSenderDependentCondition = steps.some(
      ({ settings }) =>
        settings.type === SEQUENCE_STEP_TYPES.CONDITION &&
        SENDER_DEPENDENT_CONDITIONS.has(settings.condition),
    );
    const requiresSender =
      hasAutomatedEmailStep ||
      hasLinkedinActionStep ||
      hasSenderDependentCondition;

    if (requiresSender && senderConnectedAccountIds.length === 0) {
      this.throwBadRequest('Choose a sender before activating the sequence');
    }

    if (!requiresSender) {
      return;
    }

    for (const connectedAccountId of senderConnectedAccountIds) {
      try {
        const expectedUserWorkspaceId = isUserAuthContext(authContext)
          ? authContext.userWorkspaceId
          : undefined;

        // Only automated email actually sends through the mailbox. LinkedIn
        // steps and conditions only require an owned, active sender account.
        if (hasAutomatedEmailStep) {
          await this.sequenceSenderService.getReadySenderOrThrow({
            connectedAccountId,
            expectedUserWorkspaceId,
            workspaceId: authContext.workspace.id,
          });
        } else {
          await this.sequenceSenderService.getSenderAccountOrThrow({
            connectedAccountId,
            expectedUserWorkspaceId,
            workspaceId: authContext.workspace.id,
          });
        }
      } catch (error) {
        this.throwBadRequest(
          error instanceof Error
            ? error.message
            : 'A selected sender mailbox is not ready',
        );
      }
    }
  }

  private assertSequenceStepsValid(
    steps: SequenceStepWorkspaceEntity[],
    sequenceSettings: SequenceSettings,
  ): void {
    const stepById = new Map(steps.map((step) => [step.id, step]));
    const occupiedSiblingPositions = new Set<string>();

    for (const step of steps) {
      const settings = step.settings;

      if (
        step.position !== undefined &&
        (!Number.isFinite(step.position) || step.position < 0)
      ) {
        this.throwBadRequest(
          `Sequence step ${step.id} has an invalid position`,
        );
      }

      if (step.position !== undefined) {
        const branch = settings.branch;
        const siblingPositionKey = branch
          ? `${branch.conditionStepId}:${branch.outcome}:${step.position}`
          : `ROOT:${step.position}`;

        if (occupiedSiblingPositions.has(siblingPositionKey)) {
          this.throwBadRequest(
            `Sequence step ${step.id} has a duplicate position in its branch`,
          );
        }

        occupiedSiblingPositions.add(siblingPositionKey);
      }

      if (!KNOWN_STEP_TYPES.has(settings.type)) {
        this.throwBadRequest(`Sequence step ${step.id} has an unknown type`);
      }

      if (
        'executionMode' in settings &&
        settings.executionMode !== undefined &&
        !KNOWN_EXECUTION_MODES.has(settings.executionMode)
      ) {
        this.throwBadRequest(
          `Sequence step ${step.id} has an invalid execution mode`,
        );
      }

      if (
        settings.type === SEQUENCE_STEP_TYPES.CONDITION &&
        !KNOWN_CONDITION_TYPES.has(settings.condition)
      ) {
        this.throwBadRequest(
          `Sequence condition ${step.id} has an unknown condition`,
        );
      }

      switch (settings.type) {
        case SEQUENCE_STEP_TYPES.DELAY:
          if (
            !isNonNegativeFiniteNumber(settings.days) ||
            !isNonNegativeFiniteNumber(settings.hours) ||
            !isNonNegativeFiniteNumber(settings.minutes) ||
            !isSupportedFutureDuration({
              days: settings.days,
              hours: settings.hours,
              minutes: settings.minutes,
            })
          ) {
            this.throwBadRequest(
              `Sequence delay ${step.id} has an invalid duration`,
            );
          }
          break;
        case SEQUENCE_STEP_TYPES.CREATE_TASK:
          if (
            typeof settings.titleTemplate !== 'string' ||
            settings.titleTemplate.trim().length === 0 ||
            typeof settings.notesTemplate !== 'string' ||
            (settings.assigneeWorkspaceMemberId !== null &&
              settings.assigneeWorkspaceMemberId !== undefined &&
              typeof settings.assigneeWorkspaceMemberId !== 'string') ||
            !KNOWN_TASK_TYPES.has(settings.taskType) ||
            !KNOWN_TASK_PRIORITIES.has(settings.priority) ||
            !KNOWN_TASK_CONTINUE_MODES.has(settings.continueMode) ||
            (settings.deadlineDays !== null &&
              (!isNonNegativeFiniteNumber(settings.deadlineDays) ||
                !isSupportedFutureDuration({
                  days: settings.deadlineDays,
                }))) ||
            (settings.continueMode === 'ON_DEADLINE' &&
              settings.deadlineDays === null)
          ) {
            this.throwBadRequest(
              `Sequence task ${step.id} is not fully configured`,
            );
          }
          break;
        case SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST:
          if (
            typeof settings.noteTemplate !== 'string' ||
            settings.noteTemplate.length > LINKEDIN_CONNECTION_NOTE_MAX_LENGTH
          ) {
            this.throwBadRequest(
              `LinkedIn connection step ${step.id} is not fully configured`,
            );
          }
          break;
        case SEQUENCE_STEP_TYPES.SEND_EMAIL:
          if (
            typeof settings.subject !== 'string' ||
            settings.subject.trim().length === 0 ||
            typeof settings.bodyHtml !== 'string' ||
            settings.bodyHtml.trim().length === 0 ||
            (settings.threadAsReplyToPreviousEmail !== undefined &&
              typeof settings.threadAsReplyToPreviousEmail !== 'boolean') ||
            (settings.stopOnReply !== undefined &&
              settings.stopOnReply !== null &&
              typeof settings.stopOnReply !== 'boolean')
          ) {
            this.throwBadRequest(
              `Sequence email step ${step.id} is not fully configured`,
            );
          }

          if (
            settings.executionMode === SEQUENCE_ACTION_EXECUTION_MODES.MANUAL &&
            (settings.threadAsReplyToPreviousEmail === true ||
              (settings.stopOnReply ?? sequenceSettings.stopOnReply))
          ) {
            this.throwBadRequest(
              `Manual email step ${step.id} cannot use reply threading or automatic stop-on-reply`,
            );
          }

          if (settings.variants !== undefined) {
            const variants = settings.variants;
            const hasValidVariants =
              settings.executionMode !==
                SEQUENCE_ACTION_EXECUTION_MODES.MANUAL &&
              Array.isArray(variants) &&
              variants.length === 2 &&
              new Set(variants.map(({ id }) => id)).size === variants.length &&
              variants.every(
                (variant) =>
                  typeof variant.id === 'string' &&
                  variant.id.trim().length > 0 &&
                  typeof variant.name === 'string' &&
                  variant.name.trim().length > 0 &&
                  typeof variant.subject === 'string' &&
                  variant.subject.trim().length > 0 &&
                  typeof variant.bodyHtml === 'string' &&
                  variant.bodyHtml.trim().length > 0 &&
                  typeof variant.weight === 'number' &&
                  Number.isFinite(variant.weight) &&
                  variant.weight > 0,
              );

            if (!hasValidVariants) {
              this.throwBadRequest(
                `Sequence email step ${step.id} has invalid A/B variants`,
              );
            }
          }

          if (
            [
              settings.subject,
              settings.bodyHtml,
              ...(settings.variants ?? []).flatMap((variant) => [
                variant.subject,
                variant.bodyHtml,
              ]),
            ].some((template) => !validateSpintax(template).isValid)
          ) {
            this.throwBadRequest(
              `Sequence email step ${step.id} has invalid spintax`,
            );
          }
          break;
        case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
          if (
            typeof settings.messageTemplate !== 'string' ||
            settings.messageTemplate.trim().length === 0 ||
            settings.messageTemplate.length > LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH
          ) {
            this.throwBadRequest(
              `LinkedIn message step ${step.id} must contain between 1 and ${LINKEDIN_DIRECT_MESSAGE_MAX_LENGTH} characters`,
            );
          }
          break;
        case SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST:
          if (
            !isNonNegativeFiniteNumber(settings.withdrawAfterDays) ||
            !isNonNegativeFiniteNumber(settings.withdrawAfterHours) ||
            !isSupportedFutureDuration({
              days: settings.withdrawAfterDays,
              hours: settings.withdrawAfterHours,
            })
          ) {
            this.throwBadRequest(
              `LinkedIn withdrawal step ${step.id} has an invalid delay`,
            );
          }
          break;
        case SEQUENCE_STEP_TYPES.CONDITION:
          if (
            settings.expected !== undefined &&
            typeof settings.expected !== 'boolean'
          ) {
            this.throwBadRequest(
              `Sequence condition ${step.id} has an invalid expectation`,
            );
          }
          break;
      }

      const branch = settings.branch;

      if (!branch) {
        continue;
      }

      const parentCondition = stepById.get(branch.conditionStepId);

      if (
        !parentCondition ||
        parentCondition.settings.type !== SEQUENCE_STEP_TYPES.CONDITION
      ) {
        this.throwBadRequest(
          `Sequence step ${step.id} references a missing condition branch`,
        );
      }

      if (!KNOWN_CONDITION_BRANCHES.has(branch.outcome)) {
        this.throwBadRequest(
          `Sequence step ${step.id} has an invalid condition outcome`,
        );
      }

      const visitedStepIds = new Set([step.id]);
      let currentStep: SequenceStepWorkspaceEntity | undefined = step;

      while (currentStep?.settings.branch) {
        const ancestor = stepById.get(
          currentStep.settings.branch.conditionStepId,
        );

        if (!ancestor || visitedStepIds.has(ancestor.id)) {
          this.throwBadRequest('Sequence condition branches contain a cycle');
        }

        visitedStepIds.add(ancestor.id);
        currentStep = ancestor;
      }
    }
  }

  private async assertTaskAssigneesExist({
    authContext,
    steps,
  }: {
    authContext: WorkspaceAuthContext;
    steps: SequenceStepWorkspaceEntity[];
  }): Promise<void> {
    const taskStepByAssigneeId = new Map<string, SequenceStepWorkspaceEntity>();

    for (const step of steps) {
      if (
        step.settings.type === SEQUENCE_STEP_TYPES.CREATE_TASK &&
        typeof step.settings.assigneeWorkspaceMemberId === 'string'
      ) {
        taskStepByAssigneeId.set(step.settings.assigneeWorkspaceMemberId, step);
      }
    }

    if (taskStepByAssigneeId.size === 0) {
      return;
    }

    const workspaceMemberRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        authContext.workspace.id,
        WorkspaceMemberWorkspaceEntity,
        { shouldBypassPermissionChecks: true },
      );
    const workspaceMembers = await workspaceMemberRepository.find({
      where: { id: In([...taskStepByAssigneeId.keys()]) },
      select: ['id'],
    });
    const existingWorkspaceMemberIds = new Set(
      workspaceMembers.map(({ id }) => id),
    );

    for (const [assigneeWorkspaceMemberId, step] of taskStepByAssigneeId) {
      if (!existingWorkspaceMemberIds.has(assigneeWorkspaceMemberId)) {
        this.throwBadRequest(
          `Sequence task ${step.id} references a workspace member that does not exist`,
        );
      }
    }
  }

  async assertSequenceArchiveAllowed({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    const sequence = await this.getSequenceOrThrow({
      authContext,
      sequenceId,
    });

    if (sequence.deletedAt) {
      this.throwBadRequest('The sequence is already archived');
    }
  }

  private getEffectiveSenderPool({
    senderConnectedAccountId,
    settings,
  }: {
    senderConnectedAccountId: string | null;
    settings: ReturnType<typeof parseSequenceSettings>;
  }): string[] {
    if ((settings.senderConnectedAccountIds?.length ?? 0) > 0) {
      return settings.senderConnectedAccountIds ?? [];
    }

    return senderConnectedAccountId ? [senderConnectedAccountId] : [];
  }

  private assertSenderPoolSize(settings: unknown): void {
    if (
      typeof settings === 'object' &&
      settings !== null &&
      'senderConnectedAccountIds' in settings &&
      Array.isArray(settings.senderConnectedAccountIds) &&
      settings.senderConnectedAccountIds.length > SEQUENCE_SENDER_POOL_MAXIMUM
    ) {
      this.throwBadRequest(
        `A sequence sender pool can contain at most ${SEQUENCE_SENDER_POOL_MAXIMUM} mailboxes`,
      );
    }
  }

  async assertSequenceDestroyAllowed({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    const sequence = await this.getSequenceOrThrow({
      authContext,
      sequenceId,
    });

    if (!sequence.deletedAt) {
      this.throwBadRequest(
        'Archive the sequence before permanently deleting it',
      );
    }
  }

  async assertSequenceRestoreAllowed({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<void> {
    const sequence = await this.getSequenceOrThrow({
      authContext,
      sequenceId,
    });

    if (!sequence.deletedAt) {
      this.throwBadRequest('Only an archived sequence can be restored');
    }
  }

  throwBulkMutationUnsupported(objectName: string): never {
    this.throwBadRequest(`Bulk mutations are not supported for ${objectName}`);
  }

  throwEnrollmentDeletionUnsupported(): never {
    this.throwBadRequest(
      'Enrollment history cannot be deleted; remove the enrollment instead',
    );
  }

  private async assertSequencesEditable({
    authContext,
    sequenceIds,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: string[];
  }): Promise<void> {
    const uniqueSequenceIds = [...new Set(sequenceIds)];
    const sequences = await this.getSequences({
      authContext,
      sequenceIds: uniqueSequenceIds,
    });

    if (sequences.length !== uniqueSequenceIds.length) {
      this.throwBadRequest('One or more sequences were not found');
    }

    if (sequences.some(({ deletedAt }) => deletedAt !== null)) {
      this.throwBadRequest('Archived sequences are read-only');
    }

    if (
      sequences.some(({ status }) => status === SEQUENCE_STATUSES.ACTIVE) ||
      (await this.hasActiveEnrollments({
        authContext,
        sequenceIds: uniqueSequenceIds,
      }))
    ) {
      this.throwBadRequest('Pause the sequence before changing its steps');
    }
  }

  private async getSequences({
    authContext,
    sequenceIds,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: string[];
  }): Promise<SequenceWorkspaceEntity[]> {
    if (sequenceIds.length === 0) {
      return [];
    }

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.globalWorkspaceOrmManager.getRepository(
          authContext.workspace.id,
          SequenceWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

        return repository.find({
          where: { id: In(sequenceIds) },
          withDeleted: true,
        });
      },
      authContext,
      { lite: true },
    );
  }

  private async getSequenceOrThrow({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<SequenceWorkspaceEntity> {
    const [sequence] = await this.getSequences({
      authContext,
      sequenceIds: [sequenceId],
    });

    if (!sequence) {
      this.throwBadRequest('The sequence was not found');
    }

    return sequence;
  }

  private async getSteps({
    authContext,
    stepIds,
  }: {
    authContext: WorkspaceAuthContext;
    stepIds: string[];
  }): Promise<SequenceStepWorkspaceEntity[]> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.globalWorkspaceOrmManager.getRepository(
          authContext.workspace.id,
          SequenceStepWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

        return repository.find({
          where: { id: In(stepIds) },
          withDeleted: true,
        });
      },
      authContext,
      { lite: true },
    );
  }

  private async getEnrollment({
    authContext,
    enrollmentId,
  }: {
    authContext: WorkspaceAuthContext;
    enrollmentId: string;
  }): Promise<SequenceEnrollmentWorkspaceEntity> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<SequenceEnrollmentWorkspaceEntity>(
            authContext.workspace.id,
            'sequenceEnrollment',
            { shouldBypassPermissionChecks: true },
          );
        const enrollment = await repository.findOne({
          where: { id: enrollmentId },
          withDeleted: true,
        });

        if (!enrollment) {
          this.throwBadRequest('The sequence enrollment was not found');
        }

        return enrollment;
      },
      authContext,
      { lite: true },
    );
  }

  private async getSequenceSteps({
    authContext,
    sequenceId,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceId: string;
  }): Promise<SequenceStepWorkspaceEntity[]> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.globalWorkspaceOrmManager.getRepository(
          authContext.workspace.id,
          SequenceStepWorkspaceEntity,
          { shouldBypassPermissionChecks: true },
        );

        return repository.find({ where: { sequenceId } });
      },
      authContext,
      { lite: true },
    );
  }

  private async hasActiveEnrollments({
    authContext,
    sequenceIds,
  }: {
    authContext: WorkspaceAuthContext;
    sequenceIds: string[];
  }): Promise<boolean> {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<SequenceEnrollmentWorkspaceEntity>(
            authContext.workspace.id,
            'sequenceEnrollment',
            { shouldBypassPermissionChecks: true },
          );

        return (
          (await repository.count({
            where: {
              sequenceId: In(sequenceIds),
              status: SEQUENCE_ENROLLMENT_STATUSES.ACTIVE,
            },
          })) > 0
        );
      },
      authContext,
      { lite: true },
    );
  }

  private throwBadRequest(message: string): never {
    throw new CommonQueryRunnerException(
      message,
      CommonQueryRunnerExceptionCode.BAD_REQUEST,
      {
        userFriendlyMessage: msg`This sequence change is not allowed in its current state.`,
      },
    );
  }
}
