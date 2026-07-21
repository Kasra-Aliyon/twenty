import { Module } from '@nestjs/common';

import { ApolloEnrichmentModule } from 'src/modules/apollo-enrichment/apollo-enrichment.module';
import { CalendarModule } from 'src/modules/calendar/calendar.module';
import { ConnectedAccountModule } from 'src/modules/connected-account/connected-account.module';
import { MessagingModule } from 'src/modules/messaging/messaging.module';
import { OnboardingInviteSuggestionsModule } from 'src/modules/onboarding-invite-suggestions/onboarding-invite-suggestions.module';
import { SequenceModule } from 'src/modules/sequence/sequence.module';
import { WorkflowModule } from 'src/modules/workflow/workflow.module';
import { WorkspaceMemberModule } from 'src/modules/workspace-member/workspace-member.module';

@Module({
  imports: [
    ApolloEnrichmentModule,
    MessagingModule,
    CalendarModule,
    ConnectedAccountModule,
    OnboardingInviteSuggestionsModule,
    SequenceModule,
    WorkflowModule,
    WorkspaceMemberModule,
  ],
  providers: [],
  exports: [],
})
export class ModulesModule {}
