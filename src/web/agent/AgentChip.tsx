import { PlugIcon, SparkleFillIcon } from "@primer/octicons-react";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { AgentStatus } from "../../shared/agent";
import { ApiError, overviewQuery } from "../api";
import { plural } from "../overview/parts";
import { SpinnerIcon } from "../Spinner";
import { Tooltip } from "../Tooltip";
import { agentStatusQuery, agentThreadsQuery, useAgentOn } from "./api";
import { toggleReviewDrawer, useReviewDrawerOpen } from "./drawerStore";
import { useReviewConversation } from "./reviewConversation";
import { openAgentSetup } from "./setupStore";

/**
 * Spawned (not joined) and the runner not up yet: starting when an agent is
 * configured, an error when none is (nothing will ever start).
 */
function spawnGap(status: AgentStatus): "starting" | "unconfigured" | null {
	if (status.joined || !status.spawned || status.state !== "off") return null;
	return status.configured ? "starting" : "unconfigured";
}

/** The status dot's colour: muted off or elsewhere, yellow on its way or busy, green ready, red failing. */
export function agentDot(status: AgentStatus): string {
	const gap = spawnGap(status);
	if (status.state === "error" || status.error || gap === "unconfigured")
		return "bg-bad";
	if (status.state === "ready") return "bg-ok";
	if (
		gap === "starting" ||
		status.state === "starting" ||
		status.state === "busy" ||
		status.state === "reconnecting"
	)
		return "bg-warn";
	return "bg-unreviewed";
}

/** What the chip's tooltip says of the status. */
export function agentTip(status: AgentStatus): string {
	const who = status.agent
		? `${status.agent.name}${status.agent.version ? ` ${status.agent.version}` : ""}`
		: "";
	if (status.error) return status.error;
	if (status.via === "mcp" && status.joined) {
		const name = status.joined.name;
		if (status.state === "busy") return `${name} · answering`;
		if (status.state === "reconnecting") return `${name} · reconnecting`;
		return `${name} · listening`;
	}
	const gap = spawnGap(status);
	if (gap === "unconfigured") return "No agent configured";
	if (gap === "starting") return who ? `${who} · starting` : "Starting";
	switch (status.state) {
		case "off":
			return status.configured
				? "No agent · spawn or invite"
				: "No agent · set one up";
		case "starting":
			return who ? `${who} · starting` : "Starting";
		case "busy": {
			const n = Math.max(1, status.waiting);
			const doing = `answering ${plural(n, "thread")}`;
			return who ? `${who} · ${doing}` : doing;
		}
		case "elsewhere":
			return status.elsewhere
				? `answered by the server on :${status.elsewhere}`
				: "answered by another server";
		case "error":
			return "The agent failed";
		case "reconnecting":
			return who ? `${who} · reconnecting` : "Reconnecting";
		default:
			return who || "Ready";
	}
}

/**
 * Keeps the agent threads in step with the status: whenever its state
 * (or when it last changed), the thread being answered or the waiting count
 * moves, the threads are read again (a reply landed, a question was taken
 * up).
 */
export function useAgentSync(
	client: QueryClient,
	status: AgentStatus | undefined,
): void {
	// `since` moves on every state change: a turn that began and ended
	// between two polls still shows.
	const key = status
		? `${status.state}|${status.since}|${status.answering?.thread ?? ""}|${status.waiting}`
		: "";
	const last = useRef(key);
	useEffect(() => {
		if (!key || key === last.current) return;
		const first = last.current === "";
		last.current = key;
		if (first) return;
		void client.invalidateQueries({
			queryKey: agentThreadsQuery.queryKey,
			exact: true,
		});
	}, [key, client]);
}

/**
 * Whether pressing the chip toggles the review conversation's drawer: an
 * ACP agent configured, a session joined, or the conversation already
 * there (an MCP-only reviewer whose session left can still read it).
 * Otherwise it opens the agent setup.
 */
export const chipOpensDrawer = (
	status: AgentStatus | undefined,
	conversation: boolean,
): boolean =>
	Boolean(status?.configured) || Boolean(status?.joined) || conversation;

/** The chip's icon colour: the status dot's, as text (agentDot). */
export function agentInk(status: AgentStatus): string {
	switch (agentDot(status)) {
		case "bg-bad":
			return "text-bad";
		case "bg-ok":
			return "text-ok";
		case "bg-warn":
			return "text-warn";
		default:
			return "text-unreviewed";
	}
}

/** The chip's one size, wherever it is (and the space kept for it): its tap target. */
export const CHIP_BOX = "flex h-10 w-10 shrink-0 items-center justify-center";

/**
 * The header's right column for the chip, mirroring the logo on the left:
 * always reserved at the chip's size (as of a cutoff, in another
 * reviewer's view and while the chip is docked too, empty then), so the
 * title wraps between the two, the row's height never changes, and the
 * column's top (where the chip docks from) stays put.
 */
export const CHIP_COLUMN =
	"flex h-10 w-10 shrink-0 items-center justify-center";

/**
 * The chip's face, a 32px bordered circle (a control's outline,
 * line-strong), smaller than the logo, so it reads as a button; its icon or
 * spinner (CHIP_ICON px) inside.
 */
const CHIP_FACE =
	"flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-raised";

/** Pressed (the drawer open): the agent wash inside agent-edge. */
const CHIP_FACE_PRESSED = CHIP_FACE.replace(
	"border-line-strong bg-raised",
	"border-agent-edge bg-agent",
);
const CHIP_ICON = 18;

