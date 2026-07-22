import { Field, GraphQLISODateTime, InputType, Int } from '@nestjs/graphql';

import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import {
  UNIBOX_DEFAULT_PAGE_SIZE,
  UNIBOX_MAX_PAGE_SIZE,
} from 'src/engine/core-modules/unibox/constants/unibox.constants';
import { UniboxChannel } from 'src/engine/core-modules/unibox/enums/unibox-channel.enum';
import { UniboxFolder } from 'src/engine/core-modules/unibox/enums/unibox-folder.enum';

@InputType()
export class UniboxThreadsInput {
  @Field(() => UniboxChannel, {
    nullable: true,
    defaultValue: UniboxChannel.EMAIL,
  })
  @IsOptional()
  @IsEnum(UniboxChannel)
  channel?: UniboxChannel;

  @Field(() => UniboxFolder, {
    nullable: true,
    defaultValue: UniboxFolder.INBOX,
  })
  @IsOptional()
  @IsEnum(UniboxFolder)
  folder?: UniboxFolder;

  @Field(() => [UUIDScalarType], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  connectedAccountIds?: string[];

  @Field(() => UUIDScalarType, { nullable: true })
  @IsOptional()
  @IsUUID()
  recordListId?: string;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  onlyCrmContacts?: boolean;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateFrom?: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  afterLastMessageAt?: Date;

  @Field(() => UUIDScalarType, { nullable: true })
  @IsOptional()
  @IsUUID()
  afterThreadId?: string;

  @Field(() => Int, { nullable: true, defaultValue: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @Field(() => Int, {
    nullable: true,
    defaultValue: UNIBOX_DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(UNIBOX_MAX_PAGE_SIZE)
  pageSize?: number;
}
