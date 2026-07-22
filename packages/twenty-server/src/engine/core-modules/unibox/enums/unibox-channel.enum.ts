import { registerEnumType } from '@nestjs/graphql';

export enum UniboxChannel {
  EMAIL = 'EMAIL',
  LINKEDIN = 'LINKEDIN',
}

registerEnumType(UniboxChannel, {
  name: 'UniboxChannel',
});
