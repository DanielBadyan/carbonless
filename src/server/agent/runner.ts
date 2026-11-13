import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type {
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionUpdate,
} from "@agentclientprotocol/sdk";
import {
	type ActivityKind,
	AGENT_TURN_MS,
	type AgentActivity,
	type AgentAnchor,
	type AgentConfig,
	type AgentIdentity,
	type AgentState,
	type AgentStatus,
	type AgentStop,
	type AgentView,
	JOINED_PREAMBLE,
} from "../../shared/agent.js";
import { AcpAgent, AgentStartError, agentEnv } from "./acp.js";
import { agentsDir, type Checkout, createCheckout } from "./checkout.js";
import { type ReviewClaim, takeClaim } from "./claim.js";
import type { JoinBroker } from "./join.js";
import { decidePermission } from "./policy.js";
import type {
	CommentRole,
	GithubThreadFacts,
	PromptPatchset,
	PromptReview,
} from "./prompt.js";
import type { AgentThreadFold, AgentThreadStore } from "./store.js";

/**
 * What the review offers its buddy's questions (`next`). None of it
 * writes to GitHub.
 */
export interface RunnerFacts {
	review(): PromptReview;
	prFacts(): Promise<{ title: string; body: string; files: string[] }>;
	anchored(
		anchor: AgentAnchor,
	): Promise<{ uri: string; mimeType: string; text: string } | null>;
	hunk(anchor: AgentAnchor): Promise<string | null>;
	authorOf(login: string): Promise<CommentRole>;
	/**
	 * The folds joined with GitHub's threads (githubJoin.ts): a live
	 * thread conversation resolved with its GitHub thread, an orphan a
	 * span thread, `githubUnknown` when GitHub can't be read.
	 */
	join(folds: AgentThreadFold[]): Promise<AgentThreadFold[]>;
	/**
	 * GitHub thread `thread` from the session's current read, placed on
	 * `view`; null when GitHub no longer lists it; throws when it can't be read.
	 */
	github(thread: string, view: AgentView): Promise<GithubThreadFacts | null>;
	/** The reviewer's patch sets and GitHub's newest head as last read. */
	views(): { patchsets: PromptPatchset[]; current: string };
	/** Asks GitHub for the PR's head, fetching a new one into the cache clone. */
	checkHead(): Promise<void>;
}

/** What the runner asks of the review's join broker: its agent joins through it. */
export type SpawnJoin = Pick<
	JoinBroker,
	| "admit"
	| "isSpawned"
	| "attached"
	| "handedOut"
	| "release"
	| "setBusy"
	| "spawnedGone"
	| "endGrace"
	| "view"
>;

/** crb's own `/mcp` as this machine reaches it (no query), and its access key. */
export interface SelfMcp {
	url: string;
	key: string | null;
}

export interface RunnerDeps {
	reviewId: string;
	/**
	 * The machine's agent config; `saves` counts the setup modal's Saves
	 * (each one, even of the same config, lets a crashed agent start again).
	 */
	config(): Promise<{
		agent: AgentConfig | null;
		problems: string[];
		saves?: number;
	}>;
	store: AgentThreadStore;
	cacheClone: string;
	head: string;
	port: number;
	facts: RunnerFacts;
	now?: () => number;
	/** Each handed-out question's limit, from `next` to its `reply`. */
	turnMs?: number;
	viewer?: string;
	/**
	 * The review's ACP buddy is off (its spawn flag isn't set, or an
	 * outside session joined through MCP): nothing spawns, no turn starts,
	 * and a process still running is stopped on the next status.
	 */
	acpOff?: () => boolean;
	/** The review's claim, shared with a joined session (else the runner takes its own). */
	claim?: ReviewClaim;
	/** The review's join broker: the spawned agent is its joined session. */
	join: SpawnJoin;
	/** crb's own /mcp; null when unknown (a spawn then fails, saying so). */
	mcp(): SelfMcp | null;
	/** The stdio bridge's command (tests); default bridgeCommand(). */
	bridge?: { command: string; args: string[] };
}

const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** A live title is cut here; the stored list is capped again (capActivity). */
const MAX_TITLE = 200;
/** Live activity entries kept for a hand-out. */
const MAX_LIVE_ACTIVITY = 200;
/**
 * Turns in a row that store no reply while a question is handed out or
 * waits: then the handed-out question fails, and an agent that ignores
 * the wake-up isn't prompted again until a human asks.
 */
export const MAX_DRY_TURNS = 2;
/** How long a broken connection's process gets to exit before it counts as lingering. */
const LINGER_MS = 2_000;
const ACTIVITY_KINDS: readonly string[] = [
	"read",
	"edit",
	"delete",
	"move",
	"search",
	"execute",
	"think",
	"fetch",
	"switch_mode",
	"other",
] satisfies ActivityKind[];

