import { styled } from '@linaria/react';
import { format } from 'date-fns';
import { useState } from 'react';
import { generatePath, Link } from 'react-router-dom';
import { AppPath, CoreObjectNameSingular } from 'twenty-shared/types';
import { Avatar } from 'twenty-ui/data-display';
import { IconUserPlus } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { CustomResolverFetchMoreLoader } from '@/activities/components/CustomResolverFetchMoreLoader';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { type Person } from '@/people/types/Person';
import {
  type LinkedinUniboxMessage,
  type LinkedinUniboxParticipant,
} from '@/unibox/types/LinkedinUniboxRecords';
import { type UniboxThread } from '@/unibox/types/UniboxThread';
import { t } from '@lingui/core/macro';
import { splitFullName } from '~/utils/format/spiltFullName';

const StyledRoot = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
`;

const StyledHeader = styled.div`
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledTitle = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.lg};
  font-weight: ${themeCssVariables.font.weight.semiBold};
`;

const StyledParticipants = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledParticipant = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  gap: ${themeCssVariables.spacing[2]};
  max-width: 100%;
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledParticipantText = styled.div`
  min-width: 0;
`;

const StyledParticipantName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledHeadline = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledPersonLink = styled(Link)`
  color: ${themeCssVariables.color.blue};
  font-size: ${themeCssVariables.font.size.xs};
  text-decoration: none;
  white-space: nowrap;
