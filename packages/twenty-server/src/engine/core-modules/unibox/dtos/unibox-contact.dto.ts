import { Field, GraphQLISODateTime, Int, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('UniboxContact')
export class UniboxContactDTO {
  @Field(() => String)
  handle: string;

  @Field(() => String)
  displayName: string;

  @Field(() => String, { nullable: true })
  secondaryLabel: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  personId: string | null;

  @Field(() => Int)
  messageCount: number;

  @Field(() => GraphQLISODateTime)
  lastContactedAt: Date;

  @Field(() => GraphQLISODateTime)
  firstContactedAt: Date;
}
