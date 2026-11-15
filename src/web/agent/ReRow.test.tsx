// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus, AgentThread } from "../../shared/agent";
import type { ReviewView, SessionInfo } from "../../shared/types";
import { reviewQuery, sessionQuery } from "../api";
import { parseFilesSearch } from "../files/landing";
import { parseOverviewSearch } from "../overview/threadLink";
import { parseSearch, stringifySearch } from "../search";
import { AgentMarkdown } from "./AgentMarkdown";
import { AgentThreadCard } from "./AgentThreadCard";
import { resetAgentWrites } from "./agentWrites";
import { agentThreadsQuery } from "./api";
import {
	conversationLabel,
	conversationSearch,
	requestConversationOpen,
	resetConversationLanding,
} from "./conversationLinks";
import { ReRow } from "./ReRow";
import { stubIntersection } from "./threadAgentFixtures";

const ULID = (c: string) => `01k9e6m2q8x4v7c3n5b0h1j2${c}`;
const REQ = ULID("aa");
const REQ_MSG = ULID("ab");
const A = ULID("ba");
const B = ULID("ca");
const C = ULID("da");
const H = "a".repeat(40);
const H3 = "3".repeat(40);

const at = "2026-11-15T10:00:00Z";
const origin = { thread: REQ, message: REQ_MSG };

/** The reviewer's request, on a.txt:1, and the three conversations it started. */
function threads(requestText = "Show me every lock <b>x</b>"): AgentThread[] {
	return [
		{
			id: REQ,
			anchor: {
				subject: "line",
				path: "a.txt",
				commit: H3,
				side: "RIGHT",
				line: 1,
				startSide: "RIGHT",
				startLine: 1,
			},
			openedBy: "human",
			at,
			messages: [{ id: REQ_MSG, by: "human", at, text: requestText }],
			resolved: false,
			waiting: true,
			unread: false,
		},
		{
			id: A,
			anchor: {
				subject: "line",
				path: "a.txt",
				commit: H,
				side: "RIGHT",
				line: 12,
				startSide: "RIGHT",
				startLine: 10,
			},
			openedBy: "ai",
			at,
			messages: [
				{
					id: ULID("bb"),
					by: "ai",
					at,
					text: "This is such a case.",
					origin,
				},
			],
			resolved: false,
			waiting: false,
			unread: true,
		},
		{
			id: B,
			anchor: {
				subject: "thread",
				thread: "PRRT_1",
				path: "a.txt",
				commit: H,
			},
			openedBy: "human",
			at,
			messages: [
				{ id: ULID("cb"), by: "human", at, text: "Fixed?" },
				{ id: ULID("cc"), by: "ai", at, text: "And here.", origin },
			],
			resolved: false,
			waiting: true,
			unread: false,
		},
		{
			id: C,
			anchor: { subject: "file", path: "gone.txt", commit: H },
			openedBy: "ai",
			at,
			messages: [{ id: ULID("db"), by: "ai", at, text: "Elsewhere.", origin }],
			resolved: false,
			waiting: false,
			unread: true,
		},
	];
}

const status: AgentStatus = {
	state: "ready",
	configured: true,
	spawned: true,
	since: at,
	waiting: 0,
};

/** `ui` in a router on /r/RV1 (Overview and Files changed routes), with the review's queries filled. */
function show(ui: ReactNode, list = threads()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, enabled: false } },
	});
	client.setQueryData(agentThreadsQuery.queryKey, { threads: list });
	client.setQueryData(reviewQuery().queryKey, {
		files: [{ path: "a.txt" }],
	} as unknown as ReviewView);
	client.setQueryData(sessionQuery.queryKey, {
		viewer: "dan",
		patchsets: [{ number: 3, head: H3 }],
	} as unknown as SessionInfo);
	const root = createRootRoute({
		component: () => (
			<>
				{ui}
				<Outlet />
			</>
		),
	});
	const files = createRoute({
		getParentRoute: () => root,
		path: "/r/$id/files",
		validateSearch: parseFilesSearch,
		component: () => <p data-testid="files-page" />,
	});
	const overview = createRoute({
		getParentRoute: () => root,
		path: "/r/$id",
		validateSearch: parseOverviewSearch,
		component: () => null,
	});
	const router = createRouter({
		routeTree: root.addChildren([files, overview]),
		history: createMemoryHistory({ initialEntries: ["/r/RV1"] }),
		parseSearch,
		stringifySearch,
	});
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
	return router;
}

