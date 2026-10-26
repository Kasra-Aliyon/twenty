import { STANDARD_OBJECTS } from '../constants.js';
import type { MetadataService } from '../services/metadata.service.js';
import type { MetadataObject } from '../types.js';

const supportsTarget = (
  join: MetadataObject,
  target: MetadataObject,
  relationName: string,
): boolean =>
  join.fields.some(
    (field) =>
      field.isActive !== false &&
      ((['RELATION', 'MORPH_RELATION'].includes(field.type) &&
        field.name === relationName) ||
        (field.type === 'MORPH_RELATION' &&
          field.morphRelations?.some(
            (relation) =>
              relation.targetObjectMetadata?.id === target.id ||
              relation.targetObjectMetadata?.nameSingular ===
                target.nameSingular,
          ))),
  );

export const resolveActivityTargetField = async (
  metadata: MetadataService,
  objectName: string,
): Promise<string> => {
  const target = await metadata.getObject(objectName);
  const [noteTargets, taskTargets] = await Promise.all([
    metadata.getObject(STANDARD_OBJECTS.noteTargets),
    metadata.getObject(STANDARD_OBJECTS.taskTargets),
  ]);
  const relationName = `target${target.nameSingular[0]?.toUpperCase()}${target.nameSingular.slice(1)}`;

  if (
    ![noteTargets, taskTargets].every((join) =>
      supportsTarget(join, target, relationName),
    )
  ) {
    throw new Error(
      `Object "${target.nameSingular}" does not support both note and task targets. Refresh metadata or choose another object.`,
    );
  }

  return `${relationName}Id`;
};
