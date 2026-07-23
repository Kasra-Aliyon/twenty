import { isDefined } from 'twenty-shared/utils';

import { buildSequenceTasksNavigationMenuItemUpdate } from 'src/database/commands/upgrade-version-command/2-15/utils/build-sequence-tasks-navigation-menu-item-update.util';
import { STANDARD_NAVIGATION_MENU_ITEMS } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-navigation-menu-item.constant';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const TWENTY_STANDARD_APPLICATION_ID = '20202020-2222-4222-8222-222222222222';
const CREATED_AT = '2026-07-22T00:00:00.000Z';
const UPDATED_AT = '2026-07-23T00:00:00.000Z';

const { allFlatEntityMaps } =
  computeTwentyStandardApplicationAllFlatEntityMaps({
    now: CREATED_AT,
    workspaceId: WORKSPACE_ID,
    twentyStandardApplicationId: TWENTY_STANDARD_APPLICATION_ID,
  });

const sequenceTasksNavigationMenuItem =
  allFlatEntityMaps.flatNavigationMenuItemMaps.byUniversalIdentifier[
    STANDARD_NAVIGATION_MENU_ITEMS.taskQueue.universalIdentifier
  ];

if (!isDefined(sequenceTasksNavigationMenuItem)) {
  throw new Error('Sequence Tasks navigation menu item is missing');
}

describe('buildSequenceTasksNavigationMenuItemUpdate', () => {
  it('renames the legacy default label', () => {
    expect(
      buildSequenceTasksNavigationMenuItemUpdate({
        existingNavigationMenuItem: {
          ...sequenceTasksNavigationMenuItem,
          name: 'Tasks',
        },
        now: UPDATED_AT,
      }),
    ).toMatchObject({
      id: sequenceTasksNavigationMenuItem.id,
      name: 'Sequence Tasks',
      updatedAt: UPDATED_AT,
    });
  });

  it('preserves a customized label', () => {
    expect(
      buildSequenceTasksNavigationMenuItemUpdate({
        existingNavigationMenuItem: {
          ...sequenceTasksNavigationMenuItem,
          name: 'Follow-ups',
        },
        now: UPDATED_AT,
      }),
    ).toBeUndefined();
  });

  it('does nothing when the item is already up to date', () => {
    expect(
      buildSequenceTasksNavigationMenuItemUpdate({
        existingNavigationMenuItem: sequenceTasksNavigationMenuItem,
        now: UPDATED_AT,
      }),
    ).toBeUndefined();
  });
});
