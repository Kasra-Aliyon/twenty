import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';
import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useDeleteOneRecord } from '@/object-record/hooks/useDeleteOneRecord';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import {
  type MessageDraftRecord,
  type MessageDraftValues,
} from '@/unibox/types/MessageDraftRecord';
import { createUniboxDraftPersistenceManager } from '@/unibox/utils/createUniboxDraftPersistenceManager';

const DRAFT_AUTOSAVE_DELAY = 1_000;

const MESSAGE_DRAFT_FIELDS = {
  id: true,
  subject: true,
  body: true,
  to: true,
  cc: true,
  bcc: true,
  inReplyTo: true,
  connectedAccountId: true,
  messageThreadId: true,
  authorId: true,
  lastEditedAt: true,
};

// This hook uses generic object hooks and must only be mounted after the
// messageDraft metadata existence gate has passed.
export const useUniboxDraft = ({
  initialDraftId,
  authorId,
}: {
  initialDraftId: string | null;
  authorId: string;
}) => {
  const apolloCoreClient = useApolloCoreClient();
  const [draftId, setDraftId] = useState(initialDraftId);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const persistenceManager = useMemo(
    () => createUniboxDraftPersistenceManager(initialDraftId),
    [initialDraftId],
  );
  const { createOneRecord } = useCreateOneRecord<MessageDraftRecord>({
    objectNameSingular: 'messageDraft',
    recordGqlFields: MESSAGE_DRAFT_FIELDS,
    skipPostOptimisticEffect: true,
  });
  const { updateOneRecord } = useUpdateOneRecord();
  const { deleteOneRecord } = useDeleteOneRecord({
    objectNameSingular: 'messageDraft',
  });

  const refetchDrafts = useCallback(async () => {
    await apolloCoreClient.refetchQueries({
      include: ['FindManyMessageDrafts'],
    });
  }, [apolloCoreClient]);

  const persistNow = useCallback(
    async (values: MessageDraftValues) => {
      if (!values.connectedAccountId) return;

      setIsSaving(true);
      setSaveError(null);

      try {
        const persistedDraftId = await persistenceManager.save(values, {
          createDraft: async (draftValues) =>
            createOneRecord({
              ...draftValues,
              authorId,
              lastEditedAt: new Date().toISOString(),
            }),
          updateDraft: async (idToUpdate, draftValues) => {
            await updateOneRecord<MessageDraftRecord>({
              objectNameSingular: 'messageDraft',
              idToUpdate,
              updateOneRecordInput: {
                ...draftValues,
                authorId,
                lastEditedAt: new Date().toISOString(),
              },
              recordGqlFields: MESSAGE_DRAFT_FIELDS,
            });
          },
          deleteDraft: async () => undefined,
        });

        setDraftId(persistedDraftId);
        await refetchDrafts();
      } catch (error) {
        setSaveError(error instanceof Error ? error : new Error('Save failed'));
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [
      authorId,
      createOneRecord,
      persistenceManager,
      refetchDrafts,
      updateOneRecord,
    ],
  );

  const debouncedSave = useDebouncedCallback(persistNow, DRAFT_AUTOSAVE_DELAY, {
    maxWait: 4_000,
  });

  useEffect(
    () => () => {
      debouncedSave.cancel();
    },
    [debouncedSave],
  );

  const discardDraft = useCallback(async () => {
    debouncedSave.cancel();
    setIsSaving(true);

    try {
      await persistenceManager.discard({
        deleteDraft: async (draftIdToDelete) => {
          await deleteOneRecord(draftIdToDelete);
        },
      });
      setDraftId(null);
      await refetchDrafts();
    } finally {
      setIsSaving(false);
    }
  }, [debouncedSave, deleteOneRecord, persistenceManager, refetchDrafts]);

  const flushPendingSave = useCallback(async () => {
    await debouncedSave.flush();
  }, [debouncedSave]);

  return {
    draftId,
    isSaving,
    saveError,
    scheduleSave: debouncedSave,
    flushPendingSave,
    cancelPendingSave: debouncedSave.cancel,
    discardDraft,
  };
};
