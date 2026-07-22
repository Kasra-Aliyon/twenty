import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import {
  FieldMetadataType,
  RelationOnDeleteAction,
  RelationType,
} from 'twenty-shared/types';

import { STANDARD_NAVIGATION_MENU_ITEMS } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-navigation-menu-item.constant';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const TWENTY_STANDARD_APPLICATION_ID = '20202020-2222-4222-8222-222222222222';
const NOW = '2026-07-22T00:00:00.000Z';

describe('Unibox LinkedIn standard metadata build', () => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: NOW,
      workspaceId: WORKSPACE_ID,
      twentyStandardApplicationId: TWENTY_STANDARD_APPLICATION_ID,
    });

  const getObject = (
    objectName:
      | 'linkedinConnection'
      | 'linkedinInvitation'
      | 'linkedinMessage'
      | 'linkedinMessageThread'
      | 'linkedinThreadParticipant',
  ) =>
    allFlatEntityMaps.flatObjectMetadataMaps.byUniversalIdentifier[
      STANDARD_OBJECTS[objectName].universalIdentifier
    ];

  const getField = <
    TObjectName extends
      | 'linkedinConnection'
      | 'linkedinInvitation'
      | 'linkedinMessage'
      | 'linkedinMessageThread'
      | 'linkedinThreadParticipant'
      | 'person',
  >(
    objectName: TObjectName,
    fieldName: keyof (typeof STANDARD_OBJECTS)[TObjectName]['fields'],
  ) => {
    const fields = STANDARD_OBJECTS[objectName].fields as Record<
      string,
      { universalIdentifier: string }
    >;

    return allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
      fields[String(fieldName)].universalIdentifier
    ];
  };

  it('builds the Unibox navigation item', () => {
    expect(
      allFlatEntityMaps.flatNavigationMenuItemMaps.byUniversalIdentifier[
        STANDARD_NAVIGATION_MENU_ITEMS.unibox.universalIdentifier
      ],
    ).toMatchObject({
      name: 'Unibox',
      link: '/unibox',
      icon: 'IconInbox',
      position: -1,
    });
  });

  it('builds all five non-creatable LinkedIn system objects', () => {
    expect(
      [
        'linkedinMessageThread',
        'linkedinMessage',
        'linkedinThreadParticipant',
        'linkedinConnection',
        'linkedinInvitation',
      ].map((objectName) =>
        getObject(objectName as Parameters<typeof getObject>[0]),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nameSingular: 'linkedinMessageThread',
          namePlural: 'linkedinMessageThreads',
          isSystem: true,
          isUICreatable: false,
        }),
        expect.objectContaining({
          nameSingular: 'linkedinMessage',
          namePlural: 'linkedinMessages',
          isSystem: true,
          isUICreatable: false,
        }),
        expect.objectContaining({
          nameSingular: 'linkedinThreadParticipant',
          namePlural: 'linkedinThreadParticipants',
          isSystem: true,
          isUICreatable: false,
        }),
        expect.objectContaining({
          nameSingular: 'linkedinConnection',
          namePlural: 'linkedinConnections',
          isSystem: true,
          isUICreatable: false,
        }),
        expect.objectContaining({
          nameSingular: 'linkedinInvitation',
          namePlural: 'linkedinInvitations',
          isSystem: true,
          isUICreatable: false,
        }),
      ]),
    );
  });

  it('builds message summary defaults and direction options', () => {
    expect(
      getField('linkedinMessageThread', 'lastMessagePreview'),
    ).toMatchObject({
      type: FieldMetadataType.TEXT,
      isNullable: false,
      defaultValue: "''",
    });
    expect(getField('linkedinMessageThread', 'messageCount')).toMatchObject({
      type: FieldMetadataType.NUMBER,
      isNullable: false,
      defaultValue: 0,
    });
    expect(getField('linkedinMessage', 'direction')?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'INBOUND' }),
        expect.objectContaining({ value: 'OUTBOUND' }),
      ]),
    );
    expect(getField('linkedinInvitation', 'direction')?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'SENT' }),
        expect.objectContaining({ value: 'RECEIVED' }),
      ]),
    );

    for (const objectName of [
      'linkedinMessageThread',
      'linkedinMessage',
      'linkedinThreadParticipant',
      'linkedinConnection',
      'linkedinInvitation',
    ] as const) {
      expect(getField(objectName, 'ownerWorkspaceMemberId')).toMatchObject({
        type: FieldMetadataType.TEXT,
        isSystem: true,
        isNullable: true,
        isUIEditable: false,
      });
      expect(getField(objectName, 'externalId')).toMatchObject({
        isUnique: false,
      });
    }
  });

  it('builds thread and person relations with the intended delete behavior', () => {
    const messageThread = getField('linkedinMessage', 'thread');
    const participantThread = getField('linkedinThreadParticipant', 'thread');
    const participantPerson = getField('linkedinThreadParticipant', 'person');
    const connectionPerson = getField('linkedinConnection', 'person');
    const threadMessages = getField('linkedinMessageThread', 'messages');
    const threadParticipants = getField(
      'linkedinMessageThread',
      'participants',
    );
    const personParticipants = getField('person', 'linkedinThreadParticipants');
    const personConnections = getField('person', 'linkedinConnections');

    expect(messageThread).toMatchObject({
      type: FieldMetadataType.RELATION,
      isNullable: false,
      settings: expect.objectContaining({
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.CASCADE,
        joinColumnName: 'threadId',
      }),
    });
    expect(participantThread).toMatchObject({
      isNullable: false,
      settings: expect.objectContaining({
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.CASCADE,
        joinColumnName: 'threadId',
      }),
    });
    expect(participantPerson).toMatchObject({
      isNullable: true,
      settings: expect.objectContaining({
        onDelete: RelationOnDeleteAction.SET_NULL,
        joinColumnName: 'personId',
      }),
    });
    expect(connectionPerson).toMatchObject({
      isNullable: true,
      settings: expect.objectContaining({
        onDelete: RelationOnDeleteAction.SET_NULL,
        joinColumnName: 'personId',
      }),
    });
    expect(personParticipants?.relationTargetFieldMetadataId).toBe(
      participantPerson?.id,
    );
    expect(personConnections?.relationTargetFieldMetadataId).toBe(
      connectionPerson?.id,
    );
    expect(threadMessages?.isActive).toBe(false);
    expect(threadParticipants?.isActive).toBe(false);
    expect(personParticipants?.isActive).toBe(false);
    expect(personConnections?.isActive).toBe(false);
  });

  it('builds partial external-id uniqueness and query indexes', () => {
    for (const objectName of [
      'linkedinMessageThread',
      'linkedinMessage',
      'linkedinThreadParticipant',
      'linkedinConnection',
      'linkedinInvitation',
    ] as const) {
      const index =
        allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
          STANDARD_OBJECTS[objectName].indexes.externalIdUniqueIndex
            .universalIdentifier
        ];

      expect(index).toMatchObject({
        isUnique: true,
        indexWhereClause: '"deletedAt" IS NULL',
      });
      expect(index?.flatIndexFieldMetadatas).toHaveLength(2);

      const indexedFieldUniversalIdentifiers =
        index?.flatIndexFieldMetadatas.map(
          ({ fieldMetadataId }) =>
            allFlatEntityMaps.flatFieldMetadataMaps.universalIdentifierById[
              fieldMetadataId
            ],
        );

      expect(indexedFieldUniversalIdentifiers).toEqual([
        STANDARD_OBJECTS[objectName].fields.externalId.universalIdentifier,
        STANDARD_OBJECTS[objectName].fields.ownerWorkspaceMemberId
          .universalIdentifier,
      ]);
    }

    const ownerThreadIndex =
      allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.linkedinMessageThread.indexes
          .ownerLinkedinIdLastMessageTimeIndex.universalIdentifier
      ];
    const messageThreadIndex =
      allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.linkedinMessage.indexes.threadIdDeliveredAtIndex
          .universalIdentifier
      ];

    expect(ownerThreadIndex?.flatIndexFieldMetadatas).toHaveLength(2);
    expect(messageThreadIndex?.flatIndexFieldMetadatas).toHaveLength(2);
  });
});
