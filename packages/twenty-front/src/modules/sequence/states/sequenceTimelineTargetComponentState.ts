import { SidePanelPageComponentInstanceContext } from '@/side-panel/states/contexts/SidePanelPageComponentInstanceContext';
import { createAtomComponentState } from '@/ui/utilities/state/jotai/utils/createAtomComponentState';

export type SequenceTimelineTarget = {
  personId?: string;
  taskId?: string;
};

export const sequenceTimelineTargetComponentState =
  createAtomComponentState<SequenceTimelineTarget | null>({
    key: 'side-panel/sequence-timeline-target',
    defaultValue: null,
    componentInstanceContext: SidePanelPageComponentInstanceContext,
  });
