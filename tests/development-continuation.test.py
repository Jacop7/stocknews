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
        with patch.object(app, "snapshot", return_value=(self.revision, False)), \
             patch.object(app.shutil, "which", return_value="node"), \
             patch.object(app.subprocess, "check_output", return_value="v24.15.0"), \
             patch.object(app, "run_check", side_effect=checks):
            return app.resume(self.root, self.state_dir, self.revision, self.state_file, retry_failed)

    @staticmethod
    def result(log, status):
        log.write_bytes(status.encode())
        return status, {"log": log.name, "logSha256": app.evidence_digest(log)}

    def test_failed_lane_runs_in_parallel_and_other_proofs_are_reused(self):
        all_started = threading.Barrier(len(app.CHECKS), timeout=5)

        def check(_root, _node, lane, log, _environment):
            all_started.wait()
            return self.result(log, "FAILED" if lane == "collector" else "PASSED")

        state = self.resume(check)
        self.assertEqual(state["lanes"]["collector"]["status"], "FAILED")
        self.assertTrue(all(state["lanes"][name]["status"] == "PASSED"
                            for name in ("ai", "home-ranking", "admin-local")))
        self.assertEqual(self.resume(lambda *_: self.fail("Check was repeated")), state)
        retried = []

        def recover(_root, _node, name, log, _environment):
            retried.append(name)
            return self.result(log, "PASSED")

        self.resume(recover, retry_failed=True)
        self.assertEqual(retried, ["collector"])

    def test_interrupted_lane_and_missing_pass_evidence_resume(self):
        state = {"commit": self.revision, "lanes": {}}
        app.record(state, "collector", "RUNNING")
        app.record(state, "ai", "RUNNING")
        app.record(state, "ai", "PASSED", log="missing.log", logSha256="invalid")
        for lane in ("home-ranking", "admin-local"):
            app.record(state, lane, "FAILED")
        app.store_json(self.state_file, state)

        def recover(_root, _node, _name, log, _environment):
            return self.result(log, "PASSED")

        state = self.resume(recover)
        for name, event in (("collector", "INTERRUPTED"), ("ai", "EVIDENCE_MISSING_OR_CHANGED")):
            self.assertIn(event, [row["status"] for row in state["lanes"][name]["events"]])
            self.assertEqual(state["lanes"][name]["status"], "PASSED")

    def test_duplicate_process_cannot_acquire_lock_and_exit_releases_it(self):
        lock = self.state_dir / "run.lock"
        with app.exclusive(lock):
            with self.assertRaisesRegex(RuntimeError, "already holds"):
                with app.exclusive(lock):
                    self.fail("Duplicate runner acquired the lock")
        with app.exclusive(lock):
            pass

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
