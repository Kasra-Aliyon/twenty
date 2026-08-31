import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { FieldMetadataType } from 'twenty-shared/types';

import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const TWENTY_STANDARD_APPLICATION_ID = '20202020-2222-4222-8222-222222222222';
const NOW = '2024-01-01T00:00:00.000Z';

describe('Company standard metadata build', () => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: NOW,
      workspaceId: WORKSPACE_ID,
      twentyStandardApplicationId: TWENTY_STANDARD_APPLICATION_ID,
    });

  const getCompanyField = (fieldUniversalIdentifier: string) =>
    allFlatEntityMaps.flatFieldMetadataMaps.byUniversalIdentifier[
      fieldUniversalIdentifier
    ];

  it('builds the requested scalar, collection, and phone fields', () => {
    expect(
      getCompanyField(
        STANDARD_OBJECTS.company.fields.employees.universalIdentifier,
      )?.type,
    ).toBe(FieldMetadataType.NUMBER);
    expect(
      getCompanyField(
        STANDARD_OBJECTS.company.fields.industry.universalIdentifier,
      )?.type,
    ).toBe(FieldMetadataType.TEXT);

    for (const field of [
      STANDARD_OBJECTS.company.fields.keywords,
      STANDARD_OBJECTS.company.fields.technologies,
      STANDARD_OBJECTS.company.fields.segments,
    ]) {
      expect(getCompanyField(field.universalIdentifier)?.type).toBe(
        FieldMetadataType.ARRAY,
      );
    }

    expect(
      getCompanyField(
        STANDARD_OBJECTS.company.fields.companyPhone.universalIdentifier,
      ),
    ).toMatchObject({
      type: FieldMetadataType.PHONES,
      settings: { maxNumberOfValues: 1 },
    });
  });

  it('builds the requested single-select fields and options', () => {
    expect(
      getCompanyField(
        STANDARD_OBJECTS.company.fields.accountStatus.universalIdentifier,
      ),
    ).toMatchObject({
      type: FieldMetadataType.SELECT,
      options: [
        expect.objectContaining({ label: 'Researching' }),
        expect.objectContaining({ label: 'Active sequence' }),
        expect.objectContaining({ label: 'Meeting booked' }),
        expect.objectContaining({ label: 'Pilot' }),
        expect.objectContaining({ label: 'Dormant' }),
        expect.objectContaining({ label: 'Active Customer' }),
        expect.objectContaining({ label: 'Dropped' }),
      ],
    });
    expect(
      getCompanyField(
        STANDARD_OBJECTS.company.fields.companyType.universalIdentifier,
      ),
    ).toMatchObject({
      type: FieldMetadataType.SELECT,
      label: 'Type',
      options: [
        expect.objectContaining({ label: 'Agency' }),
        expect.objectContaining({ label: 'CRO' }),
        expect.objectContaining({ label: 'Big Pharma' }),
      ],
    });
  });

  it('shows all requested fields on the Company record page', () => {
    const recordPageFieldUniversalIdentifiers = Object.values(
      allFlatEntityMaps.flatViewFieldMaps.byUniversalIdentifier,
    ).flatMap((viewField) =>
      viewField?.viewUniversalIdentifier ===
        STANDARD_OBJECTS.company.views.companyRecordPageFields
          .universalIdentifier && viewField.isVisible
        ? [viewField.fieldMetadataUniversalIdentifier]
        : [],
    );

    expect(recordPageFieldUniversalIdentifiers).toEqual(
      expect.arrayContaining([
        STANDARD_OBJECTS.company.fields.employees.universalIdentifier,
        STANDARD_OBJECTS.company.fields.industry.universalIdentifier,
        STANDARD_OBJECTS.company.fields.keywords.universalIdentifier,
        STANDARD_OBJECTS.company.fields.companyPhone.universalIdentifier,
        STANDARD_OBJECTS.company.fields.technologies.universalIdentifier,
        STANDARD_OBJECTS.company.fields.segments.universalIdentifier,
        STANDARD_OBJECTS.company.fields.accountStatus.universalIdentifier,
        STANDARD_OBJECTS.company.fields.companyType.universalIdentifier,
      ]),
    );
  });

  it('shows Company country as its own list column', () => {
    expect(
      allFlatEntityMaps.flatViewFieldMaps.byUniversalIdentifier[
        STANDARD_OBJECTS.company.views.allCompanies.viewFields.addressCountry
          .universalIdentifier
      ],
    ).toMatchObject({
      fieldMetadataUniversalIdentifier:
        STANDARD_OBJECTS.company.fields.address.universalIdentifier,
      isVisible: true,
      subFieldName: 'addressCountry',
    });
  });
});
