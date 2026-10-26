import type { MetadataObject } from '../../types.js';
import { MetadataService, metadataTesting } from '../metadata.service.js';
import { RecordsService, recordsServiceTesting } from '../records.service.js';
import type { TwentyClient } from '../twenty-client.js';

const rawPersonObject = {
  id: 'person-object-id',
  nameSingular: 'person',
  namePlural: 'people',
  labelSingular: 'Person',
  labelPlural: 'People',
  fields: [
    {
      id: 'name-field-id',
      name: 'name',
      label: 'Name',
      type: 'FULL_NAME',
    },
  ],
};

const personObject = rawPersonObject as MetadataObject;

const clientWith = ({
  rest,
  graphql = jest.fn(),
}: {
  rest: jest.Mock;
  graphql?: jest.Mock;
}): TwentyClient => ({ rest, graphql }) as unknown as TwentyClient;

describe('MetadataService', () => {
  it.each([
    ['workspace-custom', 'custom-application-id', true],
    ['standard', 'standard-application-id', false],
    ['installed-application', 'installed-application-id', false],
  ])(
    'proves %s object ownership from application ids, even with isSystem=false',
    async (_kind, applicationId, expected) => {
      const graphql = jest.fn().mockResolvedValue({
        currentWorkspace: {
          workspaceCustomApplicationId: 'custom-application-id',
        },
        object: { applicationId },
      });
      const service = new MetadataService(
        clientWith({ rest: jest.fn(), graphql }),
        60_000,
      );
      const object = { ...personObject, isSystem: false };
      await expect(service.isCustomObject(object)).resolves.toBe(expected);
      await expect(service.isCustomObject(object)).resolves.toBe(expected);
      expect(graphql).toHaveBeenCalledTimes(1);
      expect(graphql).toHaveBeenCalledWith(
        expect.stringContaining('currentWorkspace'),
        { id: object.id },
        { endpoint: 'metadata' },
      );
      service.clearCache();
      await service.isCustomObject(object);
      expect(graphql).toHaveBeenCalledTimes(2);
    },
  );

  it('fails closed when object ownership cannot be proved', async () => {
    const graphql = jest
      .fn()
      .mockResolvedValue({ object: { applicationId: 'unknown' } });
    const service = new MetadataService(
      clientWith({ rest: jest.fn(), graphql }),
      60_000,
    );
    await expect(service.isCustomObject(personObject)).rejects.toThrow(
      'Unable to verify object ownership',
    );
    await expect(
      service.isCustomObject({ ...personObject, isSystem: true }),
    ).resolves.toBe(false);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it('normalizes REST metadata and caches it for the configured TTL', async () => {
    const rest = jest.fn().mockResolvedValue({
      data: { objects: [rawPersonObject] },
    });
    const service = new MetadataService(clientWith({ rest }), 60_000);

    await expect(service.listObjects()).resolves.toEqual([personObject]);
    await expect(service.getObject('person')).resolves.toEqual(personObject);
    expect(rest).toHaveBeenCalledTimes(1);

    service.clearCache();
    await service.listObjects();
    expect(rest).toHaveBeenCalledTimes(2);
  });

  it('falls back to metadata GraphQL when REST returns no objects', async () => {
    const rest = jest.fn().mockResolvedValue({ data: [] });
    const graphql = jest.fn().mockResolvedValue({
      objects: { edges: [{ node: { ...rawPersonObject, fieldsList: [] } }] },
    });
    const service = new MetadataService(clientWith({ rest, graphql }), 60_000);

    await expect(service.listObjects()).resolves.toHaveLength(1);
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it('extracts both supported metadata envelope shapes', () => {
    expect(
      metadataTesting.extractRestObjects({
        data: { objects: [rawPersonObject] },
      }),
    ).toHaveLength(1);
    expect(
      metadataTesting.extractGraphqlObjects({
        objects: {
          edges: [{ node: { ...rawPersonObject, fieldsList: [] } }],
        },
      }),
    ).toHaveLength(1);
  });
});

describe('RecordsService', () => {
  it('unwraps REST mutation envelopes and projects requested fields', () => {
    expect(
      recordsServiceTesting.unwrapRestResponse({
        data: { updatePerson: { id: 'person-1', jobTitle: 'Engineer' } },
      }),
    ).toEqual({ id: 'person-1', jobTitle: 'Engineer' });
    expect(
      recordsServiceTesting.projectFields(
        { id: 'person-1', name: 'Ada', secret: 'hidden' },
        ['name'],
      ),
    ).toEqual({ id: 'person-1', name: 'Ada' });
  });

  it('uses soft_delete=true for recoverable deletion', async () => {
    const rest = jest.fn().mockResolvedValue({
      data: { deletePerson: { id: 'person-1' } },
    });
    const metadata = {
      getObject: jest.fn().mockResolvedValue(personObject),
    };
    const service = new RecordsService(
      clientWith({ rest }),
      metadata as unknown as MetadataService,
    );

    await expect(service.softDelete('people', 'person-1')).resolves.toEqual({
      id: 'person-1',
    });
    expect(rest).toHaveBeenCalledWith('DELETE', '/rest/people/person-1', {
      query: { soft_delete: true },
    });
  });
});
