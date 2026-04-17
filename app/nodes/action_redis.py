"""Redis action node.

Supports GET/SET/DEL/EXISTS/INCR/DECR/EXPIRE/TTL/LPUSH/RPOP/LLEN/LRANGE/SADD/SMEMBERS/HSET/HGET/HGETALL operations.

Credential JSON fields:
  url  — full Redis URL, e.g. redis://[:password@]host:6379/0
         OR set host/port/password/db individually.
  host, port, password, db — individual fields (url takes precedence).
"""
import json
from app.nodes._utils import _render, _resolve_cred_raw

NODE_TYPE = "action.redis"
LABEL = "Redis"


def _get_client(config, context, creds):
    """Build a redis client from credential + config fields."""
    import redis as _redis

    url = _render(config.get("url", ""), context, creds).strip()

    # Try to pull from a named credential
    cred_name = _render(config.get("credential", ""), context, creds).strip()
    if cred_name and creds and not url:
        raw = _resolve_cred_raw(cred_name, creds)
        if raw:
            try:
                c = json.loads(raw)
                url = c.get("url", "") or c.get("redis_url", "")
                if not url:
                    host     = c.get("host", "localhost")
                    port     = int(c.get("port", 6379))
                    password = c.get("password") or None
                    db       = int(c.get("db", 0))
                    return _redis.Redis(host=host, port=port, password=password, db=db,
                                       socket_timeout=10, decode_responses=True)
            except (json.JSONDecodeError, AttributeError, ValueError):
                url = raw.strip()

    if url:
        return _redis.from_url(url, socket_timeout=10, decode_responses=True)

    # Fallback: use inline config fields
    host     = _render(config.get("host", "localhost"), context, creds) or "localhost"
    port     = int(_render(config.get("port", "6379"), context, creds) or 6379)
    password = _render(config.get("password", ""), context, creds) or None
    db       = int(_render(config.get("db", "0"), context, creds) or 0)
    return _redis.Redis(host=host, port=port, password=password, db=db,
                        socket_timeout=10, decode_responses=True)


def run(config, inp, context, logger, creds=None, **kwargs):
    """Execute a Redis command."""
    operation = _render(config.get("operation", "get"), context, creds).strip().lower()
    key       = _render(config.get("key", ""), context, creds).strip()
    value     = _render(config.get("value", ""), context, creds)
    ttl_raw   = _render(config.get("ttl", ""), context, creds).strip()
    count_raw = _render(config.get("count", "1"), context, creds).strip()
    field     = _render(config.get("field", ""), context, creds).strip()  # for HSET/HGET

    if not key and operation not in ("ping",):
        raise ValueError("Redis: 'key' is required")

    r = _get_client(config, context, creds)

    try:
        if operation == "get":
            result = r.get(key)
            return {"value": result, "key": key, "exists": result is not None}

        elif operation == "set":
            ttl = int(ttl_raw) if ttl_raw else None
            if ttl:
                r.setex(key, ttl, value)
            else:
                r.set(key, value)
            return {"ok": True, "key": key, "value": value}

        elif operation == "del":
            deleted = r.delete(key)
            return {"deleted": deleted, "key": key, "ok": deleted > 0}

        elif operation == "exists":
            exists = bool(r.exists(key))
            return {"exists": exists, "key": key}

        elif operation == "incr":
            amount = int(count_raw) if count_raw else 1
            new_val = r.incrby(key, amount)
            return {"value": new_val, "key": key}

        elif operation == "decr":
            amount = int(count_raw) if count_raw else 1
            new_val = r.decrby(key, amount)
            return {"value": new_val, "key": key}

        elif operation == "expire":
            ttl = int(ttl_raw) if ttl_raw else 60
            ok = bool(r.expire(key, ttl))
            return {"ok": ok, "key": key, "ttl": ttl}

        elif operation == "ttl":
            remaining = r.ttl(key)
            return {"ttl": remaining, "key": key, "persistent": remaining == -1, "missing": remaining == -2}

        elif operation == "lpush":
            length = r.lpush(key, value)
            return {"length": length, "key": key, "value": value}

        elif operation == "rpush":
            length = r.rpush(key, value)
            return {"length": length, "key": key, "value": value}

        elif operation == "lpop":
            popped = r.lpop(key)
            return {"value": popped, "key": key, "empty": popped is None}

        elif operation == "rpop":
            popped = r.rpop(key)
            return {"value": popped, "key": key, "empty": popped is None}

        elif operation == "llen":
            length = r.llen(key)
            return {"length": length, "key": key}

        elif operation == "lrange":
            start = int(_render(config.get("start", "0"), context, creds) or 0)
            stop  = int(_render(config.get("stop", "-1"), context, creds) or -1)
            items = r.lrange(key, start, stop)
            return {"items": items, "count": len(items), "key": key}

        elif operation == "sadd":
            added = r.sadd(key, value)
            return {"added": added, "key": key}

        elif operation == "smembers":
            members = list(r.smembers(key))
            return {"members": members, "count": len(members), "key": key}

        elif operation == "hset":
            if not field:
                raise ValueError("Redis hset: 'field' is required")
            r.hset(key, field, value)
            return {"ok": True, "key": key, "field": field, "value": value}

        elif operation == "hget":
            if not field:
                raise ValueError("Redis hget: 'field' is required")
            result = r.hget(key, field)
            return {"value": result, "key": key, "field": field, "exists": result is not None}

        elif operation == "hgetall":
            data = r.hgetall(key)
            return {"data": data, "count": len(data), "key": key}

        elif operation == "ping":
            r.ping()
            return {"ok": True, "pong": True}

        else:
            raise ValueError(f"Redis: unknown operation '{operation}'")

    finally:
        r.close()
