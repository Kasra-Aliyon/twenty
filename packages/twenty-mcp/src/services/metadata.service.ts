import { REST_PATH } from '../constants.js';
import type {
  MetadataField,
  MetadataObject,
  MetadataOption,
  MetadataRelation,
} from '../types.js';
import { TwentyApiError } from './errors.js';
import type { TwentyClient } from './twenty-client.js';

const METADATA_QUERY = `
  query TwentyMcpObjectMetadata {
    objects(paging: { first: 1000 }) {
      edges {
        node {
          id
          nameSingular
          namePlural
          labelSingular
          labelPlural
          description
          icon
          isActive
          isSystem
          isRemote
          isSearchable
          labelIdentifierFieldMetadataId
          fieldsList {
            id
            name
            label
            type
            description
            isActive
            isSystem
            isUIEditable
            isNullable
            isUnique
            defaultValue
            options
            settings
            relation {
              type
              sourceObjectMetadata { id nameSingular namePlural }
              targetObjectMetadata { id nameSingular namePlural }
              sourceFieldMetadata { id name }
              targetFieldMetadata { id name }
            }
            morphRelations {
              type
              sourceObjectMetadata { id nameSingular namePlural }
              targetObjectMetadata { id nameSingular namePlural }
              sourceFieldMetadata { id name }
              targetFieldMetadata { id name }
            }
          }
        }
      }
    }
  }
`;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const normalizeOption = (value: unknown): MetadataOption | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const optionValue = asString(value.value);

  if (optionValue === undefined) {
    return undefined;
  }

  return {
    value: optionValue,
    ...(asString(value.id) === undefined ? {} : { id: asString(value.id) }),
    ...(asString(value.label) === undefined
      ? {}
      : { label: asString(value.label) }),
    ...(typeof value.position === 'number' ? { position: value.position } : {}),
    ...(asString(value.color) === undefined
      ? {}
      : { color: asString(value.color) }),
  };
};

const normalizeRelationObject = (
  value: unknown,
): MetadataRelation['sourceObjectMetadata'] => {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    ...(asString(value.id) === undefined ? {} : { id: asString(value.id) }),
    ...(asString(value.nameSingular) === undefined
      ? {}
      : { nameSingular: asString(value.nameSingular) }),
    ...(asString(value.namePlural) === undefined
      ? {}
      : { namePlural: asString(value.namePlural) }),
  };
};

const normalizeRelation = (value: unknown): MetadataRelation | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const sourceField = isRecord(value.sourceFieldMetadata)
    ? value.sourceFieldMetadata
    : undefined;
  const targetField = isRecord(value.targetFieldMetadata)
    ? value.targetFieldMetadata
    : undefined;

  return {
    ...(asString(value.type) === undefined
      ? {}
      : { type: asString(value.type) }),
    ...(normalizeRelationObject(value.sourceObjectMetadata) === undefined
      ? {}
      : {
          sourceObjectMetadata: normalizeRelationObject(
            value.sourceObjectMetadata,
          ),
        }),
    ...(normalizeRelationObject(value.targetObjectMetadata) === undefined
      ? {}
      : {
          targetObjectMetadata: normalizeRelationObject(
            value.targetObjectMetadata,
          ),
        }),
    ...(sourceField === undefined
      ? {}
      : {
          sourceFieldMetadata: {
            ...(asString(sourceField.id) === undefined
              ? {}
              : { id: asString(sourceField.id) }),
            ...(asString(sourceField.name) === undefined
              ? {}
              : { name: asString(sourceField.name) }),
          },
        }),
    ...(targetField === undefined
      ? {}
      : {
          targetFieldMetadata: {
            ...(asString(targetField.id) === undefined
              ? {}
              : { id: asString(targetField.id) }),
            ...(asString(targetField.name) === undefined
              ? {}
              : { name: asString(targetField.name) }),
          },
        }),
  };
};

const normalizeField = (value: unknown): MetadataField | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = asString(value.id);
  const name = asString(value.name);
  const label = asString(value.label);
  const type = asString(value.type);

  if (
    id === undefined ||
    name === undefined ||
    label === undefined ||
    type === undefined
  ) {
    return undefined;
  }

  const options = Array.isArray(value.options)
    ? value.options
        .map((option) => normalizeOption(option))
        .filter((option): option is MetadataOption => option !== undefined)
    : undefined;
  const morphRelations = Array.isArray(value.morphRelations)
    ? value.morphRelations
        .map((relation) => normalizeRelation(relation))
        .filter(
          (relation): relation is MetadataRelation => relation !== undefined,
        )
    : undefined;

  return {
    id,
    name,
    label,
    type,
    ...(asString(value.description) === undefined
      ? {}
      : { description: asString(value.description) }),
    ...(asBoolean(value.isActive) === undefined
      ? {}
      : { isActive: asBoolean(value.isActive) }),
    ...(asBoolean(value.isSystem) === undefined
      ? {}
      : { isSystem: asBoolean(value.isSystem) }),
    ...(asBoolean(value.isUIEditable) === undefined
      ? {}
      : { isUIEditable: asBoolean(value.isUIEditable) }),
    ...(asBoolean(value.isNullable) === undefined
      ? {}
      : { isNullable: asBoolean(value.isNullable) }),
    ...(asBoolean(value.isUnique) === undefined
      ? {}
      : { isUnique: asBoolean(value.isUnique) }),
    ...('defaultValue' in value ? { defaultValue: value.defaultValue } : {}),
    ...(options === undefined ? {} : { options }),
    ...(isRecord(value.settings) ? { settings: value.settings } : {}),
    ...(normalizeRelation(value.relation) === undefined
      ? {}
      : { relation: normalizeRelation(value.relation) }),
    ...(morphRelations === undefined ? {} : { morphRelations }),
  };
};

