# Xpecter Feature Notes

Site-ready copy for the current Xpecter feature set.

## Terminal Workspaces

### Home tab
Xpecter keeps a dedicated Home tab available at all times, and it opens onto something useful rather than an empty state. Home shows pinned sessions, the sessions used most recently with how long ago each was opened, every saved session grouped by folder, and one-click local shell profiles. It also keeps the application open when every live session has been closed.

### Quick connect
A single field on Home searches saved sessions by name, host, or tag, and also accepts an address typed directly. Enter a `user@host` or `user@host:port` address and Xpecter offers it as an ad-hoc SSH target alongside any saved sessions that match. Arrow keys move through the results and Enter connects.

### Draggable tabs
Reorder session tabs by dragging them left or right. The Home tab remains permanent and cannot be closed.

### Split pane layouts
Work with single, two-pane vertical, two-pane horizontal, or four-pane layouts. Every pane is independent: each one can host its own SSH, local shell, serial, Telnet, or Mosh session, or a text editor, so a config file can sit open beside the switch it is being written for.

Panes are arranged directly rather than through a dialog. Drag a pane by its header onto another pane to swap the two, drag the divider between panes to change the split, and hold Alt with the arrow keys to move focus. Clicking a pane hands it the keyboard as well as the highlight, so a save or a keystroke lands in the pane that is actually in front of you.

### Editable keyboard shortcuts
Open the keyboard shortcut reference from the View menu and click a shortcut to replace it. Custom bindings persist between launches and can be restored with Reset Settings. Home lists the current bindings for the most common actions, reflecting any changes made.

### Live session sidebar
The sidebar shows which saved sessions are running right now, with a running count per folder and a Running group above the tree. Clicking a session that is already connected switches to its tab instead of opening a second connection; opening an additional connection to the same host stays available on the right-click menu.

Rows show the name you gave the session and nothing else. The address is on the hover tooltip, and it returns to the list while a filter is active, so a search that matched on a host still shows why.

### Pinned sessions
Pin the sessions reached for every day. Pinned sessions sit at the top of the sidebar and lead the Home screen, so they are one click away on a cold start before anything has been opened.

### Pinned folders
Working directories pin to the sidebar the way saved sessions do. A pinned folder opens straight into an editor workspace, and the editor's own folder menu lists the same set, so the two halves of the sidebar reach each other.

### Sidebar filtering
One field filters saved sessions and local shell profiles together, matching on name, host, serial port, or tag. Arrow keys and Enter work from the field, and folders stay out of the way while a filter is active.

## Connectivity

### SSH agent support
Use keys from:

- Windows OpenSSH agent
- PuTTY Pageant
- Unix/macOS `SSH_AUTH_SOCK`
- Xpecter's memory-only signer cache for repeated connections during one app run

Private keys and passphrases are not saved to session profiles.

### Mosh launcher
Start a Mosh session from the Terminal menu. Mosh sessions reuse Xpecter's terminal tabs, resizing, logging, highlighting, and disconnect handling.

The local machine needs the `mosh` client, and the remote host needs `mosh-server` with the required UDP ports available.

### Telnet launcher
Start a Telnet session from either the Terminal menu or the New Session picker. Telnet uses Xpecter's terminal surface, including tabs, resizing, logging, highlighting, and session lifecycle handling.

### Serial console
Connect to a serial port by port name and baud rate. Serial sessions are saved, grouped, and filtered alongside SSH sessions, and they use the same terminal surface, logging, and highlighting.

### X11 forwarding
Opt in to X11 forwarding when creating an SSH session. Xpecter requests X11 forwarding and proxies incoming X11 channels to the local display.

A local X server is required:

- Native X on Linux
- XQuartz on macOS
- VcXsrv or Xming on Windows

### Local SSH port forwarding
Create a local port forward through an active SSH session. A local `127.0.0.1` port is forwarded to a host and port reachable from the SSH server.

### Reconnecting without losing the pane
A session that drops leaves its pane in place with a panel explaining what happened, rather than closing the tab out from under you. From there, reconnect to the same host, save the scrollback that was on screen, or close the pane. Keystrokes are held rather than typed into a dead connection.

### SSH keepalive
An optional keepalive holds idle sessions open against the timeouts that would otherwise close them.

## Session Management

### MobaXterm session import
Import common INI-style `.mxtsessions` and `.ini` files from MobaXterm. Xpecter maps session names, hosts, usernames, ports, and key paths while deliberately skipping passwords.

### Session tags
Add comma-separated tags to saved sessions. Xpecter trims and de-duplicates tags, and Quick Connect searches them.

### Persistent command snippets
Save frequently used commands or configuration blocks as snippets. They appear in the Terminal menu and insert into the focused session through the existing paste safety guard.

