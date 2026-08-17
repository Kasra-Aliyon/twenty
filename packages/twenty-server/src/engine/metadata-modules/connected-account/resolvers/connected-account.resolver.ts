import { UseGuards, UseInterceptors, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { ConnectedAccountMetadataService } from 'src/engine/metadata-modules/connected-account/connected-account-metadata.service';
import { ConnectedAccountSequenceEmailSettingsInput } from 'src/engine/metadata-modules/connected-account/dtos/connected-account-sequence-email-settings.input';
import { ConnectedAccountPublicDTO } from 'src/engine/metadata-modules/connected-account/dtos/connected-account-public.dto';
import { ConnectedAccountDTO } from 'src/engine/metadata-modules/connected-account/dtos/connected-account.dto';
import { ConnectedAccountGraphqlApiExceptionInterceptor } from 'src/engine/metadata-modules/connected-account/interceptors/connected-account-graphql-api-exception.interceptor';
import { buildPublicConnectedAccount } from 'src/engine/metadata-modules/connected-account/utils/build-public-connected-account.util';

@UseGuards(WorkspaceAuthGuard)
@UseInterceptors(ConnectedAccountGraphqlApiExceptionInterceptor)
@MetadataResolver(() => ConnectedAccountDTO)
@UsePipes(ResolverValidationPipe)
export class ConnectedAccountResolver {
  constructor(
    private readonly connectedAccountMetadataService: ConnectedAccountMetadataService,
  ) {}

  @Query(() => [ConnectedAccountPublicDTO])
  @UseGuards(NoPermissionGuard)
  async myConnectedAccounts(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<ConnectedAccountPublicDTO[]> {
    const accounts =
      await this.connectedAccountMetadataService.findByUserWorkspaceId({
        userWorkspaceId,
        workspaceId: workspace.id,
      });

    return accounts.map((account) => buildPublicConnectedAccount(account));
  }

  @Mutation(() => ConnectedAccountPublicDTO)
  @UseGuards(NoPermissionGuard)
  async deleteConnectedAccount(
    @Args('id', { type: () => UUIDScalarType }) id: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<ConnectedAccountPublicDTO> {
    await this.connectedAccountMetadataService.verifyOwnership({
      id,
      userWorkspaceId,
      workspaceId: workspace.id,
    });

    const deleted = await this.connectedAccountMetadataService.delete({
      id,
      workspaceId: workspace.id,
    });

    return buildPublicConnectedAccount(deleted);
  }

  @Mutation(() => ConnectedAccountPublicDTO)
  @UseGuards(NoPermissionGuard)
  async updateConnectedAccountSequenceEmailSettings(
    @Args('id', { type: () => UUIDScalarType }) id: string,
    @Args('input') input: ConnectedAccountSequenceEmailSettingsInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<ConnectedAccountPublicDTO> {
    await this.connectedAccountMetadataService.verifyOwnership({
      id,
      userWorkspaceId,
      workspaceId: workspace.id,
    });

    const updated = await this.connectedAccountMetadataService.update({
      id,
      workspaceId: workspace.id,
      data: {
        sequenceDailyEmailLimitEnabled: input.sequenceDailyEmailLimitEnabled,
        sequenceDailyEmailLimit: input.sequenceDailyEmailLimit,
      },
    });

    return buildPublicConnectedAccount(updated);
  }
}
