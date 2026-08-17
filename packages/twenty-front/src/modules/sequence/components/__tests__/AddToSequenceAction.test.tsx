import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

import { AddToSequenceAction } from '@/sequence/components/AddToSequenceAction';

const mockFetchAllTargetedPeople = jest.fn();
const mockBatchCreateManyRecords = jest.fn();
const mockRefetchExistingEnrollments = jest.fn();
const mockRefetchQueries = jest.fn();
const mockUseLazyFetchAllRecords = jest.fn((_options: unknown) => ({
  fetchAllRecords: mockFetchAllTargetedPeople,
}));
let mockCurrentCommandMenuContext = {
  selectedRecords: [] as { id: string }[],
  isSelectAll: true,
  numberOfSelectedRecords: 2,
};
let mockSequences = [
  {
    id: 'sequence-id',
    name: 'First sequence',
    status: 'ACTIVE',
    senderConnectedAccountId: 'sender-id' as string | null,
    settings: {
      stopOnReply: true,
      senderConnectedAccountIds: ['sender-id'],
    },
  },
];

jest.mock('@/workspace/hooks/useIsFeatureEnabled', () => ({
  useIsFeatureEnabled: () => true,
}));

jest.mock('@/object-metadata/hooks/useDoObjectMetadataItemsExist', () => ({
  useDoObjectMetadataItemsExist: () => true,
}));

jest.mock('@/command-menu-item/hooks/useCurrentCommandMenuContextApi', () => ({
  useCurrentCommandMenuContextApi: () => mockCurrentCommandMenuContext,
}));

jest.mock('@/context-store/utils/computeContextStoreFilters', () => ({
  computeContextStoreFilters: () => ({
    not: { id: { in: ['excluded-person-id'] } },
  }),
}));

jest.mock('@/object-metadata/hooks/useApolloCoreClient', () => ({
  useApolloCoreClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: ({
    objectNameSingular,
  }: {
    objectNameSingular: string;
  }) => ({
    objectMetadataItem:
      objectNameSingular === 'person'
        ? { id: 'person-metadata-id', fields: [] }
        : { id: 'sequence-enrollment-metadata-id' },
  }),
}));

jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));

jest.mock(
  '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue',
  () => ({
    useAtomComponentStateValue: (componentState: { key: string }) => {
      switch (componentState.key) {
        case 'contextStoreTargetedRecordsRuleComponentState':
          return {
            mode: 'exclusion',
            excludedRecordIds: ['excluded-person-id'],
          };
        case 'contextStoreFiltersComponentState':
        case 'contextStoreFilterGroupsComponentState':
          return [];
        case 'contextStoreAnyFieldFilterValueComponentState':
          return '';
        default:
          return undefined;
      }
    },
  }),
);

jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: () => [],
}));

jest.mock(
  '@/object-record/record-filter/hooks/useFilterValueDependencies',
  () => ({
    useFilterValueDependencies: () => ({ filterValueDependencies: {} }),
  }),
);

jest.mock('@/object-record/hooks/useLazyFetchAllRecords', () => ({
  useLazyFetchAllRecords: (options: unknown) =>
    mockUseLazyFetchAllRecords(options),
}));

jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: ({
    objectNameSingular,
  }: {
    objectNameSingular: string;
  }) =>
    objectNameSingular === 'sequence'
      ? {
          records: mockSequences,
          fetchMoreRecords: jest.fn(),
          hasNextPage: false,
          loading: false,
        }
      : {
          records: [],
          refetch: mockRefetchExistingEnrollments,
          loading: false,
        },
}));

jest.mock('@/object-record/hooks/useBatchCreateManyRecords', () => ({
  useBatchCreateManyRecords: () => ({
    batchCreateManyRecords: mockBatchCreateManyRecords,
  }),
}));

jest.mock('@/ui/feedback/snack-bar-manager/hooks/useSnackBar', () => ({
  useSnackBar: () => ({
    enqueueSuccessSnackBar: jest.fn(),
    enqueueErrorSnackBar: jest.fn(),
  }),
}));

jest.mock('@/ui/layout/dropdown/hooks/useCloseDropdown', () => ({
  useCloseDropdown: () => ({ closeDropdown: jest.fn() }),
}));

