export namespace app {
	
	export class DirItem {
	    name: string;
	    path: string;
	    is_dir: boolean;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new DirItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.is_dir = source["is_dir"];
	        this.size = source["size"];
	    }
	}
	export class FileChange {
	    path: string;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new FileChange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.status = source["status"];
	    }
	}
	export class GitWorktree {
	    name: string;
	    branch: string;
	    repo: string;
	
	    static createFrom(source: any = {}) {
	        return new GitWorktree(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.branch = source["branch"];
	        this.repo = source["repo"];
	    }
	}
	export class ForegroundProcess {
	    name: string;
	    pid: number;
	    cwd: string;
	    worktree?: GitWorktree;
	
	    static createFrom(source: any = {}) {
	        return new ForegroundProcess(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.pid = source["pid"];
	        this.cwd = source["cwd"];
	        this.worktree = this.convertValues(source["worktree"], GitWorktree);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
	    }
	}
	export class GitDiff {
	    added: number;
	    removed: number;

	    static createFrom(source: any = {}) {
	        return new GitDiff(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.added = source["added"];
	        this.removed = source["removed"];
	    }
	}
	export class GitEntry {
	    path: string;
	    status: string;

	    static createFrom(source: any = {}) {
	        return new GitEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.status = source["status"];
	    }
	}
	export class ProcessOutput {
	    code?: number;
	    stdout: string;
	    stderr: string;
	    timed_out: boolean;
	    cancelled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProcessOutput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.stdout = source["stdout"];
	        this.stderr = source["stderr"];
	        this.timed_out = source["timed_out"];
	        this.cancelled = source["cancelled"];
	    }
	}
	export class PtyInfo {
	    backend: string;
	    buildNumber: number;

	    static createFrom(source: any = {}) {
	        return new PtyInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.backend = source["backend"];
	        this.buildNumber = source["buildNumber"];
	    }
	}
	export class SandboxInfo {
	    path: string;
	    files: number;
	
	    static createFrom(source: any = {}) {
	        return new SandboxInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.files = source["files"];
	    }
	}
	export class UpdateRelease {
	    hasUpdate: boolean;
	    latest: string;
	    current: string;
	    notes: string;
	    url: string;
	    downloadUrl: string;
	    downloadSize: number;
	    assetName: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateRelease(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasUpdate = source["hasUpdate"];
	        this.latest = source["latest"];
	        this.current = source["current"];
	        this.notes = source["notes"];
	        this.url = source["url"];
	        this.downloadUrl = source["downloadUrl"];
	        this.downloadSize = source["downloadSize"];
	        this.assetName = source["assetName"];
	    }
	}

}

