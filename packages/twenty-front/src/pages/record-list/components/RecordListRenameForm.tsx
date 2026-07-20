import { t } from '@lingui/core/macro';
import { Button } from 'twenty-ui/input';

import { type EditingRecordListItem } from '../types/RecordListRecords';
import { StyledForm, StyledInput } from './RecordListsPageStyles';

export const RecordListRenameForm = ({
  editingItem,
  isSaving,
  onChange,
  onCancel,
  onSave,
}: {
  editingItem: EditingRecordListItem;
  isSaving: boolean;
  onChange: (editingItem: EditingRecordListItem) => void;
  onCancel: () => void;
  onSave: () => void;
}) => (
  <StyledForm
    onSubmit={(event) => {
      event.preventDefault();
      onSave();
    }}
  >
    <StyledInput
      value={editingItem.name}
      onChange={(event) =>
        onChange({ ...editingItem, name: event.target.value })
      }
      aria-label={t`Rename`}
      required
    />
    <Button title={t`Save`} type="submit" disabled={isSaving} />
    <Button title={t`Cancel`} variant="secondary" onClick={onCancel} />
  </StyledForm>
);
