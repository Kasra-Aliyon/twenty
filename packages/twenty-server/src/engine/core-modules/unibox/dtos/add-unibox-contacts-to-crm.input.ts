import { Field, InputType } from '@nestjs/graphql';

import { Type } from 'class-transformer';

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { UNIBOX_MAX_CONTACTS_TO_ADD } from 'src/engine/core-modules/unibox/constants/unibox.constants';
import { UniboxContactsInput } from 'src/engine/core-modules/unibox/dtos/unibox-contacts.input';

@InputType()
export class AddUniboxContactsToCrmInput {
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(UNIBOX_MAX_CONTACTS_TO_ADD)
  @IsString({ each: true })
  @MaxLength(320, { each: true })
  handles?: string[];

  @Field(() => UniboxContactsInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => UniboxContactsInput)
  filter?: UniboxContactsInput;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(UNIBOX_MAX_CONTACTS_TO_ADD)
  @IsString({ each: true })
  @MaxLength(320, { each: true })
  excludedHandles?: string[];

  @Field(() => UUIDScalarType, { nullable: true })
  @IsOptional()
  @IsUUID()
  recordListId?: string;
}