### Local shell profiles
Save a named local shell with its own starting directory. Profiles appear in the Terminal menu and in the sidebar, so a shell that always opens in the right place is one click rather than a `cd`.

### Open in Xpecter
On Windows, Xpecter registers an Explorer context-menu entry for folders. Right-click a directory, or the background of one, to open a Xpecter session already in that directory.

### Carrying your setup to another machine
Export writes your saved sessions, groups, local shell profiles, pinned folders and appearance settings to a single file. Importing it asks which of the two things you meant: Replace makes the machine match the file exactly, which is what restoring means and is safe to repeat, or Merge adds the file alongside what is already there. Erase all saved data clears the lot, so a machine can be handed on clean or reset before restoring. Erasing writes a backup first and refuses to proceed if it cannot, so it is always undoable from Restore from backup. Passwords are never written to a configuration file, so password-authenticated sessions ask for theirs again on the new machine; key-based ones come back ready to use.

### Encrypted configuration bundles
Export and import passphrase-protected configuration bundles for user-managed cloud storage. Bundles use PBKDF2-SHA256 and AES-256-GCM and contain no passwords or `known_hosts` entries.

This supports a BYO-storage workflow with OneDrive, Dropbox, S3, or another file provider without sending configuration data to a Xpecter service.

### Continuous session logging
Choose a log directory and Xpecter continuously appends raw SSH, local shell, and serial output to per-session log files. Logging is disabled until explicitly configured.

### Automatic configuration backups
Xpecter creates periodic local configuration backups and provides a restore flow for settings, sessions, groups, and local shell profiles.

## Text Editor

### An editor in the pane grid
The text editor is a kind of session rather than a fixed panel. Open one as a whole tab, or as one pane of a split beside a live shell, and close it the way any other pane closes. Two editor panes can sit side by side, each holding its own files, and each answers the save shortcut for the buffer it is actually showing.

### Several files in one pane
Each editor pane keeps a strip of open documents and switches between them with a click or with Ctrl+Page Up and Ctrl+Page Down. Unsaved work is marked on the document, on the pane, and on the tab, so a modified buffer sitting behind two other tabs is still visible. Closing anything with unsaved changes asks first.

### Workspace folder tree
Open a folder and it appears as a tree inside the pane, not in the application chrome, so a split can hold a folder on one side and a shell on the other. The tree marks which files are currently open, and folders expand independently.

### Creating files and folders
Add a file or a folder to the workspace you already have open. The tree header creates at the root, and every folder row offers the same two actions for creating inside it. A new file opens for editing straight away. A name already taken is refused rather than quietly overwriting what is there.

### The tree keeps up with the folder
A file added to an open folder by anything other than Xpecter — a build, a download, a shell in the next pane — appears in the tree on its own, as it happens. Xpecter watches exactly the folders on screen, so a busy directory you have collapsed costs nothing. The tree is redrawn only when something has really changed, so scroll position and expanded folders survive, and a burst of writes redraws once rather than once per file. A slow re-read runs underneath as a backstop, for the filesystems that accept a watch and then quietly never report anything.

### Local and remote files
Open and save files on the local machine, and write a buffer to any host you are connected to over SFTP. Files opened from the remote browser edit in the same panes as local ones. Reload From Disk re-reads a file that changed underneath you.

### Command palette and Go to File
Ctrl+Shift+P opens the editor's command palette, listing Xpecter's own commands with their shortcuts. Ctrl+P jumps to any file in the open workspace by name. Both act on the pane holding the caret, so they do the right thing in a split.

### Editor commands
Find and Replace, Go to Line, Go to Symbol, Format Document, Toggle Line Comment, Trim Trailing Whitespace, Sort Lines, Transform Case, and Fold and Unfold All. Word wrap, the minimap, and whitespace rendering are toggles that persist. Monaco's own command palette stays on F1 for everything not listed.

### Document status bar
Each pane shows the path of the file it is editing along with line and column, indentation, line endings, detected language, and wrap state. Language, indentation, and line endings can each be changed from there, and a file that already uses a different indent style keeps it rather than being silently reformatted.

## Syntax Highlighting And Languages

### Bundled languages
The editor ships Monaco's full language set, with language services running in dedicated workers for TypeScript and JavaScript, JSON, CSS, SCSS and Less, and HTML.

### Functional languages
Haskell, PureScript, Idris, Elm, OCaml, Standard ML, Erlang, Nix, Lisp, Agda, and Lean are added on top, each with the comment, bracket, and string rules its own syntax actually uses. They register in the same place Monaco's languages live, so file detection and the language picker find them with no special handling.

