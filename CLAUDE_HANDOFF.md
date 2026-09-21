# Xpecter backlog handoff for Claude

## Product summary

Xpecter is a cross-platform terminal application focused on SSH, local shells, serial consoles, and remote file workflows. The product already has a meaningful core: it works as a real terminal tool and is structured around a clear user problem rather than a generic all-purpose console.

The product is no longer at the question of whether it works. The next question is whether it feels like a place users want to spend hours in every day. At this stage, polish matters more than feature breadth.

## Strategic direction

The best path to success is not more features for the sake of feature count. The path is to make Xpecter feel fast, coherent, and calm in daily use. The app should feel premium in the small things: quick session switching, consistent visual hierarchy, strong home experience, smooth terminal behavior, and a low-friction workflow for infrastructure-heavy work.

The next product phase should focus on:
- session workflow ergonomics
- visual polish and consistency
- home and quick-launch experience
- keyboard-first productivity
- strong search and discovery
- reliability and recovery clarity
- making the app feel habit-forming rather than merely functional

## Primary goal

Turn Xpecter from a working utility into a tool people want to keep open all day.

## Status as of v3.8.0 (2026-09-21)

What has shipped against this backlog since it was written, by item:

1. Session workflow ergonomics: session restore on launch (tabs, panes, editors, shells, consoles), named layouts, the pane-fill menu, send input to all panes, forwards and agent forwarding saved with a session, PuTTY import alongside MobaXterm and SSH config.
2. Visual system: one dialog definition and one compact control style everywhere, tag colours on tabs, pane headers and sidebar rows, cursor style and blink settings.
3. Home experience: pinned and recent sessions, Quick connect, the restore offer, saved layouts as cards, the shortcut strip.
4. Keyboard-first: Ctrl+Tab and Ctrl+1 to 9 tab switching, Alt+Arrow pane focus, find in output (Ctrl+Shift+F), find in files, rebindable shortcuts.
5. Search and recall: the sidebar filter over name, host, port and tags; Quick connect search; find in output; find in files; recent sessions.
6. Settings: a grouped dialog with risky options separated; highlight rules and tag colours as their own groups; import, export, encrypted bundles, backups and reset in one place.
7. Terminal smoothness: bracketed paste, paste line delay, activity and bell markers with OS notifications, custom highlight rules, serial console controls (line ending, local echo, DTR and RTS, break, hex view).
8. Recovery and error clarity: the Session stopped panel with reconnect, save and close; the application log (View > Open Log Folder); agent-forwarding and saved-forward failures reported on the terminal instead of failing the connection; the production tag guard on pastes and snippets.
9. Remote file editing: downloads and uploads with progress, edit externally with upload on every save, save as root through sudo, the browser following the shell via OSC 7 with a Shell Integration dialog.

Still open from the original direction: detected serial ports as a dropdown, tabs between windows, drag-out downloads from the remote browser, ZMODEM (needs a binary-safe terminal path), font ligatures (the addon is not usable in the WebView). Ticket ids in code are SPE-nnn; the highest cited is SPE-132.

## Backlog

### 1) Improve session workflow ergonomics
Priority: P0

Title: Improve session creation, switching, splitting, and recovery

Problem:
The app already works, but the day-to-day flow still feels utilitarian rather than effortless. We need to reduce friction in session creation, switching, splitting, reconnecting, and restarting so the product feels immediate and confident in use.

Goals:
- make new session creation fast and obvious
- make tab and pane management consistent and natural
- reduce friction for local, SSH, and serial sessions
- make reconnect and restart actions obvious and low-risk
- ensure users can understand the current session context without guesswork

Acceptance criteria:
- creating and switching sessions requires minimal clicks or keystrokes
- tab and pane behavior is consistent across connection types
- reconnect and restart actions are visible and easy to act on
- users can understand which session is active without reading docs
- session lifecycle actions feel polished and dependable

---

### 2) Standardize the visual system and panel hierarchy
Priority: P0

Title: Unify app visual language across tabs, panes, settings, and terminal surfaces

Problem:
At this stage, product quality is dictated by polish just as much as functionality. The app needs a cohesive visual system across tabs, panes, settings, and terminal surfaces so it feels like one product rather than a set of individual tools.

Goals:
- align spacing, typography, focus states, panels, and controls
- improve dark/light theme quality
- make application states visually obvious
- elevate the terminal UI from “working” to “premium”

Acceptance criteria:
- all major surfaces share a coherent visual language
- active, inactive, and focused states are visually unmistakable
- theme modes look intentional, consistent, and comfortable
- terminal chrome and surrounding UI feel designed rather than assembled
- the app feels more refined without adding unnecessary complexity

---

### 3) Build a home experience that supports daily use
Priority: P0

Title: Design a home experience that feels useful on every launch

Problem:
The first-run and recurring launch experience should feel intentional, not utilitarian. A stronger home experience creates trust, speeds onboarding, and makes the app feel like a place users want to return to.

