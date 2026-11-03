import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
//#region src/git-workspace/git.ts
/** Longest repository address accepted from the page. */
const MAX_URL_LENGTH = 2048;
/** Longest parent directory accepted from the page. */
const MAX_DIRECTORY_LENGTH = 1024;
/** Longest derived repository directory name. */
const MAX_REPOSITORY_NAME = 100;
/** How much git stderr travels back to the page as diagnostics. */
const MAX_DETAIL_LENGTH = 1200;
/** Bytes no address or directory may contain. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
/** Whitespace never belongs in a clone address. */
const WHITESPACE = /\s/;
/** Any `scheme://` prefix; the accepted schemes are checked separately. */
const SCHEME_URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
/** `git@host:path` — the SSH address form that carries no scheme. */
const SCP_LIKE = /^[^\s@/:]+@[^\s@/:]+:[^\s]+$/;
/** A drive-letter absolute path. */
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;
/** Characters Windows refuses in one path segment. */
const WINDOWS_FORBIDDEN = /[<>:"|?*]/;
/** Windows device names that cannot name a directory, with or without a suffix. */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
/**
* Read a value that may be a JSON object.
* @param value - raw decoded body.
* @returns the object, or undefined for every other JSON shape.
*/
function asRecord$2(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	return value;
}
/**
* Whether an address uses a form `git clone` can be asked to fetch.
*
* This is a shape check, not a reachability check: the Host never builds a
* shell command, so the only concern is that git receives one positional.
* @param value - trimmed address.
* @returns true for a supported scheme, `user@host:path`, or an absolute path.
*/
function isSupportedRepositoryAddress(value) {
	if (SCHEME_URL.test(value)) {
		const scheme = value.slice(0, value.indexOf(":")).toLowerCase();
		return scheme === "http" || scheme === "https" || scheme === "ssh" || scheme === "git" || scheme === "file";
	}
	if (SCP_LIKE.test(value)) return true;
	if (value.startsWith("/")) return true;
	return WINDOWS_ABSOLUTE.test(value);
}
/**
* Whether a directory is absolute in this build's two path dialects.
* @param value - trimmed parent directory.
* @returns true for a POSIX or Windows absolute path.
*/
function isAbsoluteDirectory(value) {
	return value.startsWith("/") || WINDOWS_ABSOLUTE.test(value) || value.startsWith("\\\\");
}
/**
* Take the final non-empty slash- or backslash-separated segment.
* @param value - a URL pathname, an SCP suffix, or a local path.
* @returns the final segment, or undefined when there is none.
*/
function lastSegment(value) {
	const parts = value.split(/[\\/]+/);
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index];
		if (part !== void 0 && part !== "") return part;
	}
}
/**
* Derive the directory `git clone` would create from an address.
*
* The Host passes an explicit target directory, so this name is the one
* invariant the page, the clone, and the Workspace title share. A name that
* could escape the chosen parent, hide as `.`/`..`, or trip a path dialect is
* refused instead of repaired.
* @param address - raw user-entered repository address.
* @returns a safe single-segment name, or undefined when none can be derived.
*/
function repositoryNameFromAddress(address) {
	const value = address.trim();
	if (value === "") return void 0;
	let candidate;
	if (SCHEME_URL.test(value)) {
		let pathname;
		try {
			pathname = new URL(value).pathname;
		} catch {
			return;
		}
		candidate = lastSegment(pathname);
	} else if (SCP_LIKE.test(value)) candidate = lastSegment(value.slice(value.indexOf(":") + 1));
	else candidate = lastSegment(value);
	if (candidate === void 0) return void 0;
	const name = candidate.replace(/\.git$/i, "");
	if (name === "" || name === "." || name === "..") return void 0;
	if (name.length > MAX_REPOSITORY_NAME) return void 0;
	if (name.startsWith("-")) return void 0;
	if (CONTROL_CHARACTERS.test(name) || WHITESPACE.test(name)) return void 0;
	if (WINDOWS_FORBIDDEN.test(name)) return void 0;
	if (/[. ]$/.test(name)) return void 0;
	if (WINDOWS_RESERVED.test(name)) return void 0;
	return name;
}
/**
* Validate and normalize one raw clone request body.
* @param input - decoded JSON body.
* @returns the request, or the first rejected field with a stable code.
*/
function parseCloneRequest(input) {
	const record = asRecord$2(input);
	if (record === void 0) return {
		ok: false,
		code: "invalid-request",
		message: "the request body must be a JSON object"
	};
	const rawUrl = record["url"];
	if (typeof rawUrl !== "string") return {
		ok: false,
		code: "invalid-request",
		message: "\"url\" must be a string"
	};
	const url = rawUrl.trim();
	if (url === "") return {
		ok: false,
		code: "invalid-url",
		message: "the repository address is required"
	};
	if (url.length > MAX_URL_LENGTH) return {
		ok: false,
		code: "invalid-url",
		message: "the repository address is too long"
	};
	if (CONTROL_CHARACTERS.test(url) || WHITESPACE.test(url)) return {
		ok: false,
		code: "invalid-url",
		message: "the repository address contains control or whitespace characters"
	};
	if (url.startsWith("-")) return {
		ok: false,
		code: "invalid-url",
		message: "the repository address must not start with \"-\""
	};
	if (!isSupportedRepositoryAddress(url)) return {
		ok: false,
		code: "unsupported-url",
		message: "use an https, ssh, git, file, git@host:path or absolute local address"
	};
	const rawParent = record["parentDir"];
	if (typeof rawParent !== "string") return {
		ok: false,
		code: "invalid-request",
		message: "\"parentDir\" must be a string"
	};
	const parentDir = rawParent.trim();
	if (parentDir === "") return {
		ok: false,
		code: "invalid-directory",
		message: "the parent directory is required"
	};
	if (parentDir.length > MAX_DIRECTORY_LENGTH) return {
		ok: false,
		code: "invalid-directory",
		message: "the parent directory is too long"
	};
	if (CONTROL_CHARACTERS.test(parentDir)) return {
		ok: false,
		code: "invalid-directory",
		message: "the parent directory contains control characters"
	};
	if (!isAbsoluteDirectory(parentDir)) return {
		ok: false,
		code: "invalid-directory",
		message: "the parent directory must be absolute"
	};
	const rawShallow = record["shallow"];
	const shallow = rawShallow === void 0 ? false : rawShallow;
	if (typeof shallow !== "boolean") return {
		ok: false,
		code: "invalid-request",
		message: "\"shallow\" must be a boolean"
	};
	return {
		ok: true,
		request: {
			url,
			parentDir,
			shallow
		}
	};
}
/**
* Return the parent directory of an absolute path.
*
* Used to propose where new repositories go: the parent of the most recently
* added Workspace is usually the reader's projects root, which is a better
* first suggestion than the deployment fallback (often the home directory).
* @param path - absolute file or directory path.
* @returns the parent path, or undefined when there is none to derive.
*/
function parentDirectoryOf(path) {
	const trimmed = path.replace(/[\\/]+$/, "");
	const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	if (separatorIndex <= 0) return void 0;
	const parent = trimmed.slice(0, separatorIndex);
	if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
	return parent;
}
/**
* Join the chosen parent and the derived repository name.
*
* The separator follows the Host's execution world, not the browser's, and a
* trailing separator on the parent never doubles.
* @param parentDir - validated absolute parent directory.
* @param name - validated single-segment repository name.
* @param platform - the subprocess seam's platform.
* @returns the absolute target directory for the clone.
*/
function joinTargetPath(parentDir, name, platform) {
	const separator = platform === "windows" ? "\\" : "/";
	const trimmed = parentDir.replace(/[\\/]+$/, "");
	if (trimmed === "") return `${separator}${name}`;
	return `${trimmed}${separator}${name}`;
}
/**
* Build the argv `ctx.subprocess.spawn` receives.
*
* The address and target are positional after `--`, so neither can be read as
* a git option even when a user pastes a leading dash.
* @param gitPath - resolved git executable.
* @param url - validated repository address.
* @param targetPath - absolute target directory.
* @param shallow - whether to request `--depth 1`.
* @returns argv with git as `argv[0]`.
*/
function cloneArgv(gitPath, url, targetPath, shallow) {
	return [
		gitPath,
		"clone",
		...shallow ? ["--depth", "1"] : [],
		"--",
		url,
		targetPath
	];
}
/**
* Map git stderr onto a stable failure code.
* @param stderr - collected git stderr text.
* @returns the code and a short English diagnosis.
*/
function classifyCloneFailure(stderr) {
	const text = stderr.toLowerCase();
	if (text.includes("already exists") || text.includes("file exists")) return {
		code: "target-exists",
		message: "the target path already exists"
	};
	if (/could not read username|terminal prompts disabled|authentication failed|permission denied \(publickey\)|host key verification failed|no such identity|publickey|returned error: 40[13]|access denied|forbidden/.test(text)) return {
		code: "authentication",
		message: "git authentication failed or the remote refused access"
	};
	if (text.includes("could not create work tree dir") || text.includes("cannot create directory") || text.includes("could not create leading directories") || text.includes("no such file or directory") || text.includes("permission denied")) return {
		code: "parent-missing",
		message: "the parent directory does not exist or is not writable"
	};
	if (/repository .* does not exist|repository not found|does not appear to be a git repository|remote: not found/.test(text)) return {
		code: "not-found",
		message: "the repository does not exist or is not accessible"
	};
	if (/could not resolve host|unable to access|failed to connect|connection timed out|connection refused|network is unreachable|operation timed out/.test(text)) return {
		code: "network",
		message: "the repository host could not be reached"
	};
	return {
		code: "clone-failed",
		message: "git clone exited with a failure"
	};
}
/**
* Keep the tail of git stderr, where git states the cause.
* @param stderr - collected stderr text.
* @returns the trimmed tail, or an empty string.
*/
function cloneFailureDetail(stderr) {
	const trimmed = stderr.trim();
	if (trimmed.length <= MAX_DETAIL_LENGTH) return trimmed;
	return `…${trimmed.slice(trimmed.length - MAX_DETAIL_LENGTH)}`;
}
/**
* Read a message off an unknown thrown value.
* @param error - value caught from a service call.
* @returns a printable message.
*/
function errorMessage(error) {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return String(error);
}
//#endregion
//#region src/git-workspace/host-http.ts
/** Largest JSON request body any route accepts. */
const MAX_BODY_BYTES = 16384;
/** Host names that only ever identify this machine. */
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"::1"
]);
/**
* Raise and format one JSON response; a closed connection is not an error.
* @param response - route response.
* @param status - HTTP status.
* @param value - JSON body.
*/
function sendJson$1(response, status, value) {
	const body = JSON.stringify(value);
	try {
		response.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			"content-length": new TextEncoder().encode(body).byteLength
		});
		response.end(body);
	} catch {}
}
/**
* Read one header value.
* @param request - incoming request.
* @param name - lower-case header name.
* @returns the first value, or undefined when absent.
*/
function headerValue(request, name) {
	const value = request.headers[name];
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value[0];
}
/**
* Whether one connection peer belongs to this machine.
* @param address - `socket.remoteAddress`.
* @returns true for IPv4/IPv6 loopback, including mapped IPv4.
*/
function isLoopbackAddress(address) {
	const value = address.toLowerCase();
	if (value.startsWith("::ffff:")) return isLoopbackAddress(value.slice(7));
	return value === "::1" || value === "127.0.0.1" || value.startsWith("127.");
}
/**
* Whether a request may reach one of this plugin's route families.
*
* The socket peer decides first: a LAN or public bind must not let a remote
* raw-HTTP client spoof a loopback Host header and drive git on this machine.
* @param request - incoming request.
* @returns true when the request is same-machine and same-origin.
*/
function isTrustedRequest(request) {
	const peer = request.socket?.remoteAddress;
	if (peer === void 0 || !isLoopbackAddress(peer)) return false;
	const host = headerValue(request, "host");
	if (host === void 0 || host === "") return false;
	const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1).replace(/^\[|\]$/g, "").toLowerCase() : host.replace(/:\d+$/, "").toLowerCase();
	if (!LOOPBACK_HOSTS.has(hostname)) return false;
	const origin = headerValue(request, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
/** Concatenate received request chunks. */
function concatChunks(chunks, totalBytes) {
	const merged = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged;
}
/**
* Read a bounded JSON request body. The web server has no body parser, so the
* route owns the stream.
* @param request - incoming request.
* @param maxBytes - largest accepted body; the command routes keep the 16 KiB
* default, while a route carrying file contents passes its own larger cap.
* @returns the decoded value, or a rejection message.
*/
async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
	return await new Promise((resolve) => {
		const chunks = [];
		let totalBytes = 0;
		let settled = false;
		const settle = (result) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};
		request.on("data", (chunk) => {
			if (settled) return;
			totalBytes += chunk.byteLength;
			if (totalBytes > maxBytes) {
				settle({
					ok: false,
					status: 413,
					message: "the request body is too large"
				});
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			if (settled) return;
			try {
				const text = new TextDecoder().decode(concatChunks(chunks, totalBytes)).trim();
				settle({
					ok: true,
					value: text === "" ? {} : JSON.parse(text)
				});
			} catch {
				settle({
					ok: false,
					status: 400,
					message: "the request body is not valid JSON"
				});
			}
		});
		request.on("close", () => {
			settle({
				ok: false,
				status: 400,
				message: "the request was closed before its body completed"
			});
		});
		request.on("aborted", () => {
			settle({
				ok: false,
				status: 400,
				message: "the request was aborted"
			});
		});
		request.on("error", () => {
			settle({
				ok: false,
				status: 400,
				message: "the request stream failed"
			});
		});
	});
}
//#endregion
//#region src/agent-instructions/model.ts
/**
* Shared vocabulary for the Agent instructions (AGENTS.md) tab.
*
* The product's `@deepseek-ai/dsh-agent-instructions` plugin discovers
* instruction files in a fixed, documented order and injects them into the
* model prompt from broadest to most specific:
*
* 1. user-global candidates — `~/.dsh/AGENTS.md` and `~/.agents/AGENTS.md`,
*    which form one candidate group for duplicate suppression;
* 2. the project chain — every directory from the resolved project root down to
*    the Session's current directory, each contributing `AGENTS.md`,
*    `CLAUDE.md`, then the local overlays `AGENTS.local.md` and
*    `CLAUDE.local.md`.
*
* A project root is the nearest ancestor of the Session cwd that holds the
* `.git` marker (the product's default marker), falling back to the cwd itself.
* Mutually identical files within one candidate group are rendered once, so a
* symlinked or byte-copied sibling does not repeat in the prompt.
*
* This module owns the wire vocabulary and the pure assembly rules both halves
* use. It stays platform-neutral — no Node imports — because the browser bundle
* imports it too: the Host half walks the filesystem and reads contents, then
* hands the discovered rows here, and the browser half renders the assembled
* state and the editor.
*
* @module dsh-session-map/agent-instructions/model
*/
/** Route family shared by the Host routes and the browser tab. */
const AGENT_INSTRUCTIONS_ROUTE = "/plugin-agent-instructions";
/** Largest instruction file this surface reads or writes, matching the product's source cap. */
const INSTRUCTION_FILE_MAX_BYTES = 1048576;
/** The file name of the user-global instruction file under each user root. */
const USER_GLOBAL_INSTRUCTION_FILE = "AGENTS.md";
/** Per-directory candidates that load before the local overlays, in discovery order. */
const BASE_INSTRUCTION_FILE_CANDIDATES = ["AGENTS.md", "CLAUDE.md"];
/** Per-directory local-overlay candidates, loaded after the base candidates. */
const LOCAL_INSTRUCTION_FILE_CANDIDATES = ["AGENTS.local.md", "CLAUDE.local.md"];
/** The two user-global roots, in injection order. */
const USER_ROOTS = [{
	id: "user:dsh-home",
	envName: "DSH_HOME",
	dirName: ".dsh",
	defaultDisplay: "~/.dsh"
}, {
	id: "user:agents-home",
	envName: "DSH_AGENTS_HOME",
	dirName: ".agents",
	defaultDisplay: "~/.agents"
}];
/** Directory names whose leading position would otherwise collide with a user-global scope. */
const RESERVED_SCOPE_DIRECTORIES = /* @__PURE__ */ new Set(["user-global", "agents-global"]);
/**
* Normalize a path to forward slashes for display and comparison.
* @param path - platform path.
* @returns the same path with every separator as `/`.
*/
function displayPathOf(path) {
	return path.replace(/\\/g, "/");
}
/**
* Shorten an absolute path under the OS home to a `~/…` display path.
* @param path - absolute host path.
* @param home - absolute OS home directory.
* @returns the shortened path, or the original when it is not under `home`.
*/
function shortenHomePath(path, home) {
	const target = displayPathOf(path);
	const root = displayPathOf(home).replace(/\/+$/, "");
	if (root === "") return path;
	if (target === root) return "~";
	return target.startsWith(`${root}/`) ? `~${target.slice(root.length)}` : path;
}
/**
* Keep a project-relative path out of the user-global display namespace.
*
* The product marks a project directory literally named `user-global` or
* `agents-global` with a leading `.` so its display path never reads as the
* user-global scope. Reusing the same rule keeps the tab's paths identical to
* the model-facing ones.
* @param relativePath - project-root-relative path.
* @returns the path, with a leading `.` when its first component collides.
*/
function escapeProjectDisplayPath(relativePath) {
	const normalized = displayPathOf(relativePath);
	const separator = normalized.indexOf("/");
	const first = separator < 0 ? normalized : normalized.slice(0, separator);
	return RESERVED_SCOPE_DIRECTORIES.has(first) ? `./${normalized}` : normalized;
}
/**
* Stable level id for one project-relative directory.
* @param relativeDir - root-relative directory; `.` or the empty string for the root.
* @returns `project:.` for the root, else `project:<relative dir>`.
*/
function projectLevelId(relativeDir) {
	const normalized = escapeProjectDisplayPath(relativeDir);
	return `project:${normalized === "" || normalized === "." ? "." : normalized}`;
}
/**
* Stable identity of one candidate file within a level.
* @param levelId - the level's stable id.
* @param name - candidate file name.
* @returns the id the file, save, and delete routes address.
*/
function instructionFileId(levelId, name) {
	return `${levelId}/${name}`;
}
/** Display title for one project chain level. */
function projectLevelTitle(relativeDir) {
	const normalized = displayPathOf(relativeDir);
	return normalized === "" || normalized === "." ? "项目根" : normalized;
}
/**
* Whether a candidate name is the local overlay rather than a base file.
* @param name - candidate file name.
* @returns true for `*.local.md` names.
*/
function instructionVariantOf(name) {
	return /\.local\.md$/i.test(name) ? "local" : "base";
}
/**
* Every candidate name of one project directory, in discovery order.
* @returns the base candidates followed by the local overlays.
*/
function projectCandidateNames() {
	return [...BASE_INSTRUCTION_FILE_CANDIDATES, ...LOCAL_INSTRUCTION_FILE_CANDIDATES];
}
/**
* Assign injection order and duplicate suppression over the discovered rows.
*
* The rules mirror the product: the two user-global roots form one candidate
* group, every project directory forms its own; within a group the first file
* with a given trimmed-content digest wins and later identical files are marked
* with the display path they duplicate. Files that are absent, skipped, or
* without a digest never take an order.
* @param discovered - every candidate, in injection order.
* @returns the same rows stamped with `order` or `duplicateOf`.
*/
function assignInjectionOrder(discovered) {
	const seenByGroup = /* @__PURE__ */ new Map();
	let nextOrder = 1;
	const summaries = [];
	for (const file of discovered) {
		const group = file.scope === "user" ? "user" : file.levelId;
		let seen = seenByGroup.get(group);
		if (seen === void 0) {
			seen = /* @__PURE__ */ new Map();
			seenByGroup.set(group, seen);
		}
		let order;
		let duplicateOf;
		if (file.exists && file.skipped === void 0 && file.digest !== void 0) {
			const earlier = seen.get(file.digest);
			if (earlier === void 0) {
				seen.set(file.digest, file.displayPath);
				order = nextOrder;
				nextOrder += 1;
			} else duplicateOf = earlier;
		}
		summaries.push({
			id: instructionFileId(file.levelId, file.name),
			scope: file.scope,
			levelId: file.levelId,
			name: file.name,
			variant: instructionVariantOf(file.name),
			displayPath: file.displayPath,
			absolutePath: file.absolutePath,
			exists: file.exists,
			size: file.size,
			modifiedAt: file.modifiedAt,
			...order === void 0 ? {} : { order },
			...duplicateOf === void 0 ? {} : { duplicateOf },
			...file.skipped === void 0 ? {} : { skipped: file.skipped }
		});
	}
	return summaries;
}
/**
* Assemble the state the tab renders from the Host's discovered rows.
* @param input - Session identity, roots, chain, and discovered candidates.
* @param generatedAt - ISO timestamp of the read.
* @returns the complete, ordered state.
*/
function assembleInstructionState(input, generatedAt) {
	const summaries = assignInjectionOrder(input.discovered);
	const byId = new Map(summaries.map((summary) => [summary.id, summary]));
	const userRoots = [];
	for (const root of input.userRoots) {
		const file = byId.get(instructionFileId(root.id, USER_GLOBAL_INSTRUCTION_FILE));
		if (file === void 0) continue;
		userRoots.push({
			...root,
			file
		});
	}
	const levels = input.levels.map((level) => ({
		...level,
		files: summaries.filter((summary) => summary.levelId === level.id)
	}));
	const effectiveCount = summaries.reduce((highest, summary) => summary.order !== void 0 && summary.order > highest ? summary.order : highest, 0);
	return {
		sessionId: input.sessionId,
		cwd: input.cwd,
		cwdDisplay: input.cwdDisplay,
		project: input.project,
		userRoots,
		levels,
		effectiveCount,
		generatedAt
	};
}
/**
* Every candidate in the state, user roots first, in injection order.
* @param state - assembled state.
* @returns the flattened, read-only list.
*/
function allInstructionFiles(state) {
	return [...state.userRoots.map((root) => root.file), ...state.levels.flatMap((level) => [...level.files])];
}
/**
* Find one candidate by its stable id.
* @param state - assembled state.
* @param id - candidate identity from the wire.
* @returns the matching row, or `undefined`.
*/
function findInstructionFile(state, id) {
	return allInstructionFiles(state).find((file) => file.id === id);
}
//#endregion
//#region src/agent-instructions/host.ts
/** Endpoint table: each sub-path accepts exactly one method. */
const ENDPOINT_METHODS = {
	"/state": "GET",
	"/file": "GET",
	"/save": "POST",
	"/delete": "POST"
};
/** Largest save body: the file cap with room for JSON escaping and the envelope. */
const SAVE_BODY_MAX_BYTES = 2162688;
/** Effect label the route registration is owned by. */
const ROUTE_EFFECT_LABEL = "agent-instructions: routes";
/**
* Map one failure code onto the HTTP status the route answers.
*
* `symlink-not-allowed` and `not-regular-file` are precondition conflicts rather
* than server faults: the client asked to replace something this surface must
* not touch, so they answer 409 like a stale digest.
* @param code - stable failure code.
* @returns the HTTP status.
*/
function statusFor$1(code) {
	switch (code) {
		case "not-trusted": return 403;
		case "bad-request":
		case "session-cwd-unavailable": return 400;
		case "session-not-found":
		case "unknown-file": return 404;
		case "conflict":
		case "symlink-not-allowed":
		case "not-regular-file": return 409;
		case "too-large": return 413;
		case "not-text": return 415;
		case "write-failed":
		case "delete-failed":
		case "internal": return 500;
	}
}
/** One route failure with its HTTP mapping, thrown by every Host operation. */
var InstructionHostError = class extends Error {
	/** Stable failure code shared with the browser half. */
	code;
	/** HTTP status the route answers. */
	status;
	constructor(code, message) {
		super(message);
		this.name = "InstructionHostError";
		this.code = code;
		this.status = statusFor$1(code);
	}
};
/**
* Read one optional service from the global store.
* @param ctx - the plugin's context.
* @param name - the service name.
* @returns the service as the caller's local interface, or `undefined`.
*/
function lookup$2(ctx, name) {
	return ctx.get(name);
}
/** Whether an unknown value is a non-null object record. */
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read one non-empty string value, or `undefined` when absent or blank. */
function nonEmptyString(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* Resolve one user root's directory and display label.
* @param definition - the product's root definition.
* @param env - environment to read the override from.
* @param base - OS home directory.
* @returns absolute directory plus symbolic label.
*/
function resolveUserRoot(definition, env, base) {
	const defaultHome = resolve(join(base, definition.dirName));
	const override = nonEmptyString(env[definition.envName]);
	const home = override === void 0 ? defaultHome : resolve(override);
	return {
		home,
		title: home === defaultHome ? definition.defaultDisplay : `$${definition.envName}`
	};
}
/**
* Resolve the two user-global instruction roots.
*
* The overrides behave like the product's `dsh-home-paths`: a set, non-blank
* `DSH_HOME`/`DSH_AGENTS_HOME` wins over `<home>/.dsh`/`<home>/.agents`, and
* the symbolic label only stays `~/.dsh`-style when the resolved directory is
* exactly the default one.
* @param env - environment to read; defaults to `process.env`.
* @param home - OS home directory; defaults to `os.homedir()`.
* @returns both roots with their display labels.
*/
function resolveInstructionHomes(env = process.env, home = homedir()) {
	const base = home.trim() === "" ? homedir() : home;
	const dshDefinition = USER_ROOTS[0];
	const agentsDefinition = USER_ROOTS[1];
	if (dshDefinition === void 0 || agentsDefinition === void 0) throw new InstructionHostError("internal", "用户级指令根定义缺失");
	const dsh = resolveUserRoot(dshDefinition, env, base);
	const agents = resolveUserRoot(agentsDefinition, env, base);
	return {
		dshHome: dsh.home,
		agentsHome: agents.home,
		dshTitle: dsh.title,
		agentsTitle: agents.title
	};
}
/**
* Build the model's user-root inputs from resolved homes, in injection order.
* @param homes - the resolved roots.
* @returns one input per root.
*/
function userRootInputs(homes) {
	return USER_ROOTS.map((definition) => {
		const isDsh = definition.id === "user:dsh-home";
		return {
			id: definition.id,
			title: isDsh ? homes.dshTitle : homes.agentsTitle,
			home: isDsh ? homes.dshHome : homes.agentsHome
		};
	});
}
/** SHA-1 of a string's trimmed content, the digest duplicate suppression uses. */
function sha1OfTrimmed(content) {
	return createHash("sha1").update(content.trim()).digest("hex");
}
/** SHA-1 of a file's exact text, the digest a save must match. */
function sha1Of(content) {
	return createHash("sha1").update(content).digest("hex");
}
/**
* Stat a path, reporting absence instead of throwing.
* @param path - absolute host path.
* @returns the stats, or `undefined` when the path is absent or unreadable.
*/
async function statOrUndefined(path) {
	try {
		return await stat(path);
	} catch {
		return;
	}
}
/**
* Whether a path exists, without distinguishing files from directories.
* @param path - absolute host path.
* @returns whether `stat` succeeded.
*/
async function pathExists$1(path) {
	return await statOrUndefined(path) !== void 0;
}
/**
* Resolve the project root the way the product does: the nearest ancestor (or
* the cwd itself) holding a `.git` marker, else the cwd.
* @param cwd - absolute Session working directory.
* @returns the root and whether a marker actually selected it.
*/
async function resolveProjectRoot$1(cwd) {
	const start = resolve(cwd);
	let current = start;
	for (;;) {
		if (await pathExists$1(join(current, ".git"))) return {
			root: current,
			hasMarker: true
		};
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return {
		root: start,
		hasMarker: false
	};
}
/**
* Build the chain from the project root down to the cwd inclusive.
* @param root - absolute project root.
* @param cwd - absolute Session working directory.
* @returns one level per directory, broadest first; the root's `relativeDir` is `.`.
*/
function buildChain(root, cwd) {
	const relativeDir = displayPathOf(relative(root, cwd));
	const parts = relativeDir === "" || relativeDir === "." ? [] : relativeDir.split("/");
	const levels = [];
	const push = (dir) => {
		const normalized = dir === "" ? "." : dir;
		levels.push({
			id: projectLevelId(normalized),
			title: projectLevelTitle(normalized),
			relativeDir: normalized,
			absolutePath: join(root, normalized)
		});
	};
	let current = "";
	push(current);
	for (const part of parts) {
		current = current === "" ? part : `${current}/${part}`;
		push(current);
	}
	return levels;
}
/**
* Read one candidate's metadata and, within the source cap, its digest.
*
* A missing path and a non-regular path both render as `exists: false`: the tab
* only offers an editor for a path it can replace with a regular file. An
* unreadable or oversized present file keeps its stat metadata so the row can
* still explain why the prompt ignores it.
* @param candidate - identity and absolute path of one candidate.
* @returns the discovered row.
*/
async function probeInstructionFile(candidate) {
	const info = await statOrUndefined(candidate.absolutePath);
	if (info === void 0 || !info.isFile()) return {
		...candidate,
		exists: false,
		size: null,
		modifiedAt: null
	};
	const metadata = {
		size: info.size,
		modifiedAt: info.mtime.toISOString()
	};
	if (info.size > 1048576) return {
		...candidate,
		exists: true,
		...metadata,
		skipped: "too-large"
	};
	try {
		const content = await readFile(candidate.absolutePath, "utf8");
		return {
			...candidate,
			exists: true,
			...metadata,
			digest: sha1OfTrimmed(content)
		};
	} catch {
		return {
			...candidate,
			exists: true,
			...metadata,
			skipped: "unreadable"
		};
	}
}
/**
* Discover every instruction candidate for one Session.
*
* The read follows the product's injection order: the two user roots first,
* then the project chain broadest first. Ordering and duplicate suppression are
* applied by the model's `assembleInstructionState`, not here.
* @param options - Session id, its cwd, the resolved homes, and an optional
* clock override for deterministic tests.
* @returns the assembled state the tab renders.
* @throws InstructionHostError with code `session-cwd-unavailable` when the cwd
* is not a directory.
*/
async function readInstructionState(options) {
	const cwd = resolve(options.cwd);
	const cwdInfo = await statOrUndefined(cwd);
	if (cwdInfo === void 0) throw new InstructionHostError("session-cwd-unavailable", `会话工作目录不存在：${cwd}`);
	if (!cwdInfo.isDirectory()) throw new InstructionHostError("session-cwd-unavailable", `会话工作目录不是目录：${cwd}`);
	const project = await resolveProjectRoot$1(cwd);
	const userRoots = userRootInputs(options.homes);
	const levels = buildChain(project.root, cwd);
	const discovered = [];
	for (const root of userRoots) discovered.push(await probeInstructionFile({
		levelId: root.id,
		scope: "user",
		name: USER_GLOBAL_INSTRUCTION_FILE,
		displayPath: `${root.title}/${USER_GLOBAL_INSTRUCTION_FILE}`,
		absolutePath: join(root.home, USER_GLOBAL_INSTRUCTION_FILE)
	}));
	const names = projectCandidateNames();
	for (const level of levels) {
		const prefix = level.relativeDir === "." ? "" : `${escapeProjectDisplayPath(level.relativeDir)}/`;
		for (const name of names) discovered.push(await probeInstructionFile({
			levelId: level.id,
			scope: "project",
			name,
			displayPath: `${prefix}${name}`,
			absolutePath: join(level.absolutePath, name)
		}));
	}
	const home = homedir();
	return assembleInstructionState({
		sessionId: options.sessionId,
		cwd,
		cwdDisplay: shortenHomePath(cwd, home),
		project: {
			root: project.root,
			display: shortenHomePath(project.root, home),
			hasMarker: project.hasMarker
		},
		userRoots,
		levels,
		discovered
	}, options.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString());
}
/**
* Find one candidate by id in the state, or fail with `unknown-file`.
* @param state - assembled state read for the same Session.
* @param id - candidate identity from the wire.
* @returns the matching state row.
*/
function requireFile(state, id) {
	const file = findInstructionFile(state, id);
	if (file === void 0) throw new InstructionHostError("unknown-file", `未知的指令文件：${id}`);
	return file;
}
/**
* Inspect a target path without following a final symlink.
*
* A write or delete must never follow a link out of the discovered directory,
* and a directory or device at the candidate path is not a file this surface
* may replace.
* @param path - absolute target path taken from the state row.
* @returns the target's size and permission bits, or `undefined` when absent.
* @throws InstructionHostError for a symlink or a non-regular file.
*/
async function inspectTarget(path) {
	let info;
	try {
		info = await lstat(path);
	} catch {
		return;
	}
	if (info.isSymbolicLink()) throw new InstructionHostError("symlink-not-allowed", `拒绝操作符号链接：${path}。请先手动处理该链接`);
	if (!info.isFile()) throw new InstructionHostError("not-regular-file", `目标不是普通文件：${path}`);
	return {
		size: info.size,
		mode: info.mode & 4095
	};
}
/**
* Write one file atomically: same-directory temp file, then rename over target.
*
* The temp name is random and is not a candidate file name, so a concurrent
* state read never reports it. An existing file's permission bits are copied
* onto the temp file before the rename, so the replacement keeps them.
* @param target - absolute target path taken from the state row.
* @param content - UTF-8 text to write.
* @param mode - permission bits to preserve, when the target already existed.
* @returns the written size in bytes and its fresh modification time.
* @throws InstructionHostError with code `write-failed` on any failure.
*/
async function writeAtomically(target, content, mode) {
	const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
	try {
		await writeFile(temp, content, "utf8");
		if (mode !== void 0) await chmod(temp, mode);
		await rename(temp, target);
	} catch (error) {
		await rm(temp, { force: true }).catch(() => void 0);
		throw new InstructionHostError("write-failed", `写入失败：${errorMessage(error)}`);
	}
	const size = Buffer.byteLength(content, "utf8");
	const info = await statOrUndefined(target);
	return {
		size,
		modifiedAt: info === void 0 ? (/* @__PURE__ */ new Date()).toISOString() : info.mtime.toISOString()
	};
}
/**
* Write one instruction file after re-deriving its path from the state.
*
* The id must address a row of the state the caller just read; the absolute
* path comes only from that row. A save with `expectedSha1` is an overwrite and
* only lands when the file still holds that exact content; a save without one
* is a create and only lands when the path is free.
* @param state - assembled state for the Session, read just before this call.
* @param request - candidate id, new content, and the digest the editor loaded.
* @returns the written file with fresh metadata and content.
* @throws InstructionHostError with a stable failure code.
*/
async function writeInstructionFile(state, request) {
	const file = requireFile(state, request.id);
	const size = Buffer.byteLength(request.content, "utf8");
	if (size > 1048576) throw new InstructionHostError("too-large", `内容超过 ${INSTRUCTION_FILE_MAX_BYTES} 字节上限：${size} 字节`);
	if (request.content.includes("\0")) throw new InstructionHostError("not-text", "内容包含 NUL 字符，不是文本文件");
	const target = file.absolutePath;
	const existing = await inspectTarget(target);
	if (request.expectedSha1 !== void 0) {
		if (existing === void 0) throw new InstructionHostError("conflict", "文件已被删除，请刷新后重试");
		if (existing.size > 1048576) throw new InstructionHostError("conflict", "文件已超过大小上限，无法覆盖");
		let current;
		try {
			current = await readFile(target, "utf8");
		} catch {
			throw new InstructionHostError("conflict", "无法读取当前内容，请刷新后重试");
		}
		if (sha1Of(current) !== request.expectedSha1) throw new InstructionHostError("conflict", "文件已被其他编辑器修改，请刷新后重试");
	} else if (existing !== void 0) throw new InstructionHostError("conflict", "文件已存在，请刷新后重试");
	if (file.scope === "user") try {
		await mkdir(dirname(target), { recursive: true });
	} catch (error) {
		throw new InstructionHostError("write-failed", `无法创建目录：${errorMessage(error)}`);
	}
	const written = await writeAtomically(target, request.content, existing?.mode);
	return {
		id: file.id,
		scope: file.scope,
		levelId: file.levelId,
		name: file.name,
		variant: file.variant,
		displayPath: file.displayPath,
		absolutePath: file.absolutePath,
		exists: true,
		size: written.size,
		modifiedAt: written.modifiedAt,
		content: request.content,
		sha1: sha1Of(request.content)
	};
}
/**
* Delete one instruction file after re-deriving its path from the state.
* @param state - assembled state for the Session, read just before this call.
* @param id - candidate identity from the wire.
* @throws InstructionHostError with a stable failure code.
*/
async function deleteInstructionFile(state, id) {
	const file = requireFile(state, id);
	const target = file.absolutePath;
	if (await inspectTarget(target) === void 0) throw new InstructionHostError("unknown-file", `指令文件已不存在：${file.displayPath}`);
	try {
		await unlink(target);
	} catch (error) {
		throw new InstructionHostError("delete-failed", `删除失败：${errorMessage(error)}`);
	}
}
/**
* Read the cwd projection of one Session observation.
*
* Observation results come from the product, which this repository does not
* type against, so every field is read defensively.
* @param observation - whatever `observeSession` returned.
* @returns the projected working directory, else the header cwd.
*/
function observedCwd(observation) {
	if (!isObject(observation)) return void 0;
	const projections = isObject(observation.projections) ? observation.projections : void 0;
	const values = projections !== void 0 && isObject(projections.values) ? projections.values : void 0;
	const header = isObject(observation.header) ? observation.header : void 0;
	return (values === void 0 ? void 0 : nonEmptyString(values.workingDirectory)) ?? (header === void 0 ? void 0 : nonEmptyString(header.cwd));
}
/**
* Release an observation's disposable, if it carries one.
*
* A dispose failure must never fail the read: the cwd has already been copied
* out by the time this runs.
* @param observation - whatever `observeSession` returned.
*/
function disposeObservation(observation) {
	if (!isObject(observation)) return;
	const dispose = observation[Symbol.dispose];
	if (typeof dispose !== "function") return;
	try {
		dispose.call(observation);
	} catch {}
}
/**
* Observe one Session, failing with `session-not-found` when the query service
* is absent or the observation throws.
* @param service - the `sessionQuery` capability, when composed.
* @param sessionId - Session to observe.
* @returns the observation result.
*/
async function observeSession(service, sessionId) {
	const observe = isObject(service) ? service.observeSession : void 0;
	if (typeof observe !== "function") throw new InstructionHostError("session-not-found", "会话查询服务不可用：当前组合没有挂载 sessionQuery");
	try {
		return await observe.call(service, sessionId);
	} catch (error) {
		throw new InstructionHostError("session-not-found", `读取会话失败：${errorMessage(error)}`);
	}
}
/**
* Read the live agent a Session owns, when the registry is composed.
* @param service - the `agents` capability.
* @param sessionId - Session to look up.
* @returns the live agent, or `undefined`.
*/
function liveAgentOf(service, sessionId) {
	if (!isObject(service)) return void 0;
	const get = service.get;
	if (typeof get !== "function") return void 0;
	try {
		return get.call(service, sessionId);
	} catch {
		return;
	}
}
/**
* Resolve one Session's working directory.
*
* Mirrors the product's session skill catalog: the projection wins over the
* header cwd, a live agent lets `workingDirectory.ensure` refine it, and the
* deployment default is the last resort. A disposable observation is released
* in a `finally` no matter which field read fails.
* @param services - optional `sessionQuery`, `workingDirectory` and `agents`.
* @param sessionId - Session to resolve.
* @returns the absolute working directory.
* @throws InstructionHostError with code `session-not-found` when the Session
* cannot be observed, or `session-cwd-unavailable` when no cwd is available.
*/
async function resolveSessionCwd(services, sessionId) {
	const observation = await observeSession(services.sessionQuery, sessionId);
	let observed;
	try {
		if (observation === void 0 || observation === null) throw new InstructionHostError("session-not-found", `会话不存在：${sessionId}`);
		observed = observedCwd(observation);
	} finally {
		disposeObservation(observation);
	}
	let cwd = observed;
	const workingDirectory = isObject(services.workingDirectory) ? services.workingDirectory : void 0;
	const agent = liveAgentOf(services.agents, sessionId);
	const ensure = workingDirectory === void 0 ? void 0 : workingDirectory.ensure;
	if (agent !== void 0 && typeof ensure === "function") try {
		const text = nonEmptyString(await ensure.call(workingDirectory, agent));
		if (text !== void 0) cwd = text;
	} catch {}
	if (cwd === void 0) cwd = workingDirectory === void 0 ? void 0 : nonEmptyString(workingDirectory.defaultDirectory);
	if (cwd === void 0) throw new InstructionHostError("session-cwd-unavailable", `无法确定会话工作目录：${sessionId}`);
	return cwd;
}
/**
* Read one file body for the editor.
* @param state - assembled state for the Session.
* @param id - candidate identity from the wire.
* @returns the state row plus content and the digest a save must match.
* @throws InstructionHostError for an unknown, symlinked, non-regular, or
* oversized file.
*/
async function readInstructionFile(state, id) {
	const file = requireFile(state, id);
	const target = file.absolutePath;
	let info;
	try {
		info = await lstat(target);
	} catch {
		throw new InstructionHostError("unknown-file", `指令文件已不存在：${file.displayPath}`);
	}
	if (info.isSymbolicLink()) throw new InstructionHostError("symlink-not-allowed", `拒绝读取符号链接：${file.displayPath}`);
	if (!info.isFile()) throw new InstructionHostError("not-regular-file", `目标不是普通文件：${file.displayPath}`);
	if (info.size > 1048576) throw new InstructionHostError("too-large", `文件超过 ${INSTRUCTION_FILE_MAX_BYTES} 字节上限：${file.displayPath}`);
	let content;
	try {
		content = await readFile(target, "utf8");
	} catch (error) {
		throw new InstructionHostError("internal", `读取指令文件失败：${errorMessage(error)}`);
	}
	return {
		...file,
		content,
		sha1: sha1Of(content)
	};
}
/**
* Raise one failure envelope; Chinese-first like the rest of the plugin.
* @param response - route response.
* @param status - HTTP status.
* @param code - stable failure code.
* @param message - explanation for the page.
*/
function sendFailure(response, status, code, message) {
	sendJson$1(response, status, {
		ok: false,
		error: {
			code,
			message
		}
	});
}
/**
* Map a thrown value onto the failure envelope the page renders.
* @param response - route response.
* @param error - the thrown value.
*/
function sendFromError(response, error) {
	if (error instanceof InstructionHostError) {
		sendFailure(response, error.status, error.code, error.message);
		return;
	}
	sendFailure(response, 500, "internal", errorMessage(error));
}
/**
* Read one required string field from a JSON request body.
* @param source - the parsed body.
* @param key - field name.
* @returns the trimmed, non-empty value.
* @throws InstructionHostError with code `bad-request` when absent or blank.
*/
function requiredField(source, key) {
	const value = nonEmptyString(source[key]);
	if (value === void 0) throw new InstructionHostError("bad-request", `缺少 ${key} 字段`);
	return value;
}
/**
* Read one text field from a JSON request body; an empty string is valid.
* @param source - the parsed body.
* @param key - field name.
* @returns the field value.
* @throws InstructionHostError with code `bad-request` when absent or not a string.
*/
function textField(source, key) {
	const value = source[key];
	if (typeof value !== "string") throw new InstructionHostError("bad-request", `${key} 字段必须是字符串`);
	return value;
}
/**
* Read one optional string field from a JSON request body.
* @param source - the parsed body.
* @param key - field name.
* @returns the value, or `undefined` when absent or blank.
* @throws InstructionHostError with code `bad-request` when present but not a string.
*/
function optionalField(source, key) {
	const value = source[key];
	if (value === void 0) return void 0;
	if (typeof value !== "string") throw new InstructionHostError("bad-request", `${key} 字段必须是字符串`);
	return nonEmptyString(value);
}
/**
* Read a request body and require a JSON object.
* @param request - incoming request.
* @param maxBytes - largest accepted body.
* @returns the parsed body record.
* @throws InstructionHostError with code `bad-request` or `too-large`.
*/
async function readBodyRecord(request, maxBytes) {
	const result = await readJsonBody(request, maxBytes);
	if (!result.ok) {
		if (result.status === 413) throw new InstructionHostError("too-large", "请求体超过大小上限");
		throw new InstructionHostError("bad-request", "请求体不是合法的 JSON 对象");
	}
	if (!isObject(result.value)) throw new InstructionHostError("bad-request", "请求体必须是 JSON 对象");
	return result.value;
}
/**
* Read the Session id from a query string.
* @param url - the request URL.
* @returns the Session id.
* @throws InstructionHostError with code `bad-request` when absent.
*/
function querySessionId(url) {
	return requiredField({ sessionId: url.searchParams.get("sessionId") }, "sessionId");
}
/**
* Read the candidate id from a query string.
* @param url - the request URL.
* @returns the candidate id.
* @throws InstructionHostError with code `bad-request` when absent.
*/
function queryFileId(url) {
	return requiredField({ id: url.searchParams.get("id") }, "id");
}
/**
* Read the three optional capabilities the routes use, per request.
* @param ctx - the plugin's context.
* @returns whatever the composition currently mounts.
*/
function instructionServices(ctx) {
	return {
		sessionQuery: lookup$2(ctx, "sessionQuery"),
		workingDirectory: lookup$2(ctx, "workingDirectory"),
		agents: lookup$2(ctx, "agents")
	};
}
/**
* Read the state one request works against.
* @param ctx - the plugin's context.
* @param sessionId - Session from the request.
* @returns the assembled state.
*/
async function readStateFor(ctx, sessionId) {
	return await readInstructionState({
		sessionId,
		cwd: await resolveSessionCwd(instructionServices(ctx), sessionId),
		homes: resolveInstructionHomes()
	});
}
/**
* Answer one route request.
*
* The sub-path selects both the operation and its only accepted method, so a
* wrong method is answered with 405 before any service or filesystem work.
* @param ctx - the plugin's context.
* @param request - incoming request.
* @param response - route response.
*/
async function dispatch(ctx, request, response) {
	const url = new URL(request.url ?? "/", "http://localhost");
	const method = (request.method ?? "GET").toUpperCase();
	const subpath = url.pathname.startsWith(`/plugin-agent-instructions/`) ? url.pathname.slice(26) : url.pathname;
	const expected = ENDPOINT_METHODS[subpath];
	if (expected === void 0) {
		sendFailure(response, 404, "bad-request", `未知的接口：${method} ${url.pathname}`);
		return;
	}
	if (method !== expected) {
		sendFailure(response, 405, "bad-request", `该接口只接受 ${expected} 请求`);
		return;
	}
	switch (subpath) {
		case "/state":
			sendJson$1(response, 200, {
				ok: true,
				state: await readStateFor(ctx, querySessionId(url))
			});
			return;
		case "/file": {
			const sessionId = querySessionId(url);
			const id = queryFileId(url);
			sendJson$1(response, 200, {
				ok: true,
				file: await readInstructionFile(await readStateFor(ctx, sessionId), id)
			});
			return;
		}
		case "/save": {
			const body = await readBodyRecord(request, SAVE_BODY_MAX_BYTES);
			const sessionId = requiredField(body, "sessionId");
			const id = requiredField(body, "id");
			const content = textField(body, "content");
			const expectedSha1 = optionalField(body, "expectedSha1");
			sendJson$1(response, 200, {
				ok: true,
				file: await writeInstructionFile(await readStateFor(ctx, sessionId), {
					id,
					content,
					...expectedSha1 === void 0 ? {} : { expectedSha1 }
				})
			});
			return;
		}
		case "/delete": {
			const body = await readBodyRecord(request);
			const sessionId = requiredField(body, "sessionId");
			const id = requiredField(body, "id");
			await deleteInstructionFile(await readStateFor(ctx, sessionId), id);
			sendJson$1(response, 200, { ok: true });
			return;
		}
		default: throw new InstructionHostError("bad-request", `未知的接口：${method} ${url.pathname}`);
	}
}
/**
* Install the Agent instructions routes.
*
* Call this from a context that provides `webServer`; `sessionQuery`,
* `workingDirectory` and `agents` stay optional capabilities read per request,
* so a thin composition answers a clear envelope instead of failing at apply
* time.
* @param ctx - plugin context carrying the web server.
*/
function installAgentInstructionsHost(ctx) {
	const webServer = lookup$2(ctx, "webServer");
	if (webServer === void 0) return;
	const handler = async (request, response) => {
		if (!isTrustedRequest(request)) {
			sendFailure(response, 403, "not-trusted", "仅允许本机同源请求访问指令文件");
			return;
		}
		try {
			await dispatch(ctx, request, response);
		} catch (error) {
			sendFromError(response, error);
		}
	};
	ctx.effect(() => webServer.register({
		kind: "prefix",
		path: AGENT_INSTRUCTIONS_ROUTE,
		handler
	}), ROUTE_EFFECT_LABEL);
}
//#endregion
//#region src/git-workspace/route.ts
/**
* The route family shared by the Git workspace settings page and the Git tool
* window.
* @module dsh-session-map/git-workspace/route
*/
const GIT_WORKSPACE_ROUTE = "/plugin-git-workspace";
//#endregion
//#region src/git-workspace/host-clone.ts
/** One clone may run at a time; the page disables its button, but curls exist. */
const CLONE_TIMEOUT_MS = 9e5;
/** How much stdout/stderr one clone keeps in memory. */
const MAX_OUTPUT_BYTES = 262144;
/** Grace period handed to the subprocess provider on termination. */
const GRACE_MS = 5e3;
/**
* Read the platform the clone must build paths for.
* @param subprocess - the subprocess seam.
* @returns the seam's platform, defaulting to POSIX when it cannot report one.
*/
async function readPlatform$1(subprocess) {
	try {
		return (await subprocess.terminalEnvironment()).platform === "windows" ? "windows" : "posix";
	} catch {
		return "posix";
	}
}
/**
* Build one failure response body.
* @param code - stable failure code.
* @param message - short English diagnosis.
* @param detail - optional path or collected stderr.
* @returns the clone envelope.
*/
function cloneFailure(code, message, detail) {
	return detail === void 0 || detail === "" ? {
		ok: false,
		error: {
			code,
			message
		}
	} : {
		ok: false,
		error: {
			code,
			message,
			detail
		}
	};
}
/** Status code paired with one clone failure. */
function cloneFailureStatus(code) {
	switch (code) {
		case "invalid-request":
		case "invalid-url":
		case "unsupported-url":
		case "invalid-directory":
		case "parent-missing": return 400;
		case "busy":
		case "target-exists":
		case "workspace-failed": return 409;
		case "not-found": return 404;
		case "authentication": return 401;
		case "network": return 502;
		case "timeout": return 504;
		default: return 500;
	}
}
/** One clone failure as an HTTP result. */
function failureResult(code, message, detail) {
	return {
		status: cloneFailureStatus(code),
		body: cloneFailure(code, message, detail)
	};
}
/**
* Install the Clone-from-Git handler and its Workspace registration.
* @param deps - the subprocess seam and the Workspace registry.
* @returns the route handler; it claims `/state` and `/clone` only.
*/
function createCloneHandler(deps) {
	const { subprocess, workspaces, workingDirectory } = deps;
	let cloning = false;
	/** Report the two facts the page needs before it can offer a clone. */
	const readState = async () => {
		let git;
		try {
			git = {
				available: true,
				path: await subprocess.resolveExecutable("git")
			};
		} catch {
			git = { available: false };
		}
		const newestWorkspace = workspaces.list()[0];
		const defaultParentDir = (newestWorkspace === void 0 ? void 0 : parentDirectoryOf(newestWorkspace.path)) ?? (typeof workingDirectory?.defaultDirectory === "string" ? workingDirectory.defaultDirectory : null);
		return {
			ok: true,
			git,
			defaultParentDir
		};
	};
	/**
	* Validate one request, clone into the derived target, then add the Workspace.
	* The directory is the operation's only lasting side effect when Workspace
	* registration fails, so that failure reports the path instead of hiding it.
	*/
	const runClone = async (body, response) => {
		if (cloning) return {
			status: 409,
			body: cloneFailure("busy", "another clone is already running")
		};
		cloning = true;
		try {
			return await cloneOnce(body, response);
		} finally {
			cloning = false;
		}
	};
	/** One clone attempt; runs only while the single-clone lock is held. */
	const cloneOnce = async (body, response) => {
		const parsed = parseCloneRequest(body);
		if (!parsed.ok) return failureResult(parsed.code, parsed.message);
		const { url, parentDir, shallow } = parsed.request;
		const repoName = repositoryNameFromAddress(url);
		if (repoName === void 0) return failureResult("invalid-url", "no usable directory name can be derived from the repository address");
		const controller = new AbortController();
		let timedOut = false;
		let abortedByClient = false;
		let finished = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort(/* @__PURE__ */ new Error("git clone timed out"));
		}, CLONE_TIMEOUT_MS);
		const onClose = () => {
			if (finished) return;
			abortedByClient = true;
			controller.abort(/* @__PURE__ */ new Error("the settings page closed the clone request"));
		};
		response.on("close", onClose);
		try {
			const targetPath = joinTargetPath(parentDir, repoName, await readPlatform$1(subprocess));
			let gitPath;
			try {
				gitPath = await subprocess.resolveExecutable("git");
			} catch (error) {
				return failureResult("git-not-found", "the git executable was not found on this machine", errorMessage(error));
			}
			let handle;
			try {
				handle = subprocess.spawn({
					argv: cloneArgv(gitPath, url, targetPath, shallow),
					cwd: parentDir,
					stdio: {
						stdin: "ignore",
						stdout: { maxBytes: MAX_OUTPUT_BYTES },
						stderr: { maxBytes: MAX_OUTPUT_BYTES }
					},
					graceMs: GRACE_MS,
					signal: controller.signal,
					env: { GIT_TERMINAL_PROMPT: "0" }
				});
			} catch (error) {
				return failureResult("clone-failed", "the git process could not be started", errorMessage(error));
			}
			let outcome;
			try {
				outcome = await handle.done;
			} catch (error) {
				if (timedOut) return failureResult("timeout", "git clone exceeded the time limit", targetPath);
				if (abortedByClient) return {
					status: 499,
					body: cloneFailure("clone-failed", "the client aborted the clone request")
				};
				const message = errorMessage(error);
				return /ENOENT|no such file or directory/i.test(message) ? failureResult("parent-missing", "the parent directory does not exist", message) : failureResult("clone-failed", "git clone could not start", message);
			}
			const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
			const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
			if (outcome.exitCode === 0) try {
				const workspace = await workspaces.create(targetPath);
				return {
					status: 200,
					body: {
						ok: true,
						repoName,
						targetPath,
						workspace: {
							id: String(workspace.id),
							path: workspace.path,
							title: workspace.title
						}
					}
				};
			} catch (error) {
				return failureResult("workspace-failed", "the repository was cloned but the workspace could not be added", `${targetPath}\n${errorMessage(error)}`);
			}
			if (timedOut) return failureResult("timeout", "git clone exceeded the time limit", cloneFailureDetail(stderr || stdout));
			if (abortedByClient) return {
				status: 499,
				body: cloneFailure("clone-failed", "the client aborted the clone request")
			};
			const failure = classifyCloneFailure(stderr);
			return failureResult(failure.code, failure.message, cloneFailureDetail(stderr || stdout));
		} finally {
			finished = true;
			clearTimeout(timer);
		}
	};
	return async (request, response, url, method) => {
		if (url.pathname === `/plugin-git-workspace/state`) {
			if (method !== "GET") {
				sendJson$1(response, 405, {
					ok: false,
					error: {
						code: "method-not-allowed",
						message: "use GET"
					}
				});
				return true;
			}
			sendJson$1(response, 200, await readState());
			return true;
		}
		if (url.pathname === `/plugin-git-workspace/clone`) {
			if (method !== "POST") {
				sendJson$1(response, 405, {
					ok: false,
					error: {
						code: "method-not-allowed",
						message: "use POST"
					}
				});
				return true;
			}
			if (!(request.headers["content-type"] ?? "").toString().toLowerCase().includes("application/json")) {
				sendJson$1(response, 415, {
					ok: false,
					error: {
						code: "unsupported-media-type",
						message: "use application/json"
					}
				});
				return true;
			}
			const body = await readJsonBody(request);
			if (!body.ok) {
				sendJson$1(response, body.status, cloneFailure("invalid-request", body.message));
				return true;
			}
			const result = await runClone(body.value, response);
			sendJson$1(response, result.status, result.body);
			return true;
		}
		return false;
	};
}
//#endregion
//#region src/git-workspace/git-command.ts
/** Environment every git invocation inherits from the Host. */
const GIT_BASE_ENV = {
	LC_ALL: "C",
	LANG: "C",
	LANGUAGE: "C",
	GIT_TERMINAL_PROMPT: "0",
	GIT_PAGER: "cat",
	PAGER: "cat",
	GIT_LITERAL_PATHSPECS: "1",
	GIT_MERGE_AUTOEDIT: "no",
	GIT_EDITOR: ":",
	GIT_SEQUENCE_EDITOR: ":"
};
/** Read invocations additionally never take an optional lock. */
const GIT_READ_ENV = {
	...GIT_BASE_ENV,
	GIT_OPTIONAL_LOCKS: "0"
};
/** Write invocations keep their locks but still fail instead of opening an editor. */
const GIT_WRITE_ENV = { ...GIT_BASE_ENV };
/** `for-each-ref` field layout; fields are NUL separated, refs newline separated. */
const FOR_EACH_REF_FORMAT = [
	"%(refname)",
	"%(refname:short)",
	"%(objectname)",
	"%(objecttype)",
	"%(upstream:short)",
	"%(upstream:track)",
	"%(HEAD)",
	"%(committerdate:iso-strict)",
	"%(contents:subject)"
].join("%00");
/** `log` field layout; records are NUL separated, fields `%x1f` separated. */
const LOG_FORMAT = [
	"%H",
	"%h",
	"%P",
	"%an",
	"%ae",
	"%ad",
	"%cn",
	"%ce",
	"%cd",
	"%D",
	"%s"
].join("%x1f");
/** Commit metadata format used by the detail route. */
const COMMIT_META_FORMAT = [
	"%H",
	"%h",
	"%P",
	"%an",
	"%ae",
	"%ad",
	"%cn",
	"%ce",
	"%cd",
	"%D",
	"%s",
	"%B"
].join("%x1f");
/** Common display directives every invocation carries. */
const DISPLAY_CONFIG = [
	"-c",
	"core.quotepath=false",
	"-c",
	"color.ui=false",
	"-c",
	"core.pager=cat"
];
/** Read-only directives: no pager, no optional locks, no signature checks. */
const READ_DIRECTIVES = [
	"--no-pager",
	"--no-optional-locks",
	...DISPLAY_CONFIG,
	"-c",
	"log.showSignature=false",
	"-c",
	"i18n.logOutputEncoding=UTF-8"
];
/** Write directives: no pager; an accidental editor request fails instead of hanging. */
const WRITE_DIRECTIVES = [
	"--no-pager",
	...DISPLAY_CONFIG,
	"-c",
	"core.editor=false",
	"-c",
	"sequence.editor=false"
];
/**
* Build one read invocation.
* @param gitPath - resolved absolute git executable.
* @param root - repository root as cwd.
* @param args - subcommand plus its arguments.
* @param options - timeout and output overrides.
* @returns the invocation.
*/
function readInvocation(gitPath, root, args, options = {}) {
	return {
		argv: [
			gitPath,
			"-C",
			root,
			...READ_DIRECTIVES,
			...args
		],
		cwd: root,
		env: GIT_READ_ENV,
		timeoutMs: options.timeoutMs ?? 1e4,
		maxBytes: options.maxBytes ?? 2097152,
		label: options.label ?? args[0] ?? "git"
	};
}
/**
* Build one write invocation.
* @param gitPath - resolved absolute git executable.
* @param root - repository root as cwd.
* @param args - subcommand plus its arguments.
* @param options - timeout and output overrides.
* @returns the invocation.
*/
function writeInvocation(gitPath, root, args, options = {}) {
	return {
		argv: [
			gitPath,
			"-C",
			root,
			...WRITE_DIRECTIVES,
			...args
		],
		cwd: root,
		env: GIT_WRITE_ENV,
		timeoutMs: options.timeoutMs ?? 6e4,
		maxBytes: options.maxBytes ?? 2097152,
		label: options.label ?? args[0] ?? "git"
	};
}
/** Repository probe arguments; output order matches this list. */
function repoProbeArgs() {
	return [
		"rev-parse",
		"--is-inside-work-tree",
		"--show-toplevel",
		"--show-prefix",
		"--is-bare-repository",
		"--absolute-git-dir",
		"--git-common-dir"
	];
}
/** `status --porcelain=v2 -z` with the branch and stash headers. */
function statusArgs(untracked) {
	return [
		"status",
		"--porcelain=v2",
		"-z",
		"--branch",
		"--show-stash",
		`--untracked-files=${untracked}`
	];
}
/** `for-each-ref` over heads, remotes and tags. */
function forEachRefArgs() {
	return [
		"for-each-ref",
		`--format=${FOR_EACH_REF_FORMAT}`,
		"refs/heads",
		"refs/remotes",
		"refs/tags"
	];
}
/** `rev-parse --git-path` for each marker file. */
function gitPathArgs(names) {
	const args = ["rev-parse"];
	for (const name of names) args.push("--git-path", name);
	return args;
}
/** `remote -v`. */
function remoteVerboseArgs() {
	return ["remote", "-v"];
}
/** `log` page arguments. */
function logArgs(params) {
	const args = ["log"];
	if (params.allBranches === true) args.push("--all");
	else args.push(params.ref ?? "HEAD");
	args.push(`--max-count=${params.limit}`, `--skip=${params.skip}`, "--date=iso-strict", "-z", `--format=${LOG_FORMAT}`);
	if (params.query !== void 0 && params.query !== "") args.push(`--grep=${params.query}`, "--regexp-ignore-case", "--fixed-strings");
	if (params.author !== void 0 && params.author !== "") args.push(`--author=${params.author}`);
	if (params.since !== void 0 && params.since !== "") args.push(`--since=${params.since}`);
	if (params.until !== void 0 && params.until !== "") args.push(`--until=${params.until}`);
	if (params.file !== void 0) args.push("--", params.file);
	return args;
}
/** `show -s` commit metadata. */
function commitMetaArgs(hash) {
	return [
		"show",
		"-s",
		"-z",
		`--format=${COMMIT_META_FORMAT}`,
		hash
	];
}
/** `show --first-parent --name-status`; the only reliable file list for merges. */
function commitFilesArgs(hash) {
	return [
		"show",
		"--first-parent",
		"--format=",
		"--name-status",
		"-z",
		"-M",
		hash
	];
}
/** `show --first-parent --numstat`. */
function commitNumstatArgs(hash) {
	return [
		"show",
		"--first-parent",
		"--format=",
		"--numstat",
		"-z",
		"-M",
		hash
	];
}
/** Files changed between the merge base of `base` and HEAD (push preview). */
function rangeFilesArgs(base) {
	return [
		"diff",
		"--name-status",
		"-z",
		"-M",
		`${base}...HEAD`
	];
}
/** Line stats between the merge base of `base` and HEAD (push preview). */
function rangeNumstatArgs(base) {
	return [
		"diff",
		"--numstat",
		"-z",
		"-M",
		`${base}...HEAD`
	];
}
/** Resolve one ref to its commit id for a read-only comparison. */
function verifyRefArgs(ref) {
	return [
		"rev-parse",
		"--verify",
		`${ref}^{commit}`
	];
}
/** The current branch's upstream ref, or a failing exit when none is set. */
function upstreamRefArgs() {
	return [
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{upstream}"
	];
}
/** Branches and remote branches whose tip contains the commit. */
function containsArgs(hash) {
	return [
		"for-each-ref",
		"--contains",
		hash,
		"--format=%(refname:short)",
		"refs/heads",
		"refs/remotes"
	];
}
/** `rev-parse --verify <hash>^{commit}` for a hash-prefix search. */
function verifyCommitArgs(value) {
	return [
		"rev-parse",
		"--verify",
		`${value}^{commit}`
	];
}
/** Diff arguments for a commit, the index or the working tree. */
function diffArgs(params) {
	const common = [
		"--no-color",
		"--no-ext-diff",
		"--no-textconv",
		`--unified=${params.context}`
	];
	if (params.hash !== void 0 && params.from !== void 0) return [
		"diff",
		...common,
		params.from,
		params.hash,
		"--",
		params.file
	];
	if (params.hash !== void 0) return [
		"show",
		"--format=",
		"--patch",
		...common,
		params.hash,
		"--",
		params.file
	];
	return [
		"diff",
		...params.staged === true ? ["--cached"] : [],
		...common,
		"--",
		params.file
	];
}
/**
* Redact credentials embedded in a URL-like argv element.
* @param value - one argv element.
* @returns the element with any `user:secret@` part replaced.
*/
function redactArg(value) {
	return value.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@\s]+@/, "$1***@");
}
/**
* Redact one finished receipt before it reaches the browser console.
* @param argv - spawned argv.
* @returns a redacted copy.
*/
function redactArgv(argv) {
	return argv.map(redactArg);
}
/**
* Build one console receipt.
* @param invocation - executed invocation.
* @param exitCode - finished exit code.
* @param ms - elapsed milliseconds.
* @param flags - cancellation/truncation facts.
* @returns the redacted receipt.
*/
function receiptOf(invocation, exitCode, ms, flags = {}) {
	return {
		argv: redactArgv(invocation.argv),
		cwd: invocation.cwd,
		exitCode,
		ms,
		...flags.cancelled === true ? { cancelled: true } : {},
		...flags.truncated === true ? { truncated: true } : {}
	};
}
//#endregion
//#region src/git-workspace/git-parse.ts
/** Split a NUL-terminated record stream, reporting a missing final terminator. */
function nulRecords(text) {
	if (text === "") return {
		records: [],
		truncated: false
	};
	const complete = text.endsWith("\0");
	const records = text.split("\0");
	if (complete) records.pop();
	return {
		records,
		truncated: !complete
	};
}
/**
* Take `count` space-separated fields starting at `offset`, leaving the rest.
* Paths may contain spaces, so the tail is never split again.
* @param record - one line/record.
* @param offset - index of the first field.
* @param count - number of fields to take.
* @returns the fields and the remaining tail, or undefined when short.
*/
function takeFields(record, offset, count) {
	const fields = [];
	let cursor = offset;
	for (let index = 0; index < count; index += 1) {
		const space = record.indexOf(" ", cursor);
		if (space < 0) return void 0;
		fields.push(record.slice(cursor, space));
		cursor = space + 1;
	}
	return {
		fields,
		rest: record.slice(cursor)
	};
}
/** Normalize a porcelain `X`/`Y` letter to a display status. */
function statusOf(letter) {
	switch (letter) {
		case "A": return "A";
		case "D": return "D";
		case "R": return "R";
		case "C": return "C";
		case "T": return "T";
		case "U": return "U";
		default: return "M";
	}
}
/**
* Parse `rev-parse --is-inside-work-tree --show-toplevel …`.
* @param text - command stdout.
* @returns the parsed facts, or undefined when git printed an unexpected shape.
*/
function parseRepoProbe(text) {
	const lines = text.split("\n");
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	if (lines.length !== 6) return void 0;
	const [inside, topLevel, prefix, bare, gitDir, commonDir] = lines;
	return {
		insideWorkTree: inside.trim() === "true",
		topLevel: topLevel.trim(),
		prefix: prefix.trim(),
		bare: bare.trim() === "true",
		gitDir: gitDir.trim(),
		commonDir: commonDir.trim()
	};
}
/**
* Parse `status --porcelain=v2 -z --branch --show-stash`.
* @param text - command stdout.
* @returns head facts plus one entry per staged/unstaged/untracked/conflicted row.
*/
function parseStatusV2(text) {
	const { records, truncated: streamTruncated } = nulRecords(text);
	let oid = null;
	let branch = null;
	let upstream = null;
	let ahead = 0;
	let behind = 0;
	let stashCount = 0;
	let detached = false;
	let unborn = false;
	const changes = [];
	let truncated = streamTruncated;
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (record.startsWith("# branch.oid ")) {
			const value = record.slice(13);
			if (value === "(initial)") unborn = true;
			else oid = value;
			continue;
		}
		if (record.startsWith("# branch.head ")) {
			const value = record.slice(14);
			if (value === "(detached)") detached = true;
			else branch = value;
			continue;
		}
		if (record.startsWith("# branch.upstream ")) {
			upstream = record.slice(18);
			continue;
		}
		if (record.startsWith("# branch.ab ")) {
			const match = /^\+(\d+)\s+-(\d+)$/.exec(record.slice(12));
			if (match !== null) {
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
			continue;
		}
		if (record.startsWith("# stash ")) {
			stashCount = Number(record.slice(8)) || 0;
			continue;
		}
		if (record.startsWith("1 ")) {
			const parsed = takeFields(record, 2, 7);
			if (parsed === void 0) {
				truncated = true;
				break;
			}
			const [xy, , , , , ,] = parsed.fields;
			pushOrdinary(changes, parsed.rest, xy);
			continue;
		}
		if (record.startsWith("2 ")) {
			const parsed = takeFields(record, 2, 8);
			const oldPath = records[index + 1];
			if (parsed === void 0 || oldPath === void 0) {
				truncated = true;
				break;
			}
			index += 1;
			const [xy] = parsed.fields;
			pushRenamed(changes, parsed.rest, oldPath, xy);
			continue;
		}
		if (record.startsWith("u ")) {
			const parsed = takeFields(record, 2, 9);
			if (parsed === void 0) {
				truncated = true;
				break;
			}
			const [xy] = parsed.fields;
			changes.push({
				path: parsed.rest,
				xy: {
					index: xy.charAt(0),
					worktree: xy.charAt(1)
				},
				kind: "unmerged",
				group: "conflict",
				status: "U"
			});
			continue;
		}
		if (record.startsWith("? ")) {
			const path = record.slice(2);
			if (path !== "") changes.push({
				path,
				xy: {
					index: ".",
					worktree: "?"
				},
				kind: "untracked",
				group: "untracked",
				status: "?"
			});
			continue;
		}
		if (record.startsWith("! ")) continue;
	}
	return {
		head: {
			oid,
			branch,
			upstream,
			ahead,
			behind,
			stashCount,
			detached,
			unborn
		},
		changes,
		truncated
	};
}
/** Push the staged/unstaged rows one ordinary porcelain entry describes. */
function pushOrdinary(changes, path, xy) {
	const indexLetter = xy.charAt(0);
	const worktreeLetter = xy.charAt(1);
	if (indexLetter !== "." && indexLetter !== " ") changes.push({
		path,
		xy: {
			index: indexLetter,
			worktree: worktreeLetter
		},
		kind: "ordinary",
		group: "staged",
		status: statusOf(indexLetter)
	});
	if (worktreeLetter !== "." && worktreeLetter !== " ") changes.push({
		path,
		xy: {
			index: indexLetter,
			worktree: worktreeLetter
		},
		kind: "ordinary",
		group: "unstaged",
		status: statusOf(worktreeLetter)
	});
}
/** Push the staged/unstaged rows one rename/copy porcelain entry describes. */
function pushRenamed(changes, path, oldPath, xy) {
	const indexLetter = xy.charAt(0);
	const worktreeLetter = xy.charAt(1);
	if (indexLetter !== "." && indexLetter !== " ") changes.push({
		path,
		oldPath,
		xy: {
			index: indexLetter,
			worktree: worktreeLetter
		},
		kind: "renamed",
		group: "staged",
		status: statusOf(indexLetter)
	});
	if (worktreeLetter !== "." && worktreeLetter !== " ") changes.push({
		path,
		oldPath,
		xy: {
			index: indexLetter,
			worktree: worktreeLetter
		},
		kind: "renamed",
		group: "unstaged",
		status: statusOf(worktreeLetter)
	});
}
/** Parse one `%(upstream:track)` value. */
function parseTrack(value) {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	if (trimmed === "[gone]" || trimmed === "gone") return {
		ahead: 0,
		behind: 0,
		gone: true
	};
	return {
		ahead: Number(/ahead (\d+)/.exec(trimmed)?.[1] ?? 0),
		behind: Number(/behind (\d+)/.exec(trimmed)?.[1] ?? 0),
		gone: false
	};
}
/**
* Parse `for-each-ref` output from {@link FOR_EACH_REF_FORMAT}.
* @param text - command stdout.
* @returns every local branch, remote ref and tag.
*/
function parseForEachRef(text) {
	const refs = [];
	let truncated = false;
	for (const line of text.split("\n")) {
		if (line === "") continue;
		const fields = line.split("\0");
		if (fields.length < 9) {
			truncated = true;
			continue;
		}
		const [ref, name, oid, , upstream, track, head, date, subject] = fields;
		let type;
		if (ref.startsWith("refs/heads/")) type = "local";
		else if (ref.startsWith("refs/remotes/")) type = "remote";
		else if (ref.startsWith("refs/tags/")) type = "tag";
		else continue;
		refs.push({
			ref,
			name,
			oid,
			type,
			isHead: head.trim() === "*",
			upstream: upstream === "" ? null : upstream,
			track: parseTrack(track),
			date,
			subject: subject.slice(0, 200)
		});
	}
	return {
		refs,
		truncated
	};
}
/**
* Parse `remote -v` into one row per remote (fetch URL).
* @param text - command stdout.
* @returns the configured remotes.
*/
function parseRemoteVerbose(text) {
	const remotes = /* @__PURE__ */ new Map();
	for (const line of text.split("\n")) {
		const match = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line);
		if (match === null) continue;
		const name = match[1];
		const url = match[2];
		const kind = match[3];
		if (name === void 0 || url === void 0) continue;
		if (kind === "fetch" && !remotes.has(name)) remotes.set(name, url);
	}
	return [...remotes.entries()].map(([name, url]) => ({
		name,
		url
	}));
}
/** Split `%D` into display tokens and categorized refs. */
function parseDecorations(value) {
	const tokens = value.split(",").map((token) => token.trim()).filter((token) => token !== "");
	const branches = [];
	const remoteBranches = [];
	const tags = [];
	for (const token of tokens) {
		if (token.startsWith("tag: ")) {
			tags.push(token.slice(5));
			continue;
		}
		if (token.startsWith("HEAD -> ")) {
			branches.push(token.slice(8));
			continue;
		}
		if (token === "HEAD") continue;
		if (token.includes("/")) remoteBranches.push(token);
		else branches.push(token);
	}
	return {
		decorations: tokens,
		refs: {
			branches,
			remoteBranches,
			tags
		}
	};
}
/**
* Parse a `log -z --format` page.
* @param text - command stdout.
* @returns commit rows in git order.
*/
function parseLogZ(text) {
	const { records, truncated: streamTruncated } = nulRecords(text);
	const commits = [];
	let truncated = streamTruncated;
	for (const record of records) {
		const fields = record.split("");
		if (fields.length < 11) {
			truncated = true;
			break;
		}
		const [oid, shortOid, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, decorations, subject] = fields;
		commits.push({
			oid,
			shortOid,
			parents: parents === "" ? [] : parents.split(" "),
			author: {
				name: authorName,
				email: authorEmail,
				date: authorDate
			},
			committer: {
				name: committerName,
				email: committerEmail,
				date: committerDate
			},
			subject,
			...parseDecorations(decorations)
		});
	}
	return {
		commits,
		truncated
	};
}
/**
* Parse `show -s -z --format` for one commit.
* @param text - command stdout.
* @returns the row plus the full commit message.
*/
function parseCommitMeta(text) {
	const { records } = nulRecords(text);
	const record = records[0];
	if (record === void 0) return void 0;
	const fields = record.split("");
	if (fields.length < 12) return void 0;
	const [oid, shortOid, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, decorations, subject, message] = fields;
	return {
		commit: {
			oid,
			shortOid,
			parents: parents === "" ? [] : parents.split(" "),
			author: {
				name: authorName,
				email: authorEmail,
				date: authorDate
			},
			committer: {
				name: committerName,
				email: committerEmail,
				date: committerDate
			},
			subject,
			...parseDecorations(decorations)
		},
		message
	};
}
/**
* Parse `show --first-parent --name-status -z`.
* @param text - command stdout.
* @returns changed files with null line counts.
*/
function parseNameStatusZ(text) {
	const { records, truncated: streamTruncated } = nulRecords(text);
	const files = [];
	let truncated = streamTruncated;
	for (let index = 0; index < records.length; index += 1) {
		const status = records[index];
		if (status === "") continue;
		const letter = status.charAt(0);
		if (letter === "R" || letter === "C") {
			const oldPath = records[index + 1];
			const path = records[index + 2];
			if (oldPath === void 0 || path === void 0) {
				truncated = true;
				break;
			}
			index += 2;
			files.push({
				path,
				oldPath,
				status: letter,
				additions: null,
				deletions: null,
				binary: false
			});
			continue;
		}
		const path = records[index + 1];
		if (path === void 0) {
			truncated = true;
			break;
		}
		index += 1;
		files.push({
			path,
			status: letter,
			additions: null,
			deletions: null,
			binary: false
		});
	}
	return {
		files,
		truncated
	};
}
/**
* Parse `show --first-parent --numstat -z`.
* @param text - command stdout.
* @returns one row per file in the same order as the name-status list.
*/
function parseNumstatZ(text) {
	const { records, truncated: streamTruncated } = nulRecords(text);
	const entries = [];
	let truncated = streamTruncated;
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (record === "") continue;
		const parts = record.split("	");
		if (parts.length < 3) {
			truncated = true;
			break;
		}
		const [additionsText, deletionsText, pathText] = parts;
		const binary = additionsText === "-" || deletionsText === "-";
		const additions = binary ? null : Number(additionsText);
		const deletions = binary ? null : Number(deletionsText);
		if (pathText === "") {
			const oldPath = records[index + 1];
			const path = records[index + 2];
			if (oldPath === void 0 || path === void 0) {
				truncated = true;
				break;
			}
			index += 2;
			entries.push({
				path,
				oldPath,
				additions,
				deletions,
				binary
			});
			continue;
		}
		entries.push({
			path: pathText,
			additions,
			deletions,
			binary
		});
	}
	return {
		entries,
		truncated
	};
}
/** One `git rev-parse --git-path` output. */
function parseGitPathLines(text) {
	return text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}
