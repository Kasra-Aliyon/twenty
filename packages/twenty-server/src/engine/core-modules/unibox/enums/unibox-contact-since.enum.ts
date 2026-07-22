import { registerEnumType } from '@nestjs/graphql';

export enum UniboxContactSince {
  LIFETIME = 'LIFETIME',
  LAST_YEAR = 'LAST_YEAR',
  LAST_90_DAYS = 'LAST_90_DAYS',
  LAST_30_DAYS = 'LAST_30_DAYS',
}

registerEnumType(UniboxContactSince, {
  name: 'UniboxContactSince',
});
