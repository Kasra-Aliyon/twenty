import {
  assertNoUniboxLinkedinObjectNameCollisions,
  buildUniboxLinkedinLegacyArchiveOperations,
  buildUniboxLinkedinLegacyObjectRenames,
  findUniboxLinkedinLegacyObjects,
  findUniboxLinkedinObjectNameCollisions,
} from 'src/database/commands/upgrade-version-command/2-15/utils/unibox-linkedin-name-collision.util';
import { type FlatNavigationMenuItem } from 'src/engine/metadata-modules/flat-navigation-menu-item/types/flat-navigation-menu-item.type';
import { type FlatView } from 'src/engine/metadata-modules/flat-view/types/flat-view.type';
import { getFlatObjectMetadataMock } from 'src/engine/metadata-modules/flat-object-metadata/__mocks__/get-flat-object-metadata.mock';

const CUSTOM_APPLICATION_ID = '20202020-1111-4111-8111-111111111111';
const STANDARD_APPLICATION_ID = '20202020-2222-4222-8222-222222222222';
const WORKSPACE_ID = '20202020-3333-4333-8333-333333333333';

const buildObjectMetadata = ({
  applicationId = CUSTOM_APPLICATION_ID,
  id = '20202020-4444-4444-8444-444444444444',
  labelSingular = 'Legacy LinkedIn object',
  namePlural,
  nameSingular,
}: {
  applicationId?: string;
  id?: string;
  labelSingular?: string;
  namePlural: string;
  nameSingular: string;
}) => ({
  applicationId,
  id,
  labelSingular,
  namePlural,
  nameSingular,
  universalIdentifier: id,
});

