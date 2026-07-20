import { render } from '@testing-library/react';

import { MainContextStoreProvider } from '@/context-store/components/MainContextStoreProvider';

const mockUseFindOneRecord = jest.fn();
const mockUseAtomStateValue = jest.fn();
const mockUseAtomFamilyStateValue = jest.fn();
const mockUseLocation = jest.fn();

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
  MainContextStoreProviderEffect: () => null,
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useLocation: () => mockUseLocation(),
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams()],
}));

describe('MainContextStoreProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAtomStateValue.mockReturnValue([]);
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
});
