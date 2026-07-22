import { type MessageDraftValues } from '@/unibox/types/MessageDraftRecord';

type DraftPersistenceActions = {
  createDraft: (values: MessageDraftValues) => Promise<{ id: string }>;
  updateDraft: (draftId: string, values: MessageDraftValues) => Promise<void>;
  deleteDraft: (draftId: string) => Promise<void>;
};

export const createUniboxDraftPersistenceManager = (
  initialDraftId: string | null,
) => {
  let persistedDraftId = initialDraftId;
  let operationQueue: Promise<void> = Promise.resolve();
  let isDiscardRequested = false;

  const enqueue = <Result>(operation: () => Promise<Result>) => {
    const result = operationQueue.then(operation, operation);

    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  };

  return {
    save: (
      values: MessageDraftValues,
      actions: DraftPersistenceActions,
    ): Promise<string | null> =>
      enqueue(async () => {
        if (isDiscardRequested) return persistedDraftId;

        if (persistedDraftId) {
          await actions.updateDraft(persistedDraftId, values);
          return persistedDraftId;
        }

        const createdDraft = await actions.createDraft(values);
        persistedDraftId = createdDraft.id;

        return persistedDraftId;
      }),
    discard: (actions: Pick<DraftPersistenceActions, 'deleteDraft'>) => {
      isDiscardRequested = true;

      return enqueue(async () => {
        if (!persistedDraftId) return;

        await actions.deleteDraft(persistedDraftId);
        persistedDraftId = null;
      });
    },
  };
};
