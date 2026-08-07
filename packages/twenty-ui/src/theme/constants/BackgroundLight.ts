import { COLOR_LIGHT } from '@ui/theme/constants/ColorsLight';
import { GRAY_SCALE_LIGHT } from './GrayScaleLight';
import { TRANSPARENT_COLORS_LIGHT } from './TransparentColorsLight';

export const BACKGROUND_LIGHT = {
  noisy: 'none',
  primary: GRAY_SCALE_LIGHT.gray1,
  secondary: GRAY_SCALE_LIGHT.gray2,
  tertiary: GRAY_SCALE_LIGHT.gray3,
  quaternary: GRAY_SCALE_LIGHT.gray4,
  invertedPrimary: GRAY_SCALE_LIGHT.gray12,
  invertedSecondary: GRAY_SCALE_LIGHT.gray11,
  danger: COLOR_LIGHT.red3,
  transparent: {
    primary: 'rgba(255, 255, 255, 0.94)',
    secondary: 'rgba(251, 251, 252, 0.82)',
    strong: 'rgba(0, 0, 0, 0.12)',
    medium: 'rgba(0, 0, 0, 0.08)',
    light: 'rgba(0, 0, 0, 0.05)',
    lighter: 'rgba(0, 0, 0, 0.03)',
    danger: TRANSPARENT_COLORS_LIGHT.red3,
    blue: TRANSPARENT_COLORS_LIGHT.blue3,
    orange: TRANSPARENT_COLORS_LIGHT.orange3,
    success: TRANSPARENT_COLORS_LIGHT.green3,
  },
  overlayPrimary: 'rgba(0, 0, 0, 0.5)',
  overlaySecondary: 'rgba(0, 0, 0, 0.25)',
  overlayTertiary: 'rgba(0, 0, 0, 0.08)',
  radialGradient: `radial-gradient(50% 62.62% at 50% 0%, ${GRAY_SCALE_LIGHT.gray9} 0%, ${GRAY_SCALE_LIGHT.gray10} 100%)`,
  radialGradientHover: `radial-gradient(76.32% 95.59% at 50% 0%, ${GRAY_SCALE_LIGHT.gray10} 0%, ${GRAY_SCALE_LIGHT.gray11} 100%)`,
  primaryInverted: GRAY_SCALE_LIGHT.gray12,
  primaryInvertedHover: GRAY_SCALE_LIGHT.gray11,
};
