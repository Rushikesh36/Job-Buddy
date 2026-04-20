import {
  type NUworksEnrichJobsResult,
  type NUworksEnrichProgress,
  type NUworksPageExtractionResult,
  type NUworksExtractionStrategy,
  type RawJobListing,
  type NUworksScanProgress,
} from '../types/scanner';

const SCANNER_DEBUG_MODE_STORAGE_KEY = 'scannerDebugMode';

const ROW_SELECTORS = [
  '#list[role="list"] > [role="listitem"] .list-item',
  '#list [role="listitem"] .list-item',
  '[role="listitem"] .list-item',
  'table.list tbody tr',
  '.job-listing-row',
  '[data-job-id]',
  '[class*="job-listing" i] [class*="row" i]',
  '[class*="posting" i] [class*="row" i]',
  '[class*="job-card" i]',
];

const PAGINATION_CONTAINER_SELECTORS = [
  '.pagination',
  '.pager',
  'nav[aria-label*="page" i]',
  '[class*="pagination" i]',
  '.page-numbers',
];

const MAX_SCAN_PAGES = 50;
const MAX_CARD_TEXT_LENGTH = 800;
const NOISE_MARKERS = [
  'more filters',
  'position type',
  'industry',
  'create job alert',
  'all jobs & interviews',
  'targeted academic majors',
  'work term',
  'workplace type',
  'transportation',
  'exclude jobs',
  'apply by',
];

