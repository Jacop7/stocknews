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
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
CHECKS = {
    "collector": ["collector-inventory.test.ts", "collector-db-capture-v1.test.ts"],
    "ai": ["durable-analysis-input.test.ts", "analysis-run.test.ts"],
    "home-ranking": ["home-ranking.test.ts", "home-database-bound.test.ts"],
    "admin-local": ["preview-admin-sql.test.mjs"],
}
TIMEOUT = 90
WORKER_WAIT = 2 * (TIMEOUT + 10) + 35


class LockBusy(RuntimeError):
    pass


def git(root, *args):
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
    return subprocess.check_output(["git", "-C", str(root), *args], env=env,
                                   text=True, timeout=10).strip()


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def store_json(path, value):
    descriptor, name = tempfile.mkstemp(dir=path.parent)
    staged = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
            json.dump(value, temporary, indent=2)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        staged.replace(path)
    finally:
        staged.unlink(missing_ok=True)


@contextmanager
def exclusive(path):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        create_file = kernel.CreateFileW
        create_file.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        create_file.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        generic_read_write = 0xC0000000
        open_always, file_attribute_normal = 4, 0x80
        handle = create_file(str(path), generic_read_write, 0, None, open_always, file_attribute_normal, None)
        if handle == ctypes.c_void_p(-1).value:
            error = ctypes.get_last_error()
            if error in (32, 33):
                raise LockBusy("A local continuation run already holds the lock.")
            raise ctypes.WinError(error)
        try:
            yield handle
        finally:
            kernel.CloseHandle(handle)
        return

    import fcntl

    with path.open("a+b") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise LockBusy("A local continuation run already holds the lock.") from error
        yield handle.fileno()


@contextmanager
def inherited_lock(lock):
    if lock is None:
        yield {}
    elif os.name == "nt":
        os.set_handle_inheritable(lock, True)
        try:
            yield {"startupinfo": subprocess.STARTUPINFO(lpAttributeList={"handle_list": [lock]})}
        finally:
            os.set_handle_inheritable(lock, False)
    else:
        yield {"pass_fds": (lock,)}


