import { compositeTypeDefinitions } from 'twenty-shared/types';
import { capitalize, isDefined } from 'twenty-shared/utils';

import { type ConflictingFieldGroup } from 'src/engine/api/common/common-query-runners/common-create-many-query-runner/types/conflicting-field-group.type';
import { getFlatFieldsFromFlatObjectMetadata } from 'src/engine/api/graphql/workspace-schema-builder/utils/get-flat-fields-for-flat-object-metadata.util';
import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { isMorphOrRelationFlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/utils/is-morph-or-relation-flat-field-metadata.util';
import { type FlatIndexMetadata } from 'src/engine/metadata-modules/flat-index-metadata/types/flat-index-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';

export const getConflictingFields = (
  flatObjectMetadata: FlatObjectMetadata,
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>,
  flatIndexMetadataMaps?: FlatEntityMaps<FlatIndexMetadata>,
): ConflictingFieldGroup[] => {
  const singleFieldConflicts = getFlatFieldsFromFlatObjectMetadata(
    flatObjectMetadata,
    flatFieldMetadataMaps,
  )
    .filter((field) => field.isUnique || field.name === 'id')
    .map((field) => {
      const compositeType = compositeTypeDefinitions.get(field.type);

      if (!compositeType) {
        return {
          baseField: field.name,
          conflictingProperties: [{ fullPath: field.name, column: field.name }],
        };
      }

      const conflictingProperties = compositeType.properties
        .filter((prop) => prop.isIncludedInUniqueConstraint)
        .map((property) => ({
          fullPath: `${field.name}.${property.name}`,
          column: `${field.name}${capitalize(property.name)}`,
        }));

      return { baseField: field.name, conflictingProperties };
    })
    .filter((group) => group.conflictingProperties.length > 0);

  if (!isDefined(flatIndexMetadataMaps)) {
    return singleFieldConflicts;
  }

  const compoundIndexConflicts = flatObjectMetadata.indexMetadataIds
    .map((indexMetadataId) =>
      findFlatEntityByIdInFlatEntityMaps({
        flatEntityId: indexMetadataId,
        flatEntityMaps: flatIndexMetadataMaps,
      }),
    )
    .filter(
      (indexMetadata): indexMetadata is FlatIndexMetadata =>
        isDefined(indexMetadata) &&
        indexMetadata.isUnique &&
        indexMetadata.flatIndexFieldMetadatas.length > 1,
    )
    .map((indexMetadata) => ({
      baseField: indexMetadata.name,
      conflictingProperties: indexMetadata.flatIndexFieldMetadatas
        .slice()
        .sort((first, second) => first.order - second.order)
        .flatMap(({ fieldMetadataId, subFieldName }) => {
          const fieldMetadata = findFlatEntityByIdInFlatEntityMaps({
            flatEntityId: fieldMetadataId,
            flatEntityMaps: flatFieldMetadataMaps,
          });

          if (!isDefined(fieldMetadata)) {
            return [];
          }

          if (isMorphOrRelationFlatFieldMetadata(fieldMetadata)) {
            const joinColumnName = computeMorphOrRelationFieldJoinColumnName({
              name: fieldMetadata.name,
            });

            return [{ fullPath: joinColumnName, column: joinColumnName }];
          }

          const compositeType = compositeTypeDefinitions.get(
            fieldMetadata.type,
          );

          if (!isDefined(compositeType)) {
            return [
              { fullPath: fieldMetadata.name, column: fieldMetadata.name },
            ];
          }

          const compositeProperties = isDefined(subFieldName)
            ? compositeType.properties.filter(
                (property) => property.name === subFieldName,
              )
            : compositeType.properties.filter(
                (property) => property.isIncludedInUniqueConstraint,
              );

          return compositeProperties.map((property) => ({
            fullPath: `${fieldMetadata.name}.${property.name}`,
            column: `${fieldMetadata.name}${capitalize(property.name)}`,
          }));
        }),
    }))
    .filter((group) => group.conflictingProperties.length > 1);

  return [...singleFieldConflicts, ...compoundIndexConflicts];
};
