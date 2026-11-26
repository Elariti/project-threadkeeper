# Threadkeeper: user guide

The full feature reference. For an overview, screenshots and diagrams see the [README](../README.md); for how it is built see [ARCHITECTURE.md](ARCHITECTURE.md).

Threadkeeper is a desktop app with two halves that work together:

- **The Research Desk** (the main feature): turn papers and notes into an evidence-linked map of claims, findings, methods and limitations. An AI proposes how they connect; *you* decide what becomes part of your argument.
- **The Sidecar**: just Miso the cat's head, floating on your desktop. Drag it anywhere, click it to open the app. It holds unlimited typed notes (checklists, reminders, screenshots, voice and video are all note types you pick from **+**). Research tasks and pending reviews show up here too, so the cat can tell you what needs attention.

Everything is local-first. The optional AI service (FastAPI + Nebius Token Factory, with Tavily for source search) is only called when you press an AI action, and it works without it for everything except the AI steps.

> This is a working MVP, not a production application. See **Limitations** at the end for exactly what is and is not covered.

## The Research Desk

Open it from the **Research Desk** card at the top of the notes panel, the tray menu ("Open Research Desk"), or after tucking the tab away. It opens as a large centred window; **Notes** returns to the sidecar and the arrow tucks everything back into the tab.

**Workflow**

1. **Project**: give it a name and a research question. Everything (extraction, threads, outline) is anchored to the question.
2. **Capture**: add a **text-based PDF** (read page by page by the backend), **paste text**, add items by hand, or turn a sidecar note into an item (**Add to research map** on any note). Scanned PDFs are rejected with a clear message; there is no OCR.
3. **Extract**: the AI pulls out a small set of claims, findings, methods, limitations and questions, each with a verbatim quote and page number. You can also select a passage in the source viewer and turn it into an item with no AI at all.
4. **Map**: a self-organising map of circles (React Flow). Each **source sits in the middle of its own cluster**, its **claims and findings on a ring around it**, and its **methods, limitations, questions and gaps on an outer ring** around those; your own items gather round a "Your items" hub. **Threads act as springs**: linked circles slide round their rings to face each other, and papers joined by threads are pulled side by side, so related work clusters together. Circles never overlap and the map glides into place when something changes. Drag a source to move its whole cluster; drag a circle to set where it sits on its ring (it stays there); **Re-arrange** unpins everything. Also: pan and zoom, minimap, search, type filters, focus mode, and an equivalent **List** view.
5. **Threads**: the AI proposes typed relationships (supports, contradicts, extends, explains, motivates, informs, depends on, related to) with an explanation, quoted evidence and a note on what is uncertain. For each you can **Stitch**, **Investigate**, **Edit** or **Dismiss**.
6. **Investigate**: a context table (population, definitions, conditions, data, outcomes) to judge whether two items truly conflict or just differ in context. The AI can fill it in from the item text, but the assessment and the qualified statement are yours. You then stitch it as, for example, "extends" with a careful sentence.
7. **Gaps**: candidate research gaps from the limitations, disagreements and open questions in *your* collection. Always labelled "observed in this collection, not proof that nobody has studied it", with counter-evidence, next searches, and "I searched elsewhere" to mark one as externally investigated.
8. **Outline**: an evidence-linked outline built deterministically from your *stitched* map (no AI needed; proposed threads only appear if you opt in and are marked), or an AI draft that may cite only items on your map. Sections the map cannot support say "Needs evidence". A draft is flagged stale when the map changes.
9. **Ask**: map-aware Q&A. It retrieves the closest items, answers only from them, cites them as clickable numbers, and says when the map does not contain enough.
10. **Export** the project (items with provenance and quotes, stitched vs proposed threads, gaps, outline, change log) as Markdown. **History** shows every change.

**Visual language**

- **Solid line = stitched** (you confirmed it). **Dashed line = proposed** (not reviewed). Edge labels always say the relationship, and proposed ones also say "proposed" in text, so nothing depends on colour alone.
- Provenance is shown on every item: **Source-stated** (the authors state it and the quote was found in the source text), **AI interpretation**, **You confirmed**, **Unverified**.
- Thread suggestions say where they came from: *AI suggestion*, *Keyword match (no AI)* or *Prewritten sample suggestion*.

