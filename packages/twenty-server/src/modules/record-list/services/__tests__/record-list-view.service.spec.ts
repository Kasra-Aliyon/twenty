import { RECORD_LIST_TYPES, ViewKey } from 'twenty-shared/types';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { type ViewFieldService } from 'src/engine/metadata-modules/view-field/services/view-field.service';
import { type ViewSortService } from 'src/engine/metadata-modules/view-sort/services/view-sort.service';
import { type ViewService } from 'src/engine/metadata-modules/view/services/view.service';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { RecordListViewService } from 'src/modules/record-list/services/record-list-view.service';
import { type RecordListWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list.workspace-entity';

describe('RecordListViewService', () => {
  const getOrRecomputeManyOrAllFlatEntityMaps = jest.fn();
  const createView = jest.fn();
  const createViewFields = jest.fn();
  const createViewSort = jest.fn();

  const service = new RecordListViewService(
    {
      getOrRecomputeManyOrAllFlatEntityMaps,
    } as unknown as WorkspaceManyOrAllFlatEntityMapsCacheService,
    { createOne: createView } as unknown as ViewService,
    { createMany: createViewFields } as unknown as ViewFieldService,
    { createOne: createViewSort } as unknown as ViewSortService,
    {} as GlobalWorkspaceOrmManager,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    createView.mockResolvedValue({ id: 'list-view-id' });
    createViewFields.mockResolvedValue([]);
    getOrRecomputeManyOrAllFlatEntityMaps.mockResolvedValue({
      flatObjectMetadataMaps: {
        byUniversalIdentifier: {
          'company-object-universal-id': {
            id: 'company-object-id',
            nameSingular: 'company',
            icon: 'IconBuildingSkyscraper',
          },
        },
      },
      flatViewMaps: {
        byUniversalIdentifier: {
          'reference-view-universal-id': {
            id: 'reference-view-id',
            objectMetadataId: 'company-object-id',
            key: ViewKey.INDEX,
            isActive: true,
            deletedAt: null,
            viewFieldIds: ['address-view-field-id', 'country-view-field-id'],
            viewSortIds: [],
          },
        },
      },
      flatViewFieldMaps: {
        byUniversalIdentifier: {
          'address-view-field-universal-id': {
            id: 'address-view-field-id',
            fieldMetadataId: 'address-field-id',
            isVisible: true,
            size: 180,
            position: 6,
            aggregateOperation: null,
            subFieldName: null,
          },
          'country-view-field-universal-id': {
            id: 'country-view-field-id',
            fieldMetadataId: 'address-field-id',
            isVisible: true,
            size: 120,
            position: 7,
            aggregateOperation: null,
            subFieldName: 'addressCountry',
          },
        },
        universalIdentifierById: {
          'address-view-field-id': 'address-view-field-universal-id',
          'country-view-field-id': 'country-view-field-universal-id',
        },
        universalIdentifiersByApplicationId: {},
      },
      flatViewSortMaps: {
        byUniversalIdentifier: {},
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
    });
  });

  it('preserves subfields when cloning fields from the index view', async () => {
    await service.createViewForList({
      list: {
        id: 'list-id',
        name: 'Companies',
        type: RECORD_LIST_TYPES.COMPANY,
        position: 0,
      } as RecordListWorkspaceEntity,
      authContext: {
        workspace: { id: 'workspace-id' },
      } as WorkspaceAuthContext,
    });

    expect(createViewFields).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      createViewFieldInputs: [
        expect.objectContaining({
          fieldMetadataId: 'address-field-id',
          subFieldName: null,
        }),
        expect.objectContaining({
          fieldMetadataId: 'address-field-id',
          subFieldName: 'addressCountry',
        }),
      ],
    });
  });
});
