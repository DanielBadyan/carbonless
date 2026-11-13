# Spawned agent over MCP

Owner request, 2026-11-13. Step 1 of expanding crb's MCP, so that the
review agent can do more in the review (open threads on lines or on
GitHub threads, read all the review data). Step 2, the new tools, will be
discussed after this one lands.

## Why

Today a spawned (ACP) agent and a joined (MCP) session reach the review
in two different ways. The joined session uses crb's MCP tools (`attach`,
`next`, `reply`, `threads`, `review`, `detach`). The spawned agent gets
no MCP: `session/new` passes `mcpServers: []`
(`src/server/agent/acp.ts`). Instead it is sent each question as an ACP
prompt, and its reply text becomes the answer. Any tool we add to the MCP
would reach joined sessions only.

Owner, 2026-11-13: "I'd like a spawned agent to work as much as possible
like an MCP joined one." On how: "I'd rather it spawn with instructions
to listen in on the mcp like the other one does. it's less ideal but
it's worth the consistency." On waking it up: "I like using acp just as
a better wakeup, but otherwise they stay the same."

## Goals

- A spawned agent gets crb's MCP at `session/new` and does all its review
  work through it, with the same tools, the same flow and the same
  replies as a joined session.
- ACP keeps three jobs only: launching the process, waking the agent when
  a question waits, and the spawned-only extras below.
- Any tool added to the MCP later reaches both kinds of agent with no
  extra work.

## Non-goals

- New MCP tools or new abilities (step 2).
- Changes to the setup modal's layout, Invite tab or the join flow for
  outside sessions.
- Spawning more than one agent per review.

## Anti-goals

- Two answering paths. ACP reply text never becomes a thread answer:
  only `reply` stores an answer.
- An agent that can reach a review the reviewer didn't spawn it in, or
  any other review.
- A spawned agent that looks finished, idle or attached when it isn't.
  If it stops without answering, the thread shows that (the loading
  rule: waiting stays visibly waiting).

## Owner decisions

1. The spawned agent is started with instructions to attach through MCP
   and work like a joined session: `next`, `reply`, call `next` again
   until none waits.
2. **Wake-up is over ACP**, not the `watch` command. When a question
   waits and the agent isn't in a turn, crb sends it a short ACP prompt
   saying so. It doesn't run `watch`.
3. **Pressing Spawn is the approval.** The spawned agent never shows a
   join request bar. Its permission covers this one review and nothing
   else.
4. **One answering path.** The old ACP path (crb drains waiting threads
   by sending each as a prompt and storing the reply text) is removed,
   not kept alongside.
5. **The chip still shows how the agent got there** (spawned vs joined).
   Otherwise the two behave the same.
6. **The setup modal's Stop current and Detach stay** and work as they do
   today.
7. **Spawned-only extras stay:** live activity (tool titles while the
   agent works on a question), Stop current turn, and a crash or failed
   turn shown in the thread with the agent's reason. These describe what
   the agent is doing, so they aren't a second way to answer.
8. **No checkout preparation.** crb no longer moves the agent's checkout
   to the right commit before each question, or tells it the path. Like
   a joined session, the spawned agent gets exactly what `next` gives and
   finds the code itself. Owner, 2026-11-13: "should be like a joined
   session in that regard".

## How it works

### Spawn

The reviewer's Spawn sets the review's spawn flag as today, and the
runner launches the configured command in the review's checkout as
today. *(My call: the checkout is still made at spawn, at the PR head,
as the agent's working directory, so the repository is at hand. crb
never moves it after that; the agent may.)* What changes is
`session/new`:

- `mcpServers` holds one server named `crb`, pointing at this server's
  own `/mcp` with the access key.
  - Over **HTTP** (`type: "http"`, the key in the URL or a header) when
    the agent's `initialize` response says
    `agentCapabilities.mcpCapabilities.http`.
  - Otherwise over **stdio**, which every ACP agent must support: a crb
    subcommand that bridges stdio to this server's `/mcp`. *(My call: a
    built-in bridge, so no third-party proxy is needed. If the builder
    finds that no agent we support lacks HTTP, it may defer the bridge.
    In that case Spawn fails with a clear error in the modal for such an
    agent, never silently with no MCP.)*
