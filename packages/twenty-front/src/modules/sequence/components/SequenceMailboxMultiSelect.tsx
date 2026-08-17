import { SelectControl } from '@/ui/input/components/SelectControl';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { t } from '@lingui/core/macro';
import { type SelectOption } from 'twenty-ui/input';
import { MenuItemMultiSelect } from 'twenty-ui/navigation';

type SequenceMailboxMultiSelectProps = {
  dropdownId: string;
  options: SelectOption<string>[];
  selectedAccountIds: string[];
  disabled?: boolean;
  onChange: (accountIds: string[]) => void;
};

const MAXIMUM_SENDER_POOL_SIZE = 20;

export const SequenceMailboxMultiSelect = ({
  dropdownId,
  options,
  selectedAccountIds,
  disabled = false,
  onChange,
}: SequenceMailboxMultiSelectProps) => {
  const optionById = new Map(options.map((option) => [option.value, option]));
  const selectedLabels = selectedAccountIds.map(
    (accountId) => optionById.get(accountId)?.label ?? t`Unavailable mailbox`,
  );
  const displayLabel =
    selectedLabels.length === 0
      ? t`Choose mailboxes`
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : selectedLabels.length >= MAXIMUM_SENDER_POOL_SIZE
          ? t`${selectedLabels.length} mailboxes selected (maximum)`
          : t`${selectedLabels.length} mailboxes selected`;
  const hasReachedMaximumPoolSize =
    selectedAccountIds.length >= MAXIMUM_SENDER_POOL_SIZE;

  const toggleAccount = (accountId: string) => {
    if (disabled) {
      return;
    }

    if (selectedAccountIds.includes(accountId)) {
      onChange(
        selectedAccountIds.filter((selectedId) => selectedId !== accountId),
      );

      return;
    }

    if (selectedAccountIds.length >= MAXIMUM_SENDER_POOL_SIZE) {
      return;
    }

    onChange([...selectedAccountIds, accountId]);
  };

  return (
    <Dropdown
      dropdownId={dropdownId}
      dropdownPlacement="bottom-start"
      dropdownOffset={{ y: 8 }}
      clickableComponentWidth="100%"
      disableClickForClickableComponent={disabled}
      clickableComponent={
        <SelectControl
          selectedOption={{ label: displayLabel, value: displayLabel }}
          isDisabled={disabled}
          hasRightElement={false}
        />
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.ExtraLarge}>
          <DropdownMenuItemsContainer>
            {options.map((option) => {
              const isSelected = selectedAccountIds.includes(option.value);

              return (
                <MenuItemMultiSelect
                  key={option.value}
                  text={option.label}
                  selected={isSelected}
                  disabled={
                    disabled || (hasReachedMaximumPoolSize && !isSelected)
                  }
                  className="sequence-mailbox-pool-menu-item"
                  onSelectChange={() => toggleAccount(option.value)}
                />
              );
            })}
          </DropdownMenuItemsContainer>
        </DropdownContent>
      }
    />
  );
};
