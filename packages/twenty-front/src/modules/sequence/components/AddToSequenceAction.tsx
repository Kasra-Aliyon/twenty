import { useCurrentCommandMenuContextApi } from '@/command-menu-item/hooks/useCurrentCommandMenuContextApi';
import { contextStoreAnyFieldFilterValueComponentState } from '@/context-store/states/contextStoreAnyFieldFilterValueComponentState';
import { contextStoreFilterGroupsComponentState } from '@/context-store/states/contextStoreFilterGroupsComponentState';
import { contextStoreFiltersComponentState } from '@/context-store/states/contextStoreFiltersComponentState';
import { contextStoreTargetedRecordsRuleComponentState } from '@/context-store/states/contextStoreTargetedRecordsRuleComponentState';
import { computeContextStoreFilters } from '@/context-store/utils/computeContextStoreFilters';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { flattenedFieldMetadataItemsSelector } from '@/object-metadata/states/flattenedFieldMetadataItemsSelector';
import { useBatchCreateManyRecords } from '@/object-record/hooks/useBatchCreateManyRecords';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useLazyFetchAllRecords } from '@/object-record/hooks/useLazyFetchAllRecords';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { useFilterValueDependencies } from '@/object-record/record-filter/hooks/useFilterValueDependencies';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { getRecordsFromRecordConnection } from '@/object-record/cache/utils/getRecordsFromRecordConnection';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { useAtomComponentStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentStateValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  FeatureFlagKey,
  type RecordGqlOperationFilter,
  SEQUENCE_ACTION_EXECUTION_MODES,
  SEQUENCE_CONDITION_TYPES,
  SEQUENCE_STEP_TYPES,
  type SequenceConditionType,
  type SequenceSettings,
  type SequenceStepSettings,
  type SequenceStatus,
} from 'twenty-shared/types';
import { combineFilters } from 'twenty-shared/utils';
import { IconSend } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';

type SequenceForEnrollment = ObjectRecord & {
  name: string;
  status: SequenceStatus;
  senderConnectedAccountId: string | null;
  settings: SequenceSettings;
  steps?: Array<{
    settings: SequenceStepSettings;
  }>;
};

type ExistingSequenceEnrollment = ObjectRecord & {
  sequenceId: string;
  personId: string;
};

const SEQUENCES_PAGE_SIZE = 50;

const SENDER_DEPENDENT_CONDITIONS: ReadonlySet<SequenceConditionType> = new Set(
  [
    SEQUENCE_CONDITION_TYPES.IS_IN_LINKEDIN_NETWORK,
    SEQUENCE_CONDITION_TYPES.ACCEPTED_LINKEDIN_INVITE,
    SEQUENCE_CONDITION_TYPES.OPENED_LINKEDIN_MESSAGE,
  ],
);

const doesSequenceRequireSender = (sequence: SequenceForEnrollment): boolean =>
  sequence.steps?.some(({ settings }) => {
    switch (settings.type) {
      case SEQUENCE_STEP_TYPES.SEND_EMAIL:
        return (
          settings.executionMode !== SEQUENCE_ACTION_EXECUTION_MODES.MANUAL
        );
      case SEQUENCE_STEP_TYPES.SEND_CONNECTION_REQUEST:
      case SEQUENCE_STEP_TYPES.SEND_LINKEDIN_MESSAGE:
      case SEQUENCE_STEP_TYPES.WITHDRAW_CONNECTION_REQUEST:
        return true;
      case SEQUENCE_STEP_TYPES.CONDITION:
        return SENDER_DEPENDENT_CONDITIONS.has(settings.condition);
      default:
        return false;
    }
  }) ?? false;

