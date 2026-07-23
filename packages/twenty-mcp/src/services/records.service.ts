import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, REST_PATH } from '../constants.js';
import { validateRecordInput } from '../schemas/dynamic-record.schema.js';
import type { RestQueryValue } from '../types.js';
import { TwentyApiError } from './errors.js';
import type { MetadataService } from './metadata.service.js';
import { normalizeListResponse } from './pagination.js';
import type { TwentyClient } from './twenty-client.js';

const OBJECT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertSafeObjectName = (object: string): void => {
  if (!OBJECT_NAME_PATTERN.test(object)) {
    throw new TwentyApiError({
      message: `Invalid object slug "${object}". Use the exact plural slug returned by twenty_list_objects.`,
      code: 'INVALID_OBJECT_SLUG',
    });
  }
};

const unwrapRestResponse = (response: unknown): unknown => {
  if (!isRecord(response) || !('data' in response)) {
    return response;
  }

  const { data } = response;

  if (!isRecord(data)) {
    return data;
  }

  const values = Object.values(data);

  return values.length === 1 ? values[0] : data;
};

const projectFields = (
  value: unknown,
  fields: string[] | undefined,
): unknown => {
  if (
    fields === undefined ||
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return value;
  }

  const record = value as Record<string, unknown>;

  return Object.fromEntries(
    ['id', ...fields]
      .filter((field, index, allFields) => allFields.indexOf(field) === index)
      .filter((field) => field in record)
      .map((field) => [field, record[field]]),
  );
};

export class RecordsService {
  private readonly client: TwentyClient;
  private readonly metadata: MetadataService;

  constructor(client: TwentyClient, metadata: MetadataService) {
    this.client = client;
    this.metadata = metadata;
  }

  async list({
    object,
    filter,
    orderBy,
    limit = DEFAULT_LIST_LIMIT,
    depth = 0,
    startingAfter,
    endingBefore,
    fields,
  }: {
    object: string;
    filter?: string;
    orderBy?: string;
    limit?: number;
    depth?: number;
    startingAfter?: string;
    endingBefore?: string;
    fields?: string[];
  }) {
    const objectMetadata = await this.metadata.getObject(object);
    const normalizedLimit = Math.min(Math.max(limit, 1), MAX_LIST_LIMIT);
    const query: Record<string, RestQueryValue> = {
      limit: normalizedLimit,
      depth,
      filter,
      order_by: orderBy,
      starting_after: startingAfter,
      ending_before: endingBefore,
    };
    const response = await this.client.rest(
      'GET',
      `${REST_PATH}/${objectMetadata.namePlural}`,
      { query },
    );
    const normalized = normalizeListResponse(
      response,
      objectMetadata.namePlural,
    );

    return {
      ...normalized,
      items: normalized.items.map((item) => projectFields(item, fields)),
    };
  }

  async get({
    object,
    id,
    depth = 0,
    fields,
  }: {
    object: string;
    id: string;
    depth?: number;
    fields?: string[];
  }): Promise<unknown> {
    const objectMetadata = await this.metadata.getObject(object);
    const response = await this.client.rest(
      'GET',
      `${REST_PATH}/${objectMetadata.namePlural}/${encodeURIComponent(id)}`,
      { query: { depth } },
    );

    return projectFields(unwrapRestResponse(response), fields);
  }

  async create({
    object,
    data,
    depth = 0,
  }: {
    object: string;
    data: Record<string, unknown>;
    depth?: number;
  }): Promise<unknown> {
    const objectMetadata = await this.metadata.getObject(object);
    const validated = validateRecordInput(objectMetadata, data);

    const response = await this.client.rest(
      'POST',
      `${REST_PATH}/${objectMetadata.namePlural}`,
      { query: { depth }, body: validated },
    );

    return unwrapRestResponse(response);
  }

  async update({
    object,
    id,
    data,
    depth = 0,
  }: {
    object: string;
    id: string;
    data: Record<string, unknown>;
    depth?: number;
  }): Promise<unknown> {
    const objectMetadata = await this.metadata.getObject(object);
    const validated = validateRecordInput(objectMetadata, data);

    const response = await this.client.rest(
      'PATCH',
      `${REST_PATH}/${objectMetadata.namePlural}/${encodeURIComponent(id)}`,
      { query: { depth }, body: validated },
    );

    return unwrapRestResponse(response);
  }

