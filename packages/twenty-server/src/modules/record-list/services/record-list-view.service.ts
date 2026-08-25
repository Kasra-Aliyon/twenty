import { Injectable } from '@nestjs/common';

import { In } from 'typeorm';
import {
  RECORD_LIST_TYPES,
  ViewKey,
  ViewType,
  ViewVisibility,
  type RecordListType,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { ViewFieldService } from 'src/engine/metadata-modules/view-field/services/view-field.service';
import { ViewSortService } from 'src/engine/metadata-modules/view-sort/services/view-sort.service';
import { ViewService } from 'src/engine/metadata-modules/view/services/view.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type RecordListMemberWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list-member.workspace-entity';
import { type RecordListWorkspaceEntity } from 'src/modules/record-list/standard-objects/record-list.workspace-entity';

const OBJECT_NAME_BY_RECORD_LIST_TYPE = {
  [RECORD_LIST_TYPES.COMPANY]: 'company',
  [RECORD_LIST_TYPES.PERSON]: 'person',
  [RECORD_LIST_TYPES.OPPORTUNITY]: 'opportunity',
} as const satisfies Record<RecordListType, string>;

@Injectable()
export class RecordListViewService {
  constructor(
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    private readonly viewService: ViewService,
    private readonly viewFieldService: ViewFieldService,
    private readonly viewSortService: ViewSortService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  public async createViewForList({
    list,
    authContext,
  }: {
    list: RecordListWorkspaceEntity;
    authContext: WorkspaceAuthContext;
  }): Promise<void> {
    const workspaceId = authContext.workspace.id;
    const {
      flatObjectMetadataMaps,
      flatViewMaps,
      flatViewFieldMaps,
      flatViewSortMaps,
    } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId,
          flatMapsKeys: [
            'flatObjectMetadataMaps',
            'flatViewMaps',
            'flatViewFieldMaps',
            'flatViewSortMaps',
          ],
        },
      );
    const objectName = OBJECT_NAME_BY_RECORD_LIST_TYPE[list.type];
    const objectMetadata = Object.values(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).find((object) => object?.nameSingular === objectName);

    if (!isDefined(objectMetadata)) {
      await this.softDeleteListAfterFailedViewCreation({
        listId: list.id,
        authContext,
      });

      throw new Error(
        `Object metadata not found for record list type ${list.type}`,
      );
    }

    const existingListView = Object.values(
      flatViewMaps.byUniversalIdentifier,
    ).find(
      (view) =>
        view?.recordListId === list.id &&
        view.isActive &&
        !isDefined(view.deletedAt),
    );

    if (isDefined(existingListView)) {
      return;
    }

    const referenceView = Object.values(
      flatViewMaps.byUniversalIdentifier,
    ).find(
      (view) =>
        view?.objectMetadataId === objectMetadata.id &&
        view.key === ViewKey.INDEX &&
        view.isActive &&
        !isDefined(view.deletedAt),
    );

    if (!isDefined(referenceView)) {
      await this.softDeleteListAfterFailedViewCreation({
        listId: list.id,
        authContext,
      });

      throw new Error(`Index view not found for ${objectName}`);
    }

    let createdView;

    try {
      createdView = await this.viewService.createOne({
        workspaceId,
        createViewInput: {
          name: list.name,
          objectMetadataId: objectMetadata.id,
          type: ViewType.TABLE,
          icon: objectMetadata.icon ?? 'IconListDetails',
          position: list.position,
          visibility: ViewVisibility.UNLISTED,
          recordListId: list.id,
          isSystemSideEffect: true,
        },
      });
    } catch (error) {
      await this.softDeleteListAfterFailedViewCreation({
        listId: list.id,
        authContext,
      });

      throw error;
    }

    try {
      const referenceViewFields = referenceView.viewFieldIds
        .map((viewFieldId) =>
          findFlatEntityByIdInFlatEntityMaps({
            flatEntityId: viewFieldId,
            flatEntityMaps: flatViewFieldMaps,
          }),
        )
        .filter(isDefined);

      await this.viewFieldService.createMany({
        workspaceId,
        createViewFieldInputs: referenceViewFields.map((viewField) => ({
          fieldMetadataId: viewField.fieldMetadataId,
          viewId: createdView.id,
          isVisible: viewField.isVisible,
          size: viewField.size,
          position: viewField.position,
          aggregateOperation: viewField.aggregateOperation ?? undefined,
          subFieldName: viewField.subFieldName,
        })),
      });

      const referenceViewSorts = referenceView.viewSortIds
        .map((viewSortId) =>
          findFlatEntityByIdInFlatEntityMaps({
            flatEntityId: viewSortId,
            flatEntityMaps: flatViewSortMaps,
          }),
        )
        .filter(isDefined);

      for (const viewSort of referenceViewSorts) {
        await this.viewSortService.createOne({
          workspaceId,
          createViewSortInput: {
            fieldMetadataId: viewSort.fieldMetadataId,
            viewId: createdView.id,
            direction: viewSort.direction,
            subFieldName: viewSort.subFieldName,
          },
        });
      }
    } catch (error) {
      await this.viewService.destroyOne({
        workspaceId,
        destroyViewInput: { id: createdView.id },
        isRecordListLifecycleOperation: true,
      });
      await this.softDeleteListAfterFailedViewCreation({
        listId: list.id,
        authContext,
      });

      throw error;
    }
  }

  public async deleteViewsAndMembersForLists({
    lists,
    authContext,
    destroy,
  }: {
    lists: RecordListWorkspaceEntity[];
    authContext: WorkspaceAuthContext;
    destroy: boolean;
  }): Promise<void> {
    if (lists.length === 0) {
      return;
    }

    const workspaceId = authContext.workspace.id;
    const { flatViewMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        { workspaceId, flatMapsKeys: ['flatViewMaps'] },
      );
    const listIds = new Set(lists.map(({ id }) => id));
    const listViews = Object.values(flatViewMaps.byUniversalIdentifier)
      .filter(isDefined)
      .filter(
        (view) =>
          listIds.has(view.recordListId ?? '') && !isDefined(view.deletedAt),
      );

    for (const view of listViews) {
      if (destroy) {
        await this.viewService.destroyOne({
          workspaceId,
          destroyViewInput: { id: view.id },
          isRecordListLifecycleOperation: true,
        });
      } else {
        await this.viewService.deleteOne({
          workspaceId,
          deleteViewInput: { id: view.id },
          isRecordListLifecycleOperation: true,
        });
      }
    }

    if (!destroy) {
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const repository =
            await this.globalWorkspaceOrmManager.getRepository<RecordListMemberWorkspaceEntity>(
              workspaceId,
              'recordListMember',
            );

          await repository.softDelete({ recordListId: In([...listIds]) });
        },
        authContext,
      );
    }
  }

  private async softDeleteListAfterFailedViewCreation({
    listId,
    authContext,
  }: {
    listId: string;
    authContext: WorkspaceAuthContext;
  }): Promise<void> {
    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const repository =
        await this.globalWorkspaceOrmManager.getRepository<RecordListWorkspaceEntity>(
          authContext.workspace.id,
          'recordList',
        );

      await repository.softDelete(listId);
    }, authContext);
  }
}
