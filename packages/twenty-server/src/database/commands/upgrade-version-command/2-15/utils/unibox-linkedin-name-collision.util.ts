import { STANDARD_OBJECTS } from 'twenty-shared/metadata';
import { isDefined } from 'twenty-shared/utils';

import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';

export const UNIBOX_LINKEDIN_OBJECT_NAMES = [
  {
    objectName: 'linkedinMessageThread',
    nameSingular: 'linkedinMessageThread',
    namePlural: 'linkedinMessageThreads',
    universalIdentifier:
      STANDARD_OBJECTS.linkedinMessageThread.universalIdentifier,
  },
  {
    objectName: 'linkedinMessage',
    nameSingular: 'linkedinMessage',
    namePlural: 'linkedinMessages',
    universalIdentifier: STANDARD_OBJECTS.linkedinMessage.universalIdentifier,
  },
  {
    objectName: 'linkedinThreadParticipant',
    nameSingular: 'linkedinThreadParticipant',
    namePlural: 'linkedinThreadParticipants',
    universalIdentifier:
      STANDARD_OBJECTS.linkedinThreadParticipant.universalIdentifier,
  },
  {
    objectName: 'linkedinConnection',
    nameSingular: 'linkedinConnection',
    namePlural: 'linkedinConnections',
    universalIdentifier:
      STANDARD_OBJECTS.linkedinConnection.universalIdentifier,
  },
  {
    objectName: 'linkedinInvitation',
    nameSingular: 'linkedinInvitation',
    namePlural: 'linkedinInvitations',
    universalIdentifier:
      STANDARD_OBJECTS.linkedinInvitation.universalIdentifier,
  },
] as const;

type ObjectNameCollisionCandidate = Pick<
  FlatObjectMetadata,
  | 'applicationId'
  | 'id'
  | 'labelSingular'
  | 'namePlural'
  | 'nameSingular'
  | 'universalIdentifier'
>;

export type UniboxLinkedinObjectNameCollision = {
  customObject: ObjectNameCollisionCandidate;
  conflictingStandardObject: (typeof UNIBOX_LINKEDIN_OBJECT_NAMES)[number];
  conflictingNames: string[];
};

export type UniboxLinkedinLegacyObject = {
  objectName: (typeof UNIBOX_LINKEDIN_OBJECT_NAMES)[number]['objectName'];
  objectMetadata: FlatObjectMetadata;
};

export type UniboxLinkedinLegacyObjectRename = UniboxLinkedinLegacyObject & {
  renamedObjectMetadata: FlatObjectMetadata;
};

const MAX_LEGACY_NAME_ATTEMPTS = 100;

const capitalize = (value: string): string =>
  value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);

const matchesLegacyObjectName = ({
  name,
  objectDefinition,
}: {
  name: string;
  objectDefinition: (typeof UNIBOX_LINKEDIN_OBJECT_NAMES)[number];
}): boolean => {
  const capitalizedSingular = capitalize(objectDefinition.nameSingular);
  const capitalizedPlural = capitalize(objectDefinition.namePlural);
  const legacyPrefixNames = new Set([
    `legacy${capitalizedSingular}`,
    `legacy${capitalizedPlural}`,
  ]);
  const legacySuffixNames = new Set([
    `${objectDefinition.nameSingular}Legacy`,
    `${objectDefinition.namePlural}Legacy`,
  ]);
  const nameWithoutNumericSuffix = name.replace(/\d+$/, '');

  return (
    name === objectDefinition.nameSingular ||
    name === objectDefinition.namePlural ||
    legacyPrefixNames.has(nameWithoutNumericSuffix) ||
    legacySuffixNames.has(nameWithoutNumericSuffix)
  );
};

export const findUniboxLinkedinObjectNameCollisions = ({
  objectMetadatas,
  workspaceCustomApplicationId,
}: {
  objectMetadatas: ObjectNameCollisionCandidate[];
  workspaceCustomApplicationId: string;
}): UniboxLinkedinObjectNameCollision[] =>
  objectMetadatas.flatMap((customObject) => {
    if (customObject.applicationId !== workspaceCustomApplicationId) {
      return [];
    }

    const customNames = new Set([
      customObject.nameSingular,
      customObject.namePlural,
    ]);

    return UNIBOX_LINKEDIN_OBJECT_NAMES.flatMap((conflictingStandardObject) => {
      const conflictingNames = [
        conflictingStandardObject.nameSingular,
        conflictingStandardObject.namePlural,
      ].filter((name) => customNames.has(name));

      return conflictingNames.length === 0
        ? []
        : [
            {
              customObject,
              conflictingStandardObject,
              conflictingNames,
            },
          ];
    });
  });

