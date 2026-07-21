import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { type FeatureFlagKey as SharedFeatureFlagKey } from 'twenty-shared/types';
import { type FeatureFlagKey as MetadataFeatureFlagKey } from '~/generated-metadata/graphql';

export const useIsFeatureEnabled = (
  featureKey: SharedFeatureFlagKey | MetadataFeatureFlagKey | null,
) => {
  const currentWorkspace = useAtomStateValue(currentWorkspaceState);

  if (!featureKey) {
    return false;
  }

  const featureFlag = currentWorkspace?.featureFlags?.find(
    (flag) => flag.key === featureKey,
  );

  return !!featureFlag?.value;
};
