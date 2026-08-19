import { Field, GraphQLISODateTime, InputType } from '@nestjs/graphql';

import {
  type LinkedInActionStatus,
  type LinkedInConnectionState,
} from 'twenty-shared/types';

@InputType('SequenceLinkedinActionReportInput')
export class SequenceLinkedinActionReportInput {
  @Field(() => String)
  status: LinkedInActionStatus;

  @Field(() => String)
  connectionState: LinkedInConnectionState;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  executedAt?: Date;
}
