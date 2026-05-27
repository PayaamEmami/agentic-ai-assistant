import { PersonalizationManager } from '@/components/personalization/manager';
import { SettingsPageShell } from '@/components/ui/settings-page-shell';

export default function PersonalizationPage() {
  return (
    <SettingsPageShell title="Personalization" closeLabel="Close personalization">
      <PersonalizationManager />
    </SettingsPageShell>
  );
}
