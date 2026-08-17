import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import { SequenceEmailVariantAnalyticsDTO } from 'src/modules/sequence/dtos/sequence-email-variant-analytics.dto';

@ObjectType()
export class SequenceAnalyticsDTO {
  @Field(() => Int)
  enrolledCount: number;

  @Field(() => Int)
  contactedCount: number;

  @Field(() => Int)
  sentEmailCount: number;

  @Field(() => Int)
  repliedCount: number;

  @Field(() => Int)
  completedCount: number;

  @Field(() => Int)
  failedCount: number;

  @Field(() => Float, {
    description:
      'Percentage of enrolled contacts with an observed email or LinkedIn reply, from 0 to 100.',
  })
  replyRate: number;

  @Field(() => [SequenceEmailVariantAnalyticsDTO])
  emailVariants: SequenceEmailVariantAnalyticsDTO[];
}
