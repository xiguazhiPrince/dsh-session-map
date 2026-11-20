import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMap, isSeq, parseDocument, stringify } from "yaml";
import { createServer } from "node:http";
import { zstdDecompressSync } from "node:zlib";
// src/git-workspace/git.ts
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
function asRecord$3(value) {
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
	const record = asRecord$3(input);
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
// src/git-workspace/host-http.ts
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
// src/agent-instructions/model.ts
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
// src/agent-instructions/host.ts
/** Endpoint table: each sub-path accepts exactly one method. */
const ENDPOINT_METHODS$1 = {
	"/state": "GET",
	"/file": "GET",
	"/save": "POST",
	"/delete": "POST"
};
/** Largest save body: the file cap with room for JSON escaping and the envelope. */
const SAVE_BODY_MAX_BYTES = 2162688;
/** Effect label the route registration is owned by. */
const ROUTE_EFFECT_LABEL$1 = "agent-instructions: routes";
/**
* Map one failure code onto the HTTP status the route answers.
*
* `symlink-not-allowed` and `not-regular-file` are precondition conflicts rather
* than server faults: the client asked to replace something this surface must
* not touch, so they answer 409 like a stale digest.
* @param code - stable failure code.
* @returns the HTTP status.
*/
function statusFor$2(code) {
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
		this.status = statusFor$2(code);
	}
};
/**
* Read one optional service from the global store.
* @param ctx - the plugin's context.
* @param name - the service name.
* @returns the service as the caller's local interface, or `undefined`.
*/
function lookup$5(ctx, name) {
	return ctx.get(name);
}
/** Whether an unknown value is a non-null object record. */
function isObject$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read one non-empty string value, or `undefined` when absent or blank. */
function nonEmptyString$1(value) {
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
	const override = nonEmptyString$1(env[definition.envName]);
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
	if (!isObject$1(observation)) return void 0;
	const projections = isObject$1(observation.projections) ? observation.projections : void 0;
	const values = projections !== void 0 && isObject$1(projections.values) ? projections.values : void 0;
	const header = isObject$1(observation.header) ? observation.header : void 0;
	return (values === void 0 ? void 0 : nonEmptyString$1(values.workingDirectory)) ?? (header === void 0 ? void 0 : nonEmptyString$1(header.cwd));
}
/**
* Release an observation's disposable, if it carries one.
*
* A dispose failure must never fail the read: the cwd has already been copied
* out by the time this runs.
* @param observation - whatever `observeSession` returned.
*/
function disposeObservation(observation) {
	if (!isObject$1(observation)) return;
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
	const observe = isObject$1(service) ? service.observeSession : void 0;
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
	if (!isObject$1(service)) return void 0;
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
	const workingDirectory = isObject$1(services.workingDirectory) ? services.workingDirectory : void 0;
	const agent = liveAgentOf(services.agents, sessionId);
	const ensure = workingDirectory === void 0 ? void 0 : workingDirectory.ensure;
	if (agent !== void 0 && typeof ensure === "function") try {
		const text = nonEmptyString$1(await ensure.call(workingDirectory, agent));
		if (text !== void 0) cwd = text;
	} catch {}
	if (cwd === void 0) cwd = workingDirectory === void 0 ? void 0 : nonEmptyString$1(workingDirectory.defaultDirectory);
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
function sendFailure$1(response, status, code, message) {
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
function sendFromError$1(response, error) {
	if (error instanceof InstructionHostError) {
		sendFailure$1(response, error.status, error.code, error.message);
		return;
	}
	sendFailure$1(response, 500, "internal", errorMessage(error));
}
/**
* Read one required string field from a JSON request body.
* @param source - the parsed body.
* @param key - field name.
* @returns the trimmed, non-empty value.
* @throws InstructionHostError with code `bad-request` when absent or blank.
*/
function requiredField$1(source, key) {
	const value = nonEmptyString$1(source[key]);
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
	return nonEmptyString$1(value);
}
/**
* Read a request body and require a JSON object.
* @param request - incoming request.
* @param maxBytes - largest accepted body.
* @returns the parsed body record.
* @throws InstructionHostError with code `bad-request` or `too-large`.
*/
async function readBodyRecord$1(request, maxBytes) {
	const result = await readJsonBody(request, maxBytes);
	if (!result.ok) {
		if (result.status === 413) throw new InstructionHostError("too-large", "请求体超过大小上限");
		throw new InstructionHostError("bad-request", "请求体不是合法的 JSON 对象");
	}
	if (!isObject$1(result.value)) throw new InstructionHostError("bad-request", "请求体必须是 JSON 对象");
	return result.value;
}
/**
* Read the Session id from a query string.
* @param url - the request URL.
* @returns the Session id.
* @throws InstructionHostError with code `bad-request` when absent.
*/
function querySessionId(url) {
	return requiredField$1({ sessionId: url.searchParams.get("sessionId") }, "sessionId");
}
/**
* Read the candidate id from a query string.
* @param url - the request URL.
* @returns the candidate id.
* @throws InstructionHostError with code `bad-request` when absent.
*/
function queryFileId(url) {
	return requiredField$1({ id: url.searchParams.get("id") }, "id");
}
/**
* Read the three optional capabilities the routes use, per request.
* @param ctx - the plugin's context.
* @returns whatever the composition currently mounts.
*/
function instructionServices(ctx) {
	return {
		sessionQuery: lookup$5(ctx, "sessionQuery"),
		workingDirectory: lookup$5(ctx, "workingDirectory"),
		agents: lookup$5(ctx, "agents")
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
async function dispatch$1(ctx, request, response) {
	const url = new URL(request.url ?? "/", "http://localhost");
	const method = (request.method ?? "GET").toUpperCase();
	const subpath = url.pathname.startsWith(`/plugin-agent-instructions/`) ? url.pathname.slice(26) : url.pathname;
	const expected = ENDPOINT_METHODS$1[subpath];
	if (expected === void 0) {
		sendFailure$1(response, 404, "bad-request", `未知的接口：${method} ${url.pathname}`);
		return;
	}
	if (method !== expected) {
		sendFailure$1(response, 405, "bad-request", `该接口只接受 ${expected} 请求`);
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
			const body = await readBodyRecord$1(request, SAVE_BODY_MAX_BYTES);
			const sessionId = requiredField$1(body, "sessionId");
			const id = requiredField$1(body, "id");
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
			const body = await readBodyRecord$1(request);
			const sessionId = requiredField$1(body, "sessionId");
			const id = requiredField$1(body, "id");
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
	const webServer = lookup$5(ctx, "webServer");
	if (webServer === void 0) return;
	const handler = async (request, response) => {
		if (!isTrustedRequest(request)) {
			sendFailure$1(response, 403, "not-trusted", "仅允许本机同源请求访问指令文件");
			return;
		}
		try {
			await dispatch$1(ctx, request, response);
		} catch (error) {
			sendFromError$1(response, error);
		}
	};
	ctx.effect(() => webServer.register({
		kind: "prefix",
		path: AGENT_INSTRUCTIONS_ROUTE,
		handler
	}), ROUTE_EFFECT_LABEL$1);
}
// src/git-workspace/route.ts
/**
* The route family shared by the Git workspace settings page and the Git tool
* window.
* @module dsh-session-map/git-workspace/route
*/
const GIT_WORKSPACE_ROUTE = "/plugin-git-workspace";
// src/git-workspace/host-clone.ts
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
// src/git-workspace/git-command.ts
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
// src/git-workspace/git-parse.ts
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
// src/git-workspace/git-repo.ts
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
// src/git-workspace/host-errors.ts
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
function statusFor$1(code) {
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
// src/git-workspace/git-actions.ts
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
function asRecord$2(value) {
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
	const record = asRecord$2(input);
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
// src/git-workspace/host-process.ts
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
// src/git-workspace/host-actions.ts
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
function asRecord$1(value) {
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
	const value = asRecord$1(body)?.["confirm"];
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
			if (!parsed.ok) throw new RouteFailure(parsed.code, statusFor$1(parsed.code), parsed.message);
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
				sendJson$1(response, statusFor$1(error.code), {
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
	const parsed = asRecord$1(value);
	if (parsed === void 0) throw new RouteFailure("invalid-request", 400, "the request body must be an object");
	return parsed;
}
/** Read the job id out of a cancel body. */
function requiredIdFrom(body) {
	return stringField(body, "id");
}
// src/git-workspace/host-git.ts
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
				sendJson$1(response, statusFor$1(error.code), {
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
// src/git-workspace/host.ts
/**
* Read one optional service from the global store.
* @param ctx - the plugin's context.
* @param name - the service name.
* @returns the service as the caller's local interface, or `undefined`.
*/
function lookup$4(ctx, name) {
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
	const webServer = lookup$4(ctx, "webServer");
	const subprocess = lookup$4(ctx, "subprocess");
	const workspaces = lookup$4(ctx, "workspaceRegistry");
	if (webServer === void 0 || subprocess === void 0 || workspaces === void 0) return;
	const clone = createCloneHandler({
		subprocess,
		workspaces,
		workingDirectory: lookup$4(ctx, "workingDirectory")
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
// src/mcp-manager/model.ts
/**
* Shared vocabulary for the Conversation → MCP tab.
*
* Manages native `@deepseek-ai/dsh-mcp-client` rows in the current profile's
* `cordis.patch.yml`, kept inside a marker-delimited block owned by this plugin.
* The Host half owns filesystem I/O, probes, OAuth, and loader hot-apply; the
* browser half renders the approved design screens and talks only through the
* same-origin route family below.
*
* This module stays platform-neutral — no Node imports — because the browser
* bundle imports it too.
*
* @module dsh-session-map/mcp-manager/model
*/
/** Route family shared by the Host routes and the browser tab. */
const MCP_MANAGER_ROUTE = "/plugin-mcp-manager";
/** Marker that opens this plugin's managed block inside cordis.patch.yml. */
const MCP_BLOCK_BEGIN = "# >>> dsh-session-map:mcp:begin";
/** Marker that closes this plugin's managed block inside cordis.patch.yml. */
const MCP_BLOCK_END = "# <<< dsh-session-map:mcp:end";
/** Package name every managed row must carry. */
const MCP_CLIENT_PACKAGE = "@deepseek-ai/dsh-mcp-client";
/** Prefix for row ids this plugin creates (`mcp-session-map-<serverName>`). */
const MCP_ROW_ID_PREFIX = "mcp-session-map-";
/** serverName / namespace rule from dsh-mcp-client. */
const MCP_SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
/** Default tools/call timeout, matching the product. */
const MCP_DEFAULT_TIMEOUT_MS = 6e4;
/** Largest JSON body any MCP manager route accepts. */
const MCP_MAX_BODY_BYTES = 1048576;
/**
* Whether an unknown value is a plain object record.
* @param value - candidate.
*/
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Read one non-empty trimmed string, or undefined.
* @param value - candidate.
*/
function nonEmptyString(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* Keep only string→string entries from a map-like value.
* @param value - candidate.
*/
function stringMap(value) {
	if (!isObject(value)) return {};
	const out = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== "string") continue;
		const name = key.trim();
		if (name === "") continue;
		out[name] = item;
	}
	return out;
}
/**
* Validate and normalize a create/update form payload.
* @param input - raw form value.
* @returns a clean input, or throws Error with a Chinese message.
*/
function normalizeServerInput(input) {
	if (!isObject(input)) throw new Error("请求体无效");
	const name = nonEmptyString(input.name);
	if (name === void 0 || !MCP_SERVER_NAME_RE.test(name)) throw new Error("名称只能是 1–32 位字母、数字、下划线或连字符");
	const transport = input.transport === "http" ? "http" : "stdio";
	const enabled = input.enabled !== false;
	const timeoutRaw = Number(input.timeoutMs);
	const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.round(timeoutRaw) : void 0;
	const reconnectEnabled = input.reconnectEnabled === false ? false : true;
	const id = nonEmptyString(input.id);
	if (transport === "http") {
		const url = nonEmptyString(input.url);
		if (url === void 0 || !/^https?:\/\//i.test(url)) throw new Error("请填写以 http(s):// 开头的地址");
		return {
			...id !== void 0 ? { id } : {},
			name,
			transport,
			enabled,
			url,
			headers: stringMap(input.headers),
			...timeoutMs !== void 0 ? { timeoutMs } : {},
			reconnectEnabled
		};
	}
	const command = nonEmptyString(input.command);
	if (command === void 0) throw new Error("请填写启动命令");
	const args = Array.isArray(input.args) ? input.args.map((item) => String(item)).filter((item) => item.length > 0) : [];
	return {
		...id !== void 0 ? { id } : {},
		name,
		transport,
		enabled,
		command,
		args,
		env: stringMap(input.env),
		cwd: nonEmptyString(input.cwd) ?? "",
		...timeoutMs !== void 0 ? { timeoutMs } : {},
		reconnectEnabled
	};
}
/**
* Build a patch row from a normalized form input.
* @param input - validated form.
* @param previous - existing row when updating.
*/
function buildPatchRow(input, previous) {
	const previousConfig = previous?.config;
	const config = previousConfig ? { ...previousConfig } : {};
	config.serverName = input.name;
	if (input.transport === "http") {
		config.transport = "streamable-http";
		config.url = input.url;
		const headers = input.headers ?? {};
		if (Object.keys(headers).length > 0) config.headers = headers;
		else delete config.headers;
		for (const key of [
			"command",
			"args",
			"env",
			"cwd"
		]) delete config[key];
	} else {
		config.transport = "stdio";
		config.command = input.command;
		const args = input.args ?? [];
		if (args.length > 0) config.args = args;
		else delete config.args;
		const env = input.env ?? {};
		if (Object.keys(env).length > 0) config.env = env;
		else delete config.env;
		const cwd = input.cwd?.trim() ?? "";
		if (cwd !== "") config.cwd = cwd;
		else delete config.cwd;
		delete config.url;
		delete config.headers;
	}
	if (input.timeoutMs !== void 0 && input.timeoutMs > 0 && input.timeoutMs !== 6e4) config.toolCallTimeoutMs = input.timeoutMs;
	else delete config.toolCallTimeoutMs;
	if (input.reconnectEnabled === false) config.reconnect = {
		...isObject(config.reconnect) ? config.reconnect : {},
		enabled: false
	};
	else if (isObject(config.reconnect)) {
		const next = { ...config.reconnect };
		delete next.enabled;
		if (Object.keys(next).length === 0) delete config.reconnect;
		else config.reconnect = next;
	}
	const row = {
		id: previous?.id ?? `mcp-session-map-${input.name}`,
		name: MCP_CLIENT_PACKAGE,
		config
	};
	if (input.enabled === false) return {
		...row,
		disabled: true
	};
	return row;
}
/**
* Map one patch row to a UI view without live/probe fields filled in.
* @param row - patch row.
*/
function viewFromPatchRow(row) {
	const config = row.config;
	const http = config.transport === "streamable-http";
	const reconnectEnabled = !(isObject(config.reconnect) && config.reconnect.enabled === false);
	return {
		id: row.id,
		name: String(config.serverName ?? ""),
		transport: http ? "http" : "stdio",
		enabled: row.disabled !== true,
		state: row.disabled === true ? "off" : "idle",
		message: "",
		tools: 0,
		live: false,
		oauth: false,
		command: http ? "" : String(config.command ?? ""),
		args: http ? [] : Array.isArray(config.args) ? config.args.map((item) => String(item)) : [],
		env: http ? {} : stringMap(config.env),
		cwd: http ? "" : String(config.cwd ?? ""),
		url: http ? String(config.url ?? "") : "",
		headers: http ? stringMap(config.headers) : {},
		timeoutMs: Number.isFinite(config.toolCallTimeoutMs) ? Number(config.toolCallTimeoutMs) : MCP_DEFAULT_TIMEOUT_MS,
		reconnectEnabled
	};
}
/**
* Mask secret-looking map values for display.
* @param map - env or headers.
*/
function maskSecretMap(map) {
	const out = {};
	for (const [key, value] of Object.entries(map)) out[key] = /authorization|token|key|secret|password|cookie/i.test(key) ? "••••••••" : value;
	return out;
}
/**
* Sort servers by name (case-insensitive).
* @param servers - views.
*/
function sortServers(servers) {
	return [...servers].sort((a, b) => a.name.localeCompare(b.name, "en"));
}
/**
* Parse one Claude/Codex-style mcpServers JSON object into form inputs.
* @param text - pasted JSON.
*/
function parseImportText(text) {
	const trimmed = text.trim();
	if (trimmed === "") throw new Error("导入内容为空");
	let parsed;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		throw new Error("导入内容不是合法 JSON");
	}
	if (isObject(parsed) && isObject(parsed.mcpServers)) return Object.entries(parsed.mcpServers).map(([name, value]) => importEntryToInput(name, value));
	if (Array.isArray(parsed)) return parsed.map((item, index) => {
		if (!isObject(item)) throw new Error(`第 ${index + 1} 项不是对象`);
		const name = nonEmptyString(item.name) ?? nonEmptyString(item.serverName);
		if (name === void 0) throw new Error(`第 ${index + 1} 项缺少 name`);
		return importEntryToInput(name, item);
	});
	if (isObject(parsed)) return Object.entries(parsed).map(([name, value]) => importEntryToInput(name, value));
	throw new Error("无法识别的导入格式");
}
/**
* Convert one imported entry into a form input.
* @param name - server name.
* @param value - entry body.
*/
function importEntryToInput(name, value) {
	if (!isObject(value)) throw new Error(`服务器 ${name} 的配置无效`);
	const command = nonEmptyString(value.command);
	const url = nonEmptyString(value.url);
	if (url !== void 0 || value.type === "http" || value.transport === "http" || value.transport === "streamable-http") return normalizeServerInput({
		name,
		transport: "http",
		enabled: value.disabled !== true && value.enabled !== false,
		url: url ?? "",
		headers: value.headers,
		timeoutMs: value.timeoutMs ?? value.toolCallTimeoutMs
	});
	return normalizeServerInput({
		name,
		transport: "stdio",
		enabled: value.disabled !== true && value.enabled !== false,
		command: command ?? "",
		args: value.args,
		env: value.env,
		cwd: value.cwd,
		timeoutMs: value.timeoutMs ?? value.toolCallTimeoutMs
	});
}
/**
* Build a Claude-compatible mcpServers export object text.
* @param servers - current views.
*/
function buildExportText(servers) {
	const mcpServers = {};
	for (const server of servers) if (server.transport === "http") {
		const entry = { url: server.url };
		if (Object.keys(server.headers).length > 0) entry.headers = { ...server.headers };
		if (!server.enabled) entry.disabled = true;
		mcpServers[server.name] = entry;
	} else {
		const entry = { command: server.command };
		if (server.args.length > 0) entry.args = [...server.args];
		if (Object.keys(server.env).length > 0) entry.env = { ...server.env };
		if (server.cwd !== "") entry.cwd = server.cwd;
		if (!server.enabled) entry.disabled = true;
		mcpServers[server.name] = entry;
	}
	return `${JSON.stringify({ mcpServers }, null, 2)}\n`;
}
// src/mcp-manager/oauth.ts
/**
* MCP manager — remote-server OAuth (authorization code + PKCE, loopback callback).
*
* The product mcp-client only accepts static headers, so this helper obtains a
* token and hands the Authorization header back to the Host, which writes it
* into the patch row. Client records live under
* `$DSH_HOME/storages/session-map/mcp-oauth.json`.
*
* Ported from the dsh-mcp-console reference into typed ESM; discovery and PKCE
* behaviour stay the same so Atlassian-style MCP servers keep working.
*
* @module dsh-session-map/mcp-manager/oauth
*/
/** Discovery answers change rarely; keep them so a login click is cheap. */
const DISCOVERY_TTL_MS = 6e5;
const DISCOVERY = /* @__PURE__ */ new Map();
/**
* Normalize an MCP server URL: require a scheme, drop a trailing slash.
* @param url - raw URL from the patch row.
*/
function normalizeServerUrl(url) {
	let value = String(url ?? "").trim();
	if (value === "") throw new Error("缺少服务器 URL");
	if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
	return value.replace(/\/+$/, "");
}
/**
* Prefer MCP agent-interface scopes when a resource advertises both classic
* REST scopes and agent ones (Atlassian pattern).
* @param scopes - scopes_supported from discovery.
*/
function pickScopes(scopes) {
	if (!Array.isArray(scopes) || scopes.length === 0) return [];
	const all = scopes.filter((scope) => typeof scope === "string");
	const agent = all.filter((scope) => scope.endsWith(":agent-interface"));
	if (agent.length === 0) return all;
	return [
		"offline_access",
		"read:me",
		"read:account",
		"email"
	].filter((scope) => all.includes(scope)).concat(agent);
}
/**
* Fetch JSON from one URL when the response is OK and object-shaped.
* @param url - absolute URL.
* @param fetchImpl - fetch implementation.
*/
async function fetchJsonObject(url, fetchImpl) {
	try {
		const response = await fetchImpl(url, { headers: { accept: "application/json" } });
		if (response === void 0 || response === null || response.ok !== true) return void 0;
		const body = await response.json();
		if (typeof body !== "object" || body === null || Array.isArray(body)) return void 0;
		return body;
	} catch {
		return;
	}
}
/**
* Discover authorization-server metadata at the endpoint, then its origin.
* @param serverUrl - MCP HTTP endpoint.
* @param fetchImpl - fetch implementation.
*/
async function discoverMetadata(serverUrl, fetchImpl = fetch) {
	const base = normalizeServerUrl(serverUrl);
	let origin = "";
	try {
		origin = new URL(base).origin;
	} catch {
		origin = "";
	}
	const bases = origin !== "" && origin !== base ? [base, origin] : [base];
	for (const candidate of bases) for (const suffix of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
		const body = await fetchJsonObject(`${candidate}${suffix}`, fetchImpl);
		if (body !== void 0 && typeof body.token_endpoint === "string") return body;
	}
}
/**
* Discover RFC 9728 protected-resource metadata for one MCP endpoint.
* @param serverUrl - MCP HTTP endpoint.
* @param fetchImpl - fetch implementation.
*/
async function discoverProtectedResource(serverUrl, fetchImpl = fetch) {
	const base = normalizeServerUrl(serverUrl);
	let parsed;
	try {
		parsed = new URL(base);
	} catch {
		return;
	}
	const origin = parsed.origin;
	const path = parsed.pathname.replace(/\/+$/, "");
	const candidates = [];
	if (path !== "" && path !== "/") candidates.push(`${origin}/.well-known/oauth-protected-resource${path}`);
	candidates.push(`${origin}/.well-known/oauth-protected-resource`);
	candidates.push(`${base}/.well-known/oauth-protected-resource`);
	for (const url of candidates) {
		const body = await fetchJsonObject(url, fetchImpl);
		if (body !== void 0 && typeof body.resource === "string" && Array.isArray(body.authorization_servers) && body.authorization_servers.length > 0) return body;
	}
}
/**
* Discover authorization-server metadata for one issuer URL.
* @param issuer - authorization server issuer.
* @param fetchImpl - fetch implementation.
*/
async function discoverAuthorizationServer(issuer, fetchImpl = fetch) {
	let parsed;
	try {
		parsed = new URL(issuer);
	} catch {
		return;
	}
	const origin = parsed.origin;
	const path = parsed.pathname.replace(/\/+$/, "");
	const root = issuer.replace(/\/+$/, "");
	const candidates = [];
	if (path !== "" && path !== "/") {
		candidates.push(`${origin}/.well-known/oauth-authorization-server${path}`);
		candidates.push(`${root}/.well-known/oauth-authorization-server`);
		candidates.push(`${origin}/.well-known/openid-configuration${path}`);
		candidates.push(`${root}/.well-known/openid-configuration`);
	} else {
		candidates.push(`${origin}/.well-known/oauth-authorization-server`);
		candidates.push(`${origin}/.well-known/openid-configuration`);
	}
	for (const url of candidates) {
		const body = await fetchJsonObject(url, fetchImpl);
		if (body !== void 0 && typeof body.token_endpoint === "string") return body;
	}
}
/**
* Resolve OAuth for one MCP URL without using the discovery cache.
* @param serverUrl - MCP HTTP endpoint.
* @param fetchImpl - fetch implementation.
*/
async function resolveOAuthUncached(serverUrl, fetchImpl) {
	const prm = await discoverProtectedResource(serverUrl, fetchImpl);
	if (prm !== void 0) for (const issuer of prm.authorization_servers) {
		const metadata = await discoverAuthorizationServer(issuer, fetchImpl);
		if (metadata !== void 0) return {
			metadata,
			resource: prm.resource,
			scopes: pickScopes(prm.scopes_supported)
		};
	}
	const metadata = await discoverMetadata(serverUrl, fetchImpl);
	if (metadata === void 0) return void 0;
	return {
		metadata,
		resource: normalizeServerUrl(serverUrl),
		scopes: pickScopes(metadata.scopes_supported)
	};
}
/**
* Resolve OAuth discovery for one MCP URL, with a short in-memory cache.
* @param serverUrl - MCP HTTP endpoint.
* @param fetchImpl - fetch implementation.
*/
async function resolveOAuth(serverUrl, fetchImpl = fetch) {
	const cacheKey = normalizeServerUrl(serverUrl);
	const cached = DISCOVERY.get(cacheKey);
	if (cached !== void 0 && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;
	const resolved = await resolveOAuthUncached(serverUrl, fetchImpl);
	DISCOVERY.set(cacheKey, {
		at: Date.now(),
		value: resolved
	});
	return resolved;
}
/**
* Load the OAuth store from disk, or an empty store when absent.
* @param file - absolute store path.
*/
async function loadStore(file) {
	try {
		const parsed = JSON.parse(await readFile(file, "utf8"));
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			const record = parsed;
			return {
				version: 1,
				servers: isRecord(record.servers) ? record.servers : {},
				clients: isRecord(record.clients) ? record.clients : {}
			};
		}
	} catch {}
	return {
		version: 1,
		servers: {},
		clients: {}
	};
}
/**
* Persist the OAuth store atomically enough for this surface (mkdir + write).
* @param file - absolute store path.
* @param store - store to write.
*/
async function saveStore(file, store) {
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify({
		version: 1,
		servers: store.servers ?? {},
		clients: store.clients ?? {}
	}, null, 2)}\n`, "utf8");
}
/** Whether a value is a plain object record. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Create a PKCE verifier and S256 challenge.
*/
function createPkce() {
	const verifier = randomBytes(32).toString("base64url");
	return {
		verifier,
		challenge: createHash("sha256").update(verifier).digest("base64url")
	};
}
/**
* Dynamically register a public client when the AS supports it.
* @param metadata - authorization-server metadata.
* @param redirectUri - loopback redirect URI.
* @param fetchImpl - fetch implementation.
*/
async function registerClient(metadata, redirectUri, fetchImpl = fetch) {
	const endpoint = metadata.registration_endpoint;
	if (typeof endpoint !== "string" || endpoint === "") return void 0;
	const response = await fetchImpl(endpoint, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json"
		},
		body: JSON.stringify({
			client_name: "DSH Session Map MCP",
			redirect_uris: [redirectUri],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none"
		})
	});
	if (response === void 0 || response === null || response.ok !== true) throw new Error(`动态客户端注册失败（HTTP ${String(response?.status ?? "?")}）`);
	const body = await response.json();
	if (!isRecord(body) || typeof body.client_id !== "string") throw new Error("动态客户端注册返回里没有 client_id");
	return { client_id: body.client_id };
}
/**
* Build the browser authorization URL with PKCE + optional resource.
* @param metadata - authorization-server metadata.
* @param clientId - OAuth client id.
* @param redirectUri - loopback redirect URI.
* @param challenge - PKCE challenge.
* @param state - CSRF state.
* @param scope - space-delimited scope string.
* @param resource - RFC 8707 resource indicator.
*/
function buildAuthorizationUrl(metadata, clientId, redirectUri, challenge, state, scope, resource) {
	const endpoint = metadata.authorization_endpoint;
	if (typeof endpoint !== "string" || endpoint === "") throw new Error("发现文档里没有 authorization_endpoint");
	const url = new URL(endpoint);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("state", state);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	const effectiveScope = scope ?? (Array.isArray(metadata.scopes_supported) ? metadata.scopes_supported.join(" ") : void 0);
	if (typeof effectiveScope === "string" && effectiveScope !== "") url.searchParams.set("scope", effectiveScope);
	if (typeof effectiveScope === "string" && effectiveScope.includes("offline_access")) url.searchParams.append("prompt", "consent");
	if (typeof resource === "string" && resource !== "") url.searchParams.set("resource", resource);
	return url.toString();
}
/**
* Start a one-shot loopback HTTP server that captures the authorization code.
* @param expectedState - CSRF state the callback must echo.
* @param timeoutMs - how long to wait for the browser callback.
* @param preferredPort - try this port first so a registered client can be reused.
*/
async function startLoopbackServer(expectedState, timeoutMs = 3e5, preferredPort = 0) {
	const listen = (port) => new Promise((resolveOuter, rejectOuter) => {
		let settle;
		const outcome = new Promise((resolve, reject) => {
			settle = (value) => {
				if (value instanceof Error) reject(value);
				else resolve(value);
			};
		});
		outcome.catch(() => void 0);
		const server = createServer((request, response) => {
			const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			if (requestUrl.pathname !== "/callback") {
				response.end("<meta charset=utf-8><p>Not found</p>");
				return;
			}
			const error = requestUrl.searchParams.get("error");
			const state = requestUrl.searchParams.get("state");
			if (error !== null) {
				response.end(`<meta charset=utf-8><p>授权被拒绝：${error}</p>`);
				settle(/* @__PURE__ */ new Error(`授权被拒绝：${error}`));
				return;
			}
			if (state !== expectedState) {
				response.end("<meta charset=utf-8><p>state 不匹配，已忽略。</p>");
				settle(/* @__PURE__ */ new Error("回调 state 不匹配"));
				return;
			}
			response.end("<meta charset=utf-8><p>授权成功，可以关闭这个页面。</p>");
			settle({ code: requestUrl.searchParams.get("code") ?? "" });
		});
		const timer = setTimeout(() => settle(/* @__PURE__ */ new Error("等待授权回调超时")), timeoutMs);
		timer.unref?.();
		server.on("error", (error) => {
			if (port !== 0) server.close();
			rejectOuter(error);
		});
		server.listen(port, "127.0.0.1", () => {
			const address = server.address();
			resolveOuter({
				redirectUri: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/callback`,
				waitForCode: () => outcome,
				close: () => new Promise((done) => {
					clearTimeout(timer);
					server.close(() => done());
				})
			});
		});
	});
	if (preferredPort !== 0) try {
		return await listen(preferredPort);
	} catch (error) {
		if ((isRecord(error) ? error.code : void 0) !== "EADDRINUSE") throw error;
	}
	return listen(0);
}
/**
* Exchange an authorization code for tokens.
* @param metadata - authorization-server metadata.
* @param clientId - OAuth client id.
* @param code - authorization code.
* @param verifier - PKCE verifier.
* @param redirectUri - loopback redirect URI.
* @param resource - optional resource indicator.
* @param fetchImpl - fetch implementation.
*/
async function exchangeCode(metadata, clientId, code, verifier, redirectUri, resource, fetchImpl = fetch) {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		client_id: clientId,
		redirect_uri: redirectUri,
		code_verifier: verifier
	});
	if (typeof resource === "string" && resource !== "") body.set("resource", resource);
	const response = await fetchImpl(metadata.token_endpoint, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			accept: "application/json"
		},
		body: body.toString()
	});
	if (response === void 0 || response === null || response.ok !== true) throw new Error(`换令牌失败（HTTP ${String(response?.status ?? "?")}）`);
	const tokens = await response.json();
	if (!isRecord(tokens) || typeof tokens.access_token !== "string") throw new Error("令牌响应里没有 access_token");
	return tokens;
}
/**
* Format the Authorization header value from a token response.
* @param tokens - token response.
*/
function authorizationHeader(tokens) {
	return `${typeof tokens.token_type === "string" && tokens.token_type !== "" ? tokens.token_type : "Bearer"} ${String(tokens.access_token ?? "")}`;
}
/**
* Create a random opaque state string.
* @param prefix - optional prefix (e.g. `flow-`).
*/
function createState(prefix = "") {
	return `${prefix}${randomUUID().replace(/-/g, "")}`;
}
// src/mcp-manager/host.ts
/**
* yaml `!!js` tag: parse the expression into `{ __js }` and stringify it back
* as `!!js …`, so a read-modify-write round-trip never corrupts the loader
* expressions dsh recommends for referenced credentials.
*/
const JS_EXPR_TAG = {
	tag: "tag:yaml.org,2002:js",
	resolve: (value) => ({ __js: value }),
	identify: (value) => typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.__js === "string",
	stringify: (item) => String(item.value.__js)
};
/** Legacy markers from dsh-mcp-console — migrated into our markers on first load. */
const LEGACY_CONSOLE_BEGIN = "# >>> dsh-mcp-console:begin";
const LEGACY_CONSOLE_END = "# <<< dsh-mcp-console:end";
/** Even older skill-panel markers, also migrated. */
const LEGACY_SKILL_BEGIN = "# >>> dsh-skill-mcp-panel:mcp:begin";
const LEGACY_SKILL_END = "# <<< dsh-skill-mcp-panel:mcp:end";
/** Probe cache TTL and per-probe timeout, matching the reference. */
const PROBE_TTL_MS = 45e3;
const PROBE_TIMEOUT_MS = 6e3;
/** Preferred OAuth callback port so a registered client can be reused. */
const OAUTH_CALLBACK_PORT = 33418;
/** Endpoint table: each sub-path accepts exactly one method. */
const ENDPOINT_METHODS = {
	"/state": "GET",
	"/server": "POST",
	"/toggle": "POST",
	"/remove": "POST",
	"/adopt": "POST",
	"/reconnect": "POST",
	"/import": "POST",
	"/export": "GET",
	"/diagnose": "POST",
	"/oauth/start": "POST",
	"/oauth/poll": "GET"
};
/** Effect label the route registration is owned by. */
const ROUTE_EFFECT_LABEL = "mcp-manager: routes";
const OAUTH_FLOWS = /* @__PURE__ */ new Map();
const PROBES = /* @__PURE__ */ new Map();
/**
* Map one failure code onto the HTTP status the route answers.
* @param code - stable failure code.
*/
function statusFor(code) {
	switch (code) {
		case "not-trusted": return 403;
		case "bad-request": return 400;
		case "not-found": return 404;
		case "conflict": return 409;
		case "patch-error":
		case "loader-error":
		case "oauth-error":
		case "diagnose-error":
		case "internal": return 500;
	}
}
/** One route failure with its HTTP mapping. */
var McpHostError = class extends Error {
	code;
	status;
	constructor(code, message) {
		super(message);
		this.name = "McpHostError";
		this.code = code;
		this.status = statusFor(code);
	}
};
/**
* Read one optional service from the global store.
* @param ctx - the plugin's context.
* @param name - the service name.
*/
function lookup$3(ctx, name) {
	return ctx.get(name);
}
/**
* Resolve `$DSH_HOME`, defaulting to `~/.dsh`.
* @param env - environment; defaults to `process.env`.
* @param home - OS home; defaults to `os.homedir()`.
*/
function resolveDshHome$1(env = process.env, home = homedir()) {
	const configured = nonEmptyString(env.DSH_HOME);
	return resolve(configured ?? join(home, ".dsh"));
}
/**
* Resolve the current profile directory.
*
* `DSH_PROFILE_DIR` / `DSH_PROFILE` win when set, but the Host process does
* not always carry them: Desktop and the web runner inject `DSH_*` facts into
* tool shells, not into their own environment. Blindly defaulting to
* `desktop` then edits the wrong profile's patch file, so the bundle locates
* the profile that actually mounted it before falling back.
*
* @param env - environment; defaults to `process.env`.
* @param home - OS home; defaults to `os.homedir()`.
*/
function resolveProfileDir(env = process.env, home = homedir()) {
	const configured = nonEmptyString(env.DSH_PROFILE_DIR);
	if (configured !== void 0) return resolve(configured);
	const named = nonEmptyString(env.DSH_PROFILE);
	if (named !== void 0) return join(resolveDshHome$1(env, home), "profiles", named);
	const detected = detectProfileDir(env, home);
	if (detected !== void 0) return detected;
	return join(resolveDshHome$1(env, home), "profiles", "desktop");
}
/**
* This package's directory with symlinks resolved: the nearest ancestor of
* this module that holds a `package.json`. Works for the built `lib/index.js`
* and for the TypeScript source a test imports.
*/
function ownPackageDir() {
	let dir;
	try {
		dir = realpathSync(dirname(fileURLToPath(import.meta.url)));
	} catch {
		return;
	}
	for (let depth = 0; depth < 8; depth += 1) {
		try {
			if (statSync(join(dir, "package.json")).isFile()) return dir;
		} catch {}
		const parent = dirname(dir);
		if (parent === dir) return void 0;
		dir = parent;
	}
}
/** Manifest names read so far, keyed by package directory. */
const OWN_PACKAGE_NAMES = /* @__PURE__ */ new Map();
/** This package's `name`, read from its own manifest once per directory. */
function ownPackageName(dir) {
	if (OWN_PACKAGE_NAMES.has(dir)) return OWN_PACKAGE_NAMES.get(dir);
	let name;
	try {
		const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		name = isObject(parsed) ? nonEmptyString(parsed.name) : void 0;
	} catch {
		name = void 0;
	}
	OWN_PACKAGE_NAMES.set(dir, name);
	return name;
}
/**
* Profile directory implied by one resolved package path: a package living in
* `<dshHome>/profiles/<name>/node_modules/…` belongs to profile `<name>`.
* Pure, so the rule can be tested without filesystem fixtures.
* @param packageDir - resolved directory of this bundle.
*/
function profileDirFromOwnPath(packageDir) {
	const marker = `${sep}profiles${sep}`;
	const at = packageDir.lastIndexOf(marker);
	if (at < 0) return void 0;
	const name = packageDir.slice(at + marker.length).split(sep)[0];
	if (name === void 0 || name === "" || name.startsWith(".")) return void 0;
	return packageDir.slice(0, at + marker.length) + name;
}
/**
* Locate the profile that mounted this bundle.
*
* An installed copy resolves inside its own profile, so the path answers
* directly. A `link:` copy (a development checkout) resolves outside every
* profile, so each profile's `node_modules` entry is compared with this
* package's real path; several matches resolve to the most recently touched
* `cordis.patch.yml`.
*
* @param env - environment for path resolution.
* @param home - OS home.
* @param own - this package's resolved directory; defaults to the real one.
* @param profilesRoot - profiles root; defaults to `<dshHome>/profiles`.
*/
function detectProfileDir(env = process.env, home = homedir(), own = ownPackageDir(), profilesRoot = join(resolveDshHome$1(env, home), "profiles")) {
	if (own === void 0) return void 0;
	const fromPath = profileDirFromOwnPath(own);
	if (fromPath !== void 0) return fromPath;
	const packageName = ownPackageName(own);
	if (packageName === void 0) return void 0;
	let names;
	try {
		names = readdirSync(profilesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		return;
	}
	const matches = [];
	for (const name of names) {
		const entry = join(profilesRoot, name, "node_modules", ...packageName.split("/"));
		let resolved;
		try {
			resolved = realpathSync(entry);
		} catch {
			continue;
		}
		if (resolved !== own) continue;
		let touched = 0;
		try {
			touched = statSync(join(profilesRoot, name, "cordis.patch.yml")).mtimeMs;
		} catch {}
		matches.push({
			dir: join(profilesRoot, name),
			touched
		});
	}
	if (matches.length === 0) return void 0;
	if (matches.length === 1) return matches[0].dir;
	const [newest] = [...matches].sort((a, b) => b.touched - a.touched);
	return newest?.dir;
}
/** Absolute path of the profile's `cordis.patch.yml`. */
function resolvePatchFile(env = process.env, home = homedir()) {
	return join(resolveProfileDir(env, home), "cordis.patch.yml");
}
/** Absolute path of the OAuth client/token store. */
function resolveOAuthFile(env = process.env, home = homedir()) {
	return join(resolveDshHome$1(env, home), "storages", "session-map", "mcp-oauth.json");
}
/**
* Read the raw patch text; a missing file reads as `[]\n`.
* @param env - environment for path resolution.
*/
async function readPatchText(env = process.env) {
	const file = resolvePatchFile(env);
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if ((isObject(error) ? error.code : void 0) === "ENOENT") return "[]\n";
		throw new McpHostError("patch-error", `读取 profile patch 失败：${errorMessage(error)}`);
	}
}
/** Parse the managed YAML block body into ours / foreign / inserted rows. */
function parseBlock(text) {
	const doc = parseDocument(text, {
		logLevel: "silent",
		customTags: [JS_EXPR_TAG]
	});
	if (doc.errors.length > 0) throw new McpHostError("patch-error", `配置块解析失败：${doc.errors[0]?.message ?? "unknown"}`);
	const value = doc.toJS();
	const ours = [];
	const inserted = [];
	const foreign = [];
	for (const entry of Array.isArray(value) ? value : []) {
		if (!isObject(entry)) continue;
		const isInsert = Array.isArray(entry.insert);
		const members = isInsert ? entry.insert : [entry];
		for (const row of members) {
			if (!isObject(row)) continue;
			if (row.name === "@deepseek-ai/dsh-mcp-client") ours.push(row);
			else if (isInsert) inserted.push(row);
			else foreign.push(row);
		}
	}
	return {
		ours,
		foreign,
		inserted
	};
}
/** Start of the line containing `index`. */
function lineStart(text, index) {
	return text.lastIndexOf("\n", index - 1) + 1;
}
/** End of the line containing `index` (inclusive of the newline when present). */
function lineEnd(text, index) {
	const at = text.indexOf("\n", index);
	return at < 0 ? text.length : at + 1;
}
/** Locate one marker-delimited block, or null when absent / inverted. */
function findBlock(raw, beginMark, endMark) {
	const begin = raw.indexOf(beginMark);
	const end = raw.indexOf(endMark);
	if (begin < 0 || end < 0 || end < begin) return null;
	return {
		start: lineStart(raw, begin),
		end: lineEnd(raw, end + endMark.length),
		body: raw.slice(begin + beginMark.length, end)
	};
}
/** Render the managed block with our rows plus preserved foreign / inserted. */
function renderBlock(rows, foreign = [], inserted = []) {
	const parts = [];
	const inserts = [...rows, ...inserted];
	if (inserts.length > 0) {
		const body = inserts.map((row) => stringify([row], {
			lineWidth: 0,
			customTags: [JS_EXPR_TAG]
		}).replace(/\n+$/, "").split("\n").map((line) => `    ${line}`).join("\n")).join("\n");
		parts.push(`- insert:\n${body}\n`);
	}
	for (const row of foreign) parts.push(stringify([row], {
		lineWidth: 0,
		customTags: [JS_EXPR_TAG]
	}));
	return `${MCP_BLOCK_BEGIN}\n${parts.join("")}${MCP_BLOCK_END}\n`;
}
/** Whether the patch text is only our empty marker block (no YAML nodes). */
function isEmptyMarkerOnly(text) {
	return text.replace(MCP_BLOCK_BEGIN, "").replace(MCP_BLOCK_END, "").replace(LEGACY_CONSOLE_BEGIN, "").replace(LEGACY_CONSOLE_END, "").replace(LEGACY_SKILL_BEGIN, "").replace(LEGACY_SKILL_END, "").split("\n").every((line) => {
		const trimmed = line.trim();
		return trimmed === "" || trimmed.startsWith("#");
	});
}
/** Validate that a full patch document stays a top-level YAML array. */
function validatePatch(text) {
	if (text.trim() === "" || isEmptyMarkerOnly(text)) return;
	const doc = parseDocument(text, {
		logLevel: "silent",
		customTags: [JS_EXPR_TAG]
	});
	if (doc.errors.length > 0) throw new McpHostError("patch-error", `写入后 YAML 校验失败：${doc.errors[0]?.message ?? "unknown"}`);
	const value = doc.toJS();
	if (value === null || value === void 0) {
		if (isEmptyMarkerOnly(text)) return;
	}
	if (!Array.isArray(value)) throw new McpHostError("patch-error", "profile patch 顶层必须是数组");
}
/** Write one file via tmp + rename; fall back to direct write on rename races. */
async function writeAtomic(file, text) {
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
	await writeFile(tmp, text, "utf8");
	try {
		await rename(tmp, file);
	} catch (error) {
		const code = isObject(error) ? error.code : void 0;
		if (code !== "EPERM" && code !== "EACCES" && code !== "EEXIST") throw error;
		await writeFile(file, text, "utf8");
	}
}
/**
* Splice the managed block inside raw patch text so it holds exactly `rows`,
* migrating a legacy block when ours is absent and preserving foreign
* content. Pure — the filesystem write lives in {@link writePatchRows}.
* @param raw - current patch text.
* @param rows - our `@deepseek-ai/dsh-mcp-client` rows.
* @returns the next patch text, validated.
*/
function splicePatchRows(raw, rows) {
	const current = findBlock(raw, MCP_BLOCK_BEGIN, MCP_BLOCK_END);
	const legacyConsole = findBlock(raw, LEGACY_CONSOLE_BEGIN, LEGACY_CONSOLE_END);
	const legacySkill = findBlock(raw, LEGACY_SKILL_BEGIN, LEGACY_SKILL_END);
	const previous = current ? parseBlock(current.body) : legacyConsole ? parseBlock(legacyConsole.body) : legacySkill ? parseBlock(legacySkill.body) : {
		foreign: [],
		inserted: []
	};
	const block = renderBlock(rows, previous.foreign, previous.inserted);
	const emptyManaged = rows.length === 0 && previous.foreign.length === 0 && previous.inserted.length === 0;
	let next;
	if (current !== null) {
		const replaced = raw.slice(0, current.start) + block + raw.slice(current.end);
		next = emptyManaged && isEmptyMarkerOnly(replaced) ? "[]\n" : replaced;
	} else if (legacyConsole !== null) {
		const replaced = raw.slice(0, legacyConsole.start) + block + raw.slice(legacyConsole.end);
		next = emptyManaged && isEmptyMarkerOnly(replaced) ? "[]\n" : replaced;
	} else if (legacySkill !== null) {
		const replaced = raw.slice(0, legacySkill.start) + block + raw.slice(legacySkill.end);
		next = emptyManaged && isEmptyMarkerOnly(replaced) ? "[]\n" : replaced;
	} else {
		const trimmed = raw.trim();
		if (trimmed === "" || trimmed === "[]") next = emptyManaged ? "[]\n" : block;
		else next = `${raw.replace(/\s*$/, "")}\n\n${block}`;
	}
	validatePatch(next);
	return next;
}
/**
* Replace the managed block (or migrate a legacy one) with the given rows.
* Preserves foreign / inserted rows that lived inside the previous block.
* @param rows - our `@deepseek-ai/dsh-mcp-client` rows.
* @param env - environment for path resolution.
*/
async function writePatchRows(rows, env = process.env) {
	const file = resolvePatchFile(env);
	const next = splicePatchRows(await readPatchText(env), rows);
	try {
		await writeAtomic(file, next);
	} catch (error) {
		throw new McpHostError("patch-error", `写入 profile patch 失败：${errorMessage(error)}`);
	}
}
/** Managed rows from patch text, without the legacy migration write. */
function rowsFromText(raw) {
	const ours = findBlock(raw, MCP_BLOCK_BEGIN, MCP_BLOCK_END);
	if (ours !== null) return parseBlock(ours.body).ours;
	const legacyConsole = findBlock(raw, LEGACY_CONSOLE_BEGIN, LEGACY_CONSOLE_END);
	if (legacyConsole !== null) return parseBlock(legacyConsole.body).ours;
	const legacySkill = findBlock(raw, LEGACY_SKILL_BEGIN, LEGACY_SKILL_END);
	if (legacySkill !== null) return parseBlock(legacySkill.body).ours;
	return [];
}
/**
* Load our managed rows from the profile patch, migrating legacy markers
* into ours on first load.
* @param env - environment for path resolution.
*/
async function loadPatchRows(env = process.env) {
	const raw = await readPatchText(env);
	const rows = rowsFromText(raw);
	if (findBlock(raw, "# >>> dsh-session-map:mcp:begin", "# <<< dsh-session-map:mcp:end") === null && (findBlock(raw, LEGACY_CONSOLE_BEGIN, LEGACY_CONSOLE_END) !== null || findBlock(raw, LEGACY_SKILL_BEGIN, LEGACY_SKILL_END) !== null)) await writePatchRows(rows, env);
	return rows;
}
/**
* Read one YAML node as a dsh-mcp-client row candidate.
* @param node - parsed map node.
* @param doc - owning document, for JS-value conversion.
* @returns the candidate read, or null when the node is not such a row.
*/
function rowFromNode(node, doc) {
	if (!isMap(node)) return null;
	const value = node.toJS(doc);
	if (!isObject(value) || value.name !== "@deepseek-ai/dsh-mcp-client") return null;
	const config = isObject(value.config) ? value.config : void 0;
	const name = nonEmptyString(config?.serverName);
	const id = nonEmptyString(value.id) ?? "";
	if (config === void 0 || name === void 0) return {
		row: null,
		name: id === "" ? "(未命名)" : id,
		id,
		blocked: "行缺少 config.serverName，无法收编"
	};
	if (!MCP_SERVER_NAME_RE.test(name)) return {
		row: null,
		name,
		id,
		blocked: `serverName「${name}」不合法`
	};
	return {
		row: {
			id: id === "" ? `${MCP_ROW_ID_PREFIX}${name}` : id,
			name: MCP_CLIENT_PACKAGE,
			...value.disabled === true ? { disabled: true } : {},
			config
		},
		name,
		id
	};
}
/**
* Scan patch text for `@deepseek-ai/dsh-mcp-client` rows outside the managed
* (and legacy) marker blocks, keeping the source spans an adopt must cut.
* An unparseable document scans as empty: a broken patch elsewhere must not
* take the whole tab down.
* @param raw - patch text.
*/
function scanUnmanagedRows(raw) {
	let doc;
	try {
		doc = parseDocument(raw, {
			logLevel: "silent",
			customTags: [JS_EXPR_TAG]
		});
	} catch {
		return [];
	}
	const root = doc.contents;
	if (doc.errors.length > 0 || !isSeq(root)) return [];
	const spans = [];
	for (const [begin, end] of [
		[MCP_BLOCK_BEGIN, MCP_BLOCK_END],
		[LEGACY_CONSOLE_BEGIN, LEGACY_CONSOLE_END],
		[LEGACY_SKILL_BEGIN, LEGACY_SKILL_END]
	]) {
		const block = findBlock(raw, begin, end);
		if (block !== null) spans.push({
			start: block.start,
			end: block.end
		});
	}
	const inBlocks = (at) => spans.some((span) => at >= span.start && at < span.end);
	const out = [];
	for (const item of root.items) {
		if (item.range == null) continue;
		const itemStart = lineStart(raw, item.range[0]);
		if (inBlocks(itemStart)) continue;
		const insertNode = isMap(item) ? item.get("insert", true) : void 0;
		if (isSeq(insertNode)) {
			const members = insertNode.items;
			for (const member of members) {
				if (member.range == null) continue;
				const read = rowFromNode(member, doc);
				if (read === null) continue;
				const start = lineStart(raw, member.range[0]);
				if (inBlocks(start)) continue;
				const end = lineEnd(raw, member.range[1]);
				const sole = members.length === 1;
				out.push({
					row: read.row,
					name: read.name,
					id: read.id,
					...read.blocked !== void 0 ? { blocked: read.blocked } : {},
					start,
					end,
					cutStart: sole ? itemStart : start,
					cutEnd: sole ? lineEnd(raw, item.range[1]) : end
				});
			}
			continue;
		}
		const read = rowFromNode(item, doc);
		if (read === null) continue;
		const end = lineEnd(raw, item.range[1]);
		out.push({
			row: read.row,
			name: read.name,
			id: read.id,
			...read.blocked !== void 0 ? { blocked: read.blocked } : {},
			start: itemStart,
			end,
			cutStart: itemStart,
			cutEnd: end
		});
	}
	return out;
}
/**
* Map scan candidates to unmanaged views, in scan order, marking conflicts
* against the managed rows and each other. The first same-name row wins.
* @param candidates - scan output.
* @param managed - rows already inside the managed block.
*/
function classifyUnmanaged(candidates, managed) {
	const names = new Set(managed.map((row) => String(row.config.serverName)));
	const ids = new Set(managed.map((row) => row.id));
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const candidate of candidates) {
		const row = candidate.row;
		const config = row?.config;
		let conflict = candidate.blocked;
		if (row !== null && conflict === void 0) {
			const name = String(config?.serverName ?? "");
			if (names.has(name)) conflict = `与已纳管服务器「${name}」同名`;
			else if (ids.has(row.id)) conflict = `行 id「${row.id}」已被已纳管行使用`;
			else if (seen.has(name)) conflict = `与另一台未纳管服务器「${name}」同名`;
			seen.add(name);
		}
		const http = config?.transport === "streamable-http";
		out.push({
			id: candidate.id,
			name: candidate.name,
			transport: http ? "http" : "stdio",
			enabled: row !== null && row.disabled !== true,
			endpoint: http ? String(config?.url ?? "") : String(config?.command ?? ""),
			...conflict !== void 0 ? { conflict } : {}
		});
	}
	return out;
}
/**
* Adopt out-of-block `@deepseek-ai/dsh-mcp-client` rows into the managed
* block: cut their source lines from `cordis.patch.yml`, then splice them
* into the block in one atomic write. Config round-trips through the yaml
* tree (including `!!js` expressions), row ids stay as written, and the
* loader entries keep their live connections — nothing reconnects.
* Conflicting rows stay untouched and come back with reasons.
* @param ctx - plugin context (optional loader for hot-apply parity).
* @param names - serverName filter; omit to adopt every non-conflicting row.
* @param env - environment for path resolution.
* @returns adopted serverNames and skipped rows with reasons.
*/
async function adoptUnmanaged(ctx, names, env = process.env) {
	const raw = await readPatchText(env);
	const managed = rowsFromText(raw);
	const candidates = scanUnmanagedRows(raw);
	const views = classifyUnmanaged(candidates, managed);
	const wanted = names === void 0 ? void 0 : new Set(names);
	const adoptedRows = [];
	const adopted = [];
	const skipped = [];
	const cuts = [];
	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		const view = views[index];
		if (wanted !== void 0 && !wanted.has(candidate.name)) continue;
		if (view.conflict !== void 0) {
			skipped.push({
				name: view.name,
				id: view.id,
				reason: view.conflict
			});
			continue;
		}
		if (candidate.row === null) continue;
		adoptedRows.push(candidate.row);
		adopted.push(candidate.name);
		cuts.push({
			start: candidate.cutStart,
			end: candidate.cutEnd
		});
	}
	if (wanted !== void 0) for (const name of wanted) {
		if (adopted.includes(name) || skipped.some((item) => item.name === name)) continue;
		skipped.push({
			name,
			id: "",
			reason: "管理块之外没有这台服务器"
		});
	}
	if (adoptedRows.length > 0) {
		let cut = raw;
		for (const span of [...cuts].sort((a, b) => b.start - a.start)) cut = cut.slice(0, span.start) + cut.slice(span.end);
		const next = splicePatchRows(cut, [...managed, ...adoptedRows]);
		try {
			await writeAtomic(resolvePatchFile(env), next);
		} catch (error) {
			throw new McpHostError("patch-error", `写入 profile patch 失败：${errorMessage(error)}`);
		}
		for (const row of adoptedRows) await applyRow(ctx, row, "save");
	}
	return {
		adopted,
		skipped
	};
}
/** List every loader entry, swallowing loader faults. */
function listEntries(loader) {
	if (loader === void 0 || typeof loader.entries !== "function") return [];
	try {
		return Array.from(loader.entries());
	} catch {
		return [];
	}
}
/** Find the live loader entry for one patch row (by id, then by serverName). */
function findEntry(loader, row) {
	if (loader === void 0) return null;
	const all = listEntries(loader);
	const localId = String(row.id ?? "");
	const name = String(row.config?.serverName ?? "");
	return all.find((entry) => entry?.options?.id === localId) ?? all.find((entry) => name !== "" && String(entry?.options?.config?.serverName ?? "") === name) ?? null;
}
/** Count tools whose names start with the given mcp__ns__ prefix. */
function countTools(tools, prefix) {
	return listTools(tools, prefix).length;
}
/**
* List tools under one mcp__ns__ prefix for the detail pane.
* Prefer the live `visible` map (name + description), then `schemas()`, then
* bare `knownNames` so the UI never shows "unavailable" when the count is > 0.
*/
function listTools(tools, prefix) {
	if (tools === void 0) return [];
	try {
		const out = [];
		if (typeof tools.schemas === "function") {
			for (const schema of tools.schemas(void 0) ?? []) {
				const name = typeof schema?.name === "string" ? schema.name : "";
				if (!name.startsWith(prefix)) continue;
				out.push({
					name: name.slice(prefix.length),
					description: typeof schema.description === "string" ? schema.description : "",
					...schema.parameters !== void 0 ? { parameters: schema.parameters } : {}
				});
			}
			if (out.length > 0) return out.sort((a, b) => a.name.localeCompare(b.name, "en"));
		}
		const view = tools.view?.(void 0);
		const visible = view?.visible;
		if (visible !== void 0) {
			for (const [name, definition] of visible) {
				if (typeof name !== "string" || !name.startsWith(prefix)) continue;
				out.push({
					name: name.slice(prefix.length),
					description: typeof definition?.description === "string" ? definition.description : "",
					...definition?.parameters !== void 0 ? { parameters: definition.parameters } : {}
				});
			}
			return out.sort((a, b) => a.name.localeCompare(b.name, "en"));
		}
		const names = view?.knownNames;
		if (names === void 0) return [];
		for (const name of names) {
			if (typeof name !== "string" || !name.startsWith(prefix)) continue;
			out.push({
				name: name.slice(prefix.length),
				description: ""
			});
		}
		return out.sort((a, b) => a.name.localeCompare(b.name, "en"));
	} catch {
		return [];
	}
}
/**
* Hot-apply one row through the optional loader.
* Failures become `{ ok: false }` so the caller can still return the patch state.
* @param ctx - plugin context.
* @param row - patch row.
* @param mode - `save` creates/updates; `remove` drops the entry.
*/
async function applyRow(ctx, row, mode) {
	const loader = lookup$3(ctx, "loader");
	if (loader === void 0) return {
		ok: false,
		error: "loader 不可用"
	};
	try {
		if (mode === "remove") {
			const target = findEntry(loader, row);
			if (target !== null) loader.remove(target.id);
			return { ok: true };
		}
		const existing = findEntry(loader, row);
		if (existing !== null) await loader.update(existing.id, {
			config: row.config,
			disabled: row.disabled === true
		});
		else await loader.create({
			id: row.id,
			name: MCP_CLIENT_PACKAGE,
			config: row.config,
			disabled: row.disabled === true
		});
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: errorMessage(error)
		};
	}
}
/** Open a URL in the user's default browser without shelling through cmd.exe. */
function openExternal(url) {
	const candidates = process.platform === "win32" ? [["rundll32.exe", ["url.dll,FileProtocolHandler", url]]] : [[process.platform === "darwin" ? "open" : "xdg-open", [url]]];
	for (const [command, args] of candidates) try {
		const child = spawn(command, args, {
			detached: true,
			stdio: "ignore",
			windowsHide: true
		});
		child.on("error", () => void 0);
		child.unref();
		return;
	} catch {}
}
/** Probe one HTTP MCP endpoint with a tiny initialize call. */
async function probeHttp(server, fresh = false) {
	const key = `${server.name}|${server.url}`;
	const now = Date.now();
	const cached = PROBES.get(key);
	if (!fresh && cached !== void 0 && now - cached.at < PROBE_TTL_MS) return cached.result;
	let result;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	timer.unref?.();
	try {
		const response = await fetch(server.url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...server.headers
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: {
						name: "dsh-session-map",
						version: "0.1.0"
					}
				}
			}),
			signal: controller.signal
		});
		if (response.status === 401 || response.status === 403) result = {
			state: "auth",
			message: "需要登录"
		};
		else if (response.ok) result = {
			state: "reachable",
			message: ""
		};
		else result = {
			state: "down",
			message: `HTTP ${response.status}`
		};
	} catch {
		result = {
			state: "down",
			message: controller.signal.aborted ? "连接超时" : "连不上"
		};
	} finally {
		clearTimeout(timer);
	}
	PROBES.set(key, {
		at: now,
		result
	});
	return result;
}
/** Mask secret fields on one view for the wire. */
function maskView(view) {
	return {
		...view,
		env: maskSecretMap(view.env),
		headers: maskSecretMap(view.headers)
	};
}
/**
* Assemble the list payload the tab renders.
* @param ctx - plugin context (optional loader / tools).
* @param env - environment for path resolution.
* @param options - `fresh` bypasses the HTTP probe cache for a manual retry.
*/
async function buildManagerState(ctx, env = process.env, options = {}) {
	const rows = await loadPatchRows(env);
	const unmanaged = classifyUnmanaged(scanUnmanagedRows(await readPatchText(env)), rows);
	const loader = lookup$3(ctx, "loader");
	const tools = lookup$3(ctx, "tools");
	const servers = [];
	for (const row of rows) {
		const base = viewFromPatchRow(row);
		const entry = findEntry(loader, row);
		const toolList = listTools(tools, `mcp__${base.name}__`);
		const toolCount = toolList.length;
		const live = entry !== null && entry.disabled !== true;
		let state = base.state;
		let message = base.message;
		let oauth = false;
		if (!base.enabled) state = "off";
		else if (toolCount > 0) state = "online";
		else if (base.transport === "http") {
			const probe = await probeHttp(base, options.fresh === true);
			message = probe.message;
			state = probe.state === "auth" ? "auth" : probe.state === "reachable" ? "idle" : "down";
			oauth = probe.state === "auth";
			if (oauth) resolveOAuth(base.url).catch(() => void 0);
		} else {
			state = live ? "idle" : "down";
			message = live ? "启动中" : "未启动";
		}
		servers.push(maskView({
			...base,
			state,
			message,
			tools: toolCount,
			toolList,
			live,
			oauth
		}));
	}
	return {
		patchFile: resolvePatchFile(env),
		profileDir: resolveProfileDir(env),
		updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		servers: sortServers(servers),
		unmanaged: [...unmanaged].sort((a, b) => a.name.localeCompare(b.name, "en"))
	};
}
/** HH:mm:ss.sss stamp for diagnose transcripts. */
function stamp() {
	return (/* @__PURE__ */ new Date()).toISOString().slice(11, 23);
}
/** Mask headers for diagnose output. */
function maskHeadersForLog(headers) {
	const out = [];
	for (const [key, value] of Object.entries(headers)) out.push(/authorization|token|key|secret|cookie/i.test(key) ? `${key}: ****` : `${key}: ${String(value).slice(0, 120)}`);
	return out.length > 0 ? out.join(", ") : "(无)";
}
/** Parse a JSON-RPC payload from plain JSON or an SSE `data:` line. */
function parsePayload(text) {
	for (const line of String(text || "").split(/\r?\n/)) if (line.startsWith("data:")) try {
		const parsed = JSON.parse(line.slice(5).trim());
		if (isObject(parsed)) return parsed;
	} catch {}
	try {
		const parsed = JSON.parse(text);
		return isObject(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
const INITIALIZE_BODY = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: {
			name: "dsh-session-map",
			version: "0.1.0"
		}
	}
};
async function postJson(url, headers, body, timeoutMs) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const started = Date.now();
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...headers
			},
			body: JSON.stringify(body),
			signal: controller.signal
		});
		const text = await response.text();
		return {
			ok: true,
			status: response.status,
			headers: response.headers,
			text,
			ms: Date.now() - started
		};
	} catch (error) {
		return {
			ok: false,
			error: errorMessage(error),
			aborted: controller.signal.aborted
		};
	} finally {
		clearTimeout(timer);
	}
}
async function diagnoseHttpLog(server, lines) {
	lines.push(`[${stamp()}] 发送 initialize：POST ${server.url}`);
	lines.push(`[${stamp()}] 请求头：${maskHeadersForLog(server.headers)}`);
	const init = await postJson(server.url, server.headers, INITIALIZE_BODY, 1e4);
	if (!init.ok) {
		lines.push(`[${stamp()}] 请求失败：${init.aborted ? "超时（10 秒）" : init.error}`);
		return;
	}
	lines.push(`[${stamp()}] 响应：HTTP ${init.status}，用时 ${init.ms}ms`);
	for (const key of [
		"www-authenticate",
		"mcp-session-id",
		"content-type"
	]) {
		const value = init.headers.get(key);
		if (value) lines.push(`[${stamp()}]   ${key}: ${value.slice(0, 300)}`);
	}
	lines.push(`[${stamp()}] 响应体：${init.text ? init.text.slice(0, 1200) : "(空)"}`);
	if (init.status === 401 || init.status === 403) {
		lines.push(`[${stamp()}] 结论：需要登录（HTTP ${init.status}）`);
		const discovery = await resolveOAuth(server.url).catch(() => void 0);
		if (discovery !== void 0) {
			lines.push(`[${stamp()}] 授权服务器：${String(discovery.metadata.issuer ?? "")}`);
			lines.push(`[${stamp()}] 授权地址：${String(discovery.metadata.authorization_endpoint ?? "")}`);
			lines.push(`[${stamp()}] 令牌地址：${discovery.metadata.token_endpoint}`);
			lines.push(`[${stamp()}] 资源标识：${discovery.resource}`);
			lines.push(`[${stamp()}] 可申请权限：${discovery.scopes.join(" ") || "(无)"}`);
		} else lines.push(`[${stamp()}] 没有 OAuth 元数据，这个地址可能只接受静态请求头`);
		return;
	}
	const sessionId = init.headers.get("mcp-session-id");
	if (sessionId === null || sessionId === "") {
		lines.push(`[${stamp()}] 没有返回 mcp-session-id，服务端可能不支持 Streamable HTTP`);
		return;
	}
	await postJson(server.url, {
		...server.headers,
		"mcp-session-id": sessionId
	}, {
		jsonrpc: "2.0",
		method: "notifications/initialized"
	}, 5e3);
	const list = await postJson(server.url, {
		...server.headers,
		"mcp-session-id": sessionId
	}, {
		jsonrpc: "2.0",
		id: 2,
		method: "tools/list",
		params: {}
	}, 1e4);
	if (!list.ok) {
		lines.push(`[${stamp()}] tools/list 失败：${list.error}`);
		return;
	}
	lines.push(`[${stamp()}] tools/list 响应：HTTP ${list.status}，用时 ${list.ms}ms`);
	const parsed = parsePayload(list.text);
	if (parsed?.error !== void 0) lines.push(`[${stamp()}] 错误：${JSON.stringify(parsed.error).slice(0, 500)}`);
	const toolsValue = isObject(parsed?.result) ? parsed.result.tools : void 0;
	const names = Array.isArray(toolsValue) ? toolsValue.map((tool) => isObject(tool) ? String(tool.name ?? "") : "").filter((name) => name !== "") : [];
	lines.push(`[${stamp()}] 工具数：${names.length}${names.length > 0 ? `（${names.slice(0, 8).join(", ")}…）` : ""}`);
	const initParsed = parsePayload(init.text);
	const protocol = isObject(initParsed?.result) ? initParsed.result.protocolVersion : void 0;
	if (typeof protocol === "string") lines.push(`[${stamp()}] 协议版本：${protocol}`);
	if (names.length > 0) lines.push(`[${stamp()}] 结论：服务端正常，工具也能列出来。面板还是"启动中"的话，是客户端连接这一侧的问题`);
}
async function diagnoseStdioLog(server, lines) {
	lines.push(`[${stamp()}] 启动进程：${[server.command].concat([...server.args]).join(" ")}`);
	lines.push(`[${stamp()}] 工作目录：${server.cwd || process.cwd()}`);
	lines.push(`[${stamp()}] 环境变量：${Object.keys(server.env).length > 0 ? Object.keys(server.env).join(", ") : "(无)"}`);
	let child;
	try {
		child = spawn(server.command, [...server.args], {
			cwd: server.cwd || void 0,
			env: {
				...process.env,
				...server.env
			},
			windowsHide: true,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
	} catch (error) {
		lines.push(`[${stamp()}] 启动失败：${errorMessage(error)}`);
		return;
	}
	let stdout = "";
	let stderr = "";
	let exited = "";
	child.stdout?.on("data", (chunk) => {
		stdout += String(chunk);
	});
	child.stderr?.on("data", (chunk) => {
		stderr += String(chunk);
	});
	child.on("error", (error) => {
		lines.push(`[${stamp()}] 进程错误：${errorMessage(error)}`);
	});
	child.on("exit", (code, signal) => {
		exited = `进程退出：code=${String(code)}${signal ? ` signal=${signal}` : ""}`;
	});
	try {
		child.stdin?.write(`${JSON.stringify(INITIALIZE_BODY)}\n`);
	} catch {}
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 6e3));
	lines.push(`[${stamp()}] 已发送 initialize，观察 6 秒`);
	if (exited !== "") lines.push(`[${stamp()}] ${exited}`);
	if (stdout.trim() !== "") lines.push(`[${stamp()}] stdout：\n${stdout.slice(0, 3e3).trim()}`);
	if (stderr.trim() !== "") lines.push(`[${stamp()}] stderr：\n${stderr.slice(0, 3e3).trim()}`);
	if (stdout.trim() === "" && stderr.trim() === "") lines.push(`[${stamp()}] 六秒内没有任何输出。常见原因：命令不在 PATH、包没装、缺少 token、网络问题`);
	else if (stdout.includes("\"result\"")) lines.push(`[${stamp()}] 结论：收到 initialize 响应，服务端是活的`);
	else lines.push(`[${stamp()}] 结论：有输出，但没收到 initialize 响应`);
	try {
		if (process.platform === "win32") spawn("taskkill", [
			"/pid",
			String(child.pid),
			"/T",
			"/F"
		], {
			stdio: "ignore",
			windowsHide: true
		});
		else child.kill("SIGKILL");
	} catch {}
}
/**
* Run a diagnose transcript for one server by name.
* @param ctx - plugin context.
* @param name - serverName.
* @param env - environment for path resolution.
*/
async function diagnoseServer(ctx, name, env = process.env) {
	const row = (await loadPatchRows(env)).find((item) => item.config?.serverName === name);
	if (row === void 0) throw new McpHostError("not-found", `服务器 "${name}" 不存在`);
	const server = viewFromPatchRow(row);
	const lines = [];
	lines.push(`[${stamp()}] ${server.name}（${server.transport === "http" ? "HTTP" : "stdio"}）`);
	lines.push(`[${stamp()}] 启用：${server.enabled ? "是" : "否"} · 工具调用超时：${server.timeoutMs}ms`);
	const entry = findEntry(lookup$3(ctx, "loader"), row);
	lines.push(`[${stamp()}] 运行时条目：${entry !== null ? `已加载（实际 id=${entry.id}）` : `未加载（id=${row.id}）`}`);
	lines.push(`[${stamp()}] 当前工具数：${countTools(lookup$3(ctx, "tools"), `mcp__${server.name}__`)}`);
	if (server.transport === "http") await diagnoseHttpLog(server, lines);
	else await diagnoseStdioLog(server, lines);
	return {
		name: server.name,
		text: lines.join("\n")
	};
}
function sendFailure(response, status, code, message) {
	sendJson$1(response, status, {
		ok: false,
		error: {
			code,
			message
		}
	});
}
function sendFromError(response, error) {
	if (error instanceof McpHostError) {
		sendFailure(response, error.status, error.code, error.message);
		return;
	}
	sendFailure(response, 500, "internal", errorMessage(error));
}
function requiredField(source, key) {
	const value = nonEmptyString(source[key]);
	if (value === void 0) throw new McpHostError("bad-request", `缺少 ${key} 字段`);
	return value;
}
async function readBodyRecord(request, maxBytes = MCP_MAX_BODY_BYTES) {
	const result = await readJsonBody(request, maxBytes);
	if (!result.ok) {
		if (result.status === 413) throw new McpHostError("bad-request", "请求体超过大小上限");
		throw new McpHostError("bad-request", "请求体不是合法的 JSON 对象");
	}
	if (!isObject(result.value)) throw new McpHostError("bad-request", "请求体必须是 JSON 对象");
	return result.value;
}
/** Rebuild a row when only the enabled flag changes. */
function rebuildRow(previous, enabled) {
	const row = {
		id: previous.id,
		name: MCP_CLIENT_PACKAGE,
		config: previous.config
	};
	if (!enabled) return {
		...row,
		disabled: true
	};
	return row;
}
async function handleState(ctx, url, response) {
	const fresh = url.searchParams.get("fresh") === "1";
	sendJson$1(response, 200, {
		ok: true,
		state: await buildManagerState(ctx, process.env, { fresh })
	});
}
/**
* Retry one server: drop its cached probe and, for a stdio row, re-apply the
* loader entry so a dead child process is respawned. Answers with a fresh
* state so the caller does not need a second round trip.
*/
async function handleReconnect(ctx, request, response) {
	const name = requiredField(await readBodyRecord(request), "name");
	const row = (await loadPatchRows()).find((item) => item.config.serverName === name);
	if (row === void 0) throw new McpHostError("not-found", `服务器 "${name}" 不存在`);
	PROBES.delete(`${name}|${String(row.config.url ?? "")}`);
	let warning;
	if (row.config.transport !== "streamable-http") {
		const applied = await applyRow(ctx, row, "save");
		if (!applied.ok) warning = {
			code: "loader-error",
			message: applied.error
		};
	}
	sendJson$1(response, 200, {
		ok: true,
		state: await buildManagerState(ctx, process.env, { fresh: true }),
		...warning !== void 0 ? { warning } : {}
	});
}
async function handleServer(ctx, request, response) {
	const body = await readBodyRecord(request);
	const input = normalizeServerInput(isObject(body.server) ? body.server : body);
	const rows = await loadPatchRows();
	const previousName = nonEmptyString(body.previousName) ?? input.name;
	if (rows.some((row) => row.config.serverName === input.name && row.config.serverName !== previousName)) throw new McpHostError("conflict", `服务器 "${input.name}" 已存在`);
	const previous = rows.find((row) => row.config.serverName === previousName);
	const row = buildPatchRow(input, previous);
	await writePatchRows(previous === void 0 ? [...rows, row] : rows.map((item) => item === previous ? row : item));
	if (row.config.transport === "streamable-http") PROBES.delete(`${row.config.serverName}|${String(row.config.url ?? "")}`);
	const applied = await applyRow(ctx, row, "save");
	const state = await buildManagerState(ctx);
	const server = state.servers.find((item) => item.name === row.config.serverName);
	if (server === void 0) throw new McpHostError("internal", "写入后找不到服务器视图");
	if (!applied.ok) {
		sendJson$1(response, 200, {
			ok: true,
			server,
			state,
			warning: {
				code: "loader-error",
				message: applied.error
			}
		});
		return;
	}
	sendJson$1(response, 200, {
		ok: true,
		server,
		state
	});
}
async function handleToggle(ctx, request, response) {
	const body = await readBodyRecord(request);
	const name = requiredField(body, "name");
	const enabled = body.enabled !== false;
	const rows = await loadPatchRows();
	const index = rows.findIndex((row) => row.config.serverName === name);
	if (index < 0) throw new McpHostError("not-found", `服务器 "${name}" 不存在`);
	const previous = rows[index];
	if (previous === void 0) throw new McpHostError("not-found", `服务器 "${name}" 不存在`);
	const row = rebuildRow(previous, enabled);
	const next = rows.slice();
	next[index] = row;
	await writePatchRows(next);
	await applyRow(ctx, row, "save");
	sendJson$1(response, 200, {
		ok: true,
		state: await buildManagerState(ctx)
	});
}
async function handleRemove(ctx, request, response) {
	const name = requiredField(await readBodyRecord(request), "name");
	const rows = await loadPatchRows();
	const row = rows.find((item) => item.config.serverName === name);
	if (row === void 0) throw new McpHostError("not-found", `服务器 "${name}" 不存在`);
	await writePatchRows(rows.filter((item) => item !== row));
	await applyRow(ctx, row, "remove");
	if (row.config.transport === "streamable-http") PROBES.delete(`${name}|${String(row.config.url ?? "")}`);
	sendJson$1(response, 200, {
		ok: true,
		state: await buildManagerState(ctx)
	});
}
async function handleAdopt(ctx, request, response) {
	const body = await readBodyRecord(request).catch(() => ({}));
	sendJson$1(response, 200, {
		ok: true,
		result: await adoptUnmanaged(ctx, Array.isArray(body.names) ? body.names.filter((item) => typeof item === "string" && item !== "") : void 0),
		state: await buildManagerState(ctx)
	});
}
async function handleImport(ctx, request, response) {
	const body = await readBodyRecord(request);
	const inputs = parseImportText(typeof body.text === "string" ? body.text : "");
	if (inputs.length === 0) throw new McpHostError("bad-request", "没有从 JSON 里读出一台服务器");
	let rows = await loadPatchRows();
	const imported = [];
	for (const input of inputs) {
		const previous = rows.find((row) => row.config.serverName === input.name);
		const row = buildPatchRow(input, previous);
		rows = previous === void 0 ? [...rows, row] : rows.map((item) => item === previous ? row : item);
		imported.push(input.name);
	}
	await writePatchRows(rows);
	for (const name of imported) {
		const row = rows.find((item) => item.config.serverName === name);
		if (row !== void 0) await applyRow(ctx, row, "save");
	}
	sendJson$1(response, 200, {
		ok: true,
		state: await buildManagerState(ctx),
		imported
	});
}
async function handleExport(ctx, response) {
	const state = await buildManagerState(ctx);
	sendJson$1(response, 200, {
		ok: true,
		result: {
			text: buildExportText((await loadPatchRows()).map((row) => viewFromPatchRow(row))),
			format: "mcpServers"
		},
		state
	});
}
async function handleDiagnose(ctx, request, response) {
	const name = requiredField(await readBodyRecord(request), "name");
	try {
		sendJson$1(response, 200, {
			ok: true,
			result: await diagnoseServer(ctx, name)
		});
	} catch (error) {
		if (error instanceof McpHostError) throw error;
		throw new McpHostError("diagnose-error", errorMessage(error));
	}
}
async function handleOAuthStart(ctx, request, response) {
	const body = await readBodyRecord(request);
	const name = requiredField(body, "name");
	const row = (await loadPatchRows()).find((item) => item.config.serverName === name);
	if (row === void 0) throw new McpHostError("not-found", `服务器 "${name}" 不存在`);
	const config = row.config;
	if (config.transport !== "streamable-http" || typeof config.url !== "string") throw new McpHostError("bad-request", "只有 HTTP 服务器可以 OAuth 登录");
	let discovery;
	try {
		discovery = await resolveOAuth(config.url);
	} catch (error) {
		throw new McpHostError("oauth-error", errorMessage(error));
	}
	if (discovery === void 0) throw new McpHostError("oauth-error", "这个地址没有暴露 OAuth 配置，无法自动登录");
	const metadata = discovery.metadata;
	const state = createState();
	const { verifier, challenge } = createPkce();
	const loopback = await startLoopbackServer(state, 3e5, OAUTH_CALLBACK_PORT);
	const oauthPath = resolveOAuthFile();
	const store = await loadStore(oauthPath);
	const clientKey = `${name}|${loopback.redirectUri}`;
	let clientId = store.clients[clientKey]?.clientId;
	if (clientId === void 0) try {
		clientId = (await registerClient(metadata, loopback.redirectUri))?.client_id;
		if (clientId !== void 0) {
			store.clients[clientKey] = {
				clientId,
				serverUrl: String(config.url ?? ""),
				at: Date.now()
			};
			await saveStore(oauthPath, store);
		}
	} catch (error) {
		await loopback.close().catch(() => void 0);
		throw new McpHostError("oauth-error", errorMessage(error));
	}
	if (clientId === void 0) {
		await loopback.close().catch(() => void 0);
		throw new McpHostError("oauth-error", "拿不到 client_id：服务器不支持动态注册");
	}
	const scope = typeof body.scope === "string" && body.scope !== "" ? body.scope : discovery.scopes.length > 0 ? discovery.scopes.join(" ") : void 0;
	const authorizationUrl = buildAuthorizationUrl(metadata, clientId, loopback.redirectUri, challenge, state, scope, discovery.resource);
	const flowId = createState("flow-");
	const flow = {
		flowId,
		name,
		state,
		clientId,
		metadata,
		verifier,
		redirectUri: loopback.redirectUri,
		resource: discovery.resource,
		loopback,
		status: "pending"
	};
	OAUTH_FLOWS.set(flowId, flow);
	loopback.waitForCode().then((result) => {
		flow.code = result.code;
	}, (error) => {
		flow.status = "error";
		flow.error = errorMessage(error);
	});
	openExternal(authorizationUrl);
	sendJson$1(response, 200, {
		ok: true,
		result: {
			flowId,
			authorizationUrl
		}
	});
}
async function handleOAuthPoll(ctx, url, response) {
	const flowId = nonEmptyString(url.searchParams.get("flowId"));
	if (flowId === void 0) throw new McpHostError("bad-request", "缺少 flowId 字段");
	const flow = OAUTH_FLOWS.get(flowId);
	if (flow === void 0) throw new McpHostError("not-found", "这次登录流程不存在或已经结束");
	if (flow.status === "error") {
		OAUTH_FLOWS.delete(flowId);
		await flow.loopback.close().catch(() => void 0);
		sendJson$1(response, 200, {
			ok: true,
			result: {
				status: "error",
				message: flow.error ?? "授权失败"
			}
		});
		return;
	}
	if (flow.code === void 0) {
		sendJson$1(response, 200, {
			ok: true,
			result: { status: "pending" }
		});
		return;
	}
	if (flow.status === "done") {
		sendJson$1(response, 200, {
			ok: true,
			result: { status: "done" }
		});
		return;
	}
	flow.status = "exchanging";
	try {
		const tokens = await exchangeCode(flow.metadata, flow.clientId, flow.code, flow.verifier, flow.redirectUri, flow.resource);
		const header = authorizationHeader(tokens);
		const oauthPath = resolveOAuthFile();
		const store = await loadStore(oauthPath);
		const rows = await loadPatchRows();
		const index = rows.findIndex((row) => row.config.serverName === flow.name);
		const serverUrl = index >= 0 ? String(rows[index]?.config.url ?? "") : "";
		store.servers[flow.name] = {
			clientId: flow.clientId,
			serverUrl,
			tokenEndpoint: flow.metadata.token_endpoint,
			tokenType: typeof tokens.token_type === "string" ? tokens.token_type : void 0,
			accessToken: tokens.access_token,
			expiresIn: typeof tokens.expires_in === "number" ? tokens.expires_in : void 0,
			obtainedAt: Date.now()
		};
		await saveStore(oauthPath, store);
		if (index >= 0) {
			const row = rows[index];
			if (row !== void 0) {
				const headers = {
					...stringMap(row.config.headers),
					Authorization: header
				};
				const config = {
					...row.config,
					headers
				};
				const next = rows.slice();
				next[index] = {
					id: row.id,
					name: MCP_CLIENT_PACKAGE,
					...row.disabled === true ? { disabled: true } : {},
					config
				};
				await writePatchRows(next);
				PROBES.delete(`${flow.name}|${String(config.url ?? "")}`);
				await applyRow(ctx, next[index], "save");
			}
		}
		flow.status = "done";
		await flow.loopback.close().catch(() => void 0);
		OAUTH_FLOWS.delete(flowId);
		sendJson$1(response, 200, {
			ok: true,
			result: { status: "done" }
		});
	} catch (error) {
		flow.status = "error";
		flow.error = errorMessage(error);
		OAUTH_FLOWS.delete(flowId);
		await flow.loopback.close().catch(() => void 0);
		sendJson$1(response, 200, {
			ok: true,
			result: {
				status: "error",
				message: flow.error
			}
		});
	}
}
/**
* Answer one route request.
* @param ctx - the plugin's context.
* @param request - incoming request.
* @param response - route response.
*/
async function dispatch(ctx, request, response) {
	const url = new URL(request.url ?? "/", "http://localhost");
	const method = (request.method ?? "GET").toUpperCase();
	const subpath = url.pathname.startsWith(`/plugin-mcp-manager/`) ? url.pathname.slice(19) : url.pathname === "/plugin-mcp-manager" ? "/" : url.pathname;
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
			await handleState(ctx, url, response);
			return;
		case "/server":
			await handleServer(ctx, request, response);
			return;
		case "/toggle":
			await handleToggle(ctx, request, response);
			return;
		case "/remove":
			await handleRemove(ctx, request, response);
			return;
		case "/adopt":
			await handleAdopt(ctx, request, response);
			return;
		case "/reconnect":
			await handleReconnect(ctx, request, response);
			return;
		case "/import":
			await handleImport(ctx, request, response);
			return;
		case "/export":
			await handleExport(ctx, response);
			return;
		case "/diagnose":
			await handleDiagnose(ctx, request, response);
			return;
		case "/oauth/start":
			await handleOAuthStart(ctx, request, response);
			return;
		case "/oauth/poll":
			await handleOAuthPoll(ctx, url, response);
			return;
		default: throw new McpHostError("bad-request", `未知的接口：${method} ${url.pathname}`);
	}
}
/**
* Install the MCP manager Host routes.
*
* Call this from a context that provides `webServer`. `loader` and `tools` stay
* optional capabilities read per request, so a thin composition still answers
* patch state without hot-apply.
* @param ctx - plugin context carrying the web server.
*/
function installMcpManagerHost(ctx) {
	const webServer = lookup$3(ctx, "webServer");
	if (webServer === void 0) return;
	const handler = async (request, response) => {
		if (!isTrustedRequest(request)) {
			sendFailure(response, 403, "not-trusted", "仅允许本机同源请求访问 MCP 管理接口");
			return;
		}
		try {
			await dispatch(ctx, request, response);
		} catch (error) {
			if (error instanceof Error && !(error instanceof McpHostError)) {
				const message = error.message;
				if (message.includes("名称") || message.includes("请求体") || message.includes("填写") || message.includes("导入") || message.includes("合法") || message.includes("识别")) {
					sendFailure(response, 400, "bad-request", message);
					return;
				}
			}
			sendFromError(response, error);
		}
	};
	ctx.effect(() => webServer.register({
		kind: "prefix",
		path: MCP_MANAGER_ROUTE,
		handler
	}), ROUTE_EFFECT_LABEL);
}
// src/session-map/forks.ts
/**
* Shared wire contract for the plugin's fork ledger, plus the browser side of
* it.
*
* A current Harness forks each child into an independent seeded Session and
* keeps no source id anywhere — not in the header, not in an event, not in the
* `session/created` payload — so no Host signal can name a fork's parent. The
* call that creates it still names the source, though: both the shipped
* conversation "fork here" action and this plugin's BTW go through the public
* client `sessions.fork({ sessionId, atSeq })`. This ledger is the plugin's own
* observation layer: the browser half wraps that call (`./fork-recorder`),
* remembers `source -> child` locally, and reports it to the Host route family
* here, where it is persisted so every tab, restart, and later page shares one
* authoritative edge set.
*
* The ledger never replaces the prefix inference in `./graph`; it is consulted
* first because an observed fork is exact, and the inference stays as the
* fallback for forks made before this ledger existed, by another DSH instance,
* or by a host-internal path that never touches the client service.
*
* The read is optional on the Host side too: a composition without the route
* answers an empty set and the canvas keeps the inferred lineage.
*
* @module dsh-session-map/session-map/forks
*/
/** Route family shared by the Host ledger routes and the browser half. */
const SESSION_FORK_ROUTE = "/plugin-session-forks";
// src/session-map/host-forks.ts
/** Oldest edges dropped when the ledger is rewritten: half a year of forks. */
const RETENTION_MS = 15552e6;
/** Largest ledger kept; beyond this the oldest edges are dropped. */
const MAX_FORKS = 5e3;
/**
* Resolve the ledger file from the DSH home, mirroring the product's own
* `DSH_HOME` handling: a set, non-blank override wins over `<home>/.dsh`.
* @param env - environment to read; defaults to `process.env`.
* @param home - OS home directory; defaults to `os.homedir()`.
* @returns absolute path of the ledger file.
*/
function resolveForkLedgerPath(env = process.env, home = homedir()) {
	const override = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
	const dshHome = override === "" ? resolve(join(home, ".dsh")) : resolve(override);
	return join(dshHome, "session-map", "forks.json");
}
/**
* Read one ledger file, dropping unreadable or malformed rows.
* @param path - ledger file path.
* @returns the valid records, in file order.
*/
async function loadForkLedger(path) {
	let raw;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return [];
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	const forks = typeof parsed === "object" && parsed !== null ? parsed.forks : void 0;
	if (!Array.isArray(forks)) return [];
	const records = [];
	for (const candidate of forks) {
		if (typeof candidate !== "object" || candidate === null) continue;
		const childId = candidate.childId;
		const parentId = candidate.parentId;
		const recordedAt = candidate.recordedAt;
		const atSeq = candidate.atSeq;
		if (typeof childId !== "string" || childId === "") continue;
		if (typeof parentId !== "string" || parentId === "" || parentId === childId) continue;
		if (typeof recordedAt !== "number" || !Number.isFinite(recordedAt)) continue;
		if (atSeq !== void 0 && (typeof atSeq !== "number" || !Number.isInteger(atSeq) || atSeq < 0)) continue;
		records.push({
			childId,
			parentId,
			recordedAt,
			...atSeq === void 0 ? {} : { atSeq }
		});
	}
	return records;
}
/**
* Write one ledger file atomically: same-directory temp file, then rename.
* @param path - ledger file path.
* @param forks - complete record set to publish.
*/
async function saveForkLedger(path, forks) {
	await mkdir(dirname(path), {
		recursive: true,
		mode: 448
	});
	const body = JSON.stringify({
		version: 1,
		forks
	}, null, 2) + "\n";
	const temp = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, body, {
			encoding: "utf8",
			mode: 384
		});
		await rename(temp, path);
	} catch (error) {
		await unlink(temp).catch(() => {});
		throw error;
	}
}
/**
* Merge one observed edge into a record set, applying retention and the size
* cap. A newer observation of the same child replaces the older one.
* @param current - records already on disk.
* @param next - the edge just observed.
* @param now - clock for retention; defaults to the current time.
* @returns the complete record set to write.
*/
function mergeForkRecords(current, next, now = Date.now()) {
	const byChild = /* @__PURE__ */ new Map();
	for (const record of current) {
		if (now - record.recordedAt > RETENTION_MS) continue;
		byChild.set(record.childId, record);
	}
	byChild.set(next.childId, next);
	const merged = [...byChild.values()].sort((left, right) => left.recordedAt - right.recordedAt);
	return merged.length > MAX_FORKS ? merged.slice(merged.length - MAX_FORKS) : merged;
}
/**
* Drop edges whose child or parent is no longer listed.
* @param records - ledger records.
* @param knownIds - currently listed Session ids.
* @returns the records that still have both endpoints listed.
*/
function pruneForkRecords(records, knownIds) {
	return records.filter((record) => knownIds.has(record.childId) && knownIds.has(record.parentId));
}
/**
* Validate one report body; the browser half is the only writer.
* @param value - parsed JSON body.
* @returns the request, or undefined when the body is not a fork report.
*/
function parseForkRequest(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const childId = value.childId;
	const parentId = value.parentId;
	const atSeq = value.atSeq;
	if (typeof childId !== "string" || childId === "") return void 0;
	if (typeof parentId !== "string" || parentId === "" || parentId === childId) return void 0;
	if (atSeq !== void 0 && (typeof atSeq !== "number" || !Number.isInteger(atSeq) || atSeq < 0)) return void 0;
	return {
		childId,
		parentId,
		...atSeq === void 0 ? {} : { atSeq }
	};
}
/**
* Look up one optional service through the context's untyped lookup.
* @param ctx - Host context.
* @param name - service key.
* @returns the service, or undefined when the composition does not provide it.
*/
function lookup$2(ctx, name) {
	const found = ctx.get(name);
	return found === void 0 ? void 0 : found;
}
/**
* Install the fork-ledger route family.
*
* Call this from a context that already provides `webServer`; the Session query
* service stays optional (it only prunes deleted Sessions) and is resolved per
* request.
* @param ctx - plugin context carrying the web server.
* @param options - install seams for tests and non-default home layouts.
*/
function installSessionForkHost(ctx, options = {}) {
	const webServer = lookup$2(ctx, "webServer");
	if (webServer === void 0) return;
	const ledgerPath = options.ledgerPath ?? resolveForkLedgerPath(options.env, options.home ?? homedir());
	let writes = Promise.resolve();
	const append = (record) => {
		const run = writes.then(async () => {
			const current = await loadForkLedger(ledgerPath);
			await saveForkLedger(ledgerPath, mergeForkRecords(current, record));
		});
		writes = run.catch(() => {});
		return run;
	};
	const readState = async () => {
		let records = await loadForkLedger(ledgerPath);
		const query = lookup$2(ctx, "sessionQuery");
		if (query !== void 0) try {
			const listed = await query.listSessions();
			const knownIds = /* @__PURE__ */ new Set();
			for (const record of listed) {
				const id = record?.header?.id;
				if (typeof id === "string" && id !== "") knownIds.add(id);
			}
			if (knownIds.size > 0) records = pruneForkRecords(records, knownIds);
		} catch {}
		return {
			ok: true,
			version: 1,
			forks: records
		};
	};
	const handler = async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://localhost");
			const method = (request.method ?? "GET").toUpperCase();
			if (url.pathname === `/plugin-session-forks/state`) {
				if (method !== "GET") {
					sendJson$1(response, 405, {
						ok: false,
						error: {
							code: "method-not-allowed",
							message: "use GET"
						}
					});
					return;
				}
				sendJson$1(response, 200, await readState());
				return;
			}
			if (url.pathname === `/plugin-session-forks/record`) {
				if (method !== "POST") {
					sendJson$1(response, 405, {
						ok: false,
						error: {
							code: "method-not-allowed",
							message: "use POST"
						}
					});
					return;
				}
				if (!isTrustedRequest(request)) {
					sendJson$1(response, 403, {
						ok: false,
						error: {
							code: "forbidden",
							message: "same-machine requests only"
						}
					});
					return;
				}
				const body = await readJsonBody(request);
				if (!body.ok) {
					sendJson$1(response, body.status, {
						ok: false,
						error: {
							code: "invalid-request",
							message: body.message
						}
					});
					return;
				}
				const report = parseForkRequest(body.value);
				if (report === void 0) {
					sendJson$1(response, 400, {
						ok: false,
						error: {
							code: "invalid-request",
							message: "not a fork report"
						}
					});
					return;
				}
				await append({
					...report,
					recordedAt: Date.now()
				});
				sendJson$1(response, 200, {
					ok: true,
					version: 1,
					childId: report.childId
				});
				return;
			}
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
					message: errorMessage(error)
				}
			});
		}
	};
	ctx.effect(() => webServer.register({
		kind: "prefix",
		path: SESSION_FORK_ROUTE,
		handler
	}), "session-forks: ledger routes");
}
// src/session-map/lineage.ts
/**
* Shared wire contract for the fork-lineage seed read, plus the browser read.
*
* A current Harness forks each child into an independent seeded Session and
* records no parent Session, so the canvas recovers a family from the turn
* prefix a child copied. That prefix match is symmetric; the only datum that
* tells a source from its children is the seed metadata the Host already holds:
* the child was created after the Session it was cut from. The Host half
* (`./host-lineage`) answers that metadata for every listed Session, and this
* module owns its route, its wire shape, and the page-lifetime read.
*
* The read is optional on both sides: a composition without the Host route, or
* a page whose request fails, answers an empty map and the canvas keeps the
* direction-free trunk choice. That is also what older Harness builds get, so
* nothing here can break a map that worked before.
*
* @module dsh-session-map/session-map/lineage
*/
/** Route family shared by the Host half and this browser read. */
const SESSION_LINEAGE_ROUTE = "/plugin-session-lineage";
// src/session-map/host-lineage.ts
/**
* Read one optional service through the context's untyped lookup.
* @param ctx - Host context.
* @param name - service key.
* @returns the service, or undefined when the composition does not provide it.
*/
function lookup$1(ctx, name) {
	const found = ctx.get(name);
	return found === void 0 ? void 0 : found;
}
/**
* Turn one header-only listing into the route body.
*
* Rows without a usable id or creation time are dropped rather than guessed:
* the canvas treats a missing row exactly like a missing family member.
* @param service - the Session query service, when the composition provides one.
* @returns the envelope the browser reads.
*/
async function readSessionLineage(service) {
	if (service === void 0) return {
		ok: true,
		sessions: []
	};
	const records = await service.listSessions();
	const sessions = [];
	for (const record of records) {
		const header = record?.header;
		if (header === void 0) continue;
		const id = header.id;
		const createdAt = header.createdAt;
		if (typeof id !== "string" || id === "") continue;
		if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) continue;
		sessions.push({
			id,
			createdAt,
			isSeeded: header.isSeeded === true
		});
	}
	return {
		ok: true,
		sessions
	};
}
/**
* Install the fork-lineage seed route.
*
* Call this from a context that already provides `webServer`; the Session query
* service stays optional and is resolved on each request, so a thin composition
* serves an empty answer instead of failing to load.
* @param ctx - plugin context carrying the web server.
*/
function installSessionLineageHost(ctx) {
	const webServer = lookup$1(ctx, "webServer");
	if (webServer === void 0) return;
	const handler = async (request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		const method = (request.method ?? "GET").toUpperCase();
		if (url.pathname !== `/plugin-session-lineage/state`) {
			sendJson$1(response, 404, {
				ok: false,
				error: {
					code: "not-found",
					message: `unknown endpoint: ${method} ${url.pathname}`
				}
			});
			return;
		}
		if (method !== "GET") {
			sendJson$1(response, 405, {
				ok: false,
				error: {
					code: "method-not-allowed",
					message: "use GET"
				}
			});
			return;
		}
		try {
			sendJson$1(response, 200, await readSessionLineage(lookup$1(ctx, "sessionQuery")));
		} catch (error) {
			sendJson$1(response, 500, {
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
		path: SESSION_LINEAGE_ROUTE,
		handler
	}), "session-lineage: state route");
}
// src/skill-catalog/catalog.ts
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
// src/skill-catalog/host.ts
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
// src/usage-stats/model.ts
/**
* Usage statistics vocabulary shared by both halves of the Settings → 用量统计
* page, plus every pure rule the numbers depend on.
*
* The Host half feeds Session log events through {@link SessionSummarizer},
* which folds one log into sparse 15-minute UTC buckets. Fifteen minutes is the
* finest granularity any IANA zone offset needs (+05:45, +08:45, …), so the
* cached buckets never depend on a time zone: {@link aggregateUsage} re-bins
* them into the viewer's local days and hours at query time.
*
* The browser half reads the {@link UsageReport} and derives the heat map from
* it with {@link buildCalendar}, {@link quartileCuts}, and
* {@link seriesHighlights} — all here, so every counting rule has one home and
* one test file.
*
* Nothing here touches Node or the DOM.
*
* @module dsh-session-map/usage-stats/model
*/
/** Route family shared by both halves. */
const USAGE_STATS_ROUTE = "/plugin-usage-stats";
/** Width of one cached time bucket. */
const BUCKET_MS = 9e5;
/** Longest single turn counted toward Agent time; longer gaps are clock damage. */
const MAX_TURN_MS = 864e5;
/** Myers search bound: beyond this edit distance the trimmed counts are used. */
const MAX_DIFF_DISTANCE = 4e3;
/**
* A string-keyed table without a prototype. Model, tool, and file names come
* from logs: a name like `constructor` or `__proto__` must stay an ordinary key
* instead of reaching `Object.prototype` in the long-lived Host process.
*/
function table() {
	return Object.create(null);
}
/** Create one empty bucket. */
function emptyBucket() {
	return {
		added: 0,
		removed: 0,
		editLines: 0,
		writeLines: 0,
		turns: 0,
		turnErrors: 0,
		turnAborted: 0,
		activeMs: 0,
		userMessages: 0,
		steps: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		toolCalls: 0,
		toolFailures: 0,
		models: table(),
		tools: table(),
		exts: table()
	};
}
/**
* Split text into lines the way an editor counts them: a trailing newline ends
* the last line instead of opening an empty one.
* @param text - file content or snippet.
* @returns the lines; empty text has none.
*/
function splitLines(text) {
	if (text === "") return [];
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}
/**
* Count the lines one text has.
* @param text - file content.
* @returns its line count.
*/
function countLines(text) {
	return splitLines(text).length;
}
/**
* Shortest insert/delete edit distance between two line sequences — Myers'
* O((N+M)·D) greedy search, keeping only the furthest-reaching frontier, so
* memory is O(D). Only the distance is needed: added and removed follow from
* it and the two lengths.
* @param a - old lines.
* @param b - new lines.
* @param maxDistance - search bound.
* @returns the distance, or undefined when it exceeds the bound.
*/
function myersDistance(a, b, maxDistance) {
	const n = a.length;
	const m = b.length;
	const limit = Math.min(n + m, maxDistance);
	const offset = limit + 1;
	const v = new Int32Array(2 * limit + 3);
	for (let d = 0; d <= limit; d += 1) for (let k = -d; k <= d; k += 2) {
		let x = k === -d || k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0) ? v[offset + k + 1] ?? 0 : (v[offset + k - 1] ?? 0) + 1;
		let y = x - k;
		while (x < n && y < m && a[x] === b[y]) {
			x += 1;
			y += 1;
		}
		v[offset + k] = x;
		if (x >= n && y >= m) return d;
	}
}
/**
* Lines added and removed between two texts.
*
* The classic approach in two steps: trim the common prefix and suffix (cheap,
* and the whole answer for a typical in-place edit), then run Myers on the
* differing middle. A middle whose edit distance exceeds the bound — a whole
* file rewritten — falls back to counting every middle line as changed, which
* is what the trim alone would say.
* @param oldText - text before the edit.
* @param newText - text after the edit.
* @returns added and removed line counts.
*/
function lineDiff(oldText, newText) {
	const before = splitLines(oldText);
	const after = splitLines(newText);
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
	let endBefore = before.length;
	let endAfter = after.length;
	while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
		endBefore -= 1;
		endAfter -= 1;
	}
	const n = endBefore - start;
	const m = endAfter - start;
	if (n === 0 || m === 0) return {
		added: m,
		removed: n
	};
	const ids = /* @__PURE__ */ new Map();
	const intern = (line) => {
		let id = ids.get(line);
		if (id === void 0) {
			id = ids.size;
			ids.set(line, id);
		}
		return id;
	};
	const distance = myersDistance(before.slice(start, endBefore).map(intern), after.slice(start, endAfter).map(intern), MAX_DIFF_DISTANCE);
	if (distance === void 0) return {
		added: m,
		removed: n
	};
	return {
		added: (distance + m - n) / 2,
		removed: (distance - m + n) / 2
	};
}
/**
* File type of one path: the lower-cased extension, a dotfile's own name, or
* the bare file name when there is no extension (`Dockerfile`).
* @param path - file path, or undefined when the log names none.
* @returns the type label.
*/
function fileType(path) {
	if (path === void 0 || path === "") return "(未知)";
	const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
	if (base === "") return "(未知)";
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return base.startsWith(".") ? base.toLowerCase() : base;
	return base.slice(dot).toLowerCase();
}
/** Event types the summarizer reads; every other line is skipped unparsed. */
const COUNTED_TYPES = /* @__PURE__ */ new Set([
	"session",
	"session/end-seed",
	"turn/start",
	"turn/end",
	"user/message",
	"assistant/message",
	"tool/call",
	"tool/result"
]);
/**
* Read the `type` of one JSONL record without parsing it. Persisted records
* start with `{"type":"…"`; anything else answers undefined and is parsed.
* @param line - one JSONL line.
* @returns the record type, or undefined when the prefix does not show it.
*/
function peekEventType(line) {
	if (!line.startsWith("{\"type\":\"")) return void 0;
	const end = line.indexOf("\"", 9);
	return end === -1 ? void 0 : line.slice(9, end);
}
/** Narrow an unknown value to a plain record. */
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** A finite number, or zero. */
function num(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
/** A non-empty string, or undefined. */
function str(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** Tool-call arguments: a JSON string in current logs, an object in some older ones. */
function parseArguments(value) {
	if (typeof value === "string") try {
		return asRecord(JSON.parse(value));
	} catch {
		return;
	}
	return asRecord(value);
}
/**
* Fold one Session log, line by line, into a {@link SessionSummary}.
*
* Counting rules (also shown on the page's 统计口径 card):
* - A forked Session copies its source's events up to the last
*   `session/end-seed` marked `inherited`; everything before that marker is
*   discarded so a fork never counts its source again. A nested fork copies
*   earlier markers too, so each marker resets the fold.
* - Lines come from successful tool results that carry `meta.diffs` (one diff
*   per changed file region), or, for a created file without diffs, from the
*   created content. File-editing through `bash` leaves no diff and is not
*   counted.
* - An event without `time` inherits the last known time.
*/
var SessionSummarizer = class {
	header;
	lastTime = 0;
	buckets = /* @__PURE__ */ new Map();
	calls = /* @__PURE__ */ new Map();
	turnStarts = /* @__PURE__ */ new Map();
	sawSeedEnd = false;
	malformed = 0;
	/**
	* Feed one JSONL line.
	* @param line - the raw line, without its newline.
	*/
	pushLine(line) {
		if (line === "") return;
		const type = peekEventType(line);
		if (type !== void 0 && !COUNTED_TYPES.has(type)) return;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			this.malformed += 1;
			return;
		}
		this.pushEvent(event);
	}
	/**
	* Feed one parsed record.
	* @param value - the parsed JSONL record.
	*/
	pushEvent(value) {
		const event = asRecord(value);
		if (event === void 0) return;
		const type = event.type;
		if (type === "session") {
			this.readHeader(event);
			return;
		}
		if (this.header === void 0) return;
		if (typeof event.time === "number" && Number.isFinite(event.time)) this.lastTime = event.time;
		const data = asRecord(event.data) ?? {};
		switch (type) {
			case "session/end-seed":
				if (data.inherited === true && this.header.isSeeded) this.resetForSeed();
				return;
			case "turn/start":
				this.onTurnStart(data);
				return;
			case "turn/end":
				this.onTurnEnd(data);
				return;
			case "user/message":
				if (asRecord(data.source)?.kind === "user") this.bucket().userMessages += 1;
				return;
			case "assistant/message":
				this.onAssistant(data);
				return;
			case "tool/call":
				this.onToolCall(data);
				return;
			case "tool/result":
				this.onToolResult(data);
				return;
			default: return;
		}
	}
	/**
	* Finish the fold.
	* @returns the summary, or why this log cannot be counted.
	*/
	finish() {
		if (this.header === void 0) return {
			ok: false,
			reason: "日志缺少会话头"
		};
		if (this.header.isSeeded && !this.sawSeedEnd) return {
			ok: false,
			reason: "分叉会话缺少 session/end-seed 标记，无法区分继承的前缀"
		};
		const buckets = table();
		for (const [key, bucket] of [...this.buckets.entries()].sort((left, right) => left[0] - right[0])) buckets[String(key)] = bucket;
		return {
			ok: true,
			summary: {
				id: this.header.id,
				cwd: this.header.cwd,
				origin: this.header.origin,
				createdAt: this.header.createdAt,
				buckets
			}
		};
	}
	/** Lines that looked like counted records but did not parse. */
	get malformedLines() {
		return this.malformed;
	}
	readHeader(event) {
		if (this.header !== void 0) return;
		const createdAt = num(event.createdAt);
		this.header = {
			id: str(event.id) ?? "",
			cwd: str(event.cwd) ?? "",
			origin: event.origin === "subagent" ? "subagent" : "root",
			createdAt,
			isSeeded: event.isSeeded === true
		};
		this.lastTime = createdAt;
	}
	resetForSeed() {
		this.sawSeedEnd = true;
		this.buckets.clear();
		this.calls.clear();
		this.turnStarts.clear();
	}
	/** The bucket of the current event time. */
	bucket() {
		const key = Math.floor(this.lastTime / BUCKET_MS);
		let bucket = this.buckets.get(key);
		if (bucket === void 0) {
			bucket = emptyBucket();
			this.buckets.set(key, bucket);
		}
		return bucket;
	}
	onTurnStart(data) {
		const bucket = this.bucket();
		bucket.turns += 1;
		if (typeof data.turn === "number") this.turnStarts.set(data.turn, {
			time: this.lastTime,
			bucket
		});
	}
	onTurnEnd(data) {
		const turn = typeof data.turn === "number" ? data.turn : void 0;
		const start = turn === void 0 ? void 0 : this.turnStarts.get(turn);
		if (turn !== void 0) this.turnStarts.delete(turn);
		if (start === void 0) return;
		const kind = asRecord(data.reason)?.kind;
		if (kind === "error") start.bucket.turnErrors += 1;
		else if (kind === "aborted" || kind === "interrupted") start.bucket.turnAborted += 1;
		const elapsed = this.lastTime - start.time;
		if (elapsed > 0 && elapsed <= MAX_TURN_MS) start.bucket.activeMs += elapsed;
	}
	onAssistant(data) {
		const bucket = this.bucket();
		const source = asRecord(asRecord(data.message)?.source);
		const model = str(source?.model) ?? "(未知模型)";
		const provider = str(source?.provider);
		let counter = bucket.models[model];
		if (counter === void 0) {
			counter = {
				providers: [],
				steps: 0,
				withUsage: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0
			};
			bucket.models[model] = counter;
		}
		if (provider !== void 0 && !counter.providers.includes(provider)) counter.providers.push(provider);
		counter.steps += 1;
		bucket.steps += 1;
		const usage = asRecord(data.usage);
		if (usage === void 0) return;
		counter.withUsage += 1;
		const input = num(usage.inputTokens);
		const output = num(usage.outputTokens);
		const cacheRead = num(usage.cacheReadTokens);
		const cacheWrite = num(usage.cacheWriteTokens);
		counter.inputTokens += input;
		counter.outputTokens += output;
		counter.cacheReadTokens += cacheRead;
		counter.cacheWriteTokens += cacheWrite;
		bucket.inputTokens += input;
		bucket.outputTokens += output;
		bucket.cacheReadTokens += cacheRead;
		bucket.cacheWriteTokens += cacheWrite;
	}
	onToolCall(data) {
		const name = str(data.name) ?? "(未知工具)";
		const callId = str(data.callId);
		if (callId !== void 0) this.calls.set(callId, {
			name,
			arguments: data.arguments
		});
		const bucket = this.bucket();
		bucket.toolCalls += 1;
		const counter = bucket.tools[name] ?? {
			calls: 0,
			failures: 0
		};
		counter.calls += 1;
		bucket.tools[name] = counter;
	}
	onToolResult(data) {
		const message = asRecord(data.message);
		const callId = str(message?.toolCallId);
		const call = callId === void 0 ? void 0 : this.calls.get(callId);
		if (callId !== void 0) this.calls.delete(callId);
		if (call === void 0) return;
		if (message?.isError === true || data.error !== void 0) {
			const bucket = this.bucket();
			bucket.toolFailures += 1;
			const counter = bucket.tools[call.name] ?? {
				calls: 0,
				failures: 0
			};
			counter.failures += 1;
			bucket.tools[call.name] = counter;
			return;
		}
		const meta = asRecord(data.meta);
		if (meta === void 0) return;
		const diffs = Array.isArray(meta.diffs) ? meta.diffs : [];
		if (diffs.length === 0 && meta.operation !== "create") return;
		const args = parseArguments(call.arguments);
		const fallbackPath = str(meta.path) ?? str(args?.file_path) ?? str(args?.path);
		const isWrite = call.name === "write";
		if (diffs.length > 0) {
			for (const candidate of diffs) {
				const diff = asRecord(candidate);
				if (diff === void 0) continue;
				const counted = lineDiff(typeof diff.oldText === "string" ? diff.oldText : "", typeof diff.newText === "string" ? diff.newText : "");
				this.addLines(isWrite, str(diff.path) ?? fallbackPath, counted.added, counted.removed);
			}
			return;
		}
		const content = typeof args?.content === "string" ? args.content : "";
		this.addLines(isWrite, fallbackPath, countLines(content), 0);
	}
	addLines(isWrite, path, added, removed) {
		if (added === 0 && removed === 0) return;
		const bucket = this.bucket();
		bucket.added += added;
		bucket.removed += removed;
		if (isWrite) bucket.writeLines += added + removed;
		else bucket.editLines += added + removed;
		const type = fileType(path);
		const counter = bucket.exts[type] ?? {
			added: 0,
			removed: 0
		};
		counter.added += added;
		counter.removed += removed;
		bucket.exts[type] = counter;
	}
};
/** Formatter per time zone. */
const formatters = /* @__PURE__ */ new Map();
/**
* Whether a string names a time zone this runtime knows.
* @param timeZone - candidate IANA name.
* @returns true when `Intl` accepts it.
*/
function isValidTimeZone(timeZone) {
	if (timeZone === "") return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}
/**
* Local date and hour of one instant in one zone.
* @param ms - epoch ms.
* @param timeZone - IANA zone.
* @returns the local slot.
*/
function localSlot(ms, timeZone) {
	let formatter = formatters.get(timeZone);
	if (formatter === void 0) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			hourCycle: "h23"
		});
		formatters.set(timeZone, formatter);
	}
	const parts = {};
	for (const part of formatter.formatToParts(new Date(ms))) parts[part.type] = part.value;
	const hour = Number(parts.hour ?? "0") % 24;
	return {
		date: `${parts.year ?? "1970"}-${parts.month ?? "01"}-${parts.day ?? "01"}`,
		hour
	};
}
/** Epoch day number of a `YYYY-MM-DD` date (UTC arithmetic, no zone). */
function dayNumber(date) {
	const [y, m, d] = date.split("-").map(Number);
	return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 864e5);
}
/** `YYYY-MM-DD` of an epoch day number. */
function dateOfDay(day) {
	return (/* @__PURE__ */ new Date(day * 864e5)).toISOString().slice(0, 10);
}
/**
* Shift a calendar date by whole days.
* @param date - `YYYY-MM-DD`.
* @param days - signed offset.
* @returns the shifted date.
*/
function addDays(date, days) {
	return dateOfDay(dayNumber(date) + days);
}
/** Time ranges the page offers. */
const RANGE_KINDS = [
	"365",
	"180",
	"90",
	"30",
	"all"
];
/** Parse a range query value. */
function parseRange(value) {
	return RANGE_KINDS.includes(value ?? "") ? value : "365";
}
/** Zeroed daily metrics. */
function emptyDayMetrics() {
	return {
		added: 0,
		removed: 0,
		turns: 0,
		tokens: 0,
		activeMs: 0
	};
}
/** Zeroed totals. */
function emptyTotals() {
	return {
		added: 0,
		removed: 0,
		editLines: 0,
		writeLines: 0,
		turns: 0,
		turnErrors: 0,
		turnAborted: 0,
		activeMs: 0,
		userMessages: 0,
		steps: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		toolCalls: 0,
		toolFailures: 0
	};
}
/**
* Whether a bucket recorded anything. Every counter counts: a long tool call
* can fail in a later quarter-hour whose bucket holds nothing but that failure.
*/
function bucketHasActivity(bucket) {
	return bucket.turns > 0 || bucket.turnErrors > 0 || bucket.turnAborted > 0 || bucket.activeMs > 0 || bucket.steps > 0 || bucket.toolCalls > 0 || bucket.toolFailures > 0 || bucket.userMessages > 0 || bucket.added > 0 || bucket.removed > 0;
}
/** Last path segment of a working directory. */
function projectName(cwd) {
	if (cwd === "") return "(未知目录)";
	const trimmed = cwd.replace(/[\\/]+$/, "");
	const base = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
	return base === "" ? cwd : base;
}
/**
* Re-bin cached summaries into one range of local days.
* @param summaries - every counted Session log.
* @param options - zone, range, and clock.
* @returns the report the page renders.
*/
function aggregateUsage(summaries, options) {
	const { timeZone, range, now } = options;
	const end = localSlot(now, timeZone).date;
	const slots = /* @__PURE__ */ new Map();
	const slotOf = (key) => {
		let slot = slots.get(key);
		if (slot === void 0) {
			slot = localSlot(key * BUCKET_MS, timeZone);
			slots.set(key, slot);
		}
		return slot;
	};
	let start;
	if (range === "all") {
		start = end;
		for (const summary of summaries) for (const [key, bucket] of Object.entries(summary.buckets)) {
			if (!bucketHasActivity(bucket)) continue;
			const date = slotOf(Number(key)).date;
			if (date < start) start = date;
		}
	} else start = addDays(end, -(Number(range) - 1));
	const days = /* @__PURE__ */ new Map();
	const totals = emptyTotals();
	const sessions = {
		total: 0,
		root: 0,
		subagent: 0
	};
	const hours = Array.from({ length: 24 }, () => 0);
	const projects = /* @__PURE__ */ new Map();
	const models = /* @__PURE__ */ new Map();
	const tools = /* @__PURE__ */ new Map();
	const exts = /* @__PURE__ */ new Map();
	for (const summary of summaries) {
		let counted = false;
		let project;
		for (const [key, bucket] of Object.entries(summary.buckets)) {
			const slot = slotOf(Number(key));
			if (slot.date < start || slot.date > end) continue;
			if (!bucketHasActivity(bucket)) continue;
			if (!counted) {
				counted = true;
				sessions.total += 1;
				sessions[summary.origin] += 1;
				project = projects.get(summary.cwd);
				if (project === void 0) {
					project = {
						cwd: summary.cwd,
						name: projectName(summary.cwd),
						sessions: 0,
						turns: 0,
						added: 0,
						removed: 0,
						tokens: 0
					};
					projects.set(summary.cwd, project);
				}
				project.sessions += 1;
			}
			let day = days.get(slot.date);
			if (day === void 0) {
				day = {
					date: slot.date,
					root: emptyDayMetrics(),
					subagent: emptyDayMetrics()
				};
				days.set(slot.date, day);
			}
			const metrics = day[summary.origin];
			const tokens = bucket.inputTokens + bucket.outputTokens;
			metrics.added += bucket.added;
			metrics.removed += bucket.removed;
			metrics.turns += bucket.turns;
			metrics.tokens += tokens;
			metrics.activeMs += bucket.activeMs;
			totals.added += bucket.added;
			totals.removed += bucket.removed;
			totals.editLines += bucket.editLines;
			totals.writeLines += bucket.writeLines;
			totals.turns += bucket.turns;
			totals.turnErrors += bucket.turnErrors;
			totals.turnAborted += bucket.turnAborted;
			totals.activeMs += bucket.activeMs;
			totals.userMessages += bucket.userMessages;
			totals.steps += bucket.steps;
			totals.inputTokens += bucket.inputTokens;
			totals.outputTokens += bucket.outputTokens;
			totals.cacheReadTokens += bucket.cacheReadTokens;
			totals.cacheWriteTokens += bucket.cacheWriteTokens;
			totals.toolCalls += bucket.toolCalls;
			totals.toolFailures += bucket.toolFailures;
			hours[slot.hour] = (hours[slot.hour] ?? 0) + bucket.userMessages;
			if (project !== void 0) {
				project.turns += bucket.turns;
				project.added += bucket.added;
				project.removed += bucket.removed;
				project.tokens += tokens;
			}
			for (const [name, counter] of Object.entries(bucket.models)) {
				let row = models.get(name);
				if (row === void 0) {
					row = {
						model: name,
						providers: [],
						steps: 0,
						withUsage: 0,
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0
					};
					models.set(name, row);
				}
				for (const provider of counter.providers) if (!row.providers.includes(provider)) row.providers.push(provider);
				row.steps += counter.steps;
				row.withUsage += counter.withUsage;
				row.inputTokens += counter.inputTokens;
				row.outputTokens += counter.outputTokens;
				row.cacheReadTokens += counter.cacheReadTokens;
				row.cacheWriteTokens += counter.cacheWriteTokens;
			}
			for (const [name, counter] of Object.entries(bucket.tools)) {
				const row = tools.get(name) ?? {
					name,
					calls: 0,
					failures: 0
				};
				row.calls += counter.calls;
				row.failures += counter.failures;
				tools.set(name, row);
			}
			for (const [ext, counter] of Object.entries(bucket.exts)) {
				const row = exts.get(ext) ?? {
					ext,
					added: 0,
					removed: 0
				};
				row.added += counter.added;
				row.removed += counter.removed;
				exts.set(ext, row);
			}
		}
	}
	const byName = (left, right) => left < right ? -1 : left > right ? 1 : 0;
	return {
		timeZone,
		range,
		start,
		end,
		daily: [...days.values()].sort((left, right) => byName(left.date, right.date)),
		totals,
		sessions,
		hours,
		projects: [...projects.values()].sort((left, right) => right.added + right.removed - (left.added + left.removed) || right.tokens - left.tokens || right.sessions - left.sessions || byName(left.cwd, right.cwd)),
		models: [...models.values()].sort((left, right) => right.steps - left.steps || byName(left.model, right.model)),
		tools: [...tools.values()].sort((left, right) => right.calls - left.calls || byName(left.name, right.name)),
		exts: [...exts.values()].sort((left, right) => right.added + right.removed - (left.added + left.removed) || byName(left.ext, right.ext))
	};
}
// src/usage-stats/cache.ts
/**
* Persistent per-log cache of usage summaries.
*
* Folding every Session log takes several seconds of zstd decoding, while a
* typical refresh changes one or two logs. The cache keeps each log's
* {@link SessionSummary} (or the reason it could not be counted) keyed by its
* path relative to the Sessions root, and validates an entry by the file's
* size and mtime — the classic make-style freshness check. A log appended to,
* migrated, or rewritten changes at least one of the two. The counting-rule
* version is part of the file, so a rule change discards every entry once.
*
* The file lives next to the fork ledger, `$DSH_HOME/session-map/`, and is
* written atomically (same-directory temp file + rename). Anything unreadable
* degrades to an empty cache: the cache only ever saves time.
*
* @module dsh-session-map/usage-stats/cache
*/
/**
* Resolve the DSH home the way the product does: a set, non-blank `DSH_HOME`
* wins over `<home>/.dsh`.
* @param env - environment to read.
* @param home - OS home directory.
* @returns absolute DSH home.
*/
function resolveDshHome(env = process.env, home = homedir()) {
	const override = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
	return override === "" ? resolve(join(home, ".dsh")) : resolve(override);
}
/** Default cache file under one DSH home. */
function defaultCachePath(dshHome) {
	return join(dshHome, "session-map", `usage-stats.v${String(2)}.json`);
}
/** Whether one parsed value looks like a cache entry. */
function isEntry(value) {
	if (typeof value !== "object" || value === null) return false;
	const entry = value;
	if (typeof entry.size !== "number" || typeof entry.mtimeMs !== "number") return false;
	if (entry.summary === null) return typeof entry.reason === "string";
	const summary = entry.summary;
	if (typeof summary !== "object" || summary === null) return false;
	if (typeof summary.id !== "string" || typeof summary.cwd !== "string" || typeof summary.createdAt !== "number") return false;
	if (summary.origin !== "root" && summary.origin !== "subagent") return false;
	if (typeof summary.buckets !== "object" || summary.buckets === null) return false;
	return Object.values(summary.buckets).every(isBucket);
}
/** Counter fields every cached bucket carries. */
const BUCKET_NUMBERS = [
	"added",
	"removed",
	"editLines",
	"writeLines",
	"turns",
	"turnErrors",
	"turnAborted",
	"activeMs",
	"userMessages",
	"steps",
	"inputTokens",
	"outputTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"toolCalls",
	"toolFailures"
];
/** Whether one cached bucket has every counter and table. */
function isBucket(value) {
	if (typeof value !== "object" || value === null) return false;
	const bucket = value;
	for (const field of BUCKET_NUMBERS) if (typeof bucket[field] !== "number") return false;
	for (const field of [
		"models",
		"tools",
		"exts"
	]) {
		const table = bucket[field];
		if (typeof table !== "object" || table === null || Array.isArray(table)) return false;
	}
	const models = bucket.models;
	return Object.values(models).every((counter) => typeof counter === "object" && counter !== null && Array.isArray(counter.providers));
}
/**
* Copy a parsed entry's name-keyed tables into prototype-less ones. JSON.parse
* keeps `__proto__` as an own key, but the aggregator writes into these tables
* and must never meet an inherited one.
*/
function rehome(entry) {
	if (entry.summary === null) return entry;
	const buckets = table();
	for (const [key, bucket] of Object.entries(entry.summary.buckets)) buckets[key] = {
		...bucket,
		models: Object.assign(table(), bucket.models),
		tools: Object.assign(table(), bucket.tools),
		exts: Object.assign(table(), bucket.exts)
	};
	return {
		...entry,
		summary: {
			...entry.summary,
			buckets
		}
	};
}
/**
* Load the cache; anything unreadable, foreign, or from older rules is empty.
* @param path - cache file.
* @returns valid entries by relative log path.
*/
async function loadUsageCache(path) {
	const entries = /* @__PURE__ */ new Map();
	let parsed;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch {
		return entries;
	}
	if (typeof parsed !== "object" || parsed === null) return entries;
	const file = parsed;
	if (file.rules !== 2 || typeof file.entries !== "object" || file.entries === null) return entries;
	for (const [rel, entry] of Object.entries(file.entries)) if (isEntry(entry)) entries.set(rel, rehome(entry));
	return entries;
}
/**
* Write the cache atomically.
* @param path - cache file.
* @param entries - entries by relative log path.
*/
async function saveUsageCache(path, entries) {
	const file = {
		rules: 2,
		entries: Object.fromEntries(entries)
	};
	await mkdir(dirname(path), {
		recursive: true,
		mode: 448
	});
	const temp = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, JSON.stringify(file), { mode: 384 });
		await rename(temp, path);
	} catch (error) {
		await unlink(temp).catch(() => void 0);
		throw error;
	}
}
// src/usage-stats/scan.ts
/**
* Session log reader for the usage statistics Host half.
*
* DSH's JSONL backend stores one Session per directory,
* `<root>/<cwd-slug>/<session-id>/session[.vN].jsonl[.zstd]`. A compressed log
* is a concatenation of independent Zstandard frames — one per appended batch —
* and Node's one-shot `zstdDecompressSync` stops after the first frame, so this
* module walks the frame structure itself (the same structural scan the backend
* uses) and decodes frame by frame. An incomplete final frame belongs to a
* batch still being written; it is left for the next scan, whose changed size
* and mtime will select the file again.
*
* Decoding is synchronous per frame (the largest observed frame takes under
* 100 ms) and the reader yields to the event loop between time slices, which
* measured ~40% faster than the thread-pool `zstdDecompress` because 120k small
* frames otherwise pay one pool round trip each.
*
* @module dsh-session-map/usage-stats/scan
*/
/** Zstandard frame magic, little-endian. */
const ZSTD_MAGIC = 4247762216;
/** Skippable-frame magic range, little-endian (0x184D2A50–0x184D2A5F). */
const SKIPPABLE_MASK = 4294967280;
const SKIPPABLE_MAGIC = 407710288;
/** Longest stretch of synchronous work before yielding to the event loop. */
const SLICE_MS = 12;
/**
* Locate the complete Zstandard frames of a concatenated stream without
* decoding their blocks. Scanning stops at an incomplete final frame.
* @param buffer - file bytes.
* @returns complete frames in order, and whether a torn tail was left out.
* @throws when a complete frame header is not Zstandard at all.
*/
function scanZstdFrames(buffer) {
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const frames = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 8) return {
			frames,
			torn: true
		};
		const magic = view.getUint32(offset, true);
		if ((magic & SKIPPABLE_MASK) >>> 0 === SKIPPABLE_MAGIC) {
			const size = view.getUint32(offset + 4, true);
			if (buffer.length - offset - 8 < size) return {
				frames,
				torn: true
			};
			offset += 8 + size;
			continue;
		}
		if (magic !== ZSTD_MAGIC) throw new Error(`不是 Zstandard 帧（偏移 ${String(offset)}）`);
		offset += 4;
		const descriptor = buffer[offset] ?? 0;
		offset += 1;
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
		offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		for (;;) {
			if (buffer.length - offset < 3) return {
				frames,
				torn: true
			};
			const blockHeader = (buffer[offset] ?? 0) | (buffer[offset + 1] ?? 0) << 8 | (buffer[offset + 2] ?? 0) << 16;
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = blockHeader >>> 1 & 3;
			const blockSize = blockHeader >>> 3;
			if (blockType === 3) throw new Error(`Zstandard 块类型无效（偏移 ${String(offset - 3)}）`);
			offset += blockType === 1 ? 1 : blockSize;
			if (offset > buffer.length) return {
				frames,
				torn: true
			};
			if (lastBlock) break;
		}
		if (checksum) offset += 4;
		if (offset > buffer.length) return {
			frames,
			torn: true
		};
		frames.push({
			start,
			end: offset
		});
	}
	return {
		frames,
		torn: false
	};
}
/** Cooperative time slicing for synchronous loops. */
var Slicer = class {
	signal;
	sliceStart = Date.now();
	/** @param signal - aborts the surrounding scan. */
	constructor(signal) {
		this.signal = signal;
	}
	/** Yield to the event loop when the current slice is used up. */
	async maybeYield() {
		this.signal?.throwIfAborted();
		if (Date.now() - this.sliceStart < SLICE_MS) return;
		await new Promise((resolve) => {
			setImmediate(resolve);
		});
		this.sliceStart = Date.now();
		this.signal?.throwIfAborted();
	}
};
/**
* Feed every line of one decoded chunk sequence to a sink. Lines may span
* chunk boundaries; the remainder is carried.
*/
var LineSplitter = class {
	sink;
	carry = "";
	constructor(sink) {
		this.sink = sink;
	}
	push(text) {
		const joined = this.carry + text;
		let from = 0;
		for (let newline = joined.indexOf("\n"); newline !== -1; newline = joined.indexOf("\n", from)) {
			this.sink(joined.slice(from, newline));
			from = newline + 1;
		}
		this.carry = joined.slice(from);
	}
	end() {
		if (this.carry !== "") this.sink(this.carry);
		this.carry = "";
	}
};
/**
* Fold one Session log file.
* @param path - absolute log path.
* @param slicer - shared time slicer of the scan.
* @returns the summary, or why the log cannot be counted.
*/
async function summarizeLogFile(path, slicer = new Slicer()) {
	const bytes = await readFile(path);
	const summarizer = new SessionSummarizer();
	const lines = new LineSplitter((line) => {
		summarizer.pushLine(line);
	});
	const decoder = new TextDecoder();
	if (path.endsWith(".zstd")) {
		const { frames } = scanZstdFrames(bytes);
		for (const frame of frames) {
			await slicer.maybeYield();
			lines.push(decoder.decode(zstdDecompressSync(bytes.subarray(frame.start, frame.end)), { stream: true }));
		}
		lines.push(decoder.decode());
	} else {
		const text = decoder.decode(bytes);
		for (let from = 0; from < text.length;) {
			await slicer.maybeYield();
			const to = Math.min(text.length, from + 1e6);
			lines.push(text.slice(from, to));
			from = to;
		}
	}
	lines.end();
	return summarizer.finish();
}
/** Canonical log file name: `session.jsonl[.zstd]` or `session.vN.jsonl[.zstd]`. */
const LOG_NAME = /^session(?:\.v([1-9]\d*))?\.jsonl(\.zstd)?$/;
/**
* Pick the log to count in one Session directory: the newest format version.
* A format migration copies the old generation into a new one and may leave
* the old file behind, so counting both would count the Session twice.
* @param names - entries of the Session directory.
* @returns the chosen file name, or undefined when there is no log.
*/
function pickLogName(names) {
	let best;
	for (const name of names) {
		const match = LOG_NAME.exec(name);
		if (match === null) continue;
		const version = match[1] === void 0 ? 0 : Number(match[1]);
		const zstd = match[2] !== void 0;
		if (best === void 0 || version > best.version || version === best.version && zstd && !best.zstd) best = {
			name,
			version,
			zstd
		};
	}
	return best?.name;
}
/** Directory entries, or none when the directory cannot be read. */
async function listDir(path) {
	try {
		return (await readdir(path, { withFileTypes: true })).map((entry) => ({
			name: entry.name,
			isDirectory: entry.isDirectory()
		}));
	} catch {
		return [];
	}
}
/**
* List the log to count for every Session under the root.
* @param root - the Sessions root, `$DSH_HOME/sessions`.
* @param signal - aborts the listing.
* @returns one file per Session directory, sorted by relative path.
*/
async function listSessionLogs(root, signal) {
	const files = [];
	for (const project of await listDir(root)) {
		if (!project.isDirectory) continue;
		const projectPath = join(root, project.name);
		for (const session of await listDir(projectPath)) {
			signal?.throwIfAborted();
			if (!session.isDirectory) continue;
			const sessionPath = join(projectPath, session.name);
			const name = pickLogName((await listDir(sessionPath)).filter((entry) => !entry.isDirectory).map((entry) => entry.name));
			if (name === void 0) continue;
			const path = join(sessionPath, name);
			try {
				const info = await stat(path);
				files.push({
					path,
					rel: relative(root, path),
					size: info.size,
					mtimeMs: info.mtimeMs
				});
			} catch {}
		}
	}
	return files.sort((left, right) => left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0);
}
/** Scan state plus the snapshot every read is answered from. */
var UsageStatsStore = class {
	sessionsRoot;
	cachePath;
	now;
	staleMs;
	controller = new AbortController();
	cache;
	snapshot;
	running;
	progress = {
		done: 0,
		total: 0
	};
	lastError;
	rescanRequested = false;
	dirty = false;
	rebuiltCache = false;
	lastSavedAt = Number.NEGATIVE_INFINITY;
	generation = 0;
	reports = /* @__PURE__ */ new Map();
	/** @param options - install seams. */
	constructor(options = {}) {
		const dshHome = resolveDshHome();
		this.sessionsRoot = options.sessionsRoot ?? join(dshHome, "sessions");
		this.cachePath = options.cachePath ?? defaultCachePath(dshHome);
		this.now = options.now ?? Date.now;
		this.staleMs = options.staleMs ?? 3e4;
	}
	/**
	* Answer one read, starting a scan when needed.
	* @param query - range, zone, and refresh flag.
	* @returns the wire envelope.
	*/
	read(query) {
		const snapshot = this.snapshot;
		if (snapshot === void 0) {
			if (this.running === void 0 && this.lastError !== void 0 && !query.refresh) return {
				ok: false,
				error: {
					code: "scan-failed",
					message: this.lastError
				}
			};
			this.startScan(query.refresh);
			return this.scanningEnvelope();
		}
		if (query.refresh || this.now() - snapshot.scannedAt > this.staleMs) this.startScan(query.refresh);
		let report;
		try {
			report = this.report(snapshot, query);
		} catch (error) {
			if (this.rebuiltCache) return {
				ok: false,
				error: {
					code: "aggregate-failed",
					message: errorMessage(error)
				}
			};
			this.rebuiltCache = true;
			this.cache = /* @__PURE__ */ new Map();
			this.snapshot = void 0;
			this.reports.clear();
			this.lastSavedAt = Number.NEGATIVE_INFINITY;
			this.startScan(true);
			return this.scanningEnvelope();
		}
		return {
			ok: true,
			version: 1,
			status: "ready",
			refreshing: this.running !== void 0,
			scannedAt: new Date(snapshot.scannedAt).toISOString(),
			report,
			skipped: [...snapshot.skipped]
		};
	}
	scanningEnvelope() {
		return {
			ok: true,
			version: 1,
			status: "scanning",
			progress: { ...this.progress }
		};
	}
	/**
	* Start a scan unless one is running (single-flight).
	*
	* A running scan may already have passed the log a refresh is about: an
	* explicit refresh during a scan queues exactly one more pass, which starts
	* when the current one ends.
	* @param explicit - whether the page asked for fresh numbers.
	* @returns the running scan, including any queued pass.
	*/
	startScan(explicit = false) {
		if (this.running !== void 0) {
			if (explicit) this.rescanRequested = true;
			return this.running;
		}
		this.lastError = void 0;
		this.rescanRequested = false;
		const running = this.scan().catch((error) => {
			if (!this.controller.signal.aborted) this.lastError = errorMessage(error);
		}).then(async () => {
			if (!this.rescanRequested || this.controller.signal.aborted) return;
			this.rescanRequested = false;
			await this.scan().catch((error) => {
				if (!this.controller.signal.aborted) this.lastError = errorMessage(error);
			});
		}).finally(() => {
			if (this.running === running) this.running = void 0;
		});
		this.running = running;
		return running;
	}
	/** Stop a running scan; the store answers no further scans. */
	dispose() {
		this.controller.abort(/* @__PURE__ */ new Error("usage-stats: disposed"));
	}
	/** Aggregate one snapshot, memoized per generation, range, zone, and day. */
	report(snapshot, query) {
		const now = this.now();
		const today = localSlot(now, query.timeZone).date;
		const key = `${String(snapshot.generation)}|${query.range}|${query.timeZone}|${today}`;
		let report = this.reports.get(key);
		if (report === void 0) {
			report = aggregateUsage(snapshot.summaries, {
				timeZone: query.timeZone,
				range: query.range,
				now
			});
			if (this.reports.size > 32) this.reports.clear();
			this.reports.set(key, report);
		}
		return report;
	}
	/** One incremental scan of every Session log. */
	async scan() {
		const signal = this.controller.signal;
		const slicer = new Slicer(signal);
		this.cache ??= await loadUsageCache(this.cachePath);
		const files = await listSessionLogs(this.sessionsRoot, signal);
		this.progress = {
			done: 0,
			total: files.length
		};
		const previous = this.cache;
		const next = /* @__PURE__ */ new Map();
		let changed = previous.size !== files.length;
		for (const file of files) {
			let entry = previous.get(file.rel);
			if (entry === void 0 || entry.size !== file.size || entry.mtimeMs !== file.mtimeMs) {
				changed = true;
				try {
					const result = await summarizeLogFile(file.path, slicer);
					entry = result.ok ? {
						size: file.size,
						mtimeMs: file.mtimeMs,
						summary: result.summary
					} : {
						size: file.size,
						mtimeMs: file.mtimeMs,
						summary: null,
						reason: result.reason
					};
				} catch (error) {
					if (signal.aborted) throw error;
					entry = {
						size: file.size,
						mtimeMs: file.mtimeMs,
						summary: null,
						reason: errorMessage(error)
					};
				}
			}
			next.set(file.rel, entry);
			this.progress = {
				done: this.progress.done + 1,
				total: files.length
			};
			await slicer.maybeYield();
		}
		this.cache = next;
		const scannedAt = this.now();
		const summaries = [];
		const skipped = [];
		for (const [rel, entry] of next) if (entry.summary !== null) summaries.push(entry.summary);
		else if (entry.size > 0 && scannedAt - entry.mtimeMs >= 12e4) skipped.push({
			path: rel,
			reason: entry.reason ?? "无法读取"
		});
		const previousSnapshot = this.snapshot;
		const sameSkipped = previousSnapshot !== void 0 && previousSnapshot.skipped.length === skipped.length && previousSnapshot.skipped.every((item, index) => item.path === skipped[index]?.path);
		if (changed || !sameSkipped || previousSnapshot === void 0) {
			this.generation += 1;
			this.reports.clear();
		}
		this.snapshot = {
			generation: this.generation,
			summaries,
			skipped,
			scannedAt
		};
		if (changed) this.dirty = true;
		if (this.dirty && scannedAt - this.lastSavedAt >= 6e4) {
			this.dirty = false;
			this.lastSavedAt = scannedAt;
			await saveUsageCache(this.cachePath, next).catch(() => void 0);
		}
	}
};
/**
* Parse one read's query string.
* @param url - request URL.
* @param fallbackZone - zone used when the page sent none or an unknown one.
* @returns the read parameters.
*/
function parseQuery(url, fallbackZone) {
	const zone = url.searchParams.get("tz") ?? "";
	return {
		range: parseRange(url.searchParams.get("range")),
		timeZone: isValidTimeZone(zone) ? zone : fallbackZone,
		refresh: url.searchParams.get("refresh") === "1"
	};
}
/**
* Build the route handler over one store.
* @param store - scan state.
* @returns the request handler.
*/
function createUsageStatsHandler(store) {
	const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return (request, response) => {
		try {
			if (!isTrustedRequest(request)) {
				sendJson$1(response, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "usage statistics are only served to this machine"
					}
				});
				return;
			}
			const url = new URL(request.url ?? "/", "http://localhost");
			const method = (request.method ?? "GET").toUpperCase();
			if (url.pathname !== `/plugin-usage-stats/state`) {
				sendJson$1(response, 404, {
					ok: false,
					error: {
						code: "not-found",
						message: `unknown endpoint: ${method} ${url.pathname}`
					}
				});
				return;
			}
			if (method !== "GET") {
				sendJson$1(response, 405, {
					ok: false,
					error: {
						code: "method-not-allowed",
						message: "use GET"
					}
				});
				return;
			}
			sendJson$1(response, 200, store.read(parseQuery(url, hostZone)));
		} catch (error) {
			sendJson$1(response, 500, {
				ok: false,
				error: {
					code: "internal",
					message: errorMessage(error)
				}
			});
		}
	};
}
/**
* Install the usage statistics route.
*
* Call this from a context that already provides `webServer`. The scan starts
* on the first read, not at install, so a Harness that never opens the page
* never pays for it.
* @param ctx - plugin context carrying the web server.
* @param options - install seams.
*/
function installUsageStatsHost(ctx, options = {}) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return;
	ctx.effect(() => {
		const store = new UsageStatsStore(options);
		const unregister = webServer.register({
			kind: "prefix",
			path: USAGE_STATS_ROUTE,
			handler: createUsageStatsHandler(store)
		});
		return () => {
			unregister();
			store.dispose();
		};
	}, "usage-stats: state route");
}
// src/index.ts
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
		installSessionLineageHost(scope);
		installSessionForkHost(scope);
		installUsageStatsHost(scope);
		installMcpManagerHost(scope);
	});
}
export { apply };

//# sourceMappingURL=index.js.map