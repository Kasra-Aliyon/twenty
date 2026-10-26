import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import {
  CoreObjectNameSingular,
  SEQUENCE_TASK_TYPES,
} from 'twenty-shared/types';
import { IconPhone } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useSequenceTimelineTargetData } from '@/sequence/hooks/useSequenceTimelineTargetData';
import { SequenceTimeline } from '@/sequence/components/SequenceTimeline';
import {
  sequenceTimelineTargetComponentState,
  type SequenceTimelineTarget,
} from '@/sequence/states/sequenceTimelineTargetComponentState';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { getTaskCallPhoneNumber } from '~/pages/tasks/utils/get-task-call-phone-number';

const StyledContainer = styled.div`
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
  height: 100%;
  overflow-y: auto;
  padding: ${themeCssVariables.spacing[4]};
`;

const StyledTitle = styled.h2`
  font-size: ${themeCssVariables.font.size.lg};
  margin: 0;
`;

const StyledActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${themeCssVariables.spacing[2]};
`;

const StyledContext = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  font-size: ${themeCssVariables.font.size.sm};
  white-space: pre-wrap;
`;

const SequenceTimelineTargetContent = ({
  target,
}: {
  target: SequenceTimelineTarget;
}) => {
  const {
    task,
    person,
    personId,
    loading,
    error,
    refetchTask,
    canUpdateTask,
    canRecord,
  } = useSequenceTimelineTargetData(target);
  const { updateOneRecord } = useUpdateOneRecord();
  const { openRecordInSidePanel } = useOpenRecordInSidePanel();
  const { enqueueErrorSnackBar } = useSnackBar();
  const [isCompleting, setIsCompleting] = useState(false);

  const completeTask = async () => {
    if (!task || !canUpdateTask || isCompleting) return;
    setIsCompleting(true);
    try {
      await updateOneRecord({
        objectNameSingular: CoreObjectNameSingular.Task,
        idToUpdate: task.id,
        updateOneRecordInput: { status: 'DONE' },
      });
      await refetchTask();
    } catch {
      enqueueErrorSnackBar({ message: t`The task could not be completed.` });
    } finally {
      setIsCompleting(false);
    }
  };

  if (loading) {
    return (
      <StyledContainer role="status">{t`Loading prospect…`}</StyledContainer>
    );
  }

  if (error || !personId || !person || (target.taskId && !task)) {
    return (
      <StyledContainer role="alert">
        {t`The prospect could not be loaded. The task needs one linked prospect that you can access.`}
        {target.taskId && (
          <Button
            title={t`Open task details`}
            variant="secondary"
            onClick={() =>
              openRecordInSidePanel({
                objectNameSingular: CoreObjectNameSingular.Task,
                recordId: target.taskId!,
              })
            }
          />
        )}
      </StyledContainer>
    );
  }

  const isCallTask = task?.type === SEQUENCE_TASK_TYPES.CALL;
  const phoneNumber = task
    ? getTaskCallPhoneNumber({
        ...task,
        taskTargets: [{ id: person.id, targetPerson: person }],
      })
    : undefined;
  const personName =
    [person.name?.firstName, person.name?.lastName].filter(Boolean).join(' ') ||
    t`Prospect`;

  return (
    <StyledContainer>
      <StyledTitle>{personName}</StyledTitle>
      <StyledActions>
        <Button
          title={t`Open prospect`}
          size="small"
          variant="tertiary"
          onClick={() =>
            openRecordInSidePanel({
              objectNameSingular: CoreObjectNameSingular.Person,
              recordId: personId,
            })
          }
        />
        {isCallTask && (
          <Button
            Icon={IconPhone}
            title={phoneNumber ? t`Call in CloudTalk` : t`No phone number`}
            size="small"
            variant="secondary"
            disabled={!phoneNumber}
            onClick={() => {
              if (phoneNumber) window.open(`ct+tel:${phoneNumber}`, '_self');
            }}
          />
        )}
      </StyledActions>
      {task && (
        <>
          <StyledContext>{task.title}</StyledContext>
          {task.bodyV2?.markdown && (
            <details>
              <summary>{t`Task instructions`}</summary>
              <StyledContext>{task.bodyV2.markdown}</StyledContext>
            </details>
          )}
          <StyledActions
            title={t`Completing the task can advance its sequence. Saving an activity does not.`}
          >
            <Button
              title={t`Task details`}
              size="small"
              variant="tertiary"
              onClick={() =>
                openRecordInSidePanel({
                  objectNameSingular: CoreObjectNameSingular.Task,
                  recordId: task.id,
                })
              }
            />
            <Button
              title={
                task.status === 'DONE' ? t`Task completed` : t`Complete task`
              }
              size="small"
              variant="secondary"
              disabled={
                task.status === 'DONE' || !canUpdateTask || isCompleting
              }
              isLoading={isCompleting}
              onClick={() => void completeTask()}
            />
          </StyledActions>
        </>
      )}
      <SequenceTimeline
        personId={personId}
        taskId={task?.id}
        sequenceEnrollmentId={task?.sequenceEnrollmentId ?? undefined}
        isCallTask={isCallTask}
        canRecord={canRecord}
      />
    </StyledContainer>
  );
};

export const SidePanelSequenceTimeline = () => {
  const sequenceTimelineTarget = useAtomComponentStateValue(
    sequenceTimelineTargetComponentState,
  );

  return sequenceTimelineTarget ? (
    <SequenceTimelineTargetContent
      key={`${sequenceTimelineTarget.taskId ?? ''}:${sequenceTimelineTarget.personId ?? ''}`}
      target={sequenceTimelineTarget}
    />
  ) : null;
};
