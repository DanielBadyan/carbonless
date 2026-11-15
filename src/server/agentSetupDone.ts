import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSetupDone } from "../shared/agent.js";
import { stateDir } from "./paths.js";

/**
 * Whether this machine has done the agent modal's one-time setup, per way
 * (CAR-160): Invite once the reviewer approved a session's join, Spawn once
 * a Spawn started an agent. One empty marker file per way under the
 * server's state directory (`$XDG_STATE_HOME/carbonless/agent-setup/`):
 * machine-wide like the setup itself, UI state, never in git. A file per
 * way, so an approve and a spawn at once never race on a shared file.
 */
export type SetupWay = keyof AgentSetupDone;

const dir = () => join(stateDir(), "agent-setup");
const marker = (way: SetupWay) => join(dir(), `${way}-done`);

const exists = (path: string) =>
	access(path).then(
		() => true,
		() => false,
	);

/** Which ways are done; unreadable counts as not done (the step stays open). */
export async function readSetupDone(): Promise<AgentSetupDone> {
	const [invite, spawn] = await Promise.all([
		exists(marker("invite")),
		exists(marker("spawn")),
	]);
	return { invite, spawn };
}

/**
 * Records `way` as done. Never throws: the approve or spawn it follows took
 * effect, and a step left open only costs a click.
 */
export async function markSetupDone(way: SetupWay): Promise<void> {
	try {
		await mkdir(dir(), { recursive: true });
		await writeFile(marker(way), "", { flag: "a" });
	} catch (error) {
		console.warn(`crb: noting the ${way} setup: ${(error as Error).message}`);
	}
}
