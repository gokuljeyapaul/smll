"""S4 demo: fictional closed-world attack simulation with honest metrics."""
import sys

sys.path.insert(0, "src")
from coaching_privacy.attack import AttackSimulator

directory = [
    {"subject_id": "D-1", "full_name": "Mira Solen",
     "occupation": "Director of Lunar Logistics",
     "place_or_company": "Sylvar City", "other_clue": "Lantern Award"},
] + [
    {"subject_id": f"D-{i}", "full_name": f"Person {i}",
     "occupation": "ordinary role", "place_or_company": "fictional town",
     "other_clue": "none"}
    for i in range(2, 51)
]

sim = AttackSimulator()
result = sim.run(
    directory=directory,
    sanitized_clues={
        "occupation": "Director of Lunar Logistics",
        "place": "Sylvar City",
    },
    true_subject_id="D-1",
)
print("directory_size:", result["directory_size"])
print("top1_match:", result["top1_match"],
      "| true_rank:", result["true_rank"],
      "| chance_baseline:", result["chance_baseline"])

abstain = sim.run(directory=directory, sanitized_clues={}, true_subject_id="D-1")
print("abstain case -> abstained:", abstain["abstained"],
      "top1:", abstain["top1_match"])
print("ATTACK_DEMO_OK")
