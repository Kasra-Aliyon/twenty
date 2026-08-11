import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useDeleteOneRecord } from '@/object-record/hooks/useDeleteOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useEffect, useState } from 'react';
import {
  SEQUENCE_STEP_TYPES,
  type SequenceConditionType,
  type SequenceStepBranch,
  type SequenceStepType,
  type SequenceTaskType,
} from 'twenty-shared/types';
import { IconPlayerPlay, IconPlus } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { type SequenceStepRecord } from '../types/SequenceRecords';
import { getDefaultSequenceStepSettings } from '../utils/get-default-sequence-step-settings';
import { getSequenceStepStorageType } from '../utils/get-sequence-step-storage-type';
import { SequenceConditionBranches } from './SequenceConditionBranches';
import { SequenceStepCard } from './SequenceStepCard';
import { SequenceStepEditorPanel } from './SequenceStepEditorPanel';
import {
  SequenceStepPalette,
  type SequenceStepPaletteOption,
} from './SequenceStepPalette';

const SEQUENCE_STEPS_PAGE_SIZE = 50;

const StyledBuilder = styled.div<{ hasOpenPanel: boolean }>`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: grid;
  flex: 1;
  grid-template-columns: ${({ hasOpenPanel }) =>
    hasOpenPanel ? 'minmax(0, 1fr) minmax(360px, 440px)' : 'minmax(0, 1fr)'};
  min-height: min(720px, calc(100vh - 230px));
  overflow: hidden;
`;

const StyledCanvas = styled.div`
  background-color: ${themeCssVariables.background.primary};
  background-image: radial-gradient(
    ${themeCssVariables.border.color.medium} 0.8px,
    transparent 0.8px
  );
  background-size: 18px 18px;
  min-width: 0;
  overflow: auto;
  position: relative;
`;

const StyledCanvasToolbar = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
  left: 0;
  padding: ${themeCssVariables.spacing[3]};
  position: sticky;
  right: 0;
  top: 0;
  z-index: 1;
`;

const StyledBuilderLabel = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.pill};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  padding: ${themeCssVariables.spacing[1]} ${themeCssVariables.spacing[2]};
`;

const StyledStructureNotice = styled.div`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.xs};
  max-width: 420px;
  padding: ${themeCssVariables.spacing[2]};
`;

const StyledFlow = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  min-width: 640px;
  padding: ${themeCssVariables.spacing[4]} ${themeCssVariables.spacing[6]}
    ${themeCssVariables.spacing[8]};
`;

const StyledStartNode = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.md};
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
  padding: ${themeCssVariables.spacing[3]};
  width: min(420px, calc(100vw - 80px));
`;

const StyledStartIcon = styled.div`
  align-items: center;
  background: ${themeCssVariables.tag.background.green};
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.tag.text.green};
  display: flex;
  height: 36px;
  justify-content: center;
  width: 36px;
`;

const StyledStartText = styled.div`
  display: flex;
  flex-direction: column;
`;

const StyledStartTitle = styled.span`
  color: ${themeCssVariables.font.color.primary};
  font-weight: ${themeCssVariables.font.weight.medium};
`;

const StyledStartSubtitle = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const StyledConnector = styled.div`
  background: ${themeCssVariables.border.color.strong};
  height: 28px;
  width: 1px;
`;

const StyledStepNumber = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.rounded};
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  font-size: ${themeCssVariables.font.size.xs};
  height: 20px;
  justify-content: center;
  margin: -4px 0;
  position: relative;
  width: 20px;
  z-index: 1;