const normalizeObject = (value: unknown): MetadataObject | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = asString(value.id);
  const nameSingular = asString(value.nameSingular);
  const namePlural = asString(value.namePlural);
  const labelSingular = asString(value.labelSingular);
  const labelPlural = asString(value.labelPlural);

  if (
    id === undefined ||
    nameSingular === undefined ||
    namePlural === undefined ||
    labelSingular === undefined ||
    labelPlural === undefined
  ) {
    return undefined;
  }

  const rawFields = Array.isArray(value.fields)
    ? value.fields
    : Array.isArray(value.fieldsList)
      ? value.fieldsList
      : [];
  const fields = rawFields
    .map((field) => normalizeField(field))
    .filter((field): field is MetadataField => field !== undefined);

  return {
    id,
    nameSingular,
    namePlural,
    labelSingular,
    labelPlural,
    fields,
    ...(asString(value.description) === undefined
      ? {}
      : { description: asString(value.description) }),
    ...(asString(value.icon) === undefined
      ? {}
      : { icon: asString(value.icon) }),
    ...(asBoolean(value.isActive) === undefined
      ? {}
      : { isActive: asBoolean(value.isActive) }),
    ...(asBoolean(value.isSystem) === undefined
      ? {}
      : { isSystem: asBoolean(value.isSystem) }),
    ...(asBoolean(value.isRemote) === undefined
      ? {}
      : { isRemote: asBoolean(value.isRemote) }),
    ...(asBoolean(value.isSearchable) === undefined
      ? {}
      : { isSearchable: asBoolean(value.isSearchable) }),
    ...(!('labelIdentifierFieldMetadataId' in value)
      ? {}
      : {
          labelIdentifierFieldMetadataId:
            value.labelIdentifierFieldMetadataId === null
              ? null
              : asString(value.labelIdentifierFieldMetadataId),
        }),
  };
};

const extractRestObjects = (response: unknown): MetadataObject[] => {
  if (!isRecord(response) || !('data' in response)) {
    return [];
  }

  const data = response.data;
  const rawObjects = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.objects)
      ? data.objects
      : [];

  return rawObjects
    .map((object) => normalizeObject(object))
    .filter((object): object is MetadataObject => object !== undefined);
};

const extractGraphqlObjects = (response: unknown): MetadataObject[] => {
  if (
    !isRecord(response) ||
    !isRecord(response.objects) ||
    !Array.isArray(response.objects.edges)
  ) {
    return [];
  }

  return response.objects.edges
    .map((edge) => (isRecord(edge) ? normalizeObject(edge.node) : undefined))
    .filter((object): object is MetadataObject => object !== undefined);
};

export class MetadataService {
  private readonly client: TwentyClient;
  private readonly ttlMs: number;
  private cache: { loadedAt: number; objects: MetadataObject[] } | undefined;

  constructor(client: TwentyClient, ttlMs: number) {
    this.client = client;
    this.ttlMs = ttlMs;
  }

  clearCache(): void {
    this.cache = undefined;
  }

  async listObjects(
    options: { refresh?: boolean } = {},
  ): Promise<MetadataObject[]> {
    const now = Date.now();

    if (
      options.refresh !== true &&
      this.cache !== undefined &&
      now - this.cache.loadedAt < this.ttlMs
    ) {
      return this.cache.objects;
    }

    let objects: MetadataObject[] = [];
    let restError: unknown;

    try {
      const response = await this.client.rest(
        'GET',
        `${REST_PATH}/metadata/objects`,
        { query: { limit: 1000 } },
      );

      objects = extractRestObjects(response);
    } catch (error) {
      restError = error;
    }

    if (objects.length === 0) {
      try {
        const response = await this.client.graphql<unknown>(
          METADATA_QUERY,
          {},
          { endpoint: 'metadata' },
        );

        objects = extractGraphqlObjects(response);
      } catch (graphqlError) {
        throw new TwentyApiError({
          message:
            'Unable to read Twenty object metadata through either REST or GraphQL. Ensure the API key can read the Data Model. ' +
            `REST: ${restError instanceof Error ? restError.message : 'no objects returned'}. ` +
            `GraphQL: ${graphqlError instanceof Error ? graphqlError.message : 'unknown error'}.`,
          code: 'METADATA_UNAVAILABLE',
          details: { restError, graphqlError },
        });
      }
    }

    this.cache = { loadedAt: now, objects };

    return objects;
  }

  async getObject(name: string): Promise<MetadataObject> {
    const objects = await this.listObjects();
    const normalizedName = name.toLocaleLowerCase();
    const object = objects.find(
      (candidate) =>
        candidate.namePlural.toLocaleLowerCase() === normalizedName ||
        candidate.nameSingular.toLocaleLowerCase() === normalizedName,
    );

    if (object === undefined) {
      const knownObjects = objects
        .slice(0, 30)
        .map((candidate) => candidate.namePlural)
        .join(', ');

      throw new TwentyApiError({
        message: `Unknown object "${name}". Use twenty_list_objects. Known objects include: ${knownObjects}.`,
        code: 'UNKNOWN_OBJECT',
      });
    }

    return object;
  }
}

export const metadataTesting = {
  extractGraphqlObjects,
  extractRestObjects,
  normalizeField,
  normalizeObject,
};
