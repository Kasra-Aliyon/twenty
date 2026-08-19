import { dateAtMillisecondPrecisionFindOperator } from 'src/modules/sequence/utils/date-at-millisecond-precision-find-operator.util';

describe('dateAtMillisecondPrecisionFindOperator', () => {
  it('compares a database timestamp at the precision retained by JavaScript dates', () => {
    const date = new Date('2026-08-13T21:03:00.174Z');
    const operator = dateAtMillisecondPrecisionFindOperator(date);

    expect(operator.type).toBe('raw');
    expect(operator.objectLiteralParameters).toEqual({
      snapshotUpdatedAt: date.toISOString(),
    });
    expect(operator.getSql?.('"updatedAt"')).toBe(
      `date_trunc('milliseconds', "updatedAt") = :snapshotUpdatedAt`,
    );
  });

  it('normalizes serialized workspace timestamps', () => {
    const operator = dateAtMillisecondPrecisionFindOperator(
      '2026-08-13T21:03:00.174Z',
    );

    expect(operator.objectLiteralParameters).toEqual({
      snapshotUpdatedAt: '2026-08-13T21:03:00.174Z',
    });
  });
});
