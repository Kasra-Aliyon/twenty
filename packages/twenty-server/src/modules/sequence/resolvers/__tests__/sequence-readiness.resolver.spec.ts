import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { SequenceInvariantService } from 'src/modules/sequence/query-hooks/sequence-invariant.service';
import { SequenceReadinessResolver } from 'src/modules/sequence/resolvers/sequence-readiness.resolver';

const mockGetWorkspaceAuthContext = jest.fn();

jest.mock(
  'src/engine/core-modules/auth/storage/workspace-auth-context.storage',
  () => ({
    getWorkspaceAuthContext: () => mockGetWorkspaceAuthContext(),
  }),
);

describe('SequenceReadinessResolver', () => {
  const workspace = { id: 'workspace-id' };
  const authContext = { workspace };
  const featureFlagService = {
    isFeatureEnabled: jest.fn(),
  };
  const sequenceInvariantService = {
    assertSequenceReadable: jest.fn(),
    assertSequenceActivationReady: jest.fn(),
  };
  const resolver = new SequenceReadinessResolver(
    featureFlagService as unknown as FeatureFlagService,
    sequenceInvariantService as unknown as SequenceInvariantService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetWorkspaceAuthContext.mockReturnValue(authContext);
    sequenceInvariantService.assertSequenceReadable.mockResolvedValue(
      undefined,
    );
  });

  it('advertises the atomic patch protocol supported by sequence query hooks', () => {
    expect(resolver.sequenceMutationCapabilities()).toEqual({
      atomicSettingsPatch: true,
      atomicSettingsPatchVersion: 1,
      atomicStepAppend: true,
      atomicStepAppendVersion: 1,
      enrollmentStartStep: true,
      enrollmentStartStepVersion: 1,
    });
  });

  it('reports ready when the feature is enabled and activation invariants pass', async () => {
    featureFlagService.isFeatureEnabled.mockResolvedValue(true);
    sequenceInvariantService.assertSequenceActivationReady.mockResolvedValue(
      undefined,
    );

    await expect(
      resolver.sequenceReadiness('sequence-id', workspace as never),
    ).resolves.toEqual({ ready: true, errors: [] });

    expect(
      sequenceInvariantService.assertSequenceActivationReady,
    ).toHaveBeenCalledWith({ authContext, sequenceId: 'sequence-id' });
    expect(
      sequenceInvariantService.assertSequenceReadable,
    ).toHaveBeenCalledWith({ authContext, sequenceId: 'sequence-id' });
  });

  it('reports the feature blocker and first activation blocker without activating the sequence', async () => {
    featureFlagService.isFeatureEnabled.mockResolvedValue(false);
    sequenceInvariantService.assertSequenceActivationReady.mockRejectedValue(
      new Error('Choose a sender before activating the sequence'),
    );

    await expect(
      resolver.sequenceReadiness('sequence-id', workspace as never),
    ).resolves.toEqual({
      ready: false,
      errors: [
        'Outreach sequences are disabled for this workspace, so the scheduler will not run',
        'Choose a sender before activating the sequence',
      ],
    });
  });

  it('does not probe readiness when the sequence is not readable', async () => {
    sequenceInvariantService.assertSequenceReadable.mockRejectedValue(
      new Error('Permission denied'),
    );

    await expect(
      resolver.sequenceReadiness('sequence-id', workspace as never),
    ).rejects.toThrow('Permission denied');
    expect(featureFlagService.isFeatureEnabled).not.toHaveBeenCalled();
    expect(
      sequenceInvariantService.assertSequenceActivationReady,
    ).not.toHaveBeenCalled();
  });
});
