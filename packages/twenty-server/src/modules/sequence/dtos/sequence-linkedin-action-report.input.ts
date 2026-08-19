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

  // Retained for compatibility with older runner versions. Provider start is
  // established only by startSequenceLinkedinAction and this value is ignored.
  @Field(() => GraphQLISODateTime, {
    nullable: true,
    deprecationReason: 'Provider start time is recorded by the server.',
  })
  executedAt?: Date;
}
