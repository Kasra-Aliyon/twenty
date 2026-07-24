import { isNonEmptyString } from '@sniptt/guards';

import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

const LINKEDIN_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const normalizeLinkedinHandle = (
  value: string | null | undefined,
): string | null => {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const trimmedValue = value.trim();
  const linkedinPathMatch = trimmedValue.match(/(?:^|\/)in\/([^/?#]+)/i);
  const handleWithPossibleEncoding = linkedinPathMatch?.[1]
    ? linkedinPathMatch[1]
    : trimmedValue.replace(/^@/, '').split(/[/?#]/, 1)[0];

  let handle: string;

  try {
    handle = decodeURIComponent(handleWithPossibleEncoding).toLowerCase();
  } catch {
    return null;
  }

  return LINKEDIN_HANDLE_PATTERN.test(handle) ? handle : null;
};

export const normalizeFullName = (
  value: string | null | undefined,
): string | null => {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalizedName = value.trim().replace(/\s+/g, ' ').toLowerCase();

  return normalizedName.split(' ').length > 1 ? normalizedName : null;
};

export const getPersonFullName = (
  person: PersonWorkspaceEntity,
): string | null =>
  normalizeFullName(
    [person.name?.firstName, person.name?.lastName]
      .filter(isNonEmptyString)
      .join(' '),
  );

export const addValueToSetMap = (
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void => {
  const existingValues = map.get(key) ?? new Set<string>();

  existingValues.add(value);
  map.set(key, existingValues);
};

export const getOnlySetValue = (
  values: Set<string> | undefined,
): string | null => (values?.size === 1 ? ([...values][0] ?? null) : null);
