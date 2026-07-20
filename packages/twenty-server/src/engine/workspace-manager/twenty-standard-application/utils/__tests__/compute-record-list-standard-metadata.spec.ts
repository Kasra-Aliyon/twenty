import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import {
  FieldMetadataType,
  RECORD_LIST_TYPES,
  RelationType,
} from 'twenty-shared/types';

import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const TWENTY_STANDARD_APPLICATION_ID = '20202020-2222-4222-8222-222222222222';
const NOW = '2024-01-01T00:00:00.000Z';

describe('Record list standard metadata build', () => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: NOW,
      workspaceId: WORKSPACE_ID,
      twentyStandardApplicationId: TWENTY_STANDARD_APPLICATION_ID,
    });

  it('builds the folder, list, and member system objects', () => {
    for (const objectDefinition of [
      STANDARD_OBJECTS.recordListFolder,
      STANDARD_OBJECTS.recordList,
      STANDARD_OBJECTS.recordListMember,
    ]) {
      expect(
        allFlatEntityMaps.flatObjectMetadataMaps.byUniversalIdentifier[
          objectDefinition.universalIdentifier
        ],
      ).toMatchObject({ isSystem: true });
    }
  });

  it('builds the immutable list type and required folder relation', () => {
    const typeField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.recordList.fields.type.universalIdentifier
      ];
    const folderField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.recordList.fields.folder.universalIdentifier
      ];

    expect(typeField).toMatchObject({
      type: FieldMetadataType.SELECT,
      isNullable: false,
      options: expect.arrayContaining(
        Object.values(RECORD_LIST_TYPES).map((value) =>
          expect.objectContaining({ value }),
        ),
      ),
    });
    expect(folderField).toMatchObject({
      type: FieldMetadataType.RELATION,
      isNullable: false,
      settings: expect.objectContaining({
        relationType: RelationType.MANY_TO_ONE,
        joinColumnName: 'folderId',
      }),
    });
  });

  it('builds one morph target and reverse memberships for every supported object', () => {
    for (const [targetFieldName, targetObjectName] of [
      ['targetCompany', 'company'],
      ['targetPerson', 'person'],
      ['targetOpportunity', 'opportunity'],
    ] as const) {
      const targetField =
        allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
          STANDARD_OBJECTS.recordListMember.fields[targetFieldName]
            .universalIdentifier
        ];
      const reverseField =
        allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
          STANDARD_OBJECTS[targetObjectName].fields.recordListMemberships
            .universalIdentifier
        ];

      expect(targetField).toMatchObject({
        type: FieldMetadataType.MORPH_RELATION,
        settings: expect.objectContaining({
          relationType: RelationType.MANY_TO_ONE,
        }),
      });
      expect(reverseField).toMatchObject({
        type: FieldMetadataType.RELATION,
        settings: expect.objectContaining({
          relationType: RelationType.ONE_TO_MANY,
        }),
      });
      expect(reverseField?.relationTargetFieldMetadataId).toBe(targetField?.id);
    }
  });

  it('builds active unique membership indexes for each target type', () => {
    for (const indexDefinition of [
      STANDARD_OBJECTS.recordListMember.indexes.companyListUniqueIndex,
      STANDARD_OBJECTS.recordListMember.indexes.personListUniqueIndex,
      STANDARD_OBJECTS.recordListMember.indexes.opportunityListUniqueIndex,
    ]) {
      const index =
        allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
          indexDefinition.universalIdentifier
        ];

      expect(index).toMatchObject({
        isUnique: true,
        indexWhereClause: expect.stringContaining('"deletedAt" IS NULL'),
      });
      expect(index?.flatIndexFieldMetadatas).toHaveLength(2);
    }
  });
});
