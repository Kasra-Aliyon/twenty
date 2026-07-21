import { useContext } from 'react';
import { IconArrowUpRight } from 'twenty-ui/icon';
import { ThemeContext, themeCssVariables } from 'twenty-ui/theme-constants';
import { AppPath, RECORD_LIST_TYPES } from 'twenty-shared/types';

import { isLayoutCustomizationModeEnabledState } from '@/layout-customization/states/isLayoutCustomizationModeEnabledState';
import { NavigationMenuItemIcon } from '@/navigation-menu-item/display/components/NavigationMenuItemIcon';
import { getLinkNavigationMenuItemComputedLink } from '@/navigation-menu-item/display/link/utils/getLinkNavigationMenuItemComputedLink';
import { getLinkNavigationMenuItemLabel } from '@/navigation-menu-item/display/link/utils/getLinkNavigationMenuItemLabel';
import type { NavigationMenuItemSectionContentProps } from '@/navigation-menu-item/display/sections/types/NavigationMenuItemSectionContentProps';
import { useDoObjectMetadataItemsExist } from '@/object-metadata/hooks/useDoObjectMetadataItemsExist';
import { useObjectMetadataItems } from '@/object-metadata/hooks/useObjectMetadataItems';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useObjectPermissions } from '@/object-record/hooks/useObjectPermissions';
import { isRecordListsPanelOpenState } from '@/record-list/states/isRecordListsPanelOpenState';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { styled } from '@linaria/react';

const OBJECT_NAME_BY_LIST_TYPE = {
  [RECORD_LIST_TYPES.COMPANY]: 'company',
  [RECORD_LIST_TYPES.PERSON]: 'person',
  [RECORD_LIST_TYPES.OPPORTUNITY]: 'opportunity',
} as const;

const StyledListCount = styled.span`
  color: ${themeCssVariables.font.color.light};
  font-size: ${themeCssVariables.font.size.sm};
`;

type NavigationMenuItemLinkDisplayProps = NavigationMenuItemSectionContentProps;

const NavigationMenuItemRecordListCount = () => {
  const { objectMetadataItems } = useObjectMetadataItems();
  const { objectPermissionsByObjectMetadataId } = useObjectPermissions();

  const canReadListType = (
    recordListType: keyof typeof OBJECT_NAME_BY_LIST_TYPE,
  ) => {
    const targetObjectMetadataItem = objectMetadataItems.find(
      (objectMetadataItem) =>
        objectMetadataItem.nameSingular ===
        OBJECT_NAME_BY_LIST_TYPE[recordListType],
    );

    return targetObjectMetadataItem
      ? objectPermissionsByObjectMetadataId[targetObjectMetadataItem.id]
          ?.canReadObjectRecords === true
      : false;
  };

  const { totalCount: companyListCount } = useFindManyRecords({
    objectNameSingular: 'recordList',
    filter: { type: { eq: RECORD_LIST_TYPES.COMPANY } },
    recordGqlFields: { id: true },
    limit: 1,
    skip: !canReadListType(RECORD_LIST_TYPES.COMPANY),
  });
  const { totalCount: personListCount } = useFindManyRecords({
    objectNameSingular: 'recordList',
    filter: { type: { eq: RECORD_LIST_TYPES.PERSON } },
    recordGqlFields: { id: true },
    limit: 1,
    skip: !canReadListType(RECORD_LIST_TYPES.PERSON),
  });
  const { totalCount: opportunityListCount } = useFindManyRecords({
    objectNameSingular: 'recordList',
    filter: { type: { eq: RECORD_LIST_TYPES.OPPORTUNITY } },
    recordGqlFields: { id: true },
    limit: 1,
    skip: !canReadListType(RECORD_LIST_TYPES.OPPORTUNITY),
  });
  const visibleListCount =
    (companyListCount ?? 0) +
    (personListCount ?? 0) +
    (opportunityListCount ?? 0);

  return <StyledListCount>{visibleListCount}</StyledListCount>;
};

export const NavigationMenuItemLinkDisplay = ({
  item,
  editModeProps,
  isDragging,
  rightOptions,
}: NavigationMenuItemLinkDisplayProps) => {
  const isLayoutCustomizationModeEnabled = useAtomStateValue(
    isLayoutCustomizationModeEnabledState,
  );
  const isRecordListsPanelOpen = useAtomStateValue(isRecordListsPanelOpenState);
  const setIsRecordListsPanelOpen = useSetAtomState(
    isRecordListsPanelOpenState,
  );
  const isMobile = useIsMobile();
  const { theme } = useContext(ThemeContext);

  const label = getLinkNavigationMenuItemLabel(item);
  const computedLink = getLinkNavigationMenuItemComputedLink(item);
  const isListsItem = item.link === AppPath.RecordListsPage;
  const doesRecordListMetadataItemExist = useDoObjectMetadataItemsExist([
    'recordList',
  ]);
  const shouldOpenListsPanel =
    isListsItem && !isMobile && !isLayoutCustomizationModeEnabled;

  const defaultRightOptions = !isLayoutCustomizationModeEnabled ? (
    isListsItem ? (
      doesRecordListMetadataItemExist ? (
        <NavigationMenuItemRecordListCount />
      ) : null
    ) : (
      <IconArrowUpRight
        size={theme.icon.size.sm}
        stroke={theme.icon.stroke.md}
        color={themeCssVariables.font.color.light}
      />
    )
  ) : undefined;

  return (
    <NavigationDrawerItem
      label={label}
      to={
        isLayoutCustomizationModeEnabled || isDragging || shouldOpenListsPanel
          ? undefined
          : computedLink
      }
      onClick={
        isLayoutCustomizationModeEnabled
          ? editModeProps?.onEditModeClick
          : shouldOpenListsPanel
            ? () => setIsRecordListsPanelOpen(true)
            : undefined
      }
      Icon={() => <NavigationMenuItemIcon navigationMenuItem={item} />}
      active={shouldOpenListsPanel && isRecordListsPanelOpen}
      isSelectedInEditMode={editModeProps?.isSelectedInEditMode}
      isDragging={isDragging}
      triggerEvent="CLICK"
      rightOptions={rightOptions ?? defaultRightOptions}
    />
  );
};
