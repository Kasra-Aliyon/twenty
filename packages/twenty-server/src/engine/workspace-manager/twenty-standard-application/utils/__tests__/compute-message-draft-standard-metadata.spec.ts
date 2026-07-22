import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import {
  FieldMetadataType,
  RelationOnDeleteAction,
  RelationType,
} from 'twenty-shared/types';

import { getFlatFieldsFromFlatObjectMetadata } from 'src/engine/api/graphql/workspace-schema-builder/utils/get-flat-fields-for-flat-object-metadata.util';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const TWENTY_STANDARD_APPLICATION_ID = '20202020-2222-4222-8222-222222222222';
const NOW = '2024-01-01T00:00:00.000Z';

describe('Message draft standard metadata build', () => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: NOW,
      workspaceId: WORKSPACE_ID,
      twentyStandardApplicationId: TWENTY_STANDARD_APPLICATION_ID,
    });

  it('builds a non-creatable system object with draft fields', () => {
    const objectMetadata =
      allFlatEntityMaps.flatObjectMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.messageDraft.universalIdentifier
      ];
    const connectedAccountIdField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.messageDraft.fields.connectedAccountId
          .universalIdentifier
      ];

    expect(objectMetadata).toMatchObject({
      isSystem: true,
      isUICreatable: false,
      isAuditLogged: false,
      labelIdentifierFieldMetadataId:
        allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
          STANDARD_OBJECTS.messageDraft.fields.subject.universalIdentifier
        ]?.id,
    });
    expect(connectedAccountIdField).toMatchObject({
      type: FieldMetadataType.TEXT,
      isNullable: false,
    });
  });

  it('builds nullable thread and required author relations with inverses', () => {
    const messageThreadRelation =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.messageDraft.fields.messageThread.universalIdentifier
      ];
    const authorRelation =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.messageDraft.fields.author.universalIdentifier
      ];
    const reverseThreadRelation =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.messageThread.fields.messageDrafts.universalIdentifier
      ];
    const reverseAuthorRelation =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.workspaceMember.fields.messageDrafts
          .universalIdentifier
      ];

    expect(messageThreadRelation).toMatchObject({
      type: FieldMetadataType.RELATION,
      isNullable: true,
      settings: expect.objectContaining({
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.SET_NULL,
        joinColumnName: 'messageThreadId',
      }),
    });
    expect(authorRelation).toMatchObject({
      type: FieldMetadataType.RELATION,
      isNullable: false,
      settings: expect.objectContaining({
        relationType: RelationType.MANY_TO_ONE,
        onDelete: RelationOnDeleteAction.CASCADE,
        joinColumnName: 'authorId',
      }),
    });
    expect(reverseThreadRelation?.relationTargetFieldMetadataId).toBe(
      messageThreadRelation?.id,
    );
    expect(reverseAuthorRelation?.relationTargetFieldMetadataId).toBe(
      authorRelation?.id,
    );
    expect(reverseThreadRelation).toMatchObject({ isActive: false });
    expect(reverseAuthorRelation).toMatchObject({ isActive: false });
  });

  it('keeps draft inverses out of nested GraphQL selections', () => {
    const messageThreadObject =
      allFlatEntityMaps.flatObjectMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.messageThread.universalIdentifier
      ];
    const workspaceMemberObject =
      allFlatEntityMaps.flatObjectMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.workspaceMember.universalIdentifier
      ];

    expect(messageThreadObject).toBeDefined();
    expect(workspaceMemberObject).toBeDefined();

    const messageThreadSchemaFieldNames = getFlatFieldsFromFlatObjectMetadata(
      messageThreadObject!,
      allFlatEntityMaps.flatFieldMetadataMaps,
    ).map(({ name }) => name);
    const workspaceMemberSchemaFieldNames = getFlatFieldsFromFlatObjectMetadata(
      workspaceMemberObject!,
      allFlatEntityMaps.flatFieldMetadataMaps,
    ).map(({ name }) => name);

    expect(messageThreadSchemaFieldNames).not.toContain('messageDrafts');
    expect(workspaceMemberSchemaFieldNames).not.toContain('messageDrafts');
  });

  it('builds the author and last-edited composite index', () => {
    const index =
      allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.messageDraft.indexes.authorIdLastEditedAtIndex
          .universalIdentifier
      ];
    const authorField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.messageDraft.fields.author.universalIdentifier
      ];
    const lastEditedAtField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.messageDraft.fields.lastEditedAt.universalIdentifier
      ];

    expect(index?.flatIndexFieldMetadatas).toHaveLength(2);
    expect(
      index?.flatIndexFieldMetadatas.map(
        ({ fieldMetadataId }) => fieldMetadataId,
      ),
    ).toEqual([authorField?.id, lastEditedAtField?.id]);
  });
});
