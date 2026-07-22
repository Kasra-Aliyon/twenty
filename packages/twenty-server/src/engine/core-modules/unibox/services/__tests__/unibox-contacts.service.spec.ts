import { BadRequestException } from '@nestjs/common';

import { RECORD_LIST_TYPES } from 'twenty-shared/types';

import { UniboxContactsService } from 'src/engine/core-modules/unibox/services/unibox-contacts.service';
import { UniboxEmailChannelService } from 'src/engine/core-modules/unibox/services/unibox-email-channel.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { CreateCompanyAndPersonService } from 'src/modules/contact-creation-manager/services/create-company-and-contact.service';
import { MatchParticipantService } from 'src/modules/match-participant/match-participant.service';
import { type MessageParticipantWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message-participant.workspace-entity';

describe('UniboxContactsService', () => {
  it.each([
    ['neither handles nor a filter', {}],
    [
      'both handles and a filter',
      {
        handles: ['person@example.com'],
        filter: {},
      },
    ],
  ])('should reject selections with %s', async (_, input) => {
    const service = new UniboxContactsService(
      {} as GlobalWorkspaceOrmManager,
      {} as UniboxEmailChannelService,
      {} as CreateCompanyAndPersonService,
      {} as MatchParticipantService<MessageParticipantWorkspaceEntity>,
    );

    await expect(
      service.addContactsToCrm({
        input,
        workspaceId: 'workspace-id',
        userWorkspaceId: 'user-workspace-id',
        workspaceMemberId: 'workspace-member-id',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject a non-person list before creating any people', async () => {
    const recordListRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'company-list-id',
        type: RECORD_LIST_TYPES.COMPANY,
      }),
    };
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn((callback: () => Promise<unknown>) =>
        callback(),
      ),
      getRepository: jest.fn().mockResolvedValue(recordListRepository),
    };
    const emailChannelService = {
      getOwnedEmailChannelContext: jest.fn().mockResolvedValue({
        accounts: [],
        channels: [],
        channelIds: ['channel-id'],
        ownedHandles: ['owner@example.com'],
        connectedAccountIdByChannelId: new Map(),
      }),
    };
    const createCompanyAndPersonService = {
      createCompaniesAndPeople: jest.fn(),
    };
    const matchParticipantService = {
      matchParticipantsForPeople: jest.fn(),
    };
    const service = new UniboxContactsService(
      globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
      emailChannelService as unknown as UniboxEmailChannelService,
      createCompanyAndPersonService as unknown as CreateCompanyAndPersonService,
      matchParticipantService as unknown as MatchParticipantService<MessageParticipantWorkspaceEntity>,
    );

    await expect(
      service.addContactsToCrm({
        input: {
          handles: ['Person@Example.com'],
          recordListId: 'company-list-id',
        },
        workspaceId: 'workspace-id',
        userWorkspaceId: 'user-workspace-id',
        workspaceMemberId: 'workspace-member-id',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(
      createCompanyAndPersonService.createCompaniesAndPeople,
    ).not.toHaveBeenCalled();
    expect(
      matchParticipantService.matchParticipantsForPeople,
    ).not.toHaveBeenCalled();
  });
});
