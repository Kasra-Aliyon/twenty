import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { MetadataService } from '../../services/metadata.service.js';
import type { TwentyClient } from '../../services/twenty-client.js';
import { registerSequenceTools } from '../sequences.tools.js';

const sequenceEnrollmentMetadata = {
  id: 'sequence-enrollment-metadata-id',
  nameSingular: 'sequenceEnrollment',
  namePlural: 'sequenceEnrollments',
  labelSingular: 'Sequence enrollment',
  labelPlural: 'Sequence enrollments',
  fields: [
    {
      id: 'person-id-field-id',
      name: 'personId',
      label: 'Person ID',
      type: 'UUID',
      isNullable: false,
    },
    {
      id: 'sequence-id-field-id',
      name: 'sequenceId',
      label: 'Sequence ID',
      type: 'UUID',
      isNullable: false,
    },
    {
      id: 'current-step-id-field-id',
      name: 'currentStepId',
      label: 'Current step ID',
      type: 'UUID',
      isNullable: true,
    },
  ],
};

const withSequenceTools = async <TResult>({
  graphql,
  operation,
}: {
  graphql: jest.Mock;
  operation: (args: { client: Client; rest: jest.Mock }) => Promise<TResult>;
}): Promise<TResult> => {
  const rest = jest.fn().mockResolvedValue({
    data: { sequenceEnrollment: { id: 'enrollment-id' } },
  });
  const getObject = jest.fn().mockResolvedValue(sequenceEnrollmentMetadata);
  const server = new McpServer({
    name: 'twenty-sequence-start-step-test-server',
    version: '1.0.0',
  });

  registerSequenceTools(server, {
    client: {
      graphql,
      hasUserToken: () => false,
      rest,
    } as unknown as TwentyClient,
    metadata: { getObject } as unknown as MetadataService,
    enableAdvanced: false,
  });

  const client = new Client({
    name: 'twenty-sequence-start-step-test-client',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    return await operation({ client, rest });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

describe('sequence enrollment starting step', () => {
  it('passes the selected root step through single and bulk enrollment tools', async () => {
    const graphql = jest.fn().mockResolvedValue({
      sequenceMutationCapabilities: {
        enrollmentStartStep: true,
        enrollmentStartStepVersion: 1,
      },
    });

    await withSequenceTools({
      graphql,
      operation: async ({ client, rest }) => {
        const singleResult = await client.callTool({
          name: 'twenty_enroll_person_in_sequence',
          arguments: {
            person_id: '11111111-1111-4111-8111-111111111111',
            sequence_id: '22222222-2222-4222-8222-222222222222',
            start_step_id: '33333333-3333-4333-8333-333333333333',
            confirm: true,
            response_format: 'json',
          },
        });
        const bulkResult = await client.callTool({
          name: 'twenty_bulk_enroll_people',
          arguments: {
            person_ids: [
              '44444444-4444-4444-8444-444444444444',
              '55555555-5555-4555-8555-555555555555',
            ],
            sequence_id: '22222222-2222-4222-8222-222222222222',
            start_step_id: '66666666-6666-4666-8666-666666666666',
            confirm: true,
            response_format: 'json',
          },
        });

        expect(singleResult.isError).not.toBe(true);
        expect(bulkResult.isError).not.toBe(true);
        expect(graphql).toHaveBeenCalledTimes(2);
        expect(rest).toHaveBeenNthCalledWith(
          1,
          'POST',
          '/rest/sequenceEnrollments',
          {
            query: { depth: 0 },
            body: {
              personId: '11111111-1111-4111-8111-111111111111',
              sequenceId: '22222222-2222-4222-8222-222222222222',
              currentStepId: '33333333-3333-4333-8333-333333333333',
            },
            token: undefined,
          },
        );
        expect(rest).toHaveBeenNthCalledWith(
          2,
          'POST',
          '/rest/sequenceEnrollments',
          expect.objectContaining({
            body: expect.objectContaining({
              currentStepId: '66666666-6666-4666-8666-666666666666',
            }),
          }),
        );
        expect(rest).toHaveBeenNthCalledWith(
          3,
          'POST',
          '/rest/sequenceEnrollments',
          expect.objectContaining({
            body: expect.objectContaining({
              currentStepId: '66666666-6666-4666-8666-666666666666',
            }),
          }),
        );
      },
    });
  });

  it('fails closed when the backend does not advertise support', async () => {
    const graphql = jest
      .fn()
      .mockRejectedValue(new Error('Unknown capability fields'));

    await withSequenceTools({
      graphql,
      operation: async ({ client, rest }) => {
        const result = await client.callTool({
          name: 'twenty_enroll_person_in_sequence',
          arguments: {
            person_id: '11111111-1111-4111-8111-111111111111',
            sequence_id: '22222222-2222-4222-8222-222222222222',
            start_step_id: '33333333-3333-4333-8333-333333333333',
            confirm: true,
            response_format: 'json',
          },
        });

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual({
          result: {
            error: expect.stringContaining(
              'does not advertise enrollment at a selected starting step',
            ),
          },
        });
        expect(rest).not.toHaveBeenCalled();
      },
    });
  });
});
