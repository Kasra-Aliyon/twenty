import {
  buildSequenceCallsCsvRows,
  generateSequenceCallsCsv,
} from '~/pages/tasks/utils/generate-sequence-calls-csv';
import { type TaskQueueRecord } from '~/pages/tasks/types/TaskQueueRecord';

const buildTask = ({
  taskId,
  personId,
  firstName = 'Jane',
  lastName = 'Doe',
  additionalPhones = [
    {
      callingCode: '+46',
      number: '701234567',
    },
  ],
}: {
  taskId: string;
  personId: string;
  firstName?: string;
  lastName?: string;
  additionalPhones?: Array<{ callingCode: string; number: string }> | string;
}): TaskQueueRecord =>
  ({
    id: taskId,
    title: 'Call contact',
    status: 'TODO',
    dueAt: null,
    type: 'CALL',
    priority: 'MEDIUM',
    sequenceEnrollmentId: 'enrollment-id',
    taskTargets: [
      {
        id: `target-${taskId}`,
        targetPerson: {
          id: personId,
          name: { firstName, lastName },
          phones: {
            primaryPhoneCallingCode: '+358',
            primaryPhoneNumber: '401234567',
            additionalPhones,
          },
          emails: { primaryEmail: 'jane@example.com' },
          jobTitle: 'Sales, Director',
          company: { name: 'Acme "North"' },
          address: { addressCountry: 'FI' },
          linkedinLink: {
            primaryLinkUrl: 'https://www.linkedin.com/in/jane-doe',
          },
        },
      },
    ],
  }) as TaskQueueRecord;

describe('generateSequenceCallsCsv', () => {
  it('generates the exact requested CloudTalk columns and field mappings', () => {
    const csv = generateSequenceCallsCsv([
      buildTask({ taskId: 'task-1', personId: 'person-1' }),
    ]);

    expect(csv).toBe(
      'name,phone,email,title,company,country,website\n' +
        'Jane Doe,+358401234567 : +46701234567,jane@example.com,"Sales, Director",' +
        '"Acme ""North""",FI,https://www.linkedin.com/in/jane-doe',
    );
  });

  it('exports each person once when they have multiple call tasks', () => {
    const rows = buildSequenceCallsCsvRows([
      buildTask({ taskId: 'task-1', personId: 'person-1' }),
      buildTask({ taskId: 'task-2', personId: 'person-1' }),
      buildTask({
        taskId: 'task-3',
        personId: 'person-2',
        firstName: 'John',
        lastName: 'Smith',
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map(({ name }) => name)).toEqual(['Jane Doe', 'John Smith']);
  });

  it('keeps legitimate international phone numbers importable', () => {
    const [row] = buildSequenceCallsCsvRows([
      buildTask({ taskId: 'task-1', personId: 'person-1' }),
    ]);

    expect(row.phone).toBe('+358401234567 : +46701234567');
  });

  it('supports legacy serialized additional phone values', () => {
    const [row] = buildSequenceCallsCsvRows([
      buildTask({
        taskId: 'task-1',
        personId: 'person-1',
        additionalPhones: JSON.stringify([
          { callingCode: '+44', number: '7700900123' },
        ]),
      }),
    ]);

    expect(row.phone).toBe('+358401234567 : +447700900123');
  });

  it('sanitizes spreadsheet formulas in non-phone contact fields', () => {
    const task = buildTask({
      taskId: 'task-1',
      personId: 'person-1',
      firstName: '=FORMULA()',
      lastName: '',
    });

    const [row] = buildSequenceCallsCsvRows([task]);

    expect(row.name).toBe('\u200D=FORMULA()');
  });
});
