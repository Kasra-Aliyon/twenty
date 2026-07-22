import { Field, Int, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('AddUniboxContactsToCrmOutput')
export class AddUniboxContactsToCrmOutputDTO {
  @Field(() => Int)
  createdPersonCount: number;

  @Field(() => Int)
  alreadyExistingCount: number;

  @Field(() => [UUIDScalarType])
  personIds: string[];
}
