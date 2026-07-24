import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { type SelectOption } from 'twenty-ui/input';

import { type LinkedinUniboxDataset } from '@/unibox/types/LinkedinUniboxRecords';
import { Select } from '@/ui/input/components/Select';

const LINKEDIN_DATASET_OPTIONS: SelectOption<LinkedinUniboxDataset>[] = [
  { value: 'CONNECTIONS', label: t`LinkedIn connections` },
  { value: 'INVITATIONS', label: t`LinkedIn invitations` },
  { value: 'MESSAGE_THREADS', label: t`LinkedIn message threads` },
  { value: 'MESSAGES', label: t`LinkedIn messages` },
];

const StyledPicker = styled.div`
  min-width: 210px;
  width: 210px;
`;

export const UniboxLinkedInDatasetPicker = ({
  value,
  onChange,
}: {
  value: LinkedinUniboxDataset;
  onChange: (value: LinkedinUniboxDataset) => void;
}) => (
  <StyledPicker>
    <Select
      dropdownId="unibox-linkedin-dataset"
      dropdownWidth={260}
      fullWidth
      selectSizeVariant="small"
      value={value}
      options={LINKEDIN_DATASET_OPTIONS}
      onChange={onChange}
    />
  </StyledPicker>
);
