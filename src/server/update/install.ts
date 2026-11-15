import { randomBytes } from "node:crypto";
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type { BuildInfo } from "../version.js";
import { PACKAGE } from "./registry.js";
import { parseVersion } from "./semver.js";

/**
 * How this crb was installed, so it can update itself: from npm, by which
 * package manager, and how to start it again afterwards.
 */

/**
 * Whether `root` (the package directory crb runs from) is a build npm
 * served: its package.json is carbonless-review's, with the `gitHead` CI
 * writes into every RC and release (docs/releasing.md, "The version in a
 * build"), equal to the build's own clean commit and at the build's
 * version. A checkout, `pnpm build`, the dev server and `pnpm release
 * local` (what a machine that follows master installs) have no `gitHead`:
 * they never offer an update over npm.
 */
export function isFromNpm(
	root: string,
	build: BuildInfo,
	read: (file: string) => string = (f) => readFileSync(f, "utf8"),
): boolean {
	if (!/^[0-9a-f]{40}$/.test(build.commit)) return false;
	if (!root.split(/[\\/]/).includes("node_modules")) return false;
	try {
		const pkg = JSON.parse(read(path.join(root, "package.json"))) as {
			name?: unknown;
			version?: unknown;
			gitHead?: unknown;
		};
		return (
			pkg.name === PACKAGE &&
			pkg.version === build.version &&
			pkg.gitHead === build.commit
		);
	} catch {
		return false;
	}
}

export type PackageManager = "npm" | "pnpm";

/** How crb was installed globally, read from where its package lies. */
export interface Install {
	pm: PackageManager;
	/** The package dir crb runs from (real path). */
	root: string;
	/** npm: the global prefix; pnpm: PNPM_HOME. */
	home: string;
	/** The install can write there (one-click needs it; else the command). */
	writable: boolean;
	/** Package dirs the new version may be in (npm: in place). */
	packages: string[];
	/** Dirs whose entries may each hold the package (pnpm's global dir). */
	scan: string[];
}

export interface DetectOptions {
	platform?: NodeJS.Platform;
	execPath?: string;
	exists?: (file: string) => boolean;
	writable?: (dir: string) => boolean;
	/**
	 * The real paths of the crb packages a pnpm global dir links to (its
	 * `<entry>/node_modules/carbonless-review`; default: read from disk).
	 */
	globalLinks?: (globalDir: string) => string[];
	/** How crb was started: `process.argv[1]`, unresolved (pnpm's shim path). */
	argv1?: string;
	/** For `$PNPM_HOME`. */
	env?: NodeJS.ProcessEnv;
}

/** The real paths of the crb packages `globalDir`'s entries link to. */
function readGlobalLinks(globalDir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(globalDir);
	} catch {
		return [];
	}
	const found: string[] = [];
	for (const e of entries) {
		try {
			found.push(
				realpathSync(path.join(globalDir, e, "node_modules", PACKAGE)),
			);
		} catch {
			// Not an install of crb.
		}
	}
	return found;
}

/**
 * Whether crb can write in `dir`: a probe file made and removed (access()
 * ignores Windows' ACLs, so `C:\\Program Files` would pass it).
 */
export function canWrite(dir: string): boolean {
	const probe = path.join(
		dir,
		`.crb-write-probe-${process.pid}-${randomBytes(4).toString("hex")}`,
	);
	try {
		writeFileSync(probe, "", { flag: "wx" });
	} catch {
		return false;
	}
	try {
		unlinkSync(probe);
	} catch {
		// Written is what was asked; a probe left behind is harmless.
	}
	return true;
}

/**
 * The package manager that installed the package at `root` (a real path:
 * symlinks resolved) globally, read from where it lies; null when it is
 * neither a global npm nor a global pnpm install (yarn, bun, Volta, a
 * project's node_modules, npx's or pnpm dlx's cache...): the toast then
 * shows the command. Layouts (docs/releasing.md, "Who installs it"):
 * - npm 9-12: `<prefix>/lib/node_modules/carbonless-review` with the `crb`
 *   shim in `<prefix>/bin` (Windows: `<prefix>\node_modules\carbonless-review`
 *   and `<prefix>\crb.cmd`).
 * - pnpm 8-10: `<PNPM_HOME>/global/5/.pnpm/.../node_modules/carbonless-review`
 *   (10 with the global virtual store: `.pnpm/@/carbonless-review/<v>/<h>/...`);
 *   pnpm 11+ with the global virtual store off:
 *   `<PNPM_HOME>/global/v11/<dir>/node_modules/.pnpm/...`.
 * - pnpm 11+ by default (the global virtual store):
 *   `<storeDir>/v11/links/@/carbonless-review/<v>/<h>/node_modules/carbonless-review`,
 *   when an entry of `<PNPM_HOME>/global/v11` links to it: a project's
 *   dependency can lie at the very same path. PNPM_HOME is read from how
 *   crb was started (pnpm's shim runs `<PNPM_HOME>/global/v11/<dir>/
 *   node_modules/carbonless-review/...`), else `$PNPM_HOME`, else the dir
 *   above the store's (its default place).
 * Volta's packages (`<VOLTA_HOME>/tools/image/packages/carbonless-review`)
 * are Volta's to update: an npm there would go behind its back.
 */