**Thread Shift (the signature moment)**: when a new source brings a result that may conflict with something you rely on, the map shows a notice, marks the possibly-contested item and the claims that rest on it ("Needs a second look"), and keeps asking until you review the thread. Resolve it by investigating and stitching a qualified relationship, or dismissing it. The change persists across restarts. Try it without any AI or PDFs: open the Research Desk, **Explore the sample project**, then **Add the new paper**.

**Guardrails (what the code enforces)**

- Model output is untrusted. The backend requires JSON, drops unknown item ids and relationship types, and keeps a quoted passage only if it appears verbatim in the item or source text (after normalising whitespace, curly quotes and hyphenated line breaks). A fabricated quote is removed and the item or thread says so ("evidence missing", "AI interpretation").
- Candidate pairs come from TF-IDF retrieval first; similarity is only used to choose what the model sees, never shown as proof.
- Nothing becomes part of your argument until you stitch it. Dismissed pairs are never proposed again.
- If the AI service is down or has no key, the Desk says so, and offers a keyword-only fallback that only ever proposes "related to" and says nobody has checked the relationship.
- API keys live in `backend/.env`; the renderer never sees them.

## Sidecar features

- Electron desktop shell where the collapsed app is **only the cat's head**: no frame, no shadow box, no taskbar button (the tray icon stays). Drag it anywhere, click it to open, right-click it to pet it. The window is placed so the point you grabbed stays under the real cursor (read in the main process), and a lost pointer capture on Windows no longer ends the drag early, so the head no longer jumps back. The open panel's header drags too. Position is remembered between launches, tucking away returns the head to exactly where you left it, and it stays on screen.
- **Miso, the Threadkeeper cat**: the collapsed icon, peeks over the panel header and says hi at the bottom of the panel. Right-click the head to pet it and hear what is due next. It naps when idle and perks up when deadlines need you.
- **Deadline badge and bubble**: when a task is overdue, due today or due tomorrow, the head shows a count badge and perks up. The speech bubble listing the deadlines pops out when a reminder fires, when you rest the pointer on the head, or when you right-click it; otherwise the app stays just the head. Each row has a "done" tick; **Dismiss** hides them for that stage only, so the cat speaks up again when a deadline moves from tomorrow to today to overdue.
- **Delete anything, with Undo**: notes (trash on every card, **Delete** in the note, or the Delete key), research projects and sources (trash in the Desk sidebar, click twice), items/findings (trash on each row in List, in the item panel, in the source viewer, the Delete key on a selected item, or **Delete all…** per type). Every delete shows an **Undo** for 8 seconds; attachments and source text are only removed from disk after that.
- **One general New note** button (rail, header and `Ctrl/Cmd+N`) opens a picker: text, task/checklist, research, decision, reminder, voice, screenshot and video. Create as many as you like of any type. Text-like notes can switch type in place; a **Task / checklist** note has its own to-do list (tick, edit, delete any item, or Backspace on an empty line; **Clear done**); a **Reminder** note is a deadline. Checklists and deadlines are separate: checklist items have no dates, and every deadline is a Reminder note. Colour is chosen per note.
- **Direct save for captures**: Screenshot / Voice / Video are note types under **+** (new note), and can be added inside any open note (**Add to this note**). Every capture opens a review dialog (preview, title, caption, destination: new note or the open note) with **Save note**; recordings also have **Stop & save** for one-tap saving. Notes also have a **Save note** button and a live saved indicator.
- Capture the current display to a screenshot note; record audio or camera-plus-microphone video notes; play them back, download or remove them from the note detail.
- Expand/collapse workspace; edit and delete notes; persist note metadata locally using Electron Store and store large media files separately in the app's local attachments folder.
- Connect notes manually, suggest simple keyword-based relationships, accept/reject suggestions, and navigate between linked notes.
- Checklist items, reminder notes, reminder scheduling and desktop notifications while the desktop app/tray process is running.
- AI inbox with useful local answers for saved tasks and deadlines even when the AI service is not configured.
- Optional FastAPI backend for Nebius Token Factory inference and Tavily search.
- Settings to enable/disable reminders and configure the AI service URL.

## Requirements

- Node.js 20+ (Node 22 recommended)
- Python 3.11+ for the optional AI backend
- Windows is the target platform for the hackathon build; Electron may also run on macOS/Linux with platform-specific window/notification differences.

## Run the desktop app

```bash
npm install
npm run dev
```

The app starts as Miso the cat's head on the right edge of the desktop. Click the head to open your note list; click a note to reveal its detail pane sideways. Drag the tab (or the cat, or the open app's header) to put it anywhere on your desktop. Use **New note** / **+** (or `Ctrl+N`) to choose a note type, including checklist, reminder, screenshot, voice and video. Use `Ctrl+Shift+Space` to open the AI capture box. Use the tray menu to reopen or quit.

