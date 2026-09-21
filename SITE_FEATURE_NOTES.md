# Xpecter: Features and How to Use Them

Xpecter is a desktop terminal for people who spend the day on remote machines and network hardware. One window holds SSH sessions, local shells, serial consoles, Telnet and Mosh, saved Remote Desktop and VNC sessions, a code editor that works on local and remote files, an SFTP browser, and a set of network tools. It runs the same way on Windows, macOS and Linux.

This page lists every feature in Xpecter 3.9 and how to reach it. `Ctrl` means `Cmd` on macOS; the app shows the right key for your platform.

## Contents

1. [Getting started](#getting-started)
2. [The window](#the-window)
3. [Session types](#session-types)
4. [Saved sessions](#saved-sessions)
5. [Working in the terminal](#working-in-the-terminal)
6. [The editor](#the-editor)
7. [Remote files over SFTP](#remote-files-over-sftp)
8. [Tunnels and tools](#tunnels-and-tools)
9. [Appearance and settings](#appearance-and-settings)
10. [Keyboard shortcuts](#keyboard-shortcuts)
11. [Your configuration](#your-configuration)
12. [Security](#security)
13. [What Xpecter does not do](#what-xpecter-does-not-do)
14. [Getting help](#getting-help)

## Getting started

### Installing
Download the build for your platform from the Releases page. On Windows, run the installer or unzip the archive and run `xpecter.exe` from anywhere; local shells need Windows 10 1809 or newer. On macOS, unzip and run the app; the build is not notarized yet, so the first time, right-click it and choose Open. On Linux, extract the archive and run the `xpecter` binary. There is no account and no setup wizard.

### Your first connection
1. Open the session picker: Sessions > New Session, the **+ New Session** button on Home, or `+` in the sidebar's Sessions header.
2. Press **1** or click **SSH**, enter the host and user, and choose Password or Key.
3. Click **Connect**. The first time you reach a host, Xpecter shows its key fingerprint and asks you to confirm; the key is remembered in your own `~/.ssh/known_hosts`, the same file OpenSSH uses.
4. Once connected, Xpecter offers to save the session. Saved sessions hold the host, user, port, key path and options, never a password unless you deliberately turn on keychain saving.

### Quick connect
The box on the Home tab searches saved sessions by name, host or tag, and also takes an address typed directly: `user@host` or `user@host:port` connects to something new. Arrow keys move through the results, Enter connects.

### Updating
Settings > About > **Check for updates…** asks GitHub for the latest release. A newer one shows a banner with a Download button. On Windows the installer downloads and runs; on macOS and Linux the archive is downloaded and revealed for you to swap in.

## The window

### Title bar and menus
Xpecter draws its own title bar: the menus (Terminal, Sessions, View, Tools, Settings), a light/dark toggle, and the window buttons. Every action in this page is on one of those menus, on a right-click menu, or on a shortcut.

### Tabs
Each tab holds one pane layout. The **⌂ Home** tab is permanent. Other tabs show an icon for what they hold, a status dot, and a close button. Drag tabs to reorder them; **Show tab numbers** in Settings numbers them.

A tab that is not on screen shows a dot when output arrives and 🔔 when its terminal rings the bell. A bell in a background tab, or while the window is behind something else, also raises a system notification, so the long job that rings when it finishes is noticed from wherever you are. Turn that off with **Notify when a background terminal rings its bell**.

How to use it: Ctrl+Tab and Ctrl+Shift+Tab step through tabs; Ctrl+1 to Ctrl+8 jump to that tab and Ctrl+9 to the last one. Closing a tab with a live session asks first. By default the app quits when the last tab closes; **Keep app open when last tab closes** leaves it on Home instead.

### Split panes
A tab can be split into two panes side by side, two stacked, or a four-pane grid. Every pane is independent: an SSH session, a local shell, a serial console, a Remote Desktop or VNC card, or a text editor, so a configuration file can sit open beside the switch it is being written for.

How to use it: View > Split Vertical (Ctrl+Shift+D), Split Horizontal (Ctrl+Shift+Enter), 4-Pane Grid. Drag the divider to resize, drag a pane by its header onto another to swap them, click a pane to give it the keyboard, and hold Alt with an arrow key to move focus. The **⊟** button beside the tab bar fills the next pane with a duplicate of this session, a new local shell, a new session, a text editor, or an empty split. Ctrl+Shift+W closes the active pane.

### Send input to all panes
A split tab can broadcast: what you type or paste into one pane goes to every terminal pane in the tab, so the same command runs on four switches at once. The pane headers show it while it is on, and pastes and snippets still go through the paste guard, once, for every pane they reach.

How to use it: View > **Send Input to All Panes**, or the ⇶ button on any pane header. It is per tab, off for every new tab, and switches itself off when the tab is no longer split.

### Named layouts
Save the tabs that are open, with their splits and what each pane holds, under a name, and reopen the whole arrangement later. A rack of switches comes back as the four-pane grid it was arranged in, each pane connecting again. A layout stores what is needed to start each session, never a password or any output, and travels with an exported configuration.

How to use it: Sessions > **Save Tab Set as Layout…** to save; Sessions > **Open Layout…** or the **Layouts** section on Home to reopen. The Home cards also rename (✎) and delete (✕).

### Pick up where you left off
The tabs open when Xpecter last quit are remembered as you work and offered on Home at the next launch, or reopened automatically if you prefer. Tabs, split panes, the folder and files open in each editor, local shells, serial consoles and Remote Desktop or VNC cards all come back. SSH sessions reconnect on their own wherever a key, an agent or a saved password can; one that needs a password asks for it, and a cancelled one waits in its pane with R to connect.

How to use it: click **Reopen** on Home, tick **Always reopen automatically**, or choose **Start fresh** under Settings > On launch to stop being asked.

### The sidebar
Four collapsible sections on the left: **Sessions**, **Local shells**, **Folders** and **Remote files**. Drag its edge to resize it; Ctrl+Shift+B or the `«` button hides it.

### The Home tab
Home is what you see on launch and whenever no session has the tab: Quick connect, pinned sessions, recent sessions with how long ago each was opened, every saved session grouped by folder, saved layouts, local shell chips, the restore offer, and a strip showing the current bindings for the most common shortcuts.

### The status bar
A thin bar at the bottom shows short confirmations and errors, such as a file saved, a forward stopped or an import count, and fades after a moment.

## Session types

The session picker (Sessions > New Session) offers seven choices. Press the number or click the tile; Esc closes it.

### 1. SSH
The form takes a host and user, a device kind (VM or host, network switch, firewall; it only chooses the sidebar icon), and password or key authentication. A warning appears under the password field if Caps Lock is on.

- **Keys and agents.** Browse to a private key file and enter its passphrase if it has one. **Use SSH agent** signs with keys held by the OpenSSH agent on Windows, macOS or Linux, or by PuTTY's Pageant. **Use Xpecter memory agent** remembers an unlocked key for the rest of this app run, so repeated connections do not ask for the passphrase again; nothing from it is written to disk.
- **Forward the agent to the host** lets programs on the host use your local keys: a `git pull` from a private repository, or a second hop to a machine behind it. It is requested when the shell starts and reported on the terminal if the host refuses. Turn it on only for hosts you trust.
- **Enable X11 forwarding** proxies X11 channels to your local display, which must be running: native X on Linux, XQuartz on macOS, VcXsrv or Xming on Windows.
- **Jump host** takes a bastion in OpenSSH `ProxyJump` form, `[user@]host[:port]`. The target is reached through a channel on the jump host, which is host-key-verified exactly like the target.
- **Terminal speed** sets the PTY's baud for console servers and serial bridges that read it.

Xpecter falls back to legacy key exchange, cipher and host key algorithms when a host only offers old ones, so older network hardware connects without a compatibility switch. A key file whose permissions are too open is flagged with a **Use it anyway** option. **SSH keepalive** (on by default) keeps idle sessions from being dropped by a timeout.

### 2. Shell
A local shell on this machine: PowerShell by default on Windows, with Command Prompt and PowerShell also on the Tools menu; your login shell on macOS and Linux.

**Local shell profiles** are named shells with a starting directory, created from Terminal > Manage Local Shell Profiles… or the `+` in the sidebar's Local shells section, and listed in the Terminal menu, the sidebar and Home. **New Local Shell in Directory…** picks a folder and starts a shell there without saving a profile. On Windows, Xpecter adds an **Open in Xpecter** entry to Explorer's right-click menu for folders and folder backgrounds.

### 3. Serial
A console over a serial port: enter the port name (`COM3`, `/dev/ttyUSB0`, `/dev/tty.usbserial-…`) and a baud rate from 9600 to 115200. Serial sessions are saved, grouped, filtered and logged like any other and use the same terminal.

**Console controls.** A serial session has a bar between its header and the terminal: **Enter sends** CR, LF or CR+LF; **Local echo** for a device that does not echo; **DTR** and **RTS** toggles; **Break**, which holds the line in break for a quarter second; and **Hex**, a hex dump of what arrives for the moments when the terminal is making a mess of a binary stream. The bar's choices apply to pastes as well as typing.

### 4. Telnet
Unencrypted, for legacy equipment. Enter the host and port (default 23). Xpecter runs your system's `telnet` client inside a local shell, so the client must be installed.

### Mosh
Terminal > **New Mosh Session…** asks for `user@host` and runs `mosh` in a local shell, with Xpecter's tabs, resizing, logging and highlighting. The local machine needs the `mosh` client and the host needs `mosh-server` with its UDP ports open.

### 5. Remote Desktop
Enter host, port, user and an optional domain, and choose full screen (the default), a resizable window whose remote desktop follows the window size as you drag it, or a fixed resolution scaled into whatever size you give it. **Console session (/admin)** attaches to the console.

Xpecter does not draw the desktop itself. It writes a `.rdp` file with everything filled in and starts the client your platform already has: Remote Desktop Connection on Windows, Windows App on macOS, FreeRDP or Remmina on Linux. The client asks for the password; Xpecter never stores one. A pane stands for the session, showing whether the window is still open, with **R** to open it again, **D** to close the window and **Enter** to close the pane.

### 6. VNC
Enter host and port. VNC works the same way as Remote Desktop: it opens in the platform's viewer (Screen Sharing on macOS; TigerVNC, RealVNC, TightVNC, UltraVNC, Remmina or Vinagre elsewhere), the viewer asks for the password, and a session card tracks it with the same R, D and Enter actions.

### 7. Editor
A text editor pane with no connection of its own. See [The editor](#the-editor).

## Saved sessions

### The Sessions section
The sidebar lists a **★ Pinned** group, a **Running** group of sessions connected right now, then your folders, then ungrouped sessions. Each row has a status dot, the session's name and a device icon; the address is on the hover tooltip. Clicking a session that is already connected switches to its tab instead of opening a second connection; **Open another session** on the right-click menu does that deliberately.

**Filter sessions…** matches on name, host, serial port and tags, filters local shell profiles at the same time, and takes arrow keys and Enter. While a filter is active the folders step aside and rows show their address.

### Right-click menu
Pin to top or Unpin, Open another session, Edit session, Forget saved password (SSH, while keychain saving is on), and Delete, which asks first and also removes any keychain entry.

### Folders and pinning
Create folders from Sessions > New Folder or the 📁 button. Folders nest, and a session dragged onto a folder moves there. Right-click a folder to rename or delete it; deleting a folder moves its sessions out. Pinned sessions sit at the top of the sidebar and lead Home, so the machines you reach for every day are one click away on a cold start.

### Arrange the sidebar by dragging
Every list in the sidebar is in the order you put it in. Drag a session above or below another to move it there, beside a session in another folder to move it into that folder at that spot, or onto a folder's header to add it at the end. Folder headers drag the same way, above or below another folder, into or out of a parent. Pinned folders and shell profiles reorder by the same drag, and Home, the Terminal menu and the editor's folder menu keep the order.

### Tags, tag colours and the production guard
The Edit session dialog takes comma-separated tags, and both the sidebar filter and Quick connect search them. A tag can carry a colour: `prod` and `production` start red, `staging` orange, `dev`, `lab` and `test` green, and any tag can be added, recoloured or removed in Settings > **Tag colours**. A session with a coloured tag shows it as a pill in the sidebar, on its tab and on its pane header, so a terminal on a production box is recognisable from across the room.

A tag can also be a **guard**; `prod` and `production` are by default. In a session wearing one, every paste that will press Enter and every command snippet asks first, whatever the paste warning is set to, and the prompt names the tag and the session. Ordinary typing is never interrupted.

### The Edit session dialog
Right-click > Edit session. **Basic settings** has the name and the fields for the session's type. **Advanced settings** adds the key path, the agent options and agent forwarding, device kind, jump host, terminal speed, Remote Desktop display options, the folder, tags, and the **Port forwards** the session starts with.

### Importing sessions
- **Settings > Import from MobaXterm…** reads `.mxtsessions` and `.ini` files, mapping names, hosts, users, ports and key paths. Passwords are skipped.
- **Settings > Import from SSH config…** reads an OpenSSH `~/.ssh/config` and saves each concrete `Host` block as a session, carrying HostName, User, Port, IdentityFile and ProxyJump. Wildcard-only blocks are skipped.
- **Settings > Import from PuTTY…** (Windows) reads PuTTY's saved sessions from the registry: host, port, user, agent settings, X11, an SSH proxy as the jump host, and serial sessions with their line and speed. A key in PuTTY's own .ppk format is left out because Xpecter reads OpenSSH keys; that session uses the agent instead, so run Pageant or convert the key in PuTTYgen.

All three report how many sessions were imported.

### Saved passwords, in the OS keychain
Off by default, and the one setting that makes Xpecter keep a password at all. With **Remember SSH passwords in the OS keychain** on, a saved SSH session can keep its password in Windows Credential Manager, macOS Keychain or the Linux Secret Service, never in Xpecter's own files. A remembered password fills in on connect. Forget one from the session's right-click menu, by deleting the session, or by turning the setting off, which forgets them all.

### When a session drops
A session that disconnects, times out or fails leaves its pane in place with a **Session stopped** panel: **R** reconnects to the same host, **S** saves the output that was on screen, **Enter** closes the pane. Keystrokes are held rather than typed into a dead connection. Terminal > Disconnect (Ctrl+Shift+X) ends a session on purpose.

### Session logging
Settings > Session logging > **Choose…** picks a directory, and from then on raw output from every SSH, local shell and serial session is appended to a per-session file named after the session. Logging is off until a directory is chosen; **Disable session logging** turns it off again.

## Working in the terminal

### Output highlighting
**Colorize terminal output** (on by default) colours plain output the way an operator reads it: words that mean something worked, failed or wants attention; interface names in long and short forms; IPv4, IPv6 and MAC addresses with prefix lengths; `%FACILITY-severity-MNEMONIC` log tags; URLs; Windows and POSIX paths; ISO-8601, syslog and IOS timestamps; sizes, rates, percentages and hex. It works the same on Linux hosts, switches, PowerShell, Command Prompt and serial consoles, and text the far end already coloured is left exactly as sent, so prompts, pagers and vim are never recoloured. The palette follows the terminal colour scheme.

### Custom highlight rules
Add patterns of your own to the built-in set, each with one of the highlighter's colour categories. A **words** rule is a comma-separated list matched whole (`CRIT, DOWN, c++`); a **regex** rule is a regular expression. Your rules win over the built-in ones where they overlap, apply to every terminal at once, and persist between launches.

How to use it: Settings > **Highlight rules**. Type the pattern, choose Words or Regex and a category, and click Add.

### Links in output
Hover a URL to underline it and see where it goes; **Ctrl+click** opens it in your browser. A plain click never opens anything, so finishing a selection cannot launch a browser. Links that wrap across the pane edge are recognised whole.

### Find in output
**Ctrl+Shift+F**, or Terminal > **Find in Output…**, opens a find bar over the focused terminal. Every match in the scrollback is highlighted and counted; Enter and Shift+Enter step through them, **Aa** matches case, **.\*** reads the text as a regular expression, and Escape returns to the prompt. The bar starts with whatever was selected.

### Scrollback
Terminals keep 10,000 lines by default, adjustable in Settings from 1,000 to 100,000. Every retained line is held in memory per terminal, so raise it with intent.

### Clipboard and paste
- **Right-click to paste** is on by default; **Copy on select** is off by default. **Ctrl+Shift+V** pastes everywhere.
- **Multi-line paste** translates line endings to what a terminal reads as Enter, so text copied from Windows no longer arrives with a stray blank line after each one. Where the program on the other end supports bracketed paste, a pasted block lands on the prompt as one piece and waits. Where lines really will run one at a time, such as on network hardware, **Warn before pasting multiple lines** (on by default) asks first, with a preview of what is about to be sent.
- **Delay between pasted lines** adds a pause after every Enter for consoles that drop characters when a whole configuration arrives at once. The paste prompt offers the same choice and remembers what you pick.
- **Command snippets** (Terminal > Manage Command Snippets…) save a named command or configuration block. Each appears as `Snippet: name` in the Terminal menu and types into the focused session through the same paste guard.
- **OSC 52** lets a remote program write to your local clipboard. It is off by default and lives under Settings > Security.

### Zoom, fullscreen and the cursor
Ctrl+= and Ctrl+- zoom the focused terminal's font, Ctrl+0 resets it, F11 toggles fullscreen. **Cursor style** (block, underline or bar) and **Cursor blink** in Settings apply to every open terminal at once.

### Saving output and clearing the screen
**Save Terminal Output…** (Ctrl+Shift+S) writes what is in the focused terminal's buffer to a file, and also works from the panel shown after a session drops. Terminal > **Clear Screen** clears the buffer.

## The editor

### An editor in the pane grid
The editor is a kind of session, not a fixed panel. Open one as a whole tab (Sessions > New Text Editor, Tools > Text Editor, or picker choice 7) or as one pane of a split beside a shell. Two editor panes can sit side by side, each with its own files, and each answers Ctrl+S for the buffer it is actually showing.

### Documents
Each pane has a strip of open documents: click to switch, drag to reorder, Ctrl+PageUp and Ctrl+PageDown to step through. A modified document shows a dot in place of its close button, and the pane and tab carry the mark too. Closing anything with unsaved changes asks: Save, Discard or Cancel.

### File commands
From the command palette (Ctrl+Shift+P) or the shortcuts: New File (Ctrl+N), Open File… (Ctrl+O), Save (Ctrl+S), Save As… (Ctrl+Shift+S), Close File (Ctrl+W), **Save to Remote Host…** (writes the buffer to any host you are connected to over SFTP), **Reload From Disk**, **Run File**, **Delete File…**, **Copy File Path**, and **Open Outside Xpecter**.

### The workspace tree
Click the folder button on the document strip, then **Open Folder…**. The folder appears as a tree inside the pane, so a split can hold a folder on one side and a shell on the other. The tree marks which files are open, folders expand independently, and a file added by anything else (a build, a download, a shell in the next pane) appears on its own.

- **Create, rename, delete.** The tree header adds a file or folder at the root and every folder row does the same inside it; every row renames in place and can be deleted. A taken name is refused rather than overwritten. Nothing goes to a recycle bin, so the delete confirmation names the full path and, for a folder, counts what is going with it.
- **Resize.** Drag the tree's edge; double-click it to reset. The width is remembered.
- **Find in files.** The 🔍 button on the tree header, **Ctrl+Shift+F** with the caret in the editor, or **Find in Files…** in the palette searches the whole folder for text or a regular expression, matching case or not. Results take the tree's place, grouped by file with the line number and the matching line; click one to open the file at that line. Version-control folders, dependencies, build output and binary files are skipped, and Escape brings the tree back.
- **Show in File Explorer.** The ⧉ button on the tree header opens the folder in your system's file manager; the right-click menu on any row does the same for that folder or shows that file selected. The action is also on the folder menu, on document tabs, in the palette, and beside each pinned folder in the sidebar.
- **Pinned folders.** The folder menu pins the folder to the sidebar's Folders section, where one click opens it in an editor again.

### Opening anything
Every row in the tree opens. Text opens in the editor. PDFs and common images open in Xpecter's own viewers. Everything else (programs, archives, office documents, media, databases, and anything whose contents turn out to be binary) is handed to the application your system uses for it. Opening a program asks first.

### Reading PDFs and viewing images
A PDF gets a tab like any document, from the tree or from the remote browser, and one on a host opens straight from the host. The viewer fits the page to the pane, has zoom, actual-size and fit-width buttons and a page counter that follows as you scroll; pinch, Ctrl+scroll, or Ctrl with + / - / 0 zoom around the point under the cursor. PNG, JPEG, GIF, WebP, BMP, ICO, SVG and AVIF open in an image viewer with the same controls, and transparency shows against a checkerboard.

### Markdown notes
A Markdown file opens as a rendered note, the way Obsidian shows one, with a toggle on the document strip (Ctrl+E) between the note and its source. The reading view follows wikilinks to other notes in the folder, ticks task-list boxes back into the file, shows front matter as a properties table, and draws callouts, tags, tables and code blocks with the editor's own colouring. Ctrl+wheel, pinch, or Ctrl with + / - / 0 zoom the note; zoomed past 100% it keeps its width and scrolls sideways like a zoomed PDF, so nothing is ever cut off.

### Running a file
The **Run** button on the document strip, or Run File in the palette, saves the file and runs it: HTML in your browser; Python, PowerShell, shell, batch and Node scripts in a live shell opened in the file's own directory, so the output stays on screen and Up then Enter runs it again. A script opened from a host runs on that host.

### Editing commands
Find and Replace (Ctrl+F, Ctrl+H), Go to Line (Ctrl+G), Go to Symbol, Format Document, Toggle Line Comment, Trim Trailing Whitespace, Sort Lines, Transform Case, Fold and Unfold All, Set Language…, Set Indentation…, Set Line Endings…, and Toggle word wrap (Alt+Z). **Ctrl+P** jumps to any file in the workspace by name, **Ctrl+Shift+P** opens Xpecter's command palette, and **F1** opens Monaco's own palette for everything else. Each pane's status bar shows path, line and column, indentation, line endings, language and wrap state, and the last three can be changed from there.

### Languages
The editor ships Monaco's full language set with language services for TypeScript, JavaScript, JSON, CSS, SCSS, Less and HTML, and adds Haskell, PureScript, Idris, Elm, OCaml, Standard ML, Erlang, Nix, Lisp, Agda and Lean. **Skald**, Dawnrail's switch-configuration language, is a first-class language for `.skald` files. Plain text and log files (`.txt`, `.log`, `.out`, `.err`, `.text`) are coloured with the terminal's own vocabulary rather than shown as one grey wall.

### Editor wallpaper and font
The editor shares the terminal's font and size and takes its own wallpaper image and opacity, because a picture that reads well behind a prompt is usually noise behind code.

## Remote files over SFTP

With an SSH session focused, the sidebar's **Remote files** section shows that host's filesystem. The header names the session and offers `+` new file, ⊡ new folder, ⤒ upload files and ⟳ reread.

- **Navigate** by clicking folders; `📁 ..` goes up.
- **Open** a file by clicking it. It opens in an editor pane and Ctrl+S writes it back to the host. PDFs and images open in Xpecter's viewers straight from the host. Shift-click or middle-click opens a file with the system's default application instead.
- **Save as root.** When a save is refused because your login cannot write the file, Xpecter offers to save it through `sudo`: the buffer goes to a private temporary file on the host and one sudo command copies it over the original, keeping the file's owner and mode. The dialog asks for the sudo password and shows sudo's own answer if it refuses.
- **Edit externally.** A file's ✎↗ action downloads it and opens it in the system's default application for its kind. Xpecter keeps watching the copy, and every save there is uploaded straight back to the host, with a note in the status bar each time. The copy is removed when the session closes.
- **Upload** by dragging files onto the list or with the ⤒ button, with a progress bar under the list. **Download** a file with its ⤓ action, or a whole folder with the folder's ⤓, to a place you choose. Every transfer lands under a temporary name and is renamed when complete, so one cut short never leaves half a file wearing the real name, and modification times are preserved where the server supports it.
- **Create, rename, delete** on the host, with the same confirmations as the local tree. SFTP has no trash, so the delete dialog says so and counts what a directory holds.
- The list **re-reads itself** so a file written by the session in the terminal beside it shows up without a manual refresh, and pauses when the section is closed or the window is in the background.

### The remote browser follows the shell
With **Follow the shell's directory** on (Settings > Terminal, on by default), the list follows the directory the shell's prompt is in, so a `cd` in the terminal changes the listing beside it. The shell has to announce its directory: View > **Shell Integration…** shows the one line to add to `.bashrc`, `.zshrc` or fish's config, with a Copy button for each. It is the standard OSC 7 escape, which other terminals read too.

## Tunnels and tools

### Port forwarding
Tools > **Port forwarding…** starts a tunnel through a live SSH session. Pick the session, the kind and the addresses, and click **Add forward**:

- **Local port →** binds a local port and tunnels it to a `host:port` reachable from the far side, so a remote service is reachable as if it were local (`ssh -L`).
- **SOCKS proxy on** binds a local port as a SOCKS5 proxy. Point a browser or any SOCKS-aware program at it and its connections leave from the host, so the whole far network is reachable (`ssh -D`).
- **Host port →** asks the host to listen on a port and delivers each connection to an address here (`ssh -R`).

Active forwards are listed with a stop action and live as long as their session. Terminal > **New Local Port Forward…** does the local kind through a series of prompts.

### Forwards saved with a session
The 📌 action beside an active forward adds it to the saved session it runs through, and the Edit session dialog's **Port forwards** list edits the set directly. Saved forwards start on their own every time the session connects; one that cannot start is reported on the terminal without failing the connection.

### Network tools
Tools > **Network tools…** needs no session: **Wake-on-LAN** sends a magic packet to a MAC address with an optional broadcast address, and **Port scan** reports which of a list or range of TCP ports on a host are open.

## Appearance and settings

### Appearance
Settings > Appearance applies everywhere at once: **Theme** (dark or light chrome, also on the title bar toggle); **Terminal colors** (Dark, Light, Dracula, Nord, Solarized Dark and Light, Gruvbox Dark, One Dark, Tokyo Night); **Font** from eleven monospace faces, most of them bundled so they render the same on every machine; **Font size**; **Wallpaper** with opacity behind terminals; and a separate **Editor wallpaper**.

### Settings reference
Settings is one scrolling dialog and everything in it persists.

| Group | Settings |
| -- | -- |
| Terminal | Scrollback, Colorize terminal output, Show tab numbers, SSH keepalive, Keep app open when last tab closes, Cursor style, Cursor blink, Follow the shell's directory, bell notifications |
| Clipboard & paste | Copy on select, Right-click to paste, Warn before pasting multiple lines, Delay between pasted lines |
| Security | Allow remote hosts to write to your clipboard (OSC 52), Remember SSH passwords in the OS keychain |
| Highlight rules | Your own output highlight patterns |
| Tag colours | The colour and the guard for each tag |
| Session logging | Log directory, Disable session logging |
| On launch | Whether the last tab set is offered, reopened, or ignored |
| Configuration | Export, Import, encrypted bundles, the three importers, Restore from backup, Reset appearance settings, Erase all saved data |
| About | The version and Check for updates |

## Keyboard shortcuts

View > **Keyboard Shortcuts…** lists every binding; click one to rebind it. Custom bindings persist and are reset by **Reset appearance settings to defaults**.

| Action | Default |
| -- | -- |
| Disconnect active session | Ctrl+Shift+X |
| Paste | Ctrl+Shift+V |
| Save terminal output | Ctrl+Shift+S |
| Find in output | Ctrl+Shift+F |
| Toggle sidebar | Ctrl+Shift+B |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 |
| Fullscreen | F11 |
| Split vertical / horizontal | Ctrl+Shift+D / Ctrl+Shift+Enter |
| Close active pane | Ctrl+Shift+W |
| Move focus between panes | Alt+Arrow |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Jump to a tab | Ctrl+1 to Ctrl+8, Ctrl+9 for the last |

In an editor pane: Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S and Ctrl+W for files; Ctrl+P go to file; Ctrl+Shift+P command palette; F1 all editor commands; Ctrl+F, Ctrl+H, Ctrl+G find, replace and go to line; Ctrl+Shift+F find in files; Ctrl+PageDown and Ctrl+PageUp next and previous document; Alt+Z word wrap. Every dialog closes with Esc or a click outside it.

## Your configuration

### Where it lives
Xpecter keeps plain JSON in your OS config directory under `xpecter`: `%AppData%\xpecter` on Windows, `~/Library/Application Support/xpecter` on macOS, `~/.config/xpecter` on Linux. Sessions, folders, local shell profiles, layouts and settings each have their own file, readable only by you.

### Backups, export and import
A backup is written at most once a day, keeping the seven most recent, and Settings > **Restore from backup…** restores one. **Export configuration…** writes sessions, groups, profiles, pinned folders, layouts and appearance settings to a single file; **Import configuration…** asks whether to **Replace** (make this machine match the file) or **Merge** (add alongside). Passwords are never written to a configuration file.

**Export encrypted configuration…** and **Import encrypted configuration…** do the same with a passphrase-protected bundle (PBKDF2-SHA256 and AES-256-GCM), so a configuration can sit in OneDrive, Dropbox, S3 or any file store without going through a Xpecter service.

### Resetting
**Reset appearance settings to defaults** restores theme, colours, fonts, wallpapers and shortcuts without touching sessions. **Erase all saved data…** clears everything, writes a backup first, and refuses to proceed if that fails, so it is always undoable.

## Security

- **Host keys.** Every SSH connection, including to a jump host, is verified against your own `~/.ssh/known_hosts`. An unknown host shows its fingerprint and asks; a changed key shows a stronger warning.
- **Passwords.** By default Xpecter stores no passwords anywhere. The only exception is the opt-in OS keychain, and it is never Xpecter's own file.
- **Keys and agents.** Private keys and passphrases are not saved to session profiles. The memory agent holds an unlocked key for one app run only.
- **Guarded sessions.** A `prod` tag makes every paste that presses Enter and every snippet ask first.
- **Clipboard.** OSC 52 is off by default. **Programs.** Opening an executable from a file tree asks first.
- **Sudo saves** stage the file with owner-only permissions and send the password once, never keeping it.
- **Encrypted bundles** never include passwords or host keys.

## What Xpecter does not do

- Remote Desktop and VNC are drawn by the platform's own client, not inside the window, because a webview is not a place for a native desktop protocol.
- ZMODEM transfers over the terminal (`sz` and `rz`) are not supported; the SFTP browser and its transfer actions are the way to move files. Font ligatures are not rendered.
- Serial takes a typed port name; there is no dropdown of detected ports yet.
- Telnet and Mosh run your system's clients, which must be installed. X11 forwarding needs a local X server.
- Tabs cannot be dragged between windows, and a file cannot be dragged out of the remote browser onto the desktop; the ⤓ action is the download.
- Cloud-provider browsing, background sync, macro recording and a plugin architecture are not part of the product today.

## Getting help

Xpecter is developed in the open on GitHub. If something breaks or works differently from what you expected, open an issue with your platform, the version from Settings > About, and what kind of session you were in. View > **Open Log Folder** opens the folder holding `xpecter.log`, which records connections, transfers and any error the window caught, rotated so it never grows without bound; attach it when something went wrong without an explanation.
