import { ACCENT_DARK } from '@ui/theme/constants/AccentDark';
import { ANIMATION } from './Animation';
import { ICON } from './Icon';
import { MODAL } from './Modal';
import { TEXT } from './Text';

export const THEME_COMMON = {
  icon: ICON,
  modal: MODAL,
  text: TEXT,
  animation: ANIMATION,
  spacingMultiplicator: 4,
  spacing: (...args: number[]) =>
    args.map((multiplicator) => `${multiplicator * 4}px`).join(' '),
  betweenSiblingsGap: `2px`,
  table: {
    horizontalCellMargin: '8px',
    checkboxColumnWidth: '32px',
    horizontalCellPadding: '8px',
  },
  sidePanelWidth: '500px',
  clickableElementBackgroundTransition:
    'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
  lastLayerZIndex: 2147483647,
  buttons: {
    secondaryTextColor: ACCENT_DARK.accent11,
  },
};
