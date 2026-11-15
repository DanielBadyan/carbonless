import { AlertIcon, SparkleFillIcon } from "@primer/octicons-react";
import type { AgentThread } from "../../shared/agent";
import type { ReviewThread } from "../../shared/types";
import { Spinner } from "../Spinner";
import { Tooltip } from "../Tooltip";
import { useAgentOn } from "./api";
import {
	agentButtonName,
	agentFor,
	useAgentThreadsFailed,
	useAgentThreadsLoading,
	useThreadAgentContext,
} from "./threadAgent";

/**
 * The room a card keeps free on its right for the agent tab: the tab
 * (32px; 40px on a phone and under a finger) and a 4-8px gap. The card's
 * box that holds the tab is `relative` and has this right padding.
 */
export const AGENT_TAB_GUTTER = "pr-10 max-sm:pr-11 pointer-coarse:pr-11";

/**
 * The tab: a drawer opener on the card's right edge, flush with its
 * border (rounded on the side facing the card only), near the top, where
 * the conversation slides in from. At least 48px tall.
 */
const TAB =
	"absolute top-2 right-0 flex min-h-12 w-8 shrink-0 flex-col items-center justify-center gap-0.5 rounded-l-lg border border-r-0 py-1.5 max-sm:w-10 pointer-coarse:w-10";

/**
 * A thread card's agent tab, a drawer opener on the card's right edge
 * (the caller keeps AGENT_TAB_GUTTER free for it): the teal tab with the
 * sparkle and the number of messages in the thread's agent conversation,
 * an `accent` dot while one of the agent's is unseen; a dashed sparkle
 * ("Ask agent") before there is one. Pressed while the conversation is
 * open, the panel's handle at its right edge. A spinner in its place
 * while the agent threads load (never "Ask agent" that would then turn
 * into a count); an alert in `bad` when they couldn't be read, still
 * pressable (it opens the panel and reads them again). Absent on a
 * thread with no id, a deleted one, and where the session doesn't write.
 */
export function ThreadAgentButton(props: {
	thread: ReviewThread;
	conversation: AgentThread | undefined;
	open: boolean;
	onToggle: () => void;
}) {
	const { conversation, open } = props;
	const on = useAgentOn();
	const loading = useAgentThreadsLoading();
	const { failed, retry } = useAgentThreadsFailed();
	const ref = useThreadAgentContext()?.buttonRef;
	if (!agentFor(props.thread, on)) return null;
	if (loading && !conversation) {
		return (
			<span
				data-testid="thread-agent-loading"
				aria-busy="true"
				className={`${TAB} border-line`}
			>
				<Spinner label="Loading agent messages" size={14} />
			</span>
		);
	}
	if (failed && !conversation) {
		const failedName = "Agent messages couldn't load";
		return (
			<Tooltip content={failedName} describe={false}>
				{(trigger) => (
					<button
						{...trigger}
						ref={(el) => {
							trigger.ref(el);
							if (ref) ref.current = el;
						}}
						type="button"
						data-testid="thread-agent-button"
						data-failed="true"
						aria-label={failedName}
						aria-pressed={open}
						onClick={() => {
							retry();
							props.onToggle();
						}}
						className={`${TAB} border-dashed border-bad text-bad hover:bg-agent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`}
					>
						<AlertIcon size={14} aria-hidden />
					</button>
				)}
			</Tooltip>
		);
	}
	const name = agentButtonName(conversation, open);
	const tip = conversation ? name : "Ask agent";
	const unread = conversation?.unread === true && !open;
	return (
		<Tooltip content={tip} describe={false}>
			{(trigger) => (
				<button
					{...trigger}
					ref={(el) => {
						trigger.ref(el);
						if (ref) ref.current = el;
					}}
					type="button"
					data-testid="thread-agent-button"
					aria-label={name}
					aria-pressed={open}
					onClick={props.onToggle}
					className={`${TAB} text-xs font-semibold text-agent-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
						conversation
							? open
								? "border-agent-ink bg-agent shadow-[inset_0_0_0_1px_var(--color-agent-ink)]"
								: "border-agent-edge bg-agent hover:border-agent-ink"
							: open
								? "border-dashed border-agent-ink bg-agent"
								: "border-dashed border-agent-edge hover:border-agent-ink hover:bg-agent"
					}`}
				>
					<SparkleFillIcon size={14} aria-hidden />
					{conversation && (
						<span aria-hidden>{conversation.messages.length}</span>
					)}
					{unread && (
						<span
							aria-hidden
							data-testid="agent-unread-dot"
							className="absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent"
						/>
					)}
				</button>
			)}
		</Tooltip>
	);
}
