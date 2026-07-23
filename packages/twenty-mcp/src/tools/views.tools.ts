import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runTool } from '../formatting/format-tool-result.js';
import {
  CONFIRMATION_DESCRIPTION,
  recordIdSchema,
  responseFormatSchema,
  TOOL_OUTPUT_SCHEMA,
} from '../schemas/common.schemas.js';
import type { ToolDependencies } from '../types.js';
import { compactRecord } from './tool-data-builders.js';

const VIEW_FIELDS = `
  id
  name
  objectMetadataId
  recordListId
  type
  key
  icon
  position
  isCompact
  openRecordIn
  kanbanAggregateOperation
  kanbanAggregateOperationFieldMetadataId
  mainGroupByFieldMetadataId
  shouldHideEmptyGroups
  kanbanColumnWidth
  anyFieldFilterValue
  calendarFieldMetadataId
  calendarLayout
  visibility
  createdByUserWorkspaceId
  isActive
  viewFields {
    id
    fieldMetadataId
    viewId
    isVisible
    position
    size
    aggregateOperation
    viewFieldGroupId
  }
  viewFieldGroups {
    id
    name
    position
    isVisible
    viewId
    isActive
  }
  viewFilters {
    id
    fieldMetadataId
    operand
    value
    viewFilterGroupId
    positionInViewFilterGroup
    subFieldName
    relationTargetFieldMetadataId
    viewId
  }
  viewFilterGroups {
    id
    parentViewFilterGroupId
    logicalOperator
    positionInViewFilterGroup
    viewId
  }
  viewSorts {
    id
    fieldMetadataId
    direction
    subFieldName
    viewId
  }
  viewGroups {
    id
    isVisible
    fieldValue
    position
    viewId
  }
`;

const LIST_VIEWS_QUERY = `
  query TwentyMcpListViews(
    $objectMetadataId: String
    $viewTypes: [ViewType!]
  ) {
    getViews(
      objectMetadataId: $objectMetadataId
      viewTypes: $viewTypes
    ) {
      ${VIEW_FIELDS}
    }
  }
`;

const GET_VIEW_QUERY = `
  query TwentyMcpGetView($id: String!) {
    getView(id: $id) {
      ${VIEW_FIELDS}
    }
  }
`;

const CREATE_VIEW_MUTATION = `
  mutation TwentyMcpCreateView($input: CreateViewInput!) {
    createView(input: $input) {
      ${VIEW_FIELDS}
    }
  }
`;

const UPDATE_VIEW_MUTATION = `
  mutation TwentyMcpUpdateView(
    $id: String!
    $input: UpdateViewInput!
  ) {
    updateView(id: $id, input: $input) {
      ${VIEW_FIELDS}
    }
  }
`;

const DELETE_VIEW_MUTATION = `
  mutation TwentyMcpDeleteView($id: String!) {
    deleteView(id: $id)
  }
`;

const RESOLVE_VIEW_QUERY = `
  query TwentyMcpResolveView($id: String!) {
    resolveViewToQueryParams(id: $id)
  }
`;

const aggregateOperationSchema = z.enum([
  'AVG',
  'COUNT',
  'COUNT_EMPTY',
  'COUNT_FALSE',
  'COUNT_NOT_EMPTY',
  'COUNT_TRUE',
  'COUNT_UNIQUE_VALUES',
  'MAX',
  'MIN',
  'PERCENTAGE_EMPTY',
  'PERCENTAGE_NOT_EMPTY',
  'SUM',
]);

const viewTypeSchema = z.enum([
  'TABLE',
  'KANBAN',
  'CALENDAR',
  'TABLE_WIDGET',
  'FIELDS_WIDGET',
]);

const viewFilterOperandSchema = z.enum([
  'CONTAINS',
  'DOES_NOT_CONTAIN',
  'GREATER_THAN_OR_EQUAL',
  'IS',
  'IS_AFTER',
  'IS_BEFORE',
  'IS_EMPTY',
  'IS_IN_FUTURE',
  'IS_IN_PAST',
  'IS_NOT',
  'IS_NOT_EMPTY',
  'IS_NOT_NULL',
  'IS_RELATIVE',
  'IS_TODAY',
  'LESS_THAN_OR_EQUAL',
  'VECTOR_SEARCH',
]);

const createViewComponentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('FIELD'),
    field_metadata_id: recordIdSchema,
    is_visible: z.boolean().default(true),
    size: z.number().nonnegative().default(0),
    position: z.number().default(0),
    aggregate_operation: aggregateOperationSchema.optional(),
    view_field_group_id: recordIdSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal('FIELD_GROUP'),
    name: z.string().min(1),
    position: z.number().default(0),
    is_visible: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('FILTER'),
    field_metadata_id: recordIdSchema,
    operand: viewFilterOperandSchema.optional(),
    value: z.json(),
    view_filter_group_id: recordIdSchema.nullable().optional(),
    position_in_view_filter_group: z.number().nullable().optional(),
    sub_field_name: z.string().nullable().optional(),
    relation_target_field_metadata_id: recordIdSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal('FILTER_GROUP'),
    parent_view_filter_group_id: recordIdSchema.nullable().optional(),
    logical_operator: z.enum(['AND', 'OR', 'NOT']).default('AND'),
    position_in_view_filter_group: z.number().nullable().optional(),
  }),
  z.object({
    type: z.literal('SORT'),
    field_metadata_id: recordIdSchema,
    direction: z.enum(['ASC', 'DESC']).default('ASC'),
    sub_field_name: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('GROUP'),
    field_value: z.string(),
    is_visible: z.boolean().default(true),
    position: z.number().default(0),
  }),
]);

type ViewComponentType =
  | 'FIELD'
  | 'FIELD_GROUP'
  | 'FILTER'
  | 'FILTER_GROUP'
  | 'GROUP'
  | 'SORT';

type CreateViewComponent = z.infer<typeof createViewComponentSchema>;

type ComponentOperation = {
  fieldName: string;
  inputType: string;
  selection: string;
};

const COMPONENT_OPERATIONS: Record<
  ViewComponentType,
  {
    create: ComponentOperation;
    update: ComponentOperation;
    delete: ComponentOperation;
  }
> = {
  FIELD: {
    create: {
      fieldName: 'createViewField',
      inputType: 'CreateViewFieldInput!',
      selection:
        'id fieldMetadataId viewId isVisible position size aggregateOperation viewFieldGroupId',
    },
    update: {
      fieldName: 'updateViewField',
      inputType: 'UpdateViewFieldInput!',
      selection:
        'id fieldMetadataId viewId isVisible position size aggregateOperation viewFieldGroupId',
    },
    delete: {
      fieldName: 'deleteViewField',
      inputType: 'DeleteViewFieldInput!',
      selection: 'id deletedAt',
    },
  },
  FIELD_GROUP: {
    create: {
      fieldName: 'createViewFieldGroup',
      inputType: 'CreateViewFieldGroupInput!',
      selection: 'id name viewId position isVisible isActive',
    },
    update: {
      fieldName: 'updateViewFieldGroup',
      inputType: 'UpdateViewFieldGroupInput!',
      selection: 'id name viewId position isVisible isActive',
    },
    delete: {
      fieldName: 'deleteViewFieldGroup',
      inputType: 'DeleteViewFieldGroupInput!',
      selection: 'id deletedAt',
    },
  },
  FILTER: {
    create: {
      fieldName: 'createViewFilter',
      inputType: 'CreateViewFilterInput!',
      selection:
        'id fieldMetadataId operand value viewFilterGroupId positionInViewFilterGroup subFieldName relationTargetFieldMetadataId viewId',
    },
    update: {
      fieldName: 'updateViewFilter',
      inputType: 'UpdateViewFilterInput!',
      selection:
        'id fieldMetadataId operand value viewFilterGroupId positionInViewFilterGroup subFieldName relationTargetFieldMetadataId viewId',
    },
    delete: {
      fieldName: 'deleteViewFilter',
      inputType: 'DeleteViewFilterInput!',
      selection: 'id deletedAt',
    },
  },
  FILTER_GROUP: {
    create: {
      fieldName: 'createViewFilterGroup',
      inputType: 'CreateViewFilterGroupInput!',
      selection:
        'id parentViewFilterGroupId logicalOperator positionInViewFilterGroup viewId',
    },
    update: {
      fieldName: 'updateViewFilterGroup',
      inputType: 'UpdateViewFilterGroupInput!',
      selection:
        'id parentViewFilterGroupId logicalOperator positionInViewFilterGroup viewId',
    },
    delete: {
      fieldName: 'deleteViewFilterGroup',
      inputType: 'String!',
      selection: '',
    },
  },
  SORT: {
    create: {
      fieldName: 'createViewSort',
      inputType: 'CreateViewSortInput!',
      selection: 'id fieldMetadataId direction subFieldName viewId',
    },
    update: {
      fieldName: 'updateViewSort',
      inputType: 'UpdateViewSortInput!',
      selection: 'id fieldMetadataId direction subFieldName viewId',
    },
    delete: {
      fieldName: 'deleteViewSort',
      inputType: 'DeleteViewSortInput!',
      selection: '',
    },
  },
  GROUP: {
    create: {
      fieldName: 'createViewGroup',
      inputType: 'CreateViewGroupInput!',
      selection: 'id isVisible fieldValue position viewId',
    },
    update: {
      fieldName: 'updateViewGroup',
      inputType: 'UpdateViewGroupInput!',
      selection: 'id isVisible fieldValue position viewId',
    },
    delete: {
      fieldName: 'deleteViewGroup',
      inputType: 'DeleteViewGroupInput!',
      selection: 'id deletedAt',
    },
  },
};

