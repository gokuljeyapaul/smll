"""S3 offline GLiNER proof: load + inference with all network egress blocked."""
import socket

# Import first (torch/ssl need real socket at import time)
from gliner import GLiNER


class _Blocked:
    def __init__(self, *a, **k):
        raise OSError("network disabled for offline proof")


socket.socket = _Blocked
socket.create_connection = _Blocked
socket.getaddrinfo = _Blocked

model = GLiNER.from_pretrained("models/gliner_medium-v2.1", local_files_only=True)
model.eval()
text = ("I lead a small team at Auricwood Labs near Sylvar City "
        "and won the Lantern Award in April.")
ents = model.predict_entities(
    text, labels=["employer", "location", "award", "team size"], threshold=0.4
)
for e in ents:
    print(round(e["score"], 3), e["text"], e["label"])
print("OFFLINE_GLINER_PROOF_OK")
