import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class SequenceMutationCapabilitiesDTO {
  @Field(() => Boolean)
  atomicSettingsPatch: boolean;

  @Field(() => Int)
  atomicSettingsPatchVersion: number;

  @Field(() => Boolean)
  atomicStepAppend: boolean;

  @Field(() => Int)
  atomicStepAppendVersion: number;

  @Field(() => Boolean)
  enrollmentStartStep: boolean;

  @Field(() => Int)
  enrollmentStartStepVersion: number;
}
