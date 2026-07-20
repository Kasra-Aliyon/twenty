import { useEffect } from 'react';

import { useColumnDefinitionsFromObjectMetadata } from '@/object-metadata/hooks/useColumnDefinitionsFromObjectMetadata';
import { type EnrichedObjectMetadataItem } from '@/object-metadata/types/EnrichedObjectMetadataItem';
import { useInitViewBar } from '@/views/hooks/useInitViewBar';

type RecordIndexViewBarEffectProps = {
  objectMetadataItem: EnrichedObjectMetadataItem;
  viewBarId: string;
};

export const RecordIndexViewBarEffect = ({
  objectMetadataItem,
  viewBarId,
}: RecordIndexViewBarEffectProps) => {
  const { columnDefinitions } =
    useColumnDefinitionsFromObjectMetadata(objectMetadataItem);

  const { setViewObjectMetadataId, setAvailableFieldDefinitions } =
    useInitViewBar(viewBarId);

  useEffect(() => {
    setViewObjectMetadataId?.(objectMetadataItem.id);
    setAvailableFieldDefinitions?.(columnDefinitions);
  }, [
    setViewObjectMetadataId,
    objectMetadataItem,
    setAvailableFieldDefinitions,
    columnDefinitions,
  ]);

  return <></>;
};
