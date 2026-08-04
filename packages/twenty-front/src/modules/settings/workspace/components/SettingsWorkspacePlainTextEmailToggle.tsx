import { currentWorkspaceState } from '@/auth/states/currentWorkspaceState';
import { SettingsOptionCardContentToggle } from '@/settings/components/SettingsOptions/SettingsOptionCardContentToggle';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';
import { t } from '@lingui/core/macro';
import { useMutation } from '@apollo/client/react';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { IconTextWrap } from 'twenty-ui/icon';
import { Card } from 'twenty-ui/surfaces';
import { UpdateWorkspaceDocument } from '~/generated-metadata/graphql';

export const SettingsWorkspacePlainTextEmailToggle = () => {
  const { enqueueErrorSnackBar } = useSnackBar();
  const [currentWorkspace, setCurrentWorkspace] = useAtomState(
    currentWorkspaceState,
  );
  const [updateWorkspace] = useMutation(UpdateWorkspaceDocument);

  const handleChange = async (isPlainTextEmailEnabled: boolean) => {
    try {
      if (!currentWorkspace?.id) {
        throw new Error('User is not logged in');
      }

      await updateWorkspace({
        variables: {
          input: { isPlainTextEmailEnabled },
        },
      });

      setCurrentWorkspace({
        ...currentWorkspace,
        isPlainTextEmailEnabled,
      });
    } catch (error) {
      enqueueErrorSnackBar({
        apolloError: CombinedGraphQLErrors.is(error) ? error : undefined,
      });
    }
  };

  return (
    <Card rounded>
      <SettingsOptionCardContentToggle
        Icon={IconTextWrap}
        title={t`Send emails as plain text`}
        description={t`Send new emails, replies, drafts, sequences, workflows, and campaigns without an HTML part. Incoming emails are not affected.`}
        checked={currentWorkspace?.isPlainTextEmailEnabled ?? false}
        onChange={handleChange}
      />
    </Card>
  );
};
