# gemiredmine Roadmap

## Platforms
- **Client Builds:** Target platforms are Ubuntu (Debian) and Android, utilizing Electrobun for native builds.
- **Frontend Framework:** Evaluate and select a suitable cross-platform JS framework to ensure seamless performance across devices.

## Architecture
- **Multi-Server Management:** Support connecting to and managing communication across multiple independent backend servers, using the Mattermost client as a reference architecture.
- **Connection Storage:** Store server connections to allow users to easily switch and work on their active server.

## Security & Authentication
- **Simple Integration Process:** Upon selecting a server, the user enters their login password to retrieve an API token for subsequent requests.
- **Password Management:** Do not store or remember passwords by default.
- **Keepass Auth:** Devise and implement Keepass authentication as an optional feature for secure credential management.

## Core Features
- **UI & Styling:** Utilize Tailwind CSS as the primary CSS framework.
- **Accessibility First:** Design and develop all features with an accessibility-first mindset.
- **Deep Gemini Integration:**
  - Integrate a Gemini client directly into the device/app to provide an agent that understands the context of the current server connection.
  - Integration will be highly configurable, taking a cloud-first approach.
  - The Gemini agent will assist with main routines such as managing reminders, time logging, task updates, and wiki updates.

## Backlog & Community Features
- **In-App Feature Requests:** If the user encounters a limitation or requires a new capability that can be addressed in a client update, provide an integrated flow to seamlessly create a feature request directly on the project's repository.
