"""Unit tests for credential encryption (app/crypto.py)."""
import pytest
import app.crypto as _crypto_mod


@pytest.fixture(autouse=True)
def reset_fernet():
    """Reset the lazy Fernet singleton before and after every test."""
    _crypto_mod._fernet = None
    yield
    _crypto_mod._fernet = None


# A valid 32-byte URL-safe base64 key for use in tests.
_TEST_KEY = "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ="


class TestEncryptDecrypt:
    def test_roundtrip(self, monkeypatch):
        monkeypatch.setenv("SECRET_KEY", _TEST_KEY)
        from app.crypto import encrypt, decrypt
        plaintext = "super-secret-api-key-12345"
        token = encrypt(plaintext)
        assert decrypt(token) == plaintext

    def test_token_has_fernet_prefix(self, monkeypatch):
        monkeypatch.setenv("SECRET_KEY", _TEST_KEY)
        from app.crypto import encrypt
        assert encrypt("anything").startswith("gAAAAA")

    def test_different_plaintexts_produce_different_tokens(self, monkeypatch):
        monkeypatch.setenv("SECRET_KEY", _TEST_KEY)
        from app.crypto import encrypt
        # Fernet includes a timestamp + random IV, so two calls differ
        assert encrypt("a") != encrypt("a")

    def test_legacy_plaintext_passthrough(self):
        """Values that don't start with the Fernet prefix are returned as-is."""
        from app.crypto import decrypt
        assert decrypt("plaintext-password") == "plaintext-password"

    def test_empty_string_passthrough(self):
        from app.crypto import decrypt
        assert decrypt("") == ""

    def test_wrong_key_raises(self, monkeypatch):
        monkeypatch.setenv("SECRET_KEY", _TEST_KEY)
        from app.crypto import encrypt
        token = encrypt("secret")

        # Swap to a different key
        _crypto_mod._fernet = None
        other_key = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0"
        monkeypatch.setenv("SECRET_KEY", other_key)
        from app.crypto import decrypt
        with pytest.raises(ValueError, match="decryption failed"):
            decrypt(token)


class TestEncryptionConfigured:
    def test_true_when_key_set(self, monkeypatch):
        monkeypatch.setenv("SECRET_KEY", "anything")
        from app.crypto import encryption_configured
        assert encryption_configured() is True

    def test_false_when_key_absent(self, monkeypatch):
        monkeypatch.delenv("SECRET_KEY", raising=False)
        from app.crypto import encryption_configured
        assert encryption_configured() is False

    def test_false_when_key_blank(self, monkeypatch):
        monkeypatch.setenv("SECRET_KEY", "   ")
        from app.crypto import encryption_configured
        assert encryption_configured() is False
