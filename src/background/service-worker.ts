import type {
  SendToLLMPayload,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload,
  ExtractJobDataPayload,
  ExtractJobDataResult,
  RunLLMUtilityPayload,
  RunLLMUtilityResult,
} from '../lib/types';
import { streamLLMResponse } from '../lib/llm-api';
import { buildSystemPrompt } from '../config/system-prompt';
import { MY_PROFILE } from '../lib/profile';

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
  }
});

// Relay messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // ---- GET_PAGE_CONTENT: inject extraction function directly via scripting API ----
  // Using executeScript instead of messaging the content script avoids the
  // "Receiving end does not exist" error on pages where the content script
  // hasn't loaded yet (e.g. tabs opened before the extension was installed).
  if (message?.type === 'GET_PAGE_CONTENT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];

      if (!activeTab?.id) {
        sendResponse({ success: false, error: 'No active tab found.' });
        return;
      }

      // Restricted URLs (chrome://, chrome-extension://, about:, etc.)
      // cannot be scripted — detect and bail early with a clear message.
      const url = activeTab.url ?? '';
      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://')
      ) {
        sendResponse({
          success: false,
          error: "Can't read browser pages (chrome://, about:, etc.). Navigate to a real website first.",
        });
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          // This function runs in the page context — no imports allowed.
          func: () => {
            const metaEl = document.querySelector<HTMLMetaElement>('meta[name="description"]');
            return {
              url: window.location.href,
              title: document.title,
              metaDescription: metaEl?.content ?? '',
              textContent: (document.body?.innerText ?? '').trim().slice(0, 15000),
              extractedAt: new Date().toISOString(),
            };
          },
        },
        (results) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              success: false,
              error:
                "Couldn't read this page. Try refreshing it, or check that it's not a protected page.",
            });
            return;
          }
          const data = results?.[0]?.result;
          if (!data) {
            sendResponse({ success: false, error: 'No content returned from page.' });
            return;
          }
          sendResponse({ success: true, data });
        }
      );
    });

    return true; // keep the message channel open for the async response
  }

  if (message?.type === 'NUWORKS_DETECT_PAGE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];

      if (!activeTab?.id) {
        sendResponse({ success: false, error: 'No active tab found.' });
        return;
      }

      const url = activeTab.url ?? '';
      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://')
      ) {
        sendResponse({
          success: false,
          error: "Can't detect NUworks on browser pages (chrome://, about:, etc.).",
        });
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { type: 'NUWORKS_DETECT_PAGE' }, (contentResponse) => {
        if (!chrome.runtime.lastError && contentResponse?.success) {
          sendResponse(contentResponse);
          return;
        }

        // Fallback in case the content script hasn't loaded for this tab yet.
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            func: () => {
              const currentUrl = window.location.href;
              const lowerUrl = currentUrl.toLowerCase();
              const title = document.title;
              const lowerTitle = title.toLowerCase();

              const isNUworksPage =
                lowerUrl.includes('nuworks.northeastern.edu') ||
                lowerUrl.includes('northeastern-csm.symplicity.com') ||
                lowerUrl.includes('nuwks') ||
                lowerTitle.includes('nuworks');

              const hasStructuredList = Boolean(
                document.querySelector('table.list tbody tr, .job-listing-row, [data-job-id], [class*="job-list" i], [class*="posting" i], table.list')
              );
              const jobLikeElementCount = document.querySelectorAll('[class*="job" i], [class*="posting" i]').length;
              const postingLinkCount = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((link) => {
                const href = link.href.toLowerCase();
                const text = (link.textContent ?? '').trim();
                return (
                  text.length > 5 &&
                  text.length < 200 &&
                  (href.includes('job') || href.includes('posting') || href.includes('detail') || href.includes('position'))
                );
              }).length;
              const hasPagination = Boolean(
                document.querySelector('.pagination, .pager, nav[aria-label*="page" i], [class*="pagination" i], .page-numbers')
              );
              const tableRowCount = document.querySelectorAll('table tbody tr').length;

              let confidence = 0;
              if (hasStructuredList) confidence += 2;
              if (jobLikeElementCount >= 4) confidence += 1;
              if (postingLinkCount >= 3) confidence += 1;
              if (tableRowCount >= 4) confidence += 1;
              if (hasPagination) confidence += 1;

              let platform: 'symplicity' | 'handshake' | 'custom' | 'unknown' = 'unknown';
              const indicators: string[] = [];
              const host = window.location.hostname.toLowerCase();
              if (host.includes('symplicity.com') || lowerUrl.includes('northeastern-csm.symplicity.com')) {
                platform = 'symplicity';
                indicators.push('host:symplicity');
              } else if (host.includes('joinhandshake.com') || lowerUrl.includes('handshake')) {
                platform = 'handshake';
                indicators.push('host:handshake');
              } else if (lowerUrl.includes('nuworks.northeastern.edu') || lowerUrl.includes('nuwks') || lowerTitle.includes('nuworks')) {
                platform = 'custom';
                indicators.push('keyword:nuworks');
              }

              return {
                isNUworksPage,
                isJobListingPage: confidence >= 2,
                platform,
                indicators,
                signals: {
                  hasStructuredList,
                  jobLikeElementCount,
                  postingLinkCount,
                  hasPagination,
                  tableRowCount,
                },
                url: currentUrl,
                title,
                detectedAt: new Date().toISOString(),
              };
            },
          },
          (results) => {
            if (chrome.runtime.lastError) {
              sendResponse({
                success: false,
                error: "Couldn't detect this page. Try refreshing and retrying.",
              });
              return;
            }

            const data = results?.[0]?.result;
            if (!data) {
              sendResponse({ success: false, error: 'No detection data returned from page.' });
              return;
            }

            sendResponse({ success: true, data });
          }
        );
      });
    });

    return true;
  }

  if (message?.type === 'NUWORKS_EXTRACT_CURRENT_PAGE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];

      if (!activeTab?.id) {
        sendResponse({ success: false, error: 'No active tab found.' });
        return;
      }

      const url = activeTab.url ?? '';
      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://')
      ) {
        sendResponse({
          success: false,
          error: "Can't scan browser pages (chrome://, about:, etc.).",
        });
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { type: 'NUWORKS_EXTRACT_CURRENT_PAGE' }, (contentResponse) => {
        if (!chrome.runtime.lastError && contentResponse?.success) {
          sendResponse(contentResponse);
          return;
        }

        // Fallback if content script has not loaded yet.
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            func: () => {
              const normalizeText = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
              const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((link) => {
                const text = normalizeText(link.textContent);
                const href = link.href.toLowerCase();
                return (
                  text.length > 5 &&
                  text.length < 200 &&
                  (href.includes('job') || href.includes('posting') || href.includes('detail') || href.includes('position'))
                );
              });

              const jobs = links.map((link) => {
                const container = link.closest('tr, li, article, [class*="row" i], [class*="item" i], [class*="card" i]') ?? link;
                const text = normalizeText(link.textContent);
                const detailUrl = link.href;
                const rawText = normalizeText(container.textContent);
                const idMatch = detailUrl.match(/id=(\d+)/i) ?? detailUrl.match(/(\d{5,})/);

                return {
                  title: text,
                  company: '',
                  location: '',
                  jobId: idMatch?.[1] ?? '',
                  postingDate: '',
                  deadline: '',
                  jobType: '',
                  description: '',
                  detailUrl,
                  rawText,
                };
              });

              const deduped: typeof jobs = [];
              const seen = new Set<string>();
              jobs.forEach((job) => {
                const key = job.jobId || job.detailUrl || job.title;
                if (!key || seen.has(key)) return;
                seen.add(key);
                deduped.push(job);
              });

              return {
                jobs: deduped,
                diagnostics: {
                  strategyUsed: deduped.length ? 'text-pattern' : 'none',
                  attemptedStrategies: ['text-pattern'],
                  structuredCandidates: 0,
                  textPatternCandidates: jobs.length,
                  deduplicatedCount: deduped.length,
                  skippedEmptyTitleCount: 0,
                },
                llmFallbackInput: {
                  pageUrl: window.location.href,
                  pageTitle: document.title,
                  pageTextSample: normalizeText(document.body?.innerText ?? '').slice(0, 18000),
                },
                extractedAt: new Date().toISOString(),
              };
            },
          },
          (results) => {
            if (chrome.runtime.lastError) {
              sendResponse({
                success: false,
                error: "Couldn't scan this page. Try refreshing and retrying.",
              });
              return;
            }

            const data = results?.[0]?.result;
            if (!data) {
              sendResponse({ success: false, error: 'No extraction data returned from page.' });
              return;
            }

            sendResponse({ success: true, data });
          }
        );
      });
    });

    return true;
  }

  if (message?.type === 'NUWORKS_SCAN_ALL_PAGES') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];

      if (!activeTab?.id) {
        sendResponse({ success: false, error: 'No active tab found.' });
        return;
      }

      const url = activeTab.url ?? '';
      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://')
      ) {
        sendResponse({
          success: false,
          error: "Can't scan browser pages (chrome://, about:, etc.).",
        });
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { type: 'NUWORKS_SCAN_ALL_PAGES', payload: message?.payload },
        (contentResponse) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: 'Could not reach page scanner. Refresh the page and try again.',
          });
          return;
        }

        sendResponse(contentResponse);
        }
      );
    });

    return true;
  }

  if (message?.type === 'NUWORKS_ENRICH_TOP_JOBS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];

      if (!activeTab?.id) {
        sendResponse({ success: false, error: 'No active tab found.' });
        return;
      }

      const url = activeTab.url ?? '';
      if (
        url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://')
      ) {
        sendResponse({
          success: false,
          error: "Can't enrich browser pages (chrome://, about:, etc.).",
        });
        return;
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { type: 'NUWORKS_ENRICH_TOP_JOBS', payload: message?.payload },
        (contentResponse) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              success: false,
              error: 'Could not reach page enrichment worker. Refresh and retry.',
            });
            return;
          }

          sendResponse(contentResponse);
        }
      );
    });

    return true;
  }

  // ---- SEND_TO_LLM (also accepts legacy SEND_TO_CLAUDE) ----
  if (message?.type === 'SEND_TO_LLM' || message?.type === 'SEND_TO_CLAUDE') {
    const payload = message.payload as SendToLLMPayload;
    const { messages, pageContext, llmConfig, messageId, memoryContext } = payload;

    const systemPrompt = buildSystemPrompt(MY_PROFILE, pageContext, memoryContext ?? null);

    sendResponse({ messageId });

    streamLLMResponse(messages, systemPrompt, llmConfig, {
      onChunk: (text) => {
        const chunkPayload: StreamChunkPayload = { chunk: text, messageId };
        chrome.runtime.sendMessage({ type: 'CLAUDE_STREAM_CHUNK', payload: chunkPayload }).catch(() => {});
      },
      onDone: () => {
        const donePayload: StreamDonePayload = { messageId };
        chrome.runtime.sendMessage({ type: 'CLAUDE_STREAM_DONE', payload: donePayload }).catch(() => {});
      },
      onError: (error) => {
        const errPayload: StreamErrorPayload = { error, messageId };
        chrome.runtime.sendMessage({ type: 'CLAUDE_STREAM_ERROR', payload: errPayload }).catch(() => {});
      },
    });

    return true;
  }

  // ---- EXTRACT_JOB_DATA: one-shot structured extraction using active provider ----
  if (message?.type === 'EXTRACT_JOB_DATA') {
    const payload = message.payload as ExtractJobDataPayload;

    const messages = [{ role: 'user' as const, content: payload.prompt }];
    let collected = '';
    let hasResponded = false;

    streamLLMResponse(messages, 'Return only valid JSON. No markdown or explanations.', payload.llmConfig, {
      onChunk: (text) => {
        collected += text;
      },
      onDone: () => {
        if (hasResponded) return;
        hasResponded = true;
        const result: ExtractJobDataResult = { content: collected };
        sendResponse({ success: true, data: result });
      },
      onError: (error) => {
        if (hasResponded) return;
        hasResponded = true;
        sendResponse({ success: false, error });
      },
    });

    return true;
  }

  if (message?.type === 'RUN_LLM_UTILITY') {
    const payload = message.payload as RunLLMUtilityPayload;
    const messages = [{ role: 'user' as const, content: payload.prompt }];
    let collected = '';
    let hasResponded = false;

    streamLLMResponse(messages, 'Return the best direct answer to the user request.', payload.llmConfig, {
      onChunk: (text) => {
        collected += text;
      },
      onDone: () => {
        if (hasResponded) return;
        hasResponded = true;
        const result: RunLLMUtilityResult = { content: collected };
        sendResponse({ success: true, data: result });
      },
      onError: (error) => {
        if (hasResponded) return;
        hasResponded = true;
        sendResponse({ success: false, error });
      },
    });

    return true;
  }

  void tabId;
});
