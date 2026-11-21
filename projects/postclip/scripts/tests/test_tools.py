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

JUNIT_OK = '<testsuite><testcase name="flow_a"/><testcase name="flow_b"/></testsuite>'
JUNIT_FAIL = '<testsuite><testcase name="flow_a"><failure/></testcase></testsuite>'
J = "docs/evidence/S0/junit/"


class PlanLintTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / "docs" / "BUILD_PLAN.md").read_text(encoding="utf-8")

    def test_real_plan_is_consistent(self):
        self.assertEqual(plan_lint.lint(self.text), [])

    def test_uncovered_use_case_detected(self):
        broken = self.text.replace("| A16 | P0 | host | UC13 |", "| A16 | P0 | host | - |")
        self.assertTrue(any("UC13" in p for p in plan_lint.lint(broken)))

    def test_undelivered_acceptance_detected(self):
        broken = self.text.replace("A20, A25, A31", "A20, A25")
        self.assertTrue(any("A31" in p and "not delivered" in p for p in plan_lint.lint(broken)))

    def test_missing_red_part_detected(self):
        broken = self.text.replace("- **RED**: Vitest for the OCR-result normalizer",
                                   "- **XRED**: Vitest for the OCR-result normalizer")
        self.assertTrue(any("S0" in p and "RED" in p for p in plan_lint.lint(broken)))

    def test_bad_platform_detected(self):
        broken = self.text.replace("| A01 | P0 | web |", "| A01 | P0 | ios |")
        self.assertTrue(any("A01" in p and "platform" in p for p in plan_lint.lint(broken)))


