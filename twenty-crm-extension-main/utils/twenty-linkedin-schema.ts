import type { TwentyApiClient } from './twenty-api';

type LinkedInObjectName =
  | 'linkedinConnection'
  | 'linkedinInvitation'
  | 'linkedinMessageThread'
  | 'linkedinMessage';

type FieldDefinition = {
  name: string;
  label: string;
  type: 'TEXT' | 'LINKS' | 'DATE_TIME' | 'RAW_JSON' | 'SELECT';
  isUnique?: boolean;
  options?: Array<{
    label: string;
    value: string;
    color: string;
    position: number;
  }>;
};

type ObjectDefinition = {
  nameSingular: LinkedInObjectName;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  icon: string;
  fields: FieldDefinition[];
};

type MetadataObject = {
  id: string;
  nameSingular: string;
  fieldsList: Array<{ id: string; name: string }>;
};

type ResolvedLinkedInSchema = Record<
  LinkedInObjectName,
  { objectMetadataId: string; fieldMetadataIds: Record<string, string> }
>;

const LINKEDIN_SCHEMA_CACHE_KEY = 'twentyLinkedinSchemaCache';

const directionOptions = (values: string[], color: string) =>
  values.map((value, position) => ({
    label: value[0] + value.slice(1).toLowerCase(),
    value,
    color,
    position,
  }));

const OBJECT_DEFINITIONS: ObjectDefinition[] = [
  {
    nameSingular: 'linkedinConnection',
    namePlural: 'linkedinConnections',
    labelSingular: 'LinkedIn Connection',
    labelPlural: 'LinkedIn Connections',
    icon: 'IconBrandLinkedin',
    fields: [
      {
        name: 'externalId',
        label: 'External ID',
        type: 'TEXT',
        isUnique: true,
      },
      { name: 'handle', label: 'LinkedIn Handle', type: 'TEXT' },
      { name: 'headline', label: 'Headline', type: 'TEXT' },
      { name: 'profileUrl', label: 'Profile URL', type: 'LINKS' },
      { name: 'connectedAt', label: 'Connected At', type: 'DATE_TIME' },
      { name: 'ownerLinkedinId', label: 'Owner LinkedIn ID', type: 'TEXT' },
    ],
  },
  {
    nameSingular: 'linkedinInvitation',
    namePlural: 'linkedinInvitations',
    labelSingular: 'LinkedIn Invitation',
    labelPlural: 'LinkedIn Invitations',
    icon: 'IconUserPlus',
    fields: [
      {
        name: 'externalId',
        label: 'External ID',
        type: 'TEXT',
        isUnique: true,
      },
      {
        name: 'direction',
        label: 'Direction',
        type: 'SELECT',
        options: directionOptions(['SENT', 'RECEIVED'], 'blue'),
      },
      { name: 'handle', label: 'LinkedIn Handle', type: 'TEXT' },
      { name: 'headline', label: 'Headline', type: 'TEXT' },
      { name: 'message', label: 'Message', type: 'TEXT' },
      { name: 'sentAt', label: 'Sent At', type: 'DATE_TIME' },
      { name: 'ownerLinkedinId', label: 'Owner LinkedIn ID', type: 'TEXT' },
    ],
  },
  {
    nameSingular: 'linkedinMessageThread',
    namePlural: 'linkedinMessageThreads',
    labelSingular: 'LinkedIn Message Thread',
    labelPlural: 'LinkedIn Message Threads',
    icon: 'IconMessages',
    fields: [
      {
        name: 'externalId',
        label: 'External ID',
        type: 'TEXT',
        isUnique: true,
      },
      { name: 'threadId', label: 'Thread ID', type: 'TEXT' },
      {
        name: 'firstMessageTime',
        label: 'First Message Time',
        type: 'DATE_TIME',
      },
      {
        name: 'lastMessageTime',
        label: 'Last Message Time',
        type: 'DATE_TIME',
      },
      { name: 'participants', label: 'Participants', type: 'RAW_JSON' },
      { name: 'labels', label: 'Labels', type: 'RAW_JSON' },
      { name: 'ownerLinkedinId', label: 'Owner LinkedIn ID', type: 'TEXT' },
    ],
  },
  {
    nameSingular: 'linkedinMessage',
    namePlural: 'linkedinMessages',
    labelSingular: 'LinkedIn Message',
    labelPlural: 'LinkedIn Messages',
    icon: 'IconMessage',
    fields: [
      {
        name: 'externalId',
        label: 'External ID',
        type: 'TEXT',
        isUnique: true,
      },
      { name: 'messageId', label: 'Message ID', type: 'TEXT' },
      {
        name: 'threadExternalId',
        label: 'Thread External ID',
        type: 'TEXT',
      },
      { name: 'body', label: 'Body', type: 'TEXT' },
      { name: 'deliveredAt', label: 'Delivered At', type: 'DATE_TIME' },
      {
        name: 'direction',
        label: 'Direction',
        type: 'SELECT',
        options: directionOptions(['INBOUND', 'OUTBOUND'], 'purple'),
      },
      { name: 'senderName', label: 'Sender Name', type: 'TEXT' },
      { name: 'senderHandle', label: 'Sender Handle', type: 'TEXT' },
      { name: 'ownerLinkedinId', label: 'Owner LinkedIn ID', type: 'TEXT' },
    ],
  },
];