/**
 * Whether the header keeps a place for the chip: from the first paint
 * (the overview, which says whether there is an agent, still on its way),
 * until known to have none (as of a cutoff, --viewer, no agent).
 */
export function useAgentChipPlace(asOf: boolean): boolean {
	const overview = useQuery({ ...overviewQuery, enabled: false });
	const on = overview.data?.writes === "on";
	// Reads what the chip read; never asks itself (no chip, no read).
	const status = useQuery({ ...agentStatusQuery, enabled: false });
	if (asOf) return false;
	if (overview.data && !on) return false;
	return !(status.error instanceof ApiError && status.error.status === 404);
}

/**
 * The reviewer's agent and the review conversation in the header, in its
 * own column pinned right (in the sticky row's right end once scrolled):
 * the sparkle alone, coloured by its status, in a bordered circle; the
 * name and detail in the tooltip. One size in every state (CHIP_BOX).
 * The conversation's message count sits on the lower right once it has
 * any (a joined session's plug inside it, before the number; the plug
 * alone without messages), an unread dot top right while an answer is
 * unseen, and it looks pressed while the drawer is open. Pressing it
 * toggles the drawer (chipOpensDrawer), else opens the agent setup. Until
 * the overview says whether there is an agent, and on its first read, a
 * spinner in the icon's place; no count until the threads are read
 * (never a 0). None where the review has no agent (--viewer, --as-of).
 */
export function AgentChip({
	dismissKey,
	asOf = false,
}: {
	/** Closes the tooltip whenever it changes (the chip moved). */
	dismissKey?: unknown;
	/** As of a cutoff (the session says): no agent, no chip. */
	asOf?: boolean;
} = {}) {
	const client = useQueryClient();
	const on = useAgentOn();
	const status = useQuery({ ...agentStatusQuery, enabled: on });
	const place = useAgentChipPlace(asOf);
	useAgentSync(client, status.data);
	const conversation = useReviewConversation();
	const drawerOpen = useReviewDrawerOpen();
	if (!place) return null;
	if (!on) {
		// Whether there is an agent isn't known yet: its place, spinning.
		return (
			<span
				aria-hidden
				data-chip-space
				data-testid="agent-chip-pending"
				className={CHIP_BOX}
			>
				<span className={CHIP_FACE}>
					<SpinnerIcon size={CHIP_ICON} className="text-muted" />
				</span>
			</span>
		);
	}
	const data = status.data;
	const tip = data
		? agentTip(data)
		: status.error
			? status.error.message
			: "Loading your agent";
	const joined = data?.via === "mcp" && Boolean(data.joined);
	const thread = conversation.thread;
	// Only once the threads are read: never a 0 while they load.
	const count = thread?.messages.length ?? 0;
	const unread = Boolean(thread?.unread);
	const drawer = chipOpensDrawer(data, thread !== undefined);
	const pressed = drawerOpen && drawer;
	const name = [
		`Your agent: ${tip}`,
		count > 0 ? plural(count, "message") : "",
		unread ? "unread" : "",
	]
		.filter(Boolean)
		.join(" · ");
	const plug = (
		<span aria-hidden data-testid="agent-chip-plug" className="flex">
			<PlugIcon size={10} />
		</span>
	);
	return (
		<Tooltip content={tip} describe={false} dismissKey={dismissKey}>
			{(trigger) => (
				<button
					type="button"
					{...trigger}
					data-testid="agent-chip"
					data-state={data?.state}
					data-via={data?.via}
					aria-label={name}
					aria-busy={status.isPending || undefined}
					aria-expanded={drawer ? pressed : undefined}
					aria-controls={drawer ? "review-conversation" : undefined}
					onClick={() => {
						if (drawer) toggleReviewDrawer();
						else openAgentSetup();
					}}
					className={`group ${CHIP_BOX} rounded-full focus-visible:outline-2 focus-visible:outline-accent`}
				>
					<span
						data-testid="agent-chip-face"
						className={`relative ${
							pressed
								? CHIP_FACE_PRESSED
								: joined
									? CHIP_FACE.replace("border-line-strong", "border-agent-edge")
									: `${CHIP_FACE} group-hover:bg-overlay`
						}`}
					>
						{status.isPending ? (
							<span data-testid="agent-chip-loading" className="flex">
								<SpinnerIcon size={CHIP_ICON} className="text-muted" />
							</span>
						) : (
							<span
								data-testid="agent-chip-icon"
								className={`flex ${data ? agentInk(data) : "text-bad"}`}
							>
								<SparkleFillIcon size={CHIP_ICON} aria-hidden />
							</span>
						)}
						{count > 0 ? (
							<span
								aria-hidden
								data-testid="agent-chip-count"
								className="absolute -right-2 -bottom-1.5 flex h-4 min-w-4 items-center justify-center gap-0.5 rounded-full border border-agent-edge bg-agent px-1 text-[11px] leading-none font-bold text-agent-ink tabular-nums"
							>
								{joined && plug}
								{count}
							</span>
						) : (
							joined && (
								<span
									aria-hidden
									className="absolute -right-1 -bottom-1 flex rounded-full border border-agent-edge bg-agent p-px text-agent-ink"
								>
									{plug}
								</span>
							)
						)}
						{unread && (
							<span
								aria-hidden
								data-testid="agent-chip-unread"
								className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent"
							/>
						)}
					</span>
				</button>
			)}
		</Tooltip>
	);
}
