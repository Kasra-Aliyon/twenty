import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { STANDARD_OBJECTS } from '../constants.js';
import { runTool } from '../formatting/format-tool-result.js';
import {
  CONFIRMATION_DESCRIPTION,
  listLimitSchema,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import { RecordsService } from '../services/records.service.js';
import type { ToolDependencies } from '../types.js';
import { compactRecord } from './tool-data-builders.js';

const WIDGET_FIELDS = `
  id
  title
  type
  objectMetadataId
  pageLayoutTabId
  isActive
  conditionalDisplay
  conditionalAvailabilityExpression
  gridPosition {
    row
    column
    rowSpan
    columnSpan
  }
  configuration {
    __typename
    ... on AggregateChartConfiguration {
      configurationType
      aggregateFieldMetadataId
      aggregateOperation
      label
      displayDataLabel
      numberFormat
      prefix
      suffix
      description
      filter
      timezone
      firstDayOfTheWeek
      ratioAggregateConfig {
        fieldMetadataId
        optionValue
      }
    }
    ... on BarChartConfiguration {
      configurationType
      aggregateFieldMetadataId
      aggregateOperation
      primaryAxisGroupByFieldMetadataId
      primaryAxisGroupBySubFieldName
      primaryAxisDateGranularity
      primaryAxisOrderBy
      primaryAxisManualSortOrder
      secondaryAxisGroupByFieldMetadataId
      secondaryAxisGroupBySubFieldName
      secondaryAxisGroupByDateGranularity
      secondaryAxisOrderBy
      secondaryAxisManualSortOrder
      omitNullValues
      axisNameDisplay
      displayDataLabel
      displayLegend
      rangeMin
      rangeMax
      color
      description
      filter
      groupMode
      layout
      isCumulative
      splitMultiValueFields
      timezone
      firstDayOfTheWeek
    }
    ... on LineChartConfiguration {
      configurationType
      aggregateFieldMetadataId
      aggregateOperation
      primaryAxisGroupByFieldMetadataId
      primaryAxisGroupBySubFieldName
      primaryAxisDateGranularity
      primaryAxisOrderBy
      primaryAxisManualSortOrder
      secondaryAxisGroupByFieldMetadataId
      secondaryAxisGroupBySubFieldName
      secondaryAxisGroupByDateGranularity
      secondaryAxisOrderBy
      secondaryAxisManualSortOrder
      omitNullValues
      axisNameDisplay
      displayDataLabel
      displayLegend
      rangeMin
      rangeMax
      color
      description
      filter
      isStacked
      isCumulative
      splitMultiValueFields
      timezone
      firstDayOfTheWeek
    }
    ... on PieChartConfiguration {
      configurationType
      groupByFieldMetadataId
      groupBySubFieldName
      dateGranularity
      aggregateFieldMetadataId
      aggregateOperation
      orderBy
      manualSortOrder
      displayDataLabel
      showCenterMetric
      displayLegend
      hideEmptyCategory
      splitMultiValueFields
      color
      description
      filter
      timezone
      firstDayOfTheWeek
    }
    ... on IframeConfiguration {
      configurationType
      url
    }
    ... on StandaloneRichTextConfiguration {
      configurationType
      body {
        blocknote
        markdown
      }
    }
    ... on RecordTableConfiguration {
      configurationType
      viewId
    }
    ... on ViewConfiguration {
      configurationType
    }
  }
`;

const PAGE_LAYOUT_FIELDS = `
  id
  name
  type
  objectMetadataId
  universalIdentifier
  defaultTabToFocusOnMobileAndSidePanelId
  createdAt
  updatedAt
  tabs {
    id
    title
    icon
    position
    layoutMode
    pageLayoutId
    isActive
    widgets {
      ${WIDGET_FIELDS}
    }
  }
`;

const GET_PAGE_LAYOUT_QUERY = `
  query TwentyMcpGetPageLayout($id: String!) {
    getPageLayout(id: $id) {
      ${PAGE_LAYOUT_FIELDS}
    }
  }
`;

const UPDATE_PAGE_LAYOUT_MUTATION = `
  mutation TwentyMcpUpdatePageLayout(
    $id: String!
    $input: UpdatePageLayoutInput!
  ) {
    updatePageLayout(id: $id, input: $input) {
      id
      name
      type
      objectMetadataId
      updatedAt
    }
  }
`;

const DUPLICATE_DASHBOARD_MUTATION = `
  mutation TwentyMcpDuplicateDashboard($id: UUID!) {
    duplicateDashboard(id: $id) {
      id
      title
      pageLayoutId
      position
      createdAt
      updatedAt
    }
  }
`;

const CREATE_TAB_MUTATION = `
  mutation TwentyMcpCreatePageLayoutTab(
    $input: CreatePageLayoutTabInput!
  ) {
    createPageLayoutTab(input: $input) {
      id
      title
      icon
      position
      layoutMode
      pageLayoutId
      isActive
    }
  }
`;

const UPDATE_TAB_MUTATION = `
  mutation TwentyMcpUpdatePageLayoutTab(
    $id: String!
    $input: UpdatePageLayoutTabInput!
  ) {
    updatePageLayoutTab(id: $id, input: $input) {
      id
      title
      icon
      position
      layoutMode
      pageLayoutId
      isActive
    }
  }
`;

const DELETE_TAB_MUTATION = `
  mutation TwentyMcpDeletePageLayoutTab($id: String!) {
    destroyPageLayoutTab(id: $id)
  }
`;

const CREATE_WIDGET_MUTATION = `
  mutation TwentyMcpCreatePageLayoutWidget(
    $input: CreatePageLayoutWidgetInput!
  ) {
    createPageLayoutWidget(input: $input) {
      ${WIDGET_FIELDS}
    }
  }
`;

const UPDATE_WIDGET_MUTATION = `
  mutation TwentyMcpUpdatePageLayoutWidget(
    $id: String!
    $input: UpdatePageLayoutWidgetInput!
  ) {
    updatePageLayoutWidget(id: $id, input: $input) {
      ${WIDGET_FIELDS}
    }
  }
`;

const DELETE_WIDGET_MUTATION = `
  mutation TwentyMcpDeletePageLayoutWidget($id: String!) {
    destroyPageLayoutWidget(id: $id)
  }
`;

const gridPositionSchema = z
  .object({
    row: z.number().int().nonnegative(),
    column: z.number().int().min(0).max(11),
    rowSpan: z.number().int().positive(),
    columnSpan: z.number().int().min(1).max(12),
  })
  .refine(
    ({ column, columnSpan }) => column + columnSpan <= 12,
    'column + columnSpan must not exceed the 12-column grid',
  );

const widgetConfigurationSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Twenty widget configuration. configurationType must match the widget, such as AGGREGATE_CHART, BAR_CHART, LINE_CHART, PIE_CHART, IFRAME, STANDALONE_RICH_TEXT, or RECORD_TABLE.',
  );

