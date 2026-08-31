import { sanitizeValueForCSVExport } from '@/spreadsheet-import/utils/sanitizeValueForCSVExport';
import { saveAs } from 'file-saver';
import { json2csv } from 'json-2-csv';

import { type TaskQueueRecord } from '../types/TaskQueueRecord';

const SEQUENCE_CALLS_CSV_COLUMNS = [
  'name',
  'phone',
  'email',
  'title',
  'company',
  'country',
  'website',
] as const;

const SAFE_INTERNATIONAL_PHONE_NUMBER = /^\+(?=.*\d)[+\d\s().:-]+$/;

type SequenceCallsCsvRow = Record<
  (typeof SEQUENCE_CALLS_CSV_COLUMNS)[number],
  string
>;

type AdditionalPhone = {
  number: string;
  callingCode: string;
};

const isAdditionalPhone = (value: unknown): value is AdditionalPhone =>
  typeof value === 'object' &&
  value !== null &&
  'number' in value &&
  typeof value.number === 'string' &&
  'callingCode' in value &&
  typeof value.callingCode === 'string';

const parseAdditionalPhones = (value: unknown): AdditionalPhone[] => {
  try {
    const parsedValue = typeof value === 'string' ? JSON.parse(value) : value;

    return Array.isArray(parsedValue)
      ? parsedValue.filter(isAdditionalPhone)
      : [];
  } catch {
    return [];
  }
};

const sanitizePhoneNumber = (phoneNumber: string) =>
  SAFE_INTERNATIONAL_PHONE_NUMBER.test(phoneNumber)
    ? phoneNumber
    : sanitizeValueForCSVExport(phoneNumber);

export const buildSequenceCallsCsvRows = (
  tasks: TaskQueueRecord[],
): SequenceCallsCsvRow[] => {
  const exportedPersonIds = new Set<string>();
  const rows: SequenceCallsCsvRow[] = [];

  for (const task of tasks) {
    for (const taskTarget of task.taskTargets) {
      const person = taskTarget.targetPerson;

      if (person === null || exportedPersonIds.has(person.id)) {
        continue;
      }

      exportedPersonIds.add(person.id);

      const primaryPhoneNumber =
        person.phones?.primaryPhoneNumber?.trim() ?? '';
      const primaryPhoneCallingCode =
        person.phones?.primaryPhoneCallingCode?.trim() ?? '';
      const phoneNumbers = [
        primaryPhoneNumber
          ? `${primaryPhoneCallingCode}${primaryPhoneNumber}`
          : null,
        ...parseAdditionalPhones(person.phones?.additionalPhones).map(
          ({ callingCode, number }) => `${callingCode.trim()}${number.trim()}`,
        ),
      ].filter((phoneNumber): phoneNumber is string => Boolean(phoneNumber));
      const fullName = [
        person.name?.firstName?.trim(),
        person.name?.lastName?.trim(),
      ]
        .filter((namePart): namePart is string => Boolean(namePart))
        .join(' ');

      rows.push({
        name: sanitizeValueForCSVExport(fullName),
        phone: sanitizePhoneNumber(phoneNumbers.join(' : ')),
        email: sanitizeValueForCSVExport(
          person.emails?.primaryEmail?.trim() ?? '',
        ),
        title: sanitizeValueForCSVExport(person.jobTitle?.trim() ?? ''),
        company: sanitizeValueForCSVExport(person.company?.name?.trim() ?? ''),
        country: sanitizeValueForCSVExport(
          person.address?.addressCountry?.trim() ?? '',
        ),
        website: sanitizeValueForCSVExport(
          person.linkedinLink?.primaryLinkUrl?.trim() ?? '',
        ),
      });
    }
  }

  return rows;
};

export const generateSequenceCallsCsv = (tasks: TaskQueueRecord[]) =>
  json2csv(buildSequenceCallsCsvRows(tasks), {
    keys: [...SEQUENCE_CALLS_CSV_COLUMNS],
    emptyFieldValue: '',
  });

export const downloadSequenceCallsCsv = (tasks: TaskQueueRecord[]) => {
  const csv = generateSequenceCallsCsv(tasks);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

  saveAs(blob, 'sequence-calls.csv');
};
