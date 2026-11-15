import { AlertIcon } from "@primer/octicons-react";
import type { AgentThread } from "../../shared/agent";
import { SpinnerIcon } from "../Spinner";
import { Tooltip } from "../Tooltip";
import {
	conversationLabel,
	LINK_ERROR,
	linkState,
	useGithubAuthors,
	useLinkFacts,
	useOpenConversation,
} from "./conversationLinks";

/** The first words of a text, on one line (the box cuts it with an ellipsis). */
export const firstLine = (text: string): string =>
	text.replace(/\s+/g, " ").trim();

/**
 * The conversations one request started, in the order they were opened:
 * the unread dot, where each is, and the first words of the agent's
 * message from that request there. Each opens its conversation; the one
 * being read (`current`) is marked.
 */
export function StartedList(props: {
	/** The request message's id. */
	request: string;
	threads: readonly AgentThread[];
	current?: string;
	id?: string;
}) {
	const open = useOpenConversation();
	const authorOf = useGithubAuthors();
	const facts = useLinkFacts();
	return (
		<ul
			id={props.id}
			data-testid="agent-started-list"
			aria-label="Conversations from this request"
			className="min-w-0 divide-y divide-line overflow-hidden rounded-md border border-edge bg-raised"
		>
			{props.threads.map((t) => {
				const said =
					t.messages.find(
						(m) => m.by === "ai" && m.origin?.message === props.request,
					)?.text ?? "";
				const current = t.id === props.current;
				const link = linkState(t, facts).state;
				const placeable = link === "ready";
				const label = conversationLabel(t, authorOf);
				const row = (
					<button
						type="button"
						data-testid="agent-started-item"
						data-thread={t.id}
						aria-current={current || undefined}
						disabled={!placeable}
						aria-busy={link === "loading" || undefined}
						onClick={() => open(t)}
						className={`flex min-h-10 w-full min-w-0 items-center gap-2 px-2 text-left text-sm hover:bg-overlay focus-visible:outline-2 focus-visible:outline-accent disabled:text-faint ${
							current ? "bg-overlay font-semibold" : ""
						}`}
					>
						<span className="flex w-2.5 shrink-0 justify-center">
							{t.unread && (
								<span
									role="img"
									aria-label="Unread"
									data-testid="agent-unread-dot"
									className="h-2.5 w-2.5 rounded-full bg-accent"
								/>
							)}
						</span>
						{/* A kept slot: the spinner (its place is still being read, never
						"not in the files") or the error comes and goes without moving the label. */}
						<span
							data-testid="agent-started-state"
							className="flex w-3 shrink-0 justify-center"
						>
							{link === "loading" && <SpinnerIcon size={12} />}
							{link === "error" && (
								<AlertIcon
									size={12}
									aria-label={LINK_ERROR}
									className="text-bad"
								/>
							)}
						</span>
						<span className="max-w-[45%] shrink-0 truncate font-mono text-xs text-link">
							{label}
						</span>
						<span className="min-w-0 flex-1 truncate text-ink-soft">
							{firstLine(said)}
						</span>
					</button>
				);
				return (
					<li key={t.id} className="min-w-0">
						{link === "ready" || link === "loading" ? (
							row
						) : (
							<Tooltip
								content={
									link === "error" ? LINK_ERROR : "Not in this review's files"
								}
								describe={false}
							>
								{(trigger) => (
									<span {...trigger} className="block">
										{row}
									</span>
								)}
							</Tooltip>
						)}
					</li>
				);
			})}
		</ul>
	);
}
