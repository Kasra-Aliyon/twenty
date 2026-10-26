import { t } from '@lingui/core/macro';
import { useStore } from 'jotai';
import { useCallback } from 'react';
import {
  CoreObjectNameSingular,
  FeatureFlagKey,
  SidePanelPages,
} from 'twenty-shared/types';
import { IconTimelineEvent } from 'twenty-ui/icon';
import { v4 } from 'uuid';

import {
  sequenceTimelineTargetComponentState,
  type SequenceTimelineTarget,
} from '@/sequence/states/sequenceTimelineTargetComponentState';
import { useSidePanelMenu } from '@/side-panel/hooks/useSidePanelMenu';
import { useOpenRecordInSidePanel } from '@/side-panel/hooks/useOpenRecordInSidePanel';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';

export const useOpenSequenceTimeline = () => {
  const store = useStore();
  const { navigateSidePanelMenu } = useSidePanelMenu();
  const { openRecordInSidePanel } = useOpenRecordInSidePanel();
  const sequencesEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
  );

  const openSequenceTimeline = useCallback(
    (target: SequenceTimelineTarget) => {
      if (!sequencesEnabled) {
        const recordId = target.taskId ?? target.personId;
        if (recordId) {
          openRecordInSidePanel({
            recordId,
            objectNameSingular: target.taskId
              ? CoreObjectNameSingular.Task
              : CoreObjectNameSingular.Person,
          });
        }
        return;
      }
      const pageId = v4();

      store.set(
        sequenceTimelineTargetComponentState.atomFamily({ instanceId: pageId }),
        target,
      );

      navigateSidePanelMenu({
        page: SidePanelPages.SequenceTimeline,
        pageTitle: t`Sequence timeline`,
        pageIcon: IconTimelineEvent,
        pageId,
      });
    },
    [store, navigateSidePanelMenu, openRecordInSidePanel, sequencesEnabled],
  );

  return { openSequenceTimeline };
};
