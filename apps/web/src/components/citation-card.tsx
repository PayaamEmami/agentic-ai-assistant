interface CitationCardProps {
  title: string;
  excerpt: string;
  uri?: string;
}

export function CitationCard({ title, excerpt, uri }: CitationCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="mt-1 text-xs text-gray-500 line-clamp-2">{excerpt}</p>
      {uri && (
        <a href={uri} target="_blank" rel="noopener noreferrer" className="mt-1 text-xs text-blue-600 hover:underline">
          View source
        </a>
      )}
    </div>
  );
}
