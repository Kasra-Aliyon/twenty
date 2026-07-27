import { useMutation } from '@apollo/client/react';
import { t } from '@lingui/core/macro';
import { IconPhone, IconSparkles } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';

import { useCurrentCommandMenuContextApi } from '@/command-menu-item/hooks/useCurrentCommandMenuContextApi';
import {
  EnrichCompaniesWithApolloDocument,
  EnrichPeoplePhonesWithApolloDocument,
  EnrichPeopleWithApolloDocument,
} from '~/generated-metadata/graphql';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { ConfirmationModal } from '@/ui/layout/modal/components/ConfirmationModal';
import { useModal } from '@/ui/layout/modal/hooks/useModal';

const APOLLO_ENRICHMENT_MAX_RECORDS_PER_REQUEST = 100;
const APOLLO_ENRICHMENT_DROPDOWN_ID = 'apollo-enrichment-actions';
const APOLLO_GENERAL_ENRICHMENT_MODAL_ID =
  'apollo-general-enrichment-confirmation';
const APOLLO_PHONE_ENRICHMENT_MODAL_ID = 'apollo-phone-enrichment-confirmation';

type ApolloEnrichmentBatchResult = {
  requestedCount: number;
  updatedCount: number;
  skippedCount: number;
  notMatchedCount: number;
  notFoundCount: number;
  failedCount: number;
  disabled: boolean;
};

type ApolloEnrichmentKind = 'general' | 'phone';

export const ApolloEnrichmentAction = ({
  objectNameSingular,
}: {
  objectNameSingular: string;
}) => {
  const { selectedRecords } = useCurrentCommandMenuContextApi();
  const { objectMetadataItem } = useObjectMetadataItem({ objectNameSingular });
  const objectPermissions = useObjectPermissionsForObject(
    objectMetadataItem.id,
  );
  const { closeDropdown } = useCloseDropdown();
  const { openModal } = useModal();
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueErrorSnackBar, enqueueSuccessSnackBar } = useSnackBar();

  const [enrichPeople, { loading: arePeopleEnriching }] = useMutation(
    EnrichPeopleWithApolloDocument,
  );
  const [enrichPeoplePhones, { loading: arePhonesEnriching }] = useMutation(
    EnrichPeoplePhonesWithApolloDocument,
  );
  const [enrichCompanies, { loading: areCompaniesEnriching }] = useMutation(
    EnrichCompaniesWithApolloDocument,
  );

  const isPerson = objectNameSingular === 'person';
  const isCompany = objectNameSingular === 'company';
  const isEnriching =
    arePeopleEnriching || arePhonesEnriching || areCompaniesEnriching;
  const selectedRecordCount = selectedRecords.length;

  if (
    (!isPerson && !isCompany) ||
    !objectPermissions.canUpdateObjectRecords ||
    selectedRecordCount === 0
  ) {
    return null;
  }

  const openConfirmation = (kind: ApolloEnrichmentKind) => {
    closeDropdown(APOLLO_ENRICHMENT_DROPDOWN_ID);

    if (selectedRecordCount > APOLLO_ENRICHMENT_MAX_RECORDS_PER_REQUEST) {
      enqueueErrorSnackBar({
        message: t`Select no more than ${APOLLO_ENRICHMENT_MAX_RECORDS_PER_REQUEST} records at a time for Apollo enrichment.`,
      });

      return;
    }

    openModal(
      kind === 'phone'
        ? APOLLO_PHONE_ENRICHMENT_MODAL_ID
        : APOLLO_GENERAL_ENRICHMENT_MODAL_ID,
    );
  };

  const handleResult = async (
    result: ApolloEnrichmentBatchResult,
    kind: ApolloEnrichmentKind,
  ) => {
    if (result.disabled) {
      enqueueErrorSnackBar({
        message: t`Apollo enrichment is not enabled for this server.`,
      });

      return;
    }

    await apolloCoreClient.refetchQueries({ include: 'active' });

    if (result.failedCount > 0) {
      enqueueErrorSnackBar({
        message: t`${result.updatedCount} of ${result.requestedCount} records were enriched. ${result.failedCount} failed.`,
      });

      return;
    }

    const unchangedCount =
      result.skippedCount + result.notMatchedCount + result.notFoundCount;

    enqueueSuccessSnackBar({
      message:
        kind === 'phone'
          ? t`Phone enrichment finished: ${result.updatedCount} updated, ${unchangedCount} unchanged.`
          : t`Apollo enrichment finished: ${result.updatedCount} updated, ${unchangedCount} unchanged.`,
    });
  };

  const runEnrichment = async (kind: ApolloEnrichmentKind) => {
    const variables = {
      input: {
        recordIds: selectedRecords.map((record) => record.id),
      },
    };

    try {
      if (kind === 'phone') {
        const { data } = await enrichPeoplePhones({ variables });
        const result = data?.enrichPeoplePhonesWithApollo;

        if (result) {
          await handleResult(result, kind);
        }

        return;
      }

      if (isPerson) {
        const { data } = await enrichPeople({ variables });
        const result = data?.enrichPeopleWithApollo;

        if (result) {
          await handleResult(result, kind);
        }

        return;
      }

      const { data } = await enrichCompanies({ variables });
      const result = data?.enrichCompaniesWithApollo;

      if (result) {
        await handleResult(result, kind);
      }
    } catch {
      enqueueErrorSnackBar({
        message: t`Apollo enrichment could not be completed.`,
      });
    }
  };

  const actionButton = (
    <Button
      title={t`Enrich`}
      Icon={IconSparkles}
      variant="secondary"
      size="small"
      isLoading={isEnriching}
      onClick={isCompany ? () => openConfirmation('general') : undefined}
    />
  );

  return (
    <>
      {isPerson ? (
        <Dropdown
          dropdownId={APOLLO_ENRICHMENT_DROPDOWN_ID}
          dropdownPlacement="bottom-end"
          clickableComponent={actionButton}
          dropdownComponents={
            <DropdownContent
              widthInPixels={GenericDropdownContentWidth.ExtraLarge}
            >
              <DropdownMenuItemsContainer>
                <MenuItem
                  LeftIcon={IconSparkles}
                  text={t`Enrich data and emails with Apollo`}
                  onClick={() => openConfirmation('general')}
                />
                <MenuItem
                  LeftIcon={IconPhone}
                  text={t`Enrich phone numbers with Apollo`}
                  onClick={() => openConfirmation('phone')}
                />
              </DropdownMenuItemsContainer>
            </DropdownContent>
          }
        />
      ) : (
        actionButton
      )}
      <ConfirmationModal
        modalInstanceId={APOLLO_GENERAL_ENRICHMENT_MODAL_ID}
        title={t`Enrich with Apollo`}
        subtitle={t`This will enrich ${selectedRecordCount} records and can consume up to ${selectedRecordCount} Apollo credits (no charge for unmatched records). Phone numbers are excluded.`}
        onConfirmClick={() => void runEnrichment('general')}
        confirmButtonText={t`Enrich records`}
        confirmButtonAccent="blue"
      />
      {isPerson && (
        <ConfirmationModal
          modalInstanceId={APOLLO_PHONE_ENRICHMENT_MODAL_ID}
          title={t`Enrich phone numbers with Apollo`}
          subtitle={t`This will enrich ${selectedRecordCount} people and can consume up to 9 Apollo credits per person when data is found. Phone verification can take several minutes.`}
          onConfirmClick={() => void runEnrichment('phone')}
          confirmButtonText={t`Enrich phone numbers`}
          confirmButtonAccent="blue"
        />
      )}
    </>
  );
};
