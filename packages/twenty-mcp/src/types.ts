export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type ResponseFormat = 'json' | 'markdown';
export type TransportMode = 'http' | 'stdio';

export type TwentyMcpConfig = {
  baseUrl: URL;
  apiKey: string;
  userToken?: string;
  metadataCacheTtlMs: number;
  requestTimeoutMs: number;
  maxRetries: number;
  enableAdvanced: boolean;
  transport: TransportMode;
  host: string;
  port: number;
  httpBearerToken?: string;
};

export type RestQueryValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | Record<string, unknown>
  | unknown[];

export type RestRequestOptions = {
  query?: Record<string, RestQueryValue>;
  body?: unknown;
  token?: 'api' | 'user';
};

export type GraphqlErrorLocation = {
  line: number;
  column: number;
};

export type GraphqlError = {
  message: string;
  path?: Array<number | string>;
  locations?: GraphqlErrorLocation[];
  extensions?: Record<string, unknown>;
};

export type MetadataOption = {
  id?: string;
  value: string;
  label?: string;
  position?: number;
  color?: string;
};

export type MetadataRelationObject = {
  id?: string;
  nameSingular?: string;
  namePlural?: string;
};

export type MetadataRelation = {
  type?: string;
  sourceObjectMetadata?: MetadataRelationObject;
  targetObjectMetadata?: MetadataRelationObject;
  sourceFieldMetadata?: { id?: string; name?: string };
  targetFieldMetadata?: { id?: string; name?: string };
};

export type MetadataField = {
  id: string;
  name: string;
  label: string;
  type: string;
  description?: string;
  isActive?: boolean;
  isSystem?: boolean;
  isUIEditable?: boolean;
  isNullable?: boolean;
  isUnique?: boolean;
  defaultValue?: unknown;
  options?: MetadataOption[];
  settings?: Record<string, unknown>;
  relation?: MetadataRelation;
  morphRelations?: MetadataRelation[];
};

export type MetadataObject = {
  id: string;
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  description?: string;
  icon?: string;
  isActive?: boolean;
  isSystem?: boolean;
  isRemote?: boolean;
  isSearchable?: boolean;
  labelIdentifierFieldMetadataId?: string | null;
  fields: MetadataField[];
};

export type PaginationMetadata = {
  total: number | null;
  count: number;
  has_more: boolean;
  next_cursor: string | null;
};

export type NormalizedListResponse = PaginationMetadata & {
  items: unknown[];
};

export type ToolDependencies = {
  client: TwentyClient;
  metadata: MetadataService;
  enableAdvanced: boolean;
};
import type { MetadataService } from './services/metadata.service.js';
import type { TwentyClient } from './services/twenty-client.js';
