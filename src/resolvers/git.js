import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Resolving a file-level marker means asking git for the last commit that
 * touched a path, which needs history rather than a snapshot. A blobless
 * `--no-checkout` clone keeps the commit and tree objects that answer requires
 * while leaving the file contents on the server, so the cost stays close to a
 * shallow clone without losing path history the way `--depth` would.
 *
 * Going through git rather than a host API is what makes this work the same on
 * GitHub, GitLab, Bitbucket or a self-hosted server, over SSH or HTTPS, using
 * whatever credentials the caller already has configured.
 */
export function createGitResolver({ cloneTimeoutMs = 120_000 } = {}) {
  const clones = new Map();
  const dirs = [];

  async function clone(repo, ref) {
    const dir = await mkdtemp(join(tmpdir(), "skill-sources-"));
    dirs.push(dir);
    const base = ["clone", "--filter=blob:none", "--no-checkout", "--quiet"];

    // `--branch` only accepts a branch or tag name. A ref pinned to a commit,
    // or one that lives outside the default branch, needs the wider clone, so
    // the narrow attempt is tried first and widened only when it fails.
    if (ref) {
      try {
        await run(
          "git",
          [...base, "--branch", ref, "--single-branch", repo, dir],
          {
            timeout: cloneTimeoutMs,
          },
        );
        return dir;
      } catch (err) {
        await rm(dir, { recursive: true, force: true });

        // A commit SHA is the case widening exists for, and the remote will not
        // advertise it, so there is nothing to ask. Anything else the remote can
        // answer for directly — and a typo is not worth a full clone to find out
        // that `git log` cannot resolve it either.
        if (!looksLikeSha(ref)) {
          const state = await remoteRefState(repo, ref, cloneTimeoutMs);
          if (state === "absent")
            throw new Error(`ref '${ref}' not found in ${repo}`);
          if (state === "unreachable") throw cloneError(err, repo, ref);
        }
      }
    }

    const wider = await mkdtemp(join(tmpdir(), "skill-sources-"));
    dirs.push(wider);
    try {
      await run("git", [...base, repo, wider], { timeout: cloneTimeoutMs });
    } catch (err) {
      throw cloneError(err, repo, ref);
    }
    return wider;
  }

  function cloneOnce(repo, ref) {
    const key = `${repo} ${ref ?? ""}`;
    let pending = clones.get(key);
    if (!pending) {
      pending = clone(repo, ref);
      clones.set(key, pending);
    }
    return pending;
  }

  return {
    async resolve(upstream) {
      const { repo, path, ref } = upstream;
      const dir = await cloneOnce(repo, ref);

      // Naming the ref explicitly keeps the narrow and wide clones equivalent:
      // in the narrow case it is the checked-out branch, in the wide case it is
      // the only thing distinguishing this entry from the default branch.
      const args = ["log", "-1", "--format=%H"];
      if (ref) args.push(ref);
      args.push("--", path);

      let stdout;
      try {
        ({ stdout } = await run("git", args, {
          cwd: dir,
          timeout: cloneTimeoutMs,
        }));
      } catch (err) {
        throw new Error(
          `could not read '${ref ?? "HEAD"}' in ${repo}: ${gitReason(err)}`,
        );
      }

      const sha = stdout.trim();
      if (!sha) throw new Error(`no commits touch '${path}' in ${repo}`);
      return sha;
    },

    /**
     * `git log` answers for a path that has been renamed or deleted — it
     * returns the commit that did it — so the marker alone cannot tell the two
     * apart from an ordinary edit. Asking the tree whether the path is still
     * there can.
     *
     * `ls-tree` reads tree objects only, so it stays within what a blobless
     * clone has locally.
     */
    async exists(upstream) {
      const { repo, path, ref } = upstream;
      const dir = await cloneOnce(repo, ref);
      const { stdout } = await run(
        "git",
        ["ls-tree", "-r", "--name-only", ref ?? "HEAD", "--", path],
        { cwd: dir, timeout: cloneTimeoutMs },
      );
      return stdout.trim() !== "";
    },

    /** Clones are reused across entries in one run, then dropped together. */
    async cleanup() {
      await Promise.all(
        dirs.map((d) => rm(d, { recursive: true, force: true })),
      );
      dirs.length = 0;
      clones.clear();
    },
  };
}

/** Git object names, which no remote lists and only a wider clone can resolve. */
function looksLikeSha(ref) {
  return /^[0-9a-f]{7,40}$/i.test(ref);
}

/**
 * `--exit-code` separates the two failures that lead to different places: 2 is
 * the remote answering that it has no such ref, anything else is the remote not
 * answering at all.
 */
async function remoteRefState(repo, ref, timeout) {
  try {
    await run("git", ["ls-remote", "--exit-code", repo, ref], { timeout });
    return "present";
  } catch (err) {
    return err?.code === 2 ? "absent" : "unreachable";
  }
}

function cloneError(err, repo, ref) {
  const reason = gitReason(err);
  if (/not found in upstream|couldn't find remote ref/i.test(reason)) {
    return new Error(`ref '${ref}' not found in ${repo}`);
  }
  if (/does not exist|not found|repository .* not/i.test(reason)) {
    return new Error(`cannot read ${repo}: ${reason}`);
  }
  if (/authenticat|permission denied|access denied/i.test(reason)) {
    return new Error(`no access to ${repo} with the current credentials`);
  }
  return new Error(`cannot clone ${repo}: ${reason}`);
}

/**
 * git's own diagnosis is the useful part. The raw error carries the whole
 * command line including a temporary directory, which is noise in a report and
 * leaks local paths into CI logs.
 */
export function gitReason(err) {
  const stderr = String(err?.stderr ?? "");
  const fatal = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("warning:"))
    .map((l) => l.replace(/^fatal:\s*/i, ""));
  if (fatal.length > 0) return fatal[fatal.length - 1];
  if (err?.code === "ENOENT") return "git is not installed or not on PATH";
  return String(err?.message ?? err).split("\n")[0];
}
