import { useSortable } from '@dnd-kit/react/sortable';
import { styled } from '@linaria/react';
import { type ReactNode } from 'react';

const StyledSortableItem = styled.div`
  cursor: grab;
  min-width: 0;

  &:active {
    cursor: grabbing;
  }
`;

type RecordListSortableItemProps = {
  children: ReactNode;
  disabled: boolean;
  group: string;
  id: string;
  index: number;
};

export const RecordListSortableItem = ({
  children,
  disabled,
  group,
  id,
  index,
}: RecordListSortableItemProps) => {
  const { handleRef, ref } = useSortable({
    id,
    index,
    group,
    disabled,
    feedback: 'clone',
    transition: null,
  });

  return (
    <StyledSortableItem
      ref={(element) => {
        ref(element);
        handleRef?.(element);
      }}
    >
      {children}
    </StyledSortableItem>
  );
};
