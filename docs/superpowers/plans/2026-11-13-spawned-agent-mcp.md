# Spawned Agent over MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A spawned (ACP) agent gets crb's `/mcp` and does all its review work through it, exactly like a joined session. ACP only launches it, wakes it, and feeds the spawned-only extras.

**Architecture:** At spawn, the runner mints a pre-approved, per-process join in `JoinBroker` and passes a `crb` MCP server (HTTP, else a stdio bridge) in `session/new`. The kickoff prompt tells the agent to `attach` with that request. From then on the agent is the broker's joined session, marked spawned. The runner no longer drains threads into prompts. It sends wake prompts when the broker wakes, ties ACP updates (activity, cancel, crash) to the thread `next` handed out, and ends the agent once no review page has been open for `IDLE_MS`.

**Tech Stack:** TypeScript, Fastify, `@agentclientprotocol/sdk` 2.4, `@modelcontextprotocol/sdk`, Vitest, Playwright. Fake agent: `test/fake-acp/agent.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-13-spawned-agent-mcp-design.md` (approved 2026-11-13, CAR-149). Read it first: every "my call" in it is settled and binding.

## Global Constraints

- One answering path: an answer is stored only by MCP `reply` (`AgentHost.sessionReply`). Nothing stores ACP prompt text as an answer.
- The question text never travels in an ACP prompt. Only `next` hands it out.
- `next` returns the same payload to a spawned and a joined session. crb never moves the checkout after spawn.
- A spawned agent's messages carry `agent.via: "acp"`, its `agentInfo` name and version, and `activity`, with no `head`. Joined sessions keep `via: "mcp"`. No storage format change.
- The pre-approved request is minted only by the spawn path. It can be collected once, only with the spawn's secret, and dies with the process or after `JOIN.expiryMs`.
- A spawned token is never written to `joined.json`.
- Every path ends with the thread waiting, answered, or showing a cancelled or error message. It never ends quietly done (principle 2, principle 8).
- The re-prompt cap is 2 turns without a reply. Each handed-out question has its own `AGENT_TURN_MS` limit. The page-idle timeout is the registry's `IDLE_MS` (30 min). The reply grace after an outside join is approved is `JOIN.acpStopMs`.
- Wake, kickoff and re-prompt lines are short, in the style of the existing tool replies.
- CLAUDE.md applies: `pnpm verify:fast` while iterating, never a full `pnpm verify`. `CRB_NO_PHONE=1` (no layout change). Commits only with `git commit --only -- <paths>`. Run `pnpm flake-check` on every test that involves a hold, a gate or a timer.

## Review Focus

1. **The agent ignores the kickoff and never attaches.** Spawn fails visibly in the modal ("didn't attach"), the process is stopped, and waiting questions stay yellow. Test in Task 4.
2. **A question arrives while the agent is in a turn.** No second prompt is sent, and the wake comes at the turn's end only if questions still wait. Test in Task 4.
3. **crb restarts while a question is handed out.** After the respawn the question waits again and the new agent gets it through `next`. Test in Task 4.
4. **The agent calls `reply` for a thread it wasn't handed** (or after Stop current). The call is refused (`NotHandedError`) and nothing is stored. Test in Task 4.
5. **The page closes mid-turn, then reopens before the turn ends.** No detach happens, and the timer restarts from the reopen. Test in Task 5.

---

### Task 1: The fake ACP agent speaks MCP

The test agent must drive crb's `/mcp` the way a real one would. Everything after this task is tested with it.

**Files:**
- Modify: `test/fake-acp/agent.mjs`, `test/fake-acp/scenario.ts`, `test/fake-acp/README.md`
- Test: `test/fake-acp/agent.test.ts` (create if absent)

