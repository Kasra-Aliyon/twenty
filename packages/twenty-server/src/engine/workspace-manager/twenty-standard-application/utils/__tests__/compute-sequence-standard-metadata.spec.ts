import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import {
  FieldMetadataType,
  LINKEDIN_ACTION_STATUSES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_CONNECTION_STATES,
  RelationType,
  SEQUENCE_ENROLLMENT_STATUSES,
  SEQUENCE_STATUSES,
  SEQUENCE_STEP_TYPES,
  SEQUENCE_TASK_TYPES,
  TASK_PRIORITIES,
} from 'twenty-shared/types';

import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const TWENTY_STANDARD_APPLICATION_ID = '20202020-2222-4222-8222-222222222222';
const NOW = '2024-01-01T00:00:00.000Z';

describe('Sequence standard metadata build', () => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: NOW,
      workspaceId: WORKSPACE_ID,
      twentyStandardApplicationId: TWENTY_STANDARD_APPLICATION_ID,
    });

  it('builds the sequence, step, and enrollment system objects', () => {
    for (const objectDefinition of [
      STANDARD_OBJECTS.sequence,
      STANDARD_OBJECTS.sequenceStep,
      STANDARD_OBJECTS.sequenceEnrollment,
      STANDARD_OBJECTS.linkedinAction,
    ]) {
      expect(
        allFlatEntityMaps.flatObjectMetadataMaps.byUniversalIdentifier[
          objectDefinition.universalIdentifier
        ],
      ).toMatchObject({ isSystem: true });
    }
  });

  it('builds sequence and step settings with stable select values', () => {
    const sequenceStatusField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.sequence.fields.status.universalIdentifier
      ];
    const stepTypeField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.sequenceStep.fields.type.universalIdentifier
      ];

    expect(sequenceStatusField).toMatchObject({
      type: FieldMetadataType.SELECT,
      options: expect.arrayContaining(
        Object.values(SEQUENCE_STATUSES).map((value) =>
          expect.objectContaining({ value }),
        ),
      ),
    });
    expect(stepTypeField).toMatchObject({
      type: FieldMetadataType.SELECT,
      options: expect.arrayContaining(
        Object.values(SEQUENCE_STEP_TYPES).map((value) =>
          expect.objectContaining({ value }),
        ),
      ),
    });
  });

  it('builds required sequence and person enrollment relations', () => {
    const sequenceRelation =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.sequenceEnrollment.fields.sequence.universalIdentifier
      ];
    const personRelation =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.sequenceEnrollment.fields.person.universalIdentifier
      ];
    const reversePersonRelation =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.person.fields.sequenceEnrollments.universalIdentifier
      ];

    for (const relation of [sequenceRelation, personRelation]) {
      expect(relation).toMatchObject({
        type: FieldMetadataType.RELATION,
        isNullable: false,
        settings: expect.objectContaining({
          relationType: RelationType.MANY_TO_ONE,
        }),
      });
    }
    expect(reversePersonRelation).toMatchObject({
      type: FieldMetadataType.RELATION,
      settings: expect.objectContaining({
        relationType: RelationType.ONE_TO_MANY,
      }),
    });
    expect(reversePersonRelation?.relationTargetFieldMetadataId).toBe(
      personRelation?.id,
    );
  });

  it('builds enrollment scheduling and uniqueness indexes', () => {
    const uniqueIndex =
      allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.sequenceEnrollment.indexes.personSequenceUniqueIndex
          .universalIdentifier
      ];
    const dueIndex =
      allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.sequenceEnrollment.indexes.statusNextActionAtIndex
          .universalIdentifier
      ];

    expect(uniqueIndex).toMatchObject({
      isUnique: true,
      indexWhereClause: '"deletedAt" IS NULL',
    });
    expect(uniqueIndex?.flatIndexFieldMetadatas).toHaveLength(2);
    expect(dueIndex?.flatIndexFieldMetadatas).toHaveLength(2);
  });

  it('extends people and tasks for sequence execution', () => {
    const emailOptOutField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.person.fields.emailOptOut.universalIdentifier
      ];
    const enrollmentStatusField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.sequenceEnrollment.fields.status.universalIdentifier
      ];
    const taskTypeField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.task.fields.type.universalIdentifier
      ];
    const taskPriorityField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.task.fields.priority.universalIdentifier
      ];

    expect(emailOptOutField).toMatchObject({
      type: FieldMetadataType.BOOLEAN,
      defaultValue: false,
    });
    expect(enrollmentStatusField?.options).toEqual(
      expect.arrayContaining(
        Object.values(SEQUENCE_ENROLLMENT_STATUSES).map((value) =>
          expect.objectContaining({ value }),
        ),
      ),
    );
    expect(taskTypeField?.options).toEqual(
      expect.arrayContaining(
        Object.values(SEQUENCE_TASK_TYPES).map((value) =>
          expect.objectContaining({ value }),
        ),
      ),
    );
    expect(taskPriorityField?.options).toEqual(
      expect.arrayContaining(
        Object.values(TASK_PRIORITIES).map((value) =>
          expect.objectContaining({ value }),
        ),
      ),
    );
  });

  it('builds the LinkedIn queue, person state, relation, and indexes', () => {
    const actionTypeField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.linkedinAction.fields.type.universalIdentifier
      ];
    const actionStatusField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.linkedinAction.fields.status.universalIdentifier
      ];
    const connectionStateField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.linkedinAction.fields.connectionState
          .universalIdentifier
      ];
    const personConnectionStateField =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.person.fields.linkedinConnectionState
          .universalIdentifier
      ];
    const personRelation =
      allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.linkedinAction.fields.person.universalIdentifier
      ];
    const statusScheduledAtIndex =
      allFlatEntityMaps.flatIndexMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.linkedinAction.indexes.statusScheduledAtIndex
          .universalIdentifier
      ];

    expect(actionTypeField?.options).toEqual(
      expect.arrayContaining(
        Object.values(LINKEDIN_ACTION_TYPES).map((value) =>
          expect.objectContaining({ value }),
        ),
      ),
    );
    expect(actionStatusField?.options).toEqual(
      expect.arrayContaining(
        Object.values(LINKEDIN_ACTION_STATUSES).map((value) =>
          expect.objectContaining({ value }),
        ),
      ),
    );
    for (const field of [connectionStateField, personConnectionStateField]) {
      expect(field?.options).toEqual(
        expect.arrayContaining(
          Object.values(LINKEDIN_CONNECTION_STATES).map((value) =>
            expect.objectContaining({ value }),
          ),
        ),
      );
    }
    expect(personRelation).toMatchObject({
      type: FieldMetadataType.RELATION,
      settings: expect.objectContaining({
        relationType: RelationType.MANY_TO_ONE,
      }),
    });
    expect(statusScheduledAtIndex?.flatIndexFieldMetadatas).toHaveLength(2);
  });
});
