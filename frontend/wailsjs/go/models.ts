export namespace config {
	
	export class SessionGroup {
	    id: string;
	    name: string;
	    parentId?: string;
	
	    static createFrom(source: any = {}) {
	        return new SessionGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.parentId = source["parentId"];
	    }
	}
	export class SessionProfile {
	    id: string;
	    name: string;
	    type?: string;
	    host?: string;
	    port?: number;
	    user?: string;
	    keyPath?: string;
	    serialPort?: string;
	    baud?: number;
	    groupId?: string;
	    tags?: string[];
	    lastUsed?: string;
	    deviceKind?: string;
	
	    static createFrom(source: any = {}) {
	        return new SessionProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.keyPath = source["keyPath"];
	        this.serialPort = source["serialPort"];
	        this.baud = source["baud"];
	        this.groupId = source["groupId"];
	        this.tags = source["tags"];
	        this.lastUsed = source["lastUsed"];
	        this.deviceKind = source["deviceKind"];
	    }
	}
	export class Settings {
	    wallpaperPath?: string;
	    wallpaperOpacity?: number;
	    colorScheme?: string;
	    fontFamily?: string;
	    fontSize?: number;
	    sshKeepaliveDisabled?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.wallpaperPath = source["wallpaperPath"];
	        this.wallpaperOpacity = source["wallpaperOpacity"];
	        this.colorScheme = source["colorScheme"];
	        this.fontFamily = source["fontFamily"];
	        this.fontSize = source["fontSize"];
	        this.sshKeepaliveDisabled = source["sshKeepaliveDisabled"];
	    }
	}

}

export namespace main {
	
	export class ConnectRequest {
	    host: string;
	    port: number;
	    user: string;
	    password?: string;
	    keyPath?: string;
	    passphrase?: string;
	    ignoreKeyPermWarning?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ConnectRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.keyPath = source["keyPath"];
	        this.passphrase = source["passphrase"];
	        this.ignoreKeyPermWarning = source["ignoreKeyPermWarning"];
	    }
	}
	export class ConnectResult {
	    sessionId?: string;
	    needsTrust?: boolean;
	    changed?: boolean;
	    host?: string;
	    fingerprint?: string;
	    keyType?: string;
	    needsPassphrase?: boolean;
	    needsKeyPermConfirm?: boolean;
	    keyPermPath?: string;
	    keyPermMode?: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.needsTrust = source["needsTrust"];
	        this.changed = source["changed"];
	        this.host = source["host"];
	        this.fingerprint = source["fingerprint"];
	        this.keyType = source["keyType"];
	        this.needsPassphrase = source["needsPassphrase"];
	        this.needsKeyPermConfirm = source["needsKeyPermConfirm"];
	        this.keyPermPath = source["keyPermPath"];
	        this.keyPermMode = source["keyPermMode"];
	    }
	}
	export class RemoteFile {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new RemoteFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	    }
	}
	export class UpdateInfo {
	    available: boolean;
	    currentVersion: string;
	    latestVersion: string;
	    releaseUrl: string;
	    assetUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.currentVersion = source["currentVersion"];
	        this.latestVersion = source["latestVersion"];
	        this.releaseUrl = source["releaseUrl"];
	        this.assetUrl = source["assetUrl"];
	    }
	}

}

