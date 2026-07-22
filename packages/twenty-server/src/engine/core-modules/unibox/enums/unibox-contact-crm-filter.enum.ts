import { registerEnumType } from '@nestjs/graphql';

export enum UniboxContactCrmFilter {
  NOT_IN_CRM = 'NOT_IN_CRM',
  IN_CRM = 'IN_CRM',
  ALL = 'ALL',
}

registerEnumType(UniboxContactCrmFilter, {
  name: 'UniboxContactCrmFilter',
});
