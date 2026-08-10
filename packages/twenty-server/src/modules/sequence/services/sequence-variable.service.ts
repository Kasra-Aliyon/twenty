import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

export type SequenceTemplateVariables = Record<string, string>;

@Injectable()
export class SequenceVariableService {
  constructor(
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
  ) {}

  async buildVariables({
    workspaceId,
    person,
    connectedAccountId,
  }: {
    workspaceId: string;
    person: PersonWorkspaceEntity;
    connectedAccountId: string | null;
  }): Promise<SequenceTemplateVariables> {
    const connectedAccount = isDefined(connectedAccountId)
      ? await this.connectedAccountRepository.findOne({
          where: { id: connectedAccountId, workspaceId },
          select: { handle: true, name: true },
        })
      : null;
    const firstName = person.name?.firstName ?? '';
    const lastName = person.name?.lastName ?? '';

    return {
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' '),
      email: person.emails?.primaryEmail ?? '',
      linkedinUrl: person.linkedinLink?.primaryLinkUrl ?? '',
      jobTitle: person.jobTitle ?? '',
      companyName: person.company?.name ?? '',
      senderName: connectedAccount?.name ?? connectedAccount?.handle ?? '',
      senderEmail: connectedAccount?.handle ?? '',
    };
  }
}
