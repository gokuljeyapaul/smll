"""S4 integration tests: fictional closed-world attack simulation (A18)."""
import sys
import pathlib

PROJECT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src"))


def _directory():
    return [
        {"subject_id": "D-1", "full_name": "Mira Solen", "occupation": "Director of Lunar Logistics",
         "place_or_company": "Sylvar City", "other_clue": "Lantern Award"},
        {"subject_id": "D-2", "full_name": "Theo Arden", "occupation": "accountant",
         "place_or_company": "Northgate", "other_clue": "none"},
        {"subject_id": "D-3", "full_name": "Nadia Vale", "occupation": "teacher",
         "place_or_company": "Westmere", "other_clue": "none"},
        {"subject_id": "D-4", "full_name": "Kofi Okafor", "occupation": "engineer",
         "place_or_company": "Ashport", "other_clue": "none"},
        {"subject_id": "D-5", "full_name": "Lena Lindqvist", "occupation": "nurse",
         "place_or_company": "Fern Hollow", "other_clue": "none"},
    ]


def _sanitized_clues():
    # What an attacker sees after sanitization: leaked quasi clues
    return {"occupation": "Director of Lunar Logistics", "place": "Sylvar City"}


def test_attack_simulation_reports_rank_and_baseline():
    from coaching_privacy.attack import AttackSimulator

    sim = AttackSimulator()
    result = sim.run(
        directory=_directory(),
        sanitized_clues=_sanitized_clues(),
        true_subject_id="D-1",
    )
    # honest metrics with denominators
    assert result["directory_size"] == 5
    assert result["top1_match"] is True
    assert result["true_rank"] == 1
    assert "chance_baseline" in result
    assert result["chance_baseline"] > 0
    assert result["assumptions"], "assumptions must be documented"


def test_attack_abstains_on_no_clues():
    from coaching_privacy.attack import AttackSimulator

    sim = AttackSimulator()
    result = sim.run(directory=_directory(), sanitized_clues={}, true_subject_id="D-1")
    assert result["abstained"] is True
    assert result["top1_match"] is False


def test_attack_never_uses_gold_labels():
    """The simulator receives only sanitized-output clues + evaluator directory,
    never runtime gold labels; its API must reject gold-bearing input."""
    from coaching_privacy.attack import AttackSimulator

    sim = AttackSimulator()
    try:
        sim.run(
            directory=_directory(),
            sanitized_clues={"gold_spans": ["Mira Solen"]},  # gold leakage attempt
            true_subject_id="D-1",
        )
    except ValueError:
        pass
    else:
        raise AssertionError("gold-bearing clue input accepted")


def test_no_real_person_search():
    """The simulator is closed-world: it must not accept external lookups."""
    from coaching_privacy.attack import AttackSimulator

    sim = AttackSimulator()
    assert sim.closed_world is True
    assert not hasattr(sim, "web_search") and not hasattr(sim, "search_web")