const kindOf = (kind: unknown): ActivityKind =>
	typeof kind === "string" && ACTIVITY_KINDS.includes(kind)
		? (kind as ActivityKind)
		: "other";
const titleOf = (title: unknown): string =>
	typeof title === "string" ? title.slice(0, MAX_TITLE) : "";

/** The wake-up: never the question itself (that comes through `next`). */
export const WAKE_LINE =
	"A question waits for you in the review: call crb's next tool, answer it with reply, and call next again until none waits.";

/** The re-prompt when a turn ends with a question still handed out. */
export const holdLine = (thread: string): string =>
	`You still hold thread ${thread}: answer it with crb's reply tool, then call next.`;

/**
 * The first prompt: the joined preamble and the attach call to make, as
 * one JSON line (the link and the request id are crb's own: a URL and a
 * ULID; JSON.stringify quotes them).
 */
export function kickoffLine(args: {
	review: string;
	request: string;
	name: string;
}): string {
	return `${JOINED_PREAMBLE}\n\ncarbonless started you as this review's buddy, already approved. Call crb's attach tool with exactly these arguments, then follow the instructions it returns:\n${JSON.stringify(
		{ review: args.review, request: args.request, name: args.name },
	)}`;
}

/** What a thread shows when its hand-out ends without a reply. */
export const STOPPED_WITHOUT_ANSWER = "The agent stopped without answering";

/** One spawned process, as the runner tracks it. */
interface Proc {
	agent: AcpAgent | null;
	/** Stops its start while under way. */
	abort: AbortController;
	/** The config it was spawned with (JSON). */
	key: string;
	/** Closed on purpose (config change, close): its exit isn't a crash. */
	stopping: boolean;
}

/** One ACP prompt in flight. */
interface Turn {
	agent: AcpAgent;
	/** Replies stored while it ran. */
	replies: number;
	/** Stop current, or the question's time limit: no wake-up follows it. */
	stopped: boolean;
}

/** The question `next` handed the spawned agent, as the runner sees it. */
interface Hand {
	thread: string;
	activity: AgentActivity[];
	/** toolCallId → its entry in `activity`. */
	calls: Map<string, AgentActivity>;
	/** Its AGENT_TURN_MS limit (restarted by each `next`). */
	timer: ReturnType<typeof setTimeout>;
}

/**
 * The reviewer's spawned agent for one review: it launches the configured
 * command, admits it to the review's join broker (pre-approved), tells it
 * to attach through crb's MCP, and wakes it over ACP when a question
 * waits. The agent answers only through MCP (`next`, `reply`); the runner
 * never stores prompt text. Its extras: live activity on the handed-out
 * question, Stop current, a crash or failed turn shown in the thread.
 * Spec: docs/superpowers/specs/2026-11-13-spawned-agent-mcp-design.md.
 */
export class AgentRunner {
	readonly #deps: RunnerDeps;
	readonly #now: () => number;
	#state: AgentState = "off";
	#since: number;
	#error: string | undefined;
	#elsewhere: number | undefined;
	#configured = false;
	#problems: string[] = [];
	/** The config last read (JSON; null: none); undefined before the first read. */
	#key: string | null | undefined;
	#config: AgentConfig | null = null;
	#proc: Proc | null = null;
	#identity: AgentIdentity | undefined;
	#release: (() => Promise<void>) | null = null;
	#checkout: Checkout | null = null;
	/**
	 * Crashes (and failed kickoffs) since the last good turn: at two, no
	 * respawn until a human asks again or the config is saved.
	 */
	#crashes = 0;
	/** The config saves last seen (RunnerDeps.config). */
	#saves: number | undefined;
	/** The current process has had its kickoff. */
	#kicked = false;
	/** The kickoff's request id (the process's attach). */
	#request: string | null = null;
	#turn: Turn | null = null;
	#hand: Hand | null = null;
	/** Turns in a row that stored no reply while one was due. */
	#dry = 0;
	/** A rejected permission's reason, for that thread's next `next`. */
	readonly #notices = new Map<string, string>();
	#pump: Promise<void> | null = null;
	#again = false;
	#closed: Promise<void> | null = null;
	/** A detach under way (the reviewer's, or ACP found off on a status). */
	#detaching: Promise<void> | null = null;
	/** The last message from the agent's connection (ms). */
	#seen: number | undefined;

	constructor(deps: RunnerDeps) {
		this.#deps = deps;
		this.#now = deps.now ?? Date.now;
		this.#since = this.#now();
	}

