import { UseGuards } from '@nestjs/common';
import { Args, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { SequenceAnalyticsDTO } from 'src/modules/sequence/dtos/sequence-analytics.dto';
import { SequenceAnalyticsService } from 'src/modules/sequence/services/sequence-analytics.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard)
export class SequenceAnalyticsResolver {
  constructor(
    private readonly sequenceAnalyticsService: SequenceAnalyticsService,
  ) {}

  @Query(() => SequenceAnalyticsDTO)
  @UseGuards(NoPermissionGuard)
  async sequenceAnalytics(
    @Args('sequenceId', { type: () => UUIDScalarType }) sequenceId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<SequenceAnalyticsDTO> {
    return this.sequenceAnalyticsService.getForSequence({
      workspaceId: workspace.id,
      sequenceId,
    });
  }
}
