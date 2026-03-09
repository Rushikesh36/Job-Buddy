import type { SendToLLMPayload, StreamChunkPayload, StreamDonePayload, StreamErrorPayload } from '../lib/types';
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

  // ---- SEND_TO_LLM (also accepts legacy SEND_TO_CLAUDE) ----
  if (message?.type === 'SEND_TO_LLM' || message?.type === 'SEND_TO_CLAUDE') {
    const payload = message.payload as SendToLLMPayload;
    const { messages, pageContext, llmConfig, messageId } = payload;

    const systemPrompt = buildSystemPrompt(MY_PROFILE, pageContext);

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

  void tabId;
});
