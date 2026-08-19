import { Raw, type FindOperator } from 'typeorm';

export const dateAtMillisecondPrecisionFindOperator = (
  date: Date | string,
): FindOperator<string> => {
  const timestamp = date instanceof Date ? date : new Date(date);

  return Raw(
    (columnAlias) =>
      `date_trunc('milliseconds', ${columnAlias}) = :snapshotUpdatedAt`,
    { snapshotUpdatedAt: timestamp.toISOString() },
  );
};
