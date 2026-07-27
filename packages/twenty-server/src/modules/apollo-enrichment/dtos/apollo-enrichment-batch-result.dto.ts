import { Field, Int, ObjectType } from '@nestjs/graphql';

import { type ApolloEnrichmentBatchResult } from 'src/modules/apollo-enrichment/services/apollo-enrichment.service';

@ObjectType()
export class ApolloEnrichmentBatchResultDTO implements ApolloEnrichmentBatchResult {
  @Field(() => Int)
  requestedCount: number;

  @Field(() => Int)
  updatedCount: number;

  @Field(() => Int)
  skippedCount: number;

  @Field(() => Int)
  notMatchedCount: number;

  @Field(() => Int)
  notFoundCount: number;

  @Field(() => Int)
  failedCount: number;

  @Field(() => Boolean)
  disabled: boolean;
}
