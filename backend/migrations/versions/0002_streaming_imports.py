"""streaming imports: issue table, stored uploads, apply-by-run

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "import_issues",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column("row", sa.Integer(), nullable=True),
        sa.Column("severity", sa.String(length=8), nullable=False),
        sa.Column("field", sa.String(length=32), nullable=True),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["import_runs.id"],
            name=op.f("fk_import_issues_run_id_import_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_import_issues")),
    )
    op.create_index(
        "ix_import_issues_run_row_id",
        "import_issues",
        ["run_id", sa.text("row NULLS FIRST"), "id"],
        unique=False,
    )
    op.execute(
        """
        INSERT INTO import_issues (run_id, row, severity, field, value, message)
        SELECT r.id, (i->>'row')::int, i->>'severity', i->>'field', i->>'value', i->>'message'
        FROM import_runs r, jsonb_array_elements(r.issues) AS i
        """
    )
    op.drop_column("import_runs", "issues")
    op.add_column("import_runs", sa.Column("rows_applied", sa.Integer(), server_default="0", nullable=False))
    op.add_column("import_runs", sa.Column("duplicates", sa.Integer(), server_default="0", nullable=False))
    op.add_column("import_runs", sa.Column("blank_rows", sa.Integer(), server_default="0", nullable=False))
    op.add_column("import_runs", sa.Column("stored_key", sa.String(length=100), nullable=True))
    op.add_column("import_runs", sa.Column("file_size", sa.BigInteger(), nullable=True))
    op.add_column("import_runs", sa.Column("file_sha256", sa.String(length=64), nullable=True))
    op.add_column("import_runs", sa.Column("parent_run_id", sa.UUID(), nullable=True))
    op.add_column("import_runs", sa.Column("applied_run_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f("fk_import_runs_parent_run_id_import_runs"),
        "import_runs",
        "import_runs",
        ["parent_run_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_import_runs_parent_run_id_import_runs"), "import_runs", type_="foreignkey")
    for column in (
        "applied_run_id",
        "parent_run_id",
        "file_sha256",
        "file_size",
        "stored_key",
        "blank_rows",
        "duplicates",
        "rows_applied",
    ):
        op.drop_column("import_runs", column)
    op.add_column(
        "import_runs",
        sa.Column("issues", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
    )
    op.execute(
        """
        UPDATE import_runs r SET issues = COALESCE((
            SELECT jsonb_agg(jsonb_build_object('row', i.row, 'severity', i.severity, 'field', i.field,
                                                'value', i.value, 'message', i.message) ORDER BY i.id)
            FROM import_issues i WHERE i.run_id = r.id), '[]'::jsonb)
        """
    )
    op.drop_index("ix_import_issues_run_row_id", table_name="import_issues")
    op.drop_table("import_issues")
