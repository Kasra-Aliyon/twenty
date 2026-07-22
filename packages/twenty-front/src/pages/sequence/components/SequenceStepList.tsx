import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
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
import { useEffect } from 'react';
import {
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  TASK_PRIORITIES,
  type SequenceStepSettings,
  type SequenceStepType,
} from 'twenty-shared/types';
import {
  IconBrandLinkedin,
  IconClock,
  IconListCheck,
  IconMail,
  IconMessage,
  IconPlus,
  IconUserMinus,
} from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { StyledEmptyState } from './SequencePageStyles';
import { SequenceStepCard } from './SequenceStepCard';

const ADD_STEP_DROPDOWN_ID = 'sequence-add-step';
const SEQUENCE_STEPS_PAGE_SIZE = 50;

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
`;

const StyledListHeader = styled.div`
  align-items: center;
  display: flex;
  justify-content: flex-end;
`;

const StyledStructureNotice = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const getDefaultStepSettings = (
  type: SequenceStepType,
): SequenceStepSettings => {
  switch (type) {
    case SEQUENCE_STEP_TYPES.SEND_EMAIL:
      return {
        type,
        subject: '',
        bodyHtml: '',
        threadAsReplyToPreviousEmail: false,
        stopOnReply: null,
      };
    case SEQUENCE_STEP_TYPES.DELAY:
      return { type, days: 1, hours: 0, minutes: 0 };
    case SEQUENCE_STEP_TYPES.CREATE_TASK:
      return {
        type,
        taskType: SEQUENCE_TASK_TYPES.TODO,
        titleTemplate: 'Follow up with {{ fullName }}',
        notesTemplate: '',
        priority: TASK_PRIORITIES.MEDIUM,
        assigneeWorkspaceMemberId: null,
        continueMode: 'ON_DONE',
        deadlineDays: null,
      };
    case SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST:
      return {
        type,
        noteTemplate: '',
        skipIfAlreadyConnected: true,
      };
    case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
      return {
        type,
        messageTemplate: '',
      };
    case SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST:
      return {
        type,
        withdrawAfterDays: 7,
        withdrawAfterHours: 0,
      };
  }
};

type SequenceStepListProps = {
  sequenceId: string;
  isStructureLocked: boolean;
  canAddOrReorder: boolean;
  canUpdateSteps: boolean;
  canDeleteSteps: boolean;
};

export const SequenceStepList = ({
  sequenceId,
  isStructureLocked,
  canAddOrReorder,
  canUpdateSteps,
  canDeleteSteps,
}: SequenceStepListProps) => {
  const { closeDropdown } = useCloseDropdown();
  const { enqueueErrorSnackBar } = useSnackBar();
  const { updateOneRecord } = useUpdateOneRecord();
  const { createOneRecord, loading: isCreating } =
    useCreateOneRecord<SequenceStepRecord>({
      objectNameSingular: 'sequenceStep',
      skipPostOptimisticEffect: true,
    });
  const {
    records: steps,
    refetch,
    fetchMoreRecords,
    hasNextPage,
    loading,
  } = useFindManyRecords<SequenceStepRecord>({
    objectNameSingular: 'sequenceStep',
    filter: { sequenceId: { eq: sequenceId } },
    orderBy: [{ position: 'AscNullsLast' }],
    recordGqlFields: {
      id: true,
      name: true,
      sequenceId: true,
      type: true,
      position: true,
      settings: true,
    },
    limit: SEQUENCE_STEPS_PAGE_SIZE,
  });

  useEffect(() => {
    if (hasNextPage && !loading) {
      void fetchMoreRecords();
    }
  }, [fetchMoreRecords, hasNextPage, loading]);

  const sortedSteps = steps
    .slice()
    .sort((first, second) => first.position - second.position);

  const addStep = async (type: SequenceStepType) => {
    if (!canAddOrReorder) {
      return;
    }

    closeDropdown(ADD_STEP_DROPDOWN_ID);

    try {
      const nextPosition = sortedSteps.reduce(
        (position, step) => Math.max(position, step.position + 1),
        0,
      );
      await createOneRecord({
        sequenceId,
        name: null,
        type,
        position: nextPosition,
        settings: getDefaultStepSettings(type),
      });
      await refetch();
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence step could not be added.`,
      });
    }
  };

  const swapSteps = async (
    firstStep: SequenceStepRecord,
    secondStep: SequenceStepRecord,
  ) => {
    if (!canAddOrReorder) {
      return;
    }

    try {
      await Promise.all([
        updateOneRecord<SequenceStepRecord>({
          objectNameSingular: 'sequenceStep',
          idToUpdate: firstStep.id,
          updateOneRecordInput: { position: secondStep.position },
        }),
        updateOneRecord<SequenceStepRecord>({
          objectNameSingular: 'sequenceStep',
          idToUpdate: secondStep.id,
          updateOneRecordInput: { position: firstStep.position },
        }),
      ]);
      await refetch();
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence steps could not be reordered.`,
      });
    }
  };

  return (
    <StyledContainer>
      <StyledListHeader>
        <Dropdown
          dropdownId={ADD_STEP_DROPDOWN_ID}
          dropdownPlacement="bottom-end"
          clickableComponent={
            <Button
              title={t`Add step`}
              Icon={IconPlus}
              size="small"
              isLoading={isCreating}
              disabled={!canAddOrReorder}
            />
          }
          dropdownComponents={
            <DropdownContent widthInPixels={GenericDropdownContentWidth.Large}>
              <DropdownMenuItemsContainer>
                <MenuItem
                  LeftIcon={IconMail}
                  text={t`Send email`}
                  onClick={() => void addStep(SEQUENCE_STEP_TYPES.SEND_EMAIL)}
                />
                <MenuItem
                  LeftIcon={IconClock}
                  text={t`Wait`}
                  onClick={() => void addStep(SEQUENCE_STEP_TYPES.DELAY)}
                />
                <MenuItem
                  LeftIcon={IconListCheck}
                  text={t`Create task`}
                  onClick={() => void addStep(SEQUENCE_STEP_TYPES.CREATE_TASK)}
                />
                <MenuItem
                  LeftIcon={IconBrandLinkedin}
                  text={t`Send LinkedIn connection request`}
                  onClick={() =>
                    void addStep(SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST)
                  }
                />
                <MenuItem
                  LeftIcon={IconMessage}
                  text={t`Send LinkedIn message`}
                  onClick={() =>
                    void addStep(SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE)
                  }
                />
                <MenuItem
                  LeftIcon={IconUserMinus}
                  text={t`Withdraw LinkedIn connection request`}
                  onClick={() =>
                    void addStep(
                      SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST,
                    )
                  }
                />
              </DropdownMenuItemsContainer>
            </DropdownContent>
          }
        />
      </StyledListHeader>

      {isStructureLocked && (
        <StyledStructureNotice>
          {t`Finish or remove active enrollments before adding, deleting, or reordering steps.`}
        </StyledStructureNotice>
      )}

      {sortedSteps.length === 0 ? (
        <StyledEmptyState>
          {t`Add an email, wait, task, or LinkedIn step to build this sequence.`}
        </StyledEmptyState>
      ) : (
        sortedSteps.map((step, index) => (
          <SequenceStepCard
            key={step.id}
            step={step}
            stepNumber={index + 1}
            canMoveUp={canAddOrReorder && index > 0}
            canMoveDown={canAddOrReorder && index < sortedSteps.length - 1}
            canDelete={canDeleteSteps}
            isEditable={canUpdateSteps}
            onMoveUp={() => swapSteps(step, sortedSteps[index - 1])}
            onMoveDown={() => swapSteps(step, sortedSteps[index + 1])}
            onDeleted={async () => {
              await refetch();
            }}
          />
        ))
      )}
    </StyledContainer>
  );
};
