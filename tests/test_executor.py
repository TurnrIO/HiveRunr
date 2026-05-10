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


# ── skip propagation: sequential execution ────────────────────────────────────

class TestSkipPropagationSequential:
    """Skip delta propagates forward through the execution order."""

    def test_condition_false_skips_deep_false_branch(self):
        """A false condition should skip all downstream nodes reached via false handle."""
        g = _g(
            [
                _node("cond", "action.condition", config={"expression": "False"}),
                _node("true_a", "action.log", config={"message": "t"}),
                _node("true_b", "action.log", config={"message": "t"}),
                _node("false_a", "action.log", config={"message": "f"}),
                _node("false_b", "action.log", config={"message": "f"}),
            ],
            [
                {"source": "cond",  "target": "true_a",  "sourceHandle": "true"},
                {"source": "true_a", "target": "true_b"},
                {"source": "cond",  "target": "false_a", "sourceHandle": "false"},
                {"source": "false_a","target": "false_b"},
            ],
        )
        result = run_graph(g)
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["cond"]     == "ok"
        # condition=False → condition_val=False → skip true_reach, keep false_reach
        # So true_a and true_b should be SKIPPED
        assert statuses["true_a"]  == "skipped"
        assert statuses["true_b"]  == "skipped"
        assert statuses["false_a"] == "ok"
        assert statuses["false_b"] == "ok"

    def test_condition_true_skips_false_branch(self):
        g = _g(
            [
                _node("cond",     "action.condition", config={"expression": "True"}),
                _node("true_a",   "action.log",      config={"message": "t"}),
                _node("false_a",  "action.log",      config={"message": "f"}),
            ],
            [
                {"source": "cond",  "target": "true_a", "sourceHandle": "true"},
                {"source": "cond",  "target": "false_a","sourceHandle": "false"},
            ],
        )
        result = run_graph(g)
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["cond"]    == "ok"
        assert statuses["true_a"]  == "ok"
        assert statuses["false_a"] == "skipped"

    def test_skip_does_not_affect_parallel_sibling(self):
        """Skipping one branch of a parallel split should not affect the other branch."""
        g = _g(
            [
                _node("root",  "action.log", config={"message": "r"}),
                _node("split", "action.condition", config={"expression": "True"}),
                _node("left",  "action.log", config={"message": "l"}),
                _node("right", "action.log", config={"message": "rg"}),
                _node("join",  "action.log", config={"message": "j"}),
            ],
            [
                {"source": "root", "target": "split"},
                {"source": "split","target": "left",  "sourceHandle": "true"},
                {"source": "split","target": "right", "sourceHandle": "false"},
                {"source": "left", "target": "join"},
                {"source": "right","target": "join"},
            ],
        )
        result = run_graph(g)
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["root"]  == "ok"
        assert statuses["split"] == "ok"
        assert statuses["left"]  == "ok"
        assert statuses["right"] == "skipped"
        assert statuses["join"]  == "ok"      # join runs when left (its only predecessor) completes

    def test_sequential_chain_skip_continues_forward(self):
        """Skipping mid-chain should also skip nodes that only receive input from skipped nodes."""
        g = _g(
            [
                _node("cond",  "action.condition", config={"expression": "True"}),
                _node("n_a",   "action.log", config={"message": "a"}),
                _node("n_b",   "action.log", config={"message": "b"}),
                _node("n_c",   "action.log", config={"message": "c"}),
            ],
            [
                {"source": "cond", "target": "n_a"},
                {"source": "n_a",  "target": "n_b"},
                {"source": "n_b",  "target": "n_c"},
            ],
        )
        result = run_graph(g)
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        # condition=True → skip false_reach (none) → no skip propagation
        # Wait: condition=True, condition_val=True → skip false_reach (empty set) → no skip
        assert statuses["cond"] == "ok"
        assert statuses["n_a"]  == "ok"
        assert statuses["n_b"]  == "ok"
        assert statuses["n_c"]  == "ok"


# ── run_from skip ─────────────────────────────────────────────────────────────

