import { Injectable } from '@nestjs/common';

import { type ObjectRecord } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { In, MoreThan } from 'typeorm';

import { objectRecordDiffMerge } from 'src/engine/core-modules/event-emitter/utils/object-record-diff-merge';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type TimelineActivityPayload } from 'src/modules/timeline/types/timeline-activity-payload';
import { buildTimelineActivityRelatedMorphFieldMetadataName } from 'src/modules/timeline/utils/timeline-activity-related-morph-field-metadata-name-builder.util';

type TimelineActivityPayloadWorkspaceIdAndObjectSingularName = {
  payloads: (Omit<TimelineActivityPayload, 'properties'> & {
    properties: Pick<TimelineActivityPayload['properties'], 'diff'>;
  })[];
  workspaceId: string;
  objectSingularName: string;
};

@Injectable()
export class TimelineActivityRepository {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async upsertTimelineActivities({
    objectSingularName,
    workspaceId,
    payloads,
  }: TimelineActivityPayloadWorkspaceIdAndObjectSingularName) {
    if (payloads.length === 0) {
      return;
    }

    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
      const existingTimelineActivities =
        await this.findTimelineActivitiesForUpsert({
          objectSingularName,
          workspaceId,
          payloads,
        });

      const normalizedPayloadsToUpsert = payloads.flatMap(
        ({ name, properties, ...rest }) => {
          const [objectName, action] = name.split('.');
          const { diff } = properties;
          const hasDiff = isDefined(diff) && Object.keys(diff).length > 0;

          if (objectName.startsWith('linked-')) {
            return [{ ...rest, name, properties: hasDiff ? { diff } : {} }];
          }

          if (action === 'updated') {
            return hasDiff ? [{ ...rest, name, properties: { diff } }] : [];
          }

          return [{ ...rest, name, properties: {} }];
        },
      );
      const deterministicPayloadsById = new Map<
        string,
        (typeof normalizedPayloadsToUpsert)[number]
      >();

      for (const payload of normalizedPayloadsToUpsert) {
        if (isDefined(payload.id)) {
          deterministicPayloadsById.set(payload.id, payload);
        }
      }

      const payloadsToUpsert = [
        ...normalizedPayloadsToUpsert.filter(({ id }) => !isDefined(id)),
        ...deterministicPayloadsById.values(),
      ];

      const payloadsToInsert: TimelineActivityPayloadWorkspaceIdAndObjectSingularName['payloads'] =
        [];

      const timelineActivityPropertyName =
        await this.getTimelineActivityPropertyName(objectSingularName);

      for (const payload of payloadsToUpsert) {
        const existingTimelineActivity = existingTimelineActivities.find(
          (timelineActivity) =>
            isDefined(payload.id)
              ? timelineActivity.id === payload.id
              : timelineActivity[timelineActivityPropertyName] ===
                  payload.recordId &&
                timelineActivity.workspaceMemberId ===
                  payload.workspaceMemberId &&
                (!isDefined(payload.linkedRecordId) ||
                  timelineActivity.linkedRecordId === payload.linkedRecordId) &&
                timelineActivity.name === payload.name,
        );

        if (existingTimelineActivity) {
          const mergedProperties = objectRecordDiffMerge(
            existingTimelineActivity.properties,
            payload.properties,
          );

          await this.updateTimelineActivity({
            id: existingTimelineActivity.id,
            happensAt: payload.happensAt,
            linkedObjectMetadataId: payload.linkedObjectMetadataId,
            linkedRecordCachedName: payload.linkedRecordCachedName,
            linkedRecordId: payload.linkedRecordId,
            name: payload.name,
            properties: mergedProperties,
            recordId: payload.recordId,
            timelineActivityPropertyName,
            workspaceMemberId: payload.workspaceMemberId,
            workspaceId,
          });
        } else {
          payloadsToInsert.push(payload);
        }
      }

      await this.insertTimelineActivities({
        objectSingularName,
        payloads: payloadsToInsert,
        workspaceId,
      });
    }, authContext);
  }

  private async findTimelineActivitiesForUpsert({
    objectSingularName,
    workspaceId,
    payloads,
  }: TimelineActivityPayloadWorkspaceIdAndObjectSingularName) {
    const timelineActivityTypeORMRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        'timelineActivity',
        {
          shouldBypassPermissionChecks: true,
        },
      );

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const timelineActivityPropertyName =
      await this.getTimelineActivityPropertyName(objectSingularName);

    const whereConditions: Record<string, unknown> = {
      [timelineActivityPropertyName]: In(
        payloads.map((payload) => payload.recordId),
      ),
      name: In(payloads.map((payload) => payload.name)),
      workspaceMemberId: In(
        payloads.map((payload) => payload.workspaceMemberId || null),
      ),
      createdAt: MoreThan(tenMinutesAgo),
    };

    const deterministicIds = payloads.map(({ id }) => id).filter(isDefined);

    const recentTimelineActivities =
      await timelineActivityTypeORMRepository.find({
        where: whereConditions,
        order: { createdAt: 'DESC' },
      });
    const deterministicTimelineActivities =
      deterministicIds.length === 0
        ? recentTimelineActivities.slice(0, 0)
        : await timelineActivityTypeORMRepository.find({
            where: { id: In(deterministicIds) },
          });

    return [
      ...deterministicTimelineActivities,
      ...recentTimelineActivities.filter(
        ({ id }) =>
          !deterministicTimelineActivities.some(
            (timelineActivity) => timelineActivity.id === id,
          ),
      ),
    ];
  }

  public async insertTimelineActivities({
    objectSingularName,
    workspaceId,
    payloads,
  }: TimelineActivityPayloadWorkspaceIdAndObjectSingularName) {
    if (payloads.length === 0) {
      return;
    }

    const timelineActivityTypeORMRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        'timelineActivity',
        {
          shouldBypassPermissionChecks: true,
        },
      );

    const timelineActivityPropertyName =
      await this.getTimelineActivityPropertyName(objectSingularName);

    const timelineActivityRecords = payloads.map((payload) => ({
      id: payload.id,
      happensAt: payload.happensAt,
      name: payload.name,
      properties: payload.properties,
      workspaceMemberId: payload.workspaceMemberId,
      [timelineActivityPropertyName]: payload.recordId,
      linkedRecordCachedName: payload.linkedRecordCachedName ?? '',
      linkedRecordId: payload.linkedRecordId,
      linkedObjectMetadataId: payload.linkedObjectMetadataId,
    }));
    const recordsWithDeterministicIds = timelineActivityRecords.filter(
      ({ id }) => isDefined(id),
    );
    const recordsWithoutDeterministicIds = timelineActivityRecords.filter(
      ({ id }) => !isDefined(id),
    );

    const results = await Promise.all([
      recordsWithDeterministicIds.length === 0
        ? undefined
        : timelineActivityTypeORMRepository.upsert(
            recordsWithDeterministicIds,
            ['id'],
          ),
      recordsWithoutDeterministicIds.length === 0
        ? undefined
        : timelineActivityTypeORMRepository.insert(
            recordsWithoutDeterministicIds,
          ),
    ]);

    return results.filter(isDefined);
  }

  private async updateTimelineActivity({
    id,
    happensAt,
    linkedObjectMetadataId,
    linkedRecordCachedName,
    linkedRecordId,
    name,
    properties,
    recordId,
    timelineActivityPropertyName,
    workspaceMemberId,
    workspaceId,
  }: {
    id: string;
    happensAt: Date | undefined;
    linkedObjectMetadataId: string | undefined;
    linkedRecordCachedName: string | undefined;
    linkedRecordId: string | undefined;
    name: string;
    properties: Partial<ObjectRecord>;
    recordId: string;
    timelineActivityPropertyName: string;
    workspaceMemberId: string | undefined;
    workspaceId: string;
  }) {
    const timelineActivityTypeORMRepository =
      await this.globalWorkspaceOrmManager.getRepository(
        workspaceId,
        'timelineActivity',
        {
          shouldBypassPermissionChecks: true,
        },
      );

    return timelineActivityTypeORMRepository.update(id, {
      ...(isDefined(happensAt) ? { happensAt } : {}),
      ...(isDefined(linkedObjectMetadataId) ? { linkedObjectMetadataId } : {}),
      ...(isDefined(linkedRecordCachedName) ? { linkedRecordCachedName } : {}),
      ...(isDefined(linkedRecordId) ? { linkedRecordId } : {}),
      [timelineActivityPropertyName]: recordId,
      name,
      properties,
      workspaceMemberId,
    });
  }

  private async getTimelineActivityPropertyName(objectSingularName: string) {
    return `${buildTimelineActivityRelatedMorphFieldMetadataName(objectSingularName)}Id`;
  }
}
