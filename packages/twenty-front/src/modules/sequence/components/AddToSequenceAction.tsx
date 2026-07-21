import { useCurrentCommandMenuContextApi } from '@/command-menu-item/hooks/useCurrentCommandMenuContextApi';
import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { useCreateManyRecords } from '@/object-record/hooks/useCreateManyRecords';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useObjectPermissionsForObject } from '@/object-record/hooks/useObjectPermissionsForObject';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { getRecordsFromRecordConnection } from '@/object-record/cache/utils/getRecordsFromRecordConnection';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';
import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { QUERY_MAX_RECORDS } from 'twenty-shared/constants';
import {
  FeatureFlagKey,
  type SequenceSettings,
  type SequenceStatus,
} from 'twenty-shared/types';
import { IconSend } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';

type SequenceForEnrollment = ObjectRecord & {
  name: string;
  status: SequenceStatus;
  senderConnectedAccountId: string | null;
  settings: SequenceSettings;
};

type ExistingSequenceEnrollment = ObjectRecord & {
  sequenceId: string;
  personId: string;
};

const AddToSequenceActionContent = () => {
  const dropdownId = 'add-selected-people-to-sequence';
  const [isSaving, setIsSaving] = useState(false);
  const { closeDropdown } = useCloseDropdown();
  const { selectedRecords } = useCurrentCommandMenuContextApi();
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();
  const { objectMetadataItem: enrollmentObjectMetadataItem } =
    useObjectMetadataItem({ objectNameSingular: 'sequenceEnrollment' });
  const enrollmentPermissions = useObjectPermissionsForObject(
    enrollmentObjectMetadataItem.id,
  );
  const { records: sequences } = useFindManyRecords<SequenceForEnrollment>({
    objectNameSingular: 'sequence',
    orderBy: [{ name: 'AscNullsLast' }],
    recordGqlFields: {
      id: true,
      name: true,
      status: true,
      senderConnectedAccountId: true,
      settings: true,
    },
    limit: QUERY_MAX_RECORDS,
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
  const { createManyRecords } = useCreateManyRecords({
    objectNameSingular: 'sequenceEnrollment',
    skipPostOptimisticEffect: true,
  });

  if (
    !enrollmentPermissions.canUpdateObjectRecords ||
    selectedRecords.length === 0
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
      const { data } = await refetchExistingEnrollments({
        filter: {
          and: [
            { sequenceId: { eq: sequence.id } },
            { personId: { in: selectedRecords.map((record) => record.id) } },
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
      const peopleToEnroll = selectedRecords.filter(
        (person) => !alreadyEnrolledPersonIds.has(person.id),
      );

      if (peopleToEnroll.length === 0) {
        enqueueSuccessSnackBar({
          message: t`The selected people are already in this sequence.`,
        });
        return;
      }

      await createManyRecords({
        recordsToCreate: peopleToEnroll.map((person) => ({
          sequenceId: sequence.id,
          personId: person.id,
          senderConnectedAccountId: sequence.senderConnectedAccountId,
          stopOnReply: sequence.settings.stopOnReply,
        })),
        upsert: true,
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
                  areEnrollmentsLoading || !sequence.senderConnectedAccountId
                }
                onClick={() => void addToSequence(sequence)}
              />
            ))}
            {sequences.length === 0 && (
              <MenuItem text={t`No sequences available`} disabled />
            )}
          </DropdownMenuItemsContainer>
        </DropdownContent>
      }
    />
  );
};

export const AddToSequenceAction = ({
  objectNameSingular,
}: {
  objectNameSingular: string;
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

  return <AddToSequenceActionContent />;
};
