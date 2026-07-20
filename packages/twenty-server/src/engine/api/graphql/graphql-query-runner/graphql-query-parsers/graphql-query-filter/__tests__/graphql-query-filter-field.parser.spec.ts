import {
  Brackets,
  type ObjectLiteral,
  type WhereExpressionBuilder,
} from 'typeorm';
import { FieldMetadataType, RelationType } from 'twenty-shared/types';

import { GraphqlQueryFilterFieldParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query-filter/graphql-query-filter-field.parser';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceSelectQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-select-query-builder';

describe('GraphqlQueryFilterFieldParser one-to-many filters', () => {
  it('builds a correlated EXISTS condition without joining the root query', () => {
    const companyObject = {
      id: 'company-object-id',
      nameSingular: 'company',
      namePlural: 'companies',
      fieldIds: ['11111111-1111-4111-8111-111111111111'],
      universalIdentifier: 'company-object-universal-id',
    } as unknown as FlatObjectMetadata;
    const memberObject = {
      id: 'member-object-id',
      nameSingular: 'recordListMember',
      namePlural: 'recordListMembers',
      fieldIds: ['22222222-2222-4222-8222-222222222222'],
      universalIdentifier: 'member-object-universal-id',
    } as unknown as FlatObjectMetadata;
    const membershipsField = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'recordListMemberships',
      type: FieldMetadataType.RELATION,
      objectMetadataId: companyObject.id,
      universalIdentifier: 'memberships-field-universal-id',
      relationTargetObjectMetadataId: memberObject.id,
      settings: { relationType: RelationType.ONE_TO_MANY },
    } as unknown as FlatFieldMetadata;
    const recordListIdField = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'recordListId',
      type: FieldMetadataType.UUID,
      objectMetadataId: memberObject.id,
      universalIdentifier: 'record-list-id-field-universal-id',
    } as unknown as FlatFieldMetadata;
    const flatFieldMetadataMaps = {
      byUniversalIdentifier: {
        [membershipsField.universalIdentifier]: membershipsField,
        [recordListIdField.universalIdentifier]: recordListIdField,
      },
      universalIdentifierById: {
        [membershipsField.id]: membershipsField.universalIdentifier,
        [recordListIdField.id]: recordListIdField.universalIdentifier,
      },
      universalIdentifiersByApplicationId: {},
    } as unknown as FlatEntityMaps<FlatFieldMetadata>;
    const flatObjectMetadataMaps = {
      byUniversalIdentifier: {
        [companyObject.universalIdentifier]: companyObject,
        [memberObject.universalIdentifier]: memberObject,
      },
      universalIdentifierById: {
        [companyObject.id]: companyObject.universalIdentifier,
        [memberObject.id]: memberObject.universalIdentifier,
      },
      universalIdentifiersByApplicationId: {},
    } as unknown as FlatEntityMaps<FlatObjectMetadata>;
    const parameters: ObjectLiteral = {};
    const childWhereBuilder = {
      where: jest.fn((_sql: string, values?: ObjectLiteral) => {
        Object.assign(parameters, values);
      }),
      andWhere: jest.fn((_sql: string, values?: ObjectLiteral) => {
        Object.assign(parameters, values);
      }),
    } as unknown as WhereExpressionBuilder;
    const subQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn((condition: Brackets) => {
        condition.whereFactory(childWhereBuilder);
      }),
      getQuery: jest.fn(() => '(SELECT 1 FROM "recordListMember")'),
      getParameters: jest.fn(() => parameters),
    };
    const relationMetadata = {
      inverseEntityMetadata: { target: class RecordListMember {} },
      inverseRelation: {
        joinColumns: [
          {
            databaseName: 'targetCompanyId',
            referencedColumn: { databaseName: 'id' },
          },
        ],
      },
    };
    const outerQueryBuilder = {
      expressionMap: {
        aliases: [
          {
            name: 'company',
            hasMetadata: true,
            metadata: {
              primaryColumns: [{ databaseName: 'id' }],
              findRelationWithPropertyPath: jest.fn(() => relationMetadata),
            },
          },
        ],
      },
      subQuery: jest.fn(() => subQueryBuilder),
      escape: jest.fn((identifier: string) => `"${identifier}"`),
      setParameters: jest.fn(),
    } as unknown as WorkspaceSelectQueryBuilder<ObjectLiteral>;
    const rootWhereBuilder = {
      where: jest.fn(),
      andWhere: jest.fn(),
    } as unknown as WhereExpressionBuilder;
    const parser = new GraphqlQueryFilterFieldParser(
      companyObject,
      flatFieldMetadataMaps,
      flatObjectMetadataMaps,
    );

    parser.parse(
      rootWhereBuilder,
      outerQueryBuilder,
      'company',
      'recordListMemberships',
      {
        recordListId: { eq: '20202020-1111-4111-8111-111111111111' },
      },
      true,
    );

    expect(subQueryBuilder.where).toHaveBeenCalledWith(
      '"relationFilter_11111111111141118111111111111111"."targetCompanyId" = "company"."id"',
    );
    expect(childWhereBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining(
        '"relationFilter_11111111111141118111111111111111"."recordListId" =',
      ),
      expect.objectContaining({}),
    );
    expect(rootWhereBuilder.where).toHaveBeenCalledWith(
      'EXISTS (SELECT 1 FROM "recordListMember")',
    );
    expect(outerQueryBuilder.setParameters).toHaveBeenCalledWith(parameters);
  });
});