describe('Unibox LinkedIn object-name collision preflight', () => {
  it('detects singular and plural collisions on custom objects', () => {
    const collisions = findUniboxLinkedinObjectNameCollisions({
      objectMetadatas: [
        buildObjectMetadata({
          nameSingular: 'linkedinConnection',
          namePlural: 'legacyConnections',
        }),
        buildObjectMetadata({
          id: '20202020-5555-4555-8555-555555555555',
          nameSingular: 'legacyThread',
          namePlural: 'linkedinMessageThreads',
        }),
      ],
      workspaceCustomApplicationId: CUSTOM_APPLICATION_ID,
    });

    expect(collisions).toHaveLength(2);
    expect(collisions.map(({ conflictingNames }) => conflictingNames)).toEqual([
      ['linkedinConnection'],
      ['linkedinMessageThreads'],
    ]);
  });

  it('ignores objects outside the workspace custom application', () => {
    expect(
      findUniboxLinkedinObjectNameCollisions({
        objectMetadatas: [
          buildObjectMetadata({
            applicationId: STANDARD_APPLICATION_ID,
            nameSingular: 'linkedinMessage',
            namePlural: 'linkedinMessages',
          }),
        ],
        workspaceCustomApplicationId: CUSTOM_APPLICATION_ID,
      }),
    ).toEqual([]);
  });

  it('fails with rename guidance before the upgrade mutates metadata', () => {
    expect(() =>
      assertNoUniboxLinkedinObjectNameCollisions({
        objectMetadatas: [
          buildObjectMetadata({
            nameSingular: 'linkedinInvitation',
            namePlural: 'linkedinInvitations',
          }),
        ],
        workspaceCustomApplicationId: CUSTOM_APPLICATION_ID,
        workspaceId: WORKSPACE_ID,
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          /Rename the legacy custom object singular and plural API names.*No legacy object or data was changed/s,
        ),
      }),
    );
  });

  it('builds non-destructive legacy object renames before standard creation', () => {
    const legacyConnection = getFlatObjectMetadataMock({
      applicationId: CUSTOM_APPLICATION_ID,
      applicationUniversalIdentifier: CUSTOM_APPLICATION_ID,
      labelPlural: 'LinkedIn Connections',
      labelSingular: 'LinkedIn Connection',
      namePlural: 'linkedinConnections',
      nameSingular: 'linkedinConnection',
      universalIdentifier: '20202020-7777-4777-8777-777777777777',
    });
    const flatObjectMetadataMaps = {
      byUniversalIdentifier: {
        [legacyConnection.universalIdentifier]: legacyConnection,
      },
      universalIdentifierById: {
        [legacyConnection.id]: legacyConnection.universalIdentifier,
      },
      universalIdentifiersByApplicationId: {
        [CUSTOM_APPLICATION_ID]: [legacyConnection.universalIdentifier],
      },
    };

    const renames = buildUniboxLinkedinLegacyObjectRenames({
      flatObjectMetadataMaps,
      now: '2026-07-22T00:00:00.000Z',
      workspaceCustomApplicationId: CUSTOM_APPLICATION_ID,
    });

    expect(renames).toHaveLength(1);
    expect(renames[0].renamedObjectMetadata).toMatchObject({
      id: legacyConnection.id,
      nameSingular: 'legacyLinkedinConnection',
      namePlural: 'legacyLinkedinConnections',
      labelSingular: 'LinkedIn Connection (Legacy backup)',
      labelPlural: 'LinkedIn Connections (Legacy backup)',
    });
  });

  it('recognizes a partially completed legacy rename for data migration', () => {
    const legacyThread = getFlatObjectMetadataMock({
      applicationId: CUSTOM_APPLICATION_ID,
      applicationUniversalIdentifier: CUSTOM_APPLICATION_ID,
      namePlural: 'legacyLinkedinMessageThreads',
      nameSingular: 'legacyLinkedinMessageThread',
      universalIdentifier: '20202020-8888-4888-8888-888888888888',
    });
    const flatObjectMetadataMaps = {
      byUniversalIdentifier: {
        [legacyThread.universalIdentifier]: legacyThread,
      },
      universalIdentifierById: {
        [legacyThread.id]: legacyThread.universalIdentifier,
      },
      universalIdentifiersByApplicationId: {
        [CUSTOM_APPLICATION_ID]: [legacyThread.universalIdentifier],
      },
    };

    expect(
      findUniboxLinkedinLegacyObjects({
        flatObjectMetadataMaps,
        workspaceCustomApplicationId: CUSTOM_APPLICATION_ID,
      }),
    ).toEqual([
      {
        objectName: 'linkedinMessageThread',
        objectMetadata: legacyThread,
      },
    ]);
  });

  it('freezes legacy objects and removes their object and view navigation pins', () => {
    const legacyMessage = getFlatObjectMetadataMock({
      applicationId: CUSTOM_APPLICATION_ID,
      applicationUniversalIdentifier: CUSTOM_APPLICATION_ID,
      isSearchable: true,
      isUICreatable: true,
      isUIEditable: true,
      labelPlural: 'LinkedIn Messages',
      labelSingular: 'LinkedIn Message',
      namePlural: 'legacyLinkedinMessages',
      nameSingular: 'legacyLinkedinMessage',
      universalIdentifier: '20202020-9999-4999-8999-999999999999',
    });
    const legacyView = {
      id: '30303030-1111-4111-8111-111111111111',
      objectMetadataId: legacyMessage.id,
      universalIdentifier: '30303030-1111-4111-8111-111111111111',
    } as FlatView;
    const objectNavigationItem = {
      id: '30303030-2222-4222-8222-222222222222',
      targetObjectMetadataId: legacyMessage.id,
      universalIdentifier: '30303030-2222-4222-8222-222222222222',
      viewId: null,
    } as FlatNavigationMenuItem;
    const viewNavigationItem = {
      id: '30303030-3333-4333-8333-333333333333',
      targetObjectMetadataId: null,
      universalIdentifier: '30303030-3333-4333-8333-333333333333',
      viewId: legacyView.id,
    } as FlatNavigationMenuItem;
    const unrelatedNavigationItem = {
      id: '30303030-4444-4444-8444-444444444444',
      targetObjectMetadataId: '30303030-5555-4555-8555-555555555555',
      universalIdentifier: '30303030-4444-4444-8444-444444444444',
      viewId: null,
    } as FlatNavigationMenuItem;

    const operations = buildUniboxLinkedinLegacyArchiveOperations({
      flatNavigationMenuItemMaps: {
        byUniversalIdentifier: {
          [objectNavigationItem.universalIdentifier]: objectNavigationItem,
          [viewNavigationItem.universalIdentifier]: viewNavigationItem,
          [unrelatedNavigationItem.universalIdentifier]:
            unrelatedNavigationItem,
        },
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      flatViewMaps: {
        byUniversalIdentifier: {
          [legacyView.universalIdentifier]: legacyView,
        },
        universalIdentifierById: {},
        universalIdentifiersByApplicationId: {},
      },
      legacyObjects: [
        {
          objectName: 'linkedinMessage',
          objectMetadata: legacyMessage,
        },
      ],
      now: '2026-07-24T00:00:00.000Z',
    });

    expect(operations.archivedObjectMetadatas).toEqual([
      expect.objectContaining({
        id: legacyMessage.id,
        isActive: false,
        isSearchable: false,
        isUICreatable: false,
        isUIEditable: false,
        labelPlural: 'LinkedIn Messages (Legacy backup)',
        labelSingular: 'LinkedIn Message (Legacy backup)',
      }),
    ]);
    expect(operations.navigationMenuItemsToDelete).toEqual([
      objectNavigationItem,
      viewNavigationItem,
    ]);
  });

  it('does not rebuild an already archived legacy object', () => {
    const archivedConnection = getFlatObjectMetadataMock({
      applicationId: CUSTOM_APPLICATION_ID,
      applicationUniversalIdentifier: CUSTOM_APPLICATION_ID,
      isActive: false,
      isSearchable: false,
      isUICreatable: false,
      isUIEditable: false,
      labelPlural: 'LinkedIn Connections (Legacy backup)',
      labelSingular: 'LinkedIn Connection (Legacy backup)',
      namePlural: 'legacyLinkedinConnections',
      nameSingular: 'legacyLinkedinConnection',
      universalIdentifier: '40404040-1111-4111-8111-111111111111',
    });

    expect(
      buildUniboxLinkedinLegacyArchiveOperations({
        flatNavigationMenuItemMaps: {
          byUniversalIdentifier: {},
          universalIdentifierById: {},
          universalIdentifiersByApplicationId: {},
        },
        flatViewMaps: {
          byUniversalIdentifier: {},
          universalIdentifierById: {},
          universalIdentifiersByApplicationId: {},
        },
        legacyObjects: [
          {
            objectName: 'linkedinConnection',
            objectMetadata: archivedConnection,
          },
        ],
        now: '2026-07-24T00:00:00.000Z',
      }).archivedObjectMetadatas,
    ).toEqual([]);
  });
});
