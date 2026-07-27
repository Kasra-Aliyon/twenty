import { UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation } from '@nestjs/graphql';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { ApolloEnrichRecordsInput } from 'src/modules/apollo-enrichment/dtos/apollo-enrich-records.input';
import { ApolloEnrichmentBatchResultDTO } from 'src/modules/apollo-enrichment/dtos/apollo-enrichment-batch-result.dto';
import { ApolloEnrichmentService } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';

@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseGuards(WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
export class ApolloEnrichmentResolver {
  constructor(
    private readonly apolloEnrichmentService: ApolloEnrichmentService,
  ) {}

  @Mutation(() => ApolloEnrichmentBatchResultDTO)
  async enrichPeopleWithApollo(
    @Args('input') input: ApolloEnrichRecordsInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<ApolloEnrichmentBatchResultDTO> {
    return this.apolloEnrichmentService.enrichPeople({
      workspaceId: workspace.id,
      personIds: input.recordIds,
      mode: 'general',
      authContext: getWorkspaceAuthContext(),
    });
  }

  @Mutation(() => ApolloEnrichmentBatchResultDTO)
  async enrichPeoplePhonesWithApollo(
    @Args('input') input: ApolloEnrichRecordsInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<ApolloEnrichmentBatchResultDTO> {
    return this.apolloEnrichmentService.enrichPeople({
      workspaceId: workspace.id,
      personIds: input.recordIds,
      mode: 'phone',
      authContext: getWorkspaceAuthContext(),
    });
  }

  @Mutation(() => ApolloEnrichmentBatchResultDTO)
  async enrichCompaniesWithApollo(
    @Args('input') input: ApolloEnrichRecordsInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<ApolloEnrichmentBatchResultDTO> {
    return this.apolloEnrichmentService.enrichCompanies({
      workspaceId: workspace.id,
      companyIds: input.recordIds,
      authContext: getWorkspaceAuthContext(),
    });
  }
}