class ConformanceLintTests(unittest.TestCase):
    """The plan's Conformance section: owner-visual, planner-review, agent-self."""

    def setUp(self):
        self.text = (ROOT / "docs" / "BUILD_PLAN.md").read_text(encoding="utf-8")

    def test_real_plan_has_owner_and_planner_items(self):
        sec = plan_lint.split_sections(self.text)
        body = next(b for h, b in sec.items() if h.strip().lower() == "conformance")
        self.assertGreaterEqual(len(plan_lint.table_rows(body, "O")), 3)
        self.assertGreaterEqual(len(plan_lint.table_rows(body, "P")), 4)

    def test_missing_conformance_section_detected(self):
        broken = self.text.replace("## Conformance", "## Something else", 1)
        self.assertTrue(any("Conformance" in p for p in plan_lint.lint(broken)))

    def test_missing_agent_self_subsection_detected(self):
        broken = self.text.replace("### Agent-self", "### Misc", 1)
        self.assertTrue(any("Agent-self" in p for p in plan_lint.lint(broken)))

    def test_owner_item_with_unknown_reference_detected(self):
        broken = self.text.replace("| O01 |", "| O01 | UC99 |", 1) if False else self.text
        lines = broken.splitlines()
        for i, line in enumerate(lines):
            if line.startswith("| O01 |"):
                lines[i] = line.replace("UC01", "UC99").replace("UC05", "UC99").replace("UC06", "UC99")
        broken = "\n".join(lines)
        self.assertTrue(any("O01" in p and "UC99" in p for p in plan_lint.lint(broken)))

    def test_owner_item_without_any_reference_detected(self):
        lines = self.text.splitlines()
        for i, line in enumerate(lines):
            if line.startswith("| O02 |"):
                lines[i] = "| O02 | S1 | docs/evidence/S1/owner/x.md | looks fine |"
        self.assertTrue(any("O02" in p and "reference" in p for p in plan_lint.lint("\n".join(lines))))

    def test_duplicate_conformance_ids_detected(self):
        lines = self.text.splitlines()
        for i, line in enumerate(lines):
            if line.startswith("| O02 |"):
                lines[i] = line.replace("| O02 |", "| O01 |", 1)
        self.assertTrue(any("duplicate" in p and "O01" in p for p in plan_lint.lint("\n".join(lines))))

    def test_owner_item_slice_must_exist(self):
        lines = self.text.splitlines()
        for i, line in enumerate(lines):
            if line.startswith("| O03 |"):
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                cells[1] = "S9"
                lines[i] = "| " + " | ".join(cells) + " |"
        self.assertTrue(any("O03" in p and "S9" in p for p in plan_lint.lint("\n".join(lines))))


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

    def write_summary(self, acceptance, digest=None, slice_name="S0"):
        d = self.tmp / "docs" / "evidence" / slice_name
        d.mkdir(parents=True, exist_ok=True)
        (d / "summary.json").write_text(json.dumps({
            "slice": slice_name,
            "source_digest": digest or verify_evidence.source_digest(self.tmp),
            "acceptance": acceptance}))

    def write_junit(self, name, body):
        (self.tmp / "docs" / "evidence" / "S0" / "junit" / name).write_text(body)

    def both(self):
        self.write_junit("chromium.xml", JUNIT_OK)
        self.write_junit("webkit.xml", JUNIT_OK)
        return [("junit:" + J + "chromium.xml::flow_a"), ("junit:" + J + "webkit.xml::flow_a")]

    def test_plan_only_with_evidence_fails(self):
        self.set_phase("PLAN_ONLY")
        self.write_summary({})
        self.assertTrue(verify_evidence.verify(self.tmp))

    def test_plan_only_clean_passes(self):
        self.set_phase("PLAN_ONLY")
        self.assertEqual(verify_evidence.verify(self.tmp), [])

    def test_web_pass_needs_both_engines_ok(self):
        self.write_summary({"A02": {"status": "PASS", "tests": self.both()}})
        self.assertEqual(verify_evidence.verify(self.tmp), [])

    def test_pass_without_tests_rejected(self):
        self.write_summary({"A02": {"status": "PASS", "tests": []}})
        self.assertTrue(any("without any test" in p for p in verify_evidence.verify(self.tmp)))

    def test_pass_with_failing_testcase_rejected(self):
        self.write_junit("chromium.xml", JUNIT_FAIL)
        self.write_junit("webkit.xml", JUNIT_OK)
        self.write_summary({"A02": {"status": "PASS", "tests": [
            "junit:" + J + "chromium.xml::flow_a", "junit:" + J + "webkit.xml::flow_a"]}})
        self.assertTrue(any("<failure>" in p for p in verify_evidence.verify(self.tmp)))

    def test_pass_missing_engine_rejected(self):
        self.write_junit("chromium.xml", JUNIT_OK)
        self.write_summary({"A02": {"status": "PASS", "tests": ["junit:" + J + "chromium.xml::flow_a"]}})
        self.assertTrue(any("webkit test reference" in p for p in verify_evidence.verify(self.tmp)))

    def test_chromium_only_id_needs_only_chromium(self):
        self.write_junit("chromium.xml", JUNIT_OK)
        self.write_summary({"A08": {"status": "PASS", "tests": ["junit:" + J + "chromium.xml::flow_a"]}})
        self.assertEqual(verify_evidence.verify(self.tmp), [])

    def test_host_id_needs_no_engine(self):
        self.write_junit("host.xml", JUNIT_OK)
        self.write_summary({"A17": {"status": "PASS", "tests": ["junit:" + J + "host.xml::flow_a"]}})
        self.assertEqual(verify_evidence.verify(self.tmp), [])

    def test_platform_judged_from_junit_path_not_testcase_name(self):
        # a webkit-looking testcase name inside a chromium file must not satisfy webkit
        self.write_junit("chromium.xml", '<testsuite><testcase name="webkit_fallback"/></testsuite>')
        self.write_summary({"A02": {"status": "PASS", "tests": [
            "junit:" + J + "chromium.xml::webkit_fallback"]}})
        self.assertTrue(any("webkit test reference" in p for p in verify_evidence.verify(self.tmp)))
        self.assertEqual(verify_evidence.ref_platforms("junit:" + J + "chromium.xml::webkit_fallback"), {"chromium"})
        self.assertEqual(verify_evidence.ref_platforms("junit:" + J + "mywebkitish.xml::x"), set())

    def test_not_run_requires_notes(self):
        self.write_summary({"A30": {"status": "NOT_RUN"}})
        self.assertTrue(any("without notes" in p for p in verify_evidence.verify(self.tmp)))
        self.write_summary({"A30": {"status": "NOT_RUN", "notes": "no physical device"}})
        self.assertEqual(verify_evidence.verify(self.tmp), [])

    def test_stale_digest_rejected(self):
        self.write_summary({"A30": {"status": "NOT_RUN", "notes": "no device"}})
        (self.tmp / "src" / "a.ts").write_text("export const a = 2;\n")
        self.assertTrue(any("stale" in p for p in verify_evidence.verify(self.tmp)))

    def test_old_slice_digest_is_historical_current_slice_is_enforced(self):
        nr = {"A30": {"status": "NOT_RUN", "notes": "x"}}
        self.write_summary(nr, digest="old-digest", slice_name="S0")
        self.write_summary(nr, slice_name="S1")
        self.assertEqual([p for p in verify_evidence.verify(self.tmp) if "stale" in p], [])
        self.write_summary(nr, digest="also-old", slice_name="S1")
        self.assertTrue(any("S1/summary.json" in p and "stale" in p for p in verify_evidence.verify(self.tmp)))

    def test_ready_for_merge_slice_requires_summary(self):
        (self.tmp / "milestone-status.json").write_text(json.dumps(
            {"phase": "BUILDING", "current_slice": "S1", "slices": {"S1": {"status": "READY_FOR_MERGE"}}}))
        self.assertTrue(any("has no docs/evidence/S1/summary.json" in p for p in verify_evidence.verify(self.tmp)))

    def test_unknown_id_and_bad_status_rejected(self):
        self.write_summary({"A99": {"status": "PASS", "tests": ["x"]}, "A01": {"status": "MAYBE"}})
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

    def test_video_must_be_in_manifest_with_passing_test(self):
        tests = self.both()
        self.write_summary({"A02": {"status": "PASS", "tests": tests, "videos": ["video:uc01_chromium"]}})
        self.assertTrue(any("missing video" in p for p in verify_evidence.verify(self.tmp)))
        (self.tmp / "docs" / "evidence" / "video_manifest.json").write_text(json.dumps({"videos": [
            {"id": "uc01_chromium", "sha256": "ab", "size_bytes": 1, "junit": tests[0]}]}))
        self.assertEqual(verify_evidence.verify(self.tmp), [])


if __name__ == "__main__":
    unittest.main()