export function detectInstall(
	root: string,
	opts: DetectOptions = {},
): Install | null {
	const platform = opts.platform ?? process.platform;
	const p = platform === "win32" ? path.win32 : path.posix;
	const exists = opts.exists ?? existsSync;
	const writable = opts.writable ?? canWrite;
	const split = (file: string) => file.split(/[\\/]+/);
	const parts = split(root);
	const n = parts.length;
	if (parts[n - 1] !== PACKAGE || parts[n - 2] !== "node_modules") return null;
	const join = (segments: string[]) => segments.join(p.sep) || p.sep;
	const isVersionDir = (s: string | undefined) => !!s && /^v?\d+$/.test(s);
	// Volta's own, npx's cache, pnpm dlx's cache.
	for (let i = 0; i + 3 < n; i++) {
		if (
			parts[i] === "tools" &&
			parts[i + 1] === "image" &&
			parts[i + 2] === "packages" &&
			parts[i + 3] === PACKAGE
		) {
			return null;
		}
	}
	if (parts.includes("_npx")) return null;
	const dlxAt = parts.indexOf("dlx");
	if (dlxAt > 0 && parts[dlxAt - 1] === "pnpm") return null;

	const pnpm = (home: string, globalDir: string, dirs: string[]): Install => ({
		pm: "pnpm",
		root,
		home,
		writable: dirs.every(writable),
		// pnpm 10-: one node_modules; 11+: a dir per install, each linking
		// to the version it holds.
		packages: [p.join(globalDir, "node_modules", PACKAGE)],
		scan: [globalDir],
	});

	// pnpm 11+'s global virtual store.
	if (
		parts[n - 7] === "links" &&
		parts[n - 6]?.startsWith("@") &&
		parts[n - 5] === PACKAGE &&
		/^v\d+$/.test(parts[n - 8] ?? "")
	) {
		const storeVersion = parts[n - 8] as string;
		const storeDir = join(parts.slice(0, n - 7));
		const homes: { home: string; version: string }[] = [];
		const argv = split(opts.argv1 ?? process.argv[1] ?? "");
		for (let i = argv.length - 5; i >= 1; i--) {
			if (
				argv[i] === "global" &&
				isVersionDir(argv[i + 1]) &&
				argv[i + 3] === "node_modules" &&
				argv[i + 4] === PACKAGE
			) {
				homes.push({
					home: join(argv.slice(0, i)),
					version: argv[i + 1] as string,
				});
				break;
			}
		}
		const env = opts.env ?? process.env;
		if (env.PNPM_HOME) {
			homes.push({ home: p.normalize(env.PNPM_HOME), version: storeVersion });
		}
		if (parts[n - 9] === "store") {
			homes.push({ home: join(parts.slice(0, n - 9)), version: storeVersion });
		}
		const same = (a: string) =>
			platform === "win32"
				? a.toLowerCase() === root.toLowerCase()
				: a === root;
		for (const { home, version } of homes) {
			const globalDir = p.join(home, "global", version);
			if (!(opts.globalLinks ?? readGlobalLinks)(globalDir).some(same)) {
				continue;
			}
			// A new dir per install, the store's files and links, the shim.
			return pnpm(home, globalDir, [globalDir, storeDir, p.join(home, "bin")]);
		}
		return null;
	}

	// pnpm's `.pnpm` layouts, `.pnpm` exactly where a global install puts
	// it (a project under some `global/2` is not one).
	const pnpmAt = parts.lastIndexOf(".pnpm");
	if (pnpmAt >= 0) {
		const tail = n - 1 - pnpmAt;
		const shaped = tail === 3 || (tail === 6 && parts[pnpmAt + 1] === "@");
		// pnpm 8-10 name their global dir `5`, pnpm 11+ `v11`.
		const at = (i: number, version: RegExp) =>
			i >= 1 && parts[i] === "global" && version.test(parts[i + 1] ?? "")
				? i
				: undefined;
		const nm = parts[pnpmAt - 1] === "node_modules";
		const globalAt =
			// pnpm 8-10: global/5/.pnpm
			at(pnpmAt - 2, /^\d+$/) ??
			// global/5/node_modules/.pnpm
			(nm ? at(pnpmAt - 3, /^\d+$/) : undefined) ??
			// pnpm 11+, its global virtual store off:
			// global/v11/<dir>/node_modules/.pnpm
			(nm ? at(pnpmAt - 4, /^v\d+$/) : undefined);
		if (!shaped || globalAt === undefined) return null;
		const home = join(parts.slice(0, globalAt));
		const globalDir = p.join(home, "global", parts[globalAt + 1] as string);
		return pnpm(home, globalDir, [globalDir]);
	}

	// One node_modules only: a dependency of a project isn't a global install.
	if (parts.indexOf("node_modules") !== n - 2) return null;
	const prefixParts = parts.slice(0, platform === "win32" ? -2 : -3);
	if (platform !== "win32" && parts[n - 3] !== "lib") return null;
	const prefix = join(prefixParts);
	const shim =
		platform === "win32"
			? p.join(prefix, "crb.cmd")
			: p.join(prefix, "bin", "crb");
	if (!exists(shim)) return null;
	return {
		pm: "npm",
		root,
		home: prefix,
		writable: writable(join(parts.slice(0, -1))),
		packages: [root],
		scan: [],
	};
}

