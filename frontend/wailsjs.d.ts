// Wails injects these globals at build time from the Go backend's bound
// methods (app.go). Hand-written here since Specter isn't using the
// `wails generate` codegen step yet, keep this in sync with app.go.

export interface ConnectRequest {
  host: string;
  port: number;
  user: string;
  password?: string;
  keyPath?: string;
}

export interface RemoteFile {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export interface AppBindings {
  StartLocalTerminal(): Promise<void>;
  WriteLocalTerminal(data: string): Promise<void>;
  ResizeLocalTerminal(cols: number, rows: number): Promise<void>;

  Connect(req: ConnectRequest): Promise<string>;
  WriteSSH(id: string, data: string): Promise<void>;
  ResizeSSH(id: string, cols: number, rows: number): Promise<void>;
  CloseSSH(id: string): Promise<void>;

  ListRemoteDir(id: string, path: string): Promise<RemoteFile[]>;
  ReadRemoteFile(id: string, path: string): Promise<string>;
  WriteRemoteFile(id: string, path: string, content: string): Promise<void>;
}

interface WailsRuntime {
  EventsOn(eventName: string, callback: (...data: unknown[]) => void): void;
  EventsEmit(eventName: string, ...data: unknown[]): void;
}

declare global {
  interface Window {
    go: { main: { App: AppBindings } };
    runtime: WailsRuntime;
  }
}
