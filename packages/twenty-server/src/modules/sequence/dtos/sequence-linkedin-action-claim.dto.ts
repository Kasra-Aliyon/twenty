import { Field, GraphQLISODateTime, ObjectType } from '@nestjs/graphql';

import { type LinkedInActionStatus } from 'twenty-shared/types';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('SequenceLinkedinActionClaim')
export class SequenceLinkedinActionClaimDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => String)
  type: string;

  @Field(() => String)
  status: LinkedInActionStatus;

  @Field(() => GraphQLISODateTime)
  scheduledAt: Date;

  @Field(() => GraphQLISODateTime)
  claimedAt: Date;

  @Field(() => String)
  claimedBy: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  executedAt: Date | null;

  @Field(() => String)
  linkedinUrl: string;

  @Field(() => String)
  noteText: string;
}
