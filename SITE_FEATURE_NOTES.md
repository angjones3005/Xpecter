# Specter Feature Notes

Site-ready copy for the current Specter feature set.

## Terminal Workspaces

### Home tab
Specter keeps a dedicated Home tab available at all times, and it opens onto something useful rather than an empty state. Home shows pinned sessions, the sessions used most recently with how long ago each was opened, every saved session grouped by folder, and one-click local shell profiles. It also keeps the application open when every live session has been closed.

### Quick connect
A single field on Home searches saved sessions by name, host, or tag, and also accepts an address typed directly. Enter a `user@host` or `user@host:port` address and Specter offers it as an ad-hoc SSH target alongside any saved sessions that match. Arrow keys move through the results and Enter connects.

### Draggable tabs
Reorder session tabs by dragging them left or right. The Home tab remains permanent and cannot be closed.

### Split terminal layouts
Work with single, split, or four-pane terminal layouts. Each pane can host its own SSH, local shell, serial, Telnet, or other terminal session.

### Editable keyboard shortcuts
Open the keyboard shortcut reference from the View menu and click a shortcut to replace it. Custom bindings persist between launches and can be restored with Reset Settings. Home lists the current bindings for the most common actions, reflecting any changes made.

### Live session sidebar
The sidebar shows which saved sessions are running right now, with a running count per folder and a Running group above the tree. Clicking a session that is already connected switches to its tab instead of opening a second connection; opening an additional connection to the same host stays available on the right-click menu.

### Pinned sessions
Pin the sessions reached for every day. Pinned sessions sit at the top of the sidebar and lead the Home screen, so they are one click away on a cold start before anything has been opened.

### Sidebar filtering
One field filters saved sessions and local shell profiles together, matching on name, host, serial port, or tag. Arrow keys and Enter work from the field, and folders stay out of the way while a filter is active.

## Connectivity

### SSH agent support
Use keys from:

- Windows OpenSSH agent
- PuTTY Pageant
- Unix/macOS `SSH_AUTH_SOCK`
- Specter's memory-only signer cache for repeated connections during one app run

Private keys and passphrases are not saved to session profiles.

### Mosh launcher
Start a Mosh session from the Terminal menu. Mosh sessions reuse Specter's terminal tabs, resizing, logging, highlighting, and disconnect handling.

The local machine needs the `mosh` client, and the remote host needs `mosh-server` with the required UDP ports available.

### Telnet launcher
Start a Telnet session from either the Terminal menu or the New Session picker. Telnet uses Specter's terminal surface, including tabs, resizing, logging, highlighting, and session lifecycle handling.

### X11 forwarding
Opt in to X11 forwarding when creating an SSH session. Specter requests X11 forwarding and proxies incoming X11 channels to the local display.

A local X server is required:

- Native X on Linux
- XQuartz on macOS
- VcXsrv or Xming on Windows

### Local SSH port forwarding
Create a local port forward through an active SSH session. A local `127.0.0.1` port is forwarded to a host and port reachable from the SSH server.

## Session Management

### MobaXterm session import
Import common INI-style `.mxtsessions` and `.ini` files from MobaXterm. Specter maps session names, hosts, usernames, ports, and key paths while deliberately skipping passwords.

### Session tags
Add comma-separated tags to saved sessions. Specter trims and de-duplicates tags, and Quick Connect searches them.

### Persistent command snippets
Save frequently used commands or configuration blocks as snippets. They appear in the Terminal menu and insert into the focused session through the existing paste safety guard.

### Encrypted configuration bundles
Export and import passphrase-protected configuration bundles for user-managed cloud storage. Bundles use PBKDF2-SHA256 and AES-256-GCM and contain no passwords or `known_hosts` entries.

This supports a BYO-storage workflow with OneDrive, Dropbox, S3, or another file provider without sending configuration data to a Specter service.

### Continuous session logging
Choose a log directory and Specter continuously appends raw SSH, local shell, and serial output to per-session log files. Logging is disabled until explicitly configured.

### Automatic configuration backups
Specter creates periodic local configuration backups and provides a restore flow for settings, sessions, groups, and local shell profiles.

## Remote Files And Editing

### Open remote files with the system default app
Open PDFs, images, and other remote files with the operating system's default application. Specter downloads a private temporary copy, preserves its timestamp, and invokes the platform handler.

### Monaco editor workers
Monaco language services run in dedicated Vite-managed workers for TypeScript/JavaScript, JSON, CSS/SCSS/Less, HTML, and the core editor instead of falling back to the main UI thread.

### SFTP timestamp preservation
Remote-to-local downloads preserve remote modification times. Drag-and-drop uploads carry the local file modification time to the remote file when supported.

## Terminal Experience

### Cross-platform highlighting
The same highlighting pipeline works across Linux VMs, network switches, PowerShell, Command Prompt, local shells, and serial sessions. It highlights status keywords and interface identifiers while safely handling ANSI sequences and output tokens split across backend reads.

### Compact control styling
Buttons, dropdowns, text inputs, password fields, and numeric controls share one compact control style with quiet borders, tight spacing, and consistent focus states.

### Consistent dialogs
Every dialog in Specter, including the host key trust prompt and the encrypted key passphrase prompt, shares one definition and follows the active theme in both light and dark mode. All of them dismiss with Escape or a click outside.

### Grouped settings
Settings opens as a dialog grouped into Appearance, Terminal, Clipboard and paste, Security, Session logging, Configuration, and About. Options that carry a real risk are separated and explained rather than listed alongside ordinary preferences.

### Pane resizing
Sidebar and editor panes can be resized by dragging their dividers. Editor resizing uses the actual pane geometry so the flexible terminal column remains stable.

## Current Scope Notes

- VNC and RDP are not yet integrated; both require dedicated graphical client surfaces.
- Automatic cloud-provider browsing and background sync are not yet integrated; encrypted BYO-storage bundles are available.
- Full macro recording/replay and a plugin architecture remain future productivity features.
- Dynamic SOCKS forwarding and remote SSH forwarding remain future tunnel-manager work.
- Mosh requires the local Mosh client, remote `mosh-server`, and suitable UDP access.
