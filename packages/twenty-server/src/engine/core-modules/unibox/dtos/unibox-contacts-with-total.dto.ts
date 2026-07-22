import { Field, Int, ObjectType } from '@nestjs/graphql';

import { UniboxContactDTO } from 'src/engine/core-modules/unibox/dtos/unibox-contact.dto';

@ObjectType('UniboxContactsWithTotal')
export class UniboxContactsWithTotalDTO {
  @Field(() => Int)
  totalCount: number;

  @Field(() => [UniboxContactDTO])
  contacts: UniboxContactDTO[];
}