A fresh install starts with an empty workspace. **Settings → Restore demo data** loads sample notes and deadlines, which also makes the cat's deadline bubble appear. It leaves your research projects untouched.

Build frontend assets:

```bash
npm run build
npm start
```

Create a Windows installer (run this on Windows for best results):

```bash
npm run dist:win
```

## Enable Nebius/NVIDIA AI

1. Create a local backend environment file:

   ```bash
   cd backend
   python -m venv .venv
   # Windows PowerShell: .venv\Scripts\Activate.ps1
   # macOS/Linux: source .venv/bin/activate
   pip install -r requirements.txt
   copy .env.example .env
   ```

2. Edit `backend/.env` and set `NEBIUS_API_KEY`. Check the currently available NVIDIA Nemotron model ID in your Nebius Token Factory account and set `NEBIUS_MODEL` accordingly. Never commit API keys.
3. Start the API from the `backend` directory (PDF reading needs PyMuPDF, which `requirements.txt` installs):

   ```bash
   uvicorn main:app --host 127.0.0.1 --port 8000 --reload
   ```

4. In Threadkeeper Settings, leave AI service URL as `http://127.0.0.1:8000`.

The backend uses an OpenAI-compatible chat-completions endpoint. If your account's base URL or model identifier differs, change `NEBIUS_BASE_URL` and `NEBIUS_MODEL` in `.env`. A model request sends the user's message and a compact selection of note/task/link context to the configured service. Notes are not uploaded in the background.

### Which model does what

`NEBIUS_MODEL` handles extraction, Ask and the AI outline draft. `NEBIUS_MODEL_REASONING` handles the judgement-heavy steps: finding threads (including contradictions), Investigate and gaps. Leave `NEBIUS_MODEL_REASONING` empty to use one model for everything. A sensible split is Nemotron 3 Super for the fast steps and Nemotron 3 Ultra for the reasoning steps. Reasoning models can take a minute or more per call, so consider `MODEL_TIMEOUT_SECONDS=240`.

### What the backend exposes

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | reports whether a model key and a Tavily key are configured (never the keys) |
| `POST /research-map/pdf/parse` | text and page boundaries from a text-based PDF (25 MB, 250 pages) |
| `POST /research-map/fetch-fulltext` | download an open-access PDF by link and read it (public http(s) hosts only) |
| `POST /research-map/extract` | structured items with verified quotes and provenance |
| `POST /research-map/discover-threads` | proposed relationships between items (TF-IDF candidates, model classification, validation, ranking) |
| `POST /research-map/investigate-thread` | context table and assessment for two items |
| `POST /research-map/explore-gaps` | candidate gaps tied to real items |
| `POST /research-map/generate-outline` | outline sections citing only existing items |
| `POST /research-map/ask` | cited answer from the closest map items |
| `POST /chat`, `POST /research` | the original sidecar assistant and Tavily search |

Extraction and thread discovery send their model calls in parallel (up to `MODEL_CONCURRENCY`, default 3) and keep partial results with a warning if one call fails. Slow reasoning models (for example Nemotron Ultra on a free tier) can still take a minute or more per call; choose a faster model for testing if you see timeouts. Extraction reads about 4-5 pages per chunk and up to `MAX_EXTRACT_CHUNKS` chunks (default 6) per PDF; later pages are skipped with a warning.

Errors: `503` model not configured, `502` model failure, `422` bad input. The backend is stateless; the app sends only the items, quotes and page text needed for the action you pressed.

The backend now sends CORS headers for loopback origins (`127.0.0.1`/`localhost`) and the packaged app (`null`) only. The earlier version had none, which would have blocked browser-style requests from the renderer.

## Finding papers and links

**Add source → Find papers** searches scholarly indexes directly from the app: **OpenAlex** first, then **Crossref** if OpenAlex fails or finds little. No AI, no key and no backend needed. Results are real records with authors, year, venue, DOI, citation count, abstract and (when there is one) an open-access PDF link; duplicates are merged by DOI and title, and papers already in the project are marked. Paste a DOI, a doi.org link, a publisher link containing a DOI, or an arXiv link to get that exact paper.

