import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { t } from '@lingui/core/macro';
import { IconVariable } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';

const SEQUENCE_VARIABLES = [
  { name: 'firstName', label: t`First name` },
  { name: 'lastName', label: t`Last name` },
  { name: 'fullName', label: t`Full name` },
  { name: 'email', label: t`Email` },
  { name: 'linkedinUrl', label: t`LinkedIn URL` },
  { name: 'jobTitle', label: t`Job title` },
  { name: 'companyName', label: t`Company name` },
  { name: 'senderName', label: t`Sender name` },
  { name: 'senderEmail', label: t`Sender email` },
] as const;

type SequenceVariablePickerProps = {
  dropdownId: string;
  onVariableSelect: (variableName: string) => void;
};

export const SequenceVariablePicker = ({
  dropdownId,
  onVariableSelect,
}: SequenceVariablePickerProps) => {
  const { closeDropdown } = useCloseDropdown();

  return (
    <Dropdown
      dropdownId={dropdownId}
      dropdownPlacement="bottom-end"
      clickableComponent={
        <Button
          title={t`Insert variable`}
          Icon={IconVariable}
          variant="secondary"
          size="small"
        />
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.Medium}>
          <DropdownMenuItemsContainer>
            {SEQUENCE_VARIABLES.map((variable) => (
              <MenuItem
                key={variable.name}
                LeftIcon={IconVariable}
                text={variable.label}
                contextualText={`{{ ${variable.name} }}`}
                onClick={() => {
                  onVariableSelect(variable.name);
                  closeDropdown(dropdownId);
                }}
              />
            ))}
          </DropdownMenuItemsContainer>
        </DropdownContent>
      }
    />
  );
};
