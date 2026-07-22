import { registerEnumType } from '@nestjs/graphql';

export enum UniboxFolder {
  INBOX = 'INBOX',
  SENT = 'SENT',
  DRAFT = 'DRAFT',
}

registerEnumType(UniboxFolder, {
  name: 'UniboxFolder',
});
