import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { getObjectPermissionsForObject } from '@/object-metadata/utils/getObjectPermissionsForObject';
import { useObjectPermissions } from '@/object-record/hooks/useObjectPermissions';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { useGetCurrentViewOnly } from '@/views/hooks/useGetCurrentViewOnly';
import {
  ViewVisibility,
  PermissionFlagType,
} from '~/generated-metadata/graphql';
import { isDefined } from 'twenty-shared/utils';

export const useCanPersistViewChanges = () => {
  const { currentView } = useGetCurrentViewOnly();
  const hasViewsPermission = useHasPermissionFlag(PermissionFlagType.VIEWS);
  const { objectMetadataItems } = useObjectMetadataItems();
  const { objectPermissionsByObjectMetadataId } = useObjectPermissions();
  const recordListObjectMetadataItem = objectMetadataItems.find(
    (objectMetadataItem) => objectMetadataItem.nameSingular === 'recordList',
  );

  if (!currentView) {
    return { canPersistChanges: false };
  }

  if (currentView.recordListId) {
    return {
      canPersistChanges:
        isDefined(recordListObjectMetadataItem) &&
        getObjectPermissionsForObject(
          objectPermissionsByObjectMetadataId,
          recordListObjectMetadataItem.id,
        ).canUpdateObjectRecords,
    };
  }

  // Users with VIEWS permission can persist all views
  if (hasViewsPermission) {
    return { canPersistChanges: true };
  }

  // Users without VIEWS permission can only persist unlisted views
  // (which are always their own, filtered by backend)
  const canPersistChanges = currentView.visibility === ViewVisibility.UNLISTED;

  return { canPersistChanges };
};
