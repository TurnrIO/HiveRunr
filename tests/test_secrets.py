import os
from unittest.mock import patch

from app.core import secrets


def test_strip_interactive_prompt_keeps_clean_values():
    assert secrets._strip_interactive_prompt("APP_URL", "https://example.com") == "https://example.com"
    assert secrets._strip_interactive_prompt("API_KEY", "abc123") == "abc123"


def test_strip_interactive_prompt_recovers_prompt_polluted_values():
    assert (
        secrets._strip_interactive_prompt(
            "APP_URL",
            "  APP_URL (public URL used in email links — press Enter to keep localhost) [http://localhost]: http://localhost",
        )
        == "http://localhost"
    )
    assert (
        secrets._strip_interactive_prompt(
            "APP_TIMEZONE",
            "  APP_TIMEZONE (IANA timezone for the scheduler UI, e.g. Europe/London) [UTC]: Europe/Berlin",
        )
        == "Europe/Berlin"
    )
    assert (
        secrets._strip_interactive_prompt(
            "API_KEY",
            "  API_KEY (leave blank to auto-generate): ",
        )
        == ""
    )


def test_normalize_interactive_env_repairs_known_keys_only():
    with patch.dict(
        os.environ,
        {
            "APP_URL": "APP_URL (public URL used in email links — press Enter to keep localhost) [http://localhost]: https://example.com",
            "APP_TIMEZONE": "APP_TIMEZONE (IANA timezone for the scheduler UI, e.g. Europe/London) [UTC]: Europe/Berlin",
            "API_KEY": "API_KEY (leave blank to auto-generate): ",
            "DATABASE_URL": "postgresql://clean-value",
        },
        clear=True,
    ):
        secrets._normalize_interactive_env()
        assert os.environ["APP_URL"] == "https://example.com"
        assert os.environ["APP_TIMEZONE"] == "Europe/Berlin"
        assert os.environ["API_KEY"] == ""
        assert os.environ["DATABASE_URL"] == "postgresql://clean-value"