Goals:
- create a useful home/start screen
- surface recent and saved sessions quickly
- make quick-connect obvious
- reduce friction before the first session is active

Acceptance criteria:
- the home screen is useful before a session is connected
- recent and saved sessions are easy to browse and reopen
- new session entry is obvious and fast
- the app feels inviting on first launch and on every return
- the product supports habit formation instead of just task completion

---

### 4) Improve keyboard-first session management
Priority: P1

Title: Add keyboard-first session management and navigation

Problem:
Power users should be able to manage sessions without relying heavily on the mouse. Keyboard ergonomics are core to making the app feel fast and native to terminal workflows.

Goals:
- add shortcuts for common session actions
- improve tab and pane navigation
- make keyboard flows consistent and discoverable
- avoid collisions with terminal input behavior

Acceptance criteria:
- common actions have predictable shortcuts
- users can navigate tabs and panes efficiently
- session controls are usable without frequent mouse actions
- keyboard behavior does not interfere with terminal use

---

### 5) Improve search, discovery, and session recall
Priority: P1

Title: Improve session search, quick-find, and recovery

Problem:
As the number of sessions grows, the app needs better tools to help users find what they need quickly. Search and discoverability are core to making a terminal app feel organized instead of chaotic.

Goals:
- allow quick search across session labels, hosts, groups, and tags
- surface recent and relevant sessions faster
- reduce pain from session sprawl
- make forgotten or stale sessions easier to recover

Acceptance criteria:
- users can find sessions quickly by common attributes
- search results are clear and actionable
- stale or forgotten connections are easier to recover
- the app scales with user activity without becoming cluttered

---

### 6) Simplify settings and reduce configuration confusion
Priority: P1

Title: Simplify settings and reduce hidden configuration traps

Problem:
Configuration is often where tools feel messy. We should make settings less hidden and more aligned with real usage patterns so the app feels trustworthy and easier to maintain.

Goals:
- prioritize commonly-used settings
- make dangerous or advanced options obvious
- reduce hidden configuration patterns
- align settings layout with actual workflows

Acceptance criteria:
- key settings are visible and discoverable
- advanced settings are clearly distinguished
- users can understand their current configuration at a glance
- settings do not feel like an internal implementation dump

---

### 7) Improve terminal smoothness and perceived product quality
Priority: P2

Title: Improve terminal smoothness and perceived product quality

Problem:
The terminal experience should feel fluid and comfortable in use. This is where perceived quality becomes a differentiator, especially for people who live in terminals all day.

Goals:
- improve resize and redraw behavior
- tune font sizing and spacing for comfort
- refine transitions and background treatment
- keep the app feeling responsive even when displaying rich UI

Acceptance criteria:
- terminal rendering feels fluid and stable
- text is comfortable to read for long sessions
- visual transitions feel deliberate and smooth
- performance and polish reinforce confidence in the product

---

### 8) Strengthen session recovery and error clarity
Priority: P2

Title: Strengthen session recovery and error clarity

Problem:
When a connection drops or a session breaks, the app should help users recover without confusion. Clear recovery patterns reduce trust loss and make the product feel more resilient.

Goals:
- improve disconnect state messaging
- surface actionable recovery paths
- reduce confusion after unexpected failure
- keep users oriented when a session ends unexpectedly

Acceptance criteria:
- disconnect states are clear and actionable
- reconnect or restart options are obvious
- error messages explain what happened without overwhelming the user
- recovery flows do not feel clumsy or brittle

---

### 9) Make remote file editing feel like a first-class feature
Priority: P2

Title: Make remote file editing feel native to the app

Problem:
Remote file browsing and editing should feel deeply integrated with the rest of the app, not bolted on as a secondary function. This matters because it affects how users experience the full product, not just terminal sessions.

Goals:
- improve file browser navigation and file state clarity
- polish open/save flows
- strengthen remote editing confidence
- avoid making file work feel fragmented from the session UI

Acceptance criteria:
- file browsing and editing feels fast and intuitive
- open/save and state transitions are predictable
- remote edits are clearly tracked and recoverable
- file workflows feel native to the app

---

## Recommended issue order

1. Improve session workflow ergonomics
2. Standardize the visual system
3. Build the home/quick-launch experience
4. Improve keyboard-first usage
5. Improve search and recall
6. Simplify settings
7. Tune terminal smoothness and product perception
8. Strengthen recovery and error clarity
9. Polish remote file editing

## Final direction for Claude

Please treat this as the next product phase for Xpecter. The product already has a working core, and the best path to success is not broad feature expansion but making the application feel like a daily-use environment for terminal-heavy work. Prioritize polish that improves session ergonomics, visual coherence, fast onboarding, and habit-forming daily workflows. The key objective is to make the app feel smooth, intentional, and comfortable enough that users want to live in it.
