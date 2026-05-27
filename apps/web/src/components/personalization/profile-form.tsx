'use client';

import { Textarea } from '@/components/ui/textarea';

interface ProfileFormProps {
  writingStyle: string;
  tonePreference: string;
  isSaving: boolean;
  saveStatus: string | null;
  onWritingStyleChange: (value: string) => void;
  onTonePreferenceChange: (value: string) => void;
}

export function ProfileForm({
  writingStyle,
  tonePreference,
  isSaving,
  saveStatus,
  onWritingStyleChange,
  onTonePreferenceChange,
}: ProfileFormProps) {
  return (
    <section className="space-y-5">
      <h2 className="text-base font-medium text-foreground">Communication</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-foreground-muted">Writing style</span>
          <Textarea
            value={writingStyle}
            onChange={(event) => onWritingStyleChange(event.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Concise, direct, and technical."
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-foreground-muted">Tone preference</span>
          <Textarea
            value={tonePreference}
            onChange={(event) => onTonePreferenceChange(event.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Warm, collaborative, and low-jargon."
          />
        </label>
      </div>

      {isSaving || saveStatus ? (
        <p className="text-right text-xs text-foreground-muted">
          {isSaving ? 'Saving...' : saveStatus}
        </p>
      ) : null}
    </section>
  );
}