export const findUniboxLinkedinLegacyObjects = ({
  flatObjectMetadataMaps,
  workspaceCustomApplicationId,
}: {
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
  workspaceCustomApplicationId: string;
}): UniboxLinkedinLegacyObject[] =>
  Object.values(flatObjectMetadataMaps.byUniversalIdentifier)
    .filter(isDefined)
    .filter(
      (objectMetadata) =>
        objectMetadata.applicationId === workspaceCustomApplicationId,
    )
    .flatMap((objectMetadata) =>
      UNIBOX_LINKEDIN_OBJECT_NAMES.flatMap((objectDefinition) =>
        matchesLegacyObjectName({
          name: objectMetadata.nameSingular,
          objectDefinition,
        }) ||
        matchesLegacyObjectName({
          name: objectMetadata.namePlural,
          objectDefinition,
        })
          ? [{ objectName: objectDefinition.objectName, objectMetadata }]
          : [],
      ),
    );

const resolveAvailableLegacyObjectNames = ({
  flatObjectMetadataMaps,
  objectDefinition,
  reservedNames,
}: {
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
  objectDefinition: (typeof UNIBOX_LINKEDIN_OBJECT_NAMES)[number];
  reservedNames: ReadonlySet<string>;
}): {
  nameSingular: string;
  namePlural: string;
  labelSuffix: string;
} => {
  const takenNames = new Set([
    ...Object.values(flatObjectMetadataMaps.byUniversalIdentifier)
      .filter(isDefined)
      .flatMap(({ namePlural, nameSingular }) => [nameSingular, namePlural]),
    ...reservedNames,
  ]);
  const capitalizedSingular = capitalize(objectDefinition.nameSingular);
  const capitalizedPlural = capitalize(objectDefinition.namePlural);

  for (let attempt = 0; attempt < MAX_LEGACY_NAME_ATTEMPTS; attempt++) {
    const discriminator = attempt === 0 ? '' : `${attempt + 1}`;
    const nameSingular = `legacy${capitalizedSingular}${discriminator}`;
    const namePlural = `legacy${capitalizedPlural}${discriminator}`;

    if (!takenNames.has(nameSingular) && !takenNames.has(namePlural)) {
      return {
        nameSingular,
        namePlural,
        labelSuffix:
          discriminator === ''
            ? ' (Legacy backup)'
            : ` (Legacy backup ${discriminator})`,
      };
    }
  }

  throw new Error(
    `Could not find available legacy names for ${objectDefinition.objectName} after ${MAX_LEGACY_NAME_ATTEMPTS} attempts`,
  );
};

export const buildUniboxLinkedinLegacyObjectRenames = ({
  flatObjectMetadataMaps,
  now,
  workspaceCustomApplicationId,
}: {
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
  now: string;
  workspaceCustomApplicationId: string;
}): UniboxLinkedinLegacyObjectRename[] => {
  const collisions = findUniboxLinkedinObjectNameCollisions({
    objectMetadatas: Object.values(
      flatObjectMetadataMaps.byUniversalIdentifier,
    ).filter(isDefined),
    workspaceCustomApplicationId,
  });
  const reservedNames = new Set<string>();

  return collisions.map(({ customObject, conflictingStandardObject }) => {
    const objectMetadata =
      flatObjectMetadataMaps.byUniversalIdentifier[
        customObject.universalIdentifier
      ];

    if (!isDefined(objectMetadata)) {
      throw new Error(
        `Could not resolve colliding LinkedIn object ${customObject.id}`,
      );
    }

    const { nameSingular, namePlural, labelSuffix } =
      resolveAvailableLegacyObjectNames({
        flatObjectMetadataMaps,
        objectDefinition: conflictingStandardObject,
        reservedNames,
      });

    reservedNames.add(nameSingular);
    reservedNames.add(namePlural);

    return {
      objectName: conflictingStandardObject.objectName,
      objectMetadata,
      renamedObjectMetadata: {
        ...objectMetadata,
        nameSingular,
        namePlural,
        labelSingular: `${objectMetadata.labelSingular}${labelSuffix}`,
        labelPlural: `${objectMetadata.labelPlural}${labelSuffix}`,
        isLabelSyncedWithName: false,
        updatedAt: now,
      },
    };
  });
};

export const assertNoUniboxLinkedinObjectNameCollisions = ({
  objectMetadatas,
  workspaceCustomApplicationId,
  workspaceId,
}: {
  objectMetadatas: ObjectNameCollisionCandidate[];
  workspaceCustomApplicationId: string;
  workspaceId: string;
}): void => {
  const collisions = findUniboxLinkedinObjectNameCollisions({
    objectMetadatas,
    workspaceCustomApplicationId,
  });

  if (collisions.length === 0) {
    return;
  }

  const collisionDetails = collisions
    .map(
      ({ customObject, conflictingStandardObject, conflictingNames }) =>
        `- "${customObject.labelSingular}" (${customObject.nameSingular}/${customObject.namePlural}, id ${customObject.id}) conflicts with ${conflictingStandardObject.objectName} on ${conflictingNames.join(', ')}`,
    )
    .join('\n');

  throw new Error(
    `LinkedIn standard-object promotion is blocked for workspace ${workspaceId}. Rename the legacy custom object singular and plural API names in Settings > Data model (for example, add a "Legacy" suffix), then rerun this command. No legacy object or data was changed.\n${collisionDetails}`,
  );
};
