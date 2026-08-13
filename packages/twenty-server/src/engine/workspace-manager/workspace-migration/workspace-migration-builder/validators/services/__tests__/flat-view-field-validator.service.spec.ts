import { ViewType } from 'twenty-shared/types';

import { createEmptyFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/constant/create-empty-flat-entity-maps.constant';
import { FlatViewFieldValidatorService } from 'src/engine/workspace-manager/workspace-migration/workspace-migration-builder/validators/services/flat-view-field-validator.service';

const VIEW_UNIVERSAL_IDENTIFIER = '00000000-0000-0000-0000-000000000001';
const FIELD_UNIVERSAL_IDENTIFIER = '00000000-0000-0000-0000-000000000002';
const OBJECT_UNIVERSAL_IDENTIFIER = '00000000-0000-0000-0000-000000000003';
const EXISTING_VIEW_FIELD_UNIVERSAL_IDENTIFIER =
  '00000000-0000-0000-0000-000000000004';
const NEW_VIEW_FIELD_UNIVERSAL_IDENTIFIER =
  '00000000-0000-0000-0000-000000000005';
const OUT_OF_SCOPE_VIEW_FIELD_UNIVERSAL_IDENTIFIER =
  '00000000-0000-0000-0000-000000000006';

const mapsFrom = (
  entities: ({ universalIdentifier: string } & Record<string, unknown>)[],
) => {
  const maps = createEmptyFlatEntityMaps();
  const mutableMaps = maps as unknown as {
    byUniversalIdentifier: Record<string, unknown>;
  };

  for (const entity of entities) {
    mutableMaps.byUniversalIdentifier[entity.universalIdentifier] = entity;
  }

  return maps;
};

const buildCreationArgs = (
  subFieldName: string | null,
  additionalViewFieldUniversalIdentifiers: string[] = [],
) => {
  const existingViewField = {
    universalIdentifier: EXISTING_VIEW_FIELD_UNIVERSAL_IDENTIFIER,
    viewUniversalIdentifier: VIEW_UNIVERSAL_IDENTIFIER,
    fieldMetadataUniversalIdentifier: FIELD_UNIVERSAL_IDENTIFIER,
    subFieldName: null,
    position: 0,
  };
  const newViewField = {
    ...existingViewField,
    universalIdentifier: NEW_VIEW_FIELD_UNIVERSAL_IDENTIFIER,
    subFieldName,
    position: 1,
  };

  return {
    flatEntityToValidate: newViewField,
    optimisticFlatEntityMapsAndRelatedFlatEntityMaps: {
      flatViewFieldMaps: mapsFrom([existingViewField]),
      flatFieldMetadataMaps: mapsFrom([
        { universalIdentifier: FIELD_UNIVERSAL_IDENTIFIER },
      ]),
      flatViewMaps: mapsFrom([
        {
          universalIdentifier: VIEW_UNIVERSAL_IDENTIFIER,
          objectMetadataUniversalIdentifier: OBJECT_UNIVERSAL_IDENTIFIER,
          viewFieldUniversalIdentifiers: [
            EXISTING_VIEW_FIELD_UNIVERSAL_IDENTIFIER,
            ...additionalViewFieldUniversalIdentifiers,
          ],
          type: ViewType.FIELDS_WIDGET,
        },
      ]),
      flatObjectMetadataMaps: mapsFrom([
        { universalIdentifier: OBJECT_UNIVERSAL_IDENTIFIER },
      ]),
    },
    additionalCacheDataMaps: {},
    workspaceId: 'workspace-id',
    buildOptions: {},
  } as unknown as Parameters<
    FlatViewFieldValidatorService['validateFlatViewFieldCreation']
  >[0];
};

describe('FlatViewFieldValidatorService', () => {
  const service = new FlatViewFieldValidatorService();

  it('should allow the same field in a view when the subfield differs', () => {
    const result = service.validateFlatViewFieldCreation(
      buildCreationArgs('addressCountry'),
    );

    expect(result.errors).toHaveLength(0);
  });

  it('should reject the same field, view, and subfield combination', () => {
    const result = service.validateFlatViewFieldCreation(
      buildCreationArgs(null),
    );

    expect(result.errors).toHaveLength(1);
  });

  it('should ignore view fields outside the application-scoped dependency maps', () => {
    const result = service.validateFlatViewFieldCreation(
      buildCreationArgs('addressCountry', [
        OUT_OF_SCOPE_VIEW_FIELD_UNIVERSAL_IDENTIFIER,
      ]),
    );

    expect(result.errors).toHaveLength(0);
  });
});