- **Add** stores the paper with its abstract as the source text (shown as "abstract only"), so extraction and quote checks work on it straight away.
- **Full text** asks the backend to download the open-access PDF (`POST /research-map/fetch-fulltext`: http(s) only, public hosts only, 25 MB, must really be a PDF) and reads it like an uploaded PDF. If that fails (paywall, landing page, backend off), it falls back to the abstract and says why.
- Links open in your browser, never inside the app window.

**Find threads reasons before it proposes.** Candidate pairs between *different papers* (and between your own items and a paper) come first (at least three quarters of what the model sees), as do pairs with signs of tension (competing percentages, contrast words, a limitation against a result). Restatements of the same point are never paired. For every pair the model writes out what each item says and how they meet, then picks the most precise relationship, including **contradicts** (tensions are proposed even when scope might reconcile them, with that noted as the uncertainty) and the new **qualifies** (one item limits the scope or strength of another). Directions are given as A→B, so they are not lost by mis-copied IDs. A **second, critical reading** then keeps, corrects (type, direction, wording) or drops each proposal before you see it (`THREAD_SELF_CHECK=0` turns it off). Each thread card shows "Different papers / Same paper", whether the second reading kept or corrected it, and "How the AI reasoned". **Edit** can now swap the direction.

**Extraction is stricter about what a quote proves.** Fragment quotes (cut-off sentences, headings) are not accepted as evidence. Each item is checked against its quote: numbers, names (e.g. "UNEP"), formulas and hedging ("may") must be in the quote, and most of its key words must be. Items that say more than their quote are labelled **Partly sourced**, with the reason shown, instead of "Source-stated". Items where the paper reports someone else's work are marked **Cites other work**. Extracting a source again skips what is already on the map, and **List** finds older duplicates and removes them in one click. The outline now says "Only its own quote: no supporting item linked yet" instead of "Needs evidence" when a claim has a verified quote, and the export includes each thread's quotes, the AI's reasoning, and a review summary (stitched / dismissed / acceptance rate).

**Find threads** (links between items) is also sturdier: smaller batches per model call, transient errors (429, 5xx, timeouts, dropped connections) are retried with back-off (`MODEL_RETRIES`, default 2), a reply cut off by the token limit keeps its complete entries instead of failing, an empty "still thinking" reply gets more room once, and if the reasoning model fails the main model is used (with a note). Pairs the AI already checked and found unrelated are remembered per project and skipped next time (until either item changes), so each run spends its calls on new pairs; **Check them again** re-checks everything. A second click while it is running is ignored.

## Enable Tavily research

Set `TAVILY_API_KEY` in `backend/.env` and restart the backend. Use the AI Inbox's **Research** button, or **Add source → Find papers → Web** in the Research Desk. Search results are added as **unverified** sources with no text; they are never used as evidence until you paste the paper's text and check it. This is a runtime API call, not static demo content.

## Data and reminders

- **Research data model** (stored in the same local file, key `research`): `projects` (name, research question), `documents` (title, authors, year, DOI/URL, file name, whether text is available), `items` (the blueprint's `research_items`: type, title, content, document, provenance), `evidence` (item, document, page, quoted text, verified), `connections` (from, to, relationship, explanation, uncertainty, confidence, status `suggested`/`confirmed`/`rejected`, origin), `feedback` (stitch / edit / dismiss / investigate per connection), `layouts` (the blueprint's `map_layouts`), plus `gaps`, `outlines` and a change `history`. Generated explanations are stored separately from exact quoted source text. Page text for each source is one JSON file in the app's data folder (`pages/`).

