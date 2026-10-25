import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
function asRecord(value) {
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
	const record = asRecord(input);
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
//#region src/git-workspace/host.ts
/** Route family shared by the page and the Host. */
const GIT_WORKSPACE_ROUTE = "/plugin-git-workspace";
/** One clone may run at a time; the page disables its button, but curls exist. */
const CLONE_TIMEOUT_MS = 9e5;
/** Largest JSON request body the clone endpoint accepts. */
const MAX_BODY_BYTES = 16384;
/** How much stdout/stderr one clone keeps in memory. */
const MAX_OUTPUT_BYTES = 262144;
/** Grace period handed to the subprocess provider on termination. */
const GRACE_MS = 5e3;
/** Host names that only ever identify this machine. */
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"::1"
]);
/**
* Read one optional service from the global store.
* @param ctx - the plugin's context.
* @param name - the service name.
* @returns the service as the caller's local interface, or `undefined`.
*/
function lookup$1(ctx, name) {
	return ctx.get(name);
}
/** Raise and format one JSON response; a closed connection is not an error. */
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
* Whether a request may reach this route family.
*
* Plugin routes carry no server-side auth token, so a page loaded from another
* origin could otherwise drive clones. Only a loopback Host, plus an Origin
* that agrees with it when the browser sends one, is accepted.
* @param request - incoming request.
* @returns true when the request is same-machine.
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
			if (totalBytes > MAX_BODY_BYTES) {
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
/**
* Read the platform the clone must build paths for.
* @param subprocess - the subprocess seam.
* @returns the seam's platform, defaulting to POSIX when it cannot report one.
*/
async function readPlatform(subprocess) {
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
* Install the Clone-from-Git routes and their Workspace registration.
*
* Call this from a context that already provides `webServer`, `subprocess` and
* `workspaceRegistry`; every registration is owned by an effect.
* @param ctx - plugin context carrying the three host services.
*/
function installGitWorkspaceHost(ctx) {
	const webServer = lookup$1(ctx, "webServer");
	const subprocess = lookup$1(ctx, "subprocess");
	const workspaces = lookup$1(ctx, "workspaceRegistry");
	if (webServer === void 0 || subprocess === void 0 || workspaces === void 0) return;
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
		const workingDirectory = lookup$1(ctx, "workingDirectory");
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
			const targetPath = joinTargetPath(parentDir, repoName, await readPlatform(subprocess));
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
			if (url.pathname === `/plugin-git-workspace/state`) {
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
			if (url.pathname === `/plugin-git-workspace/clone`) {
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
				if (!(headerValue(request, "content-type") ?? "").toLowerCase().includes("application/json")) {
					sendJson$1(response, 415, {
						ok: false,
						error: {
							code: "unsupported-media-type",
							message: "use application/json"
						}
					});
					return;
				}
				const body = await readJsonBody(request);
				if (!body.ok) {
					sendJson$1(response, body.status, cloneFailure("invalid-request", body.message));
					return;
				}
				const result = await runClone(body.value, response);
				sendJson$1(response, result.status, result.body);
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
		path: GIT_WORKSPACE_ROUTE,
		handler
	}), "git-workspace: clone routes");
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