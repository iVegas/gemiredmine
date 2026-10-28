# AI assistant

The Assistant view is a chat with a model of your choice. It answers from your Redmine servers, your assigned tasks and
your time, and it calls the same tools as the [MCP endpoint](ai-agents.md). It needs no endpoint to be turned on.

## Where it is

The assistant follows you: a round button sits in the bottom right corner of every view, and it opens a chat that
floats over the view you are working in, so a question about the task in front of you needs no trip to another screen.
**Control+Shift+A** (⌘⇧A) brings it up from wherever you are.

- **Several chats at once.** The **+** above the button starts another one, and up to three sit side by side; opening a
  fourth rolls the one open longest into its title bar. Each chat keeps its own question, its own answers and its own
  name, which it takes from the first thing you ask in it.
- **Move and resize.** Drag a chat by its name to put it anywhere in the window; drag the grip in its top left corner to
  make it bigger. Enough of the title bar always stays on the screen to drag it back.
- **Roll it up** with the − in its title bar, by clicking its name, or with Escape. The chat becomes its own title bar at
  the bottom of the window; what you were typing stays as it is.
- **Close it** with the ✕. The chat is not lost: it is still in the Assistant tab, and the button in the corner brings it
  back, with a badge for the answers that arrived while you were away.
- **Open it in a tab** with the ↗, for a long conversation at full width. The tab lists every chat you have, lets you
  start or forget one, and **Keep it floating** sends the one you are reading back to a window of its own.
- The button is not shown in **Settings**, where the assistant is set up and a chat would cover the form, nor over the
  Assistant tab, which is the same chats already. The shortcut opens the Assistant tab on those two screens.

## Asking about a task

A task opened in its own tab has an **Ask the assistant** button next to **Open in Redmine**. It starts a chat named
after the task, with the question begun for you (`About task #42 (Fix the login): `) and the window beside the task, so
you can finish the question in your own words. The assistant reads the task with the same tool an AI agent would.

Set the assistant up in **Settings → AI assistant**.

## What this computer offers

The settings screen looks for a model before it asks you for anything, and again whenever you press **Search again**.
Each thing it finds has a button that fills the form in; nothing is saved until you press **Save the assistant**.

| What it looks for | How | What the button does |
| --- | --- | --- |
| A model this device runs itself | The webview's built-in model (the Prompt API). On Android that is Gemini Nano through the system's AICore; the system keeps it up to date, so the app carries no model | Chooses **On this device**: no address, no key, no model name |
| A local model server | Asks the usual addresses on this computer — Ollama (11434), LM Studio (1234), Lemonade or vLLM (8000), llama.cpp or LocalAI (8080), Jan (1337), GPT4All (4891), the text generation web UI (5000) — for their model list | Fills in the address and the first model the server offers |
| A service this computer has a key for | `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API_BASE` and `OLLAMA_HOST` in the environment, then `~/.gemini/.env` and `~/.config/io.datasette.llm/keys.json` | Chooses the service and puts the key in the form, where it is not shown. Saving keeps it in the credential store |

The key a service was found with is never written to the app's files or shown on screen, and nothing outside those
places is read. Finding nothing is the usual case, and the screen says so instead of reporting a failure.

## Choosing a service yourself

| Service | Address it starts from | Key |
| --- | --- | --- |
| OpenAI-compatible (OpenAI, Lemonade, Ollama, LM Studio) | `https://api.openai.com/v1` | optional |
| Anthropic (Claude) | `https://api.anthropic.com/v1` | yes |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | yes |
| On this device (no key, no network) | — | none |

For a local server, change the address to the server's own, such as `http://127.0.0.1:8000/v1`, and leave the key empty.
The model is the name the server or the service gives it; the box suggests the names of the models the chosen service is
known for, and the ones a local server at that address reported. The app does not guess one.

A service that hands out keys has a **Get a key from …** link next to the key box, which opens that page in your
browser — Google AI Studio for Gemini, the Anthropic console, the OpenAI dashboard. The app opens only those pages: the
screen names the service, never a link.

The keys are kept in the system's credential store, the same place as the sign-ins of your servers. They are not written
to the app's files, and the settings screen never shows a saved key again.

## The model on this device

**On this device** uses the model the webview carries, with no key, no server and no network. It is the one service that
cannot call the app's tools, so it answers from the conversation alone and never reads your tasks or your time. The
Assistant view says so while it is chosen. Where this webview has no built-in model, the first question says so and
points back to Settings.

## Setting the app up from a link

Under **Set this up from a link** in the settings, **Copy this setup as a link** gives you a line such as

```
gemiredmine://assistant?provider=gemini&address=https%3A%2F%2Fgenerativelanguage.googleapis.com%2Fv1beta&model=gemini-2.5-flash
```

Paste such a link, or the same settings in JSON, into the box and press **Fill in the form**. The link the app hands out
carries no API key; a link that somebody added `key=…` to fills the key box too, and saving keeps that key in the
credential store. The link is not registered with the system yet, so it is pasted rather than clicked.

## What it already knows

The assistant is told what the app is showing before it answers, so it does not ask you for what is on your screen:

- **today's date**, so "this week", "today" and "already" mean what you mean;
- **the server the app is showing**, and the login you are signed in with there — a question that names no server is
  about that one, and the other servers are read only when you name them;
- **the project you have selected** next to the user menu, if any: questions about your tasks and time mean that project.

The addresses of your servers and your API keys are never part of it. The assistant also works dates out for itself, so
"how much have I logged this month" needs no dates from you: it reads them with `list_my_time`, which totals the time
you logged across every task, per project and per task.

## Changes need your approval

The assistant can read everything the MCP endpoint reads. It can also propose a time entry or a task change. A proposal
is not saved in Redmine: it appears in the notice at the top of the window, and it is written only when you approve it.
This is the same rule that applies to changes from an AI agent.

## Voice (optional)

Voice needs a voice model that you attach in the same settings section. It is an OpenAI-compatible server that turns
speech into text and, if it has one, text into speech. OpenAI and local servers such as Lemonade or whisper.cpp both work.

- **Speak** records from the microphone. When you stop, the words go into the message box, so you can check them before
  you send. A window whose webview has no recorder, such as WebKitGTK on some Linux systems, says so once and then
  offers no Speak button; replies can still be read aloud there.
- **Read replies aloud** reads each answer when a text-to-speech model is attached.

The voice model has its own key, and the voice buttons appear only when a voice model is attached. Recording needs a
window that can use the microphone; where it cannot, the app says so and you type the message instead.

## What is not kept

The chats last while the app runs. Closing the app clears them, and so does forgetting a chat in the Assistant tab.

## Not there yet

- **Chats that outlive the app.** Nothing is written to disk, so a chat is gone at the next start.
- **A server on another machine of your network.** Only this computer's usual addresses are asked. Finding a server on
  the network needs mDNS or SSDP, which the Rust side would have to do; until then, type its address.
- **Scanning a QR code.** A setup link is pasted. Reading one from the camera needs the camera, which the app does not
  use yet.
- **Gemini Nano through ML Kit.** On Android the built-in model is reached through the system WebView's Prompt API. The
  native ML Kit GenAI Prompt API would make it available on devices whose WebView does not offer it, and would let it
  stream; it needs a Kotlin plugin next to the credential vault.
