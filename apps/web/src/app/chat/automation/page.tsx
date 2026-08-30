import { AutomationManager } from '@/components/automation/manager';
import { SettingsPageShell } from '@/components/ui/settings-page-shell';

export default function AutomationPage() {
  return (
    <SettingsPageShell title="Automation" closeLabel="Close automation">
      <AutomationManager />
    </SettingsPageShell>
  );
}
