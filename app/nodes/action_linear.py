"""Linear.app issue tracker node (GraphQL API)."""
import json
import urllib.request
import urllib.error
from app.nodes._utils import _render

NODE_TYPE = "action.linear"
LABEL     = "Linear"

_ENDPOINT = "https://api.linear.app/graphql"


def _gql(api_key: str, query: str, variables: dict = None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req  = urllib.request.Request(_ENDPOINT, data=body)
    req.add_header("Authorization", api_key)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Linear {e.code}: {e.read().decode()[:300]}")
    if data.get("errors"):
        raise RuntimeError(f"Linear GraphQL error: {data['errors'][0]['message']}")
    return data.get("data", {})


def run(config, inp, context, logger, creds=None, **kwargs):
    cred_name = config.get("credential", "")
    api_key   = ""
    if cred_name and creds:
        raw = creds.get(cred_name, {})
        if isinstance(raw, str):
            try:   raw = json.loads(raw)
            except: raw = {}
        api_key = raw.get("api_key", raw.get("token", ""))
    if not api_key:
        api_key = _render(config.get("api_key", ""), context, creds)
    if not api_key:
        raise ValueError("Linear: api_key is required (set via credential or api_key field)")

    op = _render(config.get("operation", "get_issue"), context, creds)

    # ── get issue ─────────────────────────────────────────────────────────────
    if op == "get_issue":
        issue_id = _render(config.get("issue_id", ""), context, creds)
        data = _gql(api_key, """
            query($id: String!) {
              issue(id: $id) {
                id identifier title description state { name }
                assignee { name email } priority createdAt updatedAt url
              }
            }
        """, {"id": issue_id})
        issue = data.get("issue", {})
        return {"issue": issue, "id": issue.get("id"), "title": issue.get("title"),
                "state": (issue.get("state") or {}).get("name")}

    # ── create issue ──────────────────────────────────────────────────────────
    elif op == "create_issue":
        team_id     = _render(config.get("team_id", ""), context, creds)
        title       = _render(config.get("title", ""), context, creds)
        description = _render(config.get("description", ""), context, creds)
        priority_str = config.get("priority", "0")
        try:   priority = int(priority_str)
        except: priority = 0
        data = _gql(api_key, """
            mutation($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success issue { id identifier title url state { name } }
              }
            }
        """, {"input": {"teamId": team_id, "title": title,
                        "description": description, "priority": priority}})
        issue = (data.get("issueCreate") or {}).get("issue", {})
        return {"issue": issue, "id": issue.get("id"), "title": issue.get("title"),
                "url": issue.get("url")}

    # ── update issue ──────────────────────────────────────────────────────────
    elif op == "update_issue":
        issue_id = _render(config.get("issue_id", ""), context, creds)
        updates_raw = _render(config.get("updates", "{}"), context, creds)
        try:   updates = json.loads(updates_raw) if isinstance(updates_raw, str) else updates_raw
        except: raise ValueError("Linear update_issue: updates must be valid JSON")
        data = _gql(api_key, """
            mutation($id: String!, $input: IssueUpdateInput!) {
              issueUpdate(id: $id, input: $input) {
                success issue { id identifier title state { name } updatedAt }
              }
            }
        """, {"id": issue_id, "input": updates})
        issue = (data.get("issueUpdate") or {}).get("issue", {})
        return {"issue": issue, "id": issue.get("id"), "success": (data.get("issueUpdate") or {}).get("success")}

    # ── search issues ─────────────────────────────────────────────────────────
    elif op == "search_issues":
        query_str = _render(config.get("query", ""), context, creds)
        limit     = int(_render(config.get("limit", "25"), context, creds) or 25)
        data = _gql(api_key, """
            query($filter: IssueFilter, $first: Int) {
              issues(filter: $filter, first: $first) {
                nodes { id identifier title state { name } priority assignee { name } url }
              }
            }
        """, {"filter": {"title": {"containsIgnoreCase": query_str}} if query_str else {},
              "first": min(limit, 100)})
        issues = (data.get("issues") or {}).get("nodes", [])
        return {"issues": issues, "count": len(issues), "issue": issues[0] if issues else None}

    else:
        raise ValueError(f"Linear: unknown operation {op!r}")