beforeEach(() => {
	stubIntersection(false);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("{}", { status: 200 })),
	);
});
afterEach(() => {
	cleanup();
	resetConversationLanding();
	resetAgentWrites();
	vi.unstubAllGlobals();
});

describe("conversationSearch and labels", () => {
	const files = new Set(["a.txt"]);
	const ps = [{ number: 3, head: H3 }];
	it("code: Files changed at the range's first line, in its commit's patch set or head; a file: its path; a GitHub thread: the Overview's card", () => {
		const [req, a, b, c] = threads() as AgentThread[];
		expect(conversationSearch(req as AgentThread, files, ps, REQ_MSG)).toEqual({
			to: "/r/$id/files",
			search: {
				path: "a.txt",
				line: 1,
				side: "RIGHT",
				ps: 3,
				conversation: REQ,
				message: REQ_MSG,
			},
		});
		expect(conversationSearch(a as AgentThread, files, ps)).toEqual({
			to: "/r/$id/files",
			search: {
				path: "a.txt",
				line: 10,
				side: "RIGHT",
				head: H,
				conversation: A,
			},
		});
		expect(conversationSearch(b as AgentThread, files, ps)).toEqual({
			to: "/r/$id",
			search: { thread: "PRRT_1", conversation: B },
		});
		expect(conversationSearch(c as AgentThread, files, ps)).toBeNull();
		expect(
			conversationSearch(
				{
					...(c as AgentThread),
					anchor: { subject: "file", path: "a.txt", commit: H },
				},
				files,
				ps,
			),
		).toEqual({
			to: "/r/$id/files",
			search: { path: "a.txt", head: H, conversation: C },
		});
		expect(conversationLabel(a as AgentThread)).toBe("a.txt:10–12");
		expect(conversationLabel(req as AgentThread)).toBe("a.txt:1");
		expect(conversationLabel(b as AgentThread, () => "ann")).toBe(
			"Thread · ann",
		);
		expect(conversationLabel(c as AgentThread)).toBe("gone.txt");
	});

	it("the pages' search params keep a conversation and message only as ULIDs", () => {
		expect(
			parseFilesSearch({ path: "a.txt", conversation: A, message: REQ_MSG }),
		).toEqual({ path: "a.txt", conversation: A, message: REQ_MSG });
		expect(
			parseFilesSearch({ path: "a.txt", conversation: 'x"><b>', message: "y" }),
		).toEqual({ path: "a.txt" });
		expect(
			parseOverviewSearch({
				thread: "PRRT_1",
				conversation: B,
				message: "nope",
			}),
		).toEqual({ thread: "PRRT_1", conversation: B });
	});
});

