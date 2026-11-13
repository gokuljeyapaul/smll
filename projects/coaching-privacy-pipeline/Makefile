.PHONY: setup test test-fast demo verify
setup:
	bash scripts/setup.sh
test:
	bash scripts/test.sh
test-fast:
	.venv/bin/python -m pytest -m fast -q
demo:
	bash scripts/demo.sh
verify:
	bash scripts/verify.sh
