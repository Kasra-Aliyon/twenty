import { useMyConnectedAccounts } from '@/settings/accounts/hooks/useMyConnectedAccounts';
import { SettingsCounter } from '@/settings/components/SettingsCounter';
import { UPDATE_CONNECTED_ACCOUNT_SEQUENCE_EMAIL_SETTINGS } from '@/settings/accounts/graphql/mutations/updateConnectedAccountSequenceEmailSettings';
import { isSequenceEmailSenderAccountReady } from '@/sequence/utils/isSequenceSenderAccount';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { useMutation } from '@apollo/client/react';
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { useEffect, useMemo, useState } from 'react';
import { Button, Toggle } from 'twenty-ui/input';
import { Section } from 'twenty-ui/layout';
import { Card, CardContent } from 'twenty-ui/surfaces';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { H2Title } from 'twenty-ui/typography';

import {
  StyledActionRow,
  StyledNotice,
  StyledSettingDescription,
  StyledSettingRow,
  StyledSettingText,
  StyledSettingTitle,
} from './SettingsOutreachStyles';

type MailboxLimitDraft = {
  sequenceDailyEmailLimitEnabled: boolean;
  sequenceDailyEmailLimit: number;
};

const StyledMailboxControls = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[3]};
`;

const DEFAULT_DAILY_EMAIL_LIMIT = 30;

export const SettingsOutreachMailboxLimits = () => {
  const { accounts, loading } = useMyConnectedAccounts();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const [updateConnectedAccountSequenceEmailSettings] = useMutation(
    UPDATE_CONNECTED_ACCOUNT_SEQUENCE_EMAIL_SETTINGS,
  );
  const [draftByAccountId, setDraftByAccountId] = useState<
    Record<string, MailboxLimitDraft>
  >({});
  const [isSaving, setIsSaving] = useState(false);
  const senderAccounts = useMemo(
    () => accounts.filter(isSequenceEmailSenderAccountReady),
    [accounts],
  );

  useEffect(() => {
    setDraftByAccountId(
      Object.fromEntries(
        senderAccounts.map((account) => [
          account.id,
          {
            sequenceDailyEmailLimitEnabled:
              account.sequenceDailyEmailLimitEnabled ?? false,
            sequenceDailyEmailLimit:
              account.sequenceDailyEmailLimit ?? DEFAULT_DAILY_EMAIL_LIMIT,
          },
        ]),
      ),
    );
  }, [senderAccounts]);

  const updateDraft = (
    accountId: string,
    update: Partial<MailboxLimitDraft>,
  ) => {
    setDraftByAccountId((currentDrafts) => ({
      ...currentDrafts,
      [accountId]: {
        sequenceDailyEmailLimitEnabled:
          currentDrafts[accountId]?.sequenceDailyEmailLimitEnabled ?? false,
        sequenceDailyEmailLimit:
          currentDrafts[accountId]?.sequenceDailyEmailLimit ??
          DEFAULT_DAILY_EMAIL_LIMIT,
        ...update,
      },
    }));
  };

  const changedAccounts = senderAccounts.filter((account) => {
    const draft = draftByAccountId[account.id];

    return (
      draft !== undefined &&
      (draft.sequenceDailyEmailLimitEnabled !==
        (account.sequenceDailyEmailLimitEnabled ?? false) ||
        draft.sequenceDailyEmailLimit !==
          (account.sequenceDailyEmailLimit ?? DEFAULT_DAILY_EMAIL_LIMIT))
    );
  });
  const hasChanges = changedAccounts.length > 0;

  const save = async () => {
    setIsSaving(true);

    try {
      await Promise.all(
        changedAccounts.map((account) => {
          const draft = draftByAccountId[account.id];

          if (draft === undefined) {
            return Promise.resolve();
          }

          return updateConnectedAccountSequenceEmailSettings({
            variables: {
              id: account.id,
              input: draft,
            },
          });
        }),
      );
      enqueueSuccessSnackBar({ message: t`Mailbox email limits saved.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The mailbox email limits could not be saved.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Section>
      <H2Title
        title={t`Mailbox email limits`}
        description={t`Cap automated sequence emails across every sequence that uses each mailbox.`}
      />
      {senderAccounts.length > 0 ? (
        <>
          <Card rounded>
            {senderAccounts.map((account, index) => {
              const draft = draftByAccountId[account.id] ?? {
                sequenceDailyEmailLimitEnabled: false,
                sequenceDailyEmailLimit: DEFAULT_DAILY_EMAIL_LIMIT,
              };

              return (
                <CardContent
                  key={account.id}
                  divider={index < senderAccounts.length - 1}
                >
                  <StyledSettingRow>
                    <StyledSettingText>
                      <StyledSettingTitle>{account.handle}</StyledSettingTitle>
                      <StyledSettingDescription>
                        {draft.sequenceDailyEmailLimitEnabled
                          ? t`Stops new automated sequence sends after ${draft.sequenceDailyEmailLimit} emails in the UTC day.`
                          : t`Daily automated sequence email cap is off.`}
                      </StyledSettingDescription>
                    </StyledSettingText>
                    <StyledMailboxControls>
                      <Toggle
                        value={draft.sequenceDailyEmailLimitEnabled}
                        onChange={(sequenceDailyEmailLimitEnabled) =>
                          updateDraft(account.id, {
                            sequenceDailyEmailLimitEnabled,
                          })
                        }
                      />
                      <SettingsCounter
                        value={draft.sequenceDailyEmailLimit}
                        minValue={1}
                        maxValue={200}
                        showButtons={false}
                        disabled={!draft.sequenceDailyEmailLimitEnabled}
                        onChange={(sequenceDailyEmailLimit) =>
                          updateDraft(account.id, { sequenceDailyEmailLimit })
                        }
                      />
                    </StyledMailboxControls>
                  </StyledSettingRow>
                </CardContent>
              );
            })}
          </Card>
          <StyledActionRow>
            <Button
              title={t`Save mailbox limits`}
              onClick={() => void save()}
              isLoading={isSaving}
              disabled={!hasChanges}
            />
          </StyledActionRow>
        </>
      ) : (
        <StyledNotice>
          {loading
            ? t`Loading mailboxes…`
            : t`Connect and sync an email account to configure its daily limit.`}
        </StyledNotice>
      )}
    </Section>
  );
};
