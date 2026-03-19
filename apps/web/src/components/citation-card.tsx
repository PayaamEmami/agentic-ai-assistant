interface CitationCardProps {
  title: string;
  excerpt: string;
  uri?: string;
}

export function CitationCard({ title, excerpt, uri }: CitationCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface-overlay p-3">
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      <p className="mt-1 text-xs text-foreground-muted line-clamp-2">{excerpt}</p>
      {uri && (
        <a href={uri} target="_blank" rel="noopener noreferrer" className="mt-1 text-xs text-link hover:underline">
          View source
        </a>
      )}
    </div>
  );
}
