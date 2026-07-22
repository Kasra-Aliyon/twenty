import { Field, GraphQLISODateTime, InputType, Int } from '@nestjs/graphql';

import { Type } from 'class-transformer';

import {
  IsEnum,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  UNIBOX_DEFAULT_PAGE_SIZE,
  UNIBOX_MAX_PAGE_SIZE,
} from 'src/engine/core-modules/unibox/constants/unibox.constants';
import { UniboxContactCrmFilter } from 'src/engine/core-modules/unibox/enums/unibox-contact-crm-filter.enum';
import { UniboxContactSince } from 'src/engine/core-modules/unibox/enums/unibox-contact-since.enum';

@InputType()
export class UniboxContactsInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @Field(() => UniboxContactSince, {
    nullable: true,
    defaultValue: UniboxContactSince.LIFETIME,
  })
  @IsOptional()
  @IsEnum(UniboxContactSince)
  since?: UniboxContactSince;

  @Field(() => UniboxContactCrmFilter, {
    nullable: true,
    defaultValue: UniboxContactCrmFilter.NOT_IN_CRM,
  })
  @IsOptional()
  @IsEnum(UniboxContactCrmFilter)
  inCrmFilter?: UniboxContactCrmFilter;

  @Field(() => GraphQLISODateTime, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  afterLastContactedAt?: Date;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  afterHandle?: string;

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
