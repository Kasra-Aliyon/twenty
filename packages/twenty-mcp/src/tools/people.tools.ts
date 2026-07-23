import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STANDARD_OBJECTS } from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  depthSchema,
  listLimitSchema,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import {
  combineFilters,
  filterCondition,
  textSearchFilter,
} from '../services/filter-builder.js';
import { RecordsService } from '../services/records.service.js';
import type { ToolDependencies } from '../types.js';
import {
  buildEmailsValue,
  buildLinksValue,
  buildPhonesValue,
  compactRecord,
} from './tool-data-builders.js';

const phoneSchema = z.object({
  number: z.string().min(1),
  countryCode: z.string().min(2).max(2),
  callingCode: z.string().min(1),
});

const personFieldsSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  emails: z.array(z.email()).max(20).optional(),
  phones: z.array(phoneSchema).max(20).optional(),
  job_title: z.string().optional(),
  linkedin_url: z.url().optional(),
  company_id: z.string().nullable().optional(),
  email_opt_out: z.boolean().optional(),
});

const personData = (
  value: z.infer<typeof personFieldsSchema>,
): Record<string, unknown> =>
  compactRecord([
    [
      'name',
      value.first_name === undefined && value.last_name === undefined
        ? undefined
        : {
            firstName: value.first_name ?? '',
            lastName: value.last_name ?? '',
          },
    ],
    [
      'emails',
      value.emails === undefined ? undefined : buildEmailsValue(value.emails),
    ],
    [
      'phones',
      value.phones === undefined ? undefined : buildPhonesValue(value.phones),
    ],
    ['jobTitle', value.job_title],
    [
      'linkedinLink',
      value.linkedin_url === undefined
        ? undefined
        : buildLinksValue(value.linkedin_url),
    ],
    ['companyId', value.company_id],
    ['emailOptOut', value.email_opt_out],
  ]);

export const registerPeopleTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_create_person',
    {
      title: 'Create a person',
      description:
        'Creates a person with normalized Twenty composite name, email, phone, and LinkedIn fields.',
      inputSchema: personFieldsSchema
        .extend({
          first_name: z.string().default(''),
          last_name: z.string().default(''),
          depth: depthSchema,
          response_format: responseFormatSchema,
        })
        .refine(
          (value) =>
            value.first_name.trim() !== '' || value.last_name.trim() !== '',
          { message: 'Provide first_name and/or last_name.' },
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ depth, response_format, ...input }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.people,
            data: personData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_person',
    {
      title: 'Update a person',
      description:
        'Partially updates the common editable fields of an existing person.',
      inputSchema: personFieldsSchema.extend({
        id: recordIdSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, depth, response_format, ...input }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.people,
            id,
            data: personData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_find_people',
    {
      title: 'Find people',
      description:
        'Finds people by name/job-title text plus company and primary-email-domain filters.',
      inputSchema: z.object({
        search: z.string().optional(),
        company_id: z.string().optional(),
        job_title: z.string().optional(),
        email_domain: z.string().optional(),
        limit: listLimitSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      search,
      company_id,
      job_title,
      email_domain,
      limit,
      depth,
      response_format,
    }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.people,
            filter: combineFilters('and', [
              textSearchFilter(
                ['name.firstName', 'name.lastName', 'jobTitle'],
                search,
              ),
              company_id === undefined
                ? undefined
                : filterCondition('companyId', 'eq', company_id),
              job_title === undefined
                ? undefined
                : filterCondition('jobTitle', 'ilike', `%${job_title}%`),
              email_domain === undefined
                ? undefined
                : filterCondition(
                    'emails.primaryEmail',
                    'ilike',
                    `%@${email_domain}`,
                  ),
            ]),
            limit,
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_person',
    {
      title: 'Get a person',
      description:
        'Gets one person. Increase depth to include relations such as company, opportunities, tasks, notes, and sequence enrollments.',
      inputSchema: z.object({
        id: recordIdSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ id, depth, response_format }) =>
      runTool(
        () => records.get({ object: STANDARD_OBJECTS.people, id, depth }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_set_person_company',
    {
      title: 'Set a person company',
      description:
        'Links a person to a company, or unlinks them when company_id is null.',
      inputSchema: z.object({
        person_id: recordIdSchema,
        company_id: z.string().nullable(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ person_id, company_id, response_format }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.people,
            id: person_id,
            data: { companyId: company_id },
          }),
        response_format,
      ),
  );
};

export const peopleToolsTesting = { personData };
