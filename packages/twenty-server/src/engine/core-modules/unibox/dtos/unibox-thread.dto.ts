import { Field, GraphQLISODateTime, Int, ObjectType } from '@nestjs/graphql';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { UniboxThreadParticipantDTO } from 'src/engine/core-modules/unibox/dtos/unibox-thread-participant.dto';
import { UniboxChannel } from 'src/engine/core-modules/unibox/enums/unibox-channel.enum';

@ObjectType('UniboxThread')
export class UniboxThreadDTO {
  @Field(() => UUIDScalarType)
  id: string;

  @Field(() => UniboxChannel)
  channel: UniboxChannel;

  @Field(() => String)
  subject: string;

  @Field(() => String)
  lastMessagePreview: string;

  @Field(() => GraphQLISODateTime)
  lastMessageAt: Date;

  @Field(() => Int)
  messageCount: number;

  @Field(() => Boolean)
  isRead: boolean;

  @Field(() => [UniboxThreadParticipantDTO])
  participants: UniboxThreadParticipantDTO[];

  @Field(() => Boolean)
  hasCrmContact: boolean;

  @Field(() => UUIDScalarType, { nullable: true })
  connectedAccountId: string | null;
}
