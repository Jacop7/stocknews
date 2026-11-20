import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import unittest
from unittest.mock import patch


source = Path(__file__).resolve().parents[1] / "scripts/development-continuation.py"
spec = importlib.util.spec_from_file_location("development_continuation", source)
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class ContinuationTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state_dir = self.root / "state"
        self.state_dir.mkdir()
        self.revision = "a" * 40
        self.state_file = self.state_dir / f"{self.revision}.json"
        (self.root / ".node-version").write_text("24.15.0", encoding="utf-8")

    def resume(self, checks, retry_failed=False):
        def receive(root, state_dir, revision, lane, attempt):
            log = state_dir / f"{revision}-{lane}-{attempt}.log"
            status, details = checks(root, lane, log)
            return {"status": status, "details": details, "attempt": attempt}

        with patch.object(app, "snapshot", return_value=(self.revision, False)), \
             patch.object(app, "wait_for_check", side_effect=receive):
            return app.resume(self.root, self.state_dir, self.revision, self.state_file, retry_failed)

    @staticmethod
    def result(log, status):
        log.write_bytes(status.encode())
        return status, {"log": log.name, "logSha256": app.evidence_digest(log)}

    def test_failed_lane_runs_in_parallel_and_other_proofs_are_reused(self):
        all_started = threading.Barrier(len(app.CHECKS), timeout=5)

        def check(_root, lane, log):
            all_started.wait()
            return self.result(log, "FAILED" if lane == "collector" else "PASSED")

        state = self.resume(check)
        self.assertEqual(state["lanes"]["collector"]["status"], "FAILED")
        self.assertTrue(all(state["lanes"][name]["status"] == "PASSED"
                            for name in ("ai", "home-ranking", "admin-local")))
        self.assertEqual(self.resume(lambda *_: self.fail("Check was repeated")), state)
        retried = []

        def recover(_root, name, log):
            retried.append(name)
            return self.result(log, "PASSED")

        self.resume(recover, retry_failed=True)
        self.assertEqual(retried, ["collector"])

    def test_interrupted_lane_and_missing_pass_evidence_resume(self):
        state = {"commit": self.revision, "lanes": {}}
        app.record(state, "collector", "RUNNING", attempt=1)
        app.record(state, "ai", "RUNNING", attempt=1)
        app.record(state, "ai", "PASSED", attempt=1, log="missing.log", logSha256="invalid")
        for lane in ("home-ranking", "admin-local"):
            app.record(state, lane, "FAILED")
        app.store_json(self.state_file, state)

        def recover(_root, _name, log):
            return self.result(log, "PASSED")

        state = self.resume(recover)
        self.assertEqual([event["attempt"] for event in state["lanes"]["collector"]["events"]], [1, 1])
        self.assertIn("EVIDENCE_MISSING_OR_CHANGED", [row["status"] for row in state["lanes"]["ai"]["events"]])
        self.assertTrue(all(state["lanes"][name]["status"] == "PASSED" for name in ("collector", "ai")))

    def test_new_supervisor_joins_existing_worker_and_collects_result_without_spawning(self):
        state = {"commit": self.revision, "lanes": {}}
        app.record(state, "collector", "RUNNING", attempt=1)
        app.store_json(self.state_file, state)
        prefix = self.state_dir / f"{self.revision}-collector-1"
        with app.exclusive(prefix.with_suffix(".lock")):
            self.assertEqual(app.check_worker(self.root, self.state_dir, self.revision, "collector", 1), 3)
        status, details = self.result(prefix.with_suffix(".log"), "PASSED")
        app.store_json(prefix.with_suffix(".result.json"), {"status": status, "details": details, "attempt": 1})
        with patch.object(app.subprocess, "Popen") as launch:
            result = app.wait_for_check(self.root, self.state_dir, self.revision, "collector", 1)
            launch.assert_not_called()
        self.assertEqual(result["status"], "PASSED")

    def test_duplicate_process_cannot_acquire_lock_and_exit_releases_it(self):
        lock = self.state_dir / "run.lock"
        with app.exclusive(lock):
            with self.assertRaisesRegex(RuntimeError, "already holds"):
                with app.exclusive(lock):
                    self.fail("Duplicate runner acquired the lock")
        with app.exclusive(lock):
            pass

    def test_node_child_retains_attempt_lock_after_worker_lock_handle_closes(self):
        lock_path = self.state_dir / "child.lock"
        command = [app.sys.executable, "-c", "import time; time.sleep(30)"]
        with app.exclusive(lock_path) as lock, app.inherited_lock(lock) as options:
            child = app.subprocess.Popen(command, stderr=app.subprocess.DEVNULL, **options)
        try:
            with self.assertRaises(app.LockBusy):
                with app.exclusive(lock_path):
                    self.fail("Worker's child did not retain the lock")
        finally:
            child.kill()
            child.wait(timeout=5)
        with app.exclusive(lock_path):
            pass

    def test_missing_proof_at_reporting_time_returns_nonzero(self):
        state = {"commit": self.revision, "lanes": {}}
        for lane in app.CHECKS:
            app.record(state, lane, "PASSED", attempt=1, log="missing.log", logSha256="missing")
        with patch.object(app, "snapshot", return_value=(self.revision, False)), \
             patch.object(app, "state_location", return_value=(self.root, self.state_dir)), \
             patch.object(app, "resume", return_value=state), \
             patch.object(app.sys, "argv", ["development-continuation", "resume"]), \
             patch("builtins.print"):
            self.assertEqual(app.main(), 1)

    def test_transient_timeout_is_bounded_then_retried(self):
        timeout = app.subprocess.TimeoutExpired("node", 1)
        with patch.object(app.subprocess, "run", side_effect=[timeout, timeout]) as invocation, \
             patch.object(app.time, "sleep"):
            status, detail = app.run_check(self.root, "node", "ai", self.root / "test.log", {})
        self.assertEqual((status, detail["attempts"], invocation.call_count), ("RETRYABLE", 2, 2))

    def test_activation_wait_stale_and_attempt_are_distinct(self):
        local = self.root / ".local-data"
        decision = local / "cloud-admin/decision.json"
        envelope = local / "c2-activation-authority/activation-envelope.json"
        observed = datetime(2026, 11, 20, tzinfo=timezone.utc)
        self.assertEqual(app.admin_status(self.root, observed)["status"], "PREPARATION_REQUIRED")
        for path, deadline_field in ((decision, "expiresAt"), (envelope, "notAfter")):
            path.parent.mkdir(parents=True)
            app.store_json(path, {"projectRef": "dev", deadline_field: (observed + timedelta(hours=1)).isoformat()})
        self.assertEqual(app.admin_status(self.root, observed)["status"], "AWAITING_ACTIVATION")
        self.assertEqual(app.admin_status(self.root, observed + timedelta(minutes=24))["status"],
                         "PREPARATION_STALE")
        decision.with_name("approval.json").touch()
        self.assertEqual(app.admin_status(self.root, observed)["status"], "RECONCILE_REMOTE")


if __name__ == "__main__":
    unittest.main()
