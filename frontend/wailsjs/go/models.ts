export namespace config {
	
	export class SessionProfile {
	    id: string;
	    name: string;
	    host: string;
	    port: number;
	    user: string;
	    keyPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new SessionProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.keyPath = source["keyPath"];
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

}

