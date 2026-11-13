"""Self-tests for plan_lint.py and verify_evidence.py (stdlib unittest)."""
import json
import pathlib
import shutil
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SCRIPTS = HERE.parent
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))

import plan_lint  # noqa: E402
import verify_evidence  # noqa: E402

JUNIT_OK = ('<testsuite><testcase name="ios_flow"/><testcase name="android_flow"/>'
            '</testsuite>')
JUNIT_FAIL = '<testsuite><testcase name="ios_flow"><failure/></testcase></testsuite>'


class PlanLintTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / "docs" / "BUILD_PLAN.md").read_text(encoding="utf-8")

    def test_real_plan_is_consistent(self):
        self.assertEqual(plan_lint.lint(self.text), [])

    def test_uncovered_use_case_detected(self):
        broken = self.text.replace("| A17 | P0 | host | UC13 |", "| A17 | P0 | host | - |")
        self.assertTrue(any("UC13" in p for p in plan_lint.lint(broken)))

    def test_undelivered_acceptance_detected(self):
        broken = self.text.replace("A21, A25, A31", "A21, A25")
        self.assertTrue(any("A31" in p and "not delivered" in p
                            for p in plan_lint.lint(broken)))

    def test_missing_red_part_detected(self):
        broken = self.text.replace("- **RED**: Jest tests for the OCR-result normalizer", "- **XRED**: Jest tests for the OCR-result normalizer")
        self.assertTrue(any("S0" in p and "RED" in p for p in plan_lint.lint(broken)))


class VerifyEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        (self.tmp / "docs" / "evidence" / "S0" / "junit").mkdir(parents=True)
        shutil.copy(str(ROOT / "docs" / "BUILD_PLAN.md"), str(self.tmp / "docs" / "BUILD_PLAN.md"))
        self.set_phase("BUILDING")
        (self.tmp / "src").mkdir()
        (self.tmp / "src" / "a.ts").write_text("export const a = 1;\n")

    def tearDown(self):
        shutil.rmtree(str(self.tmp), ignore_errors=True)

    def set_phase(self, phase):
        (self.tmp / "milestone-status.json").write_text(json.dumps({"phase": phase}))

    def write_summary(self, acceptance, digest=None):
        data = {"slice": "S0",
                "source_digest": digest or verify_evidence.source_digest(self.tmp),
                "acceptance": acceptance}
        (self.tmp / "docs" / "evidence" / "S0" / "summary.json").write_text(json.dumps(data))

    def write_junit(self, name, body):
        (self.tmp / "docs" / "evidence" / "S0" / "junit" / name).write_text(body)

    def test_plan_only_with_evidence_fails(self):
        self.set_phase("PLAN_ONLY")
        self.write_summary({})
        self.assertTrue(verify_evidence.verify(self.tmp))

    def test_plan_only_clean_passes(self):
        self.set_phase("PLAN_ONLY")
        self.assertEqual(verify_evidence.verify(self.tmp), [])

    def test_pass_with_junit_both_platforms_ok(self):
        self.write_junit("ios.xml", JUNIT_OK)
        self.write_junit("android.xml", JUNIT_OK)
        self.write_summary({"A02": {"status": "PASS", "tests": [
            "junit:docs/evidence/S0/junit/ios.xml::ios_flow",
            "junit:docs/evidence/S0/junit/android.xml::android_flow"]}})
        self.assertEqual(verify_evidence.verify(self.tmp), [])

    def test_pass_without_tests_rejected(self):
        self.write_summary({"A02": {"status": "PASS", "tests": []}})
        self.assertTrue(any("without any test" in p for p in verify_evidence.verify(self.tmp)))

    def test_pass_with_failing_testcase_rejected(self):
        self.write_junit("ios.xml", JUNIT_FAIL)
        self.write_junit("android.xml", JUNIT_OK)
        self.write_summary({"A02": {"status": "PASS", "tests": [
            "junit:docs/evidence/S0/junit/ios.xml::ios_flow",
            "junit:docs/evidence/S0/junit/android.xml::android_flow"]}})
        self.assertTrue(any("<failure>" in p for p in verify_evidence.verify(self.tmp)))

    def test_pass_missing_platform_rejected(self):
        self.write_junit("ios.xml", JUNIT_OK)
        self.write_summary({"A02": {"status": "PASS", "tests": [
            "junit:docs/evidence/S0/junit/ios.xml::ios_flow"]}})
        self.assertTrue(any("android test reference" in p for p in verify_evidence.verify(self.tmp)))

    def test_not_run_requires_notes(self):
        self.write_summary({"A30": {"status": "NOT_RUN"}})
        self.assertTrue(any("without notes" in p for p in verify_evidence.verify(self.tmp)))
        self.write_summary({"A30": {"status": "NOT_RUN", "notes": "no physical device"}})
        self.assertEqual(verify_evidence.verify(self.tmp), [])

    def test_stale_digest_rejected(self):
        self.write_summary({"A30": {"status": "NOT_RUN", "notes": "no device"}})
        (self.tmp / "src" / "a.ts").write_text("export const a = 2;\n")
        self.assertTrue(any("stale" in p for p in verify_evidence.verify(self.tmp)))

    def test_unknown_id_and_bad_status_rejected(self):
        self.write_summary({"A99": {"status": "PASS", "tests": ["x"]},
                            "A01": {"status": "MAYBE"}})
        probs = verify_evidence.verify(self.tmp)
        self.assertTrue(any("unknown acceptance ID A99" in p for p in probs))
        self.assertTrue(any("invalid status" in p for p in probs))

    def test_complete_phase_requires_all_ids_in_final_summary(self):
        self.set_phase("COMPLETE")
        self.write_summary({"A30": {"status": "NOT_RUN", "notes": "no device"}})
        self.assertTrue(any("COMPLETE phase" in p for p in verify_evidence.verify(self.tmp)))
        full = {a: {"status": "NOT_RUN", "notes": "n/a"} for a in verify_evidence.plan_ids(self.tmp)}
        self.write_summary(full)
        self.assertEqual(verify_evidence.verify(self.tmp), [])

    def _write_slice_summary(self, name, acceptance, digest):
        d = self.tmp / "docs" / "evidence" / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "summary.json").write_text(json.dumps(
            {"slice": name, "source_digest": digest, "acceptance": acceptance}))

    def test_old_slice_digest_is_historical_current_slice_is_enforced(self):
        # S0 evidence was produced from older code; S1 is current and fresh -> OK.
        self._write_slice_summary("S0", {"A30": {"status": "NOT_RUN", "notes": "x"}}, "old-digest")
        self._write_slice_summary("S1", {"A30": {"status": "NOT_RUN", "notes": "x"}},
                                  verify_evidence.source_digest(self.tmp))
        (self.tmp / "docs" / "evidence" / "S0" / "summary.json").exists()
        self.set_phase("BUILDING")
        probs = verify_evidence.verify(self.tmp)
        self.assertEqual([p for p in probs if "stale" in p], [])

    def test_stale_digest_on_current_slice_fails_even_with_old_slices(self):
        self._write_slice_summary("S0", {"A30": {"status": "NOT_RUN", "notes": "x"}}, "old-digest")
        self._write_slice_summary("S1", {"A30": {"status": "NOT_RUN", "notes": "x"}}, "also-old")
        self.assertTrue(any("S1/summary.json" in p and "stale" in p
                            for p in verify_evidence.verify(self.tmp)))

    def test_ready_for_merge_slice_requires_summary(self):
        (self.tmp / "milestone-status.json").write_text(json.dumps(
            {"phase": "BUILDING", "current_slice": "S1",
             "slices": {"S1": {"status": "READY_FOR_MERGE"}}}))
        self.assertTrue(any("has no docs/evidence/S1/summary.json" in p
                            for p in verify_evidence.verify(self.tmp)))

    def test_device_slices_sort_after_linux_slices(self):
        self.assertTrue(verify_evidence.slice_num("D0") > verify_evidence.slice_num("S6"))
        self._write_slice_summary("S6", {"A26": {"status": "NOT_RUN", "notes": "x"}}, "old")
        self._write_slice_summary("D0", {"A26": {"status": "NOT_RUN", "notes": "x"}},
                                  verify_evidence.source_digest(self.tmp))
        self.set_phase("DEVICE_VERIFICATION")
        self.assertEqual([p for p in verify_evidence.verify(self.tmp) if "stale" in p], [])

    def test_platform_judged_from_junit_path_not_testcase_name(self):
        # 'radios_off' contains the letters 'ios' but must not satisfy the iOS requirement.
        self.write_junit("android.xml", '<testsuite><testcase name="radios_off"/></testsuite>')
        self.write_junit("ios.xml", JUNIT_OK)
        self.write_summary({"A02": {"status": "PASS", "tests": [
            "junit:docs/evidence/S0/junit/android.xml::radios_off"]}})
        probs = verify_evidence.verify(self.tmp)
        self.assertTrue(any("ios test reference" in p for p in probs))
        self.assertEqual(verify_evidence.ref_platforms(
            "junit:docs/evidence/S0/junit/android.xml::radios_off"), {"android"})
        self.assertEqual(verify_evidence.ref_platforms(
            "junit:docs/evidence/S0/junit/radios.xml::x"), set())

    def test_video_must_be_in_manifest_with_passing_test(self):
        self.write_junit("ios.xml", JUNIT_OK)
        self.write_junit("android.xml", JUNIT_OK)
        tests = ["junit:docs/evidence/S0/junit/ios.xml::ios_flow",
                 "junit:docs/evidence/S0/junit/android.xml::android_flow"]
        self.write_summary({"A02": {"status": "PASS", "tests": tests, "videos": ["video:uc01_ios"]}})
        self.assertTrue(any("missing video" in p for p in verify_evidence.verify(self.tmp)))
        (self.tmp / "docs" / "evidence" / "video_manifest.json").write_text(json.dumps({"videos": [
            {"id": "uc01_ios", "sha256": "ab", "size_bytes": 1,
             "junit": "junit:docs/evidence/S0/junit/ios.xml::ios_flow"}]}))
        self.assertEqual(verify_evidence.verify(self.tmp), [])


if __name__ == "__main__":
    unittest.main()
