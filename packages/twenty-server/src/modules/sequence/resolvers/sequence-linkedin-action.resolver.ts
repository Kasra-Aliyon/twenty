import { UseGuards } from '@nestjs/common';
import { Args, GraphQLISODateTime, Mutation } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspaceMemberId } from 'src/engine/decorators/auth/auth-workspace-member-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { SequenceLinkedinActionClaimDTO } from 'src/modules/sequence/dtos/sequence-linkedin-action-claim.dto';
import { SequenceLinkedinActionMutationResultDTO } from 'src/modules/sequence/dtos/sequence-linkedin-action-mutation-result.dto';
import { SequenceLinkedinActionReportInput } from 'src/modules/sequence/dtos/sequence-linkedin-action-report.input';
import { SequenceLinkedinActionClaimService } from 'src/modules/sequence/services/sequence-linkedin-action-claim.service';
import { SequenceLinkedinActionMutationService } from 'src/modules/sequence/services/sequence-linkedin-action-mutation.service';

@MetadataResolver()
@UseGuards(WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
export class SequenceLinkedinActionResolver {
  constructor(
    private readonly sequenceLinkedinActionClaimService: SequenceLinkedinActionClaimService,
    private readonly sequenceLinkedinActionMutationService: SequenceLinkedinActionMutationService,
  ) {}

  @Mutation(() => SequenceLinkedinActionClaimDTO, { nullable: true })
  async claimSequenceLinkedinAction(
    @Args('actionId', { type: () => UUIDScalarType }) actionId: string,
    @Args('claimedBy', { type: () => String }) claimedBy: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<SequenceLinkedinActionClaimDTO | null> {
    return this.sequenceLinkedinActionClaimService.claim({
      workspaceId: workspace.id,
      workspaceMemberId,
      actionId,
      claimedBy,
    });
  }

  @Mutation(() => SequenceLinkedinActionMutationResultDTO, { nullable: true })
  async startSequenceLinkedinAction(
    @Args('actionId', { type: () => UUIDScalarType }) actionId: string,
    @Args('claimedBy', { type: () => String }) claimedBy: string,
    @Args('claimedAt', { type: () => GraphQLISODateTime }) claimedAt: Date,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<SequenceLinkedinActionMutationResultDTO | null> {
    return this.sequenceLinkedinActionMutationService.start({
      workspaceId: workspace.id,
      workspaceMemberId,
      actionId,
      claimedBy,
      claimedAt,
    });
  }

  @Mutation(() => SequenceLinkedinActionMutationResultDTO, { nullable: true })
  async reportSequenceLinkedinAction(
    @Args('actionId', { type: () => UUIDScalarType }) actionId: string,
    @Args('claimedBy', { type: () => String }) claimedBy: string,
    @Args('claimedAt', { type: () => GraphQLISODateTime }) claimedAt: Date,
    @Args('data', { type: () => SequenceLinkedinActionReportInput })
    data: SequenceLinkedinActionReportInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<SequenceLinkedinActionMutationResultDTO | null> {
    return this.sequenceLinkedinActionMutationService.report({
      workspaceId: workspace.id,
      workspaceMemberId,
      actionId,
      claimedBy,
      claimedAt,
      data,
    });
  }

  @Mutation(() => SequenceLinkedinActionMutationResultDTO, { nullable: true })
  async releaseSequenceLinkedinActionClaim(
    @Args('actionId', { type: () => UUIDScalarType }) actionId: string,
    @Args('claimedBy', { type: () => String }) claimedBy: string,
    @Args('claimedAt', { type: () => GraphQLISODateTime }) claimedAt: Date,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<SequenceLinkedinActionMutationResultDTO | null> {
    return this.sequenceLinkedinActionMutationService.release({
      workspaceId: workspace.id,
      workspaceMemberId,
      actionId,
      claimedBy,
      claimedAt,
    });
  }
}
