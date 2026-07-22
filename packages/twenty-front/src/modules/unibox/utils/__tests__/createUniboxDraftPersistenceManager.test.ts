import { type MessageDraftValues } from '@/unibox/types/MessageDraftRecord';
import { createUniboxDraftPersistenceManager } from '@/unibox/utils/createUniboxDraftPersistenceManager';

const VALUES: MessageDraftValues = {
  subject: 'Hello',
  body: 'First version',
  to: 'contact@example.com',
  cc: '',
  bcc: '',
  inReplyTo: null,
  connectedAccountId: 'account-id',
  messageThreadId: null,
};

describe('createUniboxDraftPersistenceManager', () => {
  it('serializes create and update while reusing the created id', async () => {
    const manager = createUniboxDraftPersistenceManager(null);
    const operations: string[] = [];
    let finishCreate: (() => void) | undefined;
    const createBarrier = new Promise<void>((resolve) => {
      finishCreate = resolve;
    });
    const actions = {
      createDraft: async () => {
        operations.push('create:start');
        await createBarrier;
        operations.push('create:end');
        return { id: 'draft-id' };
      },
      updateDraft: async (draftId: string) => {
        operations.push(`update:${draftId}`);
      },
      deleteDraft: async () => undefined,
    };

    const createResult = manager.save(VALUES, actions);
    const updateResult = manager.save(
      { ...VALUES, body: 'Second version' },
      actions,
    );

    await Promise.resolve();
    expect(operations).toEqual(['create:start']);

    finishCreate?.();

    await expect(createResult).resolves.toBe('draft-id');
    await expect(updateResult).resolves.toBe('draft-id');
    expect(operations).toEqual([
      'create:start',
      'create:end',
      'update:draft-id',
    ]);
  });

  it('deletes an existing draft and suppresses later saves', async () => {
    const manager = createUniboxDraftPersistenceManager('draft-id');
    const updateDraft = jest.fn(async () => undefined);
    const deleteDraft = jest.fn(async () => undefined);
    const actions = {
      createDraft: jest.fn(async () => ({ id: 'other-draft-id' })),
      updateDraft,
      deleteDraft,
    };

    await manager.discard(actions);
    await manager.save(VALUES, actions);

    expect(deleteDraft).toHaveBeenCalledWith('draft-id');
    expect(updateDraft).not.toHaveBeenCalled();
    expect(actions.createDraft).not.toHaveBeenCalled();
  });
});
