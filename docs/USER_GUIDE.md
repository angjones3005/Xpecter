# Xpecter User Guide

Xpecter is a desktop terminal for people who spend the day on remote machines and network hardware. One window holds SSH sessions, local shells, serial consoles, Telnet and Mosh, saved Remote Desktop and VNC sessions, a code editor that works on local and remote files, and a handful of network tools. It runs the same way on Windows, macOS and Linux.

This guide covers everything the app does and how to use it, as of v3.8.0. It is written for someone who has never opened Xpecter. If you only want the short version, read [At a glance](#at-a-glance) and [Your first connection](#your-first-connection).

---

## Contents

1. [At a glance](#at-a-glance)
2. [Installing and first launch](#installing-and-first-launch)
3. [The window](#the-window)
4. [Your first connection](#your-first-connection)
5. [Session types](#session-types)
6. [Saved sessions and the sidebar](#saved-sessions-and-the-sidebar)
7. [Working in the terminal](#working-in-the-terminal)
8. [The editor](#the-editor)
9. [Remote files over SFTP](#remote-files-over-sftp)
10. [Tools](#tools)
11. [Appearance](#appearance)
12. [Settings reference](#settings-reference)
13. [Keyboard shortcuts](#keyboard-shortcuts)
14. [Your configuration: where it lives and how to move it](#your-configuration-where-it-lives-and-how-to-move-it)
15. [Security](#security)
16. [Limitations and things to know](#limitations-and-things-to-know)
17. [Reporting problems](#reporting-problems)

---

## At a glance

| You want to | Do this |
| -- | -- |
| Connect to a host right now | Type `user@host` in the Quick connect box on the Home tab and press Enter |
| Open a saved session | Click it in the sidebar, or on the Home tab |
| Open a local shell | Terminal > New Local Shell, or click a shell profile in the sidebar |
| Split the screen | View > Split Vertical (Ctrl+Shift+D) or Split Horizontal (Ctrl+Shift+Enter) |
| Edit a file on the host you are connected to | Open the Remote files section in the sidebar and click the file |
| Edit a local folder | Sessions > New Text Editor, then open a folder from the editor's folder button |
| Save what is on screen | Ctrl+Shift+S |
| Forward a local port through SSH | Tools > Port forwarding |
| Change fonts, colors, wallpaper | Settings (the last item in the menu bar) |
| Move your setup to another machine | Settings > Export configuration, then Import on the other side |

Throughout this guide, `Ctrl` means `Cmd` on macOS. The app shows the right one for your platform.

---

## Installing and first launch

Download the build for your platform from the [Releases page](https://github.com/angjones3005/Xpecter/releases).

- **Windows.** Either run `xpecter-windows-installer.exe`, or unzip `xpecter-windows-amd64.zip` and run `xpecter.exe` from anywhere. Windows 10 1809 or newer is required for local shells (that is when ConPTY arrived).
- **macOS.** Unzip and run the app. The build is not signed or notarized yet, so the first time, right-click the app and choose **Open** instead of double-clicking, to get past Gatekeeper.
- **Linux.** Extract `xpecter-linux-amd64.tar.gz` and run the `xpecter` binary. No install step.

There is no account and no setup wizard. The app opens on the Home tab, which offers a **+ New Session** button and a Quick connect box.

### Updating

Settings > About > **Check for updates…** asks GitHub for the latest release. If there is a newer one, a banner appears under the title bar with a **Download** button. On Windows the installer is downloaded and launched with elevation, and Xpecter quits itself a couple of seconds later so the installer can replace its files. On macOS and Linux the archive is downloaded, extracted, and the folder revealed for you to swap in.

### Upgrading from Specter

Xpecter used to be called Specter. On first launch, an old `specter` configuration directory is migrated forward automatically, and the Windows Explorer context-menu entry is re-registered under the new name.

---

## The window

Xpecter draws its own title bar. From left to right: the Xpecter mark, the menus, then a theme toggle (light/dark), Minimize, Maximize and Close.

### Menus

**Terminal**
- New Window, New Tab, New Local Shell
- New Mosh Session…, New Telnet Session…, New Local Port Forward…
- One entry per saved command snippet (`Snippet: name`), and Manage Command Snippets…
- One entry per saved local shell profile, New Local Shell in Directory…, and Manage Local Shell Profiles…
- Close Tab, Disconnect (Ctrl+Shift+X)
- Clear Screen, Save Terminal Output… (Ctrl+Shift+S)

**Sessions**
- New Session (opens the session picker), New Text Editor, New Folder

**View**
- Toggle Sidebar (Ctrl+Shift+B)
- Single Pane, Split Vertical, Split Horizontal, 4-Pane Grid, Fullscreen (F11)
- Keyboard Shortcuts…

**Tools**
- Terminal (your default local shell), Command Prompt, PowerShell (the last two are Windows only)
- Port forwarding…, Network tools…
- Text Editor

**Settings** opens the Settings dialog directly.

### Tabs

Each tab holds one pane layout. The **⌂ Home** tab is permanent and cannot be closed. Other tabs show an icon for what they hold (💻 local shell, 🌐 SSH, 🔌 serial, 🪟 Remote Desktop, 🖥 VNC), a status dot, and a close button. Drag tabs left or right to reorder them. Turn on **Show tab numbers** in Settings to number them.

A tab that is not on screen shows a dot when output arrives in it, and 🔔 when its terminal rings the bell; both clear when you look at it. A bell in a tab you are not looking at, or while the window is in the background, also raises a system notification, so a long job that rings when it finishes is noticed from wherever you are. **Notify when a background terminal rings its bell** in Settings turns that off.

Closing a tab that still has a live session asks first. By default the app quits when the last tab closes. Turn on **Keep app open when last tab closes** in Settings if you would rather it stay open on the Home tab.

### Panes

A tab can be split into two panes side by side, two stacked, or a four-pane grid (View menu, or the shortcuts). Every pane is independent: each can hold an SSH session, a local shell, a serial console, a Remote Desktop or VNC card, or a text editor. A configuration file can sit open beside the switch it is being written for.

- Drag the divider between panes to resize them.
- Drag a pane by its header onto another pane to swap the two.
- Click a pane to give it the keyboard. The focused pane has an accent outline, and shortcuts such as Ctrl+S act on it.
- Hold Alt and press an arrow key to move focus between panes.
- The **⊟** button beside the tab bar opens a menu for filling the next pane: Duplicate this session, New local shell, New session…, Text editor, Split right (empty), Split below (empty).
- Ctrl+Shift+W closes the active pane. Switching to a smaller layout asks before closing connected panes.

### The sidebar

The sidebar sits on the left. Drag its edge to resize it, or hide it with Ctrl+Shift+B or the `«` button. It has four collapsible sections: **Sessions**, **Local shells**, **Folders** and **Remote files**. Each is described where it belongs later in this guide.

### The Home tab

Home is what you see on launch and whenever no session has the tab. It shows:

- A **Quick connect** box. Type part of a saved session's name, host or tag to filter, or type `user@host` or `user@host:port` to connect to something new. Arrow keys move through the results, Enter connects.
- **Pinned** sessions, **Recent** sessions with how long ago each was opened, and every **Saved session** grouped by folder.
- **Local shells**: one chip per saved shell profile.
- **+ New Session** and **Text Editor** buttons, and a strip showing the current bindings for the most common shortcuts.
- **Pick up where you left off**: the tabs that were open when you last quit, with a **Reopen** button. Tabs, split panes, the folder and files open in each editor, local shells, serial consoles and Remote Desktop or VNC cards all come back. Reopened SSH sessions connect on their own where a key, an agent or a saved password can; one that needs a password asks for it, and if you cancel, its pane waits with **R** to connect. Passwords are never saved with the tab set. Tick **Always reopen automatically** to skip the question, or choose **Start fresh** under Settings > On launch to stop being asked.

### The status bar

A thin bar at the bottom shows short confirmations and errors (a file saved, a forward stopped, an import count) that fade after a moment.

---

## Your first connection

1. Open the session picker: Sessions > New Session, the **+ New Session** button on Home, or press `+` in the sidebar's Sessions header.
2. Press **1** or click **SSH**.
3. Enter the host and user. Choose **Password** or **Key**.
4. Click **Connect**.

The first time you connect to a host, Xpecter shows its host key fingerprint and asks you to confirm. Check it against what you expect, then click **Trust and connect**. The key is remembered in your own `~/.ssh/known_hosts`, the same file OpenSSH uses, so a host you have already trusted from the command line is trusted here too.

Once connected, Xpecter asks whether to save the session. Saved sessions store the host, user, port, key path and options. They never store a password unless you have deliberately turned on keychain saving (see [Security](#security)).

---

## Session types

The session picker offers seven choices. Press the number or click the tile. Esc closes it.

### 1. SSH

The SSH form has:

- **Host** and **User**. Port is 22 from this form; set another port in the session's Edit dialog or by typing `user@host:port` in Quick connect.
- **Device kind**: VM / Host, Network switch, or Firewall. This only chooses the icon shown in the sidebar.
- **Password** authentication. A warning appears under the field if Caps Lock is on. If keychain saving is enabled in Settings, a **Remember this password in the OS keychain** checkbox appears here too.
- **Key** authentication. Browse to a private key file, and enter its passphrase if it has one. You can also tick **Use SSH agent** to sign with keys held by the OpenSSH agent (Windows, macOS, Linux) or PuTTY's Pageant, or **Use Xpecter memory agent** to have Xpecter remember an unlocked key for the rest of this app run, so repeated connections do not ask for the passphrase again. Nothing from the memory agent is written to disk.
- **Enable X11 forwarding**. Needs a local X server: native X on Linux, XQuartz on macOS, VcXsrv or Xming on Windows.
- **Jump host**. A bastion in OpenSSH `ProxyJump` form, `[user@]host[:port]`. The target is reached through a channel on the jump host, so a machine only visible from the bastion becomes reachable. The bastion is host-key-verified exactly like the target.
- **Terminal speed**. Leaves the PTY's baud alone by default; set 9600 to 115200 for console servers and serial bridges that read it.

Xpecter falls back to legacy key exchange, cipher and host key algorithms automatically when a host only offers old ones, so older network hardware connects without a compatibility switch.

If a private key file's permissions are too open, Xpecter warns and offers **Use it anyway**. If the key is encrypted, a masked passphrase prompt appears.

**SSH keepalive** is on by default and keeps idle sessions from being dropped by a timeout. Turn it off in Settings if a device misbehaves with it.

### 2. Shell

A local shell on this machine. On Windows the default is PowerShell; Command Prompt and PowerShell are also available by name from the Tools menu. On macOS and Linux it is your login shell. A shell with no directory of its own opens in your home directory.

**Local shell profiles** are named shells with a starting directory. Create one from Terminal > Manage Local Shell Profiles… or the `+` in the sidebar's Local shells section. Profiles appear in the Terminal menu, the sidebar and the Home tab. **New Local Shell in Directory…** opens a folder picker and starts a shell there without saving a profile.

On Windows, Xpecter registers an **Open in Xpecter** entry in Explorer's right-click menu for folders and folder backgrounds, which opens a shell already in that directory.

### 3. Serial

A console over a serial port. Enter the port name (`COM3` on Windows, `/dev/ttyUSB0` on Linux, `/dev/tty.usbserial-…` on macOS) and choose a baud rate from 9600 to 115200. Serial sessions are saved, grouped, filtered and logged like any other, and use the same terminal.

### 4. Telnet

Unencrypted, for legacy equipment. Enter the host and port (default 23). Xpecter runs your system's `telnet` client inside a local shell, so the client must be installed. On Windows, enable it under Optional Features or install a third-party client on the PATH.

### Mosh

Not a picker tile, but in the Terminal menu: **New Mosh Session…** asks for `user@host` and runs `mosh` in a local shell. The local machine needs the `mosh` client and the remote host needs `mosh-server` with its UDP ports open. Mosh sessions get Xpecter's tabs, resizing, logging and highlighting like everything else.

### 5. Remote Desktop (RDP)

Enter host, port (3389), user and an optional domain. Choose a display mode:

- **Full screen**
- **Resizable window**, where the remote desktop follows the window size as you drag it
- A fixed **1280×800**, **1600×900** or **1920×1080** window, scaled into whatever size you give it

Tick **Console session (/admin)** to attach to the console.

Xpecter does not draw the desktop itself. It writes a `.rdp` file with everything filled in and starts the client your platform already has: Remote Desktop Connection on Windows, Windows App on macOS, FreeRDP or Remmina on Linux. The client asks for the password; Xpecter never stores one. A pane in Xpecter stands for the session, showing where it went and whether the window is still open, with **R** to open it again, **D** to close the window from Xpecter, and **Enter** to close the pane. Quitting Xpecter leaves open Remote Desktop windows alone. On macOS the client is handed the file and not watched, and the pane says so.

### 6. VNC

Enter host and port (5900). VNC works the same way as RDP: it opens in the platform's viewer (Screen Sharing on macOS; TigerVNC, RealVNC, TightVNC, UltraVNC, Remmina or Vinagre on Windows and Linux), the viewer asks for the password, and a session card in Xpecter tracks it with the same R / D / Enter actions.

### 7. Editor

A text editor pane with no connection of its own. See [The editor](#the-editor).

---

## Saved sessions and the sidebar

### Saving

After an ad hoc connection, Xpecter offers to save it. You can also create sessions from the picker and save them, or import them (below). Every saved session can be pinned, grouped into folders, tagged, filtered and opened with one click, whatever its type.

### The Sessions section

The header shows a `live/total` count and three actions: `+` new session, 📁 new folder, `«` hide sidebar.

Below it, in order: a **★ Pinned** group, a **Running** group listing sessions that are connected right now, then your folders, then ungrouped sessions. Each row has a status dot (hollow for saved, amber while connecting, green when live), the session's name, and an icon for its device kind. The address is on the hover tooltip.

Clicking a session that is already connected switches to its tab instead of opening a second connection. To open a second connection deliberately, use **Open another session** from the right-click menu.

**Filter sessions…** matches on name, host, serial port and tags, and filters local shell profiles at the same time. Arrow keys and Enter work from the field. While a filter is active the folders step aside and rows show their address, so a match on a host still shows why.

### Right-click menu on a session

- **Pin to top** / **Unpin**
- **Open another session**
- **Edit session**
- **Forget saved password** (SSH only, and only while keychain saving is on)
- **Delete**, which asks first and also removes any keychain entry

### Folders

Create folders from Sessions > New Folder or the 📁 button. Folders nest. Drag a session onto a folder to move it there. Right-click a folder to **Rename** or **Delete** it; deleting a folder moves its sessions out rather than deleting them.

### Pinning

Pinned sessions sit at the top of the sidebar and lead the Home tab, so the machines you reach for every day are one click away on a cold start.

### Layouts

Sessions > **Save Tab Set as Layout…** saves the tabs that are open, with their splits and what is in each pane, under a name. Sessions > **Open Layout…** and the **Layouts** section on Home reopen one, connecting each pane again; the Home cards also rename (✎) and delete (✕). A layout stores what is needed to start each thing, never a password or output, and travels with an exported configuration.

### Tags

The Edit session dialog takes comma-separated tags. Tags are trimmed and de-duplicated, and both the sidebar filter and Quick connect search them.

A tag can carry a colour. **Settings > Tag colours** lists them: `prod` and `production` start red, `staging` orange, `dev`, `lab` and `test` green, and any tag can be added, recoloured or removed. A session with a coloured tag shows it as a pill in the sidebar, on its tab and on its pane header, so a terminal on a production box says so in the corner of your eye.

A tag can also be a **guard**; `prod` and `production` are, by default. In a session with a guarded tag every multi-line paste and every command snippet asks first, whatever the paste warning is set to, and the prompt names the tag and the session. Ordinary typing is never interrupted.

### The Edit session dialog

Right-click > Edit session. **Basic settings** has the name and the fields for the session's type. **Advanced settings** adds the key path, both agent options and **Forward the agent to the host** (see Agent forwarding), device kind, jump host, terminal speed, RDP display options, the folder, tags, and the **Port forwards** the session starts with (see Port forwarding).

### Importing sessions

- **Settings > Import from MobaXterm…** reads `.mxtsessions` and `.ini` files, mapping names, hosts, users, ports and key paths. Passwords are deliberately skipped.
- **Settings > Import from SSH config…** reads an OpenSSH `~/.ssh/config` and saves each concrete `Host` block as a session, carrying HostName, User, Port, IdentityFile and ProxyJump (which lands in the jump-host field). Wildcard-only blocks such as `Host *` are rules rather than hosts and are skipped.

- **Settings > Import from PuTTY…** (Windows) reads PuTTY's saved sessions from the registry: host, port, user, key file, agent settings, X11, a proxy of the SSH-jump kind, and serial sessions with their line and speed. Telnet, rlogin and raw sessions are skipped, as is Default Settings. PuTTY stores no passwords, so none are imported, and a key in PuTTY's own .ppk format is left out because Xpecter reads OpenSSH keys: that session is set to use the agent, so run Pageant, or convert the key in PuTTYgen (Conversions > Export OpenSSH key) and set its path in the Edit session dialog.

All three report how many sessions were imported.

### Local shells and Folders sections

**Local shells** lists your shell profiles; click one to open it, hover for a delete action. **Folders** lists pinned workspace folders; click one to open it in an editor. A folder currently open in an editor is highlighted. Pin a folder from this section's `+` or from the editor's folder menu.

---

## Working in the terminal

### Output highlighting

**Colorize terminal output** (on by default) colors plain output the way an operator reads it: words that mean something worked, failed or wants attention; interface names in long and short forms; IPv4, IPv6 and MAC addresses with prefix lengths; `%FACILITY-severity-MNEMONIC` log tags; URLs; Windows and POSIX paths; ISO-8601, syslog and IOS timestamps; sizes, rates, percentages and hex. It works the same on Linux hosts, switches, PowerShell, Command Prompt and serial consoles. Text the far end already colored is left exactly as sent, so prompts, pagers and vim are never recolored.

**Your own rules.** Settings > **Highlight rules** adds patterns of your own, each with one of the built-in colour categories. A **words** rule is a comma-separated list matched whole (`CRIT, DOWN, c++`); a **regex** rule is a regular expression. Your rules win over the built-in ones where they overlap, apply to every terminal at once, and persist between launches.

### Links

Hover a URL in output to underline it and see where it goes. **Ctrl+click** (Cmd+click on macOS) opens it in your browser. A plain click never opens anything, so finishing a selection cannot launch a browser.

### Find in output

**Ctrl+Shift+F**, or Terminal > **Find in Output…**, opens a find bar over the focused terminal. Every match in the scrollback is highlighted and the current one is counted; Enter and Shift+Enter step through them, **Aa** matches case, **.\*** reads the text as a regular expression, and Escape returns to the prompt. The bar starts with whatever was selected in the terminal.

### Send input to all panes

View > **Send Input to All Panes**, or the ⇶ button on any pane header, makes a split tab broadcast: what you type or paste into one pane goes to every terminal pane in the tab, so the same command runs on four switches at once. The pane headers show it while it is on, and the same command turns it off. Broadcasting is per tab and is off for every new tab. Pastes and snippets still go through the paste guard, once.

### Scrollback

Terminals keep 10,000 lines by default. Change it in Settings, from 1,000 to 100,000. Every retained line is held in memory per terminal, so raise it with intent rather than maximizing it.

### Clipboard and paste

- **Right-click to paste** is on by default.
- **Copy on select** is off by default; turn it on to copy whatever you highlight.
- **Ctrl+Shift+V** pastes everywhere, whatever the platform's webview thinks.
- **Multi-line paste.** Line endings are translated to what a terminal reads as Enter, so text copied from Windows no longer arrives with a stray blank line after each one. Where the program on the other end supports bracketed paste, a pasted block lands on the prompt as one piece and waits: bash and zsh stop running each line as it arrives, and vim stops indenting every line further under the one above. Where lines really will run one at a time, such as on network hardware, **Warn before pasting multiple lines** (on by default) asks first.
- **Line delay.** Consoles that drop characters when a whole configuration is pasted at once (most switches over a serial link) want a pause after every Enter. **Delay between pasted lines** in Settings adds one, and the multi-line paste prompt offers the same choice beside a preview of what is about to be sent, and remembers what you pick.
- **Command snippets** (Terminal menu) type a saved command into the focused session. They go through the same paste guard.
- **OSC 52** lets a remote program write to your local clipboard. It is off by default because it lets a remote process write to your clipboard silently. Turn it on in Settings > Security if you use tools that rely on it.

### Zoom and fullscreen

Ctrl+= and Ctrl+- zoom the focused terminal's font, Ctrl+0 resets it. F11 toggles fullscreen.

### Serial console controls

A serial session has a bar between its header and the terminal. **Enter sends** picks CR, LF or CR+LF, since a switch wants CR while some devices insist on both. **Local echo** shows what you type on a device that does not echo it. **DTR** and **RTS** toggle the two modem-control lines, **Break** holds the line in break for a quarter second, and **Hex** shows what arrives as a hex dump beside the text of the bytes, for the moments when the terminal is making a mess of a binary stream. The bar's choices apply to pastes as well as typing.

### Saving output and logging

- **Save Terminal Output…** (Ctrl+Shift+S) writes what is in the focused terminal's buffer to a file. It also works from the panel shown after a session drops.
- **Session logging** appends raw output from every SSH, local shell and serial session to a per-session file in a directory you choose (Settings > Session logging > Choose…). Files are named `<session label>-<session id>.log`. Logging is off until a directory is chosen, and **Disable session logging** turns it off again.

### When a session drops

A session that disconnects, times out or fails leaves its pane in place. A red message marks the end of the output, and a **Session stopped** panel offers **R** to reconnect to the same host, **S** to save the output that was on screen, and **Enter** to close the pane. Keystrokes are held rather than typed into a dead connection. Terminal > Disconnect (Ctrl+Shift+X) ends a session on purpose.

### Clear Screen

Terminal > Clear Screen clears the buffer. The result survives a window resize.

---

## The editor

The editor is a kind of session, not a fixed panel. Open one as a whole tab (Sessions > New Text Editor, Tools > Text Editor, or picker choice 7) or as one pane of a split beside a shell. Two editor panes can sit side by side, each with its own files, and each answers Ctrl+S for the buffer it is actually showing.

### Documents

Each pane has a strip of open documents. Click to switch, drag to reorder, Ctrl+PageUp / Ctrl+PageDown to step through them. A modified document shows a dot in place of its close button, and the pane and tab carry the mark too, so an unsaved buffer behind two other tabs is still visible. Closing anything with unsaved changes asks: **Save**, **Discard** or **Cancel**.

At the left of the strip is a folder button (see below); at the right, a **Run** button for files Xpecter knows how to run.

### File commands

From the command palette (Ctrl+Shift+P) or the shortcuts:

- New File (Ctrl+N), Open File… (Ctrl+O), Save (Ctrl+S), Save As… (Ctrl+Shift+S), Close File (Ctrl+W)
- **Save to Remote Host…** writes the buffer to any host you are connected to, over SFTP
- **Reload From Disk** re-reads a file that changed underneath you (asks first if the buffer is modified)
- **Run File**, **Delete File…**, **Copy File Path**, **Open Outside Xpecter** (hands the file to the system application)

### The workspace tree

Click the folder button on the document strip, then **Open Folder…**. The folder appears as a tree inside the pane, so a split can hold a folder on one side and a shell on the other. The tree marks which files are open, and folders expand independently.

- **Create.** The tree header adds a file or folder at the root; every folder row offers the same two actions for creating inside it. A new file opens straight away. A name already taken is refused rather than overwritten.
- **Rename.** Every row has a rename action. A taken name is refused, a renamed folder stays expanded with everything open inside it, and an open file follows its new name without losing unsaved changes.
- **Delete.** Every row has a delete action, and the open file can be deleted from the palette. Nothing goes to a recycle bin, so the confirmation names the full path and, for a folder, counts what is going with it. An unmodified buffer on a deleted file closes; a buffer with unsaved changes stays open, because it is now the only copy.
- **Resize.** Drag the tree's edge to give long filenames room; double-click the edge to reset. The width is one setting shared by every pane and remembered between launches.
- **It keeps up.** A file added to an open folder by anything else, a build, a download, a shell in the next pane, appears on its own. Only the folders on screen are watched, so a collapsed busy directory costs nothing.
- **Find in files.** The 🔍 button on the tree header, **Ctrl+Shift+F** with the caret in the editor, or **Find in Files…** in the palette searches the whole folder for text or a regular expression, matching case or not. Results take the tree's place, grouped by file with the line number and the matching line; click one to open the file at that line. Version-control folders, `node_modules`, build output, files over 2 MB and binary files are skipped, and a search stops early after a thousand hits and says so. Escape brings the tree back.
- **Show in File Explorer.** The tree header has a button (⧉) that opens the folder in your system's file manager: File Explorer on Windows, Finder on macOS, whatever the desktop uses on Linux. Right-click any row for the same action: a folder opens as itself, a file opens its folder with the file selected. The same command is on the folder menu, on a document tab's right-click menu, in the command palette, and on each pinned folder in the sidebar.

The folder menu also has **Refresh folder**, **Show in File Explorer**, **Close folder**, **Pin this folder to the sidebar**, and a list of pinned folders to jump between.

### Opening anything

Every row in the tree opens. Text opens in the editor. PDFs and common images open in Xpecter's own viewers. Everything else, programs, archives, office documents, media, databases, and anything whose contents turn out to be binary, is handed to the application your system uses for it. Opening a program asks first, because a click in a file tree should not be able to start one silently. Files too large for the editor say so.

### Reading PDFs

A PDF gets a tab like any document, from the tree or from the remote browser (a PDF on a host opens straight from the host without downloading first). The viewer fits the page to the pane, has zoom, actual-size and fit-width buttons and a page counter that follows as you scroll. Pinch on a trackpad, Ctrl+scroll with a mouse, or Ctrl with + / - / 0 all zoom around the point under the cursor. Pages are drawn as they come into view, so a long manual opens as fast as a memo. A PDF is never written back; saving is refused rather than doing nothing. **Open Outside Xpecter** is there when you want the system viewer.

### Viewing images

PNG, JPEG, GIF, WebP, BMP, ICO, SVG and AVIF open in a viewer tab with the same fit, actual-size and zoom controls as the PDF viewer. A small image is never blown up past its real size. Transparency shows against a checkerboard. TIFF and PSD go to the system application.

### Running a file

The **Run** button, or Run File in the palette, saves the file and runs it:

| File | Runs with |
| -- | -- |
| `.html`, `.htm` | Your browser |
| `.py`, `.pyw` | `python` or `python3` |
| `.ps1` | `powershell` or `pwsh`, with `-ExecutionPolicy Bypass` |
| `.js`, `.mjs`, `.cjs` | `node` |
| `.sh`, `.bash` | `bash` |
| `.bat`, `.cmd` | `cmd /c` (Windows only) |

Scripts run in a live shell opened in the file's own directory, so the output stays on screen and Up then Enter runs it again. An unsaved buffer is sent to Save As first. A script opened from a host runs on that host, in the session it was opened from.

### Editing commands

Find and Replace (Ctrl+F, Ctrl+H), Go to Line (Ctrl+G), Go to Symbol, Format Document, Toggle Line Comment, Trim Trailing Whitespace, Sort Lines ascending or descending, Transform to upper or lower case, Fold All, Unfold All, Set Language…, Set Indentation… (spaces or tabs, or detect from the file), Set Line Endings… (LF or CRLF), Toggle word wrap (Alt+Z). **All Editor Commands…** (F1) opens Monaco's own palette for everything else.

**Ctrl+P** jumps to any file in the open workspace by name. **Ctrl+Shift+P** opens Xpecter's command palette. Both act on the pane holding the caret.

### Document status bar

Each pane shows the path of the file it is editing with line and column, indentation, line endings, detected language and wrap state. Language, indentation and line endings can each be changed from there. A file that already uses a different indent style keeps it rather than being reformatted.

### Languages

The editor ships Monaco's full language set, with language services in dedicated workers for TypeScript and JavaScript, JSON, CSS, SCSS, Less and HTML. On top of that: Haskell, PureScript, Idris, Elm, OCaml, Standard ML, Erlang, Nix, Lisp (also Common Lisp and Racket), Agda and Lean. **Skald**, Dawnrail's switch-configuration language, is a first-class language for `.skald` files.

`.txt`, `.log`, `.out`, `.err` and `.text` files are colored with the terminal's own vocabulary rather than shown as one grey wall: outcomes, addresses, interface names, timestamps, log tags, URLs, paths and sizes read the same in the editor as in the pane beside it. Any other file can be switched to this from Set Language.

### Editor wallpaper and font

The editor shares the terminal's font and size. It takes its own wallpaper image and opacity, separate from the terminal's, because a picture that reads well behind a prompt is usually noise behind code. See [Appearance](#appearance).

---

## Remote files over SFTP

With an SSH session focused, the sidebar's **Remote files** section shows that host's filesystem. The header names the session and offers `+` new file here, ⊡ new folder here, ⤒ upload files here, and ⟳ reread.

- **Navigate** by clicking folders; `📁 ..` goes up.
- **Open** a file by clicking it. It opens in an editor pane, and Ctrl+S writes it back to the host. PDFs and images open in Xpecter's viewers straight from the host.
- **Save as root.** When Ctrl+S is refused because your login cannot write the file, Xpecter offers to save it through `sudo`: the buffer goes to a temporary file on the host and one sudo command copies it over the original, keeping the file's owner and mode. The dialog asks for the sudo password, prefilled with the session's own where it is known, and shows sudo's own complaint if it refuses.
- **Shift-click or middle-click** a file to open it with the system's default application instead. Xpecter downloads a private temporary copy, preserving its timestamp, and hands it to the platform handler.
- **Edit externally.** A file's ✎↗ action downloads it and opens it in the system's default application for that kind of file. Xpecter keeps watching the copy, and every save there is uploaded straight back to the host, with a note in the status bar each time. The copy is removed when the session closes.
- **Upload** by dragging files from your desktop or file manager onto the list, or with the header's ⤒ button, which opens a file dialog and streams each file from disk with a progress bar under the list. Either way the remote file keeps the local modification time where the server supports it.
- **Download** a file with its ⤓ action, which asks where to save it. A folder's ⤓ downloads the whole folder, into a place you choose, as a folder of the same name; a folder already there by that name is refused rather than merged into. Progress shows under the list, and a finished download says where it went. Every file lands under a temporary name and is renamed when complete, so a download cut short never leaves a truncated file wearing the real name.
- **Create** a file or folder in the current directory from the header, or inside any folder row. A new file opens for editing straight away.
- **Rename** any row in place. A taken name is refused rather than overwritten. Renaming an open file retargets its buffer.
- **Delete** any file or directory. SFTP has no trash and it is somebody else's machine, so the dialog says so and counts what a directory holds before you confirm.
- The list **re-reads itself** on a slower clock than the local tree, so a file written by the session in the terminal beside it shows up without a manual refresh. It pauses when the section is closed, the window is in the background, or the browser is pointed at a host that is not the focused tab.

**Following the shell.** With **Follow the shell's directory** on (Settings > Terminal, on by default), the list follows the directory the shell's prompt is in, provided the shell announces it. Most do not out of the box: View > **Shell Integration…** shows the one line to add to `.bashrc`, `.zshrc` or fish's config, with a Copy button for each. It is the standard OSC 7 escape, which other terminals read too.

Dragging a file out of the list onto the desktop is not something the window can do; the ⤓ action is the download.

---

## Tools

### Port forwarding

Tools > **Port forwarding…** starts a tunnel through a live SSH session. Pick the session in **Through:**, the kind, and the addresses, and click **Add forward**. Three kinds:

- **Local port →** binds `127.0.0.1:port` here and tunnels it to a `host:port` reachable from the far side, so a remote service is reachable as if it were local (`ssh -L`).
- **SOCKS proxy on** binds a local port as a SOCKS5 proxy. Point a browser or any SOCKS-aware program at it and its connections leave from the host, so the whole far network is reachable (`ssh -D`).
- **Host port →** asks the host to listen on a port and delivers each connection to an address here (`ssh -R`). Whether that port is reachable from beyond the host itself is the server's `GatewayPorts` setting.

Active forwards are listed with a stop action. A forward lives as long as its session and is torn down with it. Terminal > **New Local Port Forward…** does the local kind through a series of prompts.

**Saved with the session.** The 📌 action beside a forward adds it to the saved session it runs through, and the Edit session dialog's **Port forwards** list edits the set directly. Saved forwards start on their own every time the session connects, and one that cannot start (its port is taken, most often) is reported on the terminal without failing the connection.

### Agent forwarding

Tick **Forward the agent to the host** on a session that authenticates with your SSH agent, and programs on the host can use your local keys: `git pull` from a private repository, or a second hop to a machine behind it. Forwarding is requested when the shell starts; if the host refuses it, the session says so on the terminal and carries on without it. Turn it on only for hosts you trust, since root on that host can use your agent while the session is open.

### Network tools

Tools > **Network tools…** has two utilities that need no session:

- **Wake-on-LAN.** Enter a MAC address and, optionally, a broadcast address (default `255.255.255.255`), and click **Send magic packet**.
- **Port scan.** Enter a host and a list of TCP ports such as `22,80,443,8000-8100`, and click **Scan**. The results list which are open.

### X11 forwarding

Tick **Enable X11 forwarding** on an SSH session. Xpecter requests forwarding and proxies X11 channels to your local display, which must be running: native X on Linux, XQuartz on macOS, VcXsrv or Xming on Windows.

### Command snippets

Terminal > **Manage Command Snippets…** saves a named command or configuration block. Each appears as `Snippet: name` in the Terminal menu and types into the focused session.

---

## Appearance

All of this is in Settings > Appearance, and applies everywhere at once.

- **Theme**: Dark or Light for the application chrome. The toggle in the title bar switches it too.
- **Terminal colors**: Dark, Light, Dracula, Nord, Solarized Dark, Solarized Light, Gruvbox Dark, One Dark, Tokyo Night. Output highlighting follows the scheme.
- **Font**: Menlo, Consolas, Cascadia Code, Fira Code, JetBrains Mono, Courier New, IBM Plex Mono, Source Code Pro, Inconsolata, Victor Mono, Ubuntu Mono. Most are bundled so they render the same on every machine. The editor uses the same font.
- **Font size**: 8 to 32, default 13. The zoom shortcuts adjust a single terminal on top of this.
- **Wallpaper**: Browse to an image to show behind terminals, then set its opacity (0 to 60 percent). Clear wallpaper removes it. A wallpaper switches the terminal from the WebGL renderer to the canvas renderer while it is set.
- **Editor wallpaper**: a separate image and opacity for editor panes. The image sits under the text, gutter and minimap; find boxes and autocomplete stay solid so they remain readable.

---

## Settings reference

Settings is one scrolling dialog. Everything here persists between launches.

**Appearance**: Theme, Terminal colors, Font, Font size, Wallpaper and opacity, Editor wallpaper and opacity. See above.

**Terminal**

| Setting | Default |
| -- | -- |
| Scrollback (1,000 to 100,000 lines) | 10,000 |
| Colorize terminal output | On |
| Show tab numbers | Off |
| SSH keepalive (prevent idle disconnects) | On |
| Keep app open when last tab closes | Off |
| Cursor style (block, underline, bar) | Block |
| Cursor blink | Off |
| Follow the shell's directory in Remote files | On |

**Clipboard & paste**

| Setting | Default |
| -- | -- |
| Copy on select | Off |
| Right-click to paste | On |
| Warn before pasting multiple lines | On |

**Security**

| Setting | Default |
| -- | -- |
| Allow remote hosts to write to your clipboard (OSC 52) | Off |
| Remember SSH passwords in the OS keychain | Off |

Turning keychain saving off forgets every saved password.

**Highlight rules**: patterns of your own for output highlighting, each with a colour category. See Output highlighting.

**Tag colours**: the colour and the guard for each tag. See Tags.

**Session logging**: Log directory (Choose…), and Disable session logging once one is set. Off until a directory is chosen.

**Configuration**: Export configuration…, Import configuration…, Export encrypted configuration…, Import encrypted configuration…, Import from MobaXterm…, Import from SSH config…, Import from PuTTY…, Restore from backup…, Reset appearance settings to defaults, Erase all saved data…. See the next two sections.

**About**: the version, and Check for updates….

---

## Keyboard shortcuts

View > **Keyboard Shortcuts…** lists every binding. Click one to rebind it, press the new keys, or Esc to cancel. Custom bindings persist and are reset by **Reset appearance settings to defaults**. The Home tab shows the current bindings for the most common actions.

**Rebindable**

| Action | Default |
| -- | -- |
| Disconnect active session | Ctrl+Shift+X |
| Paste | Ctrl+Shift+V |
| Save terminal output to a file | Ctrl+Shift+S |
| Toggle sidebar | Ctrl+Shift+B |
| Zoom in / Zoom out / Reset zoom | Ctrl+= / Ctrl+- / Ctrl+0 |
| Toggle fullscreen | F11 |
| Split vertical (or 4-pane grid) | Ctrl+Shift+D |
| Split horizontal (or 4-pane grid) | Ctrl+Shift+Enter |
| Close active pane | Ctrl+Shift+W |

**Panes**: Alt+Arrow moves focus between panes.

**Tabs** (fixed): Ctrl+Tab and Ctrl+Shift+Tab step to the next and previous tab; Ctrl+1 to Ctrl+8 jump to that tab and Ctrl+9 to the last one.

**Editor** (fixed, active when an editor pane has the caret)

| Action | Keys |
| -- | -- |
| New file / Open file / Save / Save as / Close file | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S / Ctrl+W |
| Go to file / Command palette / All editor commands | Ctrl+P / Ctrl+Shift+P / F1 |
| Find / Replace / Go to line | Ctrl+F / Ctrl+H / Ctrl+G |
| Find in files | Ctrl+Shift+F |
| Next / previous document | Ctrl+PageDown / Ctrl+PageUp |
| Toggle word wrap | Alt+Z |

Ctrl+S saves when an editor pane has focus. In a terminal, Ctrl+Shift+S saves output. The two never collide.

**Session stopped panel**: R reconnect, S save output, Enter close pane.

**Session picker**: 1 to 7 choose a type, Esc closes. **Every dialog** closes with Esc or a click outside it.

---

## Your configuration: where it lives and how to move it

### Files

Xpecter keeps its configuration in your OS config directory, under `xpecter`:

| OS | Path |
| -- | -- |
| Windows | `%AppData%\xpecter` |
| macOS | `~/Library/Application Support/xpecter` |
| Linux | `$XDG_CONFIG_HOME/xpecter`, or `~/.config/xpecter` |

Inside are `settings.json`, `sessions.json`, `groups.json`, `folders.json` and `localshellprofiles.json`, plain indented JSON, readable only by you. Some interface preferences (collapsed sections, shortcuts, snippets, tree width) live in the app's local storage rather than these files.

### Automatic backups

Xpecter writes a backup of its configuration to `backups/xpecter-backup-YYYYMMDD-HHMMSS.json` in that directory at most once a day, keeping the seven most recent. Settings > **Restore from backup…** lists them by date and restores one after confirming.

### Export and import

Settings > **Export configuration…** writes your saved sessions, groups, local shell profiles, pinned folders and appearance settings to a single file. **Import configuration…** reads one and asks which you meant:

- **Replace** makes this machine match the file exactly. This is what restoring means, and it is safe to repeat.
- **Merge** adds the file's contents alongside what is already here.

Passwords are never written to a configuration file. Password-authenticated sessions ask for theirs again on the new machine; key-based ones come back ready to use, provided the key file is at the same path.

**Export encrypted configuration…** and **Import encrypted configuration…** do the same with a passphrase-protected bundle (PBKDF2-SHA256 and AES-256-GCM), so a configuration can sit in OneDrive, Dropbox, S3 or any file store you already use without going through a Xpecter service. Bundles contain no passwords and no `known_hosts` entries.

### Resetting

- **Reset appearance settings to defaults** restores theme, colors, font, wallpapers, shortcuts and the other preferences. Saved sessions are not touched.
- **Erase all saved data…** clears sessions, groups, shell profiles, pinned folders and appearance settings, so a machine can be handed on clean or reset before restoring. It writes a backup first and refuses to proceed if that fails, so it is always undoable from Restore from backup.

---

## Security

**Host keys.** Every SSH connection, including to a jump host, is verified against your own `~/.ssh/known_hosts`. An unknown host shows its fingerprint and asks before connecting. A host whose key has changed shows a stronger warning, since that is what an interception looks like; connect only if you know why the key changed.

**Passwords.** By default Xpecter stores no passwords anywhere. Session files hold host, user, port, key path and options only. This is deliberate: some other tools store saved passwords with weak, reversible obfuscation, and Xpecter does not repeat that.

If you turn on **Remember SSH passwords in the OS keychain**, a saved SSH session can keep its password in the operating system's own credential store, Windows Credential Manager, macOS Keychain or the Linux Secret Service, under the service name `Xpecter`. It is never written to Xpecter's files. A remembered password fills in on connect. Forget one from the session's right-click menu, by deleting the session, or by turning the setting off, which forgets them all. Remote Desktop and VNC sessions never store a password; their clients ask.

**Keys and agents.** Private keys and passphrases are not saved to session profiles. The Xpecter memory agent holds an unlocked key in memory for one app run only. Key files with permissions that are too open are flagged before use.

**Clipboard.** OSC 52 is off by default so no remote process can write to your clipboard without you enabling it.

**Programs.** Opening an executable from a file tree asks first.

**Encrypted bundles** use PBKDF2-SHA256 and AES-256-GCM and never include passwords or host keys.

---

## Limitations and things to know

- **macOS** builds are unsigned, so the first launch needs right-click > Open. The Remote Desktop client on macOS is started but not watched, so its pane cannot tell whether the window is still open.
- **Serial** takes a typed port name; there is no dropdown of detected ports yet.
- **Telnet and Mosh** run your system's `telnet` and `mosh` clients, which must be installed.
- **X11 forwarding** needs a local X server running.
- **Remote Desktop and VNC** are drawn by the platform's own client, not inside the Xpecter window. The client must be installed (on Linux, FreeRDP or Remmina; a VNC viewer on every platform).
- **ZMODEM** transfers (`sz`/`rz` over the terminal) are not supported; the SFTP browser and its transfer actions are the way to move files. Font ligatures are not rendered either.
- **No drag-and-drop download** from the remote browser yet; upload only.
- **Windows shells** need Windows 10 1809 or newer.
- **Detachable tabs and multiple windows** are limited; Terminal > New Window opens a second app window, but tabs cannot be dragged between windows.
- **Wallpaper** switches the terminal off the WebGL renderer, which may be slightly slower on very large panes.

---

## Reporting problems

Xpecter is developed in the open at [github.com/angjones3005/Xpecter](https://github.com/angjones3005/Xpecter). If something breaks, feels missing, or works differently from what you expected, open an issue there. "This crashed" and "I wish X worked like Y" are both useful. Include your platform, the Xpecter version from Settings > About, and what kind of session you were in. View > **Open Log Folder** opens the folder holding `xpecter.log`, which records connections, transfers and any error the window caught; attach it when something went wrong without an explanation.
