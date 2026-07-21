import { FeatureFlagKey } from 'twenty-shared/types';

export const DEFAULT_FEATURE_FLAGS = [
  FeatureFlagKey.IS_RECORD_LISTS_ENABLED,
  FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
  FeatureFlagKey.IS_REST_METADATA_API_NEW_FORMAT_DIRECT,
] as const satisfies FeatureFlagKey[];
