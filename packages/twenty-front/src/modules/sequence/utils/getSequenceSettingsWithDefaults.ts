import { getDefaultSequenceSettings } from '@/sequence/constants/default-sequence-settings';
import { type SequenceSettings } from 'twenty-shared/types';

export function getSequenceSettingsWithDefaults(
  settings: Partial<SequenceSettings>,
): SequenceSettings {
  const defaults = getDefaultSequenceSettings();

  return {
    ...defaults,
    ...settings,
    emailWindowStart:
      settings.emailWindowStart ??
      settings.windowStart ??
      defaults.emailWindowStart,
    emailWindowEnd:
      settings.emailWindowEnd ?? settings.windowEnd ?? defaults.emailWindowEnd,
  };
}