describe("ReRow", () => {
	it("shows the request's text literally, never as markup", async () => {
		show(<ReRow origin={origin} current={A} threads={threads()} />);
		const box = await screen.findByTestId("agent-re-text");
		expect(box.textContent).toBe("“Show me every lock <b>x</b>”");
		expect(box.querySelector("b")).toBeNull();
	});

	it("Show more shows the whole request and toggles aria-expanded", async () => {
		const user = userEvent.setup();
		show(
			<ReRow
				origin={origin}
				current={A}
				threads={threads("First line\nsecond line")}
			/>,
		);
		const more = await screen.findByTestId("agent-re-more");
		expect(more.getAttribute("aria-expanded")).toBe("false");
		expect(screen.getByTestId("agent-re-text").textContent).toBe(
			"“First line second line”",
		);
		await user.click(more);
		expect(more.getAttribute("aria-expanded")).toBe("true");
		expect(more.getAttribute("aria-label")).toBe("Show less");
		expect(screen.getByTestId("agent-re-text").textContent).toBe(
			"“First line\nsecond line”",
		);
	});

	it("Go to your request opens the request's conversation at that message", async () => {
		const user = userEvent.setup();
		const router = show(
			<ReRow origin={origin} current={A} threads={threads()} />,
		);
		await user.click(await screen.findByTestId("agent-re-go"));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/r/RV1/files"),
		);
		expect(
			parseFilesSearch(router.state.location.search as Record<string, unknown>),
		).toMatchObject({
			path: "a.txt",
			line: 1,
			ps: 3,
			conversation: REQ,
			message: REQ_MSG,
		});
	});

	it("the list: one row per conversation the request started, in order, unread dots, this one marked, an unplaceable one disabled", async () => {
		const user = userEvent.setup();
		const router = show(
			<ReRow origin={origin} current={A} threads={threads()} />,
		);
		const list = await screen.findByTestId("agent-re-list");
		expect(list.textContent).toBe("3");
		await user.click(list);
		const rows = screen.getAllByTestId("agent-started-item");
		expect(rows.map((r) => r.dataset.thread)).toEqual([A, B, C]);
		expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([
			"true",
			null,
			null,
		]);
		expect(
			rows.map(
				(r) => r.querySelector('[data-testid="agent-unread-dot"]') !== null,
			),
		).toEqual([true, false, true]);
		expect(rows[1]?.textContent).toContain("And here.");
		expect((rows[2] as HTMLButtonElement).disabled).toBe(true);
		await user.click(rows[1] as HTMLElement);
		await waitFor(() =>
			expect(router.state.location.search).toMatchObject({
				thread: "PRRT_1",
				conversation: B,
			}),
		);
	});

	it("nothing when the request isn't among the threads", () => {
		show(
			<ReRow
				origin={{ thread: ULID("zz"), message: REQ_MSG }}
				current={A}
				threads={threads()}
			/>,
		);
		expect(screen.queryByTestId("agent-re")).toBeNull();
	});
});

describe("in a conversation", () => {
	it("an ai message from a request gets its Re row; the request's own message gets Started N with its unread count", async () => {
		const list = threads();
		show(
			<AgentThreadCard thread={list[1] as AgentThread} status={status} />,
			list,
		);
		expect(await screen.findByTestId("agent-re")).toBeTruthy();
		expect(screen.getByTestId("agent-opened-this").textContent).toContain(
			"opened this",
		);
		cleanup();
		show(
			<AgentThreadCard thread={list[0] as AgentThread} status={status} />,
			list,
		);
		const started = await screen.findByTestId("agent-started");
		expect(started.textContent).toContain("Started 3");
		expect(screen.getByTestId("agent-started-unread").textContent).toBe("2");
		expect(started.getAttribute("aria-label")).toBe("Started 3, 2 unread");
		expect(screen.queryByTestId("agent-re")).toBeNull();
	});

	it("landing on a conversation opens its closed card and outlines the message named", async () => {
		const list = threads();
		const resolved = { ...(list[0] as AgentThread), resolved: true };
		show(<AgentThreadCard thread={resolved} status={status} />, [
			resolved,
			...list.slice(1),
		]);
		const card = await screen.findByTestId("agent-thread");
		expect(card.dataset.closed).toBe("true");
		act(() => requestConversationOpen(REQ, REQ_MSG));
		await waitFor(() =>
			expect(screen.getByTestId("agent-thread").dataset.closed).toBeUndefined(),
		);
		const landed = document.querySelector(`[data-message-id="${REQ_MSG}"]`);
		await waitFor(() =>
			expect(landed?.getAttribute("data-landed")).toBe("true"),
		);
	});
});

describe("citations in an agent's answer", () => {
	it("a citation of this review's conversation becomes a link labelled where it is; an unknown or made-up one stays text", async () => {
		const user = userEvent.setup();
		const other = ULID("ee");
		const router = show(
			<AgentMarkdown
				text={`See crb:c/${A}, \`crb:c/${B}\`, crb:c/${other} and crb:c/not-a-ulid.`}
			/>,
		);
		const links = await screen.findAllByTestId("agent-conversation-link");
		expect(links.map((l) => l.textContent)).toEqual([
			"a.txt:10–12",
			"Thread · a.txt",
		]);
		expect(links[0]?.getAttribute("href")).toContain("/r/RV1/files?");
		expect(document.body.textContent).toContain(`crb:c/${other}`);
		expect(document.body.textContent).toContain("crb:c/not-a-ulid");
		await user.click(links[0] as HTMLElement);
		await waitFor(() =>
			expect(router.state.location.search).toMatchObject({
				path: "a.txt",
				conversation: A,
			}),
		);
	});
});