- crb's own `localhost` address is used, not `serve.publicUrl`, because
  the agent runs on this machine.

### Attaching: pre-approved

Before the first prompt, crb creates a join request that is **already
approved**, with the agent's identity:
- name: `agentInfo` name, else the command's name, as today;
- harness: `agentInfo` version;
- machine: this machine;
- marked as spawned.

The first ACP prompt (the kickoff) holds the joined session's preamble
and tells the agent to call `attach` with the review's link and that
request id. `attach` then returns `approved`, the token and the review's
facts, exactly as for a joined session. One difference: its
`instructions` tell a spawned agent **not** to run `watch`, because crb
will message it when a question waits.

- The request can be collected once only, and only by the process that
  was given it. It dies with that process, or after `JOIN.expiryMs` if
  never collected. If the agent never attaches, the modal shows Spawn
  failed with that reason. *(My call: "only by that process" is enforced
  by a per-spawn secret in the `crb` server's URL or headers in
  `session/new`. `attach` checks it along with the request id, and the
  stdio bridge forwards it.)*
- The access key alone still can't join a review. The pre-approved
  request is minted only by the Spawn path.

From then on the spawned agent **is** the review's joined session: the
same `JoinBroker` slot, token, `next`/`reply` hand-out rules, `threads`,
`review` and `detach`.

### One buddy per review: unchanged rules

- An outside session that asks to join while a spawned agent is attached
  gets the Approve bar as today. Approving it stops the spawned agent
  (its turn gets `JOIN.acpStopMs`, then is cancelled) and clears the
  spawn flag. *(My call: as today, it may land the answer it is working
  on within that window. Its token stays valid for `reply` to its
  handed-out thread only, until its turn ends or the window does.
  Meanwhile the new session's `next` skips that thread, as
  `busyThread()` does today.)*
- Spawn while a joined session is attached: the joined session leaves
  first, as today.
- The agent's own `detach` ends it like the reviewer's Detach: process
  stopped, spawn flag cleared, checkout removed, claim released. *(My
  call: a spawned agent has no life outside the review, so leaving means
  ending.)*
- **Closing the review page ends it after a while.** Owner, 2026-11-13:
  "if the review page is closed the session should close after a while".
  When no review page has been open for a set time, the spawned agent
  ends the same way Detach ends it.
  - "Page open" means requests from the web UI for this review. The
    page's status polls count; the agent's own MCP calls and watcher
    don't. This is needed because today any request, MCP included,
    counts as use, and `SessionRegistry.sweep` never closes a review
    while `agent.active()`. Unchanged, a spawned agent would keep its
    review open forever.
  - The timer fires only between turns, so an answer in progress still
    lands.
  - Reopening the page before the time is up cancels the timer.
  - *(My call: the default is the registry's `IDLE_MS`, 30 min. The
    builder may tune it, with a reason.)*
  - This applies to spawned agents only. crb can't close an outside
    session, and a joined session keeps today's rules.

### Waking it up

The broker's `wake()` (a human asked) and a question that already waits
at attach time both lead to the same action. If the attached session is
spawned and its ACP connection isn't in a turn, crb sends a short prompt:
"A question waits for you: call `next`." The prompt never carries the
question itself, so the question always arrives through `next`.

- **Presence.** There is no watcher lease for a spawned agent. While its
  process lives, it counts as listening when idle and busy while in a
  turn. The absence timers (`graceMs`, `busyMs`) don't apply to it. If the
  process exits, it leaves (as a crash, below).
- **A turn that ends early.** If a turn ends while a question is still
  handed out, or while questions still wait, crb prompts again: "You
  still hold thread X: reply to it, then call `next`", or the wake line.
  After two turns in a row that store no reply, the handed-out thread
  gets an error message ("The agent stopped without answering",
  `stop: "error"`, `replyTo` the question), and its hand-out ends. Like
  today's error messages, it ends that question's wait (red, not
  yellow). The reviewer asks again to retry, so nothing loops. *(My
  call: two is a guess the builder may tune, with a reason.)*
- **Turn time limit.** `AGENT_TURN_MS` limits each handed-out question
  (from `next` to its `reply`), not a whole woken turn that may answer
  several. *(My call.)*

### Spawned-only extras

