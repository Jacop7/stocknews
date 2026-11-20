"""Resume independent local checks and report the development DB activation boundary."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
CHECKS = {
    "collector": ["collector-inventory.test.ts", "collector-db-capture-v1.test.ts"],
    "ai": ["durable-analysis-input.test.ts", "analysis-run.test.ts"],
    "home-ranking": ["home-ranking.test.ts", "home-database-bound.test.ts"],
    "admin-local": ["preview-admin.test.mjs", "preview-activation-proof.test.mjs"],
}
TIMEOUT = 90


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def store_json(path, value):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     delete=False) as temporary:
        staged = Path(temporary.name)
        try:
            json.dump(value, temporary, indent=2)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary.close()
            staged.replace(path)
        finally:
            staged.unlink(missing_ok=True)


@contextmanager
def exclusive(path):
    with path.open("a+b") as handle:
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError("A local continuation run already holds the lock.") from error
        yield


def now():
    return datetime.now(timezone.utc)


def record(state, lane, status, **details):
    row = state["lanes"].setdefault(lane, {"events": []})
    row["events"].append({"status": status, "at": now().isoformat(), **details})
    row["status"] = status


def evidence_digest(log):
    with log.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def has_pass_evidence(state_dir, revision, lane, row):
    event = row["events"][-1]
    expected_name = f"{revision}-{lane}-{len(row['events']) - 1}.log"
    if event.get("log") != expected_name:
        return False
    try:
        return evidence_digest(state_dir / expected_name) == event.get("logSha256")
    except OSError:
        return False


def admin_status(checkout, observed_at):
    local = checkout / ".local-data"
    approval = local / "cloud-admin/approval.json"
    reservation = checkout / ".codex/mission-relay/c2-activation-identity/consumed.json"
    # A local reservation or approval can exist even when the remote outcome is unknown.
    if reservation.exists() or approval.exists():
        return {"status": "RECONCILE_REMOTE", "next": "Read back the dev DB activation result through the existing verifier."}
    try:
        decision = read_json(local / "cloud-admin/decision.json")
        envelope = read_json(local / "c2-activation-authority/activation-envelope.json")
        if decision is None or envelope is None:
            return {"status": "PREPARATION_REQUIRED", "next": "Prepare the existing dev DB activation envelope."}
        if not decision.get("projectRef") or decision["projectRef"] != envelope.get("projectRef"):
            raise ValueError("Activation project mismatch.")
        deadlines = [datetime.fromisoformat(decision["expiresAt"]), datetime.fromisoformat(envelope["notAfter"])]
        if any(deadline.tzinfo is None for deadline in deadlines):
            raise ValueError("Missing expiry timezone.")
    except (AttributeError, OSError, ValueError, TypeError, KeyError):
        return {"status": "CHECK_ACTIVATION_EVIDENCE", "next": "Validate the existing activation evidence."}
    if min(deadlines) - observed_at <= timedelta(minutes=36):
        return {"status": "PREPARATION_STALE", "next": "Refresh the existing read-only dev DB preparation before starting activation."}
    return {"status": "AWAITING_ACTIVATION", "next": "Use the existing dev DB activation console. Refresh this status after activation."}


def run_check(root, node, lane, log, environment):
    args = [node, "--experimental-strip-types", "--experimental-vm-modules",
            "--test", "--test-isolation=none", *[f"tests/{name}" for name in CHECKS[lane]]]
    for attempt in range(2):
        try:
            with log.open("ab") as output:
                result = subprocess.run(args, cwd=root, env=environment, stdin=subprocess.DEVNULL,
                                        stdout=output, stderr=subprocess.STDOUT, timeout=TIMEOUT)
            return ("PASSED" if result.returncode == 0 else "FAILED",
                    {"exitCode": result.returncode, "attempts": attempt + 1, "log": log.name,
                     "logSha256": evidence_digest(log)})
        except (OSError, subprocess.TimeoutExpired) as error:
            if attempt == 1:
                return "RETRYABLE", {"reason": type(error).__name__, "attempts": 2, "log": log.name}
            time.sleep(1)


def snapshot(root):
    revision = git(root, "rev-parse", "HEAD")
    dirty = bool(git(root, "status", "--porcelain", "--untracked-files=normal"))
    return revision, dirty


def resume(root, state_dir, revision, state_file, retry_failed):
    state_dir.mkdir(parents=True, exist_ok=True)
    with exclusive(state_dir / "run.lock"):
        if snapshot(root) != (revision, False):
            raise RuntimeError("Run checks from a clean checkout of the selected commit.")
        state = read_json(state_file) or {"commit": revision, "lanes": {}}
        if state["commit"] != revision:
            raise RuntimeError("Check state does not match the selected commit.")
        lanes = []
        for lane in CHECKS:
            row = state["lanes"].get(lane, {})
            previous = row.get("status")
            if previous == "PASSED":
                if has_pass_evidence(state_dir, revision, lane, row):
                    continue
                record(state, lane, "EVIDENCE_MISSING_OR_CHANGED")
            if previous == "RUNNING":
                record(state, lane, "INTERRUPTED")
            if previous == "FAILED" and not retry_failed:
                continue
            lanes.append(lane)
        if not lanes:
            return state
        environment = {k: v for k, v in os.environ.items()
                       if k.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}}
        node = shutil.which("node")
        if node is None:
            raise RuntimeError("Node.js is required for local checks.")
        version = subprocess.check_output([node, "--version"], env=environment, text=True, timeout=10).strip()
        if version != "v" + (root / ".node-version").read_text(encoding="utf-8").strip():
            raise RuntimeError("Use the Node.js version pinned in .node-version.")

        with ThreadPoolExecutor(max_workers=len(lanes)) as pool:
            jobs = {}
            for lane in lanes:
                record(state, lane, "RUNNING")
                store_json(state_file, state)
                log = state_dir / f"{revision}-{lane}-{len(state['lanes'][lane]['events'])}.log"
                jobs[pool.submit(run_check, root, node, lane, log, environment)] = lane
            for job in as_completed(jobs):
                status, details = job.result()
                if snapshot(root) != (revision, False):
                    raise RuntimeError("Checkout changed during verification. Resume from a clean commit.")
                record(state, jobs[job], status, **details)
                store_json(state_file, state)
        return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("resume", "status"))
    parser.add_argument("--retry-failed", action="store_true", help="Run a deterministic failed check again.")
    args = parser.parse_args()
    try:
        revision, dirty = snapshot(ROOT)
        git_dir = Path(git(ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"))
        checkout = git_dir.parent
        state_dir = checkout / ".local-data/development-continuation"
        state_file = state_dir / f"{revision}.json"
        if args.action == "resume":
            state = resume(ROOT, state_dir, revision, state_file, args.retry_failed)
        else:
            state = read_json(state_file) or {"commit": revision, "lanes": {}}
        lanes = {}
        for lane in CHECKS:
            row = state["lanes"].get(lane, {"status": "PENDING", "events": []})
            if row["status"] == "PASSED" and not has_pass_evidence(state_dir, revision, lane, row):
                row = {**row, "status": "EVIDENCE_MISSING_OR_CHANGED"}
            lanes[lane] = row
        report = {**state, "lanes": lanes, "checkoutDirty": dirty, "developmentDb": admin_status(checkout, now())}
        print(json.dumps(report, indent=2))
        if args.action == "resume" and any(row["status"] != "PASSED" for row in state["lanes"].values()):
            return 1
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "BLOCKED", "reason": str(error)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