	/** The status; reads the config (a change is picked up here) and retries a claim held elsewhere. */
	async status(): Promise<AgentStatus> {
		if (!this.#closed) {
			const read = await this.#readConfig();
			// ACP off: the config is read (configured), nothing starts.
			if (!this.#closed && !this.#off()) {
				if (read.saved && !read.changed && this.#config) {
					// A Save (the same config): a stopped agent starts again.
					if (this.#state === "error" || this.#state === "off") this.poke();
				} else if (read.changed && this.#config) {
					if (this.#state !== "elsewhere") this.#set("starting");
					this.poke();
				} else if (read.changed) {
					this.#set("off");
					this.poke();
				} else if (
					this.#config &&
					(this.#state === "elsewhere" ||
						(this.#state === "off" && !this.#pump))
				) {
					this.poke();
				}
			}
		}
		let waiting = 0;
		try {
			waiting = (await this.#deps.store.read()).filter(
				(t) => t.waiting && !t.resolved,
			).length;
		} catch {
			// The count is a hint; the ref may be unreadable a moment.
		}
		// Questions asked elsewhere (another server showing `elsewhere`)
		// reach the ref, not this runner: the holder wakes its agent on its
		// poll (the dry-turn cap keeps an agent that ignores it unprompted).
		if (waiting > 0 && this.#state === "ready" && !this.#pump) this.poke();
		if (this.#off()) this.#windDown();
		const turn = this.#turn;
		// ACP going off: off at once, unless a turn still finishes (stop()).
		const stopping = this.#off() && !turn;
		const error =
			this.#state === "error" && !stopping
				? this.#error
				: this.#problems.length
					? this.#problems.join("; ")
					: undefined;
		const hand = this.#liveHand();
		return {
			state: stopping ? "off" : this.#state,
			configured: this.#configured,
			...(this.#identity && !stopping ? { agent: this.#identity } : {}),
			since: new Date(this.#since).toISOString(),
			...(hand ? { answering: hand } : {}),
			...(error ? { error } : {}),
			...(this.#state === "elsewhere" && this.#elsewhere !== undefined
				? { elsewhere: this.#elsewhere }
				: {}),
			...(this.#seenAt() ? { seen: this.#seenAt() } : {}),
			waiting,
		};
	}

	/** The handed-out question with its live activity, while the spawned agent holds it. */
	#liveHand(): AgentStatus["answering"] | undefined {
		const handed = this.#deps.join.handedOut();
		if (!handed || !this.#deps.join.isSpawned()) return undefined;
		const activity =
			this.#hand?.thread === handed.thread ? this.#hand.activity : [];
		return {
			thread: handed.thread,
			text: "",
			activity: activity.map((a) => ({ ...a })),
			...(handed.asked ? { asked: handed.asked } : {}),
		};
	}

	/** When the agent was last heard from (ISO): now while it is alive and idle. */
	#seenAt(): string | undefined {
		const agent = this.#proc?.agent;
		if (agent?.alive && !this.#turn && !this.#off()) {
			return new Date(this.#now()).toISOString();
		}
		return this.#seen === undefined
			? undefined
			: new Date(this.#seen).toISOString();
	}

	/** After a human open or message: spawns if needed, then wakes it if a question waits. Never throws. */
	poke(): void {
		if (this.#closed) return;
		if (this.#off()) {
			// The flag cleared elsewhere: what still runs here goes.
			this.#windDown();
			return;
		}
		// A detach under way finishes first; its end pokes again. Not
		// #again: the pump it waits for would take that as a new round.
		if (this.#detaching) return;
		this.#again = true;
		if (this.#pump) return;
		this.#pump = this.#run()
			.catch((error: unknown) => {
				this.#set("error", { error: (error as Error).message });
			})
			.finally(() => {
				this.#pump = null;
				if (this.#closed) return;
				// Turned off while it ran (a poke then found it busy): wind down now.
				if (this.#off()) this.#windDown();
				else if (this.#again) this.poke();
			});
	}

	/**
	 * A human asked (a new thread or a message): like poke, and an agent
	 * that crashed twice may start again, one that went quiet is woken
	 * again. One question, one try: never a loop.
	 */
	asked(): void {
		this.#crashes = 0;
		this.#dry = 0;
		this.poke();
	}

	/**
	 * ACP is going off (an outside join was approved): the turn under way
	 * may finish for up to `ms` (its reply to the thread it holds still
	 * lands: the broker's grace), then is cancelled; the agent is closed
	 * and the status is `off`. The claim and the checkout stay.
	 */
	async stop(ms: number): Promise<void> {
		this.#again = false;
		if (this.#turn && this.#pump) {
			const agent = this.#turn.agent;
			// carbonless's cancel, not the reviewer's: the question keeps
			// waiting for the joined session (principle 2).
			const timer = setTimeout(() => void agent.cancel(), ms);
			try {
				await this.#pump;
			} finally {
				clearTimeout(timer);
			}
		}
		this.#deps.join.endGrace();
		this.#clearHand();
		// Start pressed while the turn finished: the agent stays.
		if (!this.#off()) return;
		await this.#stopProc();
		await this.#pump;
		// A spawn that finished meanwhile (its checks saw ACP off) is closed too.
		await this.#stopProc();
		if (!this.#off()) return;
		this.#identity = undefined;
		if (!this.#closed) this.#set("off");
	}

	#off(): boolean {
		return this.#deps.acpOff?.() ?? false;
	}

	/** Resolves once nothing is running (tests). */
	async settled(): Promise<void> {
		while (this.#pump || this.#detaching) {
			await this.#pump;
			await this.#detaching;
		}
	}

	/**
	 * The reviewer's Detach (its spawn flag already cleared): the turn
	 * under way is cancelled (the question it held waits again), the
	 * process stops, the checkout is removed and the claim released. Off.
	 * Unlike close(), the runner stays usable: the next Spawn starts afresh.
	 */
	detach(): Promise<void> {
		if (this.#closed) return this.#closed;
		return this.#startDetach({ keepCheckout: false });
	}

	/**
	 * ACP turned off with no stop() here (another server's Detach, a flag
	 * removed by hand, a join approved): the process goes and the claim is
	 * let go; the checkout stays for a Spawn to come. On a status or a poke.
	 */
	#windDown(): void {
		if (
			this.#closed ||
			this.#detaching ||
			this.#pump ||
			this.#turn ||
			!(this.#proc || this.#release)
		) {
			return;
		}
		this.#startDetach({ keepCheckout: true }).catch((error: unknown) => {
			this.#set("error", { error: (error as Error).message });
		});
	}

	/**
	 * One detach at a time, after any under way. While one runs, poke()
	 * only records itself; once it is over (and #detaching is clear), a
	 * flag set meanwhile (Spawn, Restart) starts the agent afresh.
	 */
	#startDetach(opts: { keepCheckout: boolean }): Promise<void> {
		const under = this.#detaching;
		const run = async () => {
			await under;
			await this.#detach(opts);
		};
		const mine: Promise<void> = run().finally(() => {
			if (this.#detaching !== mine) return;
			this.#detaching = null;
			if (!this.#closed && !this.#off()) this.poke();
		});
		this.#detaching = mine;
		return mine;
	}

	async #detach(opts: { keepCheckout: boolean }): Promise<void> {
		this.#again = false;
		const turn = this.#turn;
		// carbonless's cancel, not the reviewer's Stop: nothing is stored.
		if (turn) await turn.agent.cancel();
		await this.#stopProc();
		await this.#pump;
		// A spawn that finished meanwhile is closed too.
		await this.#stopProc();
		if (!opts.keepCheckout) {
			await this.#checkout?.remove().catch(() => {});
			this.#checkout = null;
		}
		await this.#release?.().catch(() => {});
		this.#release = null;
		this.#identity = undefined;
		this.#crashes = 0;
		this.#dry = 0;
		this.#seen = undefined;
		if (this.#closed) return;
		// Spawn pressed again while this ran: #startDetach pokes once it ends.
		this.#set("off");
	}

	/**
	 * The reviewer's Stop current: the handed-out question gets a
	 * `cancelled` message (its wait ends, its hand-out too, so a late reply
	 * is refused), then the turn is cancelled. No wake-up follows it.
	 */
	async cancel(): Promise<void> {
		const turn = this.#turn;
		if (!turn) return;
		turn.stopped = true;
		const handed = this.#deps.join.handedOut();
		if (handed && this.#deps.join.isSpawned()) {
			await this.#endHand(handed, { stop: "cancelled" });
		}
		await turn.agent.cancel();
	}

	/** Cancels, closes the agent, removes the checkout and releases the claim. */
	close(): Promise<void> {
		this.#closed ??= (async () => {
			this.#again = false;
			// A detach under way finishes first (one release of the claim).
			await this.#detaching;
			await this.#stopProc();
			await this.#pump;
			await this.#checkout?.remove().catch(() => {});
			this.#checkout = null;
			await this.#release?.().catch(() => {});
			this.#release = null;
			this.#set("off");
		})();
		return this.#closed;
	}

	// The hooks the host calls from the spawned agent's MCP tools.

	/** `next` handed `thread` to the spawned agent: its activity starts (or goes on), its time limit restarts. */
	handed(thread: string): void {
		const hand = this.#hand;
		if (hand) clearTimeout(hand.timer);
		const timer = setTimeout(
			() => void this.#overtime(thread),
			this.#deps.turnMs ?? AGENT_TURN_MS,
		);
		timer.unref?.();
		this.#hand =
			hand?.thread === thread
				? { ...hand, timer }
				: { thread, activity: [], calls: new Map(), timer };
	}

	/** The activity recorded while `thread` was handed out (a copy). */
	activity(thread: string): AgentActivity[] {
		return this.#hand?.thread === thread
			? this.#hand.activity.map((a) => ({ ...a }))
			: [];
	}

	/** The spawned agent's reply to `thread` was stored: its hand-out (and limit) ends. */
	replied(thread: string): void {
		if (this.#hand?.thread === thread) this.#clearHand();
		if (this.#turn) this.#turn.replies++;
		this.#crashes = 0;
	}

	/** A rejected permission's reason for `thread`, once: it goes into what `next` returns. */
	takeNotice(thread: string): string | undefined {
		const n = this.#notices.get(thread);
		this.#notices.delete(thread);
		return n;
	}

	#clearHand(): void {
		if (this.#hand) clearTimeout(this.#hand.timer);
		this.#hand = null;
	}

	/** The handed-out question ran past its limit: it fails, the turn is cancelled. */
	async #overtime(thread: string): Promise<void> {
		const handed = this.#deps.join.handedOut();
		if (handed?.thread !== thread || !this.#deps.join.isSpawned()) return;
		const minutes = Math.max(
			1,
			Math.round((this.#deps.turnMs ?? AGENT_TURN_MS) / 60_000),
		);
		const turn = this.#turn;
		if (turn) turn.stopped = true;
		await this.#endHand(handed, {
			stop: "error",
			error: `The agent took longer than ${minutes} min`,
		});
		await turn?.agent.cancel();
	}

	/**
	 * Ends the hand-out of `handed` without an answer: released first (a
	 * late reply is refused), then a message with `stop` (and `error`)
	 * replying to the question, which ends its wait.
	 */
	async #endHand(
		handed: { thread: string; asked: string | undefined },
		how: { stop: AgentStop; error?: string },
	): Promise<void> {
		const { join } = this.#deps;
		const who = join.view().joined;
		const activity = this.activity(handed.thread);
		join.release(handed.thread);
		if (this.#hand?.thread === handed.thread) this.#clearHand();
		const agent: AgentIdentity = who
			? { name: who.name, version: who.harness ?? "", via: "acp" }
			: { ...(this.#identity ?? { name: "agent", version: "" }), via: "acp" };
		try {
			await this.#deps.store.message(handed.thread, {
				by: "ai",
				text: "",
				agent,
				stop: how.stop,
				activity,
				...(handed.asked ? { replyTo: handed.asked } : {}),
				...(how.error ? { error: how.error } : {}),
			});
		} catch (error) {
			this.#set("error", {
				error: `Could not store the agent's stop: ${(error as Error).message}`,
			});
		}
	}

	#set(
		state: AgentState,
		extra: { error?: string; elsewhere?: number } = {},
	): void {
		if (state !== this.#state) this.#since = this.#now();
		this.#state = state;
		this.#error = extra.error;
		this.#elsewhere = extra.elsewhere;
	}

	/**
	 * Reads the config; on a change, a turn under way is cancelled (the pump
	 * applies it). A new Save, changed or not, opens the crash gate.
	 */
	async #readConfig(): Promise<{ changed: boolean; saved: boolean }> {
		const { agent, problems, saves } = await this.#deps.config();
		this.#problems = problems;
		this.#configured = agent !== null;
		const saved = this.#saves !== undefined && saves !== this.#saves;
		this.#saves = saves;
		if (saved) this.#crashes = 0;
		const key = agent ? JSON.stringify(agent) : null;
		if (key === this.#key) return { changed: false, saved };
		const first = this.#key === undefined;
		this.#key = key;
		this.#config = agent;
		this.#crashes = 0;
		if (this.#proc && this.#proc.key !== key && this.#turn) {
			await this.#proc.agent?.cancel();
		}
		return { changed: !first, saved };
	}

	async #run(): Promise<void> {
		while (this.#again && !this.#closed) {
			this.#again = false;
			const agent = await this.#ensure();
			if (agent) await this.#work(agent);
		}
	}

	/** The running agent, spawned (and admitted) if it should run; null when it can't or shouldn't. */
	async #ensure(): Promise<AcpAgent | null> {
		await this.#readConfig();
		if (this.#closed) return null;
		if (this.#off()) {
			await this.#stopProc();
			this.#identity = undefined;
			this.#set("off");
			return null;
		}
		const config = this.#config;
		if (this.#proc && this.#proc.key !== this.#key) await this.#stopProc();
		if (!config) {
			// Off: another server may take the review's agent (and sweep its
			// dir), so the tree goes with the claim.
			await this.#checkout?.remove().catch(() => {});
			this.#checkout = null;
			await this.#release?.().catch(() => {});
			this.#release = null;
			this.#set("off");
			return null;
		}
		if (this.#proc?.agent) {
			if (this.#proc.agent.alive) return this.#proc.agent;
			// Its connection closed but the process lingers: killed, replaced.
			await this.#lost(this.#proc);
		}
		// Twice crashed without a good turn between: stays error until a
		// human asks again or the config is saved.
		if (this.#crashes >= 2) return null;
		if (!this.#release) {
			const claim = this.#deps.claim
				? await this.#deps.claim.hold("acp")
				: await takeClaim(this.#dir(), {
						pid: process.pid,
						port: this.#deps.port,
					});
			if (!claim.ok) {
				this.#set("elsewhere", { elsewhere: claim.holder.port });
				return null;
			}
			if (this.#closed) {
				await claim.release();
				return null;
			}
			this.#release = claim.release;
		}
		// ACP went off while the claim was taken.
		if (this.#off()) return null;
		// The config moved while the claim was taken: the next round has it.
		if (this.#config !== config) return null;
		const mcp = this.#deps.mcp();
		if (!mcp) {
			this.#set("error", {
				error:
					"carbonless doesn't know its own address yet: the agent can't reach its tools",
			});
			return null;
		}
		this.#set("starting");
		// A tree removed under us (a sweep, by hand) is made again.
		if (this.#checkout && !existsSync(join(this.#checkout.tree, ".git"))) {
			this.#checkout = null;
		}
		try {
			// Made at spawn, at the PR's head; crb never moves it after that.
			this.#checkout ??= await createCheckout(
				this.#deps.cacheClone,
				this.#deps.reviewId,
				this.#deps.facts.review().head.commit || this.#deps.head,
			);
		} catch (error) {
			this.#set("error", {
				error: `Could not make the agent's checkout: ${(error as Error).message}`,
			});
			return null;
		}
		// Closed while the checkout was made: close() found no process to
		// stop and waits for this pump, so a start now would hold it until
		// the start times out (close removes the checkout after).
		if (this.#closed) return null;
		// ACP went off while the checkout was made: nothing spawns.
		if (this.#off()) {
			this.#set("off");
			return null;
		}
		const key = this.#key as string;
		const proc: Proc = {
			agent: null,
			abort: new AbortController(),
			key,
			stopping: false,
		};
		this.#proc = proc;
		// This process's alone: only it can collect the request below.
		const secret = randomBytes(32).toString("base64url");
		let agent: AcpAgent;
		try {
			agent = await AcpAgent.spawn({
				command: config.command,
				args: config.args,
				env: agentEnv(config.env),
				cwd: this.#checkout.tree,
				stderrFile: join(this.#checkout.dir, "agent.stderr.log"),
				onUpdate: (u) => this.#onUpdate(u),
				onPermission: (req) => this.#onPermission(req),
				onExit: (code, signal) => this.#onExit(proc, code, signal),
				signal: proc.abort.signal,
				mcp: {
					url: mcp.url,
					key: mcp.key,
					headers: [{ name: "X-Crb-Spawn", value: secret }],
				},
				...(this.#deps.bridge ? { bridge: this.#deps.bridge } : {}),
			});
		} catch (error) {
			if (this.#proc === proc) this.#proc = null;
			if (!proc.stopping) this.#set("error", { error: startError(error) });
			return null;
		}
		proc.agent = agent;
		if (
			proc.stopping ||
			this.#closed ||
			this.#off() ||
			this.#proc !== proc ||
			proc.key !== this.#key
		) {
			if (this.#proc === proc) this.#proc = null;
			proc.stopping = true;
			await agent.close();
			return null;
		}
		this.#identity = agent.info;
		// Pressing Spawn is the approval: a request already approved.
		const { request } = this.#deps.join.admit(
			{
				name: agent.info.name,
				machine: hostname(),
				...(agent.info.version ? { harness: agent.info.version } : {}),
			},
			secret,
		);
		this.#request = request;
		this.#kicked = false;
		this.#dry = 0;
		this.#clearHand();
		// Its handshake answered.
		this.#seen = this.#now();
		this.#set("ready");
		return agent;
	}

	async #stopProc(): Promise<void> {
		const proc = this.#proc;
		if (!proc) return;
		this.#proc = null;
		proc.stopping = true;
		proc.abort.abort();
		// Its join ends with it: a question it held waits again.
		if (proc.agent) this.#deps.join.spawnedGone("disconnected");
		this.#clearHand();
		await proc.agent?.close();
	}

	/**
	 * A process whose connection closed while it still runs: a crash (it
	 * counts), then killed.
	 */
	async #lost(proc: Proc): Promise<void> {
		if (proc.stopping) return;
		if (this.#proc === proc) this.#proc = null;
		proc.stopping = true;
		this.#crashes++;
		const tail = proc.agent?.stderrTail().trim() ?? "";
		const reason = `The agent's connection closed${tail ? `: ${tail.slice(-500)}` : ""}`;
		await this.#gone(reason);
		this.#set("error", { error: reason });
		await proc.agent?.close();
	}

	#onExit(proc: Proc, code: number | null, signal: string | null): void {
		if (proc.stopping || this.#closed) return;
		if (this.#proc === proc) this.#proc = null;
		proc.stopping = true;
		this.#crashes++;
		const tail = proc.agent?.stderrTail().trim() ?? "";
		const how = signal ? `on ${signal}` : `with code ${code}`;
		const reason = `exited ${how}${tail ? `: ${tail.slice(-500)}` : ""}`;
		this.#set("error", { error: reason });
		void this.#gone(reason);
	}

	/** The process went (a crash): the question it held shows why, then its join ends. */
	async #gone(reason: string): Promise<void> {
		const { join } = this.#deps;
		const handed = join.isSpawned() ? join.handedOut() : null;
		if (handed) {
			await this.#endHand(handed, {
				stop: "error",
				error: reason.slice(0, 300),
			});
		}
		join.spawnedGone("lost");
		this.#clearHand();
	}

	/** Whether `agent` is the one that should run now. */
	#usable(agent: AcpAgent): boolean {
		return (
			!this.#closed &&
			!this.#off() &&
			this.#proc?.agent === agent &&
			this.#proc.key === this.#key &&
			agent.alive
		);
	}

	#dir(): string {
		return join(agentsDir(), this.#deps.reviewId);
	}

	/** Whether a question waits for the agent (as `next` would hand it one). */
	async #waiting(): Promise<boolean> {
		const threads = await this.#deps.facts.join(await this.#deps.store.read());
		return threads.some(
			(t) => t.waiting && (t.anchor.subject === "thread" || !t.resolved),
		);
	}

	/** Prompts the agent while there is a reason to: kickoff, a held question, a waiting one. */
	async #work(agent: AcpAgent): Promise<void> {
		for (;;) {
			if (!this.#usable(agent)) return;
			const line = await this.#line();
			if (line === null) {
				if (this.#usable(agent) && this.#state !== "error") {
					this.#set("ready");
				}
				return;
			}
			if (!this.#usable(agent)) return;
			if (!(await this.#prompt(agent, line))) return;
		}
	}

	/** The next prompt's text; null: nothing to say (idle). */
	async #line(): Promise<{ text: string; kickoff: boolean } | null> {
		const { join } = this.#deps;
		if (!this.#kicked) {
			this.#kicked = true;
			const mcp = this.#deps.mcp();
			const request = this.#request;
			if (!mcp || !request) return null;
			return {
				kickoff: true,
				text: kickoffLine({
					review: `${new URL(mcp.url).origin}/r/${this.#deps.reviewId}`,
					request,
					name: join.view().joined?.name ?? this.#identity?.name ?? "agent",
				}),
			};
		}
		if (!join.isSpawned()) return null;
		for (;;) {
			const handed = join.handedOut();
			if (handed) {
				if (this.#dry < MAX_DRY_TURNS) {
					return { kickoff: false, text: holdLine(handed.thread) };
				}
				// Two turns without a reply: the question fails (red, its
				// wait ends); the reviewer asks again to retry.
				await this.#endHand(handed, {
					stop: "error",
					error: STOPPED_WITHOUT_ANSWER,
				});
				this.#dry = 0;
				continue;
			}
			// Woken twice for nothing: quiet until a human asks.
			if (this.#dry >= MAX_DRY_TURNS) return null;
			if (await this.#waiting()) return { kickoff: false, text: WAKE_LINE };
			this.#dry = 0;
			return null;
		}
	}

	/** One ACP turn; false when the work should stop. */
	async #prompt(
		agent: AcpAgent,
		line: { text: string; kickoff: boolean },
	): Promise<boolean> {
		const { join } = this.#deps;
		const turn: Turn = { agent, replies: 0, stopped: false };
		this.#turn = turn;
		join.setBusy(true);
		this.#set("busy");
		let r: { text: string; stop: AgentStop; error?: string };
		try {
			r = await agent.prompt([{ type: "text", text: line.text }]);
		} finally {
			join.setBusy(false);
			if (this.#turn === turn) this.#turn = null;
		}
		if (r.stop !== "error") this.#seen = this.#now();
		const proc = this.#proc;
		if (proc?.agent === agent && !proc.stopping && !agent.alive) {
			// Its connection broke: an exit (onExit says why) or a process
			// that lingers with its stdout closed (killed here).
			const exited = await agent.exitsWithin(LINGER_MS);
			if (!exited && !proc.stopping) await this.#lost(proc);
			return false;
		}
		// Off (Detach, an approved join), closed, replaced or crashed:
		// whoever did that says what happens next.
		if (!this.#usable(agent)) return false;
		if (line.kickoff && !(join.isSpawned() && join.attached())) {
			this.#crashes++;
			const why = r.error ? `: ${r.error}` : "";
			await this.#stopProc();
			this.#set("error", {
				error: `The agent didn't attach to the review${why}`,
			});
			return false;
		}
		if (r.stop === "error") {
			// A failed turn: the question it held shows the agent's reason.
			const handed = join.handedOut();
			const reason = r.error ?? "The agent's turn failed";
			if (handed) await this.#endHand(handed, { stop: "error", error: reason });
			this.#set("error", { error: reason });
			return false;
		}
		if (turn.stopped) {
			this.#set("ready");
			return false;
		}
		if (turn.replies > 0) this.#dry = 0;
		else if (join.handedOut() || (await this.#waiting())) this.#dry++;
		this.#set("ready");
		return true;
	}

	#onUpdate(u: SessionUpdate): void {
		this.#seen = this.#now();
		const a = this.#currentHand();
		if (!a) return;
		if (u.sessionUpdate === "tool_call") {
			const entry: AgentActivity = {
				kind: kindOf(u.kind),
				title: titleOf(u.title),
			};
			if (a.activity.length < MAX_LIVE_ACTIVITY) a.activity.push(entry);
			a.calls.set(u.toolCallId, entry);
		} else if (u.sessionUpdate === "tool_call_update") {
			const entry = a.calls.get(u.toolCallId);
			if (entry && typeof u.title === "string" && u.title) {
				entry.title = titleOf(u.title);
			}
		}
	}

	/** The runner's record of the question the broker says is handed out now. */
	#currentHand(): Hand | null {
		const handed = this.#deps.join.handedOut();
		return handed && this.#hand?.thread === handed.thread ? this.#hand : null;
	}

	#onPermission(req: RequestPermissionRequest): RequestPermissionResponse {
		this.#seen = this.#now();
		const d = decidePermission(req, this.#config?.leash ?? "open");
		const a = this.#currentHand();
		if (a) {
			const known = a.calls.get(req.toolCall.toolCallId);
			if (known) known.decision = d.decision;
			else if (a.activity.length < MAX_LIVE_ACTIVITY) {
				const entry: AgentActivity = {
					kind: kindOf(req.toolCall.kind),
					title: titleOf(req.toolCall.title),
					decision: d.decision,
				};
				a.activity.push(entry);
				a.calls.set(req.toolCall.toolCallId, entry);
			}
			if (d.decision === "rejected" && d.reason) {
				this.#notices.set(a.thread, d.reason);
			}
		}
		return d.response;
	}
}

/**
 * The comparison a thread turn answers in: the view sent with the last
 * human message, else (an agent-started conversation, or a message sent
 * without one) the latest patch set against the base branch, or the
 * snapshot's head when there is none.
 */
export function viewOf(
	thread: AgentThreadFold,
	patchsets: readonly PromptPatchset[],
	review: PromptReview,
): AgentView {
	const sent = thread.messages.findLast((m) => m.by === "human")?.view;
	if (sent && OID.test(sent.right) && OID.test(sent.left)) return sent;
	const latest = patchsets.reduce<PromptPatchset | undefined>(
		(a, p) => (a && a.number > p.number ? a : p),
		undefined,
	);
	if (latest) {
		return {
			target: { patchset: latest.number },
			from: { branch: true },
			left: latest.mergeBase,
			right: latest.head,
		};
	}
	return {
		target: { head: review.head.commit },
		from: { branch: true },
		left: review.mergeBase,
		right: review.head.commit,
	};
}

function startError(error: unknown): string {
	if (error instanceof AgentStartError) {
		const tail = error.stderr.trim().slice(-500);
		return tail ? `${error.message}: ${tail}` : error.message;
	}
	return (error as Error).message;
}
