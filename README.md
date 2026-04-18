# JobBuddy AI 🤖

Your personal AI job application assistant in your browser. Read any job posting, let JobBuddy analyze it against your profile, and send one-click emails to hiring managers—all while keeping your data private.

---

## 📋 Part 1: What This Extension Does & How It Works

### The Big Picture

JobBuddy AI is a Chrome extension that:
1. **Reads job postings** from the web page you're viewing
2. **Analyzes them** using AI against your resume/profile
3. **Extracts key job details** and saves them to Google Sheets
4. **Helps you write cold emails** to hiring managers
5. **Sends emails** directly from your Mac Mail app (or any email client)

Everything runs **locally in your browser**—your resume, API keys, and all data stay on your device. No servers involved.

### Core Features Explained

| Feature | What It Does |
|---------|-------------|
| **🔍 Read Page** | Extracts all text from the current job posting |
| **🧠 Analyze Job** | AI compares job requirements to your resume—shows skill gaps, ATS score, salary range |
| **📊 Save to Sheet** | Automatically pulls job title, company, link, and saves to your Google Sheet for tracking |
| **✉️ Compose Email** | Opens a blank email form you can fill in to reach out to the hiring manager |
| **📝 Chat** | Ask follow-up questions (e.g., "How should I tailor my resume?") and AI responds in real-time |
| **💾 Memory** | (Optional) JobBuddy learns your preferences over time for smarter suggestions |

### How the Infrastructure Works

#### **Frontend (What You See)**
- **React + TypeScript** — interactive UI with real-time updates
- **Tailwind CSS** — beautiful, responsive design
- **Components**:
  - `ChatWindow` — displays messages from you and AI
  - `InputBar` — 4 action buttons (Read, Analyze, Save, Email) + input box
  - `EmailComposeModal` — lets you write emails
  - `JobSaveModal` — confirms job details before saving to Sheet

#### **Background Worker (The Brain)**
- **Chrome Service Worker** — runs in background, handles:
  - Extracting text from web pages
  - Communicating with AI APIs (Claude, Gemini, or OpenAI)
  - Streaming responses back to the UI in real-time

#### **Data Storage (Your Vault)**
- **Chrome Local Storage** — stores your settings locally on your device:
  - API keys (encrypted, never sent anywhere)
  - Resume/profile info
  - Conversation history
  - Google Sheets config
- **Google Sheets API** — optionally syncs job data to your Google Sheet (you control this)
- **Google Gmail API** — backfills your email if needed

#### **LLM Integration (The Smarts)**
- **Multi-LLM Support**:
  - Anthropic Claude (recommended for accuracy)
  - Google Gemini (fast, free tier available)
  - OpenAI (GPT-4, GPT-3.5)
- **Streaming** — responses appear word-by-word, not all at once
- **Your Resume Context** — every conversation includes your resume so AI knows your background

### Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│           Your Chrome Browser                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────┐         ┌──────────────────┐ │
│  │   Side Panel UI  │         │  Service Worker  │ │
│  │   (React App)    │◄───────►│   (Background)   │ │
│  │                  │         │                  │ │
│  │ • Chat messages  │         │ • Page extraction│ │
│  │ • Input buttons  │         │ • LLM requests   │ │
│  │ • Email form     │         │ • Data streaming │ │
│  └──────────────────┘         └──────────────────┘ │
│           │                             │           │
│           │ (Reads page content)        │           │
│           ▼                             ▼           │
│  ┌──────────────────────────────────────────────┐  │
│  │   Chrome Local Storage                        │  │
│  │   • Your API keys (local only!)              │  │
│  │   • Your resume                              │  │
│  │   • Conversation history                     │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
          │                          │
          │ (Optional: one-time)    │
          ▼                          ▼
    ┌──────────────┐         ┌──────────────┐
    │ AI API       │         │ Google       │
    │ (Claude,     │         │ Sheets/Gmail │
    │ Gemini, etc) │         │              │
    └──────────────┘         └──────────────┘
