"""tools/gen_issues.py: slice issues generated from any project's BUILD_PLAN.md (dry run by default)."""
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
TOOLS = HERE.parent
REPO_ROOT = TOOLS.parent
SCRIPTS = TOOLS
PROJECT = "postclip"
PLAN = REPO_ROOT / "projects" / PROJECT / "docs" / "BUILD_PLAN.md"
sys.path.insert(0, str(TOOLS))
import gen_issues  # noqa: E402

MINI_PLAN = """# BUILD_PLAN - demo

## Slices

### S0 - First thing
**Acceptance IDs:** A01, A02
Observable result: the first thing works.
- **RED**: x
- **GREEN**: y
- **Evidence**: z

### S1 - Second thing
**Acceptance IDs:** A03
Observable result: the second thing works.
"""


class GenIssuesTests(unittest.TestCase):
    def setUp(self):
        self.text = PLAN.read_text(encoding="utf-8")
        self.issues = gen_issues.build_issues(PROJECT, self.text)

    def test_epic_plus_one_issue_per_slice(self):
        titles = [i["title"] for i in self.issues]
        # One issue per plan slice, by construction: the slice list is read
        # from the plan itself (postclip grew from S0-S6 to S7+ in round 2;
        # the count follows the plan instead of a hardcoded 8).
        slices = re.findall(r"(?m)^### (S\d+) ", self.text)
        self.assertGreater(len(slices), 0)
        self.assertEqual(len(self.issues), len(slices) + 1)
        self.assertTrue(titles[0].startswith("postclip: deliver all slices"))
        for sid in slices:
            self.assertTrue(any(t.startswith("postclip %s" % sid) for t in titles), sid)

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
            r = subprocess.run([sys.executable, str(TOOLS / "gen_issues.py"), "--project", PROJECT],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               universal_newlines=True, env=env)
            self.assertEqual(r.returncode, 0, r.stdout)
            self.assertIn("postclip S6", r.stdout)
            self.assertFalse(log.exists(), "gh was called in dry-run")

    def test_create_requires_explicit_flag_and_repo(self):
        r = subprocess.run([sys.executable, str(TOOLS / "gen_issues.py"), "--project", PROJECT, "--create"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--repo", r.stdout)

    def test_create_makes_labels_then_slices_then_epic_and_links_blockers(self):
        with tempfile.TemporaryDirectory() as d:
            fake = pathlib.Path(d) / "gh"
            log = pathlib.Path(d) / "calls.log"
            counter = pathlib.Path(d) / "n"
            counter.write_text("100")
            fake.write_text(
                "#!/bin/sh\n"
                "echo \"$@\" | tr '\\n' ' ' >> %s; echo >> %s\n"
                "case \"$*\" in\n"
                "  *repos/o/r/labels*) exit 0 ;;\n"
                "  *--jq*) n=$(cat %s); n=$((n+1)); echo $n > %s; echo $n ;;\n"
                "esac\n" % (log, log, counter, counter))
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
            env = dict(os.environ, PATH=d + os.pathsep + os.environ["PATH"])
            r = subprocess.run([sys.executable, str(TOOLS / "gen_issues.py"), "--project", PROJECT, "--create", "--repo", "o/r"],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, env=env)
            self.assertEqual(r.returncode, 0, r.stdout)
            calls = log.read_text().splitlines()
            kinds = ["label" if c.split()[1].endswith("/labels") else "issue" for c in calls]
            first_issue = kinds.index("issue")
            self.assertTrue(all(k == "label" for k in kinds[:first_issue]), kinds)
            n_slices = len(re.findall(r"(?m)^### (S\d+) ", self.text))
            self.assertGreater(n_slices, 0)
            self.assertEqual(kinds.count("issue"), n_slices + 1)
            # S1's body links S0's real number (101), and the epic is created last and links all slices.
            s1 = next(c for c in calls if "title=postclip S1" in c)
            self.assertIn("Blocked by: #101 (postclip S0)", s1)
            self.assertIn("title=postclip: deliver all slices", calls[-1])
            for n in range(101, 101 + n_slices):
                self.assertIn("#%d postclip S" % n, calls[-1])
            self.assertIn("labels[]=ready", next(c for c in calls if "title=postclip S0" in c))
            self.assertNotIn("labels[]=ready", s1)

    def test_works_for_any_project_with_the_common_plan_shape(self):
        issues = gen_issues.build_issues("demo", MINI_PLAN)
        titles = [i["title"] for i in issues]
        self.assertEqual(titles[0], "demo: deliver all slices (S0\u2013S1)")
        self.assertEqual(titles[1:], ["demo S0 \u2014 First thing", "demo S1 \u2014 Second thing"])
        self.assertIn("demo", issues[1]["labels"])
        self.assertIn("ready", issues[1]["labels"])
        self.assertNotIn("ready", issues[2]["labels"])
        self.assertIn("A01, A02", issues[1]["body"])
        self.assertIn("projects/demo/docs/BUILD_PLAN.md", issues[1]["body"])
        self.assertNotIn("Owner-visual", issues[1]["body"])  # no Conformance section: nothing invented

    def test_project_is_required_and_must_exist(self):
        r = subprocess.run([sys.executable, str(TOOLS / "gen_issues.py")],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        self.assertNotEqual(r.returncode, 0)
        r = subprocess.run([sys.executable, str(TOOLS / "gen_issues.py"), "--project", "no-such-project"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no-such-project", r.stdout)

    def test_plan_without_slices_is_an_error(self):
        with self.assertRaises(ValueError):
            gen_issues.build_issues("demo", "# plan\n\n## Purpose\nnothing\n")


if __name__ == "__main__":
    unittest.main()
