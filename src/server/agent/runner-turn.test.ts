import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, AgentStop } from "../../shared/agent.js";
import { AcpAgent } from "./acp.js";
import type { ReviewClaim } from "./claim.js";
import { JoinBroker } from "./join.js";
import { AgentRunner, CANCEL_GRACE_MS, type RunnerFacts } from "./runner.js";
import type { AgentThreadStore } from "./store.js";

// No process and no git: a stand-in agent whose turn never ends by
// itself, on fake timers, for the turn's time limit.
vi.mock("./acp.js", async (importOriginal) => {
	const real = await importOriginal<typeof import("./acp.js")>();
	return { ...real, AcpAgent: { spawn: vi.fn() } };
});
vi.mock("./checkout.js", async (importOriginal) => {
	const real = await importOriginal<typeof import("./checkout.js")>();
	return {
		...real,
		createCheckout: vi.fn(async () => ({
			dir: "/nowhere",
			tree: "/nowhere/tree",
			remove: async () => {},
			moveTo: async () => null,
		})),
	};
});

const AGENT: AgentConfig = {
	command: "fake",
	args: [],
	env: {},
	leash: "open",
};
const TURN_MS = 60_000;

/** A stand-in AcpAgent: prompt() hangs until cancelled (if it obeys) or closed. */
function fakeAgent(obeysCancel: boolean) {
	let end: ((r: { text: string; stop: AgentStop }) => void) | null = null;
	const a = {
		info: { name: "fake", version: "1" },
		alive: true,
		prompts: 0,
		prompt: vi.fn(
			() =>
				new Promise<{ text: string; stop: AgentStop }>((r) => {
					a.prompts++;
					end = r;
				}),
		),
		cancel: vi.fn(async () => {
			if (obeysCancel) end?.({ text: "", stop: "cancelled" });
		}),
		close: vi.fn(async () => {
			a.alive = false;
			end?.({ text: "", stop: "error" });
		}),
		exitsWithin: async () => true,
		stderrTail: () => "",
	};
	return a;
}

let dir: string;
let broker: JoinBroker;
let runner: AgentRunner;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	dir = mkdtempSync(join(tmpdir(), "crb-runner-turn-"));
	broker = new JoinBroker({
		dir,
		onApproved: async () => {},
		onLeft: () => {},
	});
});
afterEach(async () => {
	vi.useRealTimers();
	await runner?.close();
	broker.close();
	rmSync(dir, { recursive: true, force: true });
});

function start(agent: ReturnType<typeof fakeAgent>) {
	vi.mocked(AcpAgent.spawn).mockResolvedValue(agent as unknown as AcpAgent);
	runner = new AgentRunner({
		reviewId: "01k9e6m2q8x4v7c3n5b0h1j2t6",
		config: async () => ({ agent: AGENT, problems: [] }),
		store: {
			read: async () => [],
			message: vi.fn(async () => {}),
		} as unknown as AgentThreadStore,
		cacheClone: "/nowhere",
		head: "a".repeat(40),
		port: 4800,
		facts: {
			review: () => ({ head: { commit: "a".repeat(40) } }),
			join: async (f: unknown) => f,
		} as unknown as RunnerFacts,
		turnMs: TURN_MS,
		claim: {
			hold: async () => ({ ok: true, release: async () => {} }),
			drop: async () => {},
		} as unknown as ReviewClaim,
		join: broker,
		mcp: () => ({ url: "http://127.0.0.1:1/mcp", key: null }),
	});
	runner.poke();
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("every turn has a time limit, whatever it holds", () => {
	it("a kickoff that hangs without calling next: cancelled at turnMs; ignoring that, its process is closed", async () => {
		const agent = fakeAgent(false);
		start(agent);
		await vi.waitFor(async () => {
			await flush();
			expect(agent.prompts).toBe(1);
		});
		expect((await runner.status()).state).toBe("busy");
		await vi.advanceTimersByTimeAsync(TURN_MS - 1);
		expect(agent.cancel).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(agent.cancel).toHaveBeenCalledTimes(1);
		expect(agent.close).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(CANCEL_GRACE_MS);
		await vi.waitFor(() => expect(agent.close).toHaveBeenCalled());
		const s = await runner.status();
		expect(s.state).toBe("error");
		expect(s.error).toContain("didn't stop");
		// Not busy for ever: the broker shows no turn.
		expect(broker.inTurn()).toBe(false);
	});

	it("an agent that obeys the cancel: the turn ends at turnMs (no attach: Spawn failed), nothing closes it twice", async () => {
		const agent = fakeAgent(true);
		start(agent);
		await vi.waitFor(async () => {
			await flush();
			expect(agent.prompts).toBe(1);
		});
		await vi.advanceTimersByTimeAsync(TURN_MS);
		await vi.waitFor(async () =>
			expect((await runner.status()).error).toContain("didn't attach"),
		);
		await vi.advanceTimersByTimeAsync(CANCEL_GRACE_MS);
		expect((await runner.status()).error).toContain("didn't attach");
		expect(agent.close).toHaveBeenCalledTimes(1);
	});
});