```

### Known Issues & How We Solved Them

**Issue 1: Email Address Missing After Google Login**
- **Problem**: After connecting Google account, "Email unavailable" error appeared
- **Solution**: Added fallback endpoints to Google's userinfo API. If one fails, we try another. If still missing, we fetch it on startup.

**Issue 2: Can't Send Emails Directly From Extension**
- **Problem**: Gmail API is complex and requires full OAuth scopes
- **Solution**: We use simple `mailto:` links that open your Mac Mail app (or default email client). You attach your resume and send—you stay in control.

**Issue 3: Email Buttons Only Visible at Chat Start**
- **Problem**: Users couldn't compose emails mid-conversation
- **Solution**: Moved "Compose Email" button to persistent action bar at bottom (always visible)

---

## 🚀 Part 2: How to Use JobBuddy AI (Simple Guide)

### Step 1: Install the Extension

1. Download this repository or clone it:
   ```bash
   git clone https://github.com/Rushikesh36/Job-Buddy.git
   cd Job-Buddy
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```
   *(Files appear in `dist/` folder)*

4. **Load into Chrome**:
   - Open Chrome → go to `chrome://extensions/`
   - Turn on **Developer Mode** (top-right corner)
   - Click **"Load unpacked"**
   - Select the `dist/` folder
   - ✅ JobBuddy appears in your extensions!

### Step 2: Set Up Your Profile

1. Open the extension
2. Go to **Settings** tab (gear icon)
3. Paste your resume/profile into the text box
4. Choose your preferred AI (Claude, Gemini, or OpenAI)
5. Enter your API key for that AI
6. **Save** ← Done!

