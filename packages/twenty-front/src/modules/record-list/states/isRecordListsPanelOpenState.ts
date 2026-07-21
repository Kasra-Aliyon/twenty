import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const isRecordListsPanelOpenState = createAtomState<boolean>({
  key: 'record-list/isRecordListsPanelOpenState',
  defaultValue: false,
});