These come from the ACP session's updates and are tied to **the thread
`next` handed out** during that turn:

- **Live activity.** Tool titles show in that thread while the agent
  works, as today. The `reply` that answers it is stored with that
  `activity`, as today's ACP answers are. It has no `head`: crb no
  longer knows which commit the agent read (decision 8).
- **Stop current.** It cancels the ACP turn and ends the hand-out. As
  today, the thread gets an `ai` message with `stop: "cancelled"` and
  `replyTo` the question, which ends its wait. The reviewer asks again
  to retry; the agent isn't woken for that question again.
- **Crash or failed turn.** An error message in the handed-out thread
  with the agent's reason (`stop: "error"`, `replyTo`), which ends its
  wait, as today. With nothing handed out, the modal shows it as today.
- **Permission requests** are handled as today (the Open leash).
- A rejected permission's reason, which today goes into the thread's next
  envelope, goes into what `next` returns for that thread.

### What's stored

A spawned agent's answer is an `agent-message` from `reply`, with
`agent.via: "acp"` (the chip shows spawned), its name and version as
today, `replyTo` from `reply`, and the extras above. There's no storage
format change. `via` already allows `acp`, and joined sessions keep
`mcp`.

### Restart

On a crb restart with the spawn flag set, crb respawns the agent and
mints a new pre-approved request, as Spawn does. A spawned agent's token
is never written to `joined.json`: it can't outlive the process. A
question that was handed out when crb stopped waits again.

## Tests

Unit (fake ACP agent, the existing runner/host test style):
- `session/new` carries the `crb` MCP server: HTTP when advertised, stdio
  otherwise.
- The pre-approved request: attach with it returns approved with no
  Approve; a second collect fails; another process or session can't use
  it; it never appears as a join request bar.
- Wake: a human question on an idle spawned agent sends exactly one wake
  prompt. None is sent during a turn: the turn's end prompts instead.
  The question text is never in the prompt.
- A reply stored from a spawned agent has `via: "acp"` and the turn's
  `activity`.
- `next` returns the same payload to a spawned agent as to a joined one,
  and crb never moves the checkout after spawn.
- A turn ends with a hand-out open: re-prompted. Two turns with no reply
  give the error message, which ends that question's wait, and no
  further wake is sent for it. Every path ends with the thread waiting,
  answered or showing an error, never quietly done (principle 2, loading
  rule).
- Stop current and a crash mid-turn: the hand-out is released, the
  cancelled or error message shows in the thread, and no wake follows
  for it.
- An outside join approved mid-answer: the spawned agent's `reply` to
  its handed-out thread still lands within `JOIN.acpStopMs`, and nothing
  else it sends does.
- Attach with the pre-approved request id but without the spawn's secret
  fails.
- `AGENT_TURN_MS` restarts with each `next`.
- An outside session's approved join stops the spawned agent. Spawn
  while joined: the joined session leaves.
- The agent's `detach` stops the process and clears the spawn flag.
- No page request for the review within the timeout ends the spawned
  agent like Detach, but never mid-turn: it waits for the turn to end.
  A page request before the timeout cancels it. The agent's own MCP
  calls never count as a page request, which the test proves with an
  agent that keeps calling `threads`.
- The old ACP answering path is gone: no answer is stored from prompt
  text.

E2E (fake ACP agent driving the real `/mcp`): Spawn, then Ask agent on a
line, the agent calls `next` and `reply`, the answer shows with the
spawned chip and its activity. Plus Stop current mid-turn.

## Docs to update in the same change

- `docs/faq.md`: what a spawned agent gets and how it differs from a
  joined one (wake-up, no Approve).
- `docs/product-rules.md`, "The reviewer approves every join": Spawn is
  the approval for a spawned agent.
- `docs/review-data-storage.md`: `via: "acp"` messages now come through
  `reply`, if the text describes how.
- The review-buddy spec's "runner" section, which describes the removed
  prompt path: a pointer to this spec.

## Left to the builder

- How the key reaches `/mcp` (URL or header), and the bridge
  subcommand's name.
- Exact wording of the kickoff, wake and re-prompt lines (short, like the
  existing tool replies).
- How the runner and host code are reshaped to remove the old path.
- Whether the first prompt's PR facts survive. `attach` already returns
  the review's facts.
