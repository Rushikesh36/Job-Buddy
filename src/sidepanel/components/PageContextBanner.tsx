import type { PageContext } from '../../lib/types';
import type { NUworksDetectionResult } from '../../types/scanner';

interface PageContextBannerProps {
  pageContext: PageContext;
  nuworksDetection?: NUworksDetectionResult | null;
  onClear: () => void;
}

export default function PageContextBanner({ pageContext, nuworksDetection, onClear }: PageContextBannerProps) {
  let fallbackHost = pageContext.url;
  try {
    fallbackHost = new URL(pageContext.url).hostname;
  } catch {
    fallbackHost = pageContext.url;
  }

  const displayTitle = pageContext.title
    ? pageContext.title.length > 45
      ? pageContext.title.slice(0, 45) + '…'
      : pageContext.title
    : fallbackHost;

  const nuworksStatus = nuworksDetection?.isNUworksPage
    ? `NUworks (${nuworksDetection.platform})`
    : null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800 mx-3 mb-2">
      {/* Green dot */}
      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      <svg
        className="flex-shrink-0 w-3 h-3 text-green-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <span className="flex-1 truncate font-medium">Page read · Ask me anything about {displayTitle}</span>
      {nuworksStatus && (
        <span className="rounded-full border border-emerald-200 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
          {nuworksStatus}
        </span>
      )}
      <button
        onClick={onClear}
        title="Clear page context"
        className="flex-shrink-0 w-4 h-4 rounded-full hover:bg-green-200 flex items-center justify-center transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