> **Not sure where to get API keys?**
> - [Claude API](https://console.anthropic.com/) — free trial included
> - [Google Gemini API](https://ai.google.dev/) — free tier available
> - [OpenAI API](https://platform.openai.com/) — pay as you go

### Step 3: Use It On Any Job Posting

**Here's the workflow:**

1. **Open a job posting** in your browser (LinkedIn, Indeed, company website, etc.)

2. **Click the JobBuddy extension** icon in your toolbar → side panel opens on the right

3. **Click "Read Page"** button
   - Extension scans the job posting
   - You'll see a banner saying "Page context loaded"

4. **Click "Analyze Job"** button
   - AI compares the job to your resume
   - You get: skill gaps, ATS score, salary range, recommendation
   - Takes ~5-10 seconds

5. **Ask follow-up questions** (optional)
   - "What should I focus on in my cover letter?"
   - "How does this role fit with my career goals?"
   - Type in the chat box and hit Enter

6. **Save the job** (optional)
   - Click **"Save to Sheet"** button
   - Extension pulls company, role, link, and saves to your Google Sheet
   - You can track all jobs you've analyzed

7. **Send an Email** (optional)
   - Click **"Compose Email"** button
   - Fill in:
     - **To**: hiring manager's email
     - **Subject**: your subject line
     - **Body**: the message or template JobBuddy helped you write
   - Click **Send**
   - Your default email app opens (Mac Mail, Gmail, Outlook)
   - Attach your resume and send from there

### Step 4 (Optional): Track Jobs in Google Sheets

If you want to track all jobs automatically:

1. **In Settings**, enable "Connect Google"
2. Click **"Connect Google Account"**
3. Sign in with your Google account
4. JobBuddy creates a new Google Sheet for you (or you can link an existing one)
5. Every time you click **"Save to Sheet"**, the job is added automatically

> **Why Google Sheets?** It's free, syncs across devices, and you can share it with mentors or friends.

### Step 5 (Optional): Enable AI Memory

JobBuddy can learn your preferences to give better suggestions:

1. Go to **Memory** tab
2. Turn on **"Enable Memory"**
3. Over time, JobBuddy learns:
   - Your preferred industries
   - Salary expectations
   - Role types you care about
   - Your career goals

> **Privacy note**: Memory is stored locally on your device. We never send it to servers.

---

## 💡 Common Questions

### "Will this steal my resume or API keys?"
**No.** Everything stays on your device. Your API keys, resume, and all data are stored in Chrome's local storage—never sent to any server except the AI provider you choose (and you control which one).

### "How much does this cost?"
**Free or cheap**, depending on which AI you use:
- **Claude** — $5 free credit, then pay per token
- **Gemini** — free tier (limited daily requests)
- **OpenAI** — pay per token (~$1-5/month for casual use)

### "Can I use this on LinkedIn, Indeed, Glassdoor, etc?"
**Yes!** Works on any website that has a job posting as readable text. If it's on a webpage, JobBuddy can read it.

### "What if the email button doesn't work?"
**Check**:
1. Did you click "Compose Email" or "Save to Sheet" first?
2. Is your default email app set up? (Mac Mail, Gmail, Outlook, etc.)
3. Try clicking again—sometimes Mac Mail takes a moment to open

### "How do I update my resume in the extension?"
Go to **Settings** → paste new resume → **Save**. Done!

### "Can I reset everything?"
In Chrome → **Extensions** → find JobBuddy → **Remove**. Then re-add it fresh. (Your data will reset.)

---

## 📁 Project Structure (For Developers)

```
src/
├── background/
│   └── service-worker.ts        # Background worker (page reading + LLM relay)
├── config/
│   └── system-prompt.ts         # AI system prompt (injects your resume)
├── content/
│   └── content-script.ts        # Runs on every webpage (supports page reading)
├── lib/
│   ├── claude-api.ts            # Anthropic Claude streaming
│   ├── llm-api.ts               # Unified LLM interface
│   ├── profile.ts               # Default resume template
│   ├── types.ts                 # All TypeScript types
│   └── google-api.ts            # OAuth & Google API helpers
├── prompts/
│   ├── job-extractor.ts         # Prompt for extracting job data
│   ├── preference-extractor.ts  # Learns your preferences
│   └── summarizer.ts            # Summarizes conversations
├── services/
│   ├── gmail-service.ts         # Email detection & formatting
│   ├── google-auth.ts           # Google OAuth flow
│   ├── sheets-service.ts        # Google Sheets API
│   └── memory-service.ts        # Conversation memory + preferences
├── types/
│   ├── email.ts                 # Email data structures
│   ├── job.ts                   # Job & spreadsheet types
│   └── memory.ts                # Memory system types
└── sidepanel/
    ├── App.tsx                  # Main app component
    ├── components/
    │   ├── ChatWindow.tsx       # Chat + welcome screen
    │   ├── EmailComposeModal.tsx# Email composition form
    │   ├── InputBar.tsx         # 4 action buttons + chat input
    │   ├── JobSaveModal.tsx     # Confirm before saving job
    │   ├── MemoryPanel.tsx      # Memory/preferences panel
    │   ├── MemoryItem.tsx       # Memory list item
    │   ├── MessageBubble.tsx    # Individual chat message
    │   └── ...more components
    └── styles/
        └── globals.css          # Global styles
```

---

## 🛠️ Development

### Run Locally

```bash
npm run build    # Build extension
npm run dev      # Watch for file changes (if supported by vite config)
```

### Load into Chrome

1. Go to `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select `dist/` folder
4. Open any job page and test!

### Make Changes

- Edit files in `src/`
- Run `npm run build`
- In Chrome → refresh the extension (circular arrow on extension card)
- Reload the webpage to test

---

## 🤝 Contributing

Found a bug? Have an idea?
- Open an issue on GitHub
- Submit a pull request
- Or just email us feedback

---

## 📄 License

MIT License — feel free to use, modify, and share

---

## 🎯 Roadmap

- [ ] Firefox support
- [ ] Mobile app version
- [ ] LinkedIn integration (auto-fill profile)
- [ ] Interview prep with mock questions
- [ ] Salary negotiation templates
- [ ] Bulk job analysis (analyze 10 jobs at once)

---

**Questions?** Feel free to reach out or open a GitHub issue. Happy job hunting! 🚀
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