- Desktop data is stored in Electron Store's local application data file, not a remote database. This is JSON-backed local persistence in this MVP; SQLite migration is a reasonable hardening step if needed.
- The desktop reminder check runs while the Electron main process is alive, including when the window is hidden to the tray. Fully quitting the app stops in-process reminders.
- Reminders are scheduled by the **main process** (every 15 seconds, right after every save, and on wake from sleep), so they fire whatever the window is doing. You get a heads-up **5 minutes before** a deadline and another when it is due (it then shows as overdue) (tasks with only a due date count too); reminders missed while the app was closed fire once as "Overdue" (more than 3 days late are skipped). What was sent is kept in its own ledger, so nothing repeats. Every reminder is also shown inside the app (a banner in the panel/desk, the cat's bubble in the tab), so it is not lost if Windows hides the toast. **Settings → Send test** sends one immediately.
- **Windows toasts need a Start Menu shortcut with the app's ID.** The installer makes one. For `npm run dev`, the app now creates "Threadkeeper Sidecar (dev)" in your Start Menu on first launch (this was why development builds showed no notifications). If nothing appears, check Windows Settings → System → Notifications (allow the app) and Focus assist / Do not disturb.
- Notification delivery depends on operating-system permissions and notification settings.
- Screenshot capture is initiated only when you click the capture action; it captures the display the sidecar is on (the sidecar hides itself for the shot), so close private windows first. The picture is shown for review and is saved only when you press **Save note**.
- Voice and video recording require microphone/camera access. The renderer requests Electron media permission only from the app window, and recording starts only after you click Start recording. Stop & save finalizes a local audio/video attachment. Longer recordings use more disk space; each attachment currently has a 150 MB save limit.
- Media files are stored under the app's local Electron user-data directory in an `attachments` folder. Deleting a note deletes its stored attachments. No media is sent to the AI service automatically.
- The cat pops up its bubble 5 minutes before a deadline and again when it is overdue (it also shows the count as a badge); click a reminder in the bubble to open its note, tick it done, or dismiss. Desktop notifications fire at the same two moments (turn them off in Settings).
- Audio transcription (recordings have a manual caption field instead), cloud sync, accounts, arbitrary computer control, and background execution after the app has fully quit are not implemented.

## Security notes

- API keys belong in `backend/.env`; keep it out of version control.
- The renderer has context isolation and no Node integration; privileged APIs are exposed through a narrow preload bridge.
- The AI service explicitly tells the model not to claim that it wrote data; the UI owns persistence and reminder creation.
- Treat any imported note text and web results as untrusted content. Before adding file access or computer-use tools, implement strict allowlists, user approval and isolated execution.
- The current API has no user authentication because it is designed for local loopback use. Do not expose it to the public internet without adding authentication, rate limits and TLS.

## Tests

```bash
npm test                          # research logic, paper search, checked pairs, deadlines and main-process reminders (node:test, 39 tests)
cd backend && pip install -r requirements.txt -r requirements-dev.txt && python -m pytest   # backend tests (33 tests)
```

The backend tests use a fake model, so they check the validation rules (quote matching, unknown ids, JSON repair, scanned PDFs, CORS) rather than model quality. Browser and Electron end-to-end tests drove the real UI, the real FastAPI process over HTTP and a fake OpenAI-compatible model that deliberately returns bad output (invented quotes, unknown ids, `<think>` blocks, code fences).

## Limitations (please read)

- **The automated tests use a fake model.** They prove the prompts, validation and plumbing, not the quality of the AI output. A small pilot with a real Nemotron model is reported in [RESULTS.md](RESULTS.md); quality after the latest changes has not been re-measured yet.
- **Persistence is local JSON (Electron Store plus per-source page files), not SQLite**, even though the blueprint suggests SQLite. The data layer is isolated in `src/research/store.js` and `electron/main.cjs`, so swapping the storage is a contained change.
- The frontend is **JavaScript with plain CSS**, not TypeScript and Tailwind as in the blueprint.
- **Not included:** methodology exploration, transcription, collaboration, reference-manager import, OCR for scanned PDFs, multi-user accounts.
- The **sample project is invented**: four papers marked "(illustrative sample)" and prewritten suggestions marked as such. It exists to demonstrate the workflow offline.
- Pasted text has no page numbers; passages from pasted sources are cited by section.
- Web-search sources are unverified and carry no text until you paste it.
- The map suits tens of items, not thousands; discovery considers the most similar pairs only.

## Project structure

```text
threadkeeper-sidecar/
├── electron/       # Main process (window modes, dragging, bubble sizing, source-text files) and secure preload bridge
├── src/            # React renderer and styles
│   ├── research/   # Research Desk: store (pure state transitions), useResearch hook, sample project, layout, outline, export, API client, unit tests
│   │   └── desk/   # Desk UI: map, list, threads, gaps, outline, ask, source viewer, dialogs
│   ├── components/ # CatMascot, TabCluster, DeadlineBubble, NewNoteModal, CaptureModal, PocketCat
│   ├── hooks/      # useWindowDrag (drag the window; click vs drag)
│   └── lib/        # note types, deadline logic, capture helpers
├── backend/        # Optional FastAPI + Nebius + Tavily service
│   ├── research/   # PDF parsing, extraction, thread discovery, investigation, gaps, outline, Q&A, validation
│   └── tests/      # pytest
├── package.json
└── README.md
```

## License

MIT — see `LICENSE`.
