import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WorkspaceIteratorModule } from 'src/database/commands/command-runners/workspace-iterator.module';
import { MigrateManualTriggerVariablesToPayloadCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000001000-migrate-manual-trigger-variables-to-payload.command';
import { SyncCalendarEventRecordPageCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000002000-sync-calendar-event-record-page.command';
import { RenameConflictingCompanyFieldsCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000003000-rename-conflicting-company-fields.command';
import { AddCompanyFieldsCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000004000-add-company-fields.command';
import { AddRecordListsCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000005000-add-record-lists.command';
import { MakeRecordListFolderOptionalCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000006000-make-record-list-folder-optional.command';
import { AddOutreachSequencesCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000007000-add-outreach-sequences.command';
import { AddLinkedinConnectorCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000008000-add-linkedin-connector.command';
import { AddUniboxCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000009000-add-unibox.command';
import { EnableLinkedinDirectMessagesCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000010000-enable-linkedin-direct-messages.command';
import { ExpandSequenceBuilderCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000011000-expand-sequence-builder.command';
import { RenameSequenceTasksNavigationItemCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000012000-rename-sequence-tasks-navigation-item.command';
import { BackfillLinkedinConnectionPersonMatchesCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000013000-backfill-linkedin-connection-person-matches.command';
import { ScopeLinkedinActionsToSendersCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000014000-scope-linkedin-actions-to-senders.command';
import { BackfillLinkedinParticipantPersonMatchesCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000015000-backfill-linkedin-participant-person-matches.command';
import { ArchiveLegacyLinkedinUiCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000016000-archive-legacy-linkedin-ui.command';
import { AddPersonLinkedinConnectedAtCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000017000-add-person-linkedin-connected-at.command';
import { AddPersonAndCompanyCountryColumnsCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000018000-add-person-and-company-country-columns.command';
import { AddCompanyCountryViewFieldCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000019000-add-company-country-view-field.command';
import { AddLinkedinMessageReadReceiptsCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000020000-add-linkedin-message-read-receipts.command';
import { BackstopSequenceEmailLimitColumnsCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000021000-backstop-sequence-email-limit-columns.command';
import { AddPersonTimeZoneCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000022000-add-person-time-zone.command';
import { AddLinkedinNavigationItemCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000023000-add-linkedin-navigation-item.command';
import { RecomputeSequenceCountersCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000024000-recompute-sequence-counters.command';
import { AddSequenceApolloWaitingStatesCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000027000-add-sequence-apollo-waiting-states.command';
import { ShowApolloLocationColumnsCommand } from 'src/database/commands/upgrade-version-command/2-15/2-15-workspace-command-1800000028000-show-apollo-location-columns.command';
import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { FeatureFlagModule } from 'src/engine/core-modules/feature-flag/feature-flag.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { FieldMetadataModule } from 'src/engine/metadata-modules/field-metadata/field-metadata.module';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { WorkspaceMetadataVersionModule } from 'src/engine/metadata-modules/workspace-metadata-version/workspace-metadata-version.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { WorkspaceMigrationModule } from 'src/engine/workspace-manager/workspace-migration/workspace-migration.module';
import { LinkedinModule } from 'src/modules/linkedin/linkedin.module';
import { SequenceMetricsService } from 'src/modules/sequence/services/sequence-metrics.service';

@Module({
  imports: [
    ApplicationModule,
    FeatureFlagModule,
    WorkspaceIteratorModule,
    WorkspaceCacheModule,
    WorkspaceMigrationModule,
    FieldMetadataModule,
    TypeOrmModule.forFeature([
      ConnectedAccountEntity,
      FieldMetadataEntity,
      UserWorkspaceEntity,
    ]),
    WorkspaceMetadataVersionModule,
    LinkedinModule,
  ],
  providers: [
    MigrateManualTriggerVariablesToPayloadCommand,
    SyncCalendarEventRecordPageCommand,
    RenameConflictingCompanyFieldsCommand,
    AddCompanyFieldsCommand,
    AddRecordListsCommand,
    MakeRecordListFolderOptionalCommand,
    AddOutreachSequencesCommand,
    AddLinkedinConnectorCommand,
    AddUniboxCommand,
    EnableLinkedinDirectMessagesCommand,
    ExpandSequenceBuilderCommand,
    RenameSequenceTasksNavigationItemCommand,
    BackfillLinkedinConnectionPersonMatchesCommand,
    ScopeLinkedinActionsToSendersCommand,
    BackfillLinkedinParticipantPersonMatchesCommand,
    ArchiveLegacyLinkedinUiCommand,
    AddPersonLinkedinConnectedAtCommand,
    AddPersonAndCompanyCountryColumnsCommand,
    AddCompanyCountryViewFieldCommand,
    AddLinkedinMessageReadReceiptsCommand,
    BackstopSequenceEmailLimitColumnsCommand,
    AddPersonTimeZoneCommand,
    AddLinkedinNavigationItemCommand,
    RecomputeSequenceCountersCommand,
    AddSequenceApolloWaitingStatesCommand,
    ShowApolloLocationColumnsCommand,
    SequenceMetricsService,
  ],
})
export class V2_15_UpgradeVersionCommandModule {}
