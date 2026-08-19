import { Field, GraphQLISODateTime, ObjectType } from '@nestjs/graphql';

import {
  type LinkedInActionStatus,
  type LinkedInConnectionState,
} from 'twenty-shared/types';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('SequenceLinkedinActionMutationResult')
export class SequenceLinkedinActionMutationResultDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  type: string;

  @Field(() => String)
  status: LinkedInActionStatus;

  @Field(() => GraphQLISODateTime)
  scheduledAt: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  claimedAt: Date | null;

  @Field(() => String, { nullable: true })
  claimedBy: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  executedAt: Date | null;

  @Field(() => String)
  linkedinUrl: string;

  @Field(() => String)
  noteText: string;

  @Field(() => String)
  connectionState: LinkedInConnectionState;

  @Field(() => String, { nullable: true })
  errorMessage: string | null;
}
