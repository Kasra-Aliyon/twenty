import type {
  CreateFieldArguments,
  CreateObjectArguments,
  UpdateFieldArguments,
  UpdateObjectArguments,
} from '../schemas/schema-tools.schemas.js';
import type {
  MetadataField,
  MetadataObject,
  MetadataOption,
} from '../types.js';
import { compactRecord } from './tool-data-builders.js';

type OptionInput = NonNullable<CreateFieldArguments['options']>[number];

const isSelect = (type: string): boolean =>
  type === 'SELECT' || type === 'MULTI_SELECT';

const mapOptions = (
  options: OptionInput[],
  existingOptions: MetadataOption[] = [],
): MetadataOption[] =>
  options.map((option, position) => {
    const existing = existingOptions.find(
      (entry) => entry.value === option.value,
    );

    return {
      ...(existing?.id === undefined ? {} : { id: existing.id }),
      value: option.value,
      label: option.label,
      color: option.color ?? existing?.color ?? 'gray',
      position,
    };
  });

const enumDefault = (
  value: unknown,
  options: MetadataOption[],
  type: string,
): unknown => {
  if (value === undefined || value === null || !isSelect(type)) {
    return value;
  }

  const quoteValue = (entry: unknown): string => {
    if (typeof entry !== 'string') {
      throw new Error('Select defaults must be option values or null.');
    }

    const unquoted = entry.replace(/^'([A-Z][A-Z0-9_]*)'$/, '$1');

    if (!options.some((option) => option.value === unquoted)) {
      throw new Error(
        `Default option "${unquoted}" is not in the supplied options. Specify a valid default_value or null when removing its option.`,
      );
    }

    return `'${unquoted}'`;
  };

  if (type === 'MULTI_SELECT') {
    if (!Array.isArray(value)) {
      throw new Error(
        'Multi-select defaults must be an array of option values or null.',
      );
    }

    return value.map(quoteValue);
  }

  return quoteValue(value);
};

export const createObjectInput = (input: CreateObjectArguments) => ({
  object: compactRecord([
    ['nameSingular', input.name_singular],
    ['namePlural', input.name_plural],
    ['labelSingular', input.label_singular],
    ['labelPlural', input.label_plural],
    ['description', input.description],
    ['icon', input.icon],
    ['isLabelSyncedWithName', false],
  ]),
});

export const updateObjectInput = (
  object: MetadataObject,
  changes: UpdateObjectArguments['changes'],
) => ({
  id: object.id,
  update: compactRecord([
    ['labelSingular', changes.label_singular],
    ['labelPlural', changes.label_plural],
    ['description', changes.description],
    ['icon', changes.icon],
    [
      'isLabelSyncedWithName',
      changes.label_singular !== undefined || changes.label_plural !== undefined
        ? false
        : undefined,
    ],
  ]),
});

export const createFieldInput = (
  input: CreateFieldArguments,
  object: MetadataObject,
  target?: MetadataObject,
) => {
  if (object.fields.some((field) => field.name === input.name)) {
    throw new Error(
      `Field "${input.name}" already exists on ${object.nameSingular}.`,
    );
  }

  if (isSelect(input.type) && input.options === undefined) {
    throw new Error('Select fields require options.');
  }

  if (!isSelect(input.type) && input.options !== undefined) {
    throw new Error(
      'Options are supported only for SELECT and MULTI_SELECT fields.',
    );
  }

  if (
    input.type === 'RELATION'
      ? input.relation === undefined || target === undefined
      : input.relation !== undefined
  ) {
    throw new Error(
      'RELATION fields require a relation target and inverse label; other field types cannot use relation.',
    );
  }

  const options =
    input.options === undefined ? undefined : mapOptions(input.options);

  return {
    field: compactRecord([
      ['objectMetadataId', object.id],
      ['name', input.name],
      ['label', input.label],
      ['type', input.type],
      ['description', input.description],
      ['icon', input.icon],
      ['isActive', true],
      ['isNullable', true],
      ['isLabelSyncedWithName', false],
      ['options', options],
      [
        'defaultValue',
        enumDefault(input.default_value, options ?? [], input.type),
      ],
      ['settings', input.settings],
      [
        'relationCreationPayload',
        input.relation === undefined
          ? undefined
          : {
              type: input.relation.type,
              targetObjectMetadataId: target?.id,
              targetFieldLabel: input.relation.inverse_label,
              targetFieldIcon: input.relation.inverse_icon,
            },
      ],
    ]),
  };
};

export const updateFieldInput = (
  field: MetadataField,
  input: UpdateFieldArguments,
) => {
  const changes = input.changes;
  let options: MetadataOption[] | undefined;

  if (changes.options !== undefined) {
    if (!isSelect(field.type)) {
      throw new Error(
        'Options are supported only for SELECT and MULTI_SELECT fields.',
      );
    }

    const removed = (field.options ?? []).filter(
      (option) =>
        !changes.options?.some((entry) => entry.value === option.value),
    );

    if (removed.length > 0 && !input.allow_option_removal) {
      throw new Error(
        `Removing options (${removed.map((option) => option.value).join(', ')}) clears stored record values. Confirm the exact removals and set allow_option_removal=true.`,
      );
    }

    options = mapOptions(changes.options, field.options);

    if (changes.default_value === undefined) {
      enumDefault(field.defaultValue, options, field.type);
    }
  }

  return {
    id: field.id,
    update: compactRecord([
      ['label', changes.label],
      ['description', changes.description],
      ['icon', changes.icon],
      ['isActive', changes.is_active],
      [
        'isLabelSyncedWithName',
        changes.label === undefined ? undefined : false,
      ],
      ['options', options],
      [
        'defaultValue',
        enumDefault(
          changes.default_value,
          options ?? field.options ?? [],
          field.type,
        ),
      ],
    ]),
  };
};