`;

const StyledStepGroup = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  width: 100%;
`;

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
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isRootPaletteOpen, setIsRootPaletteOpen] = useState(false);
  const [openPaletteBranch, setOpenPaletteBranch] =
    useState<SequenceStepBranch | null>(null);
  const [isAddingStep, setIsAddingStep] = useState(false);
  const { enqueueErrorSnackBar } = useSnackBar();
  const { updateOneRecord } = useUpdateOneRecord();
  const { createOneRecord } = useCreateOneRecord<SequenceStepRecord>({
    objectNameSingular: 'sequenceStep',
    skipPostOptimisticEffect: true,
  });
  const { deleteOneRecord } = useDeleteOneRecord({
    objectNameSingular: 'sequenceStep',
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
  const rootSteps = sortedSteps.filter(({ settings }) => !settings.branch);
  const selectedStep =
    sortedSteps.find(({ id }) => id === selectedStepId) ?? null;

  const addStep = async (
    {
      type,
      condition,
      taskType,
    }: {
      type: SequenceStepType;
      condition?: SequenceConditionType;
      taskType?: SequenceTaskType;
    },
    branch?: SequenceStepBranch,
  ) => {
    if (!canAddOrReorder) {
      return;
    }

    setIsAddingStep(true);

    try {
      const nextPosition = sortedSteps.reduce(
        (position, step) => Math.max(position, step.position + 1),
        0,
      );
      const defaultSettings = getDefaultSequenceStepSettings(type, {
        condition,
        taskType,
      });
      const createdStep = await createOneRecord({
        sequenceId,
        name: null,
        type: getSequenceStepStorageType(type),
        position: nextPosition,
        settings: branch
          ? {
              ...defaultSettings,
              branch,
            }
          : defaultSettings,
      });

      setSelectedStepId(createdStep.id);
      setIsRootPaletteOpen(false);
      setOpenPaletteBranch(null);
      await refetch();
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence step could not be added.`,
      });
    } finally {
      setIsAddingStep(false);
    }
  };

  const selectStep = (stepId: string) => {
    setSelectedStepId(stepId);
    setIsRootPaletteOpen(false);
    setOpenPaletteBranch(null);
  };

  const deleteStepTree = async (stepId: string) => {
    const descendantDepthByStepId = new Map<string, number>();
    const visitedStepIds = new Set([stepId]);
    let parentStepIds = new Set([stepId]);
    let depth = 1;

    while (parentStepIds.size > 0) {
      const childStepIds = sortedSteps
        .filter(({ settings }) =>
          parentStepIds.has(settings.branch?.conditionStepId ?? ''),
        )
        .map(({ id }) => id)
        .filter((id) => !visitedStepIds.has(id));

      childStepIds.forEach((id) => {
        visitedStepIds.add(id);
        descendantDepthByStepId.set(id, depth);
      });
      parentStepIds = new Set(childStepIds);
      depth += 1;
    }

    try {
      const descendantStepIds = [...descendantDepthByStepId.entries()]
        .sort((first, second) => second[1] - first[1])
        .map(([descendantStepId]) => descendantStepId);

      // Delete leaves before their condition. A partial failure therefore
      // keeps the remaining graph valid and the parent available for retry.
      for (const descendantStepId of descendantStepIds) {
        await deleteOneRecord(descendantStepId);
      }

      await deleteOneRecord(stepId);

      if (
        selectedStepId === stepId ||
        descendantDepthByStepId.has(selectedStepId ?? '')
      ) {
        setSelectedStepId(null);
      }
    } finally {
      await refetch();
    }
  };

  const addBranchStep = (
    option: SequenceStepPaletteOption,
    branch: SequenceStepBranch,
  ) => addStep(option, branch);

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
    <StyledBuilder hasOpenPanel={selectedStep !== null}>
      <StyledCanvas>
        <StyledCanvasToolbar>
          <StyledBuilderLabel>{t`Sequence builder`}</StyledBuilderLabel>
          {isStructureLocked && (
            <StyledStructureNotice>
              {t`Finish or remove active enrollments before changing the sequence structure.`}
            </StyledStructureNotice>
          )}
        </StyledCanvasToolbar>
        <StyledFlow>
          <StyledStartNode>
            <StyledStartIcon>
              <IconPlayerPlay size={18} />
            </StyledStartIcon>
            <StyledStartText>
              <StyledStartTitle>{t`Start sequence`}</StyledStartTitle>
              <StyledStartSubtitle>
                {t`Contacts enter using the shared schedule`}
              </StyledStartSubtitle>
            </StyledStartText>
          </StyledStartNode>

          {rootSteps.map((step, index) => (
            <StyledStepGroup key={step.id}>
              <StyledConnector />
              <StyledStepNumber>
                {sortedSteps.findIndex(({ id }) => id === step.id) + 1}
              </StyledStepNumber>
              <StyledConnector />
              <SequenceStepCard
                step={step}
                stepNumber={
                  sortedSteps.findIndex(({ id }) => id === step.id) + 1
                }
                isSelected={step.id === selectedStepId}
                canMoveUp={canAddOrReorder && index > 0}
                canMoveDown={canAddOrReorder && index < rootSteps.length - 1}
                canDelete={canDeleteSteps}
                onSelect={() => selectStep(step.id)}
                onMoveUp={() => swapSteps(step, rootSteps[index - 1])}
                onMoveDown={() => swapSteps(step, rootSteps[index + 1])}
                onDelete={() => deleteStepTree(step.id)}
              />
              {step.settings.type === SEQUENCE_STEP_TYPES.CONDITION && (
                <SequenceConditionBranches
                  conditionStepId={step.id}
                  steps={sortedSteps}
                  selectedStepId={selectedStepId}
                  openPaletteBranch={openPaletteBranch}
                  isAddingStep={isAddingStep}
                  canAddOrReorder={canAddOrReorder}
                  canDeleteSteps={canDeleteSteps}
                  onSelectStep={selectStep}
                  onOpenPalette={(branch) => {
                    setSelectedStepId(null);
                    setIsRootPaletteOpen(false);
                    setOpenPaletteBranch(branch);
                  }}
                  onClosePalette={() => setOpenPaletteBranch(null)}
                  onAddStep={addBranchStep}
                  onSwapSteps={swapSteps}
                  onDeleted={deleteStepTree}
                />
              )}
            </StyledStepGroup>
          ))}

          <StyledConnector />
          {isRootPaletteOpen ? (
            <SequenceStepPalette
              isCreating={isAddingStep}
              onAdd={addStep}
              onClose={() => setIsRootPaletteOpen(false)}
            />
          ) : (
            <Button
              title={t`Add step`}
              Icon={IconPlus}
              size="small"
              variant="secondary"
              disabled={!canAddOrReorder}
              onClick={() => {
                setSelectedStepId(null);
                setOpenPaletteBranch(null);
                setIsRootPaletteOpen(true);
              }}
            />
          )}
        </StyledFlow>
      </StyledCanvas>

      {selectedStep && (
        <SequenceStepEditorPanel
          step={selectedStep}
          isEditable={canUpdateSteps}
          onClose={() => setSelectedStepId(null)}
        />
      )}
    </StyledBuilder>
  );
};
