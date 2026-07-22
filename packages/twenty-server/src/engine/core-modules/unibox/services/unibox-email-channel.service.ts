import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { MessageChannelType } from 'twenty-shared/types';
import { In, IsNull, type FindOptionsWhere, type Repository } from 'typeorm';

import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';

export type OwnedEmailChannelContext = {
  accounts: ConnectedAccountEntity[];
  channels: MessageChannelEntity[];
  channelIds: string[];
  ownedHandles: string[];
  connectedAccountIdByChannelId: Map<string, string>;
};

type GetOwnedEmailChannelContextArgs = {
  workspaceId: string;
  userWorkspaceId: string;
  connectedAccountIds?: string[];
};

@Injectable()
export class UniboxEmailChannelService {
  constructor(
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
  ) {}

  async getOwnedEmailChannelContext({
    workspaceId,
    userWorkspaceId,
    connectedAccountIds,
  }: GetOwnedEmailChannelContextArgs): Promise<OwnedEmailChannelContext> {
    const accountWhere: FindOptionsWhere<ConnectedAccountEntity> = {
      workspaceId,
      userWorkspaceId,
      archivedAt: IsNull(),
    };

    if (connectedAccountIds?.length) {
      accountWhere.id = In(connectedAccountIds);
    }

    const accounts = await this.connectedAccountRepository.find({
      where: accountWhere,
    });

    if (accounts.length === 0) {
      return {
        accounts: [],
        channels: [],
        channelIds: [],
        ownedHandles: [],
        connectedAccountIdByChannelId: new Map(),
      };
    }

    const channels = await this.messageChannelRepository.find({
      where: {
        workspaceId,
        connectedAccountId: In(accounts.map((account) => account.id)),
        type: MessageChannelType.EMAIL,
      },
    });

    const ownedHandles = [
      ...accounts.flatMap((account) => [
        account.handle,
        ...(account.handleAliases ?? []),
      ]),
      ...channels.map((channel) => channel.handle),
    ]
      .map((handle) => handle.trim().toLowerCase())
      .filter((handle) => handle.length > 0);

    return {
      accounts,
      channels,
      channelIds: channels.map((channel) => channel.id),
      ownedHandles: [...new Set(ownedHandles)],
      connectedAccountIdByChannelId: new Map(
        channels.map((channel) => [channel.id, channel.connectedAccountId]),
      ),
    };
  }
}
