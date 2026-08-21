// Wails injects these globals at build time from the Go backend's bound
// methods (app.go). Hand-written here since Specter isn't using the
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
  // SPE-65: user already acknowledged the key-permission warning once
  // for this attempt.
  ignoreKeyPermWarning?: boolean;
}
export interface ConnectResult {
  sessionId?: string;
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
  serialPort?: string;
  baud?: number;
  groupId?: string;
  tags?: string[];
  lastUsed?: string;
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
  SelectKeyFile(): Promise<string>;
  SelectImageFile(): Promise<string>;
  ReadImageFile(path: string): Promise<string>;
  SaveTextFile(defaultFilename: string, content: string): Promise<string>;
  SelectAnyFile(): Promise<string>;
  SelectDirectory(): Promise<string>;
  ReadLocalFile(path: string): Promise<string>;
  WriteLocalFile(path: string, content: string): Promise<void>;
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
  ListBackups(): Promise<string[]>;
  RestoreBackup(filename: string): Promise<void>;
  ConnectSerial(portName: string, baud: number): Promise<string>;
  WriteSerial(id: string, data: string): Promise<void>;
  CloseSerial(id: string): Promise<void>;
  ListSerialPorts(): Promise<string[]>;
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
