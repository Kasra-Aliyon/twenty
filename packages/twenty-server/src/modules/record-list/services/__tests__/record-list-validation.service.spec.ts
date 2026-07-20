import { RECORD_LIST_TYPES } from 'twenty-shared/types';

import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { RecordListValidationService } from 'src/modules/record-list/services/record-list-validation.service';

describe('RecordListValidationService', () => {
  const findBy = jest.fn();
  const countBy = jest.fn();
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(
      async (callback: () => Promise<unknown>) => callback(),
    ),
    getRepository: jest.fn(async () => ({ findBy, countBy })),
  } as unknown as GlobalWorkspaceOrmManager;
  const service = new RecordListValidationService(globalWorkspaceOrmManager);

  beforeEach(() => {
    jest.clearAllMocks();
    findBy.mockResolvedValue([]);
    countBy.mockResolvedValue(0);
  });

  it('trims and normalizes list names', () => {
    const data = { name: '  Enterprise   accounts  ' };

    service.normalizeAndValidateName(data);

    expect(data.name).toBe('Enterprise accounts');
  });

  it.each(['', '   ', 'a'.repeat(256)])(
    'rejects an invalid list name',
    (name) => {
      expect(() => service.normalizeAndValidateName({ name })).toThrow(
        'Record list names must contain between 1 and 255 characters',
      );
    },
  );

  it('rejects list type and membership target changes', () => {
    expect(() =>
      service.validateListTypeIsImmutable({ type: RECORD_LIST_TYPES.PERSON }),
    ).toThrow('Record list type cannot be changed');
    expect(() =>
      service.validateMemberIsImmutable({ targetCompanyId: 'company-id' }),
    ).toThrow('Record list membership targets cannot be changed');
  });

  it('accepts a membership whose single target matches the list type', async () => {
    findBy.mockResolvedValue([
      { id: 'list-id', type: RECORD_LIST_TYPES.COMPANY },
    ]);

    await expect(
      service.validateMembersForCreate({
        workspaceId: 'workspace-id',
        data: [
          {
            recordListId: 'list-id',
            targetCompanyId: 'company-id',
          },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      recordListId: 'list-id',
      targetPersonId: 'person-id',
    },
    {
      recordListId: 'list-id',
      targetCompanyId: 'company-id',
      targetPersonId: 'person-id',
    },
    {
      recordListId: 'missing-list-id',
      targetCompanyId: 'company-id',
    },
  ])('rejects an invalid or mismatched membership', async (member) => {
    findBy.mockResolvedValue([
      { id: 'list-id', type: RECORD_LIST_TYPES.COMPANY },
    ]);

    await expect(
      service.validateMembersForCreate({
        workspaceId: 'workspace-id',
        data: [member],
      }),
    ).rejects.toThrow(
      'A record list member must target exactly one record matching the list type',
    );
  });

  it('rejects deletion of any folder containing a list', async () => {
    countBy.mockResolvedValue(1);

    await expect(
      service.validateFoldersAreEmpty({
        workspaceId: 'workspace-id',
        folderIds: ['folder-id'],
      }),
    ).rejects.toThrow('Record list folder must be empty before deletion');
  });
});