const AddToSequenceActionContent = ({
  requiredFilter,
}: {
  requiredFilter?: RecordGqlOperationFilter;
}) => {
  const dropdownId = 'add-selected-people-to-sequence';
  const [isSaving, setIsSaving] = useState(false);
  const { closeDropdown } = useCloseDropdown();
  const { selectedRecords, isSelectAll, numberOfSelectedRecords } =
    useCurrentCommandMenuContextApi();
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const { objectMetadataItem: personObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'person' });
  const { objectMetadataItem: enrollmentObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'sequenceEnrollment' });
  const enrollmentPermissions = useObjectPermissionsForObject(
    enrollmentObjectMetadataItem.id,
  );
  const contextStoreTargetedRecordsRule = useAtomComponentStateValue(
    contextStoreTargetedRecordsRuleComponentState,
  );
  const contextStoreFilters = useAtomComponentStateValue(
    contextStoreFiltersComponentState,
  );
  const contextStoreFilterGroups = useAtomComponentStateValue(
    contextStoreFilterGroupsComponentState,
  );
  const contextStoreAnyFieldFilterValue = useAtomComponentStateValue(
    contextStoreAnyFieldFilterValueComponentState,
  );
  const { filterValueDependencies } = useFilterValueDependencies();
  const flattenedFieldMetadataItems = useAtomStateValue(
    flattenedFieldMetadataItemsSelector,
  );

  const targetedPeopleFilter = combineFilters([
    computeContextStoreFilters({
      contextStoreTargetedRecordsRule,
      contextStoreFilters,
      contextStoreFilterGroups,
      objectMetadataItem: personObjectMetadataItem,
      fieldMetadataItems: flattenedFieldMetadataItems,
      filterValueDependencies,
      contextStoreAnyFieldFilterValue,
    }),
    requiredFilter,
  ]);

  const { fetchAllRecords: fetchAllTargetedPeople } =
    useLazyFetchAllRecords<ObjectRecord>({
      objectNameSingular: 'person',
      filter: targetedPeopleFilter,
      recordGqlFields: { id: true },
      limit: QUERY_MAX_RECORDS,
    });
  const {
    records: sequences,
    fetchMoreRecords: fetchMoreSequences,
    hasNextPage: hasMoreSequences,
    loading: areSequencesLoading,
  } = useFindManyRecords<SequenceForEnrollment>({
    objectNameSingular: 'sequence',
    orderBy: [{ name: 'AscNullsLast' }],
    recordGqlFields: {
      id: true,
      name: true,
      status: true,
      senderConnectedAccountId: true,
      settings: true,
      steps: {
        id: true,
        settings: true,
      },
    },
    limit: SEQUENCES_PAGE_SIZE,
  });

  const {
    loading: areEnrollmentsLoading,
    refetch: refetchExistingEnrollments,
  } = useFindManyRecords<ExistingSequenceEnrollment>({
    objectNameSingular: 'sequenceEnrollment',
    filter: {
      personId: { in: selectedRecords.map((record) => record.id) },
    },
    recordGqlFields: {
      id: true,
      sequenceId: true,
      personId: true,
    },
    limit: QUERY_MAX_RECORDS,
    skip: selectedRecords.length === 0,
  });
  const { batchCreateManyRecords } = useBatchCreateManyRecords({
    objectNameSingular: 'sequenceEnrollment',
    skipPostOptimisticEffect: true,
  });

  if (
    !enrollmentPermissions.canUpdateObjectRecords ||
    numberOfSelectedRecords === 0
  ) {
    return null;
  }

  const addToSequence = async (sequence: SequenceForEnrollment) => {
    if (areEnrollmentsLoading) {
      return;
    }

    closeDropdown(dropdownId);
    setIsSaving(true);

    try {
      const targetedPeople = isSelectAll
        ? await fetchAllTargetedPeople()
        : selectedRecords;
      const peopleToEnroll: { id: string }[] = [];

      for (
        let batchStart = 0;
        batchStart < targetedPeople.length;
        batchStart += QUERY_MAX_RECORDS
      ) {
        const peopleBatch = targetedPeople.slice(
          batchStart,
          batchStart + QUERY_MAX_RECORDS,
        );
        const { data } = await refetchExistingEnrollments({
          filter: {
            and: [
              { sequenceId: { eq: sequence.id } },
              { personId: { in: peopleBatch.map((record) => record.id) } },
            ],
          },
          limit: QUERY_MAX_RECORDS,
        });

        if (!data) {
          throw new Error('Could not verify existing sequence enrollments');
        }

        const existingEnrollments =
          getRecordsFromRecordConnection<ExistingSequenceEnrollment>({
            recordConnection: data.sequenceEnrollments,
          });
        const alreadyEnrolledPersonIds = new Set(
          existingEnrollments.map((enrollment) => enrollment.personId),
        );

        peopleToEnroll.push(
          ...peopleBatch.filter(
            (person) => !alreadyEnrolledPersonIds.has(person.id),
          ),
        );
      }

      if (peopleToEnroll.length === 0) {
        enqueueSuccessSnackBar({
          message: t`The selected people are already in this sequence.`,
        });
        return;
      }

      await batchCreateManyRecords({
        recordsToCreate: peopleToEnroll.map((person) => ({
          sequenceId: sequence.id,
          personId: person.id,
          stopOnReply: sequence.settings.stopOnReply,
        })),
      });
      await apolloCoreClient.refetchQueries({ include: 'active' });
      enqueueSuccessSnackBar({ message: t`People added to the sequence.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`Some people could not be added to the sequence.`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dropdown
      dropdownId={dropdownId}
      dropdownPlacement="bottom-end"
      clickableComponent={
        <Button
          title={t`Add to sequence`}
          Icon={IconSend}
          variant="secondary"
          size="small"
          isLoading={isSaving}
        />
      }
      dropdownComponents={
        <DropdownContent widthInPixels={GenericDropdownContentWidth.ExtraLarge}>
          <DropdownMenuItemsContainer>
            {sequences.map((sequence) => (
              <MenuItem
                key={sequence.id}
                LeftIcon={IconSend}
                text={sequence.name}
                contextualText={sequence.status}
                disabled={
                  areEnrollmentsLoading ||
                  (doesSequenceRequireSender(sequence) &&
                    !sequence.senderConnectedAccountId &&
                    (sequence.settings.senderConnectedAccountIds?.length ??
                      0) === 0)
                }
                onClick={() => void addToSequence(sequence)}
              />
            ))}
            {sequences.length === 0 && (
              <MenuItem text={t`No sequences available`} disabled />
            )}
            {hasMoreSequences && (
              <MenuItem
                text={t`Load more sequences`}
                disabled={areSequencesLoading}
                onClick={() => void fetchMoreSequences()}
              />
            )}
          </DropdownMenuItemsContainer>
        </DropdownContent>
      }
    />
  );
};

export const AddToSequenceAction = ({
  objectNameSingular,
  requiredFilter,
}: {
  objectNameSingular: string;
  requiredFilter?: RecordGqlOperationFilter;
}) => {
  const isOutreachSequencesEnabled = useIsFeatureEnabled(
    FeatureFlagKey.IS_OUTREACH_SEQUENCES_ENABLED,
  );
  const doSequenceMetadataItemsExist = useDoObjectMetadataItemsExist([
    'sequence',
    'sequenceEnrollment',
  ]);

  if (
    objectNameSingular !== 'person' ||
    !isOutreachSequencesEnabled ||
    !doSequenceMetadataItemsExist
  ) {
    return null;
  }

  return <AddToSequenceActionContent requiredFilter={requiredFilter} />;
};
