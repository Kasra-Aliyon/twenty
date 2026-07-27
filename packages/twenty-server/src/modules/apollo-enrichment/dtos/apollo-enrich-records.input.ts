import { Field, InputType } from '@nestjs/graphql';

import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsUUID,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

export const APOLLO_ENRICHMENT_MAX_RECORDS_PER_REQUEST = 100;

@InputType()
export class ApolloEnrichRecordsInput {
  @Field(() => [UUIDScalarType])
  @ArrayMinSize(1)
  @ArrayMaxSize(APOLLO_ENRICHMENT_MAX_RECORDS_PER_REQUEST)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  recordIds: string[];
}
