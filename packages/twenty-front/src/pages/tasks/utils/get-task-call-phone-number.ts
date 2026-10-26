import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { isDefined } from 'twenty-shared/utils';
import { z } from 'zod';

import { type TaskQueueRecord } from '../types/TaskQueueRecord';

const additionalPhoneSchema = z.object({
  number: z.string(),
  callingCode: z.string().nullish(),
});

const parseAdditionalPhones = (value: unknown) => {
  try {
    const parsedValue: unknown =
      typeof value === 'string' ? JSON.parse(value) : value;

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.flatMap((phone: unknown) => {
      const result = additionalPhoneSchema.safeParse(phone);

      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
};

export const getTaskCallPhoneNumber = (
  task: TaskQueueRecord,
): string | undefined => {
  for (const taskTarget of task.taskTargets ?? []) {
    const phones = taskTarget.targetPerson?.phones;

    if (!isDefined(phones)) {
      continue;
    }

    const candidates = [
      {
        number: phones.primaryPhoneNumber,
        callingCode: phones.primaryPhoneCallingCode,
      },
      ...parseAdditionalPhones(phones.additionalPhones),
    ];

    for (const candidate of candidates) {
      const phoneNumber = parsePhoneNumberFromString(
        candidate.number?.trim() ?? '',
        {
          defaultCallingCode:
            candidate.callingCode?.trim().replace(/^\+/, '') || undefined,
          extract: false,
        },
      );

      if (phoneNumber?.isPossible()) {
        return phoneNumber.number;
      }
    }
  }

  return undefined;
};
