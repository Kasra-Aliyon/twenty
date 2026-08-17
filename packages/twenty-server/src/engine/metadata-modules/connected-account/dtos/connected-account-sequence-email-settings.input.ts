import { Field, InputType, Int } from '@nestjs/graphql';

import { IsBoolean, IsInt, Max, Min } from 'class-validator';

@InputType()
export class ConnectedAccountSequenceEmailSettingsInput {
  @IsBoolean()
  @Field(() => Boolean)
  sequenceDailyEmailLimitEnabled: boolean;

  @IsInt()
  @Min(1)
  @Max(200)
  @Field(() => Int)
  sequenceDailyEmailLimit: number;
}
