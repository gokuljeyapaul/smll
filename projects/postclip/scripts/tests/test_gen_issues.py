"""gen_issues.py: slice issues generated from BUILD_PLAN.md (dry-run by default)."""
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SCRIPTS = HERE.parent
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))
import gen_issues  # noqa: E402


class GenIssuesTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / "docs" / "BUILD_PLAN.md").read_text(encoding="utf-8")
        self.issues = gen_issues.build_issues(self.text)

    def test_epic_plus_one_issue_per_slice(self):
        titles = [i["title"] for i in self.issues]
        self.assertEqual(len(self.issues), 8)
        self.assertTrue(titles[0].startswith("postclip: build the web app"))
        for n in range(7):
            self.assertTrue(any(t.startswith("postclip S%d" % n) for t in titles), n)

    def test_slice_issue_carries_acceptance_ids_plan_link_and_done_checklist(self):
        s0 = next(i for i in self.issues if i["title"].startswith("postclip S0"))
        self.assertIn("A01", s0["body"])
        self.assertIn("docs/BUILD_PLAN.md", s0["body"])
        self.assertIn("- [ ]", s0["body"])
        self.assertIn("proof", s0["body"].lower())

    def test_only_first_slice_is_ready_and_later_ones_list_blockers(self):
        s0 = next(i for i in self.issues if i["title"].startswith("postclip S0"))
        s1 = next(i for i in self.issues if i["title"].startswith("postclip S1"))
        self.assertIn("ready", s0["labels"])
        self.assertNotIn("ready", s1["labels"])
        self.assertIn("Blocked by: postclip S0", s1["body"])

    def test_owner_visual_items_are_listed_in_their_slice(self):
        s0 = next(i for i in self.issues if i["title"].startswith("postclip S0"))
        s6 = next(i for i in self.issues if i["title"].startswith("postclip S6"))
        self.assertIn("O01", s0["body"])
        self.assertNotIn("O06", s0["body"])
        self.assertIn("O06", s6["body"])

    def test_every_acceptance_id_appears_in_exactly_the_slices_that_deliver_it(self):
        import re
        ids = set(re.findall(r"(?m)^\| (A\d{2}) \|", self.text))
        seen = set()
        for i in self.issues[1:]:
            seen |= set(re.findall(r"\bA\d{2}\b", i["body"].split("## Definition of done")[0]))
        self.assertEqual(ids - seen, set())

    def test_dry_run_prints_and_never_calls_gh(self):
        with tempfile.TemporaryDirectory() as d:
            fake = pathlib.Path(d) / "gh"
            log = pathlib.Path(d) / "calls.log"
            fake.write_text("#!/bin/sh\necho called >> %s\n" % log)
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
            env = dict(os.environ, PATH=d + os.pathsep + os.environ["PATH"])
            r = subprocess.run([sys.executable, str(SCRIPTS / "gen_issues.py")],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               universal_newlines=True, env=env)
            self.assertEqual(r.returncode, 0, r.stdout)
            self.assertIn("postclip S6", r.stdout)
            self.assertFalse(log.exists(), "gh was called in dry-run")

    def test_create_requires_explicit_flag_and_repo(self):
        r = subprocess.run([sys.executable, str(SCRIPTS / "gen_issues.py"), "--create"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--repo", r.stdout)


if __name__ == "__main__":
    unittest.main()
