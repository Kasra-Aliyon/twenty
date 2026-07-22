import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { CoreResolver } from 'src/engine/api/graphql/graphql-config/decorators/core-resolver.decorator';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { AddUniboxContactsToCrmOutputDTO } from 'src/engine/core-modules/unibox/dtos/add-unibox-contacts-to-crm-output.dto';
import { AddUniboxContactsToCrmInput } from 'src/engine/core-modules/unibox/dtos/add-unibox-contacts-to-crm.input';
import { UniboxContactsWithTotalDTO } from 'src/engine/core-modules/unibox/dtos/unibox-contacts-with-total.dto';
import { UniboxContactsInput } from 'src/engine/core-modules/unibox/dtos/unibox-contacts.input';
import { UniboxThreadsWithTotalDTO } from 'src/engine/core-modules/unibox/dtos/unibox-threads-with-total.dto';
import { UniboxThreadsInput } from 'src/engine/core-modules/unibox/dtos/unibox-threads.input';
import { UniboxChannel } from 'src/engine/core-modules/unibox/enums/unibox-channel.enum';
import { UniboxContactsService } from 'src/engine/core-modules/unibox/services/unibox-contacts.service';
import { UniboxEmailThreadsService } from 'src/engine/core-modules/unibox/services/unibox-email-threads.service';
import { UniboxLinkedinThreadsService } from 'src/engine/core-modules/unibox/services/unibox-linkedin-threads.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspaceMemberId } from 'src/engine/decorators/auth/auth-workspace-member-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';

@CoreResolver()
@UsePipes(ResolverValidationPipe)
@UseGuards(WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
export class UniboxResolver {
  constructor(
    private readonly uniboxEmailThreadsService: UniboxEmailThreadsService,
    private readonly uniboxLinkedinThreadsService: UniboxLinkedinThreadsService,
    private readonly uniboxContactsService: UniboxContactsService,
  ) {}

  @Query(() => UniboxThreadsWithTotalDTO)
  async uniboxThreads(
    @Args('input') input: UniboxThreadsInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<UniboxThreadsWithTotalDTO> {
    if (input.channel === UniboxChannel.LINKEDIN) {
      return this.uniboxLinkedinThreadsService.getThreads({
        input,
        workspaceId: workspace.id,
        workspaceMemberId,
      });
    }

    return this.uniboxEmailThreadsService.getThreads({
      input,
      workspaceId: workspace.id,
      userWorkspaceId,
    });
  }

  @Query(() => UniboxContactsWithTotalDTO)
  async uniboxContacts(
    @Args('input') input: UniboxContactsInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ): Promise<UniboxContactsWithTotalDTO> {
    return this.uniboxContactsService.getContacts({
      input,
      workspaceId: workspace.id,
      userWorkspaceId,
    });
  }

  @Mutation(() => AddUniboxContactsToCrmOutputDTO)
  async addUniboxContactsToCrm(
    @Args('input') input: AddUniboxContactsToCrmInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthWorkspaceMemberId() workspaceMemberId: string,
  ): Promise<AddUniboxContactsToCrmOutputDTO> {
    return this.uniboxContactsService.addContactsToCrm({
      input,
      workspaceId: workspace.id,
      userWorkspaceId,
      workspaceMemberId,
    });
  }
}
