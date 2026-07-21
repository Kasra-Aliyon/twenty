import { useLingui } from '@lingui/react/macro';
import {
  IconDotsVertical,
  IconPencil,
  IconPinned,
  IconTrash,
} from 'twenty-ui/icon';
import { LightIconButton } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';

import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';

type RecordListItemActionsDropdownProps = {
  itemId: string;
  itemKind: 'folder' | 'list';
  isDeleteDisabled?: boolean;
  isPinDisabled?: boolean;
  onDelete: () => void;
  onPin: () => void;
  onRename: () => void;
};

export const RecordListItemActionsDropdown = ({
  itemId,
  itemKind,
  isDeleteDisabled = false,
  isPinDisabled = false,
  onDelete,
  onPin,
  onRename,
}: RecordListItemActionsDropdownProps) => {
  const { t } = useLingui();
  const { closeDropdown } = useCloseDropdown();
  const dropdownId = `record-list-${itemKind}-actions-${itemId}`;

  const runAction = (action: () => void) => {
    closeDropdown(dropdownId);
    action();
  };

  return (
    <Dropdown
      dropdownId={dropdownId}
      dropdownPlacement="bottom-end"
      clickableComponent={
        <LightIconButton
          Icon={IconDotsVertical}
          accent="tertiary"
          aria-label={
            itemKind === 'folder' ? t`Folder actions` : t`List actions`
          }
        />
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.Narrow}>
          <DropdownMenuItemsContainer>
            <MenuItem
              LeftIcon={IconPinned}
              text={t`Pin to top`}
              disabled={isPinDisabled}
              onClick={() => runAction(onPin)}
            />
            <MenuItem
              LeftIcon={IconPencil}
              text={t`Rename`}
              onClick={() => runAction(onRename)}
            />
            <MenuItem
              LeftIcon={IconTrash}
              text={t`Delete`}
              accent="danger"
              disabled={isDeleteDisabled}
              onClick={() => runAction(onDelete)}
            />
          </DropdownMenuItemsContainer>
        </DropdownContent>
      }
    />
  );
};
