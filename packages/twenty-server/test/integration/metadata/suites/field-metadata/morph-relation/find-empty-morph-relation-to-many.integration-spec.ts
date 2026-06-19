import { createOneOperationFactory } from 'test/integration/graphql/utils/create-one-operation-factory.util';
import { findManyOperationFactory } from 'test/integration/graphql/utils/find-many-operation-factory.util';
import { makeGraphqlAPIRequestWithApiKey } from 'test/integration/graphql/utils/make-graphql-api-request-with-api-key.util';
import { deleteOneFieldMetadata } from 'test/integration/metadata/suites/field-metadata/utils/delete-one-field-metadata.util';
import { createMorphRelationBetweenObjects } from 'test/integration/metadata/suites/object-metadata/utils/create-morph-relation-between-objects.util';
import { createOneObjectMetadata } from 'test/integration/metadata/suites/object-metadata/utils/create-one-object-metadata.util';
import { deleteOneObjectMetadata } from 'test/integration/metadata/suites/object-metadata/utils/delete-one-object-metadata.util';
import { updateOneObjectMetadata } from 'test/integration/metadata/suites/object-metadata/utils/update-one-object-metadata.util';
import { FieldMetadataType } from 'twenty-shared/types';

import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';

describe('empty morph to-many relation read', () => {
  let opportunityObjectId = '';
  let personObjectId = '';
  let companyObjectId = '';
  let morphFieldId = '';

  beforeAll(async () => {
    ({
      data: {
        createOneObject: { id: opportunityObjectId },
      },
    } = await createOneObjectMetadata({
      input: {
        nameSingular: 'oppForEmptyMorph',
        namePlural: 'oppsForEmptyMorph',
        labelSingular: 'Opp For Empty Morph',
        labelPlural: 'Opps For Empty Morph',
        icon: 'IconOpportunity',
      },
    }));

    ({
      data: {
        createOneObject: { id: personObjectId },
      },
    } = await createOneObjectMetadata({
      input: {
        nameSingular: 'personForEmptyMorph',
        namePlural: 'peopleForEmptyMorph',
        labelSingular: 'Person For Empty Morph',
        labelPlural: 'People For Empty Morph',
        icon: 'IconUser',
      },
    }));

    ({
      data: {
        createOneObject: { id: companyObjectId },
      },
    } = await createOneObjectMetadata({
      input: {
        nameSingular: 'companyForEmptyMorph',
        namePlural: 'companiesForEmptyMorph',
        labelSingular: 'Company For Empty Morph',
        labelPlural: 'Companies For Empty Morph',
        icon: 'IconBuildingSkyscraper',
      },
    }));

    const createdField = await createMorphRelationBetweenObjects({
      objectMetadataId: opportunityObjectId,
      firstTargetObjectMetadataId: personObjectId,
      secondTargetObjectMetadataId: companyObjectId,
      type: FieldMetadataType.MORPH_RELATION,
      relationType: RelationType.ONE_TO_MANY,
    });

    morphFieldId = createdField.id;
  });

  afterAll(async () => {
    await deleteOneFieldMetadata({ input: { idToDelete: morphFieldId } }).catch(
      () => {},
    );

    for (const idToDelete of [
      opportunityObjectId,
      personObjectId,
      companyObjectId,
    ]) {
      await updateOneObjectMetadata({
        expectToFail: false,
        input: { idToUpdate: idToDelete, updatePayload: { isActive: false } },
      });
      await deleteOneObjectMetadata({ input: { idToDelete } });
    }
  });

  it('returns an empty connection (not null) for each unset morph to-many target', async () => {
    const { body: createBody } = await makeGraphqlAPIRequestWithApiKey(
      createOneOperationFactory({
        objectMetadataSingularName: 'oppForEmptyMorph',
        gqlFields: 'id',
        data: { name: 'No owners' },
      }),
    );

    expect(createBody.errors).toBeUndefined();

    const { body } = await makeGraphqlAPIRequestWithApiKey(
      findManyOperationFactory({
        objectMetadataSingularName: 'oppForEmptyMorph',
        objectMetadataPluralName: 'oppsForEmptyMorph',
        gqlFields: `
          id
          ownerPersonForEmptyMorph {
            edges {
              node {
                id
              }
            }
          }
          ownerCompanyForEmptyMorph {
            edges {
              node {
                id
              }
            }
          }
        `,
      }),
    );

    expect(body.errors).toBeUndefined();

    const node = body.data.oppsForEmptyMorph.edges[0].node;

    expect(node.ownerPersonForEmptyMorph).toEqual({ edges: [] });
    expect(node.ownerCompanyForEmptyMorph).toEqual({ edges: [] });
  });
});