`;

const StyledMessages = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  min-height: 0;
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledMessage = styled.div<{ direction: 'INBOUND' | 'OUTBOUND' }>`
  align-self: ${({ direction }) =>
    direction === 'OUTBOUND' ? 'flex-end' : 'flex-start'};
  background: ${({ direction }) =>
    direction === 'OUTBOUND'
      ? themeCssVariables.background.transparent.blue
      : themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  max-width: 75%;
  padding: ${themeCssVariables.spacing[3]};
`;

const StyledMessageMeta = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${themeCssVariables.font.size.xs};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
`;

const StyledMessageBody = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

const StyledEmpty = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex: 1;
  justify-content: center;
  padding: ${themeCssVariables.spacing[8]};
  text-align: center;
`;

const LINKEDIN_MESSAGE_FIELDS = {
  id: true,
  body: true,
  deliveredAt: true,
  direction: true,
  senderName: true,
  senderLinkedinUrn: true,
  threadId: true,
};

const LINKEDIN_PARTICIPANT_FIELDS = {
  id: true,
  name: true,
  headline: true,
  handle: true,
  linkedinUrn: true,
  profileUrl: true,
  personId: true,
  threadId: true,
};

export const UniboxLinkedInThreadView = ({
  summary,
}: {
  summary: UniboxThread | null;
}) => {
  const [createdPersonIdByParticipantId, setCreatedPersonIdByParticipantId] =
    useState<Record<string, string>>({});
  const { createOneRecord, loading: isCreatingPerson } =
    useCreateOneRecord<Person>({
      objectNameSingular: CoreObjectNameSingular.Person,
      recordGqlFields: { id: true, name: true, linkedinLink: true },
    });
  const {
    records: messages,
    loading: messagesLoading,
    fetchMoreRecords: fetchMoreMessages,
  } = useFindManyRecords<LinkedinUniboxMessage>({
    objectNameSingular: 'linkedinMessage',
    filter: { threadId: { eq: summary?.id ?? '' } },
    orderBy: [{ deliveredAt: 'AscNullsFirst' }],
    recordGqlFields: LINKEDIN_MESSAGE_FIELDS,
    skip: !summary,
  });
  const {
    records: participants,
    loading: participantsLoading,
    refetch: refetchParticipants,
  } = useFindManyRecords<LinkedinUniboxParticipant>({
    objectNameSingular: 'linkedinThreadParticipant',
    filter: {
      and: [{ threadId: { eq: summary?.id ?? '' } }, { isSelf: { eq: false } }],
    },
    orderBy: [{ name: 'AscNullsLast' }],
    recordGqlFields: LINKEDIN_PARTICIPANT_FIELDS,
    skip: !summary,
  });

  if (!summary) {
    return (
      <StyledEmpty>{t`Select a LinkedIn conversation to read it.`}</StyledEmpty>
    );
  }

  const handleAddToTwenty = async (participant: LinkedinUniboxParticipant) => {
    const [firstName, lastName] = splitFullName(participant.name);
    const primaryLinkUrl =
      participant.profileUrl?.primaryLinkUrl ||
      (participant.handle
        ? `https://www.linkedin.com/in/${participant.handle}`
        : '');

    if (!primaryLinkUrl) {
      return;
    }

    const person = await createOneRecord({
      name: { firstName, lastName },
      linkedinLink: {
        primaryLinkLabel: participant.handle || t`LinkedIn`,
        primaryLinkUrl,
      },
    });

    setCreatedPersonIdByParticipantId((currentIds) => ({
      ...currentIds,
      [participant.id]: person.id,
    }));
    await refetchParticipants();
  };

  return (
    <StyledRoot>
      <StyledHeader>
        <StyledTitle>{summary.subject || t`LinkedIn conversation`}</StyledTitle>
        <StyledParticipants>
          {participants.map((participant) => {
            const personId =
              participant.personId ||
              createdPersonIdByParticipantId[participant.id];
            const hasLinkedinProfile = Boolean(
              participant.profileUrl?.primaryLinkUrl || participant.handle,
            );

            return (
              <StyledParticipant key={participant.id}>
                <Avatar
                  placeholder={participant.name}
                  placeholderColorSeed={
                    participant.linkedinUrn || participant.id
                  }
                  size="sm"
                  type="rounded"
                />
                <StyledParticipantText>
                  <StyledParticipantName>
                    {participant.name}
                  </StyledParticipantName>
                  {participant.headline && (
                    <StyledHeadline>{participant.headline}</StyledHeadline>
                  )}
                </StyledParticipantText>
                {personId ? (
                  <StyledPersonLink
                    to={generatePath(AppPath.RecordShowPage, {
                      objectNameSingular: 'person',
                      objectRecordId: personId,
                    })}
                  >
                    {t`In Twenty →`}
                  </StyledPersonLink>
                ) : (
                  <Button
                    title={t`Add to Twenty`}
                    Icon={IconUserPlus}
                    size="small"
                    variant="secondary"
                    isLoading={isCreatingPerson}
                    disabled={!hasLinkedinProfile}
                    onClick={() => void handleAddToTwenty(participant)}
                  />
                )}
              </StyledParticipant>
            );
          })}
          {!participantsLoading && participants.length === 0 && (
            <StyledHeadline>{t`No participants were synced.`}</StyledHeadline>
          )}
        </StyledParticipants>
      </StyledHeader>
      <StyledMessages>
        {messages.map((message) => (
          <StyledMessage key={message.id} direction={message.direction}>
            <StyledMessageMeta>
              <span>{message.senderName || t`LinkedIn member`}</span>
              <span>
                {format(new Date(message.deliveredAt), 'd MMM yyyy, HH:mm')}
              </span>
            </StyledMessageMeta>
            <StyledMessageBody>{message.body}</StyledMessageBody>
          </StyledMessage>
        ))}
        <CustomResolverFetchMoreLoader
          loading={messagesLoading && messages.length > 0}
          onLastRowVisible={fetchMoreMessages}
        />
        {messagesLoading && messages.length === 0 && (
          <StyledEmpty>{t`Loading LinkedIn messages…`}</StyledEmpty>
        )}
        {!messagesLoading && messages.length === 0 && (
          <StyledEmpty>{t`No LinkedIn messages were synced.`}</StyledEmpty>
        )}
      </StyledMessages>
    </StyledRoot>
  );
};