  async softDelete(object: string, id: string): Promise<unknown> {
    const objectMetadata = await this.metadata.getObject(object);

    const response = await this.client.rest(
      'DELETE',
      `${REST_PATH}/${objectMetadata.namePlural}/${encodeURIComponent(id)}`,
      { query: { soft_delete: true } },
    );

    return unwrapRestResponse(response);
  }

  async destroy(object: string, id: string): Promise<unknown> {
    const objectMetadata = await this.metadata.getObject(object);

    const response = await this.client.rest(
      'DELETE',
      `${REST_PATH}/${objectMetadata.namePlural}/${encodeURIComponent(id)}`,
    );

    return unwrapRestResponse(response);
  }

  async restore(object: string, id: string, depth = 0): Promise<unknown> {
    const objectMetadata = await this.metadata.getObject(object);

    const response = await this.client.rest(
      'PATCH',
      `${REST_PATH}/restore/${objectMetadata.namePlural}/${encodeURIComponent(id)}`,
      { query: { depth } },
    );

    return unwrapRestResponse(response);
  }

  async batchCreate({
    object,
    data,
    depth = 0,
  }: {
    object: string;
    data: Array<Record<string, unknown>>;
    depth?: number;
  }): Promise<unknown> {
    const objectMetadata = await this.metadata.getObject(object);
    const validated = data.map((record) =>
      validateRecordInput(objectMetadata, record),
    );

    const response = await this.client.rest(
      'POST',
      `${REST_PATH}/batch/${objectMetadata.namePlural}`,
      { query: { depth }, body: validated },
    );

    return unwrapRestResponse(response);
  }

  async findDuplicates({
    object,
    data,
    ids,
    depth = 0,
  }: {
    object: string;
    data?: Array<Record<string, unknown>>;
    ids?: string[];
    depth?: number;
  }): Promise<unknown> {
    const objectMetadata = await this.metadata.getObject(object);
    const validated =
      data === undefined
        ? undefined
        : data.map((record) => validateRecordInput(objectMetadata, record));

    const response = await this.client.rest(
      'POST',
      `${REST_PATH}/${objectMetadata.namePlural}/duplicates`,
      {
        query: { depth },
        body: {
          ...(validated === undefined ? {} : { data: validated }),
          ...(ids === undefined ? {} : { ids }),
        },
      },
    );

    return unwrapRestResponse(response);
  }

  async merge({
    object,
    ids,
    conflictPriorityIndex,
    dryRun = false,
    depth = 0,
  }: {
    object: string;
    ids: string[];
    conflictPriorityIndex: number;
    dryRun?: boolean;
    depth?: number;
  }): Promise<unknown> {
    const objectMetadata = await this.metadata.getObject(object);

    const response = await this.client.rest(
      'PATCH',
      `${REST_PATH}/${objectMetadata.namePlural}/merge`,
      {
        query: { depth },
        body: { ids, conflictPriorityIndex, dryRun },
      },
    );

    return unwrapRestResponse(response);
  }

  async groupBy({
    object,
    groupBy,
    aggregate,
    filter,
    orderBy,
    limit,
    includeRecords = false,
  }: {
    object: string;
    groupBy: Array<Record<string, unknown>>;
    aggregate?: string[];
    filter?: string;
    orderBy?: string;
    limit?: number;
    includeRecords?: boolean;
  }): Promise<unknown> {
    assertSafeObjectName(object);
    const objectMetadata = await this.metadata.getObject(object);

    return this.client.rest(
      'GET',
      `${REST_PATH}/${objectMetadata.namePlural}/groupBy`,
      {
        query: {
          group_by: groupBy,
          aggregate,
          filter,
          order_by: orderBy,
          limit,
          include_records_sample: includeRecords,
        },
      },
    );
  }
}

export const recordsServiceTesting = {
  assertSafeObjectName,
  projectFields,
  unwrapRestResponse,
};
