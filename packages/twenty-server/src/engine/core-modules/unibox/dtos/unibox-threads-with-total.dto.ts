import { Field, Int, ObjectType } from '@nestjs/graphql';

import { UniboxThreadDTO } from 'src/engine/core-modules/unibox/dtos/unibox-thread.dto';

@ObjectType('UniboxThreadsWithTotal')
export class UniboxThreadsWithTotalDTO {
  @Field(() => Int)
  totalCount: number;

  @Field(() => [UniboxThreadDTO])
  threads: UniboxThreadDTO[];
}
