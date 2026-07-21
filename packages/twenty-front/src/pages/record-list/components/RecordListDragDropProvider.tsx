import { PointerActivationConstraints } from '@dnd-kit/dom';
import { DragDropProvider, PointerSensor } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import { type ComponentProps, type ReactNode } from 'react';

const RECORD_LIST_DRAG_SENSORS = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 8 }),
    ],
  }),
];

type RecordListDragDropProviderProps = {
  children: ReactNode;
  onReorder: (group: string, fromIndex: number, toIndex: number) => void;
};

export const RecordListDragDropProvider = ({
  children,
  onReorder,
}: RecordListDragDropProviderProps) => {
  const handleDragEnd: ComponentProps<typeof DragDropProvider>['onDragEnd'] = (
    event,
  ) => {
    if (event.canceled) {
      return;
    }

    const { source } = event.operation;

    if (
      isSortable(source) &&
      typeof source.group === 'string' &&
      source.initialIndex !== source.index
    ) {
      onReorder(source.group, source.initialIndex, source.index);
    }
  };

  return (
    <DragDropProvider
      sensors={RECORD_LIST_DRAG_SENSORS}
      onDragEnd={handleDragEnd}
    >
      {children}
    </DragDropProvider>
  );
};
