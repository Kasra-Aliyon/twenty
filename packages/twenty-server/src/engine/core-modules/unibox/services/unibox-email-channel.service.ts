import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { MessageChannelType } from 'twenty-shared/types';
import { In, IsNull, type FindOptionsWhere, type Repository } from 'typeorm';

import { UNIBOX_UNREAD_FOLDER_NAME } from 'src/engine/core-modules/unibox/constants/unibox.constants';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { MessageFolderEntity } from 'src/engine/metadata-modules/message-folder/entities/message-folder.entity';

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
    @InjectRepository(MessageFolderEntity)
    private readonly messageFolderRepository: Repository<MessageFolderEntity>,
  ) {}

  // Message folders live in the core schema while the associations that point at
  // them are workspace entities, so read state has to be resolved to ids here
  // rather than joined across schemas from the thread query.
  async getUnreadFolderIds(channelIds: string[]): Promise<string[]> {
    if (channelIds.length === 0) {
      return [];
    }

    const unreadFolders = await this.messageFolderRepository.find({
      where: {
        messageChannelId: In(channelIds),
        name: UNIBOX_UNREAD_FOLDER_NAME,
      },
      select: { id: true },
    });

    return unreadFolders.map((unreadFolder) => unreadFolder.id);
  }

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
