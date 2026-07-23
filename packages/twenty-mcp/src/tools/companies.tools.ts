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
  buildAddressValue,
  buildCurrencyValue,
  buildLinksValue,
  compactRecord,
} from './tool-data-builders.js';

const addressSchema = z.object({
  street1: z.string().optional(),
  street2: z.string().optional(),
  city: z.string().optional(),
  postcode: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const companyFieldsSchema = z.object({
  name: z.string().optional(),
  domain_name: z.url().optional(),
  linkedin_url: z.url().optional(),
  industry: z.string().optional(),
  employees: z.number().int().nonnegative().optional(),
  annual_revenue: z.number().nonnegative().optional(),
  revenue_currency: z.string().length(3).default('USD').optional(),
  address: addressSchema.optional(),
  account_owner_id: z.string().nullable().optional(),
  keywords: z.array(z.string()).optional(),
  segments: z.array(z.string()).optional(),
  technologies: z.array(z.string()).optional(),
  account_status: z.string().optional(),
  company_type: z.string().optional(),
});

const companyData = (
  value: z.infer<typeof companyFieldsSchema>,
): Record<string, unknown> =>
  compactRecord([
    ['name', value.name],
    [
      'domainName',
      value.domain_name === undefined
        ? undefined
        : buildLinksValue(value.domain_name),
    ],
    [
      'linkedinLink',
      value.linkedin_url === undefined
        ? undefined
        : buildLinksValue(value.linkedin_url),
    ],
    ['industry', value.industry],
    ['employees', value.employees],
    [
      'annualRevenue',
      value.annual_revenue === undefined
        ? undefined
        : buildCurrencyValue(
            value.annual_revenue,
            value.revenue_currency ?? 'USD',
          ),
    ],
    [
      'address',
      value.address === undefined
        ? undefined
        : buildAddressValue(value.address),
    ],
    ['accountOwnerId', value.account_owner_id],
    ['keywords', value.keywords],
    ['segments', value.segments],
    ['technologies', value.technologies],
    ['accountStatus', value.account_status],
    ['companyType', value.company_type],
  ]);

export const registerCompanyTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_create_company',
    {
      title: 'Create a company',
      description:
        'Creates a company with normalized links, currency, and address composite values.',
      inputSchema: companyFieldsSchema.extend({
        name: z.string().min(1),
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ depth, response_format, ...input }) =>
      runTool(
        () =>
          records.create({
            object: STANDARD_OBJECTS.companies,
            data: companyData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_company',
    {
      title: 'Update a company',
      description: 'Partially updates common editable company fields.',
      inputSchema: companyFieldsSchema.extend({
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
            object: STANDARD_OBJECTS.companies,
            id,
            data: companyData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_find_companies',
    {
      title: 'Find companies',
      description:
        'Finds companies by name/industry text plus industry, size, status, and owner filters.',
      inputSchema: z.object({
        search: z.string().optional(),
        industry: z.string().optional(),
        min_employees: z.number().int().nonnegative().optional(),
        max_employees: z.number().int().nonnegative().optional(),
        account_status: z.string().optional(),
        owner_id: z.string().optional(),
        limit: listLimitSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      search,
      industry,
      min_employees,
      max_employees,
      account_status,
      owner_id,
      limit,
      depth,
      response_format,
    }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.companies,
            filter: combineFilters('and', [
              textSearchFilter(['name', 'industry'], search),
              industry === undefined
                ? undefined
                : filterCondition('industry', 'ilike', `%${industry}%`),
              min_employees === undefined
                ? undefined
                : filterCondition('employees', 'gte', min_employees),
              max_employees === undefined
                ? undefined
                : filterCondition('employees', 'lte', max_employees),
              account_status === undefined
                ? undefined
                : filterCondition('accountStatus', 'eq', account_status),
              owner_id === undefined
                ? undefined
                : filterCondition('accountOwnerId', 'eq', owner_id),
            ]),
            limit,
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_company',
    {
      title: 'Get a company',
      description:
        'Gets one company. Increase depth to include people, opportunities, tasks, and notes.',
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
        () => records.get({ object: STANDARD_OBJECTS.companies, id, depth }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_set_company_owner',
    {
      title: 'Set company owner',
      description:
        'Assigns a company account owner, or clears the owner with null.',
      inputSchema: z.object({
        company_id: recordIdSchema,
        owner_id: z.string().nullable(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ company_id, owner_id, response_format }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.companies,
            id: company_id,
            data: { accountOwnerId: owner_id },
          }),
        response_format,
      ),
  );
};

export const companiesToolsTesting = { companyData };
