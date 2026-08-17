import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';

import { SequenceMailboxMultiSelect } from '@/sequence/components/SequenceMailboxMultiSelect';

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

jest.mock('@/ui/input/components/SelectControl', () => ({
  SelectControl: ({
    selectedOption,
  }: {
    selectedOption: { label: string };
  }) => <div>{selectedOption.label}</div>,
}));

jest.mock('twenty-ui/navigation', () => ({
  MenuItemMultiSelect: ({
    text,
    disabled,
    onSelectChange,
  }: {
    text: string;
    disabled?: boolean;
    onSelectChange: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onSelectChange}>
      {text}
    </button>
  ),
}));

describe('SequenceMailboxMultiSelect', () => {
  it('adds a mailbox while preserving the existing pool order', () => {
    const onChange = jest.fn();

    render(
      <SequenceMailboxMultiSelect
        dropdownId="mailbox-pool"
        options={[
          { label: 'first@example.com', value: 'first-id' },
          { label: 'second@example.com', value: 'second-id' },
        ]}
        selectedAccountIds={['first-id']}
        onChange={onChange}
      />,
    );

    expect(screen.getAllByText('first@example.com')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'second@example.com' }));

    expect(onChange).toHaveBeenCalledWith(['first-id', 'second-id']);
  });

  it('blocks additions at 20 mailboxes while still allowing removal', () => {
    const onChange = jest.fn();
    const options = Array.from({ length: 21 }, (_, index) => ({
      label: `sender-${index + 1}@example.com`,
      value: `sender-${index + 1}`,
    }));
    const selectedAccountIds = options
      .slice(0, 20)
      .map((option) => option.value);

    render(
      <SequenceMailboxMultiSelect
        dropdownId="mailbox-pool"
        options={options}
        selectedAccountIds={selectedAccountIds}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('20 mailboxes selected (maximum)')).toBeVisible();

    const unavailableOption = screen.getByRole('button', {
      name: 'sender-21@example.com',
    });
    const selectedOption = screen.getByRole('button', {
      name: 'sender-1@example.com',
    });

    expect(unavailableOption).toBeDisabled();
    expect(selectedOption).toBeEnabled();

    fireEvent.click(unavailableOption);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(selectedOption);
    expect(onChange).toHaveBeenCalledWith(selectedAccountIds.slice(1));
  });
});
