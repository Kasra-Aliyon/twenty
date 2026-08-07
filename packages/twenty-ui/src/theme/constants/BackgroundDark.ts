import { COLOR_DARK } from '@ui/theme/constants/ColorsDark';
import { GRAY_SCALE_DARK } from './GrayScaleDark';
import { TRANSPARENT_COLORS_DARK } from './TransparentColorsDark';

export const BACKGROUND_DARK = {
  noisy: 'none',
  primary: GRAY_SCALE_DARK.gray1,
  secondary: GRAY_SCALE_DARK.gray2,
  tertiary: GRAY_SCALE_DARK.gray3,
  quaternary: GRAY_SCALE_DARK.gray4,
  invertedPrimary: GRAY_SCALE_DARK.gray12,
  invertedSecondary: GRAY_SCALE_DARK.gray11,
  danger: COLOR_DARK.red3,
  transparent: {
    primary: 'rgba(8, 9, 10, 0.94)',
    secondary: 'rgba(15, 16, 17, 0.82)',
    strong: 'rgba(255, 255, 255, 0.12)',
    medium: 'rgba(255, 255, 255, 0.08)',
    light: 'rgba(255, 255, 255, 0.05)',
    lighter: 'rgba(255, 255, 255, 0.03)',
    danger: TRANSPARENT_COLORS_DARK.red3,
    blue: TRANSPARENT_COLORS_DARK.blue4,
    orange: TRANSPARENT_COLORS_DARK.orange4,
    success: TRANSPARENT_COLORS_DARK.green4,
  },
  overlayPrimary: 'rgba(0, 0, 0, 0.72)',
  overlaySecondary: 'rgba(0, 0, 0, 0.42)',
  overlayTertiary: 'rgba(0, 0, 0, 0.24)',
  radialGradient: `radial-gradient(50% 62.62% at 50% 0%, ${GRAY_SCALE_DARK.gray9} 0%, ${GRAY_SCALE_DARK.gray10} 100%)`,
  radialGradientHover: `radial-gradient(76.32% 95.59% at 50% 0%, ${GRAY_SCALE_DARK.gray10} 0%, ${GRAY_SCALE_DARK.gray11} 100%)`,
  primaryInverted: GRAY_SCALE_DARK.gray12,
  primaryInvertedHover: GRAY_SCALE_DARK.gray11,
};
