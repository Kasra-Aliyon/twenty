import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useDeleteOneRecord } from '@/object-record/hooks/useDeleteOneRecord';
import { useDestroyOneRecord } from '@/object-record/hooks/useDestroyOneRecord';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { Dropdown } from '@/ui/layout/dropdown/components/Dropdown';
import { DropdownContent } from '@/ui/layout/dropdown/components/DropdownContent';
import { DropdownMenuItemsContainer } from '@/ui/layout/dropdown/components/DropdownMenuItemsContainer';
import { GenericDropdownContentWidth } from '@/ui/layout/dropdown/constants/GenericDropdownContentWidth';
import { useCloseDropdown } from '@/ui/layout/dropdown/hooks/useCloseDropdown';
import { ConfirmationModal } from '@/ui/layout/modal/components/ConfirmationModal';
import { useModal } from '@/ui/layout/modal/hooks/useModal';
import { t } from '@lingui/core/macro';
import gql from 'graphql-tag';
import { useState } from 'react';
import {
  IconArchive,
  IconDotsVertical,
  IconRestore,
  IconTrash,
} from 'twenty-ui/icon';
import { LightIconButton } from 'twenty-ui/input';
import { MenuItem } from 'twenty-ui/navigation';

import { type SequenceRecord } from '../types/SequenceRecords';

const RESTORE_SEQUENCE_MUTATION = gql`
  mutation RestoreSequence($idToRestore: UUID!) {
    restoreSequence(id: $idToRestore) {
      id
      deletedAt
      status
    }
  }
`;

type SequenceActionsMenuProps = {
  sequence: SequenceRecord;
  canArchive: boolean;
  canDestroy: boolean;
  onArchived: () => Promise<void> | void;
  onDestroyed: () => Promise<void> | void;
  onRestored: () => Promise<void> | void;
};

export const SequenceActionsMenu = ({
  sequence,
  canArchive,
  canDestroy,
  onArchived,
  onDestroyed,
  onRestored,
}: SequenceActionsMenuProps) => {
  const dropdownId = `sequence-actions-${sequence.id}`;
  const archiveModalId = `archive-sequence-${sequence.id}`;
  const destroyModalId = `destroy-sequence-${sequence.id}`;
  const isArchived = sequence.deletedAt !== null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { closeDropdown } = useCloseDropdown();
  const { openModal } = useModal();
  const { deleteOneRecord } = useDeleteOneRecord({
    objectNameSingular: 'sequence',
  });
  const { destroyOneRecord } = useDestroyOneRecord({
    objectNameSingular: 'sequence',
  });
  const apolloCoreClient = useApolloCoreClient();
  const { enqueueErrorSnackBar, enqueueSuccessSnackBar } = useSnackBar();

  const handleArchive = async () => {
    setIsSubmitting(true);

    try {
      await deleteOneRecord(sequence.id);
      await onArchived();
      enqueueSuccessSnackBar({ message: t`Sequence archived.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence could not be archived.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestore = async () => {
    closeDropdown(dropdownId);
    setIsSubmitting(true);

    try {
      await apolloCoreClient.mutate({
        mutation: RESTORE_SEQUENCE_MUTATION,
        variables: { idToRestore: sequence.id },
      });
      await onRestored();
      enqueueSuccessSnackBar({ message: t`Sequence restored as inactive.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence could not be restored.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDestroy = async () => {
    setIsSubmitting(true);

    try {
      await destroyOneRecord(sequence.id);
      await onDestroyed();
      enqueueSuccessSnackBar({ message: t`Sequence permanently deleted.` });
    } catch {
      enqueueErrorSnackBar({
        message: t`The sequence could not be permanently deleted.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dropdown
        dropdownId={dropdownId}
        dropdownPlacement="bottom-end"
        clickableComponent={
          <LightIconButton
            Icon={IconDotsVertical}
            title={t`Sequence actions`}
            accent="tertiary"
          />
        }
        dropdownComponents={
          <DropdownContent widthInPixels={GenericDropdownContentWidth.Large}>
            <DropdownMenuItemsContainer>
              {isArchived ? (
                <>
                  <MenuItem
                    LeftIcon={IconRestore}
                    text={t`Restore sequence`}
                    disabled={!canArchive || isSubmitting}
                    onClick={() => void handleRestore()}
                  />
                  <MenuItem
                    accent="danger"
                    LeftIcon={IconTrash}
                    text={t`Delete permanently`}
                    disabled={!canDestroy || isSubmitting}
                    onClick={() => {
                      closeDropdown(dropdownId);
                      openModal(destroyModalId);
                    }}
                  />
                </>
              ) : (
                <MenuItem
                  LeftIcon={IconArchive}
                  text={t`Archive sequence`}
                  disabled={!canArchive || isSubmitting}
                  onClick={() => {
                    closeDropdown(dropdownId);
                    openModal(archiveModalId);
                  }}
                />
              )}
            </DropdownMenuItemsContainer>
          </DropdownContent>
        }
      />
      <ConfirmationModal
        modalInstanceId={archiveModalId}
        title={t`Archive "${sequence.name}"?`}
        subtitle={t`This stops the sequence and removes all pending and active contacts. Open sequence tasks are completed and scheduled LinkedIn actions are cancelled. History is kept, and the sequence can be restored later. An action already being sent may still finish.`}
        onConfirmClick={() => void handleArchive()}
        confirmButtonText={t`Archive sequence`}
        loading={isSubmitting}
      />
      <ConfirmationModal
        modalInstanceId={destroyModalId}
        title={t`Permanently delete "${sequence.name}"?`}
        subtitle={t`This permanently deletes the sequence, its steps, and its enrollment history. Sent messages and tasks remain as standalone records. Type the sequence name to confirm.`}
        confirmationPlaceholder={sequence.name}
        confirmationValue={sequence.name}
        onConfirmClick={() => void handleDestroy()}
        confirmButtonText={t`Delete permanently`}
        loading={isSubmitting}
      />
    </>
  );
};
