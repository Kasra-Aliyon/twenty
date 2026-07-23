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
import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { FeatureFlagModule } from 'src/engine/core-modules/feature-flag/feature-flag.module';
import { FieldMetadataModule } from 'src/engine/metadata-modules/field-metadata/field-metadata.module';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { WorkspaceMetadataVersionModule } from 'src/engine/metadata-modules/workspace-metadata-version/workspace-metadata-version.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { WorkspaceMigrationModule } from 'src/engine/workspace-manager/workspace-migration/workspace-migration.module';

@Module({
  imports: [
    ApplicationModule,
    FeatureFlagModule,
    WorkspaceIteratorModule,
    WorkspaceCacheModule,
    WorkspaceMigrationModule,
    FieldMetadataModule,
    TypeOrmModule.forFeature([FieldMetadataEntity]),
    WorkspaceMetadataVersionModule,
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
  ],
})
export class V2_15_UpgradeVersionCommandModule {}
