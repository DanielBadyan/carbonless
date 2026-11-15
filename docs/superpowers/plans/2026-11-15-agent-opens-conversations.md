# The Agent Opens Conversations: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a new MCP tool, `open`, lets the agent open a conversation on code or on a GitHub thread while it answers a request. Each conversation it opens points back to that request.

**Architecture:**
- An agent message records its request as `origin: {thread, message}`. The value is stored on the event that carries the message: `agent-thread-opened` for a new conversation, `agent-message` for a continued one.
- `AgentHost.sessionOpen` checks and writes the conversation. The MCP `open` tool calls it.
- The web shows a Re row above any agent message with an origin, a "Started N" button under any request message, and links that open a conversation (from citations, Go to your request, and the list).

**Tech Stack:** TypeScript, Fastify, `@modelcontextprotocol/sdk`, React, TanStack Query and Router, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-agent-opens-conversations-design.md` (owner decisions 1–7, my calls 1–13). Read it first. It is binding.

## Global Constraints

- **Principle 2.** `open` writes only agent-thread events in the private ref. It writes no progress, never resolves, and never writes to GitHub.
- **Principle 8.**
  - An origin message never answers a question: the waiting rule skips ai messages that carry an `origin`.
  - The request stays waiting until `reply`.
- **The anchor's commit** is the head the held question showed (`#seen.head` at hand-out) for `RIGHT`, and that head's merge base for `LEFT` (call 11).
- **Limits:**
  - at most 25 conversations per request (call 7);
  - the agent's `text` is capped with `capText`, as `reply` is;
  - `key` (for idempotency) has at most 100 characters.
- **Refused, each with a reason:**
  - no held question, or the held question is past its limit or in the grace period;
  - a path that isn't in the PR's files;
  - a line or column out of range;
  - a resolved, deleted or unknown GitHub thread, or GitHub not readable;
  - the request's own thread;
  - the 26th conversation from one request.
- **Citation token:** `crb:c/<thread ulid>`, written bare in the agent's reply text. The web turns it into a link only when that id is one of this review's agent threads (call 8). A thread the agent continued shows under its existing id.
- **Copy:**
  - "RE";
  - "Show more" / "Show less";
  - "Go to your request";
  - "Conversations from this request";
  - "Started N";
  - "opened this".
- **UI rules:** colours come from the tokens only; 40px targets on touch; no horizontal page scroll at 360px; the e2e tests run in the phone project too (this is a layout change).
- **Process:** follow CLAUDE.md's process rules: tests use the fake gh and the fake ACP agent, with holds rather than timing; `pnpm flake-check` on any test with a gate or timer; commit with `git commit --only`.

## Review Focus

1. **An origin message on a thread that already has a waiting question.** The question must stay waiting, and `next` must still hand it out. Owned by Task 1 (fold) and Task 2 (host).
2. **The PR's head moves between `next` and `open`.** The anchor pins to the head the agent was shown, and placement carries it forward or shows it unplaced, never at the same numbers on the new head. Owned by Task 2.
3. **A retried `open` with the same `key`.** It returns the same conversation and writes nothing more. Owned by Task 2.
4. **A request message's text contains markup.** The Re box shows the text literally. Owned by Task 5.
5. **A citation token naming another review's thread, or a made-up id.** It stays plain text. Owned by Task 5.

---

### Task 1: Storage: origin on ai messages, and the waiting rule

**Files:**
- Modify:
  - `src/server/review/events.ts`: the types, `parseAgentEvent`, and `validateForWrite`;
  - `src/shared/agent.ts`: `AgentMessage`, `AgentThread`;
  - `src/server/agent/store.ts`: `OpenInput`, `MessageInput`, `messageOf`, `isWaiting`, and the fold.
- Test: `src/server/agent/store.test.ts`, `src/server/review/events.test.ts`.

**Interfaces:**
- Produces:
  - `type AgentOrigin = { thread: string; message: string }` in `src/shared/agent.ts`.
  - `AgentMessage.origin?: AgentOrigin`.
  - `AgentThread.origin` is removed.
  - `AgentThreadOpenedEvent.origin?: AgentOrigin` and `AgentMessageEvent.origin?: AgentOrigin`, both ai only, with both values lowercase ULIDs.
  - `OpenInput` for ai: `{anchor, text, by:"ai", agent, origin: AgentOrigin, key?: string}`. The key is stored as `details.clientId`, so ai openings dedupe the way human ones do. A repeated key returns the existing thread.
  - `MessageInput` for ai gains `origin?: AgentOrigin`. When `origin` is set, `stop` is `"end_turn"`, `activity` is `[]`, and there is no `replyTo`.
  - `export function startedBy(threads: readonly AgentThread[]): Map<string, string[]>` in `src/shared/agent.ts` (Task 5 uses it too): maps a request message id to the thread ids it started, in the order they were opened. One thread counts once per request.