class TestRunFromSkip:
    """start_node_id pre-populates context and skips all ancestors."""

    def test_run_from_skips_ancestors(self):
        """When starting mid-graph, all ancestors of start_node_id should be skipped."""
        g = _g(
            [
                _node("root", "action.log", config={"message": "r"}),
                _node("mid",  "action.log", config={"message": "m"}),
                _node("leaf", "action.log", config={"message": "l"}),
            ],
            [
                {"source": "root", "target": "mid"},
                {"source": "mid",  "target": "leaf"},
            ],
        )
        result = run_graph(g, start_node_id="mid")
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["root"] == "skipped"
        assert statuses["mid"]  == "ok"
        assert statuses["leaf"] == "ok"

    def test_run_from_skips_complex_ancestor_tree(self):
        """Diamond-shaped ancestor graph — all ancestors should be skipped."""
        g = _g(
            [
                _node("root", "action.log", config={"message": "r"}),
                _node("l1",   "action.log", config={"message": "l1"}),
                _node("l2",   "action.log", config={"message": "l2"}),
                _node("join", "action.log", config={"message": "j"}),
                _node("mid",  "action.log", config={"message": "m"}),
                _node("leaf", "action.log", config={"message": "l"}),
            ],
            [
                {"source": "root", "target": "l1"},
                {"source": "root", "target": "l2"},
                {"source": "l1",   "target": "join"},
                {"source": "l2",   "target": "join"},
                {"source": "join", "target": "mid"},
                {"source": "mid",  "target": "leaf"},
            ],
        )
        result = run_graph(g, start_node_id="mid")
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["root"] == "skipped"
        assert statuses["l1"]   == "skipped"
        assert statuses["l2"]   == "skipped"
        assert statuses["join"] == "skipped"
        assert statuses["mid"]  == "ok"
        assert statuses["leaf"] == "ok"

    def test_run_from_start_node_runs_even_if_disabled_in_definition(self):
        """start_node_id overrides disabled flag — the start node always runs."""
        g = _g(
            [
                _node("root", "action.log", config={"message": "r"}),
                _node("mid",  "action.log", config={"message": "m"}, disabled=True),
                _node("leaf", "action.log", config={"message": "l"}),
            ],
            [
                {"source": "root", "target": "mid"},
                {"source": "mid",  "target": "leaf"},
            ],
        )
        # When run_from targets a disabled node directly, that node IS the start
        # and should run (the disabled check is bypassed for the start_node_id)
        result = run_graph(g, start_node_id="mid")
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["root"] == "skipped"
        assert statuses["mid"]  == "ok"       # start node overrides disabled
        assert statuses["leaf"] == "ok"

    def test_run_from_prior_context_prepopulates(self):
        """prior_context should be merged into context for skipped ancestors."""
        g = _g(
            [
                _node("root", "action.log", config={"message": "r"}),
                _node("mid",  "action.log", config={"message": "{{mid}}"}),
            ],
            [{"source": "root", "target": "mid"}],
        )
        result = run_graph(g, start_node_id="mid",
                            prior_context={"root": {"value": "from_prior"}})
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["root"] == "skipped"
        assert statuses["mid"]  == "ok"

    def test_run_from_unknown_node_id_raises(self):
        """Providing a non-existent node_id should be silently ignored (no crash)."""
        g = _g([_node("a", "action.log", config={"message": "a"})])
        result = run_graph(g, start_node_id="does_not_exist")
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["a"] == "ok"  # runs normally


# ── disabled node + skip interaction ─────────────────────────────────────────

class TestDisabledNodeSkipInteraction:
    """Disabled nodes interact correctly with condition-based skip propagation."""

    def test_disabled_node_not_in_skipped_branch_still_runs(self):
        """A disabled node in the active branch should still be skipped (disabled > skip)."""
        g = _g(
            [
                _node("cond",        "action.condition", config={"expression": "True"}),
                _node("true_active", "action.log",       config={"message": "t"}),
                _node("true_disabled","action.log",     config={"message": "td"}, disabled=True),
                _node("false_node",  "action.log",       config={"message": "f"}),
            ],
            [
                {"source": "cond",         "target": "true_active",   "sourceHandle": "true"},
                {"source": "cond",         "target": "true_disabled","sourceHandle": "true"},
                {"source": "cond",         "target": "false_node",    "sourceHandle": "false"},
            ],
        )
        result = run_graph(g)
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["cond"]         == "ok"
        assert statuses["true_active"]  == "ok"
        assert statuses["true_disabled"] == "skipped"   # disabled overrides branch skip
        assert statuses["false_node"]   == "skipped"    # false branch skipped by condition

    def test_disabled_predecessor_of_active_node(self):
        """A disabled node that feeds into an active node: active node still runs."""
        g = _g(
            [
                _node("root",     "action.log", config={"message": "r"}),
                _node("disabled", "action.log", config={"message": "d"}, disabled=True),
                _node("child",    "action.log", config={"message": "c"}),
            ],
            [
                {"source": "root",     "target": "disabled"},
                {"source": "disabled", "target": "child"},
            ],
        )
        result = run_graph(g)
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["root"]     == "ok"
        assert statuses["disabled"] == "skipped"   # disabled
        assert statuses["child"]     == "ok"        # child runs (its input is the context from root)

    def test_disabled_node_in_skipped_branch_still_disabled_not_skipped(self):
        """A node that is both in a skipped branch AND disabled = 'skipped' (branch not taken)."""
        g = _g(
            [
                _node("cond",    "action.condition", config={"expression": "False"}),
                _node("false_d", "action.log",      config={"message": "fd"}, disabled=True),
            ],
            [
                {"source": "cond", "target": "false_d", "sourceHandle": "false"},
            ],
        )
        result = run_graph(g)
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["cond"]    == "ok"
        # false_d is in the skipped (false) branch — branch not taken takes priority
        assert statuses["false_d"] == "skipped"