**Interfaces:**
- Produces: these scenario fields in `AcpScenario`:
  - `mcpHttp?: boolean`: advertise `mcpCapabilities.http`. Default true.
  - `mcp?: { attach?: boolean; replies?: "answer" | "none"; tools?: string[]; detach?: boolean }`. Default `{attach: true, replies: "answer"}`.
  - Behaviour: on a prompt that contains a request id, the agent calls `attach({review, request, name})` on the `crb` server from `session/new`. On any prompt, it loops `next` → `reply` (text from `answers`, matched against the question's text) until `{none: true}`. `replies: "none"` takes the question and ends the turn without replying. `tools` calls those tools first (e.g. `threads`). `detach` calls `detach` at the end.
  - Each `requests` entry is still reported as a `tool_call` update before replying, so activity can be tested.
  - With a stdio server in `mcpServers`, it spawns that server and speaks MCP over its stdio.
  - The existing holds (`prompt`), `crashOnPrompt` and `lingerOnPrompt` keep working.

- [ ] **Step 1:** Write `agent.test.ts`: start a minimal MCP server (the real `createMcpServer` over Streamable HTTP on a random port, with a fake host), spawn the fake agent with an `mcpServers` http entry, send a kickoff prompt carrying a request id, and assert it called `attach` with that request. Then assert `next` and `reply` happen with the scenario's answer text. A second test does the same over stdio.
- [ ] **Step 2:** Run `pnpm test test/fake-acp/agent.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it in `agent.mjs` with the MCP SDK's `Client` (`StreamableHTTPClientTransport`, `StdioClientTransport`).
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `pnpm test src/server/agent` to show the existing runner tests still pass on the old path.
- [ ] **Step 5:** Commit.

### Task 2: JoinBroker admits a spawned agent

**Files:**
- Modify: `src/server/agent/join.ts`, `src/shared/agent.ts` (status `via`)
- Test: `src/server/agent/join.test.ts`

**Interfaces:**
- Produces, on `JoinBroker`:
  - `admit(who: JoinIdentity, secret: string): { request: string }`: an already-approved request, marked spawned. It replaces nothing while a join is pending. A joined session in place leaves first (`replaced`), as `answer` does today. It never shows as `joinRequest` in `view()`.
  - `outcome(request, waitMs, secret?: string)`: a spawned request is collected only when `secret` matches (constant time). Otherwise it reports `expired`, with no hint that a request with that id exists.
  - `isSpawned(): boolean`: the joined session came from `admit`.
  - `spawnedGone(why: JoinLeave)`: the process exited or was stopped. It ends the join with no absence timers.
  - `replaceGrace(): { token: string; thread: string; until: number } | null`: set when an outside join is approved over a spawned one. Until it ends, `check` accepts that token for `reply` to that thread only.
  - `view()` gives `via: "acp"` while the joined session is spawned.
- Spawned joins have no watcher lease and no `graceMs`/`busyMs` timers. Presence comes from the runner (`setBusy(busy: boolean)`). Nothing is written to `joined.json` for them, and `restore()` never restores one.

- [ ] **Step 1:** Write tests in `join.test.ts`. Admit then collect with the secret gives approved and a token. Collecting twice gives expired. Collecting without the secret gives expired. `view().joinRequest` is never set by `admit`. `joined.json` is not written. No `lost` follows after `graceMs` with no watcher (`vi.useFakeTimers`). An outside approve while spawned gives a `replaceGrace` with the old token, valid until `JOIN.acpStopMs`.
- [ ] **Step 2:** Run `pnpm test src/server/agent/join.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement it in `join.ts`.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 3: `/mcp` serves a spawned agent (attach, secret, stdio bridge)

**Files:**
- Modify: `src/server/mcp/server.ts`, `src/server/mcp/routes.ts`, `src/server/agent/acp.ts`, the CLI entry (add the bridge subcommand where the other `crb` subcommands live)
- Create: `src/server/mcp/bridge.ts` (stdio ↔ this server's `/mcp`)
- Test: `src/server/mcp/routes.test.ts`, `src/server/mcp/bridge.test.ts`, `src/server/agent/acp.test.ts`

**Interfaces:**
- Consumes: `JoinBroker.admit/outcome(…, secret)` from Task 2.
- Produces:
  - The header `X-Crb-Spawn: <secret>` on `/mcp` requests. `attach` passes it to `outcome`.
  - `attach`'s approved reply for a spawned request is the same shape as today, but its `instructions` drop the `watch` step: "crb messages you when a question waits: then call next…". `watch` is omitted.
  - `AcpSpawn` gains `mcp: { url: string; headers: { name: string; value: string }[] } | null`. `AcpAgent.spawn` passes an `http` server named `crb` when `agentCapabilities.mcpCapabilities.http`, and otherwise a stdio server: `process.execPath` plus `[<cli path>, "mcp-bridge", "--url", url]`, with the headers as env (`CRB_MCP_HEADERS`, JSON).
  - `crb mcp-bridge --url <url>`: forwards MCP over stdio to `url`, adding the headers from `CRB_MCP_HEADERS`.
  - The URL is this server's localhost `/mcp` with the access key, as `routes.ts` checks it today.

- [ ] **Step 1:** Write the tests:
  - `routes.test.ts`: attach with a spawned request and the right header gives approved, the token and no `watch`. The wrong or missing header gives expired.
  - `acp.test.ts`: `session/new` gets an http `crb` server when the fake advertises http, and the stdio bridge with `mcpHttp: false`.
  - `bridge.test.ts`: `tools/list` through the bridge equals the direct list, and the header reaches the server.
- [ ] **Step 2:** Run `pnpm test src/server/mcp src/server/agent/acp.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 4: The runner launches, kicks off and wakes; the old path goes

This is the core change. The runner stops answering threads itself.

**Files:**
- Modify: `src/server/agent/runner.ts`, `src/server/agent/host.ts`, `src/server/agent/prompt.ts` (drop what only the old path used), `src/server/mcp/server.ts` (if `next`/`reply` need the hooks below)
- Test: the runner and host tests next to them (`src/server/agent/*.test.ts`), `src/server/mcp/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:
  - **Spawn.** `#ensure()` spawns with `mcp` set, then `join.admit({name, harness, machine: os.hostname()}, secret)`, then sends the kickoff: `JOINED_PREAMBLE` plus "attach to <link> with request <id>". If the agent hasn't attached by the time the kickoff turn ends, Spawn fails with the status error "The agent didn't attach" and the process stops.
  - **Gating.** `buildAgentHost`'s `acpOff` becomes `!spawned || (isJoined() && !isSpawned())`.
  - **Wake.** `wake()` from `AgentHost.asked`, and "questions wait" at attach time, send the wake line only when there is no turn in flight. At a turn's end: if a hand-out is still open, send "You still hold thread <id>: reply to it, then call next". Else, if questions wait, send the wake line. Else go idle. After 2 turns in a row that stored no reply while a hand-out was open, store an error message on the handed-out thread (`stop: "error"`, `replyTo`, text "The agent stopped without answering") and end the hand-out.
  - **Presence.** `join.setBusy(true)` at a turn's start and `false` at its end. Process exit gives `join.spawnedGone("lost")`, plus today's crash message on a handed-out thread.
  - **Extras.** `#onUpdate` tool calls go to the activity of the thread currently handed out (`join.handedOut()`). `sessionReply` takes that activity and writes `via: "acp"` for a spawned session. The question's `AGENT_TURN_MS` limit starts at `next` and is cleared by `reply`. When it fires, the turn is cancelled and a `stop: "error"` message is stored. `cancel()` (Stop current) stores `stop: "cancelled"` with `replyTo` on the handed-out thread and ends the hand-out. The rejected-permission reason goes into the next `next` payload for that thread.
  - **Removed.** `#drain`, `#turn`, `#messages`, `#moveTo`, `#missing`, the per-thread prompt envelopes, and anything only they used.
  - **Restart.** With the spawn flag set, crb respawns and mints a new request. A hand-out that was open waits again.
- Tests: rewrite the old-path runner tests to the new path.
  - Kickoff → attach → `next`/`reply` stores the answer with `via: "acp"` and activity.
  - Wake: one prompt per idle wake, none during a turn, and never the question text in a prompt.
  - The re-prompt and the cap.
  - Stop current and a crash mid-hand-out: the message lands and no wake follows.
  - The `AGENT_TURN_MS` limit restarts at each `next` (fake timers).
  - An outside approve mid-answer: the reply lands within the grace, and a later one is refused.
  - Review Focus 1–4.
  - Prompt texts: nothing is stored from them.
- [ ] **Step 1:** Write the tests above. They fail against the old runner.
- [ ] **Step 2:** Run `pnpm test src/server/agent src/server/mcp`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement it, then delete the old path.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `pnpm flake-check` on the hold and timer tests.
- [ ] **Step 5:** Commit.

### Task 5: Detach, and the page-closed timeout

**Files:**
- Modify: `src/server/agent/host.ts`, `src/server/registry.ts`, `src/server/app.ts` (the review routes' preHandler)
- Test: `src/server/registry.test.ts` or `host` tests, `src/server/app` route tests

**Interfaces:**
- Produces:
  - `SessionRegistry.pageSeen(id)`: called by the web UI's `/api/r/:id/…` preHandler (status polls included) and never by `/mcp` or the watcher. `AgentHost` reads the review's last page request through a dep `pageSeenAt(): number`.
  - `sweep` closes a review idle for `IDLE_MS` of page requests while the agent is spawned. A joined outside session keeps today's rule (`agent.active()`).
  - A page-idle timer in the host. When `now - pageSeenAt() > IDLE_MS` and no turn runs, it calls `detach()`. If a turn runs, it fires at that turn's end. A page request in between cancels it.
  - The agent's MCP `detach` while spawned calls the reviewer's `detach()` path (process stopped, flag cleared, checkout removed, claim released). The reviewer's Detach of a spawned-and-attached agent ends it too, not just disconnects.
- [ ] **Step 1:** Write the tests:
  - An agent that keeps calling `threads` with no page requests is detached after `IDLE_MS` (fake timers).
  - A page request at `IDLE_MS - 1` defers it.
  - Mid-turn, it waits for the turn's end.
  - Review Focus 5.
  - MCP `detach` and the reviewer's Detach both clear the flag and stop the process.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run it again. Expected: PASS. Then `pnpm flake-check` on the timer tests.
- [ ] **Step 5:** Commit.

### Task 6: End to end, and the docs

**Files:**
- Modify: `e2e/agent.spec.ts`, `e2e/thread-agent.spec.ts`, `e2e/agent-setup.spec.ts` (update the specs that assumed the old path), `e2e/fixtures.ts` if the fake agent needs wiring, `scripts/verify-fast.mjs` `E2E_MAP` if new source files need mapping
- Docs: `docs/faq.md`, `docs/product-rules.md` ("The reviewer approves every join"), `docs/review-data-storage.md` (`via: "acp"` now comes through `reply`), `docs/superpowers/specs/2026-11-04-review-buddy-design.md` ("The runner": a pointer to the new spec)
- [ ] **Step 1:** Write the e2e test: Spawn, then Ask agent on a line, the fake agent attaches, calls `next` and `reply`, and the answer shows with the spawned chip and its activity. Plus Stop current mid-turn (hold `prompt`), which shows the cancelled message, with no further turn.
- [ ] **Step 2:** Run `pnpm test:e2e e2e/agent.spec.ts e2e/thread-agent.spec.ts e2e/agent-setup.spec.ts --project=chromium` (with `CRB_NO_PHONE=1`). Fix the specs that assumed the old path.
- [ ] **Step 3:** Update the docs listed above.
- [ ] **Step 4:** Run `pnpm verify:fast master`. Expected: green.
- [ ] **Step 5:** Commit.