def protect_windows_worker():
    """Keep the job handle in this worker until process exit."""
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [
            ("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
            ("flags", wintypes.DWORD), ("working_set_min", ctypes.c_size_t),
            ("working_set_max", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
            ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD),
        ]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [
            ("basic", BasicLimits), ("io_counters", ctypes.c_uint64 * 6),
            ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
            ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = ExtendedLimits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    extended_limit_information = 9
    if (not kernel.SetInformationJobObject(job, extended_limit_information, ctypes.byref(limits), ctypes.sizeof(limits))
            or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess())):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise ctypes.WinError(error)
    # The OS closes the non-inheritable handle and terminates the job's children
    # even if this process never reaches Python cleanup.


def now():
    return datetime.now(timezone.utc)


def record(state, lane, status, **details):
    row = state["lanes"].setdefault(lane, {"events": []})
    row["events"].append({"status": status, "at": now().isoformat(), **details})
    row["status"] = status
    row.pop("next", None)


def evidence_digest(log):
    with log.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def has_pass_evidence(state_dir, revision, lane, row):
    event = row["events"][-1]
    expected_name = f"{revision}-{lane}-{event['attempt']}.log"
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


def run_check(root, node, lane, log, environment, lock=None):
    args = [node, "--experimental-strip-types", "--experimental-vm-modules",
            "--test", "--test-isolation=none", "--test-timeout=60000",
            *[f"tests/{name}" for name in CHECKS[lane]]]
    # On POSIX, the independent timeout process retains the check's deadline
    # after an unexpected worker exit. Windows uses the worker's Job Object.
    watchdog = None
    if os.name != "nt":
        watchdog = shutil.which("gtimeout") or shutil.which("timeout")
        if watchdog is None:
            return "RETRYABLE", {"reason": "GNU_TIMEOUT_REQUIRED"}
        args = [watchdog, "--kill-after=5s", f"{TIMEOUT}s", *args]
    for attempt in range(2):
        descriptor, name = tempfile.mkstemp(prefix=log.stem + "-", suffix=".raw", dir=log.parent)
        raw_output = Path(name)
        try:
            with os.fdopen(descriptor, "wb") as output, inherited_lock(lock) as options:
                result = subprocess.run(args, cwd=root, env=environment, stdin=subprocess.DEVNULL,
                                        stdout=output, stderr=subprocess.STDOUT,
                                        timeout=TIMEOUT + 10 if watchdog else TIMEOUT, **options)
            if watchdog and result.returncode in (124, 137):
                raise subprocess.TimeoutExpired(args, TIMEOUT)
            # Copy a snapshot so delayed output in a descendant cannot change a recorded proof.
            shutil.copyfile(raw_output, log)
            return ("PASSED" if result.returncode == 0 else "FAILED",
                    {"exitCode": result.returncode, "attempts": attempt + 1, "log": log.name,
                     "logSha256": evidence_digest(log)})
        except (OSError, subprocess.TimeoutExpired) as error:
            if attempt == 1:
                return "RETRYABLE", {"reason": type(error).__name__, "attempts": 2}
            time.sleep(1)
        finally:
            try:
                raw_output.unlink(missing_ok=True)
            except PermissionError:
                # A timed-out child's descendant can still own the raw output handle on Windows.
                pass


def snapshot(root):
    revision = git(root, "rev-parse", "HEAD")
    dirty = bool(git(root, "status", "--porcelain", "--untracked-files=normal"))
    return revision, dirty


def state_location(root):
    checkout = Path(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")).parent
    return checkout, checkout / ".local-data/development-continuation"


def local_test_environment():
    keys = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT"}
    return {key: value for key, value in os.environ.items() if key.upper() in keys}


def check_worker(root, state_dir, revision, lane, attempt):
    state = read_json(state_dir / f"{revision}.json")
    row = state and state["lanes"].get(lane)
    if not row or row["status"] != "RUNNING" or row["events"][-1]["attempt"] != attempt:
        return 2
    prefix = state_dir / f"{revision}-{lane}-{attempt}"
    receipt = prefix.with_suffix(".result.json")
    try:
        with exclusive(prefix.with_suffix(".lock")) as lock:
            if receipt.is_file():
                return 0
            if snapshot(root) != (revision, False):
                return 2
            env = local_test_environment()
            node = shutil.which("node")
            if node is None:
                store_json(receipt, {"status": "RETRYABLE", "attempt": attempt,
                                     "details": {"reason": "NODE_NOT_FOUND"}})
                return 0
            version = subprocess.check_output([node, "--version"], env=env, text=True, timeout=10).strip()
            if version != "v" + (root / ".node-version").read_text(encoding="utf-8").strip():
                store_json(receipt, {"status": "RETRYABLE", "attempt": attempt,
                                     "details": {"reason": "PINNED_NODE_REQUIRED"}})
                return 0
            status, details = run_check(root, node, lane, prefix.with_suffix(".log"), env, lock)
            if snapshot(root) != (revision, False):
                return 2
            store_json(receipt, {"status": status, "details": details, "attempt": attempt})
            return 0
    except LockBusy:
        return 3


def finish_worker(root, state_dir, revision, lane, attempt):
    deadline = time.monotonic() + WORKER_WAIT
    while time.monotonic() < deadline:
        result = check_worker(root, state_dir, revision, lane, attempt)
        if result != 3:
            return result
        time.sleep(0.5)
    return 3


def wait_for_check(root, state_dir, revision, lane, attempt):
    receipt = state_dir / f"{revision}-{lane}-{attempt}.result.json"
    deadline = time.monotonic() + WORKER_WAIT
    worker = None
    restarted = False
    while time.monotonic() < deadline:
        result = read_json(receipt)
        if result is not None:
            return result
        if worker is None:
            command = [sys.executable, "-B", str(Path(__file__).resolve()), "_worker",
                       "--revision", revision, "--lane", lane, "--attempt", str(attempt)]
            options = {"creationflags": subprocess.DETACHED_PROCESS} if os.name == "nt" else {"start_new_session": True}
            worker = subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, **options)
        elif worker.poll() not in (None, 0, 3):
            if restarted:
                return None
            restarted, worker = True, None
        time.sleep(0.25)
    return None


def resume(root, state_dir, revision, state_file, retry_failed):
    state_dir.mkdir(parents=True, exist_ok=True)
    with exclusive(state_dir / "run.lock"):
        if snapshot(root) != (revision, False):
            raise RuntimeError("Run checks from a clean checkout of the selected commit.")
        state = read_json(state_file) or {"commit": revision, "lanes": {}}
        if state["commit"] != revision:
            raise RuntimeError("Check state does not match the selected commit.")
        lanes = {}
        for lane in CHECKS:
            row = state["lanes"].get(lane, {})
            previous = row.get("status")
            if previous == "PASSED":
                if has_pass_evidence(state_dir, revision, lane, row):
                    continue
                record(state, lane, "EVIDENCE_MISSING_OR_CHANGED")
            if previous == "RUNNING":
                lanes[lane] = row["events"][-1]["attempt"]
                continue
            if previous == "FAILED" and not retry_failed:
                continue
            attempt = sum(event["status"] == "RUNNING" for event in row.get("events", [])) + 1
            record(state, lane, "RUNNING", attempt=attempt)
            lanes[lane] = attempt
        if not lanes:
            return state
        store_json(state_file, state)
        with ThreadPoolExecutor(max_workers=len(lanes)) as pool:
            jobs = {pool.submit(wait_for_check, root, state_dir, revision, lane, attempt): lane
                    for lane, attempt in lanes.items()}
            for job in as_completed(jobs):
                lane = jobs[job]
                try:
                    result = job.result()
                except (OSError, ValueError):
                    result = None
                if result is None:
                    # Keep this attempt ID so the next run can join an existing worker.
                    state["lanes"][lane]["next"] = "Resume to collect this attempt or restart its worker."
                    store_json(state_file, state)
                    continue
                if snapshot(root) != (revision, False):
                    raise RuntimeError("Checkout changed during verification. Resume from a clean commit.")
                if result["attempt"] != lanes[lane]:
                    raise RuntimeError("Worker result does not match the current attempt.")
                record(state, lane, result["status"], attempt=result["attempt"], **result["details"])
                store_json(state_file, state)
        return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("resume", "status", "_worker"))
    parser.add_argument("--retry-failed", action="store_true", help="Run a deterministic failed check again.")
    parser.add_argument("--revision", help=argparse.SUPPRESS)
    parser.add_argument("--lane", choices=CHECKS, help=argparse.SUPPRESS)
    parser.add_argument("--attempt", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        revision, dirty = snapshot(ROOT)
        checkout, state_dir = state_location(ROOT)
        if args.action == "_worker":
            if args.revision != revision or not args.lane or not args.attempt or args.attempt < 1 or dirty:
                return 2
            if os.name == "nt":
                protect_windows_worker()
            return finish_worker(ROOT, state_dir, revision, args.lane, args.attempt)
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
        if args.action == "resume" and any(row["status"] != "PASSED" for row in lanes.values()):
            return 1
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "BLOCKED", "reason": str(error)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
