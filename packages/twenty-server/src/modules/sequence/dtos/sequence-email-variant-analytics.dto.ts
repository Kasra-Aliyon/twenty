import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType()
export class SequenceEmailVariantAnalyticsDTO {
  @Field(() => UUIDScalarType)
  stepId: string;

  @Field()
  stepName: string;

  @Field()
  variantId: string;

  @Field()
  variantName: string;

  @Field(() => Int)
  sentCount: number;

  @Field(() => Int)
  repliedCount: number;

  @Field(() => Float, {
    description: 'Reply rate as a percentage from 0 to 100.',
  })
  replyRate: number;
}