const createComponentInput = (
  viewId: string,
  component: CreateViewComponent,
): Record<string, unknown> => {
  switch (component.type) {
    case 'FIELD':
      return compactRecord([
        ['viewId', viewId],
        ['fieldMetadataId', component.field_metadata_id],
        ['isVisible', component.is_visible],
        ['size', component.size],
        ['position', component.position],
        ['aggregateOperation', component.aggregate_operation],
        ['viewFieldGroupId', component.view_field_group_id],
      ]);
    case 'FIELD_GROUP':
      return {
        viewId,
        name: component.name,
        position: component.position,
        isVisible: component.is_visible,
      };
    case 'FILTER':
      return compactRecord([
        ['viewId', viewId],
        ['fieldMetadataId', component.field_metadata_id],
        ['operand', component.operand],
        ['value', component.value],
        ['viewFilterGroupId', component.view_filter_group_id],
        ['positionInViewFilterGroup', component.position_in_view_filter_group],
        ['subFieldName', component.sub_field_name],
        [
          'relationTargetFieldMetadataId',
          component.relation_target_field_metadata_id,
        ],
      ]);
    case 'FILTER_GROUP':
      return compactRecord([
        ['viewId', viewId],
        ['parentViewFilterGroupId', component.parent_view_filter_group_id],
        ['logicalOperator', component.logical_operator],
        ['positionInViewFilterGroup', component.position_in_view_filter_group],
      ]);
    case 'SORT':
      return compactRecord([
        ['viewId', viewId],
        ['fieldMetadataId', component.field_metadata_id],
        ['direction', component.direction],
        ['subFieldName', component.sub_field_name],
      ]);
    case 'GROUP':
      return {
        viewId,
        fieldValue: component.field_value,
        isVisible: component.is_visible,
        position: component.position,
      };
  }
};

const metadataToken = (dependencies: ToolDependencies): 'api' | 'user' =>
  dependencies.client.hasUserToken() ? 'user' : 'api';

const executeComponentMutation = async ({
  dependencies,
  input,
  operation,
  variables,
}: {
  dependencies: ToolDependencies;
  input?: Record<string, unknown>;
  operation: ComponentOperation;
  variables?: Record<string, unknown>;
}): Promise<unknown> => {
  const selection =
    operation.selection === '' ? '' : `{ ${operation.selection} }`;
  const query = `
    mutation TwentyMcpViewComponent($input: ${operation.inputType}) {
      ${operation.fieldName}(input: $input) ${selection}
    }
  `;
  const result = await dependencies.client.graphql<Record<string, unknown>>(
    query,
    variables ?? { input },
    { endpoint: 'metadata', token: metadataToken(dependencies) },
  );

  return result[operation.fieldName];
};

const updateViewComponentSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('FIELD'),
      id: recordIdSchema,
      is_visible: z.boolean().optional(),
      size: z.number().nonnegative().optional(),
      position: z.number().optional(),
      aggregate_operation: aggregateOperationSchema.nullable().optional(),
      view_field_group_id: recordIdSchema.nullable().optional(),
    }),
    z.object({
      type: z.literal('FIELD_GROUP'),
      id: recordIdSchema,
      name: z.string().min(1).optional(),
      position: z.number().optional(),
      is_visible: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('FILTER'),
      id: recordIdSchema,
      field_metadata_id: recordIdSchema.optional(),
      operand: viewFilterOperandSchema.optional(),
      value: z.json().optional(),
      view_filter_group_id: recordIdSchema.nullable().optional(),
      position_in_view_filter_group: z.number().nullable().optional(),
      sub_field_name: z.string().nullable().optional(),
      relation_target_field_metadata_id: recordIdSchema.nullable().optional(),
    }),
    z.object({
      type: z.literal('FILTER_GROUP'),
      id: recordIdSchema,
      parent_view_filter_group_id: recordIdSchema.nullable().optional(),
      logical_operator: z.enum(['AND', 'OR', 'NOT']).optional(),
      position_in_view_filter_group: z.number().nullable().optional(),
    }),
    z.object({
      type: z.literal('SORT'),
      id: recordIdSchema,
      direction: z.enum(['ASC', 'DESC']).optional(),
      sub_field_name: z.string().nullable().optional(),
    }),
    z.object({
      type: z.literal('GROUP'),
      id: recordIdSchema,
      field_value: z.string().optional(),
      is_visible: z.boolean().optional(),
      position: z.number().optional(),
    }),
  ])
  .refine(
    ({ id: _id, type: _type, ...updates }) =>
      Object.values(updates).some((value) => value !== undefined),
    'Provide at least one view component update.',
  );

type UpdateViewComponent = z.infer<typeof updateViewComponentSchema>;

const updateComponentInput = (
  component: UpdateViewComponent,
): Record<string, unknown> => {
  const { id } = component;
  let update: Record<string, unknown>;

  switch (component.type) {
    case 'FIELD':
      update = compactRecord([
        ['isVisible', component.is_visible],
        ['size', component.size],
        ['position', component.position],
        ['aggregateOperation', component.aggregate_operation],
        ['viewFieldGroupId', component.view_field_group_id],
      ]);
      break;
    case 'FIELD_GROUP':
      update = compactRecord([
        ['name', component.name],
        ['position', component.position],
        ['isVisible', component.is_visible],
      ]);
      break;
    case 'FILTER':
      update = compactRecord([
        ['fieldMetadataId', component.field_metadata_id],
        ['operand', component.operand],
        ['value', component.value],
        ['viewFilterGroupId', component.view_filter_group_id],
        ['positionInViewFilterGroup', component.position_in_view_filter_group],
        ['subFieldName', component.sub_field_name],
        [
          'relationTargetFieldMetadataId',
          component.relation_target_field_metadata_id,
        ],
      ]);
      break;
    case 'FILTER_GROUP':
      return compactRecord([
        ['parentViewFilterGroupId', component.parent_view_filter_group_id],
        ['logicalOperator', component.logical_operator],
        ['positionInViewFilterGroup', component.position_in_view_filter_group],
      ]);
    case 'SORT':
      update = compactRecord([
        ['direction', component.direction],
        ['subFieldName', component.sub_field_name],
      ]);
      break;
    case 'GROUP':
      update = compactRecord([
        ['fieldValue', component.field_value],
        ['isVisible', component.is_visible],
        ['position', component.position],
      ]);
      break;
  }

  return { id, update };
};

