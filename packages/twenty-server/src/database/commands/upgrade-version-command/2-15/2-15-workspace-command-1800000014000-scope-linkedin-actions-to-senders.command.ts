import { InjectRepository } from '@nestjs/typeorm';
import { Command } from 'nest-commander';

import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';
import { In, IsNull, Not, Repository } from 'typeorm';

import { ActiveOrSuspendedWorkspaceCommandRunner } from 'src/database/commands/command-runners/active-or-suspended-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { type RunOnWorkspaceArgs } from 'src/database/commands/command-runners/workspace.command-runner';
import { getStandardFlatEntitiesToCreateOrThrow } from 'src/database/commands/upgrade-version-command/2-10/utils/get-standard-flat-entities-to-create-or-throw.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

const ACTION_BATCH_SIZE = 500;

@RegisteredWorkspaceCommand('2.15.0', 1800000014000)
@Command({
  name: 'upgrade:2-15:scope-linkedin-actions-to-senders',
  description:
    'Scope browser-run LinkedIn actions to the workspace member who owns the sequence sender',
})
export class ScopeLinkedinActionsToSendersCommand extends ActiveOrSuspendedWorkspaceCommandRunner {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
  ) {
    super(workspaceIteratorService);
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs): Promise<void> {
    const { twentyStandardFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );
    const { flatFieldMetadataMaps, flatIndexMaps } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'flatFieldMetadataMaps',
        'flatIndexMaps',
      ]);
    const now = new Date().toISOString();
    const { allFlatEntityMaps: standardAllFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now,
        workspaceId,
        twentyStandardApplicationId: twentyStandardFlatApplication.id,
      });
    const fieldMetadataToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatFieldMetadata>({
        standardFlatEntityMaps: standardAllFlatEntityMaps.flatFieldMetadataMaps,
        existingFlatEntityMaps: flatFieldMetadataMaps,
        universalIdentifiers: [
          STANDARD_OBJECTS.linkedinAction.fields.ownerWorkspaceMemberId
            .universalIdentifier,
        ],
      });
    const indexMetadataToCreate =
      getStandardFlatEntitiesToCreateOrThrow<FlatIndexMetadata>({
        standardFlatEntityMaps: standardAllFlatEntityMaps.flatIndexMaps,
        existingFlatEntityMaps: flatIndexMaps,
        universalIdentifiers: [
          STANDARD_OBJECTS.linkedinAction.indexes.ownerStatusScheduledAtIndex
            .universalIdentifier,
        ],
      });

    if (options.dryRun) {
      this.logger.log(
        `[DRY RUN] Would create ${fieldMetadataToCreate.length} field(s) and ${indexMetadataToCreate.length} index(es), then backfill LinkedIn action owners for workspace ${workspaceId}`,
      );

      return;
    }

    if (fieldMetadataToCreate.length > 0 || indexMetadataToCreate.length > 0) {
      const validateAndBuildResult =
        await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
          {
            workspaceId,
            isSystemBuild: true,
            applicationUniversalIdentifier:
              twentyStandardFlatApplication.universalIdentifier,
            allFlatEntityOperationByMetadataName: {
              objectMetadata: {
                flatEntityToCreate: [],
                flatEntityToDelete: [],
                flatEntityToUpdate: [],
              },
              fieldMetadata: {
                flatEntityToCreate: fieldMetadataToCreate,
                flatEntityToDelete: [],
                flatEntityToUpdate: [],
              },
              index: {
                flatEntityToCreate: indexMetadataToCreate,
                flatEntityToDelete: [],
                flatEntityToUpdate: [],
              },
            },
          },
        );

      if (validateAndBuildResult.status === 'fail') {
        throw new Error(
          `Failed to scope LinkedIn actions for workspace ${workspaceId}: ${JSON.stringify(validateAndBuildResult)}`,
        );
      }
    }

    const backfilledCount = await this.backfillOwners(workspaceId);

    this.logger.log(
      `Backfilled ${backfilledCount} LinkedIn action owner(s) for workspace ${workspaceId}`,
    );
  }

  private async backfillOwners(workspaceId: string): Promise<number> {
    const connectedAccounts = await this.connectedAccountRepository.find({
      where: { workspaceId },
      select: ['id', 'userWorkspaceId'],
    });
    const userWorkspaceIds = [
      ...new Set(
        connectedAccounts.map(({ userWorkspaceId }) => userWorkspaceId),
      ),
    ];
    const userWorkspaces =
      userWorkspaceIds.length === 0
        ? []
        : await this.userWorkspaceRepository.find({
            where: { id: In(userWorkspaceIds), workspaceId },
            select: ['id', 'userId'],
          });

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const [actionRepository, enrollmentRepository, memberRepository] =
          await Promise.all([
            this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              LinkedinActionWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            ),
            this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              SequenceEnrollmentWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            ),
            this.globalWorkspaceOrmManager.getRepository(
              workspaceId,
              WorkspaceMemberWorkspaceEntity,
              { shouldBypassPermissionChecks: true },
            ),
          ]);
        const workspaceMembers =
          userWorkspaces.length === 0
            ? []
            : await memberRepository.find({
                where: {
                  userId: In(userWorkspaces.map(({ userId }) => userId)),
                },
                select: ['id', 'userId'],
              });
        const workspaceMemberIdByUserId = new Map(
          workspaceMembers.map(({ id, userId }) => [userId, id]),
        );
        const userIdByUserWorkspaceId = new Map(
          userWorkspaces.map(({ id, userId }) => [id, userId]),
        );
        const ownerWorkspaceMemberIdByConnectedAccountId = new Map(
          connectedAccounts.flatMap(({ id, userWorkspaceId }) => {
            const userId = userIdByUserWorkspaceId.get(userWorkspaceId);
            const workspaceMemberId = isDefined(userId)
              ? workspaceMemberIdByUserId.get(userId)
              : undefined;

            return isDefined(workspaceMemberId)
              ? [[id, workspaceMemberId] as const]
              : [];
          }),
        );
        let backfilledCount = 0;

        for (;;) {
          const actions = await actionRepository.find({
            where: {
              ownerWorkspaceMemberId: IsNull(),
              sequenceEnrollmentId: Not(IsNull()),
            },
            select: ['id', 'sequenceEnrollmentId'],
            take: ACTION_BATCH_SIZE,
          });

          if (actions.length === 0) {
            break;
          }

          const enrollmentIds = actions
            .map(({ sequenceEnrollmentId }) => sequenceEnrollmentId)
            .filter(isDefined);
          const enrollments = await enrollmentRepository.find({
            where: { id: In(enrollmentIds) },
            select: ['id', 'senderConnectedAccountId'],
          });
          const senderConnectedAccountIdByEnrollmentId = new Map(
            enrollments.map(({ id, senderConnectedAccountId }) => [
              id,
              senderConnectedAccountId,
            ]),
          );
          const updates = actions.flatMap((action) => {
            const connectedAccountId = isDefined(action.sequenceEnrollmentId)
              ? senderConnectedAccountIdByEnrollmentId.get(
                  action.sequenceEnrollmentId,
                )
              : undefined;
            const ownerWorkspaceMemberId = isDefined(connectedAccountId)
              ? ownerWorkspaceMemberIdByConnectedAccountId.get(
                  connectedAccountId,
                )
              : undefined;

            return isDefined(ownerWorkspaceMemberId)
              ? [
                  {
                    criteria: action.id,
                    partialEntity: { ownerWorkspaceMemberId },
                  },
                ]
              : [];
          });

          if (updates.length === 0) {
            break;
          }

          const workspaceDataSource =
            await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

          await workspaceDataSource.transaction(async (transactionManager) => {
            await actionRepository.updateMany(
              updates,
              transactionManager as WorkspaceEntityManager,
            );
          });
          backfilledCount += updates.length;

          if (actions.length < ACTION_BATCH_SIZE) {
            break;
          }
        }

        return backfilledCount;
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
