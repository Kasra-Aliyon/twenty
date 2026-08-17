import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { getDefaultSequenceSettings } from '@/sequence/constants/default-sequence-settings';
import { type SequenceSenderAccount } from '@/sequence/types/SequenceSenderAccount';
import { isSequenceSenderAccount } from '@/sequence/utils/isSequenceSenderAccount';
import { useMyConnectedAccounts } from '@/settings/accounts/hooks/useMyConnectedAccounts';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Select } from '@/ui/input/components/Select';
import { PageCardHeader } from '@/ui/layout/page/components/PageCardHeader';
import { PageCardLayout } from '@/ui/layout/page/components/PageCardLayout';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { generatePath, Navigate, useNavigate } from 'react-router-dom';
import {
  AppPath,
  FeatureFlagKey,
  SEQUENCE_STATUSES,
} from 'twenty-shared/types';
import { IconSend } from 'twenty-ui/icon';
import { Button, type SelectOption } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

import {
  StyledActions,
  StyledField,
  StyledInput,
  StyledSection,
} from './components/SequencePageStyles';
import { type SequenceRecord } from './types/SequenceRecords';

const StyledCreateContent = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[4]};
  margin: 0 auto;
  max-width: 640px;
  padding: ${themeCssVariables.spacing[6]};
  width: 100%;
`;

const StyledMailboxHint = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
`;

const SequenceCreatePageContent = () => {
  const [name, setName] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const navigate = useNavigate();
  const { objectMetadataItem: sequenceObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'sequence' });
  const sequencePermissions = useObjectPermissionsForObject(
    sequenceObjectMetadataItem.id,
  );
  const { enqueueErrorSnackBar } = useSnackBar();
  const { createOneRecord, loading } = useCreateOneRecord<SequenceRecord>({
    objectNameSingular: 'sequence',
    skipPostOptimisticEffect: true,
  });
  const { accounts } = useMyConnectedAccounts();

  const accountOptions: SelectOption<string>[] = accounts
    .filter(isSequenceSenderAccount)
    .map((account: SequenceSenderAccount) => ({
      label: account.handle,
      value: account.id,
    }));
  const senderConnectedAccountId =
    selectedAccountId || accountOptions[0]?.value || '';

  const createSequence = async () => {
    if (!senderConnectedAccountId) {
      return;
    }

    try {
      const createdSequence = await createOneRecord({
        name: name.trim(),
        status: SEQUENCE_STATUSES.DRAFT,
        senderConnectedAccountId,
        settings: {
          ...getDefaultSequenceSettings(),
          senderConnectedAccountIds: [senderConnectedAccountId],
        },
      });

      navigate(
        generatePath(AppPath.SequencePage, {
          sequenceId: createdSequence.id,
        }),
      );
    } catch {
      enqueueErrorSnackBar({ message: t`The sequence could not be created.` });
    }
  };

  return (
    <PageContainer>
      <PageCardLayout
        header={
          <PageCardHeader
            icon={<IconSend size={18} />}
            title={t`New sequence`}
          />
        }
      >
        <StyledCreateContent
          onSubmit={(event) => {
            event.preventDefault();
            void createSequence();
          }}
        >
          <StyledSection>
            <StyledField>
              <span>{t`Sequence name`}</span>
              <StyledInput
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t`Outbound follow-up`}
                required
              />
            </StyledField>

            {accountOptions.length > 0 ? (
              <Select
                dropdownId="new-sequence-sender-account"
                label={t`Sender mailbox`}
                fullWidth
                value={senderConnectedAccountId}
                options={accountOptions}
                onChange={setSelectedAccountId}
              />
            ) : (
              <StyledMailboxHint>
                {t`Connect an email account and wait for inbox sync to finish before creating a sequence.`}
              </StyledMailboxHint>
            )}
          </StyledSection>

          <StyledActions>
            <Button
              title={t`Cancel`}
              type="button"
              variant="secondary"
              to={AppPath.SequencesPage}
            />
            <Button
              title={t`Create sequence`}
              type="submit"
              disabled={
                name.trim().length === 0 ||
                !senderConnectedAccountId ||
                !sequencePermissions.canUpdateObjectRecords
              }
              isLoading={loading}
            />
          </StyledActions>
        </StyledCreateContent>
      </PageCardLayout>
    </PageContainer>
  );
};

export const SequenceCreatePage = () => {
  const isOutreachSequencesEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
  );
  const doSequenceMetadataItemsExist = useDoObjectMetadataItemsExist([
    'sequence',
  ]);

  if (!isOutreachSequencesEnabled || !doSequenceMetadataItemsExist) {
    return <Navigate to={AppPath.NotFound} replace />;
  }

  return <SequenceCreatePageContent />;
};
