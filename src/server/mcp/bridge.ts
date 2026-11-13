import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * `crb mcp-bridge --url <url>`: crb's `/mcp` over stdio, for a spawned
 * agent that can't reach an MCP server over HTTP (ACP agents must support
 * stdio, HTTP is optional). It forwards each JSON-RPC message, untouched,
 * between its stdin/stdout and `url`, adding the access key
 * ($CRB_MCP_KEY, as `?key=`) and the headers in $CRB_MCP_HEADERS (JSON
 * `[{name, value}]`: the spawn's secret). Secrets travel in the
 * environment, never in argv. Spec:
 * docs/superpowers/specs/2026-11-13-spawned-agent-mcp-design.md ("Spawn").
 */

export class BridgeArgsError extends Error {}

/**
 * The bridge's target: an http(s) URL without credentials, query or
 * fragment, whose path is `/mcp`; the key, when given, as its `?key=`.
 */
export function bridgeUrl(raw: string, key: string | undefined): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new BridgeArgsError(`Not a URL: ${raw}`);
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/mcp"
	) {
		throw new BridgeArgsError(`Not a crb /mcp URL: ${raw}`);
	}
	if (key) url.searchParams.set("key", key);
	return url;
}

/** $CRB_MCP_HEADERS as a header record: only `[{name, value}]` of strings with token names. */
export function bridgeHeaders(raw: string | undefined): Record<string, string> {
	if (!raw) return {};
	let list: unknown;
	try {
		list = JSON.parse(raw);
	} catch {
		throw new BridgeArgsError("CRB_MCP_HEADERS is not JSON");
	}
	if (!Array.isArray(list)) {
		throw new BridgeArgsError("CRB_MCP_HEADERS must be a list");
	}
	const out: Record<string, string> = {};
	for (const h of list) {
		const { name, value } = (h ?? {}) as { name?: unknown; value?: unknown };
		if (
			typeof name !== "string" ||
			typeof value !== "string" ||
			!/^[A-Za-z0-9-]{1,64}$/.test(name) ||
			/[\r\n\0]/.test(value)
		) {
			throw new BridgeArgsError("CRB_MCP_HEADERS has a bad header");
		}
		out[name] = value;
	}
	return out;
}

/** The argv after `mcp-bridge`: exactly `--url <url>`. */
export function bridgeArgs(argv: string[]): { url: string } {
	if (argv.length !== 2 || argv[0] !== "--url" || !argv[1]) {
		throw new BridgeArgsError("Usage: crb mcp-bridge --url <url>");
	}
	return { url: argv[1] };
}

/**
 * Forwards MCP between `stdin`/`stdout` and `url` until stdin ends (or
 * the stdio side closes). Resolves once it has stopped.
 */
export async function runBridge(o: {
	url: URL;
	headers: Record<string, string>;
	stdin?: Readable;
	stdout?: Writable;
}): Promise<void> {
	const [{ StdioServerTransport }, { StreamableHTTPClientTransport }] =
		await Promise.all([
			import("@modelcontextprotocol/sdk/server/stdio.js"),
			import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
		]);
	const stdio = new StdioServerTransport(o.stdin, o.stdout);
	const http = new StreamableHTTPClientTransport(o.url, {
		requestInit: { headers: o.headers },
	});
	const done = new Promise<void>((resolveDone) => {
		stdio.onclose = () => resolveDone();
		o.stdin?.once("end", () => resolveDone());
	});
	stdio.onmessage = (message) => {
		void http.send(message).catch((error: unknown) => {
			// A request that can't be forwarded gets its error back.
			const id = (message as { id?: unknown }).id;
			if (id === undefined) return;
			void stdio.send({
				jsonrpc: "2.0",
				id: id as string | number,
				error: {
					code: -32603,
					message: `crb is unreachable: ${(error as Error).message}`,
				},
			});
		});
	};
	http.onmessage = (message) => {
		void stdio.send(message).catch(() => {});
	};
	http.onerror = () => {};
	await http.start();
	await stdio.start();
	await done;
	await http.close().catch(() => {});
	await stdio.close().catch(() => {});
}

/**
 * How crb starts its own bridge: this Node, crb's entry and `mcp-bridge`
 * (from source, through tsx: dev mode and tests). The caller adds
 * `--url <url>`.
 */
export function bridgeCommand(): { command: string; args: string[] } {
	const here = fileURLToPath(import.meta.url);
	const fromSource = here.endsWith(".ts");
	const cli = resolve(dirname(here), "../..", fromSource ? "cli.ts" : "cli.js");
	if (!fromSource) {
		return { command: process.execPath, args: [cli, "mcp-bridge"] };
	}
	const tsx = createRequire(import.meta.url).resolve("tsx");
	return {
		command: process.execPath,
		args: ["--import", pathToFileURL(tsx).href, cli, "mcp-bridge"],
	};
}