const FIND_OBJECTS_QUERY = `
  query FindLinkedinHarvestObjects {
    objects(paging: { first: 1000 }) {
      edges {
        node {
          id
          nameSingular
          fieldsList {
            id
            name
          }
        }
      }
    }
  }
`;

const CREATE_OBJECT_MUTATION = `
  mutation CreateLinkedinHarvestObject($input: CreateOneObjectInput!) {
    createOneObject(input: $input) {
      id
      nameSingular
      fieldsList {
        id
        name
      }
    }
  }
`;

const CREATE_FIELD_MUTATION = `
  mutation CreateLinkedinHarvestField($input: CreateOneFieldMetadataInput!) {
    createOneField(input: $input) {
      id
      name
    }
  }
`;

let schemaSessionPromise: Promise<ResolvedLinkedInSchema> | null = null;

const permissionError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);

  if (/permission|data_model|forbidden|not authorized/i.test(message)) {
    return new Error(
      'LinkedIn harvest setup needs Twenty Data Model permission. Ask a workspace admin to grant it, then retry.',
    );
  }

  return error instanceof Error ? error : new Error(message);
};

const createObject = async (
  client: TwentyApiClient,
  definition: ObjectDefinition,
): Promise<MetadataObject> => {
  const result = await client.metadataRequest<{
    createOneObject: MetadataObject;
  }>(CREATE_OBJECT_MUTATION, {
    input: {
      object: {
        nameSingular: definition.nameSingular,
        namePlural: definition.namePlural,
        labelSingular: definition.labelSingular,
        labelPlural: definition.labelPlural,
        icon: definition.icon,
      },
    },
  });

  if (!result.data?.createOneObject) {
    throw new Error(`Twenty did not create ${definition.labelSingular}`);
  }

  return result.data.createOneObject;
};

const createField = async (
  client: TwentyApiClient,
  objectMetadataId: string,
  definition: FieldDefinition,
): Promise<{ id: string; name: string }> => {
  const result = await client.metadataRequest<{
    createOneField: { id: string; name: string };
  }>(CREATE_FIELD_MUTATION, {
    input: {
      field: {
        objectMetadataId,
        name: definition.name,
        label: definition.label,
        type: definition.type,
        isUnique: definition.isUnique,
        options: definition.options,
      },
    },
  });

  if (!result.data?.createOneField) {
    throw new Error(`Twenty did not create the ${definition.label} field`);
  }

  return result.data.createOneField;
};

const provisionSchema = async (
  client: TwentyApiClient,
): Promise<ResolvedLinkedInSchema> => {
  try {
    const result = await client.metadataRequest<{
      objects: { edges: Array<{ node: MetadataObject }> };
    }>(FIND_OBJECTS_QUERY);
    const objects = new Map(
      (result.data?.objects.edges ?? []).map(({ node }) => [
        node.nameSingular,
        node,
      ]),
    );
    const resolvedSchema = {} as ResolvedLinkedInSchema;

    for (const definition of OBJECT_DEFINITIONS) {
      const object =
        objects.get(definition.nameSingular) ??
        (await createObject(client, definition));
      const fields = new Map(
        object.fieldsList.map((field) => [field.name, field]),
      );

      for (const fieldDefinition of definition.fields) {
        if (!fields.has(fieldDefinition.name)) {
          const field = await createField(client, object.id, fieldDefinition);

          fields.set(field.name, field);
        }
      }

      resolvedSchema[definition.nameSingular] = {
        objectMetadataId: object.id,
        fieldMetadataIds: Object.fromEntries(
          [...fields].map(([name, field]) => [name, field.id]),
        ),
      };
    }

    await browser.storage.local.set({
      [LINKEDIN_SCHEMA_CACHE_KEY]: resolvedSchema,
    });

    return resolvedSchema;
  } catch (error) {
    throw permissionError(error);
  }
};

export const ensureLinkedinSchema = (
  client: TwentyApiClient,
): Promise<ResolvedLinkedInSchema> => {
  schemaSessionPromise ??= provisionSchema(client).catch((error) => {
    schemaSessionPromise = null;
    throw error;
  });

  return schemaSessionPromise;
};

export const resetLinkedinSchemaSessionCache = (): void => {
  schemaSessionPromise = null;
};
