import { type FlatNavigationMenuItem } from 'src/engine/metadata-modules/flat-navigation-menu-item/types/flat-navigation-menu-item.type';
import { STANDARD_NAVIGATION_MENU_ITEMS } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-navigation-menu-item.constant';

const LEGACY_SEQUENCE_TASKS_NAVIGATION_MENU_ITEM_NAME = 'Tasks';

export const buildSequenceTasksNavigationMenuItemUpdate = ({
  existingNavigationMenuItem,
  now,
}: {
  existingNavigationMenuItem: FlatNavigationMenuItem | undefined;
  now: string;
}): FlatNavigationMenuItem | undefined => {
  if (
    existingNavigationMenuItem?.name !==
    LEGACY_SEQUENCE_TASKS_NAVIGATION_MENU_ITEM_NAME
  ) {
    return undefined;
  }

  return {
    ...existingNavigationMenuItem,
    name: STANDARD_NAVIGATION_MENU_ITEMS.taskQueue.name,
    updatedAt: now,
  };
};