const widgetTypeSchema = z.enum([
  'GRAPH',
  'IFRAME',
  'STANDALONE_RICH_TEXT',
  'RECORD_TABLE',
  'VIEW',
]);

const createWidgetSchema = z.object({
  title: z.string().min(1),
  type: widgetTypeSchema,
  grid_position: gridPositionSchema,
  object_metadata_id: recordIdSchema.nullable().optional(),
  configuration: widgetConfigurationSchema,
  conditional_display: z.record(z.string(), z.unknown()).nullable().optional(),
  conditional_availability_expression: z.string().nullable().optional(),
});

type CreateWidgetInput = z.infer<typeof createWidgetSchema>;

const asRecord = (
  value: unknown,
  description: string,
): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Twenty returned an invalid ${description}.`);
  }

  return value as Record<string, unknown>;
};

const getRequiredString = (
  value: Record<string, unknown>,
  field: string,
  description: string,
): string => {
  const fieldValue = value[field];

  if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
    throw new Error(`${description} is missing ${field}.`);
  }

  return fieldValue;
};

const widgetInput = (
  pageLayoutTabId: string,
  widget: CreateWidgetInput,
): Record<string, unknown> => ({
  pageLayoutTabId,
  title: widget.title,
  type: widget.type,
  gridPosition: widget.grid_position,
  ...(widget.object_metadata_id === undefined
    ? {}
    : { objectMetadataId: widget.object_metadata_id }),
  configuration: widget.configuration,
  ...(widget.conditional_display === undefined
    ? {}
    : { conditionalDisplay: widget.conditional_display }),
  ...(widget.conditional_availability_expression === undefined
    ? {}
    : {
        conditionalAvailabilityExpression:
          widget.conditional_availability_expression,
      }),
});

const getPageLayout = async (
  dependencies: ToolDependencies,
  pageLayoutId: string,
): Promise<unknown> => {
  const result = await dependencies.client.graphql<{
    getPageLayout: unknown;
  }>(GET_PAGE_LAYOUT_QUERY, { id: pageLayoutId }, { endpoint: 'metadata' });

  return result.getPageLayout;
};

const createWidget = async (
  dependencies: ToolDependencies,
  pageLayoutTabId: string,
  widget: CreateWidgetInput,
): Promise<unknown> => {
  const result = await dependencies.client.graphql<{
    createPageLayoutWidget: unknown;
  }>(
    CREATE_WIDGET_MUTATION,
    { input: widgetInput(pageLayoutTabId, widget) },
    { endpoint: 'metadata' },
  );

  return result.createPageLayoutWidget;
};

export const registerDashboardTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  const records = new RecordsService(
    dependencies.client,
    dependencies.metadata,
  );

  server.registerTool(
    'twenty_list_dashboards',
    {
      title: 'List dashboards',
      description: 'Lists dashboard records and their page-layout IDs.',
      inputSchema: z.object({
        limit: listLimitSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit, response_format }) =>
      runTool(
        () =>
          records.list({
            object: STANDARD_OBJECTS.dashboards,
            limit,
            orderBy: 'position[AscNullsFirst]',
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_get_dashboard',
    {
      title: 'Get a complete dashboard',
      description:
        'Gets a dashboard record with its complete page layout, ordered tabs, widget positions, and chart/widget configuration.',
      inputSchema: z.object({
        dashboard_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ dashboard_id, response_format }) =>
      runTool(async () => {
        const dashboard = asRecord(
          await records.get({
            object: STANDARD_OBJECTS.dashboards,
            id: dashboard_id,
          }),
          'dashboard',
        );
        const pageLayoutId = getRequiredString(
          dashboard,
          'pageLayoutId',
          'Dashboard',
        );

        return {
          dashboard,
          layout: await getPageLayout(dependencies, pageLayoutId),
        };
      }, response_format),
  );

  server.registerTool(
    'twenty_create_dashboard',
    {
      title: 'Create a complete dashboard',
      description:
        'Creates a dashboard with its generated page layout, first tab, and optional widgets. Graph widgets use a 12-column grid and field metadata UUIDs from twenty_describe_object.',
      inputSchema: z.object({
        title: z.string().min(1),
        tab_title: z.string().min(1).default('Main'),
        widgets: z.array(createWidgetSchema).max(50).default([]),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ title, tab_title, widgets, response_format }) =>
      runTool(async () => {
        const dashboard = asRecord(
          await records.create({
            object: STANDARD_OBJECTS.dashboards,
            data: { title },
          }),
          'dashboard',
        );
        const pageLayoutId = getRequiredString(
          dashboard,
          'pageLayoutId',
          'Dashboard',
        );
        const layout = asRecord(
          await getPageLayout(dependencies, pageLayoutId),
          'page layout',
        );
        const tabs = layout.tabs;

        if (!Array.isArray(tabs) || tabs.length === 0) {
          throw new Error('The new dashboard page layout has no default tab.');
        }

        const firstTab = asRecord(tabs[0], 'dashboard tab');
        const pageLayoutTabId = getRequiredString(
          firstTab,
          'id',
          'Dashboard tab',
        );

        if (firstTab.title !== tab_title) {
          await dependencies.client.graphql(
            UPDATE_TAB_MUTATION,
            { id: pageLayoutTabId, input: { title: tab_title } },
            { endpoint: 'metadata' },
          );
        }

        const widgetResults = [];

        for (const widget of widgets) {
          try {
            widgetResults.push({
              status: 'fulfilled',
              widget: await createWidget(dependencies, pageLayoutTabId, widget),
            });
          } catch (error) {
            widgetResults.push({
              status: 'rejected',
              title: widget.title,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return {
          dashboard,
          page_layout_id: pageLayoutId,
          first_tab_id: pageLayoutTabId,
          widgets: widgetResults,
        };
      }, response_format),
  );

  server.registerTool(
    'twenty_duplicate_dashboard',
    {
      title: 'Duplicate a dashboard',
      description:
        'Duplicates a dashboard together with its page layout, tabs, widgets, and widget views.',
      inputSchema: z.object({
        dashboard_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ dashboard_id, response_format }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          duplicateDashboard: unknown;
        }>(
          DUPLICATE_DASHBOARD_MUTATION,
          { id: dashboard_id },
          { endpoint: 'metadata' },
        );

        return result.duplicateDashboard;
      }, response_format),
  );

  server.registerTool(
    'twenty_update_dashboard',
    {
      title: 'Update a dashboard and its layout',
      description:
        'Updates the dashboard title and/or the associated page-layout name.',
      inputSchema: z
        .object({
          dashboard_id: recordIdSchema,
          title: z.string().min(1).optional(),
          layout_name: z.string().min(1).optional(),
          response_format: responseFormatSchema,
        })
        .refine(
          ({ title, layout_name }) =>
            title !== undefined || layout_name !== undefined,
          'Provide title or layout_name.',
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ dashboard_id, title, layout_name, response_format }) =>
      runTool(async () => {
        const currentDashboard = asRecord(
          await records.get({
            object: STANDARD_OBJECTS.dashboards,
            id: dashboard_id,
          }),
          'dashboard',
        );
        const pageLayoutId = getRequiredString(
          currentDashboard,
          'pageLayoutId',
          'Dashboard',
        );
        const dashboard =
          title === undefined
            ? currentDashboard
            : await records.update({
                object: STANDARD_OBJECTS.dashboards,
                id: dashboard_id,
                data: { title },
              });
        let layout: unknown;

        if (layout_name !== undefined) {
          const result = await dependencies.client.graphql<{
            updatePageLayout: unknown;
          }>(
            UPDATE_PAGE_LAYOUT_MUTATION,
            { id: pageLayoutId, input: { name: layout_name } },
            { endpoint: 'metadata' },
          );

          layout = result.updatePageLayout;
        }

        return { dashboard, ...(layout === undefined ? {} : { layout }) };
      }, response_format),
  );

  server.registerTool(
    'twenty_add_dashboard_tab',
    {
      title: 'Add a dashboard tab',
      description: 'Adds a tab to a dashboard page layout.',
      inputSchema: z.object({
        page_layout_id: recordIdSchema,
        title: z.string().min(1),
        position: z.number().optional(),
        layout_mode: z
          .enum(['GRID', 'VERTICAL_LIST', 'CANVAS'])
          .default('GRID'),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ page_layout_id, title, position, layout_mode, response_format }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          createPageLayoutTab: unknown;
        }>(
          CREATE_TAB_MUTATION,
          {
            input: {
              pageLayoutId: page_layout_id,
              title,
              layoutMode: layout_mode,
              ...(position === undefined ? {} : { position }),
            },
          },
          { endpoint: 'metadata' },
        );

        return result.createPageLayoutTab;
      }, response_format),
  );

  server.registerTool(
    'twenty_update_dashboard_tab',
    {
      title: 'Update a dashboard tab',
      description: 'Updates a tab title, icon, order position, or layout mode.',
      inputSchema: z
        .object({
          tab_id: recordIdSchema,
          title: z.string().min(1).optional(),
          icon: z.string().nullable().optional(),
          position: z.number().optional(),
          layout_mode: z.enum(['GRID', 'VERTICAL_LIST', 'CANVAS']).optional(),
          response_format: responseFormatSchema,
        })
        .refine(
          ({ title, icon, position, layout_mode }) =>
            title !== undefined ||
            icon !== undefined ||
            position !== undefined ||
            layout_mode !== undefined,
          'Provide at least one tab update.',
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ tab_id, title, icon, position, layout_mode, response_format }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          updatePageLayoutTab: unknown;
        }>(
          UPDATE_TAB_MUTATION,
          {
            id: tab_id,
            input: compactRecord([
              ['title', title],
              ['icon', icon],
              ['position', position],
              ['layoutMode', layout_mode],
            ]),
          },
          { endpoint: 'metadata' },
        );

        return result.updatePageLayoutTab;
      }, response_format),
  );

  server.registerTool(
    'twenty_delete_dashboard_tab',
    {
      title: 'Delete a dashboard tab',
      description:
        'Permanently removes a dashboard tab and its widget layout. Twenty prevents invalid last-tab deletion.',
      inputSchema: z.object({
        tab_id: recordIdSchema,
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ tab_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Tab deletion not performed: confirm the tab and contained widgets first.',
          );
        }

        const result = await dependencies.client.graphql<{
          destroyPageLayoutTab: boolean;
        }>(DELETE_TAB_MUTATION, { id: tab_id }, { endpoint: 'metadata' });

        return { deleted: result.destroyPageLayoutTab, tab_id };
      }, response_format),
  );

  server.registerTool(
    'twenty_add_dashboard_widget',
    {
      title: 'Add a dashboard widget',
      description:
        'Adds a configured graph, iframe, rich-text, record-table, or view widget to a dashboard tab.',
      inputSchema: createWidgetSchema.extend({
        tab_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ tab_id, response_format, ...widget }) =>
      runTool(
        () => createWidget(dependencies, tab_id, widget),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_dashboard_widget',
    {
      title: 'Update a dashboard widget',
      description:
        'Updates a widget title, type, tab, grid position, object, chart configuration, or conditional display.',
      inputSchema: createWidgetSchema
        .partial()
        .extend({
          widget_id: recordIdSchema,
          tab_id: recordIdSchema.optional(),
          response_format: responseFormatSchema,
        })
        .refine(
          ({ widget_id: _widgetId, response_format: _format, ...updates }) =>
            Object.values(updates).some((value) => value !== undefined),
          'Provide at least one widget update.',
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({
      widget_id,
      tab_id,
      title,
      type,
      grid_position,
      object_metadata_id,
      configuration,
      conditional_display,
      conditional_availability_expression,
      response_format,
    }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          updatePageLayoutWidget: unknown;
        }>(
          UPDATE_WIDGET_MUTATION,
          {
            id: widget_id,
            input: compactRecord([
              ['pageLayoutTabId', tab_id],
              ['title', title],
              ['type', type],
              ['gridPosition', grid_position],
              ['objectMetadataId', object_metadata_id],
              ['configuration', configuration],
              ['conditionalDisplay', conditional_display],
              [
                'conditionalAvailabilityExpression',
                conditional_availability_expression,
              ],
            ]),
          },
          { endpoint: 'metadata' },
        );

        return result.updatePageLayoutWidget;
      }, response_format),
  );

  server.registerTool(
    'twenty_delete_dashboard_widget',
    {
      title: 'Delete a dashboard widget',
      description: 'Permanently removes a widget from its page layout.',
      inputSchema: z.object({
        widget_id: recordIdSchema,
        confirm: z.boolean().describe(CONFIRMATION_DESCRIPTION),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ widget_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'Widget deletion not performed: confirm the exact widget first.',
          );
        }

        const result = await dependencies.client.graphql<{
          destroyPageLayoutWidget: boolean;
        }>(DELETE_WIDGET_MUTATION, { id: widget_id }, { endpoint: 'metadata' });

        return { deleted: result.destroyPageLayoutWidget, widget_id };
      }, response_format),
  );
};

export const dashboardToolsTesting = {
  getRequiredString,
  widgetInput,
};
