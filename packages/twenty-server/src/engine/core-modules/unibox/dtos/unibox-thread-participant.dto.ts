import { Field, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('UniboxThreadParticipant')
export class UniboxThreadParticipantDTO {
  @Field(() => String)
  displayName: string;

  @Field(() => String)
  handle: string;

  @Field(() => String, { nullable: true })
  avatarUrl: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  personId: string | null;
}
