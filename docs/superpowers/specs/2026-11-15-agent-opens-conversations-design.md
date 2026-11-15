# The agent opens conversations: on code, and on a thread

Status: draft for the owner, 2026-11-15. Follows CAR-149 (a spawned agent works
through MCP like a joined one); this is step 2 of growing crb's MCP.

## Why

The owner, 2026-11-15:

> I want the agent to have 2 new options:
> 1) Open a new conversation around a block of code. It should be similar to me
>    marking a region of code (either a line, multiple lines, or highlighting
>    text) and then asking the AI, except initiated by the AI. They should
>    behave exactly the same.
> 2) Open a conversation around a thread. Again this is exactly like I if I
>    would ask a question on the thread, except initiated by the AI.
>
> These two abilities would immensely increase the usefulness of the AI.

Today the agent can only answer where it was asked. When the reviewer asks
something whose answer lives in several places ("highlight the important
decisions", "show me all the code that only moved"), the answer is a list of
`path:line` refs in one reply. With these two tools the agent puts a
conversation on each place instead, and the reviewer goes through them where
they sit in the diff or on the thread.

## Owner decisions

1. **Two abilities, same objects.** The agent can open a conversation on a
   block of code (one line, several lines, or a highlighted text range) and on
   a GitHub review thread. Each is the very object the reviewer's own "Ask
   agent" makes on a selection or a thread: the same anchor, card, placement
   across patch sets, thread panel, replies, privacy (never posted to
   GitHub). Only who opened it differs.
2. **They come from a request.** "Presumably, it happened because I asked the
   AI." The agent opens conversations while answering one of the reviewer's
   questions, and each one points back to that question.
3. **Finding them, for now: a link.** The agent's reply links each
   conversation it opened, and the reviewer clicks through. A list of new
   activity is another session's work and not part of this.
4. **The "Re" box.** An agent-opened conversation starts with a small box:
   "RE" then the first words of the request that started it, cut with an
   ellipsis, with "Show more" to read it whole. Next to it, a way back to that
   request and a list of every conversation that request started. Then the
   agent's message: why it is pointing here, then the detail. A stub is fine
   ("this is such a case").
5. **On a thread, the existing thread conversation.** On a GitHub thread it is
   the thread's agent conversation as it is today: the sparkle pill in the
   card header, the panel that slides in over the comments with their avatar
   strip left as the way back, the card's composer below. The Re box sits at
   the top of the panel.
6. **One conversation per thread.** If the reviewer has already talked to the
   agent on that thread, the agent continues that conversation: its message,
   with its own Re box, goes at the end. No second conversation on a thread.
7. **Mockups approved** (2026-11-15, Design canvas "Agent-opened
   conversations", shared with the owner): (1) an agent-opened conversation on
   lines in Files changed, desktop; (2) the request, with "Started N" and the
   list; (3) on a GitHub thread, in the slide-in panel; (4) on lines, phone.

## What the reviewer sees

### An agent-opened conversation on code

The card the reviewer's own ask makes, on the lines (or characters) the agent
chose, in Files changed and wherever such cards show today (the overview's row
for threads asked on older heads included).

- **Header:** the sparkle, the agent's name, "opened this" and the relative
  time, the unread dot until seen.
- **Re row** (above the agent's message that came from a request):
  - "RE" in `label`.
  - A box (`overlay`, `edge` border) holding the request's first words in
    quotes, one line, cut with an ellipsis. "Show more" (chevron,
    `aria-expanded`) shows the whole request in the box; "Show less" folds it.
    The text is the reviewer's own message, read from the store, shown as
    plain text.
  - **Go to your request** (icon button, 40px): opens the conversation the
    request was asked in, scrolled to that message, which is outlined in
    `accent` for a moment (as a thread link's landing is).
  - **Conversations from this request** (list icon and a count, 40px): a list
    under the row, one line per conversation the request started, in the order
    they were opened: the unread dot, where it is (`path:start–end` or "Thread ·
    <first author>"), the first words of the agent's message there. Each line
    opens that conversation. The one being read is marked.
- **The agent's message**, as any agent message.
- **Reply**, as on any conversation. A reply makes it a question waiting for
  the agent, exactly as on the reviewer's own conversations.

### On a GitHub thread

Decision 5. The pill shows the message count and the unread dot as today; the
panel shows the Re row at the top of the agent's message that came from a
request, with a "new" line above it while unseen.

When the conversation already existed (decision 6), the agent's message goes
at the end with its own Re row; earlier messages are untouched.

### Where the reviewer asked

Under the request message, a **Started N** button (list icon, the count, an
`accent` count of unread ones) that opens the same list. It shows only on a
message that started at least one conversation.

### The agent's reply

The agent cites each conversation it opened in its reply (decision 3). A
citation becomes a link that opens the conversation, labelled with where it
is. crb builds the link from a conversation it checked belongs to this review;
it never uses an href the agent wrote (as code links do today,
`src/web/agent/codeLinks.ts`).

### Phone

The card and the panel as today on a phone. The Re row keeps one line: "RE",
the first words, a 40px chevron for Show more, the 40px go-to-request button,
the 40px list button. Expanded, the box grows to the full text. No horizontal
page scroll at 360px.

## How the agent does it

### The tool

One new MCP tool, `open`, with `token`, `text` (Markdown, up to 32 KiB, as
`reply`), and exactly one of:

- `code`: `{path, side, line, startLine?, startCol?, endCol?}`, the same
  anchor shape as the reviewer's ask on a selection (`AgentAnchor` with
  `subject: "line"`, `src/shared/agent.ts`), on the code the held question
  showed the agent (call 11); or `path` alone for a whole file
  (`subject: "file"`).
- `thread`: a GitHub review thread's id.

It returns the conversation's id, whether it was new or continued, and the
citation text to put in the reply.

The tool exists for joined sessions and spawned agents alike: CAR-149 made
them the same.

### When it may be called

Only while the agent holds a question `next` handed it and hasn't answered
yet. That question's thread and its `replyTo` message are the **request**; the
opened conversation's message records them as its origin. Called with no
question held: an error saying to call it while answering.

### What it writes

All in the reviewer's private agent ref, as today's agent threads.

- **New conversation on code:** one `agent-thread-opened` event with
  `by: "ai"`, the agent's identity, the text (the fold makes it the first
  message, as for the reviewer's ask) and `origin: {thread, message}` (the
  request).
- **On a thread with no conversation yet:** the same, anchored on the thread
  as the reviewer's ask would be (`#threadAnchor`).
- **On a thread with a conversation:** only the `agent-message`, with its
  origin, at the end of that conversation.

### What it must not do

- **Answer anything.** An origin message has no `replyTo` and does not answer
  any question. Today's fold treats an ai message without `replyTo` as
  answering everything before it (`isWaiting`, `src/server/agent/store.ts`):
  that must change, so a question waiting on a thread stays waiting when the
  agent adds an origin message there (principle 8). The request itself stays
  waiting until the agent calls `reply`.
- **Count as a question.** An agent-opened conversation doesn't wait until the
  reviewer replies in it.
- **Touch progress.** It writes no reviewed state, resolves nothing, and writes
  nothing to GitHub (principle 2).

### What the agent is told

- `open`'s description, and the attach instructions, say when to use it: when
  an answer points at several places, or at a place that deserves its own
  conversation, open one there instead of listing refs; start the text with
  why ("this is such a case"); cite each one in the reply.
- `next`, handing out a question in an agent-opened conversation, shows the
  conversation's messages as today, and the origin request's text with the
  agent's message that came from it, so the agent knows why it opened it.
- To open on a thread the agent needs the thread ids: `review` gains the PR's
  GitHub review threads (id, path, line, side, resolved, outdated, and each
  comment's author and body, capped). The wider "all review data" is the next
  step's subject.

## My calls (the owner may overturn any)

1. **One tool, `open`, with `code` or `thread`**, rather than two tools:
   it mirrors the reviewer's route, which takes exactly one of `span` or
   `thread`.
2. **Only while holding a question** (decision 2 made strict): every
   agent-opened conversation has a request to point back to, and an agent
   can't open conversations unprompted.
3. **The origin belongs to a message**, as `{thread, message}` ids, not to
   the thread and not as copied text: one thread can hold messages from
   several requests (decision 6), the Re text is always the reviewer's own
   words as stored, and "go to your request" has its target. It is written on
   whichever event carries that message: `agent-thread-opened` for a new
   conversation (its text is the first message), `agent-message` for one
   continued. The unused `origin: {request}` on `agent-thread-opened` (nothing
   writes it, per the review-buddy spec) becomes this shape.
4. **What the agent can anchor on:** the PR's changed files only, at the
   review's current head or merge base; lines must exist in that version, and
   columns within their line. Anything else is refused with a reason, never
   placed somewhere near.
5. **Threads the reviewer couldn't ask on are refused** the same way: a
   resolved, deleted or unknown GitHub thread, or GitHub not readable (the
   reviewer's ask fails closed there today, `AgentHost.message`). "Exactly the
   same" cuts both ways.
6. **Not the request's own conversation:** opening on the thread the request
   was asked on is refused ("answer it with reply").
7. **At most 25 conversations per request.** More is refused with a reason.
   It keeps a confused agent from flooding the review.
8. **A citation form crb resolves**: `open` returns a short token for the
   conversation; in a reply crb turns it into a link labelled with where the
   conversation is, after checking it is this review's. A token that doesn't
   resolve stays plain text.
9. **Links that open a conversation:** a new search param on the existing
   pages (Files changed lands on the card's lines and opens it; the overview
   lands on the GitHub thread and opens its panel). "Go to your request" and
   citations use them. The exact name is the builder's.
10. **"Started N" counts per request message**, folded from the origins on
    read: no new event and no counter stored.
11. **The commit a code anchor pins to is the one the held question showed**:
    the head `next` handed it out on (`RIGHT`) and that head's merge base
    (`LEFT`), recorded with the hand-out, as the agent's checkout and
    `path:line` refs see it. If the PR has moved on since, the conversation is
    placed forward as a reviewer's ask on an older head is (or shown unplaced,
    never on lines that merely share the numbers). Lines and columns are
    checked against that version.
12. **A link to a code conversation opens the comparison it is anchored on**,
    as `path:line` links in answers do today (`codeLinkSearch`): the patch
    set holding that head, else that head. Go to your request does the same
    for a request asked on code.
13. **Builder's details, settled:** an origin message is skipped by the
    waiting rule; citations resolve when rendered, against the threads the
    page already has; `open` is refused once the held question is past its
    limit (the spawned agent's grace); a retried `open` is idempotent (a
    client-supplied key); outdated threads are allowed, as for the reviewer.

## Storage

One optional field, `origin: {thread, message}` (two ids), on
`agent-thread-opened` and `agent-message`, written only with `by: "ai"`; readers check both ids name a thread and
a human message in this ref and ignore an origin that doesn't resolve. The
private ref only; nothing pushed. `docs/review-data-storage.md` gains the field
and the waiting rule's change; `origin: {request}` on `agent-thread-opened`
becomes the new shape. No measurement needed: two ids per message.

## Out of scope

- A list of new or pending activity (another session).
- The agent opening conversations with no request.
- More than one conversation per GitHub thread.
- A whole-review conversation (another session); its messages can be requests
  later, since an origin is just a thread and message id.
- Wider review data for the agent (the next step).

## Tests

- **Tool:** opens on one line, a range, a text range and a whole file; on a
  thread with and without a conversation; refuses: no held question, a path not
  in the PR, a line or column out of range, a resolved/deleted/unknown thread,
  GitHub unreadable, the request's own thread, the 26th conversation; the
  agent's identity on the opened thread and message; `text` capped as `reply`.
- **Waiting (principle 8):** a waiting question on a thread stays waiting
  after an origin message lands there; an agent-opened conversation isn't
  waiting until the reviewer replies, and then is; the request stays waiting
  until `reply`; `next` hands the reviewer's reply in an agent-opened
  conversation out with the origin request's text.
- **Fold:** an origin naming a missing thread or a non-human message is
  ignored; Started N counts per request message.
- **Input sanitization:** the Re text (the reviewer's own text) renders as
  text, never markup; a citation token for another review's conversation, or a
  made-up one, stays plain text; an agent's text in `open` goes through the
  agent Markdown renderer as replies do.
- **E2E (desktop and phone; the fake ACP agent learns `open`):** the agent
  opens on lines and on a thread; the reply's citations open them; the Re box's
  Show more, Go to your request (lands on the message) and the list; Started N
  with its unread count; on an existing thread conversation the message goes
  at the end; replying makes it a question the agent gets. Phone at 360px: no
  horizontal scroll, 40px targets.

## Docs to update

`docs/review-data-storage.md` (the field, the waiting rule),
`docs/product-rules.md` (what the agent may write), `docs/faq.md` (how the
agent points at code), and the review-buddy spec's line that nothing opens an
ai thread yet.
