"""Unit tests for the graph executor.

These tests exercise the executor's orchestration logic — topological sort,
node skipping, fail_mode, condition branching — without needing a running
database or Redis.  Credential loading is wrapped in try-except in the
executor so it gracefully degrades to an empty dict.
"""
import pytest

from app.core.executor import _topo, run_graph


# ── helpers ───────────────────────────────────────────────────────────────────

def _g(nodes, edges=None):
    """Convenience: build a graph dict."""
    return {"nodes": nodes, "edges": edges or []}


def _node(nid, ntype="action.log", config=None, **extra):
    data = {"config": config or {}, **extra}
    return {"id": nid, "type": ntype, "data": data}


# ── topological sort ──────────────────────────────────────────────────────────

class TestTopo:
    def test_empty(self):
        order, succ = _topo([], [])
        assert order == []
        assert succ == {}

    def test_single_node(self):
        order, succ = _topo([{"id": "a"}], [])
        assert order == ["a"]

    def test_linear_chain(self):
        nodes = [{"id": n} for n in ("a", "b", "c")]
        edges = [
            {"source": "a", "target": "b"},
            {"source": "b", "target": "c"},
        ]
        order, _ = _topo(nodes, edges)
        assert order.index("a") < order.index("b") < order.index("c")

    def test_parallel_branches(self):
        nodes = [{"id": n} for n in ("root", "l", "r", "join")]
        edges = [
            {"source": "root", "target": "l"},
            {"source": "root", "target": "r"},
            {"source": "l",    "target": "join"},
            {"source": "r",    "target": "join"},
        ]
        order, _ = _topo(nodes, edges)
        assert order.index("root") < order.index("l")
        assert order.index("root") < order.index("r")
        assert order.index("l") < order.index("join")
        assert order.index("r") < order.index("join")

    def test_edges_to_unknown_nodes_ignored(self):
        nodes = [{"id": "a"}]
        edges = [{"source": "a", "target": "ghost"}]
        order, _ = _topo(nodes, edges)
        assert order == ["a"]


# ── run_graph: basic behaviour ─────────────────────────────────────────────────

class TestRunGraphBasics:
    def test_empty_graph(self):
        result = run_graph(_g([]))
        assert result["traces"] == []
        assert result["results"] == {}

    def test_returns_expected_keys(self):
        result = run_graph(_g([]))
        assert set(result.keys()) >= {"traces", "results", "context"}

    def test_note_node_is_skipped(self):
        result = run_graph(_g([_node("n1", "note")]))
        trace = result["traces"][0]
        assert trace["status"] == "skipped"
        assert result["results"]["n1"] == {"__ui_only": True}

    def test_disabled_node_is_skipped(self):
        node = _node("n1", "action.log", config={"message": "hi"}, disabled=True)
        result = run_graph(_g([node]))
        assert result["traces"][0]["status"] == "skipped"

    def test_unknown_node_type_raises(self):
        with pytest.raises(RuntimeError, match="Node \\[n1\\]"):
            run_graph(_g([_node("n1", "action.does_not_exist")]))

    def test_fail_mode_continue_stores_error(self):
        node = _node("n1", "action.does_not_exist", fail_mode="continue")
        result = run_graph(_g([node]))
        trace = result["traces"][0]
        assert trace["status"] == "error"
        assert "__error" in result["results"]["n1"]

    def test_initial_payload_passed_to_first_node(self):
        """Trigger nodes return inp as-is; verify payload flows through."""
        # action.log returns inp unchanged — use that as a passthrough
        node = _node("n1", "action.log", config={"message": "{{n1}}"})
        result = run_graph(_g([node]), initial_payload={"hello": "world"})
        # trace should record the input we sent
        assert result["traces"][0]["input"] == {"hello": "world"}

    def test_trace_records_duration(self):
        node = _node("n1", "action.log", config={"message": "ping"})
        result = run_graph(_g([node]))
        assert result["traces"][0]["duration_ms"] >= 0

    def test_multiple_nodes_all_traced(self):
        nodes = [
            _node("n1", "action.log", config={"message": "a"}),
            _node("n2", "action.log", config={"message": "b"}),
        ]
        edges = [{"source": "n1", "target": "n2"}]
        result = run_graph(_g(nodes, edges))
        assert len(result["traces"]) == 2
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses == {"n1": "ok", "n2": "ok"}


# ── condition branching ───────────────────────────────────────────────────────

class TestConditionBranching:
    """Condition node should skip the un-taken branch."""

    def _condition_graph(self):
        return _g(
            [
                _node("cond", "action.condition", config={"expression": "True"}),
                _node("true_node",  "action.log", config={"message": "yes"}),
                _node("false_node", "action.log", config={"message": "no"}),
            ],
            [
                {"source": "cond", "target": "true_node",  "sourceHandle": "true"},
                {"source": "cond", "target": "false_node", "sourceHandle": "false"},
            ],
        )

    def test_true_branch_runs(self):
        result = run_graph(self._condition_graph())
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["true_node"] == "ok"

    def test_false_branch_skipped(self):
        result = run_graph(self._condition_graph())
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["false_node"] == "skipped"
