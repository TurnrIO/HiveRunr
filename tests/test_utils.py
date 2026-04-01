"""Unit tests for the _render template engine (app/nodes/_utils.py)."""
import json
import pytest

from app.nodes._utils import _render


class TestRender:
    def test_plain_string_unchanged(self):
        assert _render("hello world", {}) == "hello world"

    def test_empty_string(self):
        assert _render("", {}) == ""

    def test_non_string_passthrough(self):
        assert _render(42, {}) == 42
        assert _render(None, {}) is None
        assert _render(["a"], {}) == ["a"]

    def test_node_ref_simple(self):
        ctx = {"node1": {"field": "banana"}}
        assert _render("{{node1.field}}", ctx) == "banana"

    def test_node_ref_whole_node(self):
        ctx = {"node1": "scalar-value"}
        assert _render("{{node1}}", ctx) == "scalar-value"

    def test_node_ref_missing_node_unchanged(self):
        assert _render("{{ghost.field}}", {}) == "{{ghost.field}}"

    def test_node_ref_missing_field_unchanged(self):
        ctx = {"node1": {"a": 1}}
        assert _render("{{node1.missing}}", ctx) == "{{node1.missing}}"

    def test_multiple_refs_in_string(self):
        ctx = {"n1": {"v": "hello"}, "n2": {"v": "world"}}
        assert _render("{{n1.v}} {{n2.v}}", ctx) == "hello world"

    def test_non_dict_node_field_access_unchanged(self):
        ctx = {"n1": "flat-string"}
        assert _render("{{n1.subfield}}", ctx) == "{{n1.subfield}}"

    def test_numeric_value_converted_to_string(self):
        ctx = {"n1": {"count": 99}}
        assert _render("Count: {{n1.count}}", ctx) == "Count: 99"


class TestRenderCreds:
    def test_cred_simple(self):
        creds = {"my-token": "secret123"}
        assert _render("{{creds.my-token}}", {}, creds) == "secret123"

    def test_cred_missing_unchanged(self):
        assert _render("{{creds.missing}}", {}, {}) == "{{creds.missing}}"

    def test_cred_json_field(self):
        creds = {"smtp": json.dumps({"host": "smtp.example.com", "port": 587})}
        assert _render("{{creds.smtp.host}}", {}, creds) == "smtp.example.com"

    def test_cred_json_missing_field_unchanged(self):
        creds = {"smtp": json.dumps({"host": "smtp.example.com"})}
        assert _render("{{creds.smtp.missing}}", {}, creds) == "{{creds.smtp.missing}}"

    def test_cred_no_creds_dict_unchanged(self):
        assert _render("{{creds.token}}", {}, None) == "{{creds.token}}"
