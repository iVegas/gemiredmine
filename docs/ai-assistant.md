# AI assistant

The Assistant view is a chat with a model of your choice. It answers from your Redmine servers, your assigned tasks and
your time, and it calls the same tools as the [MCP endpoint](ai-agents.md). It needs no endpoint to be turned on.

## Set it up

Open the user menu, choose **Assistant**, then **Settings** when it asks. In **AI assistant**, choose a service and name
the model:

| Service                                                  | Address it starts from                         | Key      |
| -------------------------------------------------------- | ---------------------------------------------- | -------- |
| OpenAI-compatible (OpenAI, Lemonade, Ollama, LM Studio)  | `https://api.openai.com/v1`                    | optional |
| Anthropic (Claude)                                       | `https://api.anthropic.com/v1`                 | yes      |
| Google Gemini                                            | `https://generativelanguage.googleapis.com/v1beta` | yes  |

For a local server, change the address to the server's own, such as `http://127.0.0.1:8000/v1`, and leave the key empty.
The model is the name the server or the service gives it. The app does not guess one.

The keys are kept in the system's credential store, the same place as the sign-ins of your servers. They are not written
to the app's files, and the settings screen never shows a saved key again.

## Changes need your approval

The assistant can read everything the MCP endpoint reads. It can also propose a time entry or a task change. A proposal
is not saved in Redmine: it appears in the notice at the top of the window, and it is written only when you approve it.
This is the same rule that applies to changes from an AI agent.

## Voice (optional)

Voice needs a voice model that you attach in the same settings section. It is an OpenAI-compatible server that turns
speech into text and, if it has one, text into speech. OpenAI and local servers such as Lemonade or whisper.cpp both work.

- **Speak** records from the microphone. When you stop, the words go into the message box, so you can check them before
  you send.
- **Read replies aloud** reads each answer when a text-to-speech model is attached.

The voice model has its own key, and the voice buttons appear only when a voice model is attached. Recording needs a
window that can use the microphone; where it cannot, the app says so and you type the message instead.

## What is not kept

The conversation lasts while the app runs. Closing the app clears it.
