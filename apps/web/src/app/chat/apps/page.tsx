import { AppManager } from '@/components/apps/manager';
import { SettingsPageShell } from '@/components/ui/settings-page-shell';

export default function AppsPage() {
  return (
    <SettingsPageShell title="Apps" closeLabel="Close apps">
      <AppManager />
    </SettingsPageShell>
  );
}
