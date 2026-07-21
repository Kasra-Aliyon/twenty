import { RecordTableComponentInstanceContext } from '@/object-record/record-table/states/context/RecordTableComponentInstanceContext';
import { createAtomComponentState } from '@/ui/utilities/state/jotai/utils/createAtomComponentState';

export const recordTableReloadRequestIdComponentState =
  createAtomComponentState<number>({
    key: 'recordTableReloadRequestIdComponentState',
    defaultValue: 0,
    componentInstanceContext: RecordTableComponentInstanceContext,
  });