export const registerViewTools = (
  server: McpServer,
  dependencies: ToolDependencies,
): void => {
  server.registerTool(
    'twenty_list_views',
    {
      title: 'List saved views',
      description:
        'Lists saved views with complete field, filter, filter-group, sort, and kanban-group configuration.',
      inputSchema: z.object({
        object: z.string().min(1).optional(),
        view_types: z.array(viewTypeSchema).max(5).optional(),
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ object, view_types, response_format }) =>
      runTool(async () => {
        const objectMetadataId =
          object === undefined
            ? undefined
            : (await dependencies.metadata.getObject(object)).id;
        const result = await dependencies.client.graphql<{
          getViews: unknown[];
        }>(
          LIST_VIEWS_QUERY,
          {
            ...(objectMetadataId === undefined ? {} : { objectMetadataId }),
            ...(view_types === undefined ? {} : { viewTypes: view_types }),
          },
          { endpoint: 'metadata', token: metadataToken(dependencies) },
        );

        return result.getViews;
      }, response_format),
  );

  server.registerTool(
    'twenty_get_view',
    {
      title: 'Get a saved view',
      description:
        'Gets one saved view with its columns, field groups, filters, filter groups, sorts, and kanban groups.',
      inputSchema: z.object({
        view_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ view_id, response_format }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{ getView: unknown }>(
          GET_VIEW_QUERY,
          { id: view_id },
          { endpoint: 'metadata', token: metadataToken(dependencies) },
        );

        return result.getView;
      }, response_format),
  );

  server.registerTool(
    'twenty_create_view',
    {
      title: 'Create a saved view',
      description:
        'Creates a table, kanban, calendar, or widget view. Use twenty_describe_object for object and field metadata IDs.',
      inputSchema: z
        .object({
          name: z.string().min(1),
          object: z.string().min(1),
          type: viewTypeSchema.default('TABLE'),
          icon: z.string().default('IconTable'),
          position: z.number().default(0),
          visibility: z.enum(['WORKSPACE', 'UNLISTED']).default('WORKSPACE'),
          is_compact: z.boolean().default(false),
          open_record_in: z
            .enum(['SIDE_PANEL', 'RECORD_PAGE'])
            .default('SIDE_PANEL'),
          main_group_by_field_metadata_id: recordIdSchema.optional(),
          kanban_aggregate_operation: aggregateOperationSchema.optional(),
          kanban_aggregate_operation_field_metadata_id:
            recordIdSchema.optional(),
          should_hide_empty_groups: z.boolean().default(false),
          kanban_column_width: z.number().int().min(150).max(400).optional(),
          calendar_field_metadata_id: recordIdSchema.optional(),
          calendar_layout: z.enum(['DAY', 'WEEK', 'MONTH']).optional(),
          response_format: responseFormatSchema,
        })
        .refine(
          ({ type, main_group_by_field_metadata_id }) =>
            type !== 'KANBAN' || main_group_by_field_metadata_id !== undefined,
          'KANBAN views require main_group_by_field_metadata_id.',
        )
        .refine(
          ({ type, calendar_field_metadata_id, calendar_layout }) =>
            type !== 'CALENDAR' ||
            (calendar_field_metadata_id !== undefined &&
              calendar_layout !== undefined),
          'CALENDAR views require calendar_field_metadata_id and calendar_layout.',
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({
      name,
      object,
      type,
      icon,
      position,
      visibility,
      is_compact,
      open_record_in,
      main_group_by_field_metadata_id,
      kanban_aggregate_operation,
      kanban_aggregate_operation_field_metadata_id,
      should_hide_empty_groups,
      kanban_column_width,
      calendar_field_metadata_id,
      calendar_layout,
      response_format,
    }) =>
      runTool(async () => {
        const objectMetadata = await dependencies.metadata.getObject(object);
        const result = await dependencies.client.graphql<{
          createView: unknown;
        }>(
          CREATE_VIEW_MUTATION,
          {
            input: compactRecord([
              ['name', name],
              ['objectMetadataId', objectMetadata.id],
              ['type', type],
              ['icon', icon],
              ['position', position],
              ['visibility', visibility],
              ['isCompact', is_compact],
              ['openRecordIn', open_record_in],
              ['mainGroupByFieldMetadataId', main_group_by_field_metadata_id],
              ['kanbanAggregateOperation', kanban_aggregate_operation],
              [
                'kanbanAggregateOperationFieldMetadataId',
                kanban_aggregate_operation_field_metadata_id,
              ],
              ['shouldHideEmptyGroups', should_hide_empty_groups],
              ['kanbanColumnWidth', kanban_column_width],
              ['calendarFieldMetadataId', calendar_field_metadata_id],
              ['calendarLayout', calendar_layout],
            ]),
          },
          { endpoint: 'metadata', token: metadataToken(dependencies) },
        );

        return result.createView;
      }, response_format),
  );

  server.registerTool(
    'twenty_update_view',
    {
      title: 'Update a saved view',
      description:
        'Updates view identity, display, kanban grouping, calendar grouping, or aggregate configuration.',
      inputSchema: z
        .object({
          view_id: recordIdSchema,
          name: z.string().min(1).optional(),
          type: viewTypeSchema.optional(),
          icon: z.string().optional(),
          position: z.number().optional(),
          visibility: z.enum(['WORKSPACE', 'UNLISTED']).optional(),
          is_compact: z.boolean().optional(),
          open_record_in: z.enum(['SIDE_PANEL', 'RECORD_PAGE']).optional(),
          main_group_by_field_metadata_id: recordIdSchema.nullable().optional(),
          kanban_aggregate_operation: aggregateOperationSchema.optional(),
          kanban_aggregate_operation_field_metadata_id: recordIdSchema
            .nullable()
            .optional(),
          should_hide_empty_groups: z.boolean().optional(),
          kanban_column_width: z
            .number()
            .int()
            .min(150)
            .max(400)
            .nullable()
            .optional(),
          calendar_field_metadata_id: recordIdSchema.nullable().optional(),
          calendar_layout: z.enum(['DAY', 'WEEK', 'MONTH']).optional(),
          any_field_filter_value: z.string().optional(),
          response_format: responseFormatSchema,
        })
        .refine(
          ({ view_id: _viewId, response_format: _format, ...updates }) =>
            Object.values(updates).some((value) => value !== undefined),
          'Provide at least one view update.',
        ),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({
      view_id,
      name,
      type,
      icon,
      position,
      visibility,
      is_compact,
      open_record_in,
      main_group_by_field_metadata_id,
      kanban_aggregate_operation,
      kanban_aggregate_operation_field_metadata_id,
      should_hide_empty_groups,
      kanban_column_width,
      calendar_field_metadata_id,
      calendar_layout,
      any_field_filter_value,
      response_format,
    }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          updateView: unknown;
        }>(
          UPDATE_VIEW_MUTATION,
          {
            id: view_id,
            input: compactRecord([
              ['name', name],
              ['type', type],
              ['icon', icon],
              ['position', position],
              ['visibility', visibility],
              ['isCompact', is_compact],
              ['openRecordIn', open_record_in],
              ['mainGroupByFieldMetadataId', main_group_by_field_metadata_id],
              ['kanbanAggregateOperation', kanban_aggregate_operation],
              [
                'kanbanAggregateOperationFieldMetadataId',
                kanban_aggregate_operation_field_metadata_id,
              ],
              ['shouldHideEmptyGroups', should_hide_empty_groups],
              ['kanbanColumnWidth', kanban_column_width],
              ['calendarFieldMetadataId', calendar_field_metadata_id],
              ['calendarLayout', calendar_layout],
              ['anyFieldFilterValue', any_field_filter_value],
            ]),
          },
          { endpoint: 'metadata', token: metadataToken(dependencies) },
        );

        return result.updateView;
      }, response_format),
  );

  server.registerTool(
    'twenty_delete_view',
    {
      title: 'Delete a saved view',
      description:
        'Soft-deletes a saved view and its view configuration. Requires explicit confirmation.',
      inputSchema: z.object({
        view_id: recordIdSchema,
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
    async ({ view_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'View deletion not performed: confirm the exact view first.',
          );
        }

        const result = await dependencies.client.graphql<{
          deleteView: boolean;
        }>(
          DELETE_VIEW_MUTATION,
          { id: view_id },
          { endpoint: 'metadata', token: metadataToken(dependencies) },
        );

        return { deleted: result.deleteView, view_id };
      }, response_format),
  );

  server.registerTool(
    'twenty_create_view_component',
    {
      title: 'Add view configuration',
      description:
        'Adds a column, field group, filter, nested filter group, sort, or kanban group to a saved view.',
      inputSchema: z.object({
        view_id: recordIdSchema,
        component: createViewComponentSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ view_id, component, response_format }) =>
      runTool(
        () =>
          executeComponentMutation({
            dependencies,
            operation: COMPONENT_OPERATIONS[component.type].create,
            input: createComponentInput(view_id, component),
          }),
        response_format,
      ),
  );

  server.registerTool(
    'twenty_update_view_component',
    {
      title: 'Update view configuration',
      description:
        'Updates a view column, field group, filter, filter group, sort, or kanban group.',
      inputSchema: z.object({
        component: updateViewComponentSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ component, response_format }) =>
      runTool(async () => {
        const operation = COMPONENT_OPERATIONS[component.type].update;

        if (component.type === 'FILTER_GROUP') {
          const { id } = component;
          const result = await dependencies.client.graphql<
            Record<string, unknown>
          >(
            `
                mutation TwentyMcpUpdateViewFilterGroup(
                  $id: String!
                  $input: UpdateViewFilterGroupInput!
                ) {
                  updateViewFilterGroup(id: $id, input: $input) {
                    ${operation.selection}
                  }
                }
              `,
            { id, input: updateComponentInput(component) },
            {
              endpoint: 'metadata',
              token: metadataToken(dependencies),
            },
          );

          return result.updateViewFilterGroup;
        }

        return executeComponentMutation({
          dependencies,
          operation,
          input: updateComponentInput(component),
        });
      }, response_format),
  );

  server.registerTool(
    'twenty_delete_view_component',
    {
      title: 'Delete view configuration',
      description:
        'Soft-deletes a column, field group, filter, filter group, sort, or kanban group from a view.',
      inputSchema: z.object({
        component_type: z.enum([
          'FIELD',
          'FIELD_GROUP',
          'FILTER',
          'FILTER_GROUP',
          'SORT',
          'GROUP',
        ]),
        component_id: recordIdSchema,
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
    async ({ component_type, component_id, confirm, response_format }) =>
      runTool(async () => {
        if (!confirm) {
          throw new Error(
            'View component deletion not performed: confirm the exact component first.',
          );
        }

        const operation = COMPONENT_OPERATIONS[component_type].delete;

        if (component_type === 'FILTER_GROUP') {
          const result = await dependencies.client.graphql<
            Record<string, unknown>
          >(
            `
                mutation TwentyMcpDeleteViewFilterGroup($id: String!) {
                  deleteViewFilterGroup(id: $id)
                }
              `,
            { id: component_id },
            {
              endpoint: 'metadata',
              token: metadataToken(dependencies),
            },
          );

          return {
            deleted: result.deleteViewFilterGroup,
            component_id,
            component_type,
          };
        }

        const deleted = await executeComponentMutation({
          dependencies,
          operation,
          input: { id: component_id },
        });

        return { deleted, component_id, component_type };
      }, response_format),
  );

  server.registerTool(
    'twenty_resolve_view_query',
    {
      title: 'Resolve a saved view into query parameters',
      description:
        'Resolves saved filters and sorts into the object name, GraphQL operation filter, orderBy value, view name, and view type needed to query matching records.',
      inputSchema: z.object({
        view_id: recordIdSchema,
        response_format: responseFormatSchema,
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ view_id, response_format }) =>
      runTool(async () => {
        const result = await dependencies.client.graphql<{
          resolveViewToQueryParams: unknown;
        }>(
          RESOLVE_VIEW_QUERY,
          { id: view_id },
          { endpoint: 'metadata', token: metadataToken(dependencies) },
        );

        return result.resolveViewToQueryParams;
      }, response_format),
  );
};

export const viewToolsTesting = {
  createComponentInput,
  updateComponentInput,
};
