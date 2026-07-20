export const RECORD_LIST_TYPES = {
  COMPANY: 'COMPANY',
  PERSON: 'PERSON',
  OPPORTUNITY: 'OPPORTUNITY',
} as const;

export type RecordListType =
  (typeof RECORD_LIST_TYPES)[keyof typeof RECORD_LIST_TYPES];
