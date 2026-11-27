"""A24 (config side): limits load, defaults, and refusal of out-of-range values."""


def test_defaults_load_and_validate():
    from folderchat.config import load_limits

    limits = load_limits()
    assert limits.max_file_mb == 50
    assert limits.max_question_chars == 1000
    assert limits.retrieve_top_k == 8


def test_out_of_range_limit_refused_at_startup(tmp_path, monkeypatch):
    import textwrap

    import pytest

    from folderchat.config import ConfigError, load_limits

    bad = tmp_path / "limits.yaml"
    bad.write_text(textwrap.dedent("""\
        max_file_mb: 5000
    """))
    monkeypatch.setenv("FOLDERCHAT_LIMITS", str(bad))
    with pytest.raises(ConfigError, match="max_file_mb"):
        load_limits()


def test_upper_boundary_is_inclusive(tmp_path, monkeypatch):
    import textwrap

    from folderchat.config import load_limits

    good = tmp_path / "limits.yaml"
    good.write_text(textwrap.dedent("""\
        max_file_mb: 50
        max_pages: 500
        max_question_chars: 1000
    """))
    monkeypatch.setenv("FOLDERCHAT_LIMITS", str(good))
    limits = load_limits()
    assert limits.max_file_mb == 50 and limits.max_pages == 500


def test_unknown_key_refused(tmp_path, monkeypatch):

    import pytest

    from folderchat.config import ConfigError, load_limits

    bad = tmp_path / "limits.yaml"
    bad.write_text("nonsense_key: 1\n")
    monkeypatch.setenv("FOLDERCHAT_LIMITS", str(bad))
    with pytest.raises(ConfigError):
        load_limits()


def test_languages_config_loads():
    from folderchat.config import load_languages

    langs = load_languages()
    assert langs.default == "en"
    assert langs.languages["en"]["enabled"] is True
