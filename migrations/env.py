"""Alembic environment — HiveRunr.

Uses the DATABASE_URL environment variable (same as app/core/db.py) so there
is a single source of truth for the database connection string.
"""
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Alembic Config object (gives access to alembic.ini values)
config = context.config

# Inject DATABASE_URL from the environment — no credentials in source control
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://hiverunr:hiverunr@db:5432/hiverunr",
)
config.set_main_option("sqlalchemy.url", DATABASE_URL)

# Set up logging from alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# HiveRunr uses raw SQL migrations, so target_metadata is None
target_metadata = None


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL to stdout, no DB connection)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (connect and apply directly)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