# ── parallel skip propagation ─────────────────────────────────────────────────

class TestSkipPropagationParallel:
    """Skip deltas computed in one level must propagate into subsequent levels."""

    def test_condition_in_parallel_level_skips_subsequent_level(self):
        """A condition node in level N should skip nodes in level N+1 based on its decision."""
        # Build a graph where parallel branches reach a join, then another level
        # root -> (cond, dummy) in parallel -> join -> final_node
        g = _g(
            [
                _node("root",  "action.log", config={"message": "r"}),
                _node("cond",  "action.condition", config={"expression": "True"}),
                _node("other", "action.log", config={"message": "o"}),
                _node("join",  "action.log", config={"message": "j"}),
                _node("final", "action.log", config={"message": "f"}),
            ],
            [
                {"source": "root",  "target": "cond"},
                {"source": "root",  "target": "other"},
                {"source": "cond",  "target": "join",  "sourceHandle": "true"},
                {"source": "other", "target": "join"},
                {"source": "join",  "target": "final"},
            ],
        )
        # Enable parallel execution to force level-based scheduling
        import os
        old = os.environ.get("EXECUTOR_PARALLEL")
        os.environ["EXECUTOR_PARALLEL"] = "true"
        try:
            result = run_graph(g)
        finally:
            if old is not None:
                os.environ["EXECUTOR_PARALLEL"] = old
            else:
                os.environ.pop("EXECUTOR_PARALLEL", None)
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["root"]  == "ok"
        assert statuses["cond"]  == "ok"
        assert statuses["other"] == "ok"
        assert statuses["join"]  == "ok"
        assert statuses["final"] == "ok"

    def test_parallel_skip_false_branch_skips_join_successor(self):
        """When false branch is skipped in parallel, its downstream nodes must also be skipped."""
        g = _g(
            [
                _node("cond",      "action.condition", config={"expression": "False"}),
                _node("true_a",    "action.log",      config={"message": "t"}),
                _node("false_a",   "action.log",      config={"message": "f"}),
                _node("true_b",    "action.log",      config={"message": "tb"}),
            ],
            [
                {"source": "cond",   "target": "true_a",  "sourceHandle": "true"},
                {"source": "cond",   "target": "false_a", "sourceHandle": "false"},
                {"source": "true_a", "target": "true_b"},
            ],
        )
        import os
        old = os.environ.get("EXECUTOR_PARALLEL")
        os.environ["EXECUTOR_PARALLEL"] = "true"
        try:
            result = run_graph(g)
        finally:
            if old is not None:
                os.environ["EXECUTOR_PARALLEL"] = old
            else:
                os.environ.pop("EXECUTOR_PARALLEL", None)
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["cond"]    == "ok"
        assert statuses["true_a"]  == "skipped"
        assert statuses["false_a"] == "ok"
        assert statuses["true_b"]  == "skipped"   # downstream of skipped true_a


# ── run_from + condition combined ─────────────────────────────────────────────

class TestRunFromCombined:
    def test_run_from_with_prior_context_and_condition(self):
        """run_from at a condition node: prior_context used, then condition decides branch."""
        g = _g(
            [
                _node("root", "action.log", config={"message": "r"}),
                _node("cond", "action.condition", config={"expression": "True"}),
                _node("true_child",  "action.log", config={"message": "tc"}),
                _node("false_child", "action.log", config={"message": "fc"}),
            ],
            [
                {"source": "root", "target": "cond"},
                {"source": "cond", "target": "true_child",  "sourceHandle": "true"},
                {"source": "cond", "target": "false_child", "sourceHandle": "false"},
            ],
        )
        result = run_graph(g, start_node_id="cond",
                            prior_context={"root": {"x": 1}})
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["root"]        == "skipped"
        assert statuses["cond"]        == "ok"
        assert statuses["true_child"]  == "ok"
        assert statuses["false_child"] == "skipped"

    def test_run_from_disabled_ancestor_chain(self):
        """All ancestors of start_node_id are skipped even if they are disabled."""
        g = _g(
            [
                _node("root",     "action.log", config={"message": "r"}, disabled=True),
                _node("mid",      "action.log", config={"message": "m"}, disabled=True),
                _node("leaf",     "action.log", config={"message": "l"}),
            ],
            [
                {"source": "root", "target": "mid"},
                {"source": "mid",  "target": "leaf"},
            ],
        )
        result = run_graph(g, start_node_id="leaf")
        statuses = {t["node_id"]: t["status"] for t in result["traces"]}
        assert statuses["root"] == "skipped"
        assert statuses["mid"]  == "skipped"
        assert statuses["leaf"] == "ok"