/** The exact package and version an update installs. */
export const spec = (version: string) => `${PACKAGE}@${version}`;

/** A command; `env` is added to crb's environment. */
export interface Command {
	command: string;
	args: string[];
	env?: Record<string, string>;
	/** Where it runs (default: crb's own cwd). */
	cwd?: string;
}

/** `env`'s PATH key as it is spelled (Windows: often `Path`). */
const pathKey = (env: NodeJS.ProcessEnv) =>
	Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

/**
 * The install command for `version` (checked: only a version reaches a
 * command line), run by the package manager of the install crb runs from:
 * - npm from the detected prefix, else beside the running node, else
 *   PATH's, always into that prefix (`--prefix`);
 * - pnpm from PNPM_HOME (else the one on PATH), with PNPM_HOME and its
 *   bin dir set, and our package exempt from pnpm's release-age delay
 *   (docs/releasing.md).
 */
export function installCommand(
	install: Pick<Install, "pm" | "home">,
	version: string,
	opts: {
		platform?: NodeJS.Platform;
		execPath?: string;
		exists?: (file: string) => boolean;
		env?: NodeJS.ProcessEnv;
	} = {},
): Command {
	if (!parseVersion(version) || version.length > MAX_VERSION) {
		throw new Error(`Not a version: ${version}`);
	}
	const platform = opts.platform ?? process.platform;
	const p = platform === "win32" ? path.win32 : path.posix;
	const exists = opts.exists ?? existsSync;
	const ext = platform === "win32" ? ".cmd" : "";
	const node = opts.execPath ?? process.execPath;
	const env = opts.env ?? process.env;
	const key = pathKey(env);
	const first = (candidates: string[], fallback: string) =>
		candidates.find(exists) ?? fallback;
	if (install.pm === "npm") {
		const own =
			platform === "win32"
				? p.join(install.home, "npm.cmd")
				: p.join(install.home, "bin", "npm");
		return {
			command: first([own, p.join(p.dirname(node), `npm${ext}`)], `npm${ext}`),
			args: ["install", "-g", "--prefix", install.home, spec(version)],
			// npm's shim runs `env node`: this node, whatever PATH the
			// service has.
			env: {
				[key]: [p.dirname(node), env[key]].filter(Boolean).join(p.delimiter),
			},
		};
	}
	const bin = exists(p.join(install.home, "bin"))
		? p.join(install.home, "bin")
		: install.home;
	return {
		command: first(
			[
				p.join(install.home, "bin", `pnpm${ext}`),
				p.join(install.home, `pnpm${ext}`),
			],
			`pnpm${ext}`,
		),
		args: [
			"add",
			"-g",
			spec(version),
			`--config.minimumReleaseAgeExclude=${PACKAGE}`,
		],
		env: {
			PNPM_HOME: install.home,
			// pnpm's shim runs `node` unless one sits beside it: this node.
			[key]: [bin, p.dirname(node), env[key]].filter(Boolean).join(p.delimiter),
		},
		// Not crb's cwd: corepack's pnpm would follow a `packageManager` there
		// (another major, another global dir).
		cwd: install.home,
	};
}

/** The longest version an update takes (a registry's answer is checked). */
export const MAX_VERSION = 64;

/** The command as the reviewer would type it. */
export function showCommand(pm: PackageManager, version: string): string {
	return pm === "npm"
		? `npm install -g ${spec(version)}`
		: `pnpm add -g ${spec(version)} --config.minimumReleaseAgeExclude=${PACKAGE}`;
}

/** The command to show when crb can't tell how it was installed. */
export const manualCommand = (version: string): string =>
	showCommand("npm", version);

/**
 * crb's arguments for the restart: the same, but on the port it actually
 * listens on (a `--port 0` or a config default must come back where the
 * pages are) and without `--new-key` (the pages' key must keep working).
 */
export function restartArgs(argv: readonly string[], port: number): string[] {
	const out: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] as string;
		if (a === "--new-key") continue;
		if (a === "--port") {
			i++;
			continue;
		}
		if (a.startsWith("--port=")) continue;
		out.push(a);
	}
	out.push("--port", String(port));
	return out;
}
