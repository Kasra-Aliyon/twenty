import { MainContextStoreProviderEffect } from '@/context-store/components/MainContextStoreProviderEffect';
import { metadataStoreState } from '@/metadata-store/states/metadataStoreState';
import { useIsSettingsPage } from '@/navigation/hooks/useIsSettingsPage';
import { useLastVisitedView } from '@/navigation/hooks/useLastVisitedView';
import { objectMetadataItemsSelector } from '@/object-metadata/states/objectMetadataItemsSelector';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { type ObjectRecord } from '@/object-record/types/ObjectRecord';
import { useAtomFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { viewsSelector } from '@/views/states/selectors/viewsSelector';
import { type View } from '@/views/types/View';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  AppPath,
  RECORD_LIST_TYPES,
  type RecordListType,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { ViewKey, ViewType } from '~/generated-metadata/graphql';
import { isMatchingLocation } from '~/utils/isMatchingLocation';

const getViewId = (
  viewIdFromQueryParams: string | null,
  indexViewId?: string,
  lastVisitedViewId?: string,
  firstAvailableViewId?: string,
) => {
  if (isDefined(viewIdFromQueryParams)) {
    return viewIdFromQueryParams;
  }

  if (isDefined(lastVisitedViewId)) {
    return lastVisitedViewId;
  }

  if (isDefined(indexViewId)) {
    return indexViewId;
  }

  if (isDefined(firstAvailableViewId)) {
    return firstAvailableViewId;
  }

  return undefined;
};

const RecordListMainContextStoreProvider = ({
  recordListId,
  objectMetadataItems,
  views,
}: {
  recordListId?: string;
  objectMetadataItems: EnrichedObjectMetadataItem[];
  views: View[];
}) => {
  const { record: recordList } = useFindOneRecord<
    ObjectRecord & { type: RecordListType }
  >({
    objectNameSingular: 'recordList',
    objectRecordId: recordListId,
    recordGqlFields: { id: true, name: true, type: true, folderId: true },
  });

  const recordListObjectName = isDefined(recordList)
    ? {
        [RECORD_LIST_TYPES.COMPANY]: 'company',
        [RECORD_LIST_TYPES.PERSON]: 'person',
        [RECORD_LIST_TYPES.OPPORTUNITY]: 'opportunity',
      }[recordList.type]
    : undefined;
  const objectMetadataItem = objectMetadataItems.find(
    (item) => item.nameSingular === recordListObjectName,
  );
  const viewId = views.find((view) => view.recordListId === recordListId)?.id;

  return (
    <MainContextStoreProviderEffect
      viewId={viewId}
      objectMetadataItem={objectMetadataItem}
      isRecordIndexPage
      isRecordShowPage={false}
      isStandalonePage={false}
      isSettingsPage={false}
    />
  );
};

export const MainContextStoreProvider = () => {
  const location = useLocation();
  const isRecordIndexPage = isMatchingLocation(
    location,
    AppPath.RecordIndexPage,
  );
  const isRecordShowPage = isMatchingLocation(location, AppPath.RecordShowPage);
  const isRecordListPage = isMatchingLocation(location, AppPath.RecordListPage);
  const isStandalonePage = isMatchingLocation(location, AppPath.PageLayoutPage);
  const isSettingsPage = useIsSettingsPage();

  const objectNamePlural = useParams().objectNamePlural ?? '';
  const objectNameSingular = useParams().objectNameSingular ?? '';
  const recordListId = useParams().recordListId;

  const [searchParams] = useSearchParams();
  const viewIdQueryParamRaw = searchParams.get('viewId');

  const objectMetadataItems = useAtomStateValue(objectMetadataItemsSelector);
  const metadataStore = useAtomFamilyStateValue(metadataStoreState, 'views');
  const views = useAtomStateValue(viewsSelector);

  const { getLastVisitedViewIdFromObjectNamePlural } = useLastVisitedView();

  const shouldComputeContextStore =
    (isRecordIndexPage ||
      isRecordShowPage ||
      isRecordListPage ||
      isStandalonePage ||
      isSettingsPage) &&
    metadataStore.status === 'up-to-date';

  if (!shouldComputeContextStore) {
    return null;
  }

  if (isRecordListPage) {
    const hasRecordListMetadata = objectMetadataItems.some(
      (item) => item.nameSingular === 'recordList',
    );

    return hasRecordListMetadata ? (
      <RecordListMainContextStoreProvider
        recordListId={recordListId}
        objectMetadataItems={objectMetadataItems}
        views={views}
      />
    ) : null;
  }

  const objectMetadataItem = objectMetadataItems.find(
    (item) =>
      item.namePlural === objectNamePlural ||
      item.nameSingular === objectNameSingular,
  );

  const viewIdQueryParamView = views.find(
    (view) => view.id === viewIdQueryParamRaw,
  );

  const viewIdQueryParam =
    isDefined(viewIdQueryParamView) &&
    viewIdQueryParamView.type !== ViewType.FIELDS_WIDGET
      ? viewIdQueryParamRaw
      : null;

  const lastVisitedViewIdRaw = getLastVisitedViewIdFromObjectNamePlural(
    objectMetadataItem?.namePlural ?? '',
  );

  const lastVisitedView = views.find(
    (view) => view.id === lastVisitedViewIdRaw,
  );

  const lastVisitedViewId =
    isDefined(lastVisitedView) &&
    lastVisitedView.type !== ViewType.FIELDS_WIDGET
      ? lastVisitedViewIdRaw
      : undefined;

  const indexViewId = views.find(
    (view) =>
      view.objectMetadataId === objectMetadataItem?.id &&
      view.key === ViewKey.INDEX,
  )?.id;

  const firstAvailableViewId = views.find(
    (view) =>
      view.objectMetadataId === objectMetadataItem?.id &&
      view.type !== ViewType.FIELDS_WIDGET,
  )?.id;

  const viewId = getViewId(
    viewIdQueryParam,
    indexViewId,
    lastVisitedViewId,
    firstAvailableViewId,
  );

  return (
    <MainContextStoreProviderEffect
      viewId={viewId}
      objectMetadataItem={objectMetadataItem}
      isRecordIndexPage={isRecordIndexPage}
      isRecordShowPage={isRecordShowPage}
      isStandalonePage={isStandalonePage}
      isSettingsPage={isSettingsPage}
    />
  );
};
