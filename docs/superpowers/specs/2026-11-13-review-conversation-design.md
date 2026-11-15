# Review conversation: one agent conversation about the whole review

Status: draft, 2026-11-13, builder-checked; owner answers folded in. Calls the coordinator made (the owner may
overrule) are marked **(call)**.

Mockups (desktop and phone, drawn over screenshots of the live UI): the
"Review conversation mockups" canvas linked from the report.

## Why

The review buddy (#30) answers questions anchored on a span, and the thread
agent (#76) answers questions about one GitHub thread. Some questions span
the whole review and have no line to hang on. The owner:

> "I'd like us to implement a general question/conversation that can be
> triggered from the main AI modal assuming it is setup. it should look
> like the other threads, except it's in a more general context, for
> requests that span the entire review"

The owner's examples:

> "go over all review comments and tell me if they were truly resolved or not"
>
> "go over this pr and highlight me all decisions made in code i might not
> agree with"

Scope, owner:

> "another session is now working on expanding the mcp to allow the agent
> to respond in threads and etc. so the scope here is just allowing for the
> global conversation"

So the agent answers **in this conversation only**. Writing into GitHub
thread conversations or opening span threads (CAR-92, CAR-80) is the other
session's work; nothing here may block it.

## Owner decisions

- **One ongoing conversation per review** ("a single ongoing conversation
  sounds right to me at this stage"). No "start fresh", no clearing: "I'm
  not worried about the conversation size exploding, review sessions are
  rarely so long lived".
- **It lives in a drawer** (mockup option 2A, chosen over a pinned card on
  Overview): it slides in from the right on any tab, so the reviewer reads
  an answer next to the code it points at.
- **The header agent chip opens it**, and stays the connection status
  indicator: "it should replace the existing header chip as the status
  indicator for connection. and then have a button to show the status
  modal". The chip opens the drawer; a button in the drawer opens the Your
  agent modal (status, activity, detach).
- It is only for a set-up agent ("assuming it is setup").

## Goals

- **Ask about the whole review.** A single conversation per review,
  answered by the reviewer's agent (the ACP buddy, or a session joined
  over MCP, whichever is attached), with the review as its context.
- **Looks like the other agent conversations.** Same messages (the
  reviewer's in their person wash, the agent's in `agent` wash and
  `agent-edge` border), streaming text, activity line with Stop, the "new"
  rule above unread answers, Markdown through the same sanitiser, code
  links (`path:line`) that jump to the code, the "Ask agent…" composer.
- **The chip is the one entry point** and shows status, message count and
  unread at a glance.
- **Never in the way.** The drawer opens only on the reviewer's tap.

## Non-goals

- The agent writing into GitHub thread conversations, opening span
  threads, or suggesting resolutions from this conversation (other
  session; CAR-92, CAR-80).
- Several conversations, renaming, clearing, archiving.
- Pushing or sharing the conversation: private to the reviewer like every
  agent thread, never pushed (as the review buddy spec).

## Anti-goals (would be a failure even if it works)

- The drawer or the chip ever opening, popping or stealing focus on its own.
- Anything in this conversation marking a line reviewed, resolving a
  thread, hiding or collapsing a change (principle 2). The conversation
  writes only its own messages.
- The chip losing its status meaning: a failing agent must still read as
  failing from across the room.

## UI

### The header chip

Today's chip (`src/web/agent/AgentChip.tsx`) is a fixed 28px icon-only
circle (`CHIP_BOX`) between the logo and the PR title, name in the tooltip
only, with the plug badge on its corner for a joined session.

**It moves to the right of the PR title**, after the `#number`, so it is
more noticeable (owner, 2026-11-15: "Let's move the chip to be on the right
of the PR instead of on the left, so it's more noticable"). The logo is
followed directly by the title. When the title wraps (narrow desktop,
phone) the chip follows the `#number` on its last line, inline. In the
compact header shown once the page scrolls (logo, tabs, title pill), it
sits right after the title pill **(call)**. It keeps its sparkle, the plug badge, its status
colour (`agentDot`/`agentInk`: grey off/elsewhere, yellow starting/busy,
green ready, red failing) and its tooltip (`agentTip`). It gains:

- the review conversation's **message count** (`agent-ink`), styled like
  the agent count pill on file rows, once it has
  any messages. The chip grows from a circle into a pill to fit it (the
  header's reserved place, `useAgentChipPlace` and the
  `agent-chip-pending` placeholder, move with the chip to after the title
  and grow with it, so nothing jumps); the
  tap target is at least 40px in both shapes. No name text is added: the
  name stays in the tooltip **(call)**;
- an **unread dot** (`accent`) while the conversation has an agent message
  the reviewer has not seen;
- a **pressed** look (the `agent` wash inside `agent-edge`) while the drawer
  is open, and `aria-expanded` / `aria-controls` on the drawer.

Tap:

| Agent | Tap |
|---|---|
| an ACP agent is configured, or a session is joined, or this review already has a review conversation | toggles the drawer |
| none of these | opens agent setup |

**(call)** "Set up" means any of the three, so an MCP-only reviewer whose
session has left can still read their conversation (and a question asked
then waits for the next agent, as every agent thread does). Today a joined
session's chip opens a popover with Disconnect (`chipPopover`); the drawer
replaces it, and Disconnect stays one tap away as the modal's Detach, via
the drawer's status button.

The accessible name says both jobs, e.g. "Review conversation · Claude
Code ready · 1 unread" **(call: wording)**. Same chip on phone.

### The drawer

- **Desktop**: a panel docked on the right edge, the viewport's full
  height, ~480px wide; the whole page, header included, narrows beside it
  (mockup 2) (builder may tune: min 360, max
  ~40% of the viewport). It **pushes** the page content narrower rather
  than covering it (the owner's "bars push, not cover" rule applied to a
  side panel), so the diff stays fully readable and clickable beside it.
  Its left border is `agent-edge`. Below a breakpoint where pushing would
  leave the content too narrow (builder's choice, around 900px), it
  overlays instead **(call)**.
- **Phone**: a full-screen layer over the page (below nothing; its own
  header), like the agent setup's phone sheet but full height. No
  horizontal scroll at 360px.
- **Header** (`band`): sparkle, the title "Whole review" **(call: title)**,
  the message count, then a **status button** (pulse icon, tooltip and
  accessible name "Agent status") that opens the existing Your agent modal
  (`openAgentSetup()` / `AgentSetupHost`), then Close (×). Both ≥40px.
- **Body**: the messages, oldest first, opening scrolled to the end (to the
  "new" rule if there are unread answers, as the thread panel does). The
  agent's current activity line and the Stop button while it answers
  (reusing what `ThreadAgentPanel` / `AgentThreadCard` render, so the two
  look the same and stay in step).
- **Composer**: "Ask agent…", Enter / send button sends (same composer
  component and draft rules as the thread conversations).
- **Empty state**: just the composer, focused, with its placeholder. No
  explanatory text (principle 6). Only once the agent threads have been
  read: while they load the body shows the shared `Spinner` (`aria-busy`)
  and the chip shows no count rather than 0; a failed read shows an error
  with retry, as the thread panel's failed read does (principle 8).
- **Seen**: the thread panel's rule (`useSeenWriter`, `threadAgent.ts`):
  the conversation is marked seen up to the last message once that answer
  has been visible for `SEEN_AFTER_MS`, not merely on open.
- **Close**: ×, Escape, or the chip again. The drawer's open state survives
  tab switches inside the review (Overview ↔ Files changed) **(call)**, and
  is not kept across reloads **(call)**.
- **Links** in answers: the existing code links (`codeLinks.ts`) jump to
  the code in Files changed and keep the drawer open; on phone, following a
  link closes the full-screen layer so the code is visible **(call)**.
- **Keyboard**: a shortcut toggles the drawer (builder picks a free key in
  `src/web/shortcuts.tsx` and lists it in the shortcuts help) **(call)**.
- **Agent setup modal**: unchanged. It does **not** get a composer
  **(call: the chip replaces the modal as the trigger, so the owner's
  "triggered from the main AI modal" becomes "from the chip"; the modal is
  one tap away in the drawer header)**.

### What doesn't change

- The review conversation never appears among the thread cards, the
  Overview agent rows, the Files tree dots, placements or "unplaced" lists:
  it has no place in the diff. Those lists filter it out by subject.
- The thread agent button on GitHub thread cards, and span agent threads,
  are untouched.

## Data

### Storage

The conversation is one more agent thread in the reviewer's private ref
(`refs/crb/reviews/<review-id>/reviewers/<reviewer>/agent/threads`,
`docs/review-data-storage.md`, "Agent threads ref"), with a new anchor
subject:

```ts
| { subject: "review" }
```

- `agent-thread-opened` with `anchor: {subject: "review"}`, opened by the
  human with their first message; same events after it (`agent-message`,
  `agent-thread-seen`). **(call)** No new event kinds, no new ref: a few
  KB per review, like any agent thread; principle 3 unaffected. Measure
  and note the size in the storage doc as usual.
- **At most one per review.** The server enforces it: opening a second
  `review` thread when one exists is refused on write (409, the client
  then uses the existing one), and on read only the first (lowest ULID) is
  kept, the rest dropped, so a race or a hand-edited ref can never show two.
- **Never resolved.** A resolve on a `review` thread is refused in
  `host.setResolved` (the store's `setResolved` always writes `by:
  "human"`, so the refusal belongs in the host) and ignored in the fold on
  read; the UI has no resolve control. Every "waiting" rule must treat a
  `review` thread as always open: the runner's pick (`t.waiting &&
  (thread subject || !resolved)`), its status count (`t.waiting &&
  !t.resolved`), and the joined path's two copies in `host.ts`. Prefer one
  shared predicate over four edits.
- **Human-opened only (call).** An `agent-thread-opened` by ai with
  `subject: "review"` is rejected: the agent answers in the conversation,
  it doesn't create it. (If the MCP work later wants the agent to start
  it, that's a one-line relaxation.)
- Update `docs/review-data-storage.md`'s event table and write rules in
  the same change.

### API

Reuse the agent thread routes (`src/web/agent/api.ts`, the server's
`/agent/threads`): post messages, mark seen, cancel. Opening needs a new
request shape: `OpenAgentThreadRequest` takes exactly one of `span` or
`thread` today, `app.ts` rebuilds a span as `line`/`file` only and
`host.open` throws without either. Add a third alternative (e.g. `review:
true`) through all three. The web finds the conversation in
`agentThreadsQuery` by `anchor.subject === "review"`.

**Filtered out server-side too**: `host.asked()` feeds placements every
non-`thread` subject; it must skip `review` (it has no path).

### The agent's prompt

A new envelope kind `review_conversation` in `src/server/agent/prompt.ts`
(beside `agent_thread` and `github_thread_conversation`), built by the
runner for a `review` thread. It carries:

- the review facts every envelope carries (repo, PR number, base/head
  refs and commits, merge base, the agent checkout's absolute path), and
  the PR's title, body and changed file paths **on every turn of this
  kind** (today `pr` goes only on an ACP process's first prompt and through
  `sessionReview(withPr)` for joined sessions; a review-wide question
  needs it each time) **(call)**. File status and +/− counts are not
  added **(call)**;
- the code it answers against: see "Which code it answers against" below;
- **every GitHub review thread on the PR, compactly**: node id, url, path,
  line span, opened-on commit, resolved/outdated state, author, and each
  comment's author, date and body, all through `sanitizeThirdParty` /
  `sanitizeEnvelope` like other third-party text, capped (builder sets the
  cap; a truncation is stated in the envelope's `notice`, never silent)
  **(call)**. **Read fresh on every turn** (resolved state and every
  thread's comments, batched in one GitHub read like the thread
  conversation's single-thread read in `session.ts`), not the session's
  last read: "truly resolved" is wrong if `resolved` is stale **(call)**.
  The reviewer's pending (unsubmitted) comments and their other agent
  conversations are not included **(call)**. The owner's first example ("were the comments truly
  resolved") needs these; the ACP agent's checkout has no `refs/crb` and
  no crb MCP tools, so the prompt is the only reliable source. When GitHub
  couldn't be read, `notice` says so and the list is absent (never an
  empty list that reads as "no comments");
- a preamble for this kind: the question concerns the whole review; answer
  in this conversation; cite code as `path:line` so links work; the usual
  expectations (no pushing, no GitHub writes, no review changes) as for
  every conversation.

A joined MCP session (CAR-81) answers it like any other waiting
conversation, through the same envelope, in this change **(call)**. The
joined path assumes an anchored file today (`sessionNext` builds
`anchoredFile` from `thread.anchor.path`; `JOINED_PREAMBLE` speaks of "the
anchored code"): a review thread sends no anchored file, and the preamble
gains a line for this kind. The other session is extending the same area
of `host.ts` (MCP writes into threads): whichever branch lands second
rebases onto the first; keep the touch in `host.ts` small.

### Which code it answers against

**The comparison on screen when the question was sent**, like a thread
conversation. Owner: "whatever I'm viewing. the mcp should give it more
context if needed and it can checkout whatever (another session is working
on making the acp spawned agents to have access to the mcp)".

- Each human message carries `view` (the comparison on screen); the runner
  moves the checkout to `view.right` and sends `view` (left/right OIDs,
  patch set numbers) and the patch sets, as the thread conversation does.
  The thread conversation's "fixed later" rule doesn't apply: there is no
  one thread opened on one commit.
- The view must be the real one. The drawer sits outside Files changed's
  `SendViewProvider` (`FilesPage.tsx`), and `useSendView` falls back to
  "latest patch set vs base branch" outside it. Lift the provider (or what
  it reads) to the review layout so the drawer sends the comparison picked
  on Files changed from either tab **(call: on Overview, the same
  comparison the review is set to; the builder confirms there is one
  per-review choice and uses it)**.
- The agent may check out other commits and ask carbonless for more
  context on its own; giving the ACP agent the crb MCP is another
  session's work, and this change doesn't depend on it. Once it lands, the
  envelope's thread block could shrink to an index **(note, not now)**.

## Principles check

1. **Editable**: the conversation is the reviewer's own; nothing the AI
   decides here becomes review state, so there is nothing to correct.
2. **Coverage**: the conversation writes only `agent-message` events; the
   store's write rule (no ai resolve, no ai seen, no reviewed marks) is
   unchanged and extended to the `review` subject. Test: an ai
   `agent-thread-resolved` / `agent-thread-seen` / review-marking write on
   the review conversation is refused, and coverage is unchanged by any
   conversation traffic.
3. **Git**: one more thread in an existing per-reviewer ref; never pushed.
4. **No server**: unchanged; the reviewer's own agent.
5. **Mobile**: phone layout above; Playwright phone project covers it.
6. **Concise**: icon + count + dot on the chip, icon buttons with
   tooltips, no explanatory text.
7. **Methodology**: no history dependence; the thread list comes from
   GitHub's PR facts.
8. **Loading**: spinner in the drawer and no count on the chip until the
   agent threads are read; empty only after an answer says empty.

## Tests

Unit:
- store: open/answer/seen on a `review` thread; a second `review` open is
  refused; two on read collapse to the first; ai open refused; any resolve
  refused/ignored; the runner picks a waiting review thread up.
- prompt: the `review_conversation` envelope carries the facts, files and
  sanitised threads; a hostile thread body is fenced; truncation and
  "GitHub unreadable" are stated in `notice`.
- web: chip states (not configured → setup; configured → toggles the
  drawer; count; unread dot; pressed; accessible name); the drawer
  (empty state focuses the composer, opens at the end / at "new", marks
  seen, status button opens the modal, Escape closes; while the read is
  held: spinner, no empty composer state, no 0 count); the review thread
  absent from thread lists, Overview agent rows, tree dots and placements.

Playwright (desktop and phone), with the fake ACP agent:
- configured agent: tap chip → drawer → ask → streamed answer → close →
  unread dot on the chip after a later answer → reopen at "new";
- a code link in the answer jumps to Files changed with the drawer open
  (desktop) / closed (phone);
- status button opens Your agent; not configured: chip opens setup;
- 360px: no horizontal page scroll, tap targets ≥40px;
- coverage: after a conversation, the unreviewed counts are unchanged.

Gallery: a case PR with several resolved threads, one of them not really
fixed in code, so "were the comments truly resolved" has a real answer to
look at.

## Left to the builder

Drawer width and push/overlay breakpoint, the shortcut key, the thread
cap in the envelope, the exact preamble wording, how the drawer shares
components with `ThreadAgentPanel` (prefer extracting the conversation
body over copying it).
