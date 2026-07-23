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
        provider: 'google',
        archivedAt: null,
        authFailedAt: null,
      },
      {
        id: 'failed-google',
        provider: 'google',
        archivedAt: null,
        authFailedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'active-microsoft',
        provider: 'microsoft',
        archivedAt: null,
        authFailedAt: null,
      },
    ];

    expect(
      sequencesToolsTesting.filterConnectedAccounts(accounts, {
        activeOnly: true,
        provider: 'google',
      }),
    ).toEqual([accounts[0]]);
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
