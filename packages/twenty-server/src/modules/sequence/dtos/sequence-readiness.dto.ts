import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class SequenceReadinessDTO {
  @Field(() => Boolean)
  ready: boolean;

  @Field(() => [String])
  errors: string[];
}