jest.mock('@/ui/layout/dropdown/components/Dropdown', () => ({
  Dropdown: ({
    clickableComponent,
    dropdownComponents,
  }: {
    clickableComponent: ReactNode;
    dropdownComponents: ReactNode;
  }) => (
    <>
      {clickableComponent}
      {dropdownComponents}
    </>
  ),
}));

jest.mock('@/ui/layout/dropdown/components/DropdownContent', () => ({
  DropdownContent: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/ui/layout/dropdown/components/DropdownMenuItemsContainer', () => ({
  DropdownMenuItemsContainer: ({ children }: { children: ReactNode }) =>
    children,
}));

jest.mock('twenty-ui/input', () => ({
  Button: ({ title }: { title: string }) => (
    <button type="button">{title}</button>
  ),
}));

jest.mock('twenty-ui/navigation', () => ({
  MenuItem: ({
    text,
    onClick,
    disabled,
  }: {
    text: string;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {text}
    </button>
  ),
}));

describe('AddToSequenceAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentCommandMenuContext = {
      selectedRecords: [],
      isSelectAll: true,
      numberOfSelectedRecords: 2,
    };
    mockSequences = [
      {
        id: 'sequence-id',
        name: 'First sequence',
        status: 'ACTIVE',
        senderConnectedAccountId: 'sender-id',
        settings: {
          stopOnReply: true,
          senderConnectedAccountIds: ['sender-id'],
        },
      },
    ];
    mockFetchAllTargetedPeople.mockResolvedValue([
      { id: 'person-id-1' },
      { id: 'person-id-2' },
    ]);
    mockRefetchExistingEnrollments.mockResolvedValue({
      data: {
        sequenceEnrollments: {
          edges: [
            {
              node: {
                id: 'existing-enrollment-id',
                sequenceId: 'sequence-id',
                personId: 'person-id-1',
              },
            },
          ],
        },
      },
    });
  });

  it('renders and enrolls the filtered people when all list records are selected', async () => {
    const requiredFilter = {
      recordListMemberships: {
        recordListId: { eq: 'record-list-id' },
      },
    };

    render(
      <AddToSequenceAction
        objectNameSingular="person"
        requiredFilter={requiredFilter}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Add to sequence' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'First sequence' }));

    await waitFor(() => {
      expect(mockFetchAllTargetedPeople).toHaveBeenCalledTimes(1);
      expect(mockBatchCreateManyRecords).toHaveBeenCalledWith({
        recordsToCreate: [
          {
            sequenceId: 'sequence-id',
            personId: 'person-id-2',
            stopOnReply: true,
          },
        ],
      });
    });

    expect(mockUseLazyFetchAllRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        objectNameSingular: 'person',
        filter: {
          and: [
            { not: { id: { in: ['excluded-person-id'] } } },
            requiredFilter,
          ],
        },
      }),
    );
    expect(mockRefetchQueries).toHaveBeenCalledWith({ include: 'active' });
  });

  it('keeps the individual-selection enrollment path unchanged', async () => {
    mockCurrentCommandMenuContext = {
      selectedRecords: [{ id: 'person-id-1' }, { id: 'person-id-2' }],
      isSelectAll: false,
      numberOfSelectedRecords: 2,
    };

    render(<AddToSequenceAction objectNameSingular="person" />);

    fireEvent.click(screen.getByRole('button', { name: 'First sequence' }));

    await waitFor(() => {
      expect(mockBatchCreateManyRecords).toHaveBeenCalledWith({
        recordsToCreate: [
          {
            sequenceId: 'sequence-id',
            personId: 'person-id-2',
            stopOnReply: true,
          },
        ],
      });
    });

    expect(mockFetchAllTargetedPeople).not.toHaveBeenCalled();
  });

  it('allows enrollment when the sequence uses a mailbox pool without a legacy sender', async () => {
    mockSequences = [
      {
        id: 'sequence-id',
        name: 'First sequence',
        status: 'ACTIVE',
        senderConnectedAccountId: null,
        settings: {
          stopOnReply: true,
          senderConnectedAccountIds: ['pooled-sender-id'],
        },
      },
    ];

    render(<AddToSequenceAction objectNameSingular="person" />);

    fireEvent.click(screen.getByRole('button', { name: 'First sequence' }));

    await waitFor(() => {
      expect(mockBatchCreateManyRecords).toHaveBeenCalledWith({
        recordsToCreate: [
          {
            sequenceId: 'sequence-id',
            personId: 'person-id-2',
            stopOnReply: true,
          },
        ],
      });
    });
  });
});