### Skald
Skald, the switch-configuration DSL, is a first-class language in the editor. Its grammar came from the parser rather than from sample files, so a keyword the language accepts highlights whether or not an example happens to use it. Resource blocks and their modes read differently from the settings inside them, ports highlight in the notation IOS uses including the range forms, and addresses read as single values instead of dissolving into digits. Values the language takes verbatim to end of line, such as a port description, keep their exact text: a `--` inside one is data, not a comment.

## Remote Files And Editing

### Open remote files with the system default app
Open PDFs, images, and other remote files with the operating system's default application. Xpecter downloads a private temporary copy, preserves its timestamp, and invokes the platform handler.

### Creating and renaming on the host
The remote browser has the same workspace actions as the editor's folder tree. Its header adds a file or a folder to the directory you are looking at, every folder row offers the same two for creating inside it, and every row can be renamed in place. A new file opens for editing straight away. A name already taken is refused rather than overwriting what is there, for both creating and renaming. Renaming a file that is currently open retargets the buffer, so saving writes to the new name instead of recreating the old one.

### The remote browser keeps up with the directory
The remote file list re-reads the directory it is showing and updates when its contents change, so a file written by the session in the terminal beside it shows up without a manual refresh. It runs on a slower clock than the local tree because each listing is a round trip to the host, and it stops entirely when the sidebar or the section is closed, when the window is in the background, or when the browser is pointed at a host that is not the focused tab.

### SFTP timestamp preservation
Remote-to-local downloads preserve remote modification times. Drag-and-drop uploads carry the local file modification time to the remote file when supported.

## Terminal Experience

### Cross-platform highlighting
The same highlighting pipeline works across Linux VMs, network switches, PowerShell, Command Prompt, local shells, and serial sessions. It reads output the way an operator does, colouring:

- Outcomes: the words that mean something worked, failed, or wants attention
- Interfaces, in both the long names and the abbreviations everyone types
- Addresses: IPv4, IPv6, and MAC in both conventions, with prefix lengths
- Log tags in the `%FACILITY-severity-MNEMONIC` form, and URLs
- Filesystem paths in both Windows and POSIX form
- Timestamps in ISO-8601, syslog, and IOS shapes
- Numbers, including sizes, rates, percentages, and hex

Text the far end already coloured is left exactly as it sent it, so a prompt, a pager, or vim is never recoloured. Escape sequences pass through untouched, including ones split across backend reads.

### Terminal colour schemes
Choose from Dark, Light, Dracula, Solarized Dark, Solarized Light, Gruvbox Dark, One Dark, and Tokyo Night. The highlighting palette follows the scheme rather than being fixed against it.

### Fonts and zoom
Eleven monospace fonts, nine of them bundled so they render identically everywhere rather than depending on what the host happens to have installed. Font size is adjustable in settings and with the zoom shortcuts, and the editor shares the terminal's font rather than keeping a second setting.

### Wallpaper
Set a background image with adjustable opacity behind the terminal surface.

### Clipboard and paste
Copy on select, right-click to paste, and an explicit paste shortcut that works consistently across platforms and webviews. Multi-line pastes warn before they run. Letting remote hosts write to the local clipboard over OSC 52 is available and off by default, because it lets a remote process write to your clipboard silently.

### Saving terminal output
Save what is on screen in a session to a file, including from the panel shown after a session has dropped.

### Compact control styling
Buttons, dropdowns, text inputs, password fields, and numeric controls share one compact control style with quiet borders, tight spacing, and consistent focus states.

### Consistent dialogs
Every dialog in Xpecter, including the host key trust prompt and the encrypted key passphrase prompt, shares one definition and follows the active theme in both light and dark mode. All of them dismiss with Escape or a click outside.

### Grouped settings
Settings opens as a dialog grouped into Appearance, Terminal, Clipboard and paste, Security, Session logging, Configuration, and About. Options that carry a real risk are separated and explained rather than listed alongside ordinary preferences.

### Pane resizing
Sidebar, editor, and terminal panes can be resized by dragging their dividers. Editor resizing uses the actual pane geometry so the flexible terminal column remains stable.

## Current Scope Notes

- VNC and RDP are not yet integrated; both require dedicated graphical client surfaces.
- Automatic cloud-provider browsing and background sync are not yet integrated; encrypted BYO-storage bundles are available.
- Full macro recording/replay and a plugin architecture remain future productivity features.
- Dynamic SOCKS forwarding and remote SSH forwarding remain future tunnel-manager work.
- Mosh requires the local Mosh client, remote `mosh-server`, and suitable UDP access.
- The Explorer context-menu entry is Windows-only.
- The editor's workspace tree browses the local filesystem; remote files are opened through the SFTP browser and saved back over SFTP.
