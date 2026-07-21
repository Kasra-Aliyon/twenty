import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_WAITING_ON,
  type SequenceEnrollmentStatus,
} from 'twenty-shared/types';
import {
  IconCircleX,
  IconDotsVertical,
  IconMessage,
  IconPlayerPlay,
} from 'twenty-ui/icon';
import { LightIconButton } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { beautifyExactDateTime } from '~/utils/date-utils';

import {
  type SequenceEnrollmentRecord,
  type SequenceStepRecord,
} from '../types/SequenceRecords';
import { StyledEmptyState, StyledPill } from './SequencePageStyles';

const StyledTableContainer = styled.div`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  overflow: auto;
`;

const StyledTable = styled.table`
  border-collapse: collapse;
  min-width: 840px;
  width: 100%;
`;

const StyledHeaderCell = styled.th`
  border-bottom: 1px solid ${themeCssVariables.border.color.medium};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  font-weight: ${themeCssVariables.font.weight.medium};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
  text-align: left;
`;

const StyledCell = styled.td`
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

const StyledPersonName = styled.div`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledPersonEmail = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
`;

const STATUS_LABELS: Record<SequenceEnrollmentStatus, string> = {
  [SEQUENCE_ENROLLMENT_STATUSES.PENDING]: t`Pending`,
  [SEQUENCE_ENROLLMENT_STATUSES.ACTIVE]: t`Active`,
  [SEQUENCE_ENROLLMENT_STATUSES.COMPLETED]: t`Completed`,
  [SEQUENCE_ENROLLMENT_STATUSES.REPLIED]: t`Replied`,
  [SEQUENCE_ENROLLMENT_STATUSES.FAILED]: t`Failed`,
  [SEQUENCE_ENROLLMENT_STATUSES.REMOVED]: t`Removed`,
};

type EnrollmentActionsProps = {
  enrollment: SequenceEnrollmentRecord;
  onUpdated: () => Promise<void>;
  canUpdate: boolean;
};

const EnrollmentActions = ({
  enrollment,
  onUpdated,
  canUpdate,
}: EnrollmentActionsProps) => {
  const dropdownId = `sequence-enrollment-actions-${enrollment.id}`;
  const { closeDropdown } = useCloseDropdown();
  const { updateOneRecord } = useUpdateOneRecord();
  const { enqueueErrorSnackBar } = useSnackBar();

  const updateEnrollment = async (
    updateOneRecordInput: Partial<SequenceEnrollmentRecord>,
  ) => {
    closeDropdown(dropdownId);

    try {
      await updateOneRecord<SequenceEnrollmentRecord>({
        objectNameSingular: 'sequenceEnrollment',
        idToUpdate: enrollment.id,
        updateOneRecordInput,
      });
      await onUpdated();
    } catch {
      enqueueErrorSnackBar({
        message: t`The enrollment could not be updated.`,
      });
    }
  };

  const isOpen =
    enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.PENDING ||
    enrollment.status === SEQUENCE_ENROLLMENT_STATUSES.ACTIVE;

  return (
    <Dropdown
      dropdownId={dropdownId}
      dropdownPlacement="bottom-end"
      clickableComponent={
        <LightIconButton
          Icon={IconDotsVertical}
          title={t`Enrollment actions`}
          accent="tertiary"
        />
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.Large}>
          <DropdownMenuItemsContainer>
            <MenuItem
              LeftIcon={IconMessage}
              text={t`Mark as replied`}
              disabled={!canUpdate || !isOpen}
              onClick={() =>
                void updateEnrollment({
                  status: SEQUENCE_ENROLLMENT_STATUSES.REPLIED,
                  endedAt: new Date().toISOString(),
                })
              }
            />
            <MenuItem
              LeftIcon={IconPlayerPlay}
              text={t`Skip to the next step now`}
              disabled={
                !canUpdate ||
                enrollment.status !== SEQUENCE_ENROLLMENT_STATUSES.ACTIVE
              }
              onClick={() =>
                void updateEnrollment({
                  waitingOn: SEQUENCE_WAITING_ON.DELAY,
                  nextActionAt: new Date().toISOString(),
                })
              }
            />
            <MenuItem
              LeftIcon={IconCircleX}
              text={t`Remove from sequence`}
              disabled={!canUpdate || !isOpen}
              onClick={() =>
                void updateEnrollment({
                  status: SEQUENCE_ENROLLMENT_STATUSES.REMOVED,
                  endedAt: new Date().toISOString(),
                })
              }
            />
          </DropdownMenuItemsContainer>
        </DropdownContent>
      }
    />
  );
};

type SequenceContactsTableProps = {
  sequenceId: string;
  canUpdate: boolean;
  onEnrollmentUpdated: () => Promise<void>;
};

export const SequenceContactsTable = ({
  sequenceId,
  canUpdate,
  onEnrollmentUpdated,
}: SequenceContactsTableProps) => {
  const { records: enrollments, refetch } =
    useFindManyRecords<SequenceEnrollmentRecord>({
      objectNameSingular: 'sequenceEnrollment',
      filter: { sequenceId: { eq: sequenceId } },
      orderBy: [{ createdAt: 'DescNullsLast' }],
      recordGqlFields: {
        id: true,
        createdAt: true,
        sequenceId: true,
        personId: true,
        status: true,
        currentStepId: true,
        currentStepPosition: true,
        waitingOn: true,
        nextActionAt: true,
        senderConnectedAccountId: true,
        stopOnReply: true,
        startedAt: true,
        endedAt: true,
        errorMessage: true,
        person: {
          id: true,
          name: true,
          emails: true,
        },
      },
      limit: QUERY_MAX_RECORDS,
    });
  const { records: steps } = useFindManyRecords<SequenceStepRecord>({
    objectNameSingular: 'sequenceStep',
    filter: { sequenceId: { eq: sequenceId } },
    orderBy: [{ position: 'AscNullsLast' }],
    recordGqlFields: {
      id: true,
      position: true,
    },
    limit: QUERY_MAX_RECORDS,
  });
  const stepNumberById = new Map(
    steps
      .slice()
      .sort((first, second) => first.position - second.position)
      .map((step, index) => [step.id, index + 1]),
  );

  if (enrollments.length === 0) {
    return (
      <StyledEmptyState>
        {t`Select people from the People page and add them to this sequence.`}
      </StyledEmptyState>
    );
  }

  return (
    <StyledTableContainer>
      <StyledTable>
        <thead>
          <tr>
            <StyledHeaderCell>{t`Contact`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Status`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Current step`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Waiting on`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Next action`}</StyledHeaderCell>
            <StyledHeaderCell>{t`Error`}</StyledHeaderCell>
            <StyledHeaderCell aria-label={t`Actions`} />
          </tr>
        </thead>
        <tbody>
          {enrollments.map((enrollment) => {
            const fullName = enrollment.person
              ? `${enrollment.person.name.firstName} ${enrollment.person.name.lastName}`.trim()
              : '';
            const email = enrollment.person?.emails.primaryEmail ?? '';

            return (
              <tr key={enrollment.id}>
                <StyledCell>
                  <StyledPersonName>
                    {fullName || email || t`Unknown contact`}
                  </StyledPersonName>
                  {fullName && email && (
                    <StyledPersonEmail>{email}</StyledPersonEmail>
                  )}
                </StyledCell>
                <StyledCell>
                  <StyledPill>{STATUS_LABELS[enrollment.status]}</StyledPill>
                </StyledCell>
                <StyledCell>
                  {enrollment.currentStepId
                    ? (stepNumberById.get(enrollment.currentStepId) ?? '—')
                    : '—'}
                </StyledCell>
                <StyledCell>{enrollment.waitingOn ?? '—'}</StyledCell>
                <StyledCell>
                  {enrollment.nextActionAt
                    ? beautifyExactDateTime(enrollment.nextActionAt)
                    : '—'}
                </StyledCell>
                <StyledCell>{enrollment.errorMessage ?? '—'}</StyledCell>
                <StyledCell>
                  <EnrollmentActions
                    enrollment={enrollment}
                    canUpdate={canUpdate}
                    onUpdated={async () => {
                      await Promise.all([refetch(), onEnrollmentUpdated()]);
                    }}
                  />
                </StyledCell>
              </tr>
            );
          })}
        </tbody>
      </StyledTable>
    </StyledTableContainer>
  );
};