/**
* Zip a name-status list with its numstat list, which git prints in the same order.
* @param files - name-status rows.
* @param stats - numstat rows.
* @returns file rows with line counts and binary flags.
*/
function mergeFileStats(files, stats) {
	return files.map((file, index) => {
		const stat = stats[index];
		if (stat === void 0) return file;
		return {
			...file,
			additions: stat.additions,
			deletions: stat.deletions,
			binary: stat.binary
		};
	});
}
//#endregion
//#region src/git-workspace/git-repo.ts
/** Longest repository-relative path the plugin accepts. */
const MAX_PATH_LENGTH = 4096;
/** Longest git ref name git itself allows. */
const MAX_REF_LENGTH = 255;
/** Characters git forbids inside a ref name. */
const REF_FORBIDDEN = /[\u0000-\u0020~^:?*[\\\u007f]/;
/**
* Convert either path dialect to the `/` form git reports.
* @param value - raw path.
* @returns a slash-separated path.
*/
function toPosixPath(value) {
	return value.replace(/\\/g, "/");
}
/**
* Normalize one repository-relative path and refuse anything that could leave
* the repository.
* @param input - user- or protocol-supplied path.
* @returns the normalized POSIX path, or the first rejection.
*/
function normalizeRepoRelativePath(input) {
	if (typeof input !== "string") return {
		ok: false,
		message: "a path must be a string"
	};
	const value = input.trim();
	if (value === "") return {
		ok: false,
		message: "a path is required"
	};
	if (value.length > MAX_PATH_LENGTH) return {
		ok: false,
		message: "the path is too long"
	};
	if (/[\u0000-\u001f\u007f]/.test(value)) return {
		ok: false,
		message: "the path contains control characters"
	};
	if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) return {
		ok: false,
		message: "the path must be relative to the repository root"
	};
	const parts = toPosixPath(value).split("/");
	const stack = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (stack.length === 0) return {
				ok: false,
				message: "the path escapes the repository root"
			};
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	if (stack.length === 0) return {
		ok: false,
		message: "the path does not name a repository entry"
	};
	return {
		ok: true,
		path: stack.join("/")
	};
}
/**
* Whether a path is the parent directory itself or one of its descendants.
* @param parent - absolute directory.
* @param child - absolute path.
* @param platform - execution world.
* @returns true when `child` is inside `parent`.
*/
function isPathInside(parent, child, platform) {
	const root = toPosixPath(parent).replace(/\/+$/, "");
	const target = toPosixPath(child).replace(/\/+$/, "");
	const caseFold = platform === "windows" ? (value) => value.toLowerCase() : (value) => value;
	const foldedRoot = caseFold(root);
	const foldedTarget = caseFold(target);
	if (foldedTarget === foldedRoot) return true;
	return foldedTarget.startsWith(`${foldedRoot}/`);
}
/**
* Pre-check a branch or tag name. The Host still runs
* `git check-ref-format --branch <name>` before creating refs; this function
* only keeps obviously invalid names out of the argv builder.
* @param input - user-supplied ref name.
* @returns true when the shape is acceptable.
*/
function isSafeRefName(input) {
	if (typeof input !== "string") return false;
	const value = input.trim();
	if (value === "" || value.length > MAX_REF_LENGTH) return false;
	if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
	if (value.endsWith(".") || value.endsWith(".lock")) return false;
	if (value.includes("//") || value.includes("..") || value.includes("@{")) return false;
	if (value === "@") return false;
	return !REF_FORBIDDEN.test(value);
}
/**
* Pre-check one commit-ish hash or hash prefix.
* @param input - candidate hash.
* @returns true for 4–40 hexadecimal characters.
*/
function isSafeHash(input) {
	return typeof input === "string" && /^[0-9a-fA-F]{4,40}$/.test(input);
}
/**
* Pre-check one remote name.
* @param input - candidate remote.
* @returns true for a name git can address.
*/
function isSafeRemoteName(input) {
	return typeof input === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(input);
}
//#endregion
//#region src/git-workspace/host-errors.ts
/** One route failure with its HTTP mapping. */
var RouteFailure = class extends Error {
	code;
	status;
	detail;
	constructor(code, status, message, detail) {
		super(message);
		this.name = "RouteFailure";
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
};
/** Map one failure code onto an HTTP status. */
function statusFor(code) {
	switch (code) {
		case "invalid-request":
		case "invalid-path":
		case "invalid-ref":
		case "unsupported-action": return 400;
		case "workspace-not-found": return 404;
		case "not-a-repository": return 200;
		case "busy":
		case "lock":
		case "conflict":
		case "stash-conflict":
		case "branch-not-merged":
		case "branch-checked-out":
		case "dirty-worktree":
		case "no-upstream":
		case "push-rejected":
		case "hook-failed":
		case "detached-head":
		case "safe-directory": return 409;
		case "auth-required": return 401;
		case "git-not-found":
		case "parse-failed":
		case "internal": return 500;
		case "network": return 502;
		case "timeout": return 504;
		case "cancelled": return 499;
		default: return 500;
	}
}
/**
* Map git stderr onto a stable route failure.
* @param stderr - collected stderr.
* @param exitCode - finished exit code.
* @returns the failure with its HTTP status.
*/
function classifyFailure(stderr, exitCode) {
	const text = stderr.toLowerCase();
	if (text.includes("detected dubious ownership")) return new RouteFailure("safe-directory", 409, "the repository owner does not match the current user", stderr);
	if (text.includes("index.lock") || text.includes("another git process")) return new RouteFailure("lock", 409, "another git process is operating the repository", stderr);
	if (/authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|host key verification failed/.test(text)) return new RouteFailure("auth-required", 401, "git authentication failed", stderr);
	if (/could not resolve host|unable to access|failed to connect|connection timed out|network is unreachable/.test(text)) return new RouteFailure("network", 502, "the remote host could not be reached", stderr);
	if (text.includes("has no upstream branch")) return new RouteFailure("no-upstream", 409, "the branch has no upstream", stderr);
	if (/would be overwritten|your local changes|commit your changes or stash/.test(text)) return new RouteFailure("dirty-worktree", 409, "the working tree has changes that would be overwritten", stderr);
	if (text.includes("not fully merged")) return new RouteFailure("conflict", 409, "the branch is not fully merged", stderr);
	if (/unknown revision|not a valid object name|did not match any/.test(text)) return new RouteFailure("invalid-ref", 400, "the requested ref does not exist", stderr);
	return new RouteFailure("internal", 500, `git exited with ${String(exitCode)}`, stderr);
}
/**
* Write one route failure as JSON.
* @param response - route response.
* @param failure - the classified failure.
*/
function sendRouteFailure(response, failure) {
	sendJson$1(response, failure.status, {
		ok: false,
		error: {
			code: failure.code,
			message: failure.message,
			...failure.detail === void 0 || failure.detail === "" ? {} : { detail: failure.detail.slice(-4096) }
		}
	});
}
//#endregion
//#region src/git-workspace/git-actions.ts
/** Policy for every action the panel exposes. */
const ACTION_POLICY = {
	stage: {
		level: "l1",
		requiresConfirmation: false,
		summary: "暂存文件"
	},
	unstage: {
		level: "l1",
		requiresConfirmation: false,
		summary: "取消暂存"
	},
	discard: {
		level: "l2",
		requiresConfirmation: true,
		summary: "丢弃更改"
	},
	commit: {
		level: "l1",
		requiresConfirmation: false,
		summary: "提交"
	},
	push: {
		level: "l1",
		requiresConfirmation: false,
		summary: "推送"
	},
	checkout: {
		level: "l1",
		requiresConfirmation: false,
		summary: "检出分支"
	},
	createBranch: {
		level: "l1",
		requiresConfirmation: false,
		summary: "新建分支"
	},
	deleteBranch: {
		level: "l2",
		requiresConfirmation: true,
		summary: "删除分支"
	},
	renameBranch: {
		level: "l1",
		requiresConfirmation: false,
		summary: "重命名分支"
	},
	fetch: {
		level: "l1",
		requiresConfirmation: false,
		summary: "获取远端更新"
	},
	update: {
		level: "l1",
		requiresConfirmation: false,
		summary: "更新当前分支"
	},
	merge: {
		level: "l1",
		requiresConfirmation: false,
		summary: "合并分支"
	},
	rebase: {
		level: "l1",
		requiresConfirmation: false,
		summary: "变基当前分支"
	},
	reset: {
		level: "l2",
		requiresConfirmation: true,
		summary: "重置当前分支"
	},
	revert: {
		level: "l1",
		requiresConfirmation: false,
		summary: "撤销提交"
	},
	cherryPick: {
		level: "l1",
		requiresConfirmation: false,
		summary: "拣选提交"
	},
	abortOperation: {
		level: "l1",
		requiresConfirmation: false,
		summary: "中止当前操作"
	},
	stashPush: {
		level: "l1",
		requiresConfirmation: false,
		summary: "搁置更改"
	},
	stashPop: {
		level: "l1",
		requiresConfirmation: false,
		summary: "弹出搁置"
	},
	stashDrop: {
		level: "l2",
		requiresConfirmation: true,
		summary: "删除搁置"
	},
	tagCreate: {
		level: "l1",
		requiresConfirmation: false,
		summary: "创建标签"
	},
	tagDelete: {
		level: "l2",
		requiresConfirmation: true,
		summary: "删除标签"
	},
	continueOperation: {
		level: "l1",
		requiresConfirmation: false,
		summary: "继续当前操作"
	}
};
/**
* Policy for one concrete action; the lease-forced push is the L3 variant of the
* otherwise L1 push, so policy cannot be keyed by kind alone.
* @param action - parsed action.
* @returns the effective policy.
*/
function policyFor(action) {
	if (action.kind === "push" && action.forceWithLease === true) return {
		level: "l3",
		requiresConfirmation: true,
		summary: "强制推送（--force-with-lease）"
	};
	return ACTION_POLICY[action.kind];
}
/** Longest commit message accepted. */
const MAX_MESSAGE_LENGTH = 5e3;
/** Largest path batch one action may carry. */
const MAX_PATHS = 1e3;
/** Read a value that may be a JSON object. */
function asRecord$1(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	return value;
}
/** Read one repository-relative path array. */
function readPaths(value, field) {
	if (!Array.isArray(value)) return {
		ok: false,
		message: `"${field}" must be an array of paths`
	};
	if (value.length > MAX_PATHS) return {
		ok: false,
		message: `"${field}" has too many paths`
	};
	const paths = [];
	for (const entry of value) {
		const normalized = normalizeRepoRelativePath(entry);
		if (!normalized.ok) return {
			ok: false,
			message: `${field}: ${normalized.message}`
		};
		paths.push(normalized.path);
	}
	return {
		ok: true,
		paths
	};
}
/** Validate the workspace id shared by every action. */
function readWorkspace(record) {
	const value = record["workspaceId"];
	if (typeof value !== "string" || value.trim() === "" || value.length > 200) return void 0;
	return value.trim();
}
/**
* Parse one raw `/action` (or `/confirm`) body.
* @param input - decoded JSON.
* @returns the typed action, or the first rejected field.
*/
function parseActionRequest(input) {
	const record = asRecord$1(input);
	if (record === void 0) return {
		ok: false,
		code: "invalid-request",
		message: "the request body must be a JSON object"
	};
	const workspaceId = readWorkspace(record);
	if (workspaceId === void 0) return {
		ok: false,
		code: "invalid-request",
		message: "\"workspaceId\" must be a non-empty string"
	};
	const kind = record["kind"];
	switch (kind) {
		case "stage":
		case "unstage": {
			const paths = readPaths(record["paths"], "paths");
			if (!paths.ok) return {
				ok: false,
				code: "invalid-path",
				message: paths.message
			};
			if (paths.paths.length === 0) return {
				ok: false,
				code: "invalid-request",
				message: "at least one path is required"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					paths: paths.paths
				}
			};
		}
		case "discard": {
			const tracked = readPaths(record["tracked"] ?? [], "tracked");
			if (!tracked.ok) return {
				ok: false,
				code: "invalid-path",
				message: tracked.message
			};
			const untracked = readPaths(record["untracked"] ?? [], "untracked");
			if (!untracked.ok) return {
				ok: false,
				code: "invalid-path",
				message: untracked.message
			};
			if (tracked.paths.length === 0 && untracked.paths.length === 0) return {
				ok: false,
				code: "invalid-request",
				message: "at least one path is required"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					tracked: tracked.paths,
					untracked: untracked.paths
				}
			};
		}
		case "commit": {
			const message = record["message"];
			if (typeof message !== "string" || message.trim() === "") return {
				ok: false,
				code: "invalid-request",
				message: "a commit message is required"
			};
			if (message.length > MAX_MESSAGE_LENGTH) return {
				ok: false,
				code: "invalid-request",
				message: "the commit message is too long"
			};
			if (/[\u0000]/.test(message)) return {
				ok: false,
				code: "invalid-request",
				message: "the commit message contains a NUL character"
			};
			const amend = record["amend"] === void 0 ? false : record["amend"];
			if (typeof amend !== "boolean") return {
				ok: false,
				code: "invalid-request",
				message: "\"amend\" must be a boolean"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					message,
					amend
				}
			};
		}
		case "push": {
			const remote = record["remote"];
			const branch = record["branch"];
			const setUpstream = record["setUpstream"] === void 0 ? false : record["setUpstream"];
			const forceWithLease = record["forceWithLease"] === void 0 ? false : record["forceWithLease"];
			if (typeof setUpstream !== "boolean") return {
				ok: false,
				code: "invalid-request",
				message: "\"setUpstream\" must be a boolean"
			};
			if (typeof forceWithLease !== "boolean") return {
				ok: false,
				code: "invalid-request",
				message: "\"forceWithLease\" must be a boolean"
			};
			if (remote !== void 0 && !isSafeRemoteName(remote)) return {
				ok: false,
				code: "invalid-request",
				message: "the remote name is not valid"
			};
			if (branch !== void 0 && !isSafeRefName(branch)) return {
				ok: false,
				code: "invalid-ref",
				message: "the branch name is not valid"
			};
			if (setUpstream && (remote === void 0 || branch === void 0)) return {
				ok: false,
				code: "invalid-request",
				message: "setting an upstream needs both remote and branch"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					...remote === void 0 ? {} : { remote },
					...branch === void 0 ? {} : { branch },
					...setUpstream ? { setUpstream: true } : {},
					...forceWithLease ? { forceWithLease: true } : {}
				}
			};
		}
		case "checkout": {
			const ref = record["ref"];
			if (typeof ref !== "string" || !isSafeRefName(ref)) return {
				ok: false,
				code: "invalid-ref",
				message: "the branch name is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					ref
				}
			};
		}
		case "createBranch": {
			const name = record["name"];
			if (typeof name !== "string" || !isSafeRefName(name)) return {
				ok: false,
				code: "invalid-ref",
				message: "the branch name is not valid"
			};
			const start = record["start"];
			if (start !== void 0 && (typeof start !== "string" || !isSafeRefName(start))) return {
				ok: false,
				code: "invalid-ref",
				message: "the branch start point is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					name,
					...start === void 0 ? {} : { start }
				}
			};
		}
		case "deleteBranch": {
			const name = record["name"];
			if (typeof name !== "string" || !isSafeRefName(name)) return {
				ok: false,
				code: "invalid-ref",
				message: "the branch name is not valid"
			};
			const force = record["force"] === void 0 ? false : record["force"];
			if (typeof force !== "boolean") return {
				ok: false,
				code: "invalid-request",
				message: "\"force\" must be a boolean"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					name,
					force
				}
			};
		}
		case "renameBranch": {
			const from = record["from"];
			const to = record["to"];
			if (typeof from !== "string" || !isSafeRefName(from) || typeof to !== "string" || !isSafeRefName(to)) return {
				ok: false,
				code: "invalid-ref",
				message: "the branch name is not valid"
			};
			if (from === to) return {
				ok: false,
				code: "invalid-request",
				message: "the new name equals the old name"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					from,
					to
				}
			};
		}
		case "fetch": {
			const all = record["all"] === void 0 ? true : record["all"];
			if (typeof all !== "boolean") return {
				ok: false,
				code: "invalid-request",
				message: "\"all\" must be a boolean"
			};
			const remote = record["remote"];
			if (remote !== void 0 && !isSafeRemoteName(remote)) return {
				ok: false,
				code: "invalid-request",
				message: "the remote name is not valid"
			};
			if (!all && remote === void 0) return {
				ok: false,
				code: "invalid-request",
				message: "a remote is required when not fetching all remotes"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					all,
					...remote === void 0 ? {} : { remote }
				}
			};
		}
		case "update": {
			const mode = record["mode"];
			if (mode !== "merge" && mode !== "rebase") return {
				ok: false,
				code: "invalid-request",
				message: "\"mode\" must be \"merge\" or \"rebase\""
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					mode
				}
			};
		}
		case "merge": {
			const ref = record["ref"];
			if (typeof ref !== "string" || !isSafeRefName(ref) && !isSafeHash(ref)) return {
				ok: false,
				code: "invalid-ref",
				message: "the ref is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					ref
				}
			};
		}
		case "rebase": {
			const onto = record["onto"];
			if (typeof onto !== "string" || !isSafeRefName(onto) && !isSafeHash(onto)) return {
				ok: false,
				code: "invalid-ref",
				message: "the ref is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					onto
				}
			};
		}
		case "reset": {
			const hash = record["hash"];
			if (typeof hash !== "string" || !isSafeHash(hash)) return {
				ok: false,
				code: "invalid-ref",
				message: "the commit hash is not valid"
			};
			const mode = record["mode"] === void 0 ? "mixed" : record["mode"];
			if (mode !== "soft" && mode !== "mixed" && mode !== "hard") return {
				ok: false,
				code: "invalid-request",
				message: "\"mode\" must be \"soft\", \"mixed\" or \"hard\""
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					hash,
					mode
				}
			};
		}
		case "revert":
		case "cherryPick": {
			const hash = record["hash"];
			if (typeof hash !== "string" || !isSafeHash(hash)) return {
				ok: false,
				code: "invalid-ref",
				message: "the commit hash is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					hash
				}
			};
		}
		case "abortOperation": {
			const operation = record["operation"];
			if (operation !== "merge" && operation !== "rebase" && operation !== "cherry-pick" && operation !== "revert") return {
				ok: false,
				code: "invalid-request",
				message: "the operation is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					operation
				}
			};
		}
		case "stashPush": {
			const message = record["message"];
			if (message !== void 0 && (typeof message !== "string" || message.length > 200 || /[\u0000]/.test(message))) return {
				ok: false,
				code: "invalid-request",
				message: "the stash message is not valid"
			};
			const includeUntracked = record["includeUntracked"] === void 0 ? false : record["includeUntracked"];
			if (typeof includeUntracked !== "boolean") return {
				ok: false,
				code: "invalid-request",
				message: "\"includeUntracked\" must be a boolean"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					includeUntracked,
					...message === void 0 || message.trim() === "" ? {} : { message }
				}
			};
		}
		case "stashPop":
		case "stashDrop": {
			const ref = record["ref"];
			if (ref !== void 0 && (typeof ref !== "string" || !/^stash@\{\d+\}$/.test(ref))) return {
				ok: false,
				code: "invalid-ref",
				message: "the stash reference is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					...ref === void 0 ? {} : { ref }
				}
			};
		}
		case "tagCreate": {
			const name = record["name"];
			if (typeof name !== "string" || !isSafeRefName(name)) return {
				ok: false,
				code: "invalid-ref",
				message: "the tag name is not valid"
			};
			const hash = record["hash"];
			if (hash !== void 0 && (typeof hash !== "string" || !isSafeHash(hash))) return {
				ok: false,
				code: "invalid-ref",
				message: "the tag target is not valid"
			};
			const message = record["message"];
			if (message !== void 0 && (typeof message !== "string" || message.length > 500 || /[\u0000]/.test(message))) return {
				ok: false,
				code: "invalid-request",
				message: "the tag message is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					name,
					...hash === void 0 ? {} : { hash },
					...message === void 0 || message.trim() === "" ? {} : { message }
				}
			};
		}
		case "tagDelete": {
			const name = record["name"];
			if (typeof name !== "string" || !isSafeRefName(name)) return {
				ok: false,
				code: "invalid-ref",
				message: "the tag name is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					name
				}
			};
		}
		case "continueOperation": {
			const operation = record["operation"];
			if (operation !== "merge" && operation !== "rebase" && operation !== "cherry-pick" && operation !== "revert") return {
				ok: false,
				code: "invalid-request",
				message: "the operation is not valid"
			};
			return {
				ok: true,
				action: {
					kind,
					workspaceId,
					operation
				}
			};
		}
		default: return {
			ok: false,
			code: "unsupported-action",
			message: `unsupported action: ${String(kind)}`
		};
	}
}
/** Stable fingerprint for a sorted path batch. */
function pathFingerprint(paths) {
	const text = [...paths].sort().join("\0");
	let hash = 5381;
	for (let index = 0; index < text.length; index += 1) hash = (hash << 5) + hash ^ text.charCodeAt(index);
	return (hash >>> 0).toString(16);
}
/**
* Compute the exact target a confirmation is bound to.
* @param action - parsed action.
* @param root - resolved repository root.
* @returns a token target, or undefined for actions that need no confirmation.
*/
function confirmationTarget(action, root) {
	if (!policyFor(action).requiresConfirmation) return void 0;
	if (action.kind === "discard") return `discard:${root}:${pathFingerprint([...action.tracked, ...action.untracked])}`;
	if (action.kind === "deleteBranch") return `delete-branch:${root}:${action.name}:${action.force ? "force" : "safe"}`;
	if (action.kind === "push" && action.forceWithLease === true) return `force-push:${root}:${action.remote ?? ""}:${action.branch ?? ""}`;
	if (action.kind === "reset") return `reset:${root}:${action.mode}:${action.hash}`;
	if (action.kind === "stashDrop") return `stash-drop:${root}:${action.ref ?? "stash@{0}"}`;
	if (action.kind === "tagDelete") return `tag-delete:${root}:${action.name}`;
	return `${action.kind}:${root}`;
}
/**
* Build the ordered git invocations for one action.
*
* A discard runs tracked restores first, then a `clean -nd` preview, then the
* actual `clean -fd`: the preview is what the preview panel and the test suite
* read, and `-x` is never added.
* @param action - parsed action.
* @param context - resolved executable and repository.
* @returns the invocations in execution order.
*/
function buildActionInvocations(action, context) {
	const { gitPath, root } = context;
	switch (action.kind) {
		case "stage": return [writeInvocation(gitPath, root, [
			"add",
			"-A",
			"--",
			...action.paths
		], { label: "add" })];
		case "unstage": return [writeInvocation(gitPath, root, [
			"restore",
			"--staged",
			"--",
			...action.paths
		], { label: "restore" })];
		case "discard": {
			const invocations = [];
			if (action.tracked.length > 0) invocations.push(writeInvocation(gitPath, root, [
				"restore",
				"--worktree",
				"--source=HEAD",
				"--",
				...action.tracked
			], { label: "restore" }));
			if (action.untracked.length > 0) {
				invocations.push(writeInvocation(gitPath, root, [
					"clean",
					"-nd",
					"--",
					...action.untracked
				], { label: "clean-preview" }));
				invocations.push(writeInvocation(gitPath, root, [
					"clean",
					"-fd",
					"--",
					...action.untracked
				], { label: "clean" }));
			}
			return invocations;
		}
		case "commit": return [writeInvocation(gitPath, root, action.amend ? [
			"commit",
			"--amend",
			"-m",
			action.message,
			"--cleanup=whitespace"
		] : [
			"commit",
			"-m",
			action.message,
			"--cleanup=whitespace"
		], { label: action.amend ? "commit --amend" : "commit" })];
		case "push": {
			const args = [
				"push",
				"--porcelain",
				"--progress"
			];
			if (action.forceWithLease === true) args.push("--force-with-lease");
			if (action.setUpstream === true && action.remote !== void 0 && action.branch !== void 0) args.push("-u", action.remote, action.branch);
			else if (action.remote !== void 0 && action.branch !== void 0) args.push(action.remote, action.branch);
			return [writeInvocation(gitPath, root, args, { label: action.forceWithLease === true ? "push --force-with-lease" : "push" })];
		}
		case "checkout": return [writeInvocation(gitPath, root, [
			"switch",
			"--",
			action.ref
		], { label: "switch" })];
		case "createBranch": return [writeInvocation(gitPath, root, [
			"switch",
			"-c",
			action.name,
			...action.start === void 0 ? [] : [action.start]
		], { label: "switch -c" })];
		case "deleteBranch": return [writeInvocation(gitPath, root, [
			"branch",
			action.force ? "-D" : "-d",
			"--",
			action.name
		], { label: action.force ? "branch -D" : "branch -d" })];
		case "renameBranch": return [writeInvocation(gitPath, root, [
			"branch",
			"-m",
			action.from,
			action.to
		], { label: "branch -m" })];
		case "fetch": {
			const args = ["fetch", "--prune"];
			if (action.all) args.push("--all");
			else if (action.remote !== void 0) args.push(action.remote);
			return [writeInvocation(gitPath, root, args, { label: "fetch" })];
		}
		case "update": return [writeInvocation(gitPath, root, ["fetch", "--prune"], { label: "fetch" }), writeInvocation(gitPath, root, action.mode === "rebase" ? ["rebase", "@{upstream}"] : [
			"merge",
			"--no-edit",
			"@{upstream}"
		], { label: action.mode === "rebase" ? "rebase" : "merge" })];
		case "merge": return [writeInvocation(gitPath, root, [
			"merge",
			"--no-edit",
			action.ref
		], { label: "merge" })];
		case "rebase": return [writeInvocation(gitPath, root, ["rebase", action.onto], { label: "rebase" })];
		case "reset": return [writeInvocation(gitPath, root, [
			"reset",
			`--${action.mode}`,
			action.hash
		], { label: `reset --${action.mode}` })];
		case "revert": return [writeInvocation(gitPath, root, [
			"revert",
			"--no-edit",
			action.hash
		], { label: "revert" })];
		case "cherryPick": return [writeInvocation(gitPath, root, ["cherry-pick", action.hash], { label: "cherry-pick" })];
		case "abortOperation": return [writeInvocation(gitPath, root, [action.operation, "--abort"], { label: `${action.operation} --abort` })];
		case "continueOperation":
			if (action.operation === "merge") return [writeInvocation(gitPath, root, ["commit", "--no-edit"], { label: "commit --no-edit" })];
			return [writeInvocation(gitPath, root, [action.operation, "--continue"], { label: `${action.operation} --continue` })];
		case "stashPush": return [writeInvocation(gitPath, root, [
			"stash",
			"push",
			...action.message === void 0 ? [] : ["-m", action.message],
			...action.includeUntracked ? ["-u"] : []
		], { label: "stash push" })];
		case "stashPop": return [writeInvocation(gitPath, root, [
			"stash",
			"pop",
			...action.ref === void 0 ? [] : [action.ref]
		], { label: "stash pop" })];
		case "stashDrop": return [writeInvocation(gitPath, root, [
			"stash",
			"drop",
			...action.ref === void 0 ? [] : [action.ref]
		], { label: "stash drop" })];
		case "tagCreate": return [writeInvocation(gitPath, root, action.message === void 0 ? [
			"tag",
			action.name,
			...action.hash === void 0 ? [] : [action.hash]
		] : [
			"tag",
			"-a",
			action.name,
			"-m",
			action.message,
			...action.hash === void 0 ? [] : [action.hash]
		], { label: action.message === void 0 ? "tag" : "tag -a" })];
		case "tagDelete": return [writeInvocation(gitPath, root, [
			"tag",
			"-d",
			action.name
		], { label: "tag -d" })];
	}
}
//#endregion
//#region src/git-workspace/host-process.ts
/** One failed git run, already classified for the response envelope. */
var GitRunError = class extends Error {
	code;
	detail;
	constructor(code, message, detail) {
		super(message);
		this.name = "GitRunError";
		this.code = code;
		this.detail = detail;
	}
};
/** Grace period handed to the provider's termination procedure. */
const TERMINATION_GRACE_MS = 2e3;
/** Stderr cap; diagnostics do not need the full stream. */
const STDERR_MAX_BYTES = 131072;
/** The shared git runner. */
var GitRunner = class {
	subprocess;
	resolvedGit;
	constructor(subprocess) {
		this.subprocess = subprocess;
	}
	/**
	* Resolve the git executable once per Host lifetime.
	* @returns the absolute executable path.
	* @throws GitRunError with `git-not-found` when no git exists.
	*/
	async gitPath() {
		if (this.resolvedGit !== void 0) return this.resolvedGit;
		try {
			this.resolvedGit = await this.subprocess.resolveExecutable("git");
			return this.resolvedGit;
		} catch (error) {
			throw new GitRunError("git-not-found", "the git executable was not found on this machine", error instanceof Error ? error.message : String(error));
		}
	}
	/**
	* Run one fully specified invocation.
	* @param invocation - argv, cwd, env, timeout and output caps.
	* @param external - optional caller cancellation.
	* @returns the finished stdout/stderr, exit facts and receipt.
	* @throws GitRunError for spawn failure, timeout or cancellation.
	*/
	async run(invocation, external, onProgress) {
		const controller = new AbortController();
		let timedOut = false;
		let cancelled = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, invocation.timeoutMs);
		timer.unref?.();
		const onAbort = () => {
			cancelled = true;
			controller.abort();
		};
		if (external?.aborted === true) onAbort();
		else external?.addEventListener("abort", onAbort, { once: true });
		const startedAt = Date.now();
		let handle;
		try {
			handle = this.subprocess.spawn({
				argv: invocation.argv,
				cwd: invocation.cwd,
				stdio: {
					stdin: "ignore",
					stdout: { maxBytes: invocation.maxBytes },
					stderr: { maxBytes: STDERR_MAX_BYTES }
				},
				graceMs: TERMINATION_GRACE_MS,
				signal: controller.signal,
				env: invocation.env
			});
		} catch (error) {
			clearTimeout(timer);
			external?.removeEventListener("abort", onAbort);
			throw new GitRunError("internal", "git could not be started", error instanceof Error ? error.message : String(error));
		}
		let stdoutOffset = 0;
		let stderrOffset = 0;
		let pending = "";
		const drainProgress = () => {
			if (onProgress === void 0) return;
			const stdoutRead = handle.collected.stdout?.readFrom(stdoutOffset);
			if (stdoutRead !== void 0) {
				stdoutOffset = stdoutRead.nextOffset ?? stdoutOffset + stdoutRead.text.length;
				pending += stdoutRead.text;
			}
			const stderrRead = handle.collected.stderr?.readFrom(stderrOffset);
			if (stderrRead !== void 0) {
				stderrOffset = stderrRead.nextOffset ?? stderrOffset + stderrRead.text.length;
				pending += stderrRead.text;
			}
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed !== "") onProgress(trimmed);
			}
		};
		const progressTimer = onProgress === void 0 ? void 0 : setInterval(drainProgress, 250);
		progressTimer?.unref?.();
		let outcome;
		try {
			outcome = await handle.done;
		} catch (error) {
			if (progressTimer !== void 0) clearInterval(progressTimer);
			clearTimeout(timer);
			external?.removeEventListener("abort", onAbort);
			const message = error instanceof Error ? error.message : String(error);
			if (timedOut) throw new GitRunError("timeout", "the git command exceeded its time limit", message);
			if (cancelled) throw new GitRunError("cancelled", "the git command was cancelled", message);
			throw new GitRunError("internal", "the git process failed to start", message);
		} finally {
			clearTimeout(timer);
			external?.removeEventListener("abort", onAbort);
		}
		if (progressTimer !== void 0) clearInterval(progressTimer);
		drainProgress();
		const stdoutRead = handle.collected.stdout?.readFrom(0);
		const stderrRead = handle.collected.stderr?.readFrom(0);
		const truncated = stdoutRead?.lossy === true || stderrRead?.lossy === true;
		const ms = Date.now() - startedAt;
		if (timedOut) throw new GitRunError("timeout", "the git command exceeded its time limit", stderrRead?.text ?? "");
		if (cancelled) throw new GitRunError("cancelled", "the git command was cancelled", stderrRead?.text ?? "");
		return {
			stdout: stdoutRead?.text ?? "",
			stderr: stderrRead?.text ?? "",
			exitCode: outcome.exitCode,
			signal: outcome.signal,
			ms,
			truncated,
			receipt: receiptOf(invocation, outcome.exitCode, ms, { truncated })
		};
	}
};
//#endregion
//#region src/git-workspace/host-actions.ts
/**
* Write actions for the Git tool window: confirmation tokens, the per-repository
* mutation lock, background jobs for network operations, action execution and
* failure classification.
*
* The pure argv/validation rules live in `git-actions.ts`; this module owns the
* Host state that must not be recreated per request.
*
* @module dsh-session-map/git-workspace/host-actions
*/
/** How long a confirmation token stays valid. */
const CONFIRM_TTL_MS = 6e4;
/** How long a finished job stays readable in memory. */
const JOB_TTL_MS = 3e5;
/** How many progress lines one job keeps. */
const JOB_LINE_LIMIT = 400;
/** Actions that may take long enough to deserve a background job. */
const LONG_ACTIONS = /* @__PURE__ */ new Set([
	"fetch",
	"update",
	"push"
]);
/** Read one raw JSON object field. */
function asRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	return value;
}
/** Read one required string field. */
function stringField(record, name) {
	const value = record[name];
	if (typeof value !== "string" || value === "") throw new RouteFailure("invalid-request", 400, `"${name}" is required`);
	return value;
}
/** Classify a failed action run. */
function actionFailure(action, stdout, stderr, exitCode) {
	const text = `${stdout}\n${stderr}`.toLowerCase();
	if (action.kind === "commit") {
		if (/nothing to commit|no changes added to commit|nothing added to commit/.test(text)) return new RouteFailure("nothing-to-commit", 409, "there is nothing staged to commit", stderr || stdout);
		if (/committing is not possible|unmerged files|fix conflicts/.test(text)) return new RouteFailure("conflict", 409, "unresolved conflicts block the commit", stderr || stdout);
		if (/hook declined|pre-commit|commit-msg|commit-msg hook|husky/.test(text)) return new RouteFailure("hook-failed", 409, "a git hook rejected the commit", stderr || stdout);
	}
	if (action.kind === "push" && /rejected|non-fast-forward|failed to push|fetch first|protected branch/.test(text)) return new RouteFailure("push-rejected", 409, "the push was rejected by the remote", stderr || stdout);
	if (action.kind === "update" && /conflict|automatic merge failed|needs merge/.test(text)) return new RouteFailure("conflict", 409, "the update produced conflicts", stderr || stdout);
	if ((action.kind === "merge" || action.kind === "rebase" || action.kind === "cherryPick" || action.kind === "revert") && /conflict|automatic merge failed|needs merge|could not apply/.test(text)) return new RouteFailure("conflict", 409, "the operation produced conflicts", stderr || stdout);
	if (action.kind === "continueOperation" && /no merge|no rebase|no cherry-pick|no revert|not in the middle|nothing to commit/.test(text)) return new RouteFailure("conflict", 409, "no operation is in progress", stderr || stdout);
	if (action.kind === "stashPop" && /conflict|needs merge|automatic merge failed/.test(text)) return new RouteFailure("stash-conflict", 409, "the stash could not be applied cleanly; resolve the conflicts, stage the files, then drop the stash", stderr || stdout);
	if (action.kind === "tagCreate" && /already exists/.test(text)) return new RouteFailure("invalid-request", 409, "the tag already exists", stderr || stdout);
	if (action.kind === "deleteBranch" && /not fully merged/.test(text)) return new RouteFailure("branch-not-merged", 409, "the branch has commits that are not merged", stderr || stdout);
	if (action.kind === "deleteBranch" && /cannot delete branch|checked out at/.test(text)) return new RouteFailure("branch-checked-out", 409, "the branch is currently checked out", stderr || stdout);
	return classifyFailure(stderr, exitCode);
}
/** Read the confirmation token out of an action body. */
function confirmationOf(body) {
	const value = asRecord(body)?.["confirm"];
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** Public projection of one job. */
function jobView(record) {
	return {
		id: record.id,
		kind: record.kind,
		workspaceId: record.workspaceId,
		status: record.status,
		lines: [...record.lines],
		...record.summary === void 0 ? {} : { summary: record.summary },
		...record.error === void 0 ? {} : { error: record.error },
		startedAt: record.startedAt,
		...record.finishedAt === void 0 ? {} : { finishedAt: record.finishedAt }
	};
}
/**
* Create the write-route family: confirmation, action and job routes.
* @param service - runner, repository resolver and snapshot invalidation.
* @returns a handler that claims `/confirm`, `/action`, `/job`, `/cancel` and `/events`.
*/
function createActionRouter(service) {
	const confirmations = /* @__PURE__ */ new Map();
	const running = /* @__PURE__ */ new Set();
	const jobs = /* @__PURE__ */ new Map();
	/** Drop expired tokens; called on every issue/consume. */
	const prune = (now) => {
		for (const [token, entry] of confirmations) if (entry.expiresAt <= now) confirmations.delete(token);
	};
	/** Issue one single-use token for an action that needs confirmation. */
	const issue = (action, repo) => {
		const target = confirmationTarget(action, repo.root);
		if (target === void 0) throw new RouteFailure("unsupported-action", 400, "this action does not need a confirmation");
		prune(Date.now());
		const entry = {
			token: randomUUID(),
			root: repo.root,
			kind: action.kind,
			target,
			expiresAt: Date.now() + CONFIRM_TTL_MS
		};
		confirmations.set(entry.token, entry);
		return entry;
	};
	/** Consume a token, or fail with the precise mismatch code. */
	const consume = (token, action, repo) => {
		const target = confirmationTarget(action, repo.root);
		if (target === void 0) return;
		if (token === void 0) throw new RouteFailure("confirmation-required", 409, "this action requires an explicit confirmation");
		prune(Date.now());
		const entry = confirmations.get(token);
		if (entry === void 0) throw new RouteFailure("confirmation-required", 409, "the confirmation expired or was already used");
		confirmations.delete(token);
		if (entry.target !== target || entry.root !== repo.root || entry.kind !== action.kind) throw new RouteFailure("confirmation-mismatch", 409, "the confirmation does not match this action");
	};
	/** Execute one action under the repository lock. */
	const execute = async (action, repo, signal, onProgress) => {
		if (running.has(repo.root)) throw new RouteFailure("busy", 409, "another write operation is running on this repository");
		running.add(repo.root);
		try {
			const gitPath = await service.runner.gitPath();
			const invocations = buildActionInvocations(action, {
				gitPath,
				root: repo.root
			});
			const commands = [];
			for (const invocation of invocations) {
				const result = await service.runner.run(invocation, signal, onProgress);
				commands.push(result.receipt);
				if (result.exitCode !== 0) {
					if (action.kind === "unstage" && /could not resolve HEAD/.test(result.stderr)) {
						const fallback = writeInvocation(gitPath, repo.root, [
							"rm",
							"--cached",
							"--",
							...action.paths
						], { label: "rm --cached" });
						const retry = await service.runner.run(fallback, signal);
						commands.push(retry.receipt);
						if (retry.exitCode === 0) continue;
					}
					throw actionFailure(action, result.stdout, result.stderr, result.exitCode);
				}
			}
			service.invalidate(repo.root);
			return {
				commands,
				summary: policyFor(action).summary
			};
		} finally {
			running.delete(repo.root);
		}
	};
	/** Create and start one background job. */
	const startJob = (action, repo) => {
		if (running.has(repo.root)) throw new RouteFailure("busy", 409, "another write operation is running on this repository");
		const record = {
			id: randomUUID(),
			kind: action.kind,
			workspaceId: action.workspaceId,
			startedAt: Date.now(),
			controller: new AbortController(),
			lines: [],
			listeners: /* @__PURE__ */ new Set(),
			status: "running",
			summary: void 0,
			error: void 0,
			finishedAt: void 0
		};
		jobs.set(record.id, record);
		(async () => {
			try {
				const result = await execute(action, repo, record.controller.signal, (line) => {
					if (record.lines.length < JOB_LINE_LIMIT) record.lines.push(line);
					const view = jobView(record);
					for (const listener of record.listeners) listener(view);
				});
				record.summary = result.summary;
				record.status = "done";
			} catch (error) {
				if (error instanceof GitRunError && error.code === "cancelled") record.status = "cancelled";
				else if (error instanceof RouteFailure) {
					record.status = "failed";
					record.error = {
						code: error.code,
						message: error.message,
						...error.detail === void 0 ? {} : { detail: error.detail }
					};
				} else {
					record.status = "failed";
					record.error = {
						code: error instanceof GitRunError ? error.code : "internal",
						message: error instanceof Error ? error.message : String(error)
					};
				}
			} finally {
				record.finishedAt = Date.now();
				service.invalidate(repo.root);
				const view = jobView(record);
				for (const listener of record.listeners) listener(view);
				setTimeout(() => jobs.delete(record.id), JOB_TTL_MS).unref?.();
			}
		})();
		return record;
	};
	/** Stream one job as server-sent events. */
	const streamJob = (record, response) => {
		try {
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-store",
				connection: "keep-alive"
			});
		} catch {
			return;
		}
		const send = (view) => {
			try {
				response.write?.(`data: ${JSON.stringify(view)}\n\n`);
			} catch {}
		};
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			clearInterval(heartbeat);
			record.listeners.delete(listener);
			try {
				response.end();
			} catch {}
		};
		const listener = (view) => {
			send(view);
			if (view.status !== "running") close();
		};
		record.listeners.add(listener);
		const heartbeat = setInterval(() => {
			try {
				response.write?.(": ping\n\n");
			} catch {
				close();
			}
		}, 15e3);
		heartbeat.unref?.();
		response.on("close", close);
		send(jobView(record));
		if (record.status !== "running") close();
	};
	return async (request, response, url, method) => {
		const path = url.pathname.slice(21);
		if (path !== "/confirm" && path !== "/action" && path !== "/job" && path !== "/cancel" && path !== "/events") return false;
		try {
			const expectedMethod = path === "/job" || path === "/events" ? "GET" : "POST";
			if (method !== expectedMethod) throw new RouteFailure("invalid-request", 405, `use ${expectedMethod}`);
			if (path === "/events") {
				const record = jobs.get(requiredId(url, "job"));
				if (record === void 0) throw new RouteFailure("invalid-request", 404, "the job does not exist");
				streamJob(record, response);
				return true;
			}
			if (path === "/job") {
				const record = jobs.get(requiredId(url, "id"));
				if (record === void 0) throw new RouteFailure("invalid-request", 404, "the job does not exist");
				sendJson$1(response, 200, {
					ok: true,
					job: jobView(record)
				});
				return true;
			}
			if (!(request.headers["content-type"] ?? "").toString().toLowerCase().includes("application/json")) throw new RouteFailure("invalid-request", 415, "use application/json");
			const body = await readJsonBody(request);
			if (!body.ok) throw new RouteFailure("invalid-request", body.status, body.message);
			if (path === "/cancel") {
				const record = jobs.get(requiredIdFrom(objectOf(body.value)));
				if (record === void 0) throw new RouteFailure("invalid-request", 404, "the job does not exist");
				if (record.status === "running") record.controller.abort();
				sendJson$1(response, 200, {
					ok: true,
					job: jobView(record)
				});
				return true;
			}
			const parsed = parseActionRequest(body.value);
			if (!parsed.ok) throw new RouteFailure(parsed.code, statusFor(parsed.code), parsed.message);
			const action = parsed.action;
			const repo = await service.resolveRepo(action.workspaceId);
			if (path === "/confirm") {
				const entry = issue(action, repo);
				sendJson$1(response, 200, {
					ok: true,
					token: entry.token,
					expiresAt: entry.expiresAt
				});
				return true;
			}
			consume(confirmationOf(body.value), action, repo);
			if (LONG_ACTIONS.has(action.kind)) {
				sendJson$1(response, 200, {
					ok: true,
					job: {
						id: startJob(action, repo).id,
						status: "running"
					}
				});
				return true;
			}
			sendJson$1(response, 200, {
				ok: true,
				...await execute(action, repo)
			});
			return true;
		} catch (error) {
			if (error instanceof RouteFailure) {
				sendRouteFailure(response, error);
				return true;
			}
			if (error instanceof GitRunError) {
				sendJson$1(response, statusFor(error.code), {
					ok: false,
					error: {
						code: error.code,
						message: error.message,
						...error.detail === void 0 ? {} : { detail: error.detail.slice(-4096) }
					}
				});
				return true;
			}
			sendJson$1(response, 500, {
				ok: false,
				error: {
					code: "internal",
					message: error instanceof Error ? error.message : String(error)
				}
			});
			return true;
		}
	};
}
/** Read one required query id. */
function requiredId(url, name) {
	const value = url.searchParams.get(name);
	if (value === null || value === "") throw new RouteFailure("invalid-request", 400, `"${name}" is required`);
	return value;
}
/** Read the job id out of a cancel body. */
function objectOf(value) {
	const parsed = asRecord(value);
	if (parsed === void 0) throw new RouteFailure("invalid-request", 400, "the request body must be an object");
	return parsed;
}
/** Read the job id out of a cancel body. */
function requiredIdFrom(body) {
	return stringField(body, "id");
}
//#endregion
//#region src/git-workspace/host-git.ts
/**
* Host half of the Git tool window: read routes over real git plus the shared
* repository resolver every future write route will reuse.
*
* The handler assumes the dispatcher already applied the loopback trust gate and
* the JSON size cap; it still owns its own input validation, path containment and
* output limits. It claims only paths under {@link GIT_WORKSPACE_ROUTE} other
* than `/state` and `/clone`.
*
* @module dsh-session-map/git-workspace/host-git
*/
/** Marker files whose presence means an operation is in progress. */
const OPERATION_MARKERS = [
	"MERGE_HEAD",
	"rebase-merge",
	"rebase-apply",
	"CHERRY_PICK_HEAD",
	"REVERT_HEAD",
	"BISECT_LOG",
	"sequencer",
	"index"
];
/** How long one snapshot is reused to collapse React double-fetches. */
const SNAPSHOT_TTL_MS = 800;
/** Untracked rows above this fall back to `-unormal` so the snapshot stays usable. */
const MAX_UNTRACKED_ROWS = 2e3;
/** Maximum commits one log page may return. */
const MAX_LOG_LIMIT = 100;
/** Maximum page offset the UI may request. */
const MAX_LOG_SKIP = 5e4;
/** Longest free-text filter accepted from the page. */
const MAX_FILTER_LENGTH = 200;
/** Map one failure code onto an HTTP status. */
/** Short, stable djb2 hash used for the snapshot version. */
function fingerprint(value) {
	let hash = 5381;
	for (let index = 0; index < value.length; index += 1) hash = (hash << 5) + hash ^ value.charCodeAt(index);
	return (hash >>> 0).toString(16);
}
/** Read the execution-world platform, defaulting to POSIX. */
async function readPlatform(subprocess) {
	try {
		return (await subprocess.terminalEnvironment()).platform === "windows" ? "windows" : "posix";
	} catch {
		return "posix";
	}
}
/** Validate one required query string. */
function requiredString(url, name) {
	const value = url.searchParams.get(name);
	if (value === null || value.trim() === "") throw new RouteFailure("invalid-request", 400, `"${name}" is required`);
	return value.trim();
}
/** Validate one optional free-text filter. */
function optionalFilter(url, name) {
	const value = url.searchParams.get(name);
	if (value === null) return void 0;
	const trimmed = value.trim();
	if (trimmed === "") return void 0;
	if (trimmed.length > MAX_FILTER_LENGTH) throw new RouteFailure("invalid-request", 400, `"${name}" is too long`);
	if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new RouteFailure("invalid-request", 400, `"${name}" contains control characters`);
	return trimmed;
}
/** Validate a date filter shape (ISO date or date-time). */
function optionalDate(url, name) {
	const value = optionalFilter(url, name);
	if (value === void 0) return void 0;
	if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.test(value)) throw new RouteFailure("invalid-request", 400, `"${name}" must be an ISO date`);
	return value;
}
/** Clamp one integer query parameter. */
function integerParam(url, name, fallback, min, max) {
	const raw = url.searchParams.get(name);
	if (raw === null) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value)) throw new RouteFailure("invalid-request", 400, `"${name}" must be an integer`);
	return Math.min(max, Math.max(min, value));
}
/** Build one read invocation from a resolved executable and repository. */
function read(gitPath, repo, args, options = {}) {
	return readInvocation(gitPath, repo.root, args, options);
}
/** Map a failed git run onto a stable route failure. */
/** One snapshot cache entry lookup with TTL. */
function freshSnapshot(cache, root) {
	const entry = cache.get(root);
	if (entry === void 0) return void 0;
	if (Date.now() - entry.at > SNAPSHOT_TTL_MS) {
		cache.delete(root);
		return;
	}
	return entry;
}
/**
* Create the Git tool window route handler.
* @param deps - subprocess seam plus the durable Workspace registry.
* @returns a handler that claims the read paths and reports 404 under its prefix otherwise.
*/
function createGitWindowHandler(deps) {
	const { subprocess, workspaces } = deps;
	const runner = new GitRunner(subprocess);
	const snapshots = /* @__PURE__ */ new Map();
	const repos = /* @__PURE__ */ new Map();
	const platform = /* @__PURE__ */ new WeakMap();
	/** Resolve one workspace id into a contained repository root. */
	const resolveRepo = async (workspaceId) => {
		const cachedRepo = repos.get(workspaceId);
		if (cachedRepo !== void 0 && Date.now() - cachedRepo.at < 3e4) return cachedRepo.repo;
		const workspace = workspaces.get(workspaceId);
		if (workspace === void 0) throw new RouteFailure("workspace-not-found", 404, "the requested workspace is not registered");
		let workspacePath;
		try {
			workspacePath = await realpath(workspace.path);
		} catch {
			throw new RouteFailure("invalid-path", 400, "the workspace directory does not exist");
		}
		const world = platform.get(subprocess) ?? await readPlatform(subprocess);
		platform.set(subprocess, world);
		const gitPath = await runner.gitPath();
		const probe = await runner.run(read(gitPath, {
			root: workspacePath,
			gitDir: "",
			platform: world
		}, repoProbeArgs()));
		if (probe.exitCode !== 0) {
			const failure = classifyFailure(probe.stderr, probe.exitCode);
			if (failure.code === "internal") throw new RouteFailure("not-a-repository", 200, "the workspace is not a git repository", probe.stderr);
			throw failure;
		}
		const parsed = parseRepoProbe(probe.stdout);
		if (parsed === void 0) throw new RouteFailure("parse-failed", 500, "the repository probe could not be parsed", probe.stdout);
		if (!parsed.insideWorkTree || parsed.bare) throw new RouteFailure("not-a-repository", 200, "the workspace is not a git work tree");
		let root;
		try {
			root = await realpath(parsed.topLevel);
		} catch {
			root = parsed.topLevel;
		}
		if (!isPathInside(workspacePath, root, world)) throw new RouteFailure("invalid-path", 400, "the repository root is outside the workspace");
		const gitDir = isAbsolute(parsed.gitDir) ? parsed.gitDir : resolve(workspacePath, parsed.gitDir);
		const repo = {
			root,
			gitDir,
			platform: world
		};
		repos.set(workspaceId, {
			repo,
			at: Date.now()
		});
		return repo;
	};
	const actions = createActionRouter({
		runner,
		resolveRepo,
		invalidate: (root) => {
			snapshots.delete(root);
		}
	});
	/** Fingerprint the files that move when refs or the index change. */
	const readVersion = async (repo) => {
		const files = [
			"index",
			"HEAD",
			"packed-refs",
			"FETCH_HEAD",
			"ORIG_HEAD"
		].map((name) => join(repo.gitDir, name));
		let text = "";
		for (const file of files) try {
			const info = await stat(file);
			text += `${file}:${info.mtimeMs}:${info.size};`;
		} catch {
			text += `${file}:0;`;
		}
		try {
			const refs = await stat(join(repo.gitDir, "refs"));
			text += `refs:${refs.mtimeMs};`;
		} catch {}
		return fingerprint(text);
	};
	/** Detect the operation in progress from marker files. */
	const readOperation = async (repo, markerPaths) => {
		const present = /* @__PURE__ */ new Set();
		await Promise.all(OPERATION_MARKERS.map(async (name, index) => {
			const path = markerPaths[index];
			if (path === void 0) return;
			const absolute = isAbsolute(path) ? path : resolve(repo.root, path);
			try {
				await stat(absolute);
				present.add(name);
			} catch {}
		}));
		if (present.has("rebase-merge")) return "rebase";
		if (present.has("rebase-apply")) return "rebase-apply";
		if (present.has("MERGE_HEAD")) return "merge";
		if (present.has("CHERRY_PICK_HEAD")) return "cherry-pick";
		if (present.has("REVERT_HEAD")) return "revert";
		if (present.has("BISECT_LOG")) return "bisect";
		return "none";
	};
	/** Build one complete snapshot. */
	const buildSnapshot = async (repo, controller) => {
		const cached = freshSnapshot(snapshots, repo.root);
		if (cached !== void 0) return cached;
		const gitPath = await runner.gitPath();
		const commands = [];
		const run = async (args, label) => {
			const result = await runner.run(read(gitPath, repo, args, { label }), controller.signal);
			commands.push(result.receipt);
			return result;
		};
		const [fullStatusRun, refsRun, markersRun, remotesRun] = await Promise.all([
			run(statusArgs("all"), "status"),
			run(forEachRefArgs(), "refs"),
			run(gitPathArgs(OPERATION_MARKERS), "paths"),
			run(remoteVerboseArgs(), "remotes")
		]);
		for (const result of [
			fullStatusRun,
			refsRun,
			markersRun,
			remotesRun
		]) if (result.exitCode !== 0) throw classifyFailure(result.stderr, result.exitCode);
		let statusRun = fullStatusRun;
		let status = parseStatusV2(statusRun.stdout);
		let untrackedCollapsed = false;
		let untrackedRows = 0;
		for (const change of status.changes) if (change.group === "untracked") untrackedRows += 1;
		if (statusRun.truncated || untrackedRows > MAX_UNTRACKED_ROWS) {
			const collapsed = await run(statusArgs("normal"), "status");
			if (collapsed.exitCode === 0) {
				const collapsedStatus = parseStatusV2(collapsed.stdout);
				if (!collapsedStatus.truncated) {
					statusRun = collapsed;
					status = collapsedStatus;
					untrackedCollapsed = true;
				}
			}
		}
		const refs = parseForEachRef(refsRun.stdout);
		const markers = parseGitPathLines(markersRun.stdout);
		const operation = await readOperation(repo, markers);
		const version = await readVersion(repo);
		const counts = {
			staged: 0,
			unstaged: 0,
			untracked: 0,
			conflicted: 0
		};
		for (const change of status.changes) if (change.group === "staged") counts.staged += 1;
		else if (change.group === "unstaged") counts.unstaged += 1;
		else if (change.group === "untracked") counts.untracked += 1;
		else counts.conflicted += 1;
		const entry = {
			snapshot: {
				takenAt: Date.now(),
				stale: false,
				truncated: status.truncated || refs.truncated || statusRun.truncated || refsRun.truncated,
				version,
				repo: {
					root: repo.root,
					gitDir: repo.gitDir,
					isBare: false,
					isWorktree: false
				},
				head: {
					oid: status.head.oid,
					branch: status.head.branch,
					detached: status.head.detached,
					unborn: status.head.unborn,
					upstream: status.head.upstream === null ? null : {
						ref: status.head.upstream,
						ahead: status.head.ahead,
						behind: status.head.behind,
						gone: false
					},
					operation
				},
				changes: status.changes,
				counts,
				...untrackedCollapsed ? { untrackedCollapsed: true } : {},
				stashCount: status.head.stashCount,
				branches: refs.refs,
				remotes: parseRemoteVerbose(remotesRun.stdout)
			},
			commands,
			at: Date.now()
		};
		snapshots.set(repo.root, entry);
		return entry;
	};
	/** Snapshot route payload builder. */
	const snapshotPayload = async (url, controller) => {
		const repo = await resolveRepo(requiredString(url, "workspaceId"));
		const cached = await buildSnapshot(repo, controller);
		return {
			snapshot: cached.snapshot,
			commands: cached.commands
		};
	};
	/** Log page route. */
	const logRoute = async (url, controller) => {
		const repo = await resolveRepo(requiredString(url, "workspaceId"));
		const ref = optionalFilter(url, "ref");
		if (ref !== void 0 && !isSafeRefName(ref) && !isSafeHash(ref)) throw new RouteFailure("invalid-ref", 400, "the requested ref is not a valid name");
		const limit = integerParam(url, "limit", 50, 1, MAX_LOG_LIMIT);
		const skip = integerParam(url, "skip", 0, 0, MAX_LOG_SKIP);
		let query = optionalFilter(url, "query");
		const author = optionalFilter(url, "author");
		const since = optionalDate(url, "since");
		const until = optionalDate(url, "until");
		const allBranches = url.searchParams.get("all") === "1";
		const fileParam = optionalFilter(url, "file");
		let file;
		if (fileParam !== void 0) {
			const normalized = normalizeRepoRelativePath(fileParam);
			if (!normalized.ok) throw new RouteFailure("invalid-path", 400, normalized.message);
			file = normalized.path;
		}
		const gitPath = await runner.gitPath();
		const commands = [];
		let refForLog = ref;
		if (query !== void 0 && isSafeHash(query)) {
			const verified = await runner.run(read(gitPath, repo, verifyCommitArgs(query), { label: "verify" }), controller.signal);
			commands.push(verified.receipt);
			if (verified.exitCode === 0) {
				refForLog = verified.stdout.trim();
				query = void 0;
			}
		}
		const result = await runner.run(read(gitPath, repo, logArgs({
			...refForLog === void 0 ? {} : { ref: refForLog },
			allBranches,
			limit,
			skip,
			...query === void 0 ? {} : { query },
			...author === void 0 ? {} : { author },
			...since === void 0 ? {} : { since },
			...until === void 0 ? {} : { until },
			...file === void 0 ? {} : { file }
		}), {
			timeoutMs: 2e4,
			label: "log"
		}), controller.signal);
		commands.push(result.receipt);
		if (result.exitCode !== 0 && /does not have any commits yet|bad revision/i.test(result.stderr)) return {
			ok: true,
			commits: [],
			hasMore: false,
			truncated: false,
			commands
		};
		if (result.exitCode !== 0) throw classifyFailure(result.stderr, result.exitCode);
		const parsed = parseLogZ(result.stdout);
		return {
			ok: true,
			commits: parsed.commits,
			hasMore: parsed.commits.length >= limit,
			truncated: parsed.truncated || result.truncated,
			commands
		};
	};
	/** Commit-detail route. */
	const commitRoute = async (url, controller) => {
		const repo = await resolveRepo(requiredString(url, "workspaceId"));
		const hash = requiredString(url, "hash");
		if (!isSafeHash(hash)) throw new RouteFailure("invalid-ref", 400, "the commit hash is not valid");
		const gitPath = await runner.gitPath();
		const run = async (args, label) => {
			return await runner.run(read(gitPath, repo, args, { label }), controller.signal);
		};
		const [meta, files, stats, branches] = await Promise.all([
			run(commitMetaArgs(hash), "show-meta"),
			run(commitFilesArgs(hash), "show-files"),
			run(commitNumstatArgs(hash), "show-stats"),
			run(containsArgs(hash), "contains")
		]);
		const commands = [
			meta.receipt,
			files.receipt,
			stats.receipt,
			branches.receipt
		];
		for (const result of [
			meta,
			files,
			stats
		]) if (result.exitCode !== 0) throw classifyFailure(result.stderr, result.exitCode);
		const parsedMeta = parseCommitMeta(meta.stdout);
		if (parsedMeta === void 0) throw new RouteFailure("parse-failed", 500, "the commit metadata could not be parsed");
		const parsedFiles = parseNameStatusZ(files.stdout);
		const parsedStats = parseNumstatZ(stats.stdout);
		const contained = branches.exitCode === 0 ? branches.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.endsWith("/HEAD")) : [];
		return {
			ok: true,
			commit: {
				...parsedMeta.commit,
				message: parsedMeta.message,
				files: mergeFileStats(parsedFiles.files, parsedStats.entries),
				containedInBranches: contained
			},
			commands
		};
	};
	/** Diff route. */
	const diffRoute = async (url, controller) => {
		const repo = await resolveRepo(requiredString(url, "workspaceId"));
		const normalized = normalizeRepoRelativePath(requiredString(url, "file"));
		if (!normalized.ok) throw new RouteFailure("invalid-path", 400, normalized.message);
		const hash = optionalFilter(url, "hash");
		if (hash !== void 0 && !isSafeHash(hash)) throw new RouteFailure("invalid-ref", 400, "the commit hash is not valid");
		const from = optionalFilter(url, "from");
		if (from !== void 0 && !isSafeHash(from)) throw new RouteFailure("invalid-ref", 400, "the base commit hash is not valid");
		const staged = url.searchParams.get("staged") === "1";
		const context = integerParam(url, "context", 3, 0, 20);
		const gitPath = await runner.gitPath();
		const result = await runner.run(read(gitPath, repo, diffArgs({
			...hash === void 0 ? {} : { hash },
			...from === void 0 ? {} : { from },
			file: normalized.path,
			staged,
			context
		}), {
			timeoutMs: 2e4,
			label: "diff"
		}), controller.signal);
		if (result.exitCode !== 0) {
			if (/does not exist|not in the working tree|exists on disk, but not in/.test(result.stderr)) throw new RouteFailure("invalid-path", 400, "the path does not exist in this revision", result.stderr);
			throw classifyFailure(result.stderr, result.exitCode);
		}
		const binary = /^Binary files .* differ$/m.test(result.stdout) || /^GIT binary patch$/m.test(result.stdout);
		return {
			ok: true,
			patch: result.stdout,
			binary,
			truncated: result.truncated,
			commands: [result.receipt]
		};
	};
	/** Push-preview route: commits and files above the branch's upstream. */
	const pushPreviewRoute = async (url, controller) => {
		const repo = await resolveRepo(requiredString(url, "workspaceId"));
		const gitPath = await runner.gitPath();
		const commands = [];
		const upstream = await runner.run(read(gitPath, repo, upstreamRefArgs(), { label: "push-upstream" }), controller.signal);
		commands.push(upstream.receipt);
		if (upstream.exitCode !== 0) return {
			ok: true,
			preview: {
				upstream: null,
				commits: [],
				files: [],
				truncated: false
			},
			commands
		};
		const upstreamRef = upstream.stdout.trim();
		if (upstreamRef === "" || !isSafeRefName(upstreamRef)) throw new RouteFailure("invalid-ref", 400, "the upstream ref is not valid");
		const base = await runner.run(read(gitPath, repo, verifyRefArgs(upstreamRef), { label: "push-base" }), controller.signal);
		commands.push(base.receipt);
		if (base.exitCode !== 0) throw classifyFailure(base.stderr, base.exitCode);
		const baseHash = base.stdout.trim();
		if (!isSafeHash(baseHash)) throw new RouteFailure("invalid-ref", 400, "the upstream commit is not a hash");
		const limit = 100;
		const [log, files, stats] = await Promise.all([
			runner.run(read(gitPath, repo, logArgs({
				ref: `${baseHash}..HEAD`,
				limit,
				skip: 0
			}), {
				timeoutMs: 2e4,
				label: "push-log"
			}), controller.signal),
			runner.run(read(gitPath, repo, rangeFilesArgs(baseHash), {
				timeoutMs: 2e4,
				label: "push-files"
			}), controller.signal),
			runner.run(read(gitPath, repo, rangeNumstatArgs(baseHash), {
				timeoutMs: 2e4,
				label: "push-stats"
			}), controller.signal)
		]);
		commands.push(log.receipt, files.receipt, stats.receipt);
		if (log.exitCode !== 0 && /does not have any commits yet|bad revision/i.test(log.stderr)) return {
			ok: true,
			preview: {
				upstream: upstreamRef,
				commits: [],
				files: [],
				truncated: false
			},
			commands
		};
		for (const result of [
			log,
			files,
			stats
		]) if (result.exitCode !== 0) throw classifyFailure(result.stderr, result.exitCode);
		const parsedLog = parseLogZ(log.stdout);
		const parsedFiles = parseNameStatusZ(files.stdout);
		const parsedStats = parseNumstatZ(stats.stdout);
		return {
			ok: true,
			preview: {
				upstream: upstreamRef,
				commits: parsedLog.commits,
				files: mergeFileStats(parsedFiles.files, parsedStats.entries),
				truncated: parsedLog.truncated || log.truncated || parsedLog.commits.length >= limit
			},
			commands
		};
	};
	return async (request, response, url, method) => {
		if (!url.pathname.startsWith(`/plugin-git-workspace/`)) return false;
		const path = url.pathname.slice(21);
		const controller = new AbortController();
		response.on("close", () => controller.abort());
		try {
			if (await actions(request, response, url, method)) return true;
			if (path === "/snapshot") {
				if (method !== "GET") throw new RouteFailure("invalid-request", 405, "use GET");
				sendJson$1(response, 200, {
					ok: true,
					...await snapshotPayload(url, controller)
				});
				return true;
			}
			if (path === "/log") {
				if (method !== "GET") throw new RouteFailure("invalid-request", 405, "use GET");
				sendJson$1(response, 200, await logRoute(url, controller));
				return true;
			}
			if (path === "/commit") {
				if (method !== "GET") throw new RouteFailure("invalid-request", 405, "use GET");
				sendJson$1(response, 200, await commitRoute(url, controller));
				return true;
			}
			if (path === "/diff") {
				if (method !== "GET") throw new RouteFailure("invalid-request", 405, "use GET");
				sendJson$1(response, 200, await diffRoute(url, controller));
				return true;
			}
			if (path === "/push-preview") {
				if (method !== "GET") throw new RouteFailure("invalid-request", 405, "use GET");
				sendJson$1(response, 200, await pushPreviewRoute(url, controller));
				return true;
			}
			throw new RouteFailure("invalid-request", 404, `unknown endpoint: ${method} ${url.pathname}`);
		} catch (error) {
			if (error instanceof RouteFailure) {
				sendRouteFailure(response, error);
				return true;
			}
			if (error instanceof GitRunError) {
				sendJson$1(response, statusFor(error.code), {
					ok: false,
					error: {
						code: error.code,
						message: error.message,
						...error.detail === void 0 ? {} : { detail: error.detail.slice(-4096) }
					}
				});
				return true;
			}
			sendJson$1(response, 500, {
				ok: false,
				error: {
					code: "internal",
					message: error instanceof Error ? error.message : String(error)
				}
			});
			return true;
		}
	};
}
//#endregion
//#region src/git-workspace/host.ts
/**
* Read one optional service from the global store.
* @param ctx - the plugin's context.
* @param name - the service name.
* @returns the service as the caller's local interface, or `undefined`.
*/
function lookup$1(ctx, name) {
	return ctx.get(name);
}
/**
* Install the plugin's Host routes.
*
* Call this from a context that provides `webServer`, `subprocess` and
* `workspaceRegistry`; every registration is owned by an effect.
* @param ctx - plugin context carrying the three host services.
*/
function installGitWorkspaceHost(ctx) {
	const webServer = lookup$1(ctx, "webServer");
	const subprocess = lookup$1(ctx, "subprocess");
	const workspaces = lookup$1(ctx, "workspaceRegistry");
	if (webServer === void 0 || subprocess === void 0 || workspaces === void 0) return;
	const clone = createCloneHandler({
		subprocess,
		workspaces,
		workingDirectory: lookup$1(ctx, "workingDirectory")
	});
	const gitWindow = createGitWindowHandler({
		subprocess,
		workspaces
	});
	const handler = async (request, response) => {
		try {
			if (!isTrustedRequest(request)) {
				sendJson$1(response, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "untrusted host"
					}
				});
				return;
			}
			const url = new URL(request.url ?? "/", "http://localhost");
			const method = (request.method ?? "GET").toUpperCase();
			if (await clone(request, response, url, method)) return;
			if (await gitWindow(request, response, url, method)) return;
			sendJson$1(response, 404, {
				ok: false,
				error: {
					code: "not-found",
					message: `unknown endpoint: ${method} ${url.pathname}`
				}
			});
		} catch (error) {
			sendJson$1(response, 500, {
				ok: false,
				error: {
					code: "internal",
					message: error instanceof Error ? error.message : String(error)
				}
			});
		}
	};
	ctx.effect(() => webServer.register({
		kind: "prefix",
		path: GIT_WORKSPACE_ROUTE,
		handler
	}), "git-workspace: routes");
}
//#endregion
//#region src/skill-catalog/catalog.ts
/** Root labels for the discovery sources the filesystem provider reports. */
const SOURCE_LABELS = {
	"user-dsh": "~/.dsh/skills",
	"user-agents": "~/.agents/skills",
	"project-dsh": ".dsh/skills",
	"project-agents": ".agents/skills",
	custom: "自定义目录",
	bundled: "内置",
	runtime: "运行时注册"
};
/**
* Classify a discovery source into the layer this page groups by.
* @param source - raw source reported by the registry.
* @returns `user` for user roots, `project` for project roots, `other` otherwise.
*/
function layerOfSource(source) {
	if (source.startsWith("user-")) return "user";
	if (source.startsWith("project-")) return "project";
	return "other";
}
/**
* Human label for one discovery source.
* @param source - raw source reported by the registry.
* @returns the known root label, or the raw source for unknown providers.
*/
function rootLabelOf(source) {
	return SOURCE_LABELS[source] ?? source;
}
/**
* Stamp one registry summary into the page's view shape.
* @param summary - one summary as the registry reports it.
* @param layer - layer the summary belongs to.
* @returns the view, or `undefined` when the summary has no usable name.
*/
function toSkillView(summary, layer) {
	if (typeof summary.name !== "string" || summary.name === "") return void 0;
	const source = typeof summary.source === "string" && summary.source !== "" ? summary.source : "unknown";
	const description = typeof summary.description === "string" ? summary.description : "";
	const whenToUse = typeof summary.whenToUse === "string" && summary.whenToUse !== "" ? summary.whenToUse : void 0;
	const path = typeof summary.path === "string" && summary.path !== "" ? summary.path : void 0;
	const provider = typeof summary.provider === "string" && summary.provider !== "" ? summary.provider : void 0;
	return {
		name: summary.name,
		description,
		...whenToUse === void 0 ? {} : { whenToUse },
		...path === void 0 ? {} : { path },
		source,
		layer,
		rootLabel: rootLabelOf(source),
		modelInvocable: summary.invocation?.modelInvocable !== false,
		userInvocable: summary.invocation?.userInvocable !== false,
		...provider === void 0 ? {} : { provider }
	};
}
/**
* Sort views by name so every group reads the same way.
* @param views - views to sort; the input is left alone.
* @returns a new name-sorted array.
*/
function sortSkillViews(views) {
	return [...views].sort((left, right) => left.name.localeCompare(right.name));
}
/**
* Keep one view per name and path, dropping malformed duplicates.
* @param views - views to deduplicate.
* @returns a name-sorted, duplicate-free array.
*/
function uniqueSkillViews(views) {
	const seen = /* @__PURE__ */ new Set();
	const kept = [];
	for (const view of views) {
		const key = `${view.name}\u0000${view.path ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(view);
	}
	return sortSkillViews(kept);
}
/**
* Split one registry listing into the page's three buckets.
* @param summaries - one registry listing, in registry order.
* @returns the user-level, project-level, and other-source views.
*/
function bucketSkillSummaries(summaries) {
	const user = [];
	const project = [];
	const other = [];
	for (const summary of summaries) {
		const layer = layerOfSource(typeof summary.source === "string" ? summary.source : "");
		const view = toSkillView(summary, layer);
		if (view === void 0) continue;
		if (layer === "user") user.push(view);
		else if (layer === "project") project.push(view);
		else other.push(view);
	}
	return {
		user: uniqueSkillViews(user),
		project: uniqueSkillViews(project),
		other: uniqueSkillViews(other)
	};
}
//#endregion
//#region src/skill-catalog/host.ts
/** Route family shared by the page and the Host. */
const SKILL_CATALOG_ROUTE = "/plugin-skill-catalog";
/**
* Read one optional service from the global store.
* @param ctx - the plugin's context.
* @param name - the service name.
* @returns the service as the caller's local interface, or `undefined`.
*/
function lookup(ctx, name) {
	return ctx.get(name);
}
/** Raise and format one JSON response; a closed connection is not an error. */
function sendJson(response, status, value) {
	const body = JSON.stringify(value);
	try {
		response.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			"content-length": new TextEncoder().encode(body).byteLength
		});
		response.end(body);
	} catch {}
}
/**
* Whether a path exists, without distinguishing files from directories.
* @param path - absolute host path.
* @returns whether the path is present.
*/
async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
/**
* Resolve the project root a workspace path belongs to.
*
* This mirrors the filesystem skill provider: the nearest ancestor (or the path
* itself) that holds `.git`; a path outside any repository is its own root.
* @param cwd - registered workspace path, absolute.
* @returns the resolved project root.
*/
async function resolveProjectRoot(cwd) {
	const start = resolve(cwd);
	let current = start;
	while (true) {
		if (await pathExists(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return start;
		current = parent;
	}
}
/**
* Group the workspace registry's paths by resolved project root.
* @param workspaces - the registry rows.
* @returns one candidate per distinct project root, in path order.
*/
async function collectProjectCandidates(workspaces) {
	const byRoot = /* @__PURE__ */ new Map();
	for (const workspace of workspaces) {
		if (typeof workspace.path !== "string" || workspace.path === "") continue;
		const root = await resolveProjectRoot(workspace.path);
		const candidate = byRoot.get(root) ?? {
			root,
			workspaceIds: [],
			workspaceTitles: []
		};
		candidate.workspaceIds.push(String(workspace.id));
		candidate.workspaceTitles.push(typeof workspace.title === "string" && workspace.title !== "" ? workspace.title : root);
		byRoot.set(root, candidate);
	}
	return [...byRoot.values()].sort((left, right) => left.root.localeCompare(right.root));
}
/**
* Read one project group's skills; a failure stays inside its own group so the
* rest of the page still renders.
* @param skills - the skill registry.
* @param candidate - the project root and the workspaces that share it.
* @param scope - preset viewing scope, when a lease could be taken.
* @returns the group, with `error` set when discovery failed.
*/
async function readProjectGroup(skills, candidate, scope) {
	const base = {
		projectRoot: candidate.root,
		workspaceIds: candidate.workspaceIds,
		workspaceTitles: candidate.workspaceTitles
	};
	try {
		const summaries = await skills.list(scope === void 0 ? { cwd: candidate.root } : {
			cwd: candidate.root,
			scope
		});
		return {
			...base,
			skills: bucketSkillSummaries(summaries).project
		};
	} catch (error) {
		return {
			...base,
			skills: [],
			error: errorMessage(error)
		};
	}
}
/**
* Lease the default agent preset's current revision, the scope-aware cold read
* the product uses for transcript presentation.
* @param presets - the preset registry, when composed.
* @returns the lease, or `undefined` when the registry is absent or the preset
* cannot be leased; the read then falls back to the global layer.
*/
async function leaseDefaultScope(presets) {
	if (presets === void 0) return void 0;
	try {
		return await presets.acquireScope();
	} catch {
		return;
	}
}
/**
* Read the complete catalog the page renders.
*
* `services.skills` is absent in a composition without the skill registry, and
* the other services narrow the answer instead of failing the read: no preset
* registry means global-layer only, and no Workspace registry means no project
* groups.
* @param services - the optional services the read needs.
* @returns the response envelope.
*/
async function readCatalog(services) {
	const skills = services.skills;
	if (skills === void 0) return {
		ok: false,
		error: {
			code: "skills-unavailable",
			message: "技能服务不可用：当前组合没有挂载技能注册表"
		}
	};
	const lease = await leaseDefaultScope(services.presets);
	try {
		const scope = lease?.key;
		let globalSummaries;
		try {
			globalSummaries = await skills.list(scope === void 0 ? {} : { scope });
		} catch (error) {
			return {
				ok: false,
				error: {
					code: "list-failed",
					message: errorMessage(error)
				}
			};
		}
		const globalBuckets = bucketSkillSummaries(globalSummaries);
		const candidates = await collectProjectCandidates(services.workspaces?.list() ?? []);
		const projects = [];
		for (const candidate of candidates) projects.push(await readProjectGroup(skills, candidate, scope));
		return {
			ok: true,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			user: globalBuckets.user,
			projects,
			other: globalBuckets.other
		};
	} finally {
		await lease?.[Symbol.asyncDispose]();
	}
}
/**
* Install the Skills catalog route.
*
* Call this from a context that already provides `webServer`; the skill and
* Workspace registries stay optional capabilities read on each request.
* @param ctx - plugin context carrying the web server.
*/
function installSkillCatalogHost(ctx) {
	const webServer = lookup(ctx, "webServer");
	if (webServer === void 0) return;
	const handler = async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://localhost");
			const method = (request.method ?? "GET").toUpperCase();
			if (url.pathname !== `/plugin-skill-catalog/state`) {
				sendJson(response, 404, {
					ok: false,
					error: {
						code: "not-found",
						message: `unknown endpoint: ${method} ${url.pathname}`
					}
				});
				return;
			}
			if (method !== "GET") {
				sendJson(response, 405, {
					ok: false,
					error: {
						code: "method-not-allowed",
						message: "use GET"
					}
				});
				return;
			}
			sendJson(response, 200, await readCatalog({
				skills: lookup(ctx, "skills"),
				presets: lookup(ctx, "agentPresets"),
				workspaces: lookup(ctx, "workspaceRegistry")
			}));
		} catch (error) {
			sendJson(response, 500, {
				ok: false,
				error: {
					code: "internal",
					message: errorMessage(error)
				}
			});
		}
	};
	ctx.effect(() => webServer.register({
		kind: "prefix",
		path: SKILL_CATALOG_ROUTE,
		handler
	}), "skill-catalog: state route");
}
//#endregion
//#region src/index.ts
/** Host plugin body: expose the settings and instruction routes. */
function apply(ctx) {
	ctx.inject([
		"webServer",
		"subprocess",
		"workspaceRegistry"
	], (scope) => {
		installGitWorkspaceHost(scope);
	});
	ctx.inject(["webServer"], (scope) => {
		installSkillCatalogHost(scope);
		installAgentInstructionsHost(scope);
	});
}
//#endregion
export { apply };

//# sourceMappingURL=index.js.map