- [ ] **Step 1: Write the failing tests** (`store.test.ts`):
  - `"an origin message doesn't answer a waiting question"`: human Q, then an ai message with origin → `waiting === true`.
  - `"an ai-opened thread waits only after the reviewer replies"`: opened by ai with origin → `waiting === false`; after a human message → `true`.
  - `"an origin naming a missing thread or a non-human message is dropped on read"`: the fold's message has no `origin`.
  - `"startedBy groups by request message, once per thread"`.
  - `"an ai opening with a repeated key returns the same thread"`: `read()` has 1 thread, with 1 message.

  In `events.test.ts`, the parser drops (returns `null` for) an `origin` on a human event, an origin with a non-ULID id, and the old `{request}` shape.
- [ ] **Step 2: Run them and see them fail:** `pnpm test src/server/agent/store.test.ts src/server/review/events.test.ts`
- [ ] **Step 3: Implement.** Check origins in the fold, after every event is placed: the origin's `thread` must fold to a thread, and its `message` must be a human message in that thread. Otherwise drop the origin. `isWaiting` ignores ai messages that have `origin`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Update `docs/review-data-storage.md`**: the field, the waiting rule, and the removal of `origin.request`. Commit.

### Task 2: Host: `sessionOpen`

**Files:**
- Modify:
  - `src/server/agent/host.ts`;
  - `src/server/agent/join.ts`: if the hand-out needs to expose its head or its count of opened conversations;
  - `src/server/agent/runner.ts`: only to expose whether the held question is past its limit.
- Test: `src/server/agent/host.test.ts`.

**Interfaces:**
- Consumes: Task 1's `OpenInput`/`MessageInput` with `origin`, and `startedBy`.
- Produces:
  ```ts
  type OpenTarget =
    | { code: { path: string; side?: "LEFT" | "RIGHT"; line?: number; startLine?: number; startCol?: number; endCol?: number } }
    | { thread: string };
  sessionOpen(secret: string, r: OpenTarget & { text: string; key?: string }):
    Promise<{ thread: string; created: boolean; cite: string }>
  ```
  - `cite` is `` `crb:c/${thread}` ``.
  - `code` without `line` is a whole-file anchor, and `side` is ignored.
  - With `line`, `side` defaults to `"RIGHT"`.
  - `startLine` defaults to `line`. Columns are allowed only on a single line.
- New errors are classes, mapped in `server.ts` to `ToolError` codes:
  - `NotHoldingError` → `not_answering`;
  - `BadAnchorError` → `bad_anchor`;
  - `ThreadUnavailableError` → `thread_unavailable`;
  - `OwnThreadError` → `own_thread`;
  - `TooManyOpenedError` → `too_many`.
  Each message says what to do instead.

- [ ] **Step 1: Write the failing tests** (`host.test.ts`, with the fake gh and a joined session that holds a question):
  - opens on one line, a range, a text range on one line, and a whole file;
  - on a thread with no conversation, and on a thread with one (`created === false`, the message goes at the end with its origin, and a question waiting there still waits);
  - each refusal from the Global Constraints, one test each;
  - `"the anchor pins to the head the question showed"`: hand out the question, move the fake PR's head, `open` → `anchor.commit` is the old head;
  - the identity is `via: "mcp"` for a joined session and `"acp"` for a spawned one;
  - a repeated key returns the same thread;
  - `reply` afterwards still answers the request.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - The held question is `join.handedOut()`.
  - The request is `{thread: handed.thread, message: handed.asked}`.
  - The thread anchor comes from the existing `#threadAnchor`.
  - Check lines against the file at that commit, through the facts used by `sessionSpanTurn`.
  - "In the PR" means `prFacts().files`.
- [ ] **Step 4: Run them and see them pass.** Run `pnpm flake-check src/server/agent/host.test.ts -g open`.
- [ ] **Step 5: Commit.**

### Task 3: MCP: the `open` tool, threads in `review`, and the prompts

**Files:**
- Modify:
  - `src/server/mcp/server.ts`;
  - `src/shared/agent.ts`: `JOINED_PREAMBLE`, and the attach instructions in `server.ts`;
  - `src/server/agent/prompt.ts`: messages in the envelope gain `re`;
  - `src/server/agent/host.ts`: `sessionReview` returns threads, and `sessionNext` maps `re`.
- Test: `src/server/mcp/routes.test.ts` (or the existing MCP tool tests), `src/server/agent/prompt.test.ts`.

**Interfaces:**
- Produces:
  - **Tool `open`:**
    - inputs: `token`, `text` (`z.string().max(1_000_000)`), `key?` (max 100), and exactly one of `code` or `thread` (`z.string().max(100)`);
    - result: `{ok: true, thread, created, cite}`.
  - **`review` gains `threads`:** `[{id, path, line, side, resolved, outdated, comments: [{author, body}]}]`.
    - Bodies are sanitized with `sanitizeThirdParty` and capped at 2 KiB each.
    - At most 200 threads; past that, `threadsTruncated: true`.
  - **`next` envelope messages:** an ai message that has an origin gains `re: <the request's text>`.
- The `open` description, and one line added to both attach instructions:
  > "When an answer points at several places, or at one that deserves its own conversation, call open there (while answering), starting the text with why; then cite each conversation in your reply by the cite it returns."

- [ ] **Step 1: Write the failing tests:**
  - the tool's schema refuses both or neither of `code` and `thread`;
  - the result carries `cite`;
  - `review` lists the fake gh's threads, with a hostile body sanitized;
  - `next` shows `re`;
  - the instructions mention `open`.
- [ ] **Step 2: Run them and see them fail. Step 3: Implement. Step 4: Run them and see them pass. Step 5: Commit.**

### Task 4: The fake ACP agent learns `open`

**Files:**
- Modify: `test/fake-acp/agent.mjs`, `test/fake-acp/scenario.ts`.
- Test: `src/server/agent/fake-acp.test.ts`.

**Interfaces:**
- Produces: a scenario step `{open: {code?: {...}, thread?: string, text: string, key?: string}}`, run between `next` and `reply`. The step records the returned `cite` so a later reply's text can use `{{cite:0}}`, `{{cite:1}}`, and so on.

- [ ] Steps: test → fail → implement → pass → commit.

### Task 5: Web: the Re row, Started N, citations, and conversation links

**Files:**
- Create:
  - `src/web/agent/ReRow.tsx`;
  - `src/web/agent/StartedList.tsx`;
  - `src/web/agent/conversationLinks.ts`.
- Modify:
  - `src/web/agent/AgentThreadCard.tsx`: `AgentMessageItems` renders a `ReRow` above an ai message that has an origin, and `Started N` under a human message that started threads;
  - `src/web/agent/AgentMarkdown.tsx`: turns citation tokens into links;
  - `src/web/files/landing.ts` and the overview's `threadLink.ts`: add a conversation param;
  - `ThreadAgentPanel` and the files card: open on landing.
- Test: co-located `*.test.tsx`.

**Interfaces:**
- Consumes: `AgentMessage.origin`, and a client-side `startedBy` (the same rule as Task 1's, over `AgentThread[]`; put it in `src/shared/agent.ts` and have Task 1 import it).
- Produces:
  - **Search params:** `conversation=<thread ulid>`, and `message=<message ulid>` to land on one message.
    - **Files changed:** a code conversation's link lands at its anchor's comparison (`codeLinkSearch` rules: the patch set holding the head, else the head). It opens the card and scrolls to it.
    - **Overview:** a GitHub-thread conversation's link is `?thread=<gh id>&conversation=<id>`. It opens that thread's panel.
    - **Landing on a message** outlines it with `accent` and the existing landing fade.
  - `conversationSearch(thread: AgentThread, message?: string)`: returns `{to, search} | null`, where `null` means the thread can't be placed. In that case show the link disabled, with the tooltip "Not in this review's files".
- Copy and behaviour follow the spec's "What the reviewer sees" and the mockups:
  - **Re box:** quotes the request's first line, with an ellipsis via CSS. "Show more" has `aria-expanded`.
  - **The list:** opens under the row and marks the current conversation.
  - **Started N:** shows the count and an `accent` badge of unread ones.

- [ ] **Step 1: Write the failing tests:**
  - a ReRow with request text `<b>x</b>` shows it literally;
  - Show more toggles `aria-expanded`;
  - Go to your request builds the request's link;
  - the list has one row per started thread, in order, with unread dots;
  - Started N counts, and its unread badge counts;
  - a citation token for a known id becomes a link labelled `path:start–end` or "Thread · <author>", while an unknown id, or one from another review, stays text;
  - landing on `conversation=` opens the card or the panel.
- [ ] **Step 2: Run them and see them fail. Step 3: Implement. Step 4: Run them and see them pass. Step 5: Commit.**

### Task 6: E2E and docs

**Files:**
- Create: `e2e/agent-open.spec.ts`.
- Modify:
  - `docs/product-rules.md`;
  - `docs/faq.md`;
  - `docs/superpowers/specs/2026-11-04-review-buddy-design.md` (its "nothing produces one yet" line).

**Tests** (desktop and phone; a spawned fake agent, plus one joined-session case):
- The agent answers a request by opening on lines (as a range) and on a GitHub thread, then replies citing both. The test clicks each citation, sees the Re box, uses Show more, uses Go to your request (landing on the message), and opens the list.
- On a thread that already has a conversation, the message goes at the end with its own Re row.
- The reviewer replies in an agent-opened conversation, and the fake agent gets it through `next` with `re`.
- Phone at 360px: no horizontal page scroll; the Re row's controls are each at least 40px.

- [ ] Steps: write the spec → run it (`pnpm test:e2e e2e/agent-open.spec.ts`) → fix until it passes → `pnpm flake-check e2e/agent-open.spec.ts` → update the docs → commit.
