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
import { buildCurrencyValue, compactRecord } from './tool-data-builders.js';

const opportunityFieldsSchema = z.object({
  name: z.string().optional(),
  amount: z.number().nonnegative().optional(),
  currency_code: z.string().length(3).default('USD').optional(),
  close_date: z.string().datetime().nullable().optional(),
  stage: z.string().optional(),
  company_id: z.string().nullable().optional(),
  point_of_contact_id: z.string().nullable().optional(),
  owner_id: z.string().nullable().optional(),
});

const opportunityData = (
  value: z.infer<typeof opportunityFieldsSchema>,
): Record<string, unknown> =>
  compactRecord([
    ['name', value.name],
    [
      'amount',
      value.amount === undefined
        ? undefined
        : buildCurrencyValue(value.amount, value.currency_code ?? 'USD'),
    ],
    ['closeDate', value.close_date],
    ['stage', value.stage],
    ['companyId', value.company_id],
    ['pointOfContactId', value.point_of_contact_id],
    ['ownerId', value.owner_id],
  ]);

export const registerOpportunityTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_create_opportunity',
    {
      title: 'Create an opportunity',
      description:
        'Creates an opportunity and validates its live stage enum through metadata.',
      inputSchema: opportunityFieldsSchema.extend({
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
            object: STANDARD_OBJECTS.opportunities,
            data: opportunityData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_opportunity',
    {
      title: 'Update an opportunity',
      description: 'Partially updates common editable opportunity fields.',
      inputSchema: opportunityFieldsSchema.extend({
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
            object: STANDARD_OBJECTS.opportunities,
            id,
            data: opportunityData(input),
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_set_opportunity_stage',
    {
      title: 'Move an opportunity stage',
      description:
        'Moves an opportunity across the pipeline after validating the stage against live metadata.',
      inputSchema: z.object({
        opportunity_id: recordIdSchema,
        stage: z.string().min(1),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ opportunity_id, stage, response_format }) =>
      runTool(
        () =>
          records.update({
            object: STANDARD_OBJECTS.opportunities,
            id: opportunity_id,
            data: { stage },
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_find_opportunities',
    {
      title: 'Find opportunities',
      description:
        'Finds opportunities by name, stage, owner, company, close-date range, and amount range.',
      inputSchema: z.object({
        search: z.string().optional(),
        stage: z.string().optional(),
        owner_id: z.string().optional(),
        company_id: z.string().optional(),
        close_date_from: z.string().datetime().optional(),
        close_date_to: z.string().datetime().optional(),
        min_amount: z.number().nonnegative().optional(),
        max_amount: z.number().nonnegative().optional(),
        limit: listLimitSchema,
        depth: depthSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({
      search,
      stage,
      owner_id,
      company_id,
      close_date_from,
      close_date_to,
      min_amount,
      max_amount,
      limit,
      depth,
      response_format,
    }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.opportunities,
            filter: combineFilters('and', [
              textSearchFilter(['name'], search),
              stage === undefined
                ? undefined
                : filterCondition('stage', 'eq', stage),
              owner_id === undefined
                ? undefined
                : filterCondition('ownerId', 'eq', owner_id),
              company_id === undefined
                ? undefined
                : filterCondition('companyId', 'eq', company_id),
              close_date_from === undefined
                ? undefined
                : filterCondition('closeDate', 'gte', close_date_from),
              close_date_to === undefined
                ? undefined
                : filterCondition('closeDate', 'lte', close_date_to),
              min_amount === undefined
                ? undefined
                : filterCondition(
                    'amount.amountMicros',
                    'gte',
                    Math.round(min_amount * 1_000_000),
                  ),
              max_amount === undefined
                ? undefined
                : filterCondition(
                    'amount.amountMicros',
                    'lte',
                    Math.round(max_amount * 1_000_000),
                  ),
            ]),
            limit,
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_opportunity',
    {
      title: 'Get an opportunity',
      description:
        'Gets one opportunity with optional relation depth for company, contact, owner, tasks, and notes.',
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
        () =>
          records.get({
            object: STANDARD_OBJECTS.opportunities,
            id,
            depth,
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_pipeline',
    {
      title: 'Get opportunity pipeline',
      description:
        'Returns opportunity groups by stage with count and amount sum for a compact Kanban/pipeline summary.',
      inputSchema: z.object({
        filter: z.string().optional(),
        include_records: z.boolean().default(false),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ filter, include_records, response_format }) =>
      runTool(
        () =>
          records.groupBy({
            object: STANDARD_OBJECTS.opportunities,
            groupBy: [{ stage: true }],
            aggregate: ['countNotEmptyId', 'sumAmountAmountMicros'],
            filter,
            includeRecords: include_records,
          }),
        response_format,
      ),
  );
};

export const opportunitiesToolsTesting = { opportunityData };
