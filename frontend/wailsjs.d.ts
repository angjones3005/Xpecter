// Wails injects these globals at build time from the Go backend's bound
// methods (app.go). Hand-written here since Xpecter isn't using the
// `wails generate` codegen step yet, keep this in sync with app.go.
export interface ConnectRequest {
  host: string;
  port: number;
  user: string;
  password?: string;
  keyPath?: string;
  passphrase?: string;
  useAgent?: boolean;
  internalAgent?: boolean;
  x11?: boolean;
  // SPE-65: user already acknowledged the key-permission warning once
  // for this attempt.
  ignoreKeyPermWarning?: boolean;
}
export interface ConnectResult {
  sessionId?: string;
  connectDurationMs?: number;
  needsTrust?: boolean;
  changed?: boolean;
  host?: string;
  fingerprint?: string;
  keyType?: string;
  needsPassphrase?: boolean;
  // SPE-65: the selected key file is group/world-readable. Soft
  // warning, not a hard block, retry with ignoreKeyPermWarning once
  // acknowledged.
  needsKeyPermConfirm?: boolean;
  keyPermPath?: string;
  keyPermMode?: string;
  // SPE-99: true if this connection only succeeded via automatic
  // fallback to a widened algorithm set, not something requested, an
  // honest after-the-fact notice about reduced security.
  legacyCompat?: boolean;
}
export interface SessionProfile {
  id: string;
  name: string;
  type?: string;
  host?: string;
  port?: number;
  user?: string;
  keyPath?: string;
  useAgent?: boolean;
  internalAgent?: boolean;
  x11?: boolean;
  serialPort?: string;
  baud?: number;
  groupId?: string;
  tags?: string[];
  lastUsed?: string;
  // Keeps a session at the top of the sidebar and Home regardless of
  // when it was last used, for the sessions you open on a cold start.
  pinned?: boolean;
  // Drives the sidebar icon for SSH sessions: '' / 'host' (default,
  // VM/Linux box) or 'switch' (network hardware). Serial sessions
  // always show their own icon regardless of this field.
  deviceKind?: string;
}
export interface SessionGroup {
  id: string;
  name: string;
  parentId?: string;
}
// SPE-106: a folder pinned to the sidebar, the editor's counterpart to
// a saved session. Stored with the rest of the configuration rather
// than in browser storage, so it exports, imports and backs up.
export interface Folder {
  id: string;
  path: string;
  name?: string;
}
// SPE-102: saved, reusable local shell profile (Windows Terminal-style).
// Distinct from SessionProfile, which covers SSH/serial.
export interface LocalShellProfile {
  id: string;
  name: string;
  command: string;
  startingDir?: string;
  // '' (generic terminal, default), 'powershell', 'cmd', or 'wsl'.
  icon?: string;
  tabTitle?: string;
}
// SPE-105: the editor's folder/workspace tree. Same shape as
// RemoteFile below so both trees render through the same code.
export interface LocalFile {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}
export interface RemoteFile {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}
// Emitted as "ssh:closed:<id>" / "serial:closed:<id>" when a session's
// read loop stops unexpectedly (SPE-59). Deliberate closes (user closed
// the tab) never emit this event, there's nothing to tell the user.
export interface SessionClosedEvent {
  eof: boolean;
  message: string;
}
// Global terminal personalization (SPE-61): wallpaper, color scheme,
// and font, one set for the whole app, not per-session/per-tab.
export interface Settings {
  wallpaperPath?: string;
  wallpaperOpacity?: number;
  colorScheme?: string;
  fontFamily?: string;
  fontSize?: number;
  // Frontend-only, never sent to the backend: the wallpaper image
  // re-read as a data: URL each load via App.ReadImageFile(wallpaperPath),
  // since only the path itself is persisted in settings.json.
  wallpaperDataUrl?: string;
  // SPE-79. Inverted polarity matches the Go struct: false/absent means
  // keepalive is ON (the default), only true actually disables it.
  sshKeepaliveDisabled?: boolean;
  sessionLogDirectory?: string;
  keepOpenOnLastTab?: boolean;
}
// Check-for-updates: a GitHub releases API check on launch. Includes an
// in-app download+launch flow (DownloadAndInstallUpdate below), the
// person still explicitly clicks a button, this isn't silent
// auto-update, but the click now does the whole thing in-app rather
// than handing off to a browser tab.
export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  assetUrl: string;
}
export interface AppBindings {
  StartLocalTerminal(shell: string, dir: string): Promise<string>;
  WriteLocalTerminal(id: string, data: string): Promise<void>;
  ResizeLocalTerminal(id: string, cols: number, rows: number): Promise<void>;
  CloseLocalTerminal(id: string): Promise<void>;
  Connect(req: ConnectRequest): Promise<ConnectResult>;
  // SPE-126: opens the shell on a session Connect authenticated, with
  // the PTY sized from the terminal that now exists on screen.
  StartShellSSH(id: string, cols: number, rows: number, x11: boolean): Promise<void>;
  SelectKeyFile(): Promise<string>;
  SelectImageFile(): Promise<string>;
  ReadImageFile(path: string): Promise<string>;
  SaveTextFile(defaultFilename: string, content: string): Promise<string>;
  SelectAnyFile(): Promise<string>;
  SelectDirectory(): Promise<string>;
  SelectFolder(): Promise<string>;
  SelectFileIn(defaultDir: string): Promise<string>;
  SaveTextFileIn(defaultDir: string, defaultFilename: string, content: string): Promise<string>;
  ListLocalDir(dir: string): Promise<LocalFile[]>;
  ReadLocalFile(path: string): Promise<string>;
  WriteLocalFile(path: string, content: string): Promise<void>;
  CreateLocalFile(dir: string, name: string): Promise<string>;
  CreateLocalDir(dir: string, name: string): Promise<string>;
  // Makes the watched set exactly `dirs` and emits "fs:changed" with the
  // directories whose listings changed. Pass [] to drop every watch.
  WatchLocalDirs(dirs: string[]): Promise<void>;
  // SPE-105: starts a second Xpecter process; Wails v2 is one window
  // per process, so this is the only shape a "new window" can take.
  OpenNewWindow(): Promise<void>;
  AppendSessionLog(directory: string, sessionId: string, label: string, content: string): Promise<void>;
  GetSettings(): Promise<Settings>;
  SaveSettings(settings: Settings): Promise<void>;
  GetVersion(): Promise<string>;
  CheckForUpdate(): Promise<UpdateInfo>;
  DownloadAndInstallUpdate(assetUrl: string): Promise<void>;
  GetClipboardText(): Promise<string>;
  GetOSUsername(): Promise<string>;
  GetPlatform(): Promise<string>;
  GetStartupDir(): Promise<string>;
  ExportConfigFile(): Promise<string>;
  ImportConfigFile(): Promise<string>;
  ExportEncryptedConfigFile(passphrase: string): Promise<string>;
  ImportEncryptedConfigFile(passphrase: string): Promise<string>;
  ImportMobaXtermSessions(): Promise<{ path: string; count: number }>;
  StartLocalForward(sessionId: string, localPort: number, remoteHost: string, remotePort: number): Promise<string>;
  StopForward(id: string): Promise<void>;
  ListBackups(): Promise<string[]>;
  RestoreBackup(filename: string): Promise<void>;
  ConnectSerial(portName: string, baud: number): Promise<string>;
  WriteSerial(id: string, data: string): Promise<void>;
  CloseSerial(id: string): Promise<void>;
  ListSerialPorts(): Promise<string[]>;
  ListFolders(): Promise<Folder[]>;
  SaveFolder(folder: Folder): Promise<void>;
  DeleteFolder(id: string): Promise<void>;
  ListLocalShellProfiles(): Promise<LocalShellProfile[]>;
  SaveLocalShellProfile(profile: LocalShellProfile): Promise<void>;
  DeleteLocalShellProfile(id: string): Promise<void>;
  ListSessions(): Promise<SessionProfile[]>;
  SaveSession(profile: SessionProfile): Promise<void>;
  DeleteSession(id: string): Promise<void>;
  ListGroups(): Promise<SessionGroup[]>;
  SaveGroup(group: SessionGroup): Promise<void>;
  DeleteGroup(id: string): Promise<void>;
  TrustHost(host: string): Promise<void>;
  TrustHostDespiteChange(host: string): Promise<void>;
  WriteSSH(id: string, data: string): Promise<void>;
  ResizeSSH(id: string, cols: number, rows: number): Promise<void>;
  CloseSSH(id: string): Promise<void>;
  ListRemoteDir(id: string, path: string): Promise<RemoteFile[]>;
  ReadRemoteFile(id: string, path: string): Promise<string>;
  OpenRemoteFile(id: string, path: string): Promise<void>;
  WriteRemoteFile(id: string, path: string, content: string): Promise<void>;
  UploadRemoteFile(id: string, path: string, base64Content: string, modifiedAt: number): Promise<void>;
  // All three return the resulting remote path. A name already taken is
  // an error rather than a silent overwrite, matching the local pair.
  CreateRemoteFile(id: string, dir: string, name: string): Promise<string>;
  CreateRemoteDir(id: string, dir: string, name: string): Promise<string>;
  RenameRemoteEntry(id: string, oldPath: string, newName: string): Promise<string>;
}
interface WailsRuntime {
  EventsOn(eventName: string, callback: (...data: unknown[]) => void): () => void;
  EventsOff(eventName: string, ...additionalEventNames: string[]): void;
  EventsEmit(eventName: string, ...data: unknown[]): void;
  WindowMinimise(): void;
  WindowToggleMaximise(): void;
  Quit(): void;
  BrowserOpenURL(url: string): void;
  WindowFullscreen(): void;
  WindowUnfullscreen(): void;
  WindowIsFullscreen(): Promise<boolean>;
}
declare global {
  interface Window {
    go: { main: { App: AppBindings } };
    runtime: WailsRuntime;
  }
}
