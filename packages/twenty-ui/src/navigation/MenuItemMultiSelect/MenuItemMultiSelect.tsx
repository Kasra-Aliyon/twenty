import { Tag } from '@ui/data-display';
import { type IconComponent } from '@ui/icon';
import { Checkbox } from '@ui/input/Checkbox/Checkbox';
import { MenuItemLeftContent } from '@ui/navigation/MenuItem/parts/MenuItemLeftContent';
import { type ThemeColor } from '@ui/theme';
import { StyledMenuItemBase } from '@ui/navigation/MenuItem/parts/StyledMenuItemBase';

import styles from './MenuItemMultiSelect.module.scss';

type MenuItemMultiSelectProps = {
  color?: ThemeColor;
  LeftIcon?: IconComponent;
  iconThemeColor?: ThemeColor | null;
  selected: boolean;
  isKeySelected?: boolean;
  withIconContainer?: boolean;
  text: string;
  className: string;
  disabled?: boolean;
  onSelectChange?: (selected: boolean) => void;
};

export const MenuItemMultiSelect = ({
  color,
  LeftIcon,
  iconThemeColor,
  withIconContainer = false,
  text,
  selected,
  isKeySelected,
  className,
  disabled = false,
  onSelectChange,
}: MenuItemMultiSelectProps) => {
  const handleOnClick = () => {
    if (disabled) {
      return;
    }

    onSelectChange?.(!selected);
  };

  return (
    <StyledMenuItemBase
      isKeySelected={isKeySelected}
      className={className}
      disabled={disabled}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled}
      onClick={handleOnClick}
    >
      <div className={styles.leftContentWithCheckboxContainer}>
        <Checkbox checked={selected} disabled={disabled} aria-label={text} />
        {color ? (
          <Tag color={color} text={text} Icon={LeftIcon} />
        ) : (
          <MenuItemLeftContent
            LeftIcon={LeftIcon}
            iconThemeColor={iconThemeColor}
            text={text}
            withIconContainer={withIconContainer}
          />
        )}
      </div>
    </StyledMenuItemBase>
  );
};
