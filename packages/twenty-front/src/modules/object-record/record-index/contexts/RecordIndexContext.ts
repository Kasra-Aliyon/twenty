import { createContext, type ReactNode, useContext } from 'react';
import {
  type ObjectPermissions,
  type RecordGqlOperationFilter,
} from 'twenty-shared/types';

import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { type RecordField } from '@/object-record/record-field/types/RecordField';
import { type FieldMetadata } from '@/object-record/record-field/ui/types/FieldMetadata';
import { type ColumnDefinition } from '@/object-record/record-table/types/ColumnDefinition';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { createAtomFamilyState } from '@/ui/utilities/state/jotai/utils/createAtomFamilyState';

export type RecordIndexContextValue = {
  indexIdentifierUrl: (recordId: string) => string;
  onIndexRecordsLoaded: () => void;
  onRecordCreated?: (record: ObjectRecord) => Promise<void> | void;
  objectNamePlural: string;
  objectNameSingular: string;
  objectMetadataItem: EnrichedObjectMetadataItem;
  objectPermissionsByObjectMetadataId: Record<
    string,
    ObjectPermissions & { objectMetadataId: string }
  >;
  recordIndexId: string;
  viewBarInstanceId: string;
  recordFieldByFieldMetadataItemId: Record<string, RecordField>;
  labelIdentifierFieldMetadataItem: FieldMetadataItem | undefined;
  fieldMetadataItemByFieldMetadataItemId: Record<string, FieldMetadataItem>;
  fieldDefinitionByFieldMetadataItemId: Record<
    string,
    ColumnDefinition<FieldMetadata>
  >;
  recordLimit?: number;
  requiredFilter?: RecordGqlOperationFilter;
  isInlineRecordCreationDisabled?: boolean;
  skipPostOptimisticEffectOnRecordCreate?: boolean;
  pageTitle?: string;
  pageHeaderTag?: string;
  pageActions?: ReactNode;
};

const RecordIndexContext = createContext<RecordIndexContextValue | undefined>(
  undefined,
);

RecordIndexContext.displayName = 'RecordIndexContextProvider';

export const RecordIndexContextProvider = RecordIndexContext.Provider;

export const useRecordIndexContext = () => useContext(RecordIndexContext);

export const useRecordIndexContextOrThrow = () => {
  const context = useRecordIndexContext();

  if (context === undefined) {
    throw new Error(
      'RecordIndexContext Context not found. Please wrap your component tree with <RecordIndexContextProvider> before using useRecordIndexContextOrThrow().',
    );
  }

  return context;
};

export const recordIndexRequiredFilterFamilyState = createAtomFamilyState<
  RecordGqlOperationFilter | undefined,
  string
>({
  key: 'recordIndexRequiredFilterFamilyState',
  defaultValue: undefined,
});
