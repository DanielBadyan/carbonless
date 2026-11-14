import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GIT_TEST_TIMEOUTS } from "../../../test/git-fixture.js";
import {
	BridgeArgsError,
	bridgeArgs,
	bridgeCommand,
	bridgeHeaders,
	bridgeUrl,
} from "./bridge.js";

// A real bridge process (node + tsx + the SDK): see GIT_TEST_TIMEOUTS.
vi.setConfig(GIT_TEST_TIMEOUTS);

type Recorder = {
	url: string;
	calls: { tool: string; headers: Record<string, string> }[];
	close(): Promise<void>;
};
const recorder = async (): Promise<Recorder> =>
	(
		(await import(
			resolve(import.meta.dirname, "../../../test/fake-acp/mcp-recorder.mjs")
		)) as { recorderServer: () => Promise<Recorder> }
	).recorderServer();

const stops: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const s of stops.splice(0).reverse()) await s().catch(() => {});
});

describe("crb mcp-bridge", () => {
	it("tools/list through the bridge equals the direct list; a tool call goes through with the key and the headers", async () => {
		const rec = await recorder();
		stops.push(() => rec.close());
		const direct = new Client({ name: "direct", version: "1" });
		await direct.connect(new StreamableHTTPClientTransport(new URL(rec.url)));
		stops.push(() => direct.close());
		const viaBridge = new Client({ name: "bridged", version: "1" });
		const { command, args } = bridgeCommand();
		await viaBridge.connect(
			new StdioClientTransport({
				command,
				args: [...args, "--url", rec.url],
				env: {
					...getDefaultEnvironment(),
					CRB_MCP_KEY: "k3y",
					CRB_MCP_HEADERS: JSON.stringify([
						{ name: "X-Crb-Spawn", value: "s3cret" },
					]),
				},
			}),
		);
		stops.push(() => viaBridge.close());
		const a = (await direct.listTools()).tools.map((t) => t.name);
		const b = (await viaBridge.listTools()).tools.map((t) => t.name);
		expect(b).toEqual(a);
		expect(b).toContain("attach");
		const r = await viaBridge.callTool({
			name: "threads",
			arguments: { token: "t" },
		});
		expect(r.isError).not.toBe(true);
		const call = rec.calls.find((c) => c.tool === "threads");
		expect(call?.headers["x-crb-spawn"]).toBe("s3cret");
	});

	it("exits when its stdin ends (its agent went away)", async () => {
		const rec = await recorder();
		stops.push(() => rec.close());
		const { command, args } = bridgeCommand();
		const child = spawn(command, [...args, "--url", rec.url], {
			stdio: ["pipe", "pipe", "inherit"],
		});
		stops.push(async () => {
			child.kill("SIGKILL");
		});
		const exited = new Promise<number | null>((r) =>
			child.once("exit", (code) => r(code)),
		);
		// It is up (it answers a request), then its stdin ends.
		child.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`,
		);
		await new Promise<void>((r) => child.stdout.once("data", () => r()));
		child.stdin.end();
		expect(await exited).toBe(0);
	});

	it("the key goes in the query, never needed in argv; the URL must be crb's /mcp without credentials or a query", () => {
		expect(bridgeUrl("http://127.0.0.1:4800/mcp", "k3y").href).toBe(
			"http://127.0.0.1:4800/mcp?key=k3y",
		);
		expect(bridgeUrl("http://127.0.0.1:4800/mcp", undefined).href).toBe(
			"http://127.0.0.1:4800/mcp",
		);
		for (const bad of [
			"not a url",
			"file:///etc/passwd",
			"http://u:p@127.0.0.1:1/mcp",
			"http://127.0.0.1:1/mcp?key=x",
			"http://127.0.0.1:1/other",
			"http://127.0.0.1:1/mcp#x",
		]) {
			expect(() => bridgeUrl(bad, undefined), bad).toThrow(BridgeArgsError);
		}
		// A key with query syntax in it stays one value.
		expect(
			bridgeUrl("http://127.0.0.1:1/mcp", "a&b=c").searchParams.get("key"),
		).toBe("a&b=c");
	});

	it("argv is exactly --url <url>; headers are names of token characters and values without line breaks", () => {
		expect(bridgeArgs(["--url", "http://x/mcp"])).toEqual({
			url: "http://x/mcp",
		});
		for (const bad of [[], ["--url"], ["--url", "x", "--y"], ["-u", "x"]]) {
			expect(() => bridgeArgs(bad)).toThrow(BridgeArgsError);
		}
		expect(bridgeHeaders(undefined)).toEqual({});
		expect(bridgeHeaders('[{"name":"X-Crb-Spawn","value":"v"}]')).toEqual({
			"X-Crb-Spawn": "v",
		});
		for (const bad of [
			"{",
			'{"name":"a"}',
			'[{"name":"a b","value":"v"}]',
			'[{"name":"a","value":"v\\r\\nX-Evil: 1"}]',
			'[{"name":"a","value":1}]',
		]) {
			expect(() => bridgeHeaders(bad), bad).toThrow(BridgeArgsError);
		}
	});
});
