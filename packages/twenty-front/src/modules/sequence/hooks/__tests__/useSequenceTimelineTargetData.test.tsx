import { renderHook } from '@testing-library/react';

import { useSequenceTimelineTargetData } from '@/sequence/hooks/useSequenceTimelineTargetData';
import { type TaskQueueRecord } from '~/pages/tasks/types/TaskQueueRecord';

let mockTask: Partial<TaskQueueRecord> | undefined;
let mockEnrollment: { personId: string } | undefined;
const mockUpsert = jest.fn();
const mockFindMany = jest.fn();

jest.mock('@/object-record/hooks/useFindOneRecord', () => ({
  useFindOneRecord: ({
    objectNameSingular,
    skip,
  }: {
    objectNameSingular: string;
    skip: boolean;
  }) => ({
    record: skip
      ? undefined
      : objectNameSingular === 'task'
        ? mockTask
        : mockEnrollment,
    loading: false,
    error: undefined,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/object-record/hooks/useFindManyRecords', () => ({
  useFindManyRecords: (options: unknown) => mockFindMany(options),
}));
jest.mock('@/object-record/record-store/hooks/useUpsertRecordsInStore', () => ({
  useUpsertRecordsInStore: () => ({ upsertRecordsInStore: mockUpsert }),
}));
jest.mock('@/object-metadata/hooks/useObjectMetadataItem', () => ({
  useObjectMetadataItem: ({
    objectNameSingular,
  }: {
    objectNameSingular: string;
  }) => ({ objectMetadataItem: { id: objectNameSingular } }),
}));
jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => ({ canUpdateObjectRecords: true }),
}));

describe('useSequenceTimelineTargetData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTask = {
      id: 'task',
      sequenceEnrollmentId: 'enrollment',
      taskTargets: [],
    };
    mockEnrollment = { personId: 'prospect' };
    mockFindMany.mockReturnValue({
      records: [{ id: 'prospect' }],
      loading: false,
    });
  });

  it('should resolve a prospect from the enrollment even without task targets', () => {
    const { result } = renderHook(() =>
      useSequenceTimelineTargetData({ taskId: 'task' }),
    );
    expect(result.current.personId).toBe('prospect');
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { id: { eq: 'prospect' } },
        limit: 1,
        skip: false,
      }),
    );
  });

  it('should not fall back to stale task targets when its enrollment cannot be read', () => {
    mockEnrollment = undefined;
    mockTask = {
      ...mockTask,
      taskTargets: [
        {
          id: 'target',
          targetPerson: { id: 'stale-person', linkedinLink: null },
        },
      ],
    };
    const { result } = renderHook(() =>
      useSequenceTimelineTargetData({
        taskId: 'task',
        personId: 'untrusted-person',
      }),
    );
    expect(result.current.personId).toBeUndefined();
    expect(result.current.person).toBeUndefined();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: true }),
    );
  });

  it('should not pick an arbitrary prospect on a task with multiple person targets', () => {
    mockTask = {
      ...mockTask,
      sequenceEnrollmentId: null,
      taskTargets: ['one', 'two'].map((id) => ({
        id,
        targetPerson: { id, linkedinLink: null },
      })),
    };
    const { result } = renderHook(() =>
      useSequenceTimelineTargetData({ taskId: 'task' }),
    );
    expect(result.current.personId).toBeUndefined();
  });

  it('should support a non-sequence task with one prospect', () => {
    mockTask = {
      ...mockTask,
      sequenceEnrollmentId: null,
      taskTargets: [
        { id: 'target', targetPerson: { id: 'prospect', linkedinLink: null } },
      ],
    };
    const { result } = renderHook(() =>
      useSequenceTimelineTargetData({ taskId: 'task' }),
    );
    expect(result.current.personId).toBe('prospect');
  });

  it('should load the direct person and initialize the timeline record store', () => {
    const { result } = renderHook(() =>
      useSequenceTimelineTargetData({ personId: 'prospect' }),
    );
    expect(result.current.person?.id).toBe('prospect');
    const records = [
      { id: 'prospect', name: { firstName: 'Jane', lastName: 'Doe' } },
    ];
    mockFindMany.mock.calls[0][0].onCompleted(records);
    expect(mockUpsert).toHaveBeenCalledWith({ partialRecords: records });
  });
});
