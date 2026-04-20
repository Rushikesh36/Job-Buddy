export type NUworksPlatformType = 'symplicity' | 'handshake' | 'custom' | 'unknown';

export interface NUworksJobListingSignal {
  hasStructuredList: boolean;
  jobLikeElementCount: number;
  postingLinkCount: number;
  hasPagination: boolean;
  tableRowCount: number;
}

export interface NUworksDetectionResult {
  isNUworksPage: boolean;
  isJobListingPage: boolean;
  platform: NUworksPlatformType;
  indicators: string[];
  signals: NUworksJobListingSignal;
  url: string;
  title: string;
  detectedAt: string;
}

export interface RawJobListing {
  title: string;
  company: string;
  location: string;
  jobId: string;
  postingDate: string;
  deadline: string;
  jobType: string;
  description: string;
  detailUrl: string;
  rawText: string;
  isNew?: boolean;
  appliedStatus?: 'applied' | 'not-applied';
}

export type NUworksExtractionStrategy = 'structured' | 'text-pattern' | 'llm-fallback-pending' | 'none';

export interface NUworksExtractionDiagnostics {
  strategyUsed: NUworksExtractionStrategy;
  attemptedStrategies: NUworksExtractionStrategy[];
  structuredCandidates: number;
  textPatternCandidates: number;
  deduplicatedCount: number;
  skippedEmptyTitleCount: number;
  pagesScanned?: number;
}

export interface NUworksPageExtractionResult {
  jobs: RawJobListing[];
  diagnostics: NUworksExtractionDiagnostics;
  llmFallbackInput: {
    pageUrl: string;
    pageTitle: string;
    pageTextSample: string;
  };
  extractedAt: string;
}

export type VisaFlag = 'green' | 'yellow' | 'red';

export interface ScoredJob extends RawJobListing {
  matchScore: number;
  matchReason: string;
  matchingSkills: string[];
  missingSkills: string[];
  visaFlag: VisaFlag;
  actionItems: string[];
}

export interface ScoringProgress {
  scored: number;
  total: number;
  batchIndex: number;
  totalBatches: number;
}

export interface NUworksScanProgress {
  page: number;
  jobsFound: number;
  totalPages: number | null;
}

export interface NUworksEnrichProgress {
  current: number;
  total: number;
}

export interface NUworksEnrichJobsResult {
  jobs: RawJobListing[];
  attempted: number;
  enriched: number;
  topN: number;
  completedAt: string;
}

export interface ScanCache {
  lastScanDate: string;
  lastScanUrl: string;
  jobsSeen: string[];
  results: RawJobListing[];
}

export interface ProcessedJobRegistryEntry {
  jobKey: string;
  title: string;
  company: string;
  jobId?: string;
  detailUrl?: string;
  scannedAt: string;
  lastSeenAt: string;
  scoredAt?: string;
  shortlistedAt?: string;
}

export interface ProcessedJobRegistry {
  version: 1;
  lastUpdated: string;
  entries: Record<string, ProcessedJobRegistryEntry>;
}

export interface ScanDebugSettings {
  scannerDebugMode: boolean;
}

export const DEFAULT_SCAN_DEBUG_SETTINGS: ScanDebugSettings = {
  scannerDebugMode: false,
};

export const SCANNER_DEBUG_MODE_STORAGE_KEY = 'scannerDebugMode';
