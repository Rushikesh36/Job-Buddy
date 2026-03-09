# JobBuddy AI

A Chrome extension that sits in your browser's side panel and acts as your personal job application assistant. It reads any job posting, cross-references it against your resume, and gives you an instant analysis — ATS match score, skill gaps, apply recommendation, and salary range adjusted for F-1 OPT/CPT and H-1B candidates.

---

## Features

- **Job Analysis** — reads the active tab and returns a structured breakdown: company, role, required skills (matched vs. missing), ATS score out of 10, apply decision, and visa-aware salary range
- **Multi-LLM Support** — switch between Anthropic Claude, Google Gemini, and OpenAI. Per-provider API keys and model selection, all stored locally
- **Streaming Responses** — all three providers stream tokens in real time via SSE
- **Resume Context** — your full resume is embedded in every system prompt; the LLM always knows your background without you pasting it
- **Page Reading** — one click extracts the current page's text content and attaches it as context for the conversation
- **Cold Email / Cover Letter** — ask follow-up questions after the analysis to generate ready-to-send outreach
- **Visa Awareness** — flags roles requiring US citizenship or permanent residency; salary ranges are scoped to F-1/OPT/CPT/H-1B realities, not just green card holders

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome Manifest V3, Side Panel API |
| Frontend | React 18, TypeScript, Tailwind CSS |
| Build | Vite |
| LLMs | Anthropic Claude, Google Gemini, OpenAI (streaming SSE) |
| Storage | `chrome.storage.local` (keys never leave your device) |

---

## Project Structure

```
src/
├── background/
│   └── service-worker.ts      # MV3 service worker — page extraction + LLM relay
├── config/
│   └── system-prompt.ts       # System prompt builder (injects resume + page context)
├── lib/
│   ├── llm-api.ts             # Unified streaming layer for all three providers
│   ├── profile.ts             # Your resume — edit this with your own info
│   └── types.ts               # Shared TypeScript types
├── sidepanel/
│   ├── App.tsx                # Main side panel app
│   └── components/
│       ├── ChatWindow.tsx
│       ├── InputBar.tsx
│       ├── MessageBubble.tsx
│       └── PageContextBanner.tsx
└── content/
    └── content-script.ts
```

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd jobbuddy-ai
npm install
```

### 2. Add your resume

`src/lib/profile.ts` is gitignored — your personal data is never committed. Copy the example template and fill it in:

```bash
cp src/lib/profile.example.ts src/lib/profile.ts
```

Then edit `src/lib/profile.ts` with your own name, education, work experience, skills, and projects. This file is the single source of truth for everything the LLM knows about you — the more detail you add, the better the analysis.

### 3. Build

```bash
npm run build
```

This outputs to `dist/`.

### 4. Load in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `dist/` folder

### 5. Add an API key

Click the extension icon, open the side panel, go to **Settings** (gear icon), and paste your API key for whichever provider you want to use.

| Provider | Where to get a key |
|---|---|
| Anthropic Claude | console.anthropic.com |
| Google Gemini | aistudio.google.com |
| OpenAI | platform.openai.com |

Keys are saved to `chrome.storage.local`. They are sent directly to the provider when you chat — nowhere else.

---

## Usage

1. Navigate to any job posting (LinkedIn, Greenhouse, Lever, company careers page, etc.)
2. Open the side panel (click the extension icon)
3. Click **Read Page** — the green banner will confirm the page was captured
4. Type anything (e.g. "analyze this job") and hit Enter
5. The extension returns the structured job analysis instantly

You can then ask follow-up questions:
- "Write a cold email to the hiring manager"
- "Which of my projects should I highlight for this role?"
- "Give me a tailored cover letter"
- "What questions should I prep for this interview?"

---

## Supported Models

**Claude**
- claude-sonnet-4-20250514 (default)
- claude-3-5-haiku-20241022

**Gemini**
- gemini-2.5-flash (default, 15 RPM free)
- gemini-2.5-pro (paid tier)
- gemini-2.0-flash
- gemini-2.0-flash-lite
- gemini-1.5-flash

**OpenAI**
- gpt-4o (default)
- gpt-4o-mini
- gpt-4-turbo

---

## Free Tier Limits

| Provider | Free RPM | Notes |
|---|---|---|
| Gemini 2.5 Flash | ~15 | Recommended for daily use |
| Gemini 2.5 Pro | 5 | Hits rate limits quickly on free tier |
| Claude | varies | Check console.anthropic.com |
| OpenAI | N/A | Pay-as-you-go |

---

## Development

```bash
npm run build        # production build
npm run dev          # watch mode (rebuild on save)
```

After rebuilding, go to `chrome://extensions` and click the refresh icon on the extension to load the latest `dist/`.

---

## Notes for F-1 Students

- The system prompt is tuned to flag any role that explicitly requires US citizenship or a green card
- Salary ranges in the analysis are scoped to what F-1 OPT/CPT and H-1B candidates realistically see, not the broader US market
- The extension notes whether an employer is known to sponsor H-1B when that information is available
- Availability is set to **May 2026 – December 2026** in the profile — update `src/lib/profile.ts` when your co-op cycle changes
