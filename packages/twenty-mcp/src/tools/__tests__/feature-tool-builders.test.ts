import { requireUserToken } from '../../services/user-auth.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import { dashboardToolsTesting } from '../dashboards.tools.js';
import { emailToolsTesting } from '../email.tools.js';
import { sequencesToolsTesting } from '../sequences.tools.js';
import { viewToolsTesting } from '../views.tools.js';

describe('feature tool input builders', () => {
  it('filters unavailable and mismatched connected accounts', () => {
    const accounts = [
      {
        id: 'active-google',
        handle: 'sender@example.com',
        provider: 'google',
        archivedAt: null,
        authFailedAt: null,
        messageChannels: [
          {
            connectedAccountId: 'active-google',
            handle: 'sender@example.com',
            isSyncEnabled: true,
            syncStatus: 'ACTIVE',
          },
        ],
      },
      {
        id: 'failed-google',
        handle: 'failed@example.com',
        provider: 'google',
        archivedAt: null,
        authFailedAt: '2026-01-01T00:00:00.000Z',
        messageChannels: [
          {
            connectedAccountId: 'failed-google',
            handle: 'failed@example.com',
            isSyncEnabled: true,
            syncStatus: 'ACTIVE',
          },
        ],
      },
      {
        id: 'active-microsoft',
        handle: 'microsoft@example.com',
        provider: 'microsoft',
        archivedAt: null,
        authFailedAt: null,
        messageChannels: [
          {
            connectedAccountId: 'active-microsoft',
            handle: 'microsoft@example.com',
            isSyncEnabled: false,
            syncStatus: 'ACTIVE',
          },
        ],
      },
    ];

    expect(
      sequencesToolsTesting.filterConnectedAccounts(accounts, {
        activeOnly: true,
        provider: 'google',
      }),
    ).toEqual([accounts[0]]);
  });

  it('requires an enabled active inbox channel for a sequence sender', () => {
    expect(
      sequencesToolsTesting.isReadySequenceSenderAccount({
        id: 'account-id',
        handle: 'sender@example.com',
        provider: 'google',
        archivedAt: null,
        authFailedAt: null,
        messageChannels: [
          {
            connectedAccountId: 'account-id',
            handle: 'alias@example.com',
            isSyncEnabled: true,
            syncStatus: 'ACTIVE',
          },
          {
            connectedAccountId: 'account-id',
            handle: 'sender@example.com',
            isSyncEnabled: true,
            syncStatus: 'ONGOING',
          },
        ],
      }),
    ).toBe(false);
  });

  it('models current sequence branches and manual execution settings', () => {
    const parsed = sequencesToolsTesting.stepInputSchema.parse({
      type: 'SEND_LINKEDIN_MESSAGE',
      settings: {
        branch: {
          conditionStepId: 'condition-id',
          outcome: 'YES',
        },
        executionMode: 'MANUAL',
        manualTaskTitle: 'Message {{ fullName }}',
        manualTaskDescription: 'Use the approved copy.',
        messageTemplate: 'Hi {{ firstName }}',
      },
    });

    expect(sequencesToolsTesting.stepData({ input: parsed })).toEqual({
      type: 'CREATE_TASK',
      settings: {
        type: 'SEND_LINKEDIN_MESSAGE',
        branch: {
          conditionStepId: 'condition-id',
          outcome: 'YES',
        },
        executionMode: 'MANUAL',
        manualTaskTitle: 'Message {{ fullName }}',
        manualTaskDescription: 'Use the approved copy.',
        messageTemplate: 'Hi {{ firstName }}',
      },
    });
  });

  it('supports conditions and automated phone enrichment', () => {
    const condition = sequencesToolsTesting.stepInputSchema.parse({
      type: 'CONDITION',
      settings: { condition: 'HAS_PHONE_NUMBER' },
    });
    const enrichment = sequencesToolsTesting.stepInputSchema.parse({
      type: 'ENRICH_PHONE_NUMBER',
      settings: {},
    });

    expect(sequencesToolsTesting.stepData({ input: condition })).toEqual({
      type: 'CREATE_TASK',
      settings: {
        type: 'CONDITION',
        condition: 'HAS_PHONE_NUMBER',
      },
    });
    expect(sequencesToolsTesting.stepData({ input: enrichment })).toEqual({
      type: 'CREATE_TASK',
      settings: {
        type: 'ENRICH_PHONE_NUMBER',
        executionMode: 'AUTOMATED',
        manualTaskTitle: '',
        manualTaskDescription: '',
      },
    });
  });

  it('rejects invalid manual, task deadline, and nested condition steps', () => {
    expect(
      sequencesToolsTesting.stepInputSchema.safeParse({
        type: 'SEND_EMAIL',
        settings: {
          executionMode: 'MANUAL',
          subject: '',
          bodyHtml: '',
        },
      }).success,
    ).toBe(false);
    expect(
      sequencesToolsTesting.stepInputSchema.safeParse({
        type: 'CREATE_TASK',
        settings: {
          titleTemplate: 'Follow up',
          continueMode: 'ON_DEADLINE',
        },
      }).success,
    ).toBe(false);
    expect(
      sequencesToolsTesting.stepInputSchema.safeParse({
        type: 'CONDITION',
        settings: {
          condition: 'HAS_EMAIL_ADDRESS',
          branch: {
            conditionStepId: 'parent-condition',
            outcome: 'NO',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('preserves or explicitly clears branch placement on step updates', () => {
    const currentStep = {
      sequenceId: 'sequence-id',
      settings: {
        type: 'DELAY',
        branch: {
          conditionStepId: 'condition-id',
          outcome: 'NO',
        },
      },
    };
    const update = sequencesToolsTesting.stepInputSchema.parse({
      type: 'DELAY',
      settings: { days: 2 },
    });
    const rootUpdate = sequencesToolsTesting.stepInputSchema.parse({
      type: 'DELAY',
      settings: { branch: null, days: 2 },
    });

    expect(
      sequencesToolsTesting.withPreservedStepBranch({
        currentStep,
        input: update,
      }).settings.branch,
    ).toEqual({
      conditionStepId: 'condition-id',
      outcome: 'NO',
    });
    expect(
      sequencesToolsTesting.withPreservedStepBranch({
        currentStep,
        input: rootUpdate,
      }).settings.branch,
    ).toBeNull();
  });

  it('finds every descendant when deleting a condition step', () => {
    expect(
      sequencesToolsTesting.findDescendantStepIds({
        stepId: 'condition-a',
        steps: [
          {
            id: 'branch-condition',
            settings: {
              branch: {
                conditionStepId: 'condition-a',
                outcome: 'YES',
              },
            },
          },
          {
            id: 'nested-branch-step',
            settings: {
              branch: {
                conditionStepId: 'branch-condition',
                outcome: 'NO',
              },
            },
          },
          {
            id: 'root-step',
            settings: { type: 'DELAY' },
          },
        ],
      }),
    ).toEqual(['branch-condition', 'nested-branch-step']);
  });

  it('builds sparse draft updates without overwriting omitted fields', () => {
    expect(
      emailToolsTesting.draftData({
        subject: 'Updated subject',
        inReplyTo: null,
      }),
    ).toEqual({
      subject: 'Updated subject',
      inReplyTo: null,
    });
  });

  it('builds dashboard widget GraphQL input names', () => {
    expect(
      dashboardToolsTesting.widgetInput('tab-id', {
        title: 'Pipeline',
        type: 'GRAPH',
        grid_position: {
          row: 0,
          column: 0,
          rowSpan: 4,
          columnSpan: 6,
        },
        object_metadata_id: 'object-id',
        configuration: {
          configurationType: 'AGGREGATE_CHART',
          aggregateFieldMetadataId: 'field-id',
          aggregateOperation: 'COUNT',
        },
      }),
    ).toEqual({
      pageLayoutTabId: 'tab-id',
      title: 'Pipeline',
      type: 'GRAPH',
      gridPosition: {
        row: 0,
        column: 0,
        rowSpan: 4,
        columnSpan: 6,
      },
      objectMetadataId: 'object-id',
      configuration: {
        configurationType: 'AGGREGATE_CHART',
        aggregateFieldMetadataId: 'field-id',
        aggregateOperation: 'COUNT',
      },
    });
  });

  it('maps view components to metadata GraphQL inputs', () => {
    expect(
      viewToolsTesting.createComponentInput('view-id', {
        type: 'FILTER',
        field_metadata_id: 'field-id',
        operand: 'IS',
        value: 'CUSTOMER',
      }),
    ).toEqual({
      viewId: 'view-id',
      fieldMetadataId: 'field-id',
      operand: 'IS',
      value: 'CUSTOMER',
    });

    expect(
      viewToolsTesting.updateComponentInput({
        type: 'SORT',
        id: 'sort-id',
        direction: 'DESC',
      }),
    ).toEqual({
      id: 'sort-id',
      update: { direction: 'DESC' },
    });
  });
});

describe('user-scoped tool authentication', () => {
  it('requires an explicitly configured user token', () => {
    expect(() =>
      requireUserToken({
        hasUserToken: () => false,
      } as TwentyClient),
    ).toThrow('TWENTY_USER_TOKEN');

    expect(
      requireUserToken({
        hasUserToken: () => true,
      } as TwentyClient),
    ).toBe('user');
  });
});
