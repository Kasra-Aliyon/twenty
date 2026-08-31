import { UseGuards } from '@nestjs/common';
import { Args, Query } from '@nestjs/graphql';

import { FeatureFlagKey } from 'twenty-shared/types';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { SequenceMutationCapabilitiesDTO } from 'src/modules/sequence/dtos/sequence-mutation-capabilities.dto';
import { SequenceReadinessDTO } from 'src/modules/sequence/dtos/sequence-readiness.dto';
import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard)
export class SequenceReadinessResolver {
  constructor(
    private readonly featureFlagService: FeatureFlagService,
    private readonly sequenceInvariantService: SequenceInvariantService,
  ) {}

  @Query(() => SequenceMutationCapabilitiesDTO)
  @UseGuards(NoPermissionGuard)
  sequenceMutationCapabilities(): SequenceMutationCapabilitiesDTO {
    return {
      atomicSettingsPatch: true,
      atomicSettingsPatchVersion: 1,
      atomicStepAppend: true,
      atomicStepAppendVersion: 1,
      enrollmentStartStep: true,
      enrollmentStartStepVersion: 1,
    };
  }

  @Query(() => SequenceReadinessDTO)
  @UseGuards(CustomPermissionGuard)
  async sequenceReadiness(
    @Args('sequenceId', { type: () => UUIDScalarType }) sequenceId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<SequenceReadinessDTO> {
    const errors: string[] = [];
    const authContext = getWorkspaceAuthContext();

    // The activation invariant uses internal repositories after this explicit
    // permission-enforcing lookup has established record visibility.
    await this.sequenceInvariantService.assertSequenceReadable({
      authContext,
      sequenceId,
    });

    if (
      !(await this.featureFlagService.isFeatureEnabled(
        FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
        workspace.id,
      ))
    ) {
      errors.push(
        'Outreach sequences are disabled for this workspace, so the scheduler will not run',
      );
    }

    try {
      await this.sequenceInvariantService.assertSequenceActivationReady({
        authContext,
        sequenceId,
      });
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : 'The sequence is not ready for activation',
      );
    }

    return { ready: errors.length === 0, errors };
  }
}
