// A stand-in for crb's MCP server in the fake agent's own tests: the same
// tool names and shapes (attach, next, reply, threads, detach), one
// question to hand out, and every call recorded. In-process over HTTP
// (recorderServer), or run as a stdio server (`node mcp-recorder.mjs`),
// appending each call to $RECORDER_LOG (JSONL).
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const QUESTION = {
	preamble: "data",
	thread: "t1",
	replyTo: "m1",
	envelope: { messages: [{ text: "Why the lock?" }] },
	anchoredFile: null,
	hunk: null,
};

/**
 * The tools over `state` (shared across requests: HTTP is stateless).
 * `record(call)` gets {tool, args, headers}.
 */
function tools(state, record, headers = {}) {
	const server = new McpServer({ name: "recorder", version: "0.0.0" });
	const ok = (v) => ({ content: [{ type: "text", text: JSON.stringify(v) }] });
	const tool = (name, schema, body) =>
		server.registerTool(name, { inputSchema: schema }, (args) => {
			record({ tool: name, args, headers });
			return ok(body(args));
		});
	tool(
		"attach",
		{
			review: z.string(),
			name: z.string(),
			request: z.string().optional(),
			machine: z.string().optional(),
			harness: z.string().optional(),
		},
		() => ({ state: "approved", token: "tok", review: { link: "x" } }),
	);
	tool("next", { token: z.string() }, () =>
		state.answered ? { none: true } : QUESTION,
	);
	tool(
		"reply",
		{
			token: z.string(),
			thread: z.string(),
			replyTo: z.string(),
			text: z.string(),
		},
		() => {
			state.answered = true;
			return { ok: true };
		},
	);
	tool("threads", { token: z.string() }, () => ({ threads: [] }));
	tool("detach", { token: z.string() }, () => ({ ok: true }));
	return server;
}

/** An HTTP MCP server on a random port: its url, the calls, close(). */
export async function recorderServer() {
	const state = { answered: false };
	const calls = [];
	const http = createServer(async (req, res) => {
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const body = chunks.length
			? JSON.parse(Buffer.concat(chunks).toString("utf8"))
			: undefined;
		const server = tools(state, (c) => calls.push(c), req.headers);
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		res.on("close", () => {
			void transport.close();
			void server.close();
		});
		await server.connect(transport);
		await transport.handleRequest(req, res, body);
	});
	await new Promise((r) => http.listen(0, "127.0.0.1", r));
	const { port } = http.address();
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		calls,
		close: () =>
			new Promise((r) => {
				http.close(r);
				http.closeAllConnections();
			}),
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const log = process.env.RECORDER_LOG;
	const state = { answered: false };
	const server = tools(state, (c) => {
		if (log) {
			appendFileSync(
				log,
				`${JSON.stringify({ ...c, env: { CRB_MCP_HEADERS: process.env.CRB_MCP_HEADERS } })}\n`,
			);
		}
	});
	await server.connect(new StdioServerTransport());
}
