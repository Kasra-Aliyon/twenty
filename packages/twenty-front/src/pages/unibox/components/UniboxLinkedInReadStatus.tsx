import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { format, isValid, parseISO } from 'date-fns';
import { isDefined } from 'twenty-shared/utils';
import { IconEye } from 'twenty-ui/icon';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type LinkedinUniboxMessage } from '@/unibox/types/LinkedinUniboxRecords';

const StyledStatus = styled.span<{ isSeen: boolean }>`
  align-items: center;
  color: ${({ isSeen }) =>
    isSeen
      ? themeCssVariables.color.blue
      : themeCssVariables.font.color.tertiary};
  display: inline-flex;
  font-size: ${themeCssVariables.font.size.xs};
  gap: ${themeCssVariables.spacing[1]};
`;

type UniboxLinkedInReadStatusProps = Pick<
  LinkedinUniboxMessage,
  'direction' | 'recipientReadAt'
>;

export const UniboxLinkedInReadStatus = ({
  direction,
  recipientReadAt,
}: UniboxLinkedInReadStatusProps) => {
  if (direction !== 'OUTBOUND') {
    return null;
  }

  const readDate = isDefined(recipientReadAt)
    ? parseISO(recipientReadAt)
    : null;

  // Missing receipts do not confirm that a recipient has not read a message.
  if (readDate === null || !isValid(readDate)) {
    return (
      <StyledStatus
        isSeen={false}
        title={t`No read receipt has been synced from LinkedIn.`}
      >
        {t`Read status unknown`}
      </StyledStatus>
    );
  }

  const formattedDate = format(readDate, 'd MMM yyyy, HH:mm');

  return (
    <StyledStatus isSeen>
      <IconEye size={14} aria-hidden />
      <span>{t`Seen ${formattedDate}`}</span>
    </StyledStatus>
  );
};
