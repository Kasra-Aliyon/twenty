import { Field, InputType } from '@nestjs/graphql';

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { UNIBOX_MAX_CONTACTS_TO_ADD } from 'src/engine/core-modules/unibox/constants/unibox.constants';

@InputType()
export class AddUniboxContactsToCrmInput {
  @Field(() => [String])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(UNIBOX_MAX_CONTACTS_TO_ADD)
  @IsString({ each: true })
  @MaxLength(320, { each: true })
  handles: string[];

  @Field(() => UUIDScalarType, { nullable: true })
  @IsOptional()
  @IsUUID()
  recordListId?: string;
}