const HARD_EXCLUDE_PATTERNS: RegExp[] = [
  /\bnot\s+qualified\b/i,
  /\bus\s+citizen(ship)?\s+(required|only)\b/i,
  /\bcitizens?\s+only\b/i,
  /\bmust\s+be\s+(a\s+)?u\.?s\.?\s+citizen\b/i,
  /\bunpaid\b/i,
  /\bno\s+compensation\b/i,
  /\bwithout\s+compensation\b/i,
  /\bvolunteer\b/i,
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isLikelyNoiseText(value: string): boolean {
  const text = value.toLowerCase();
  const markerHits = NOISE_MARKERS.reduce((count, marker) => (text.includes(marker) ? count + 1 : count), 0);
  return markerHits >= 2 || text.length > 1600;
}

function hasHardExclusionMarkers(value: string): boolean {
  if (!value) return false;
  return HARD_EXCLUDE_PATTERNS.some((pattern) => pattern.test(value));
}

function toLineTokens(value: string): string[] {
  return value
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function pickText(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    const text = normalizeText(el?.textContent);
    if (text) return text;
  }
  return '';
}

function findPrimaryLink(root: ParentNode): HTMLAnchorElement | null {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'));

  for (const link of links) {
    const text = normalizeText(link.textContent);
    const href = (link.getAttribute('href') ?? '').toLowerCase();
    if (!text) continue;
    if (href.includes('job') || href.includes('posting') || href.includes('detail') || href.includes('position')) {
      return link;
    }
  }

  return links[0] ?? null;
}

function toAbsoluteUrl(href: string | null | undefined, baseUrl: string): string {
  if (!href) return '';

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function parseJobIdFromUrl(url: string): string {
  if (!url) return '';

  const patterns = [/id=(\d+)/i, /job(?:Id|ID)?[=/:-](\w+)/i, /posting[=/:-](\w+)/i, /(\d{5,})/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

function buildRawJobListing(params: {
  title: string;
  company: string;
  location: string;
  jobId: string;
  detailUrl: string;
  rawText: string;
}): RawJobListing {
  return {
    title: params.title,
    company: params.company,
    location: params.location,
    jobId: params.jobId,
    postingDate: '',
    deadline: '',
    jobType: '',
    description: '',
    detailUrl: params.detailUrl,
    rawText: params.rawText,
  };
}

function jobKey(job: RawJobListing): string {
  return job.jobId || job.detailUrl || `${job.title}::${job.company}`;
}

function shouldExcludeJob(job: RawJobListing): boolean {
  const text = normalizeText([
    job.title,
    job.company,
    job.location,
    job.postingDate,
    job.deadline,
    job.jobType,
    job.description,
    job.rawText,
  ].join(' | ')).toLowerCase();

  return hasHardExclusionMarkers(text);
}

function splitCompanyAndLocation(line: string): { company: string; location: string } {
  const normalized = normalizeText(line);
  if (!normalized) return { company: '', location: '' };

  if (normalized.includes(' - ')) {
    const [company, ...rest] = normalized.split(' - ');
    return {
      company: normalizeText(company),
      location: normalizeText(rest.join(' - ')),
    };
  }

  return { company: normalized, location: '' };
}

function parseRelativePostingDate(raw: string): string {
  const text = raw.toLowerCase();
  const compact = text.match(/\b(\d+)\s*([dhwm])\b/i);
  if (compact) {
    const amount = compact[1];
    const unit = compact[2].toLowerCase();
    if (unit === 'd') return `${amount} day${amount === '1' ? '' : 's'} ago`;
    if (unit === 'h') return `${amount} hour${amount === '1' ? '' : 's'} ago`;
    if (unit === 'w') return `${amount} week${amount === '1' ? '' : 's'} ago`;
    if (unit === 'm') return `${amount} month${amount === '1' ? '' : 's'} ago`;
  }

  const longForm = text.match(/\b(\d+)\s*(hour|day|week|month)s?\b/i);
  if (longForm) {
    return `${longForm[1]} ${longForm[2]}${longForm[1] === '1' ? '' : 's'} ago`;
  }

  if (text.includes('today')) return 'today';
  if (text.includes('yesterday')) return 'yesterday';
  return '';
}

function findCardTitleAndLink(card: Element, baseUrl: string): { title: string; detailUrl: string } {
  const links = Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const preferred = links.find((link) => {
    const title = normalizeText(link.textContent);
    if (!title || title.length < 5 || title.length > 140) return false;
    const href = normalizeText(link.getAttribute('href')).toLowerCase();
    return href.includes('/job') || href.includes('jobs') || href.includes('posting') || href.includes('position');
  });

  if (preferred) {
    return {
      title: normalizeText(preferred.textContent),
      detailUrl: toAbsoluteUrl(preferred.getAttribute('href'), baseUrl),
    };
  }

  const heading = card.querySelector('h1, h2, h3, h4, [class*="title" i]');
  const title = normalizeText(heading?.textContent);
  return {
    title,
    detailUrl: '',
  };
}

function extractJobsFromCardLayout(root: ParentNode, baseUrl: string): RawJobListing[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>([
    '[role="listitem"]',
    'article',
    'li',
    '[class*="job" i][class*="item" i]',
    '[class*="result" i][class*="item" i]',
    '[class*="job" i][class*="card" i]',
  ].join(',')));

  const jobs: RawJobListing[] = [];

  candidates.forEach((candidate) => {
    const rawText = normalizeText(candidate.textContent);
    if (!rawText || rawText.length < 25 || rawText.length > MAX_CARD_TEXT_LENGTH) return;
    if (isLikelyNoiseText(rawText)) return;
    if (hasHardExclusionMarkers(rawText)) return;

    const { title, detailUrl } = findCardTitleAndLink(candidate, baseUrl);
    if (!title || title.length < 5 || title.length > 140) return;

    const lines = toLineTokens(candidate.textContent ?? '');
    const companyLine = lines.find((line) => /\s-\s|university|inc\.?|llc|corp|ltd|company/i.test(line) && !line.includes(title)) ?? '';
    const { company, location } = splitCompanyAndLocation(companyLine);

    const jobType = lines.find((line) => /co-?op|intern|internship|full\s*time|part\s*time|contract/i.test(line)) ?? '';
    const postingDate = lines
      .map((line) => parseRelativePostingDate(line))
      .find(Boolean) ?? '';

    const jobId =
      normalizeText(candidate.getAttribute('data-job-id')) ||
      parseJobIdFromUrl(detailUrl) ||
      parseJobIdFromUrl(rawText);

    jobs.push(
      buildRawJobListing({
        title,
        company,
        location,
        jobId,
        detailUrl,
        rawText,
      })
    );

    if (jobs.length > 500) {
      return;
    }

    const last = jobs[jobs.length - 1];
    last.jobType = normalizeText(jobType);
    last.postingDate = postingDate;
  });

  return jobs;
}

function extractJobsStructured(root: ParentNode, baseUrl: string): { jobs: RawJobListing[]; skippedEmptyTitleCount: number } {
  const rows = Array.from(root.querySelectorAll<HTMLElement>(ROW_SELECTORS.join(',')));
  const jobs: RawJobListing[] = [];
  let skippedEmptyTitleCount = 0;

  rows.forEach((row) => {
    const rowText = normalizeText(row.textContent);
    if (!rowText || rowText.length > MAX_CARD_TEXT_LENGTH || isLikelyNoiseText(rowText)) {
      return;
    }
    if (hasHardExclusionMarkers(rowText)) {
      return;
    }

    const primaryLink = findPrimaryLink(row);
    const title = pickText(row, [
      '.list-item-title .inline-block.list-item-title span',
      '.list-item-title .inline-block span',
      '.list-item-title span',
      '.job-title',
      '.posting-title',
      '[data-job-title]',
      'td:nth-child(1) a',
      'a',
      'h2',
      'h3',
      '[class*="title" i]',
    ]);

    if (!title) {
      skippedEmptyTitleCount += 1;
      return;
    }

    const detailUrl = toAbsoluteUrl(primaryLink?.getAttribute('href') ?? '', baseUrl);
    const jobId =
      normalizeText(row.getAttribute('data-job-id')) ||
      parseJobIdFromUrl(detailUrl) ||
      parseJobIdFromUrl(primaryLink?.href ?? '');

    const company = pickText(row, [
      '.list-item-subtitle span',
      '.employer',
      '.company-name',
      '[class*="company" i]',
      'td:nth-child(2)',
      '[data-employer]',
    ]);

    const location = pickText(row, [
      '.list-item-subtitle span',
      '.location',
      '[class*="location" i]',
      'td:nth-child(3)',
      '[data-location]',
    ]);

    const parsedCompanyAndLocation = company.includes(' - ')
      ? company.split(' - ').map((item) => normalizeText(item))
      : null;

    const finalCompany = parsedCompanyAndLocation?.[0] || company;
    const finalLocation = parsedCompanyAndLocation && parsedCompanyAndLocation.length > 1
      ? normalizeText(parsedCompanyAndLocation.slice(1).join(' - '))
      : location;

    const postingDate = pickText(row, [
      '.list-item-actions .list-secondary-action .space-bottom-sm span',
      '.list-item-actions .list-secondary-action span',
      '.list-secondary-action span',
    ]);

    const deadline = pickText(row, [
      '.list-data-description span',
      '.text-warn span',
    ]);

    const jobType = pickText(row, [
      '.body-small.font-weight-light.space-top-xs span',
      '.body-small.font-weight-light span',
      '.text-base span',
    ]);

    jobs.push(
      buildRawJobListing({
        title,
        company: finalCompany,
        location: finalLocation,
        jobId,
        detailUrl,
        rawText: rowText,
      })
    );

    const current = jobs[jobs.length - 1];
    current.postingDate = normalizeText(postingDate);
    current.deadline = normalizeText(deadline);
    current.jobType = normalizeText(jobType);
  });

  return { jobs, skippedEmptyTitleCount };
}

function extractJobsFromTextPattern(): RawJobListing[] {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((link) => {
    const text = normalizeText(link.textContent);
    const href = link.href.toLowerCase();

    return (
      text.length > 5 &&
      text.length < 200 &&
      (href.includes('job') || href.includes('posting') || href.includes('detail') || href.includes('position'))
    );
  });

  return links.map((link) => {
    const container = link.closest('tr, li, article, [class*="row" i], [class*="item" i], [class*="card" i]') ?? link;
    const detailUrl = toAbsoluteUrl(link.getAttribute('href'), window.location.href);

    return buildRawJobListing({
      title: normalizeText(link.textContent),
      company: pickText(container, ['.company-name', '.employer', '[class*="company" i]', ':scope > :nth-child(2)']),
      location: pickText(container, ['.location', '[class*="location" i]', ':scope > :nth-child(3)']),
      jobId: normalizeText((container as Element).getAttribute?.('data-job-id')) || parseJobIdFromUrl(detailUrl),
      detailUrl,
      rawText: normalizeText(container.textContent),
    });
  });
}

function extractJobsFromTextPatternRoot(root: ParentNode, baseUrl: string): RawJobListing[] {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((link) => {
    const text = normalizeText(link.textContent);
    const href = link.href.toLowerCase();

    return (
      text.length > 5 &&
      text.length < 200 &&
      (href.includes('job') || href.includes('posting') || href.includes('detail') || href.includes('position'))
    );
  });

  return links.map((link) => {
    const container = link.closest('tr, li, article, [class*="row" i], [class*="item" i], [class*="card" i]') ?? link;
    const detailUrl = toAbsoluteUrl(link.getAttribute('href'), baseUrl);
    const containerText = normalizeText(container.textContent);

    if (!containerText || containerText.length > MAX_CARD_TEXT_LENGTH || isLikelyNoiseText(containerText)) {
      return null;
    }

    const title = normalizeText(link.textContent);
    if (!title || title.length < 5 || title.length > 140) {
      return null;
    }

    return buildRawJobListing({
      title,
      company: pickText(container, ['.company-name', '.employer', '[class*="company" i]', ':scope > :nth-child(2)']),
      location: pickText(container, ['.location', '[class*="location" i]', ':scope > :nth-child(3)']),
      jobId: normalizeText((container as Element).getAttribute?.('data-job-id')) || parseJobIdFromUrl(detailUrl),
      detailUrl,
      rawText: containerText,
    });
  }).filter((job): job is RawJobListing => job !== null);
}

function deduplicateJobs(jobs: RawJobListing[]): RawJobListing[] {
  const seen = new Set<string>();
  const deduped: RawJobListing[] = [];

  jobs.forEach((job) => {
    const key = job.jobId || job.detailUrl || `${job.title}::${job.company}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(job);
  });

  return deduped;
}

async function loadScannerDebugMode(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCANNER_DEBUG_MODE_STORAGE_KEY], (result) => {
      resolve(Boolean(result[SCANNER_DEBUG_MODE_STORAGE_KEY]));
    });
  });
}

function logExtractionDebug(result: NUworksPageExtractionResult): void {
  console.group('[JobBuddy][NUworks] Extraction Debug');
  console.log('Diagnostics:', result.diagnostics);
  console.log('Sample jobs:', result.jobs.slice(0, 5));
  console.groupEnd();
}

function parseHtmlToDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function findPaginationContainer(root: ParentNode): Element | null {
  for (const selector of PAGINATION_CONTAINER_SELECTORS) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}

function findNextAnchor(root: ParentNode, baseUrl: string): string | null {
  const candidates = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'));

  for (const link of candidates) {
    const text = normalizeText(link.textContent).toLowerCase();
    const ariaLabel = normalizeText(link.getAttribute('aria-label')).toLowerCase();
    const rel = normalizeText(link.getAttribute('rel')).toLowerCase();
    const href = normalizeText(link.getAttribute('href'));

    const isNext =
      text === 'next' ||
      text === '>' ||
      text === '>>' ||
      text === '→' ||
      ariaLabel.includes('next') ||
      rel.includes('next');

    if (!isNext) continue;
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) continue;
    if ((link as HTMLElement).classList.contains('disabled')) continue;

    return toAbsoluteUrl(href, baseUrl);
  }

  return null;
}

function findNextButtonLive(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('a, button'));

  for (const el of candidates) {
    const text = normalizeText(el.textContent).toLowerCase();
    const ariaLabel = normalizeText(el.getAttribute('aria-label')).toLowerCase();
    const isNext = text === 'next' || text === '>' || text === '>>' || text === '→' || ariaLabel.includes('next');
    if (!isNext) continue;
    if (el.hasAttribute('disabled') || el.classList.contains('disabled')) continue;
    return el;
  }

  return null;
}

function detectTotalPages(root: ParentNode, currentPage: number): number | null {
  const container = findPaginationContainer(root);
  if (!container) return null;

  const numbers = Array.from(container.querySelectorAll('a, button, span'))
    .map((el) => Number.parseInt(normalizeText(el.textContent), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (numbers.length === 0) return currentPage;
  return Math.max(currentPage, ...numbers);
}

function waitForPageUpdate(): Promise<void> {
  return new Promise((resolve) => {
    const observer = new MutationObserver((mutations, obs) => {
      const hasMeaningfulChange = mutations.some((m) => m.addedNodes.length > 2 || m.removedNodes.length > 2);
      if (!hasMeaningfulChange) return;
      obs.disconnect();
      setTimeout(resolve, 500);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 10000);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomScanDelayMs(): number {
  return 2000 + Math.floor(Math.random() * 1000);
}

function findScrollableListContainer(): HTMLElement | null {
  const selectors = [
    '[class*="job" i][class*="list" i]',
    '[class*="results" i]',
    '[role="main"] [class*="list" i]',
    '[role="main"]',
  ];

  for (const selector of selectors) {
    const containers = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const match = containers.find((el) => el.scrollHeight > el.clientHeight + 120);
    if (match) return match;
  }

  return document.scrollingElement as HTMLElement | null;
}

function findScrollableAncestor(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    if (current.scrollHeight > current.clientHeight + 50) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function parseTotalJobsHint(): number | null {
  const text = normalizeText(document.body?.innerText ?? '');
  const match = text.match(/\b\d+\s*-\s*\d+\s*of\s*(\d+)\s*jobs\b/i);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function sweepVirtualizedList(allJobs: RawJobListing[], pageCount: number, totalPages: number | null): Promise<number> {
  const listRoot = document.querySelector<HTMLElement>('#list[role="list"]')
    ?? document.querySelector<HTMLElement>('[name="list"][role="list"]')
    ?? document.querySelector<HTMLElement>('[role="list"]');

  if (!listRoot) return 0;

  const scroller = findScrollableAncestor(listRoot) ?? findScrollableListContainer();
  if (!scroller) return 0;

  const seen = new Set(allJobs.map((job) => jobKey(job)));
  const totalHint = parseTotalJobsHint();
  let addedCount = 0;
  let stagnantRounds = 0;
  let previousScrollTop = -1;

  for (let step = 0; step < 70; step += 1) {
    const result = extractFromRoot(
      document,
      window.location.href,
      document.title,
      normalizeText(document.body?.innerText ?? '').slice(0, 18000)
    );

    let newlyAddedThisStep = 0;
    result.jobs.forEach((job) => {
      const key = jobKey(job);
      if (seen.has(key)) return;
      seen.add(key);
      allJobs.push(job);
      addedCount += 1;
      newlyAddedThisStep += 1;
    });

    emitScanProgress({
      page: pageCount,
      jobsFound: seen.size,
      totalPages,
    });

    if (totalHint && seen.size >= totalHint) {
      break;
    }

    if (newlyAddedThisStep === 0) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
    }

    if (stagnantRounds >= 6) {
      break;
    }

    const nextTop = Math.min(
      scroller.scrollTop + Math.max(300, Math.floor(scroller.clientHeight * 0.85)),
      scroller.scrollHeight
    );

    if (nextTop === previousScrollTop) {
      stagnantRounds += 1;
      if (stagnantRounds >= 6) break;
    }

    previousScrollTop = nextTop;
    scroller.scrollTo({ top: nextTop, behavior: 'smooth' });
    await sleep(900);
  }

  return addedCount;
}

async function tryLoadMoreResults(previousCount: number): Promise<boolean> {
  const scrollable = findScrollableListContainer();
  if (!scrollable) return false;

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const targetTop = Math.max(scrollable.scrollHeight - scrollable.clientHeight, 0);
    scrollable.scrollTo({ top: targetTop, behavior: 'smooth' });
    await sleep(1200);

    const currentCount = extractFromRoot(
      document,
      window.location.href,
      document.title,
      normalizeText(document.body?.innerText ?? '').slice(0, 18000)
    ).jobs.length;

    if (currentCount > previousCount + 1) {
      return true;
    }
  }

  return false;
}

function findElementByText(selectors: string[], textMatcher: (text: string) => boolean): HTMLElement | null {
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const match = nodes.find((node) => textMatcher(normalizeText(node.textContent).toLowerCase()));
    if (match) return match;
  }
  return null;
}

function clickIfPresent(selectors: string[], textMatcher: (text: string) => boolean): boolean {
  const target = findElementByText(selectors, textMatcher);
  if (!target) return false;

  target.click();
  return true;
}

function selectRadioByLabelText(textMatcher: (text: string) => boolean): boolean {
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>('label'));
  for (const label of labels) {
    const text = normalizeText(label.textContent).toLowerCase();
    if (!textMatcher(text)) continue;

    const forId = label.getAttribute('for');
    const byFor = forId ? document.getElementById(forId) as HTMLInputElement | null : null;
    const input = byFor ?? (label.querySelector('input[type="radio"]') as HTMLInputElement | null);
    if (!input) continue;

    if (!input.checked) {
      input.click();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  return false;
}

async function applyNativePostedDateFilter(filter: 'all' | '24h' | '7d'): Promise<void> {
  // Open filter tray if it's collapsed.
  clickIfPresent(['button', 'a', '[role="button"]'], (text) =>
    text.includes('more filters') || text.includes('filters')
  );

  await sleep(350);

  const selected = filter === '24h'
    ? selectRadioByLabelText((text) => text.includes('past 24 hours'))
    : filter === '7d'
      ? selectRadioByLabelText((text) => text.includes('past week'))
      : selectRadioByLabelText((text) => text.includes('any time'));

  if (!selected) {
    // If we can't confidently find the radio option, continue scan with existing page state.
    return;
  }

  const didApply = clickIfPresent(
    ['button', 'a', '[role="button"]'],
    (text) => text === 'apply' || text.includes('apply filters')
  );

  if (!didApply) {
    // Some NUworks views auto-apply on selection; still wait for update.
  }

  await waitForPageUpdate();
  await sleep(900);
}

function emitScanProgress(data: NUworksScanProgress): void {
  void chrome.runtime.sendMessage({
    type: 'SCAN_PROGRESS',
    payload: { data },
  });
}

function emitEnrichProgress(data: NUworksEnrichProgress): void {
  void chrome.runtime.sendMessage({
    type: 'ENRICH_PROGRESS',
    payload: { data },
  });
}

function randomEnrichDelayMs(): number {
  return 1500 + Math.floor(Math.random() * 1000);
}

function extractDescriptionFromDoc(doc: Document): string {
  const selectors = [
    '.job-description',
    '.posting-description',
    '#job-description',
    '[class*="description" i]',
    '.detail-content',
    'main',
  ];

  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const text = normalizeText(el?.textContent);
    if (text.length > 50) return text;
  }

  return '';
}

function extractDetailField(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const value = normalizeText(doc.querySelector(selector)?.textContent);
    if (value) return value;
  }
  return '';
}

async function enrichOneJob(job: RawJobListing): Promise<{ job: RawJobListing; enriched: boolean }> {
  if (job.description && job.description.length > 100) {
    return { job, enriched: false };
  }

  if (!job.detailUrl) {
    return { job, enriched: false };
  }

  try {
    const response = await fetch(job.detailUrl, { credentials: 'include' });
    if (!response.ok) {
      return { job, enriched: false };
    }

    const html = await response.text();
    const doc = parseHtmlToDocument(html);

    const description = extractDescriptionFromDoc(doc);
    const deadline = extractDetailField(doc, ['[class*="deadline" i]', '[class*="date" i]', 'time']);
    const jobType = extractDetailField(doc, ['[class*="type" i]', '[class*="category" i]', '[class*="employment" i]']);
    const postingDate = extractDetailField(doc, ['[class*="posted" i]', '[class*="posting-date" i]', '[class*="date" i]']);

    const nextJob: RawJobListing = {
      ...job,
      description: description || job.description,
      deadline: deadline || job.deadline,
      jobType: jobType || job.jobType,
      postingDate: postingDate || job.postingDate,
    };

    const wasEnriched =
      nextJob.description !== job.description ||
      nextJob.deadline !== job.deadline ||
      nextJob.jobType !== job.jobType ||
      nextJob.postingDate !== job.postingDate;

    return { job: nextJob, enriched: wasEnriched };
  } catch {
    return { job, enriched: false };
  }
}

function extractFromRoot(root: ParentNode, pageUrl: string, pageTitle: string, pageTextSample: string): NUworksPageExtractionResult {
  const attemptedStrategies: NUworksExtractionStrategy[] = [];
  attemptedStrategies.push('structured');
  const structured = extractJobsStructured(root, pageUrl);
  const cardLayout = extractJobsFromCardLayout(root, pageUrl);

  let strategyUsed: NUworksExtractionStrategy = 'none';
  let jobs = structured.jobs;
  let textPatternCandidates = 0;

  if (jobs.length > 0) {
    strategyUsed = 'structured';
  } else if (cardLayout.length > 0) {
    attemptedStrategies.push('text-pattern');
    strategyUsed = 'text-pattern';
    jobs = cardLayout;
    textPatternCandidates = cardLayout.length;
  } else {
    attemptedStrategies.push('text-pattern');
    const fromTextPattern = extractJobsFromTextPatternRoot(root, pageUrl);
    textPatternCandidates = fromTextPattern.length;
    jobs = fromTextPattern;
    strategyUsed = fromTextPattern.length > 0 ? 'text-pattern' : 'llm-fallback-pending';
  }

  if (strategyUsed === 'llm-fallback-pending') {
    attemptedStrategies.push('llm-fallback-pending');
  }

  const dedupedJobs = deduplicateJobs(jobs);
  const eligibleJobs = dedupedJobs.filter((job) => !shouldExcludeJob(job));

  return {
    jobs: eligibleJobs,
    diagnostics: {
      strategyUsed,
      attemptedStrategies,
      structuredCandidates: structured.jobs.length,
      textPatternCandidates,
      deduplicatedCount: eligibleJobs.length,
      skippedEmptyTitleCount: structured.skippedEmptyTitleCount,
    },
    llmFallbackInput: {
      pageUrl,
      pageTitle,
      pageTextSample,
    },
    extractedAt: new Date().toISOString(),
  };
}

export async function extractNUworksJobsFromCurrentPage(): Promise<NUworksPageExtractionResult> {
  const result = extractFromRoot(
    document,
    window.location.href,
    document.title,
    normalizeText(document.body?.innerText ?? '').slice(0, 18000)
  );

  const debugMode = await loadScannerDebugMode();
  if (debugMode) {
    logExtractionDebug(result);
  }

  return result;
}

export async function scanNUworksAllPages(nativePostedDateFilter: 'all' | '24h' | '7d' = 'all'): Promise<NUworksPageExtractionResult> {
  const debugMode = await loadScannerDebugMode();

  if (nativePostedDateFilter !== 'all') {
    await applyNativePostedDateFilter(nativePostedDateFilter);
  }

  const allJobs: RawJobListing[] = [];
  let pageCount = 0;
  let totalPages: number | null = null;
  const visitedUrls = new Set<string>();

  let currentUrl = window.location.href;
  let useLiveDomForNextPage = true;

  while (pageCount < MAX_SCAN_PAGES) {
    pageCount += 1;

    let rootDoc: Document;
    let pageTitle = '';
    let pageTextSample = '';

    if (useLiveDomForNextPage) {
      rootDoc = document;
      currentUrl = window.location.href;
      pageTitle = document.title;
      pageTextSample = normalizeText(document.body?.innerText ?? '').slice(0, 18000);
    } else {
      const response = await fetch(currentUrl, { credentials: 'include' });
      const html = await response.text();
      rootDoc = parseHtmlToDocument(html);
      pageTitle = rootDoc.title || document.title;
      pageTextSample = normalizeText(rootDoc.body?.textContent ?? '').slice(0, 18000);
    }

    visitedUrls.add(currentUrl);
    const pageResult = extractFromRoot(rootDoc, currentUrl, pageTitle, pageTextSample);
    allJobs.push(...pageResult.jobs);

    const dedupedSoFar = deduplicateJobs(allJobs);
    totalPages = detectTotalPages(rootDoc, pageCount) ?? totalPages;

    emitScanProgress({
      page: pageCount,
      jobsFound: dedupedSoFar.length,
      totalPages,
    });

    const nextLink = findNextAnchor(rootDoc, currentUrl);
    if (nextLink && !visitedUrls.has(nextLink)) {
      currentUrl = nextLink;
      useLiveDomForNextPage = false;
      await sleep(randomScanDelayMs());
      continue;
    }

    if (useLiveDomForNextPage) {
      const nextButton = findNextButtonLive();
      if (nextButton) {
        nextButton.click();
        await waitForPageUpdate();
        await sleep(randomScanDelayMs());
        useLiveDomForNextPage = true;
        continue;
      }

      const currentCount = dedupedSoFar.length;
      const loadedMore = await tryLoadMoreResults(currentCount);
      if (loadedMore) {
        await sleep(randomScanDelayMs());
        useLiveDomForNextPage = true;
        continue;
      }

      const addedFromSweep = await sweepVirtualizedList(allJobs, pageCount, totalPages);
      if (addedFromSweep > 0) {
        await sleep(500);
        continue;
      }
    }

    break;
  }

  const dedupedJobs = deduplicateJobs(allJobs);
  const eligibleJobs = dedupedJobs.filter((job) => !shouldExcludeJob(job));
  const result: NUworksPageExtractionResult = {
    jobs: eligibleJobs,
    diagnostics: {
      strategyUsed: eligibleJobs.length > 0 ? 'structured' : 'none',
      attemptedStrategies: ['structured', 'text-pattern'],
      structuredCandidates: eligibleJobs.length,
      textPatternCandidates: 0,
      deduplicatedCount: eligibleJobs.length,
      skippedEmptyTitleCount: 0,
      pagesScanned: pageCount,
    },
    llmFallbackInput: {
      pageUrl: window.location.href,
      pageTitle: document.title,
      pageTextSample: normalizeText(document.body?.innerText ?? '').slice(0, 18000),
    },
    extractedAt: new Date().toISOString(),
  };

  if (debugMode) {
    logExtractionDebug(result);
  }

  return result;
}

export async function enrichNUworksTopJobs(jobs: RawJobListing[], topN = Number.POSITIVE_INFINITY): Promise<NUworksEnrichJobsResult> {
  const effectiveTopN = Number.isFinite(topN) ? Math.max(1, topN) : jobs.length;
  const total = Math.min(jobs.length, effectiveTopN);
  const mutableJobs = [...jobs];
  let enrichedCount = 0;

  for (let i = 0; i < total; i += 1) {
    const { job, enriched } = await enrichOneJob(mutableJobs[i]);
    mutableJobs[i] = job;
    if (enriched) enrichedCount += 1;

    emitEnrichProgress({
      current: i + 1,
      total,
    });

    if (i + 1 < total) {
      await sleep(randomEnrichDelayMs());
    }
  }

  return {
    jobs: mutableJobs,
    attempted: total,
    enriched: enrichedCount,
    topN: effectiveTopN,
    completedAt: new Date().toISOString(),
  };
}
