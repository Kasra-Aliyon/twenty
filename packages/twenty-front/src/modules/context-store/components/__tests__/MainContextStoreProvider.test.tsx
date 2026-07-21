import { render } from '@testing-library/react';

import { MainContextStoreProvider } from '@/context-store/components/MainContextStoreProvider';

const mockUseFindOneRecord = jest.fn();
const mockUseAtomStateValue = jest.fn();
const mockUseAtomFamilyStateValue = jest.fn();
const mockUseLocation = jest.fn();
const mockUseParams = jest.fn();
const mockMainContextStoreProviderEffect = jest.fn();

jest.mock('@/object-record/hooks/useFindOneRecord', () => ({
  useFindOneRecord: (...args: unknown[]) => mockUseFindOneRecord(...args),
}));

jest.mock('@/ui/utilities/state/jotai/hooks/useAtomStateValue', () => ({
  useAtomStateValue: (...args: unknown[]) => mockUseAtomStateValue(...args),
}));

jest.mock('@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue', () => ({
  useAtomFamilyStateValue: (...args: unknown[]) =>
    mockUseAtomFamilyStateValue(...args),
}));

jest.mock('@/navigation/hooks/useIsSettingsPage', () => ({
  useIsSettingsPage: () => false,
}));

jest.mock('@/navigation/hooks/useLastVisitedView', () => ({
  useLastVisitedView: () => ({
    getLastVisitedViewIdFromObjectNamePlural: jest.fn(),
  }),
}));

jest.mock('@/context-store/components/MainContextStoreProviderEffect', () => ({
  MainContextStoreProviderEffect: (props: unknown) => {
    mockMainContextStoreProviderEffect(props);

    return null;
  },
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useLocation: () => mockUseLocation(),
  useParams: () => mockUseParams(),
  useSearchParams: () => [new URLSearchParams()],
}));

describe('MainContextStoreProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAtomStateValue.mockReturnValue([]);
    mockUseParams.mockReturnValue({});
  });

  it('does not resolve record lists while metadata is loading', () => {
    mockUseLocation.mockReturnValue({ pathname: '/objects/companies' });
    mockUseAtomFamilyStateValue.mockReturnValue({ status: 'loading' });

    render(<MainContextStoreProvider />);

    expect(mockUseFindOneRecord).not.toHaveBeenCalled();
  });

  it('does not resolve a list page before record-list metadata exists', () => {
    mockUseLocation.mockReturnValue({ pathname: '/lists/list-id' });
    mockUseAtomFamilyStateValue.mockReturnValue({ status: 'up-to-date' });

    render(<MainContextStoreProvider />);

    expect(mockUseFindOneRecord).not.toHaveBeenCalled();
  });

  it('does not resolve the create-list page as an existing list', () => {
    mockUseLocation.mockReturnValue({ pathname: '/lists/new' });
    mockUseAtomFamilyStateValue.mockReturnValue({ status: 'up-to-date' });
    mockUseAtomStateValue.mockReturnValue([{ nameSingular: 'recordList' }]);

    render(<MainContextStoreProvider />);

    expect(mockUseFindOneRecord).not.toHaveBeenCalled();
  });

  it('uses the object index view while list view metadata is unavailable', () => {
    mockUseLocation.mockReturnValue({ pathname: '/lists/list-id' });
    mockUseParams.mockReturnValue({ recordListId: 'list-id' });
    mockUseAtomFamilyStateValue.mockReturnValue({ status: 'up-to-date' });
    mockUseAtomStateValue
      .mockReturnValueOnce([
        { id: 'record-list-metadata-id', nameSingular: 'recordList' },
        { id: 'company-metadata-id', nameSingular: 'company' },
      ])
      .mockReturnValueOnce([
        {
          id: 'company-index-view-id',
          key: 'INDEX',
          objectMetadataId: 'company-metadata-id',
        },
      ]);
    mockUseFindOneRecord.mockReturnValue({
      record: { id: 'list-id', name: 'Customers', type: 'COMPANY' },
    });

    render(<MainContextStoreProvider />);

    expect(mockMainContextStoreProviderEffect).toHaveBeenCalledWith(
      expect.objectContaining({
        viewId: 'company-index-view-id',
        objectMetadataItem: expect.objectContaining({
          id: 'company-metadata-id',
        }),
        isRecordIndexPage: true,
      }),
    );
  });
});
