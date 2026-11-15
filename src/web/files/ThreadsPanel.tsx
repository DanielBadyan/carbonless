import {
	AlertIcon,
	CheckCircleIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	HistoryIcon,
	type Icon,
	PersonIcon,
	SparkleFillIcon,
} from "@primer/octicons-react";
import { useId } from "react";
import { RelativeTime } from "../RelativeTime";
import { Spinner } from "../Spinner";
import { Tooltip, TooltipPath } from "../Tooltip";
import { Avatar } from "../threads/people";
import type { SidebarState } from "./sidebarState";
import { type LastSpeaker, listedRows, type PanelRow } from "./threadRows";

/** What a row's speaker icon says. */
function speakerText(last: LastSpeaker): string {
	if (last.kind === "agent") return last.by === "ai" ? "the agent" : "you";
	return last.login || "unknown";
}

/** The row's speaker: their avatar on GitHub; you or the agent in an AI conversation. */
function Speaker({ last }: { last: LastSpeaker }) {
	if (last.kind === "person") {
		return <Avatar login={last.login} url={last.avatarUrl} size={16} />;
	}
	return last.by === "ai" ? (
		<SparkleFillIcon
			size={16}
			aria-hidden
			data-speaker="ai"
			className="shrink-0 text-agent-ink"
		/>
	) : (
		<PersonIcon
			size={16}
			aria-hidden
			data-speaker="human"
			className="shrink-0 text-muted"
		/>
	);
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirName = (path: string) =>
	path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** The row's cues, as words for its name and tooltip. */
function cuesOf(row: PanelRow): { key: string; text: string }[] {
	const cues: { key: string; text: string }[] = [];
	if (row.yourTurn) cues.push({ key: "your-turn", text: "your turn" });
	if (row.waiting && !row.resolved)
		cues.push({ key: "waiting", text: "waiting for the agent" });
	if (row.unread) cues.push({ key: "unread", text: "new agent message" });
	if (row.outdated) cues.push({ key: "outdated", text: "outdated" });
	if (row.resolved) cues.push({ key: "resolved", text: "resolved" });
	return cues;
}

/**
 * One conversation: who spoke last, where it is (the file name prominent,
 * its folder muted and cut from the left), small cues, and when it last
 * moved. The row goes to the thread in Files changed; the date beside it
 * has its own exact-time tooltip.
 */
function Row(props: { row: PanelRow; onJump: (row: PanelRow) => void }) {
	const { row } = props;
	const where = `${row.path}${row.line === null ? "" : `:${row.line}`}`;
	const cues = cuesOf(row);
	const by = speakerText(row.last);
	const label = [where, `last by ${by}`, ...cues.map((c) => c.text)].join(", ");
	const dir = dirName(row.path);
	return (
		<li
			data-testid="threads-row"
			data-key={row.key}
			data-resolved={row.resolved || undefined}
			className={`flex min-w-0 items-center gap-1 rounded-md pr-1 hover:bg-overlay ${
				row.resolved ? "opacity-60 hover:opacity-100" : ""
			}`}
		>
			<Tooltip
				content={
					<>
						<span className="block font-mono text-[0.8125rem] font-semibold text-ink [overflow-wrap:anywhere]">
							<TooltipPath>{where}</TooltipPath>
						</span>
						<span className="block text-muted">Last by {by}</span>
						{cues.length > 0 && (
							<span className="block text-muted">
								{cues.map((c) => c.text).join(", ")}
							</span>
						)}
					</>
				}
				lazy
				describe={false}
			>
				{(trigger) => (
					<button
						type="button"
						{...trigger}
						aria-label={label}
						onClick={() => props.onJump(row)}
						className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-0.5 pl-1 text-left text-sm text-ink-soft focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-10"
					>
						<Speaker last={row.last} />
						<span
							data-testid="threads-row-name"
							className="shrink-0 truncate font-mono text-[0.8125rem] text-ink max-w-[70%]"
						>
							{fileName(row.path)}
							{row.line !== null && (
								<span className="text-muted">:{row.line}</span>
							)}
						</span>
						{/* The folder, cut from the left: its end is what tells files apart. */}
						<span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-faint [direction:rtl]">
							<bdi>{dir}</bdi>
						</span>
						{row.yourTurn && (
							<span
								aria-hidden
								data-cue="your-turn"
								className="h-2 w-2 shrink-0 rounded-full bg-warn"
							/>
						)}
						{row.waiting && !row.resolved && (
							<span
								aria-hidden
								data-cue="waiting"
								className="h-2 w-2 shrink-0 rounded-full bg-warn"
							/>
						)}
						{row.unread && (
							<span
								aria-hidden
								data-cue="unread"
								className="h-2 w-2 shrink-0 rounded-full bg-accent"
							/>
						)}
						{row.outdated && (
							<HistoryIcon
								size={12}
								aria-hidden
								data-cue="outdated"
								className="shrink-0 text-muted"
							/>
						)}
						{row.resolved && (
							<CheckCircleIcon
								size={12}
								aria-hidden
								data-cue="resolved"
								className="shrink-0 text-ok"
							/>
						)}
					</button>
				)}
			</Tooltip>
			<RelativeTime
				iso={row.at}
				className="shrink-0 text-xs text-muted tabular-nums"
			/>
		</li>
	);
}

/**
 * A region: its header (icon, label, count, chevron) folds it. While its
 * conversations load the count is a spinner, never 0 or an empty list
 * (principle 8); a failure says so in the count's place.
 */
function Region(props: {
	label: string;
	icon: Icon;
	testId: string;
	/** All its conversations, resolved too; null while loading. */
	rows: PanelRow[] | null;
	error: boolean;
	folded: boolean;
	onFold: (folded: boolean) => void;
	showResolved: boolean;
	onJump: (row: PanelRow) => void;
}) {
	const body = useId();
	const { icon: RegionIcon } = props;
	const listed =
		props.rows === null ? null : listedRows(props.rows, props.showResolved);
	const loading = listed === null && !props.error;
	const Chevron = props.folded ? ChevronRightIcon : ChevronDownIcon;
	return (
		<section
			aria-label={props.label}
			aria-busy={loading || undefined}
			data-testid={props.testId}
		>
			<h3 className="m-0">
				<button
					type="button"
					aria-expanded={!props.folded}
					aria-controls={body}
					onClick={() => props.onFold(!props.folded)}
					className="flex w-full items-center gap-1.5 rounded-md bg-band px-1 py-0.5 text-left text-xs font-semibold text-muted hover:bg-overlay focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-10"
				>
					<Chevron size={16} aria-hidden className="shrink-0 text-faint" />
					<RegionIcon size={14} aria-hidden className="shrink-0" />
					<span className="flex-1">{props.label}</span>
					{listed !== null ? (
						<span data-testid="threads-count" className="tabular-nums">
							{listed.length}
						</span>
					) : props.error ? (
						<span
							role="img"
							aria-label="Couldn't load"
							className="flex items-center text-bad"
						>
							<AlertIcon size={12} aria-hidden />
						</span>
					) : (
						<Spinner label={`Loading ${props.label}`} size={12} />
					)}
				</button>
			</h3>
			<div id={body} hidden={props.folded}>
				{listed !== null && listed.length > 0 && (
					<ul className="mt-0.5 mb-1">
						{listed.map((row) => (
							<Row key={row.key} row={row} onJump={props.onJump} />
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

/**
 * The tree's Threads tab: every conversation on the PR, in two regions,
 * People (GitHub's review threads) and AI (the reviewer's agent threads),
 * newest activity first. Resolved ones are listed only with the toolbar's
 * Show resolved; nothing else is ever left out, and this panel changes
 * nothing about what is reviewed.
 */
export function ThreadsPanel(props: {
	/** GitHub's threads as rows; null while they load. */
	people: PanelRow[] | null;
	peopleError: boolean;
	/** The agent conversations as rows; null while they load. */
	ai: PanelRow[] | null;
	aiError: boolean;
	state: SidebarState;
	onState: (change: Partial<SidebarState>) => void;
	onJump: (row: PanelRow) => void;
}) {
	const { state } = props;
	return (
		<div data-testid="threads-panel" className="space-y-1">
			<Region
				label="People"
				icon={PersonIcon}
				testId="threads-people"
				rows={props.people}
				error={props.peopleError}
				folded={state.peopleFolded}
				onFold={(peopleFolded) => props.onState({ peopleFolded })}
				showResolved={state.showResolved}
				onJump={props.onJump}
			/>
			<Region
				label="AI"
				icon={SparkleFillIcon}
				testId="threads-ai"
				rows={props.ai}
				error={props.aiError}
				folded={state.aiFolded}
				onFold={(aiFolded) => props.onState({ aiFolded })}
				showResolved={state.showResolved}
				onJump={props.onJump}
			/>
		</div>
	);
}

/**
 * How many conversations are open (unresolved) across both regions; null
 * while either still loads (a failed one counts none).
 */
export function openCount(
	people: PanelRow[] | null,
	ai: PanelRow[] | null,
	failed: { people: boolean; ai: boolean },
): number | null {
	if ((people === null && !failed.people) || (ai === null && !failed.ai))
		return null;
	return [...(people ?? []), ...(ai ?? [])].filter((r) => !r.resolved).length;
}

/** The Threads tab's toggle: resolved conversations listed too (muted), or not. */
export function ShowResolvedToggle(props: {
	on: boolean;
	onChange: (on: boolean) => void;
}) {
	return (
		<Tooltip content="Show resolved" describe={false}>
			{(trigger) => (
				<button
					type="button"
					{...trigger}
					aria-label="Show resolved"
					aria-pressed={props.on}
					data-testid="show-resolved"
					onClick={() => props.onChange(!props.on)}
					className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-overlay focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none pointer-coarse:h-10 pointer-coarse:w-10 ${
						props.on ? "bg-ok/15 text-ok" : "text-muted hover:text-ink"
					}`}
				>
					<CheckCircleIcon size={16} aria-hidden />
				</button>
			)}
		</Tooltip>
	);
}
