import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
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
//#region src/git-workspace/route.ts
/**
* The route family shared by the Git workspace settings page and the Git tool
* window.
* @module dsh-session-map/git-workspace/route
*/
const GIT_WORKSPACE_ROUTE = "/plugin-git-workspace";
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
* @returns the decoded value, or a rejection message.
*/
async function readJsonBody(request) {
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
			if (totalBytes > 16384) {
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
		const [statusRun, refsRun, markersRun, remotesRun] = await Promise.all([
			run(statusArgs("normal"), "status"),
			run(forEachRefArgs(), "refs"),
			run(gitPathArgs(OPERATION_MARKERS), "paths"),
			run(remoteVerboseArgs(), "remotes")
		]);
		for (const result of [
			statusRun,
			refsRun,
			markersRun,
			remotesRun
		]) if (result.exitCode !== 0) throw classifyFailure(result.stderr, result.exitCode);
		const status = parseStatusV2(statusRun.stdout);
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
				stashCount: status.head.stashCount,
				branches: refs.refs.filter((ref) => ref.type === "local" || ref.type === "remote"),
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
		const staged = url.searchParams.get("staged") === "1";
		const context = integerParam(url, "context", 3, 0, 20);
		const gitPath = await runner.gitPath();
		const result = await runner.run(read(gitPath, repo, diffArgs({
			...hash === void 0 ? {} : { hash },
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
/** Host plugin body: expose the settings routes. */
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
	});
}
//#endregion
export { apply };

//# sourceMappingURL=index.js.map