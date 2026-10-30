import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { type PropsWithChildren } from 'react';

import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import {
  RecordIndexContextProvider,
  recordIndexCreationOptionsFamilyState,
  type RecordIndexContextValue,
} from '@/object-record/record-index/contexts/RecordIndexContext';
import { useCreateNewIndexRecord } from '@/object-record/record-table/hooks/useCreateNewIndexRecord';
import { recordTableReloadRequestIdComponentState } from '@/object-record/record-table/states/recordTableReloadRequestIdComponentState';
import { getMockObjectMetadataItemOrThrow } from '~/testing/utils/getMockObjectMetadataItemOrThrow';

const mockCreateOneRecord = jest.fn();
const mockOpenRecordInSidePanel = jest.fn();

jest.mock('@/object-record/hooks/useCreateOneRecord', () => ({
  useCreateOneRecord: jest.fn(() => ({
    createOneRecord: mockCreateOneRecord,
  })),
}));
jest.mock('@/side-panel/hooks/useOpenRecordInSidePanel', () => ({
  useOpenRecordInSidePanel: () => ({
    openRecordInSidePanel: mockOpenRecordInSidePanel,
  }),
}));
jest.mock('@/side-panel/hooks/useSidePanelMenu', () => ({
  useSidePanelMenu: () => ({ closeSidePanelMenu: jest.fn() }),
}));
jest.mock('~/hooks/useNavigateApp', () => ({
  useNavigateApp: () => jest.fn(),
}));
jest.mock('@/object-record/hooks/useBuildRecordInputFromRLSPredicates', () => ({
  useBuildRecordInputFromRLSPredicates: () => ({
    buildRecordInputFromRLSPredicates: () => ({}),
  }),
}));
jest.mock(
  '@/object-record/record-table/hooks/useBuildRecordInputFromFilters',
  () => ({
    useBuildRecordInputFromFilters: () => ({
      buildRecordInputFromFilters: () => ({}),
    }),
  }),
);
jest.mock('@/object-record/record-store/hooks/useUpsertRecordsInStore', () => ({
  useUpsertRecordsInStore: () => ({ upsertRecordsInStore: jest.fn() }),
}));
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomComponentSelectorValue',
  () => ({
    useAtomComponentSelectorValue: () => [],
  }),
);
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue',
  () => ({
    useAtomComponentStateValue: () => undefined,
  }),
);
jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomComponentFamilyStateCallbackState',
  () => ({
    useAtomComponentFamilyStateCallbackState: () => jest.fn(),
  }),
);

const RECORD_INDEX_ID = 'people-index';
const objectMetadataItem = getMockObjectMetadataItemOrThrow('person');
const createdRecord = { id: 'created-person-id' };

const recordIndexContextValue: RecordIndexContextValue = {
  recordIndexId: RECORD_INDEX_ID,
  viewBarInstanceId: RECORD_INDEX_ID,
  objectMetadataItem,
  objectNameSingular: objectMetadataItem.nameSingular,
  objectNamePlural: objectMetadataItem.namePlural,
  objectPermissionsByObjectMetadataId: {},
  indexIdentifierUrl: () => '',
  onIndexRecordsLoaded: jest.fn(),
  labelIdentifierFieldMetadataItem: undefined,
  recordFieldByFieldMetadataItemId: {},
  fieldMetadataItemByFieldMetadataItemId: {},
  fieldDefinitionByFieldMetadataItemId: {},
};

describe('useCreateNewIndexRecord', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateOneRecord.mockResolvedValue(createdRecord);
  });

  it('should create a record from a headless command outside the index provider', async () => {
    const store = createStore();
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(
      () =>
        useCreateNewIndexRecord({
          objectMetadataItem,
          instanceId: RECORD_INDEX_ID,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.createNewIndexRecord({ position: 'first' });
    });

    expect(mockCreateOneRecord).toHaveBeenCalledWith(
      expect.objectContaining({ position: 'first' }),
    );
    expect(mockOpenRecordInSidePanel).toHaveBeenCalled();
    expect(useCreateOneRecord).toHaveBeenCalledWith(
      expect.objectContaining({ skipPostOptimisticEffect: false }),
    );
  });

  it('should create a Kanban record without a table instance provider', async () => {
    const store = createStore();
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <RecordIndexContextProvider value={recordIndexContextValue}>
          {children}
        </RecordIndexContextProvider>
      </Provider>
    );
    const { result } = renderHook(
      () => useCreateNewIndexRecord({ objectMetadataItem }),
      { wrapper },
    );

    await act(async () => {
      await result.current.createNewIndexRecord({ position: 'last' });
    });

    expect(mockCreateOneRecord).toHaveBeenCalledWith(
      expect.objectContaining({ position: 'last' }),
    );
  });

  it('should preserve list membership creation callbacks for headless commands', async () => {
    const store = createStore();
    const onRecordCreated = jest.fn().mockResolvedValue(undefined);
    store.set(
      recordIndexCreationOptionsFamilyState.atomFamily(RECORD_INDEX_ID),
      {
        onRecordCreated,
        skipPostOptimisticEffectOnRecordCreate: true,
      },
    );
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(
      () =>
        useCreateNewIndexRecord({
          objectMetadataItem,
          instanceId: RECORD_INDEX_ID,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.createNewIndexRecord();
    });

    expect(onRecordCreated).toHaveBeenCalledWith(createdRecord);
    expect(useCreateOneRecord).toHaveBeenCalledWith(
      expect.objectContaining({ skipPostOptimisticEffect: true }),
    );
    expect(
      store.get(
        recordTableReloadRequestIdComponentState.atomFamily({
          instanceId: RECORD_INDEX_ID,
        }),
      ),
    ).toBe(1);
  });

  it('should keep creation callbacks scoped to their originating list', async () => {
    const store = createStore();
    const onRecordCreated = jest.fn();
    store.set(recordIndexCreationOptionsFamilyState.atomFamily('other-index'), {
      onRecordCreated,
      skipPostOptimisticEffectOnRecordCreate: true,
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>
        <RecordIndexContextProvider
          value={{
            ...recordIndexContextValue,
            recordIndexId: 'other-index',
            viewBarInstanceId: 'other-index',
            onRecordCreated,
            skipPostOptimisticEffectOnRecordCreate: true,
          }}
        >
          {children}
        </RecordIndexContextProvider>
      </Provider>
    );
    const { result } = renderHook(
      () =>
        useCreateNewIndexRecord({
          objectMetadataItem,
          instanceId: RECORD_INDEX_ID,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.createNewIndexRecord();
    });

    expect(onRecordCreated).not.toHaveBeenCalled();
    expect(useCreateOneRecord).toHaveBeenCalledWith(
      expect.objectContaining({ skipPostOptimisticEffect: false }),
    );
  });
});
