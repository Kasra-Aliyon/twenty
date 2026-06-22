import { Injectable } from '@nestjs/common';

import {
  type ObjectRecordCreateEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { objectRecordChangedProperties as objectRecordUpdateEventChangedProperties } from 'src/engine/core-modules/event-emitter/utils/object-record-changed-properties.util';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { ApolloEnrichmentMapperService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-mapper.service';
import { ApolloEnrichmentQueueService } from 'src/modules/apollo-enrichment/services/apollo-enrichment-queue.service';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';

@Injectable()
export class ApolloEnrichmentPersonListener {
  constructor(
    private readonly apolloEnrichmentMapperService: ApolloEnrichmentMapperService,
    private readonly apolloEnrichmentQueueService: ApolloEnrichmentQueueService,
  ) {}

  @OnDatabaseBatchEvent('person', DatabaseEventAction.CREATED)
  async handleCreatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordCreateEvent<PersonWorkspaceEntity>
    >,
  ): Promise<void> {
    const peopleToEnrich = payload.events.filter((eventPayload) =>
      this.apolloEnrichmentMapperService.shouldEnrichPerson(
        eventPayload.properties.after,
      ),
    );

    for (const person of peopleToEnrich) {
      await this.apolloEnrichmentQueueService.enqueuePerson({
        workspaceId: payload.workspaceId,
        personId: person.recordId,
        trigger: 'person.created',
      });
    }
  }

  @OnDatabaseBatchEvent('person', DatabaseEventAction.UPDATED)
  async handleUpdatedEvent(
    payload: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<PersonWorkspaceEntity>
    >,
  ): Promise<void> {
    const peopleToEnrich = payload.events.filter((eventPayload) => {
      const changedFields = objectRecordUpdateEventChangedProperties(
        eventPayload.properties.before,
        eventPayload.properties.after,
      );

      return this.apolloEnrichmentMapperService.shouldEnrichAfterUpdate({
        before: eventPayload.properties.before,
        after: eventPayload.properties.after,
        changedFields,
      });
    });

    for (const person of peopleToEnrich) {
      await this.apolloEnrichmentQueueService.enqueuePerson({
        workspaceId: payload.workspaceId,
        personId: person.recordId,
        trigger: 'person.updated',
      });
    }
  }
}
