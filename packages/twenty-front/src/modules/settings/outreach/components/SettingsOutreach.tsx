import { SettingsOutreachBrowserSync } from './SettingsOutreachBrowserSync';
import { SettingsOutreachMailboxLimits } from './SettingsOutreachMailboxLimits';
import { SettingsOutreachSequenceLimits } from './SettingsOutreachSequenceLimits';

export const SettingsOutreach = () => (
  <>
    <SettingsOutreachBrowserSync />
    <SettingsOutreachMailboxLimits />
    <SettingsOutreachSequenceLimits />
  </>
);
