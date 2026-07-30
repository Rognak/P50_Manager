"""vacancies + candidate screening / drop feedback

Revision ID: a4b8c1e7d2f5
Revises: f3c7b9e2a8d4
Create Date: 2026-04-30 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a4b8c1e7d2f5'
down_revision: Union[str, None] = 'f3c7b9e2a8d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Таблица vacancies
    op.create_table(
        'vacancies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('department_id', sa.Integer(), nullable=True),
        sa.Column('role_id', sa.Integer(), nullable=True),
        sa.Column('grade_id', sa.Integer(), nullable=True),
        sa.Column('requirements_md', sa.Text(), nullable=True),
        sa.Column(
            'status', sa.String(length=20),
            nullable=False, server_default='open',
        ),
        sa.Column('created_by_id', sa.Integer(), nullable=False),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['grade_id'], ['grades.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='RESTRICT'),
        sa.CheckConstraint(
            'project_id IS NOT NULL OR department_id IS NOT NULL',
            name='ck_vacancies_target_required',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_vacancies_project_id'), 'vacancies', ['project_id'])
    op.create_index(op.f('ix_vacancies_department_id'), 'vacancies', ['department_id'])
    op.create_index(op.f('ix_vacancies_status'), 'vacancies', ['status'])
    op.create_index(op.f('ix_vacancies_created_by_id'), 'vacancies', ['created_by_id'])

    # 2) Изменения candidate_profiles
    op.add_column(
        'candidate_profiles',
        sa.Column('vacancy_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_candidate_profiles_vacancy_id_vacancies',
        'candidate_profiles', 'vacancies',
        ['vacancy_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index(
        op.f('ix_candidate_profiles_vacancy_id'),
        'candidate_profiles', ['vacancy_id'],
    )

    # scoring fields
    op.add_column(
        'candidate_profiles',
        sa.Column('ai_screening_score', sa.Integer(), nullable=True),
    )
    op.add_column(
        'candidate_profiles',
        sa.Column('ai_screening_recommended', sa.Boolean(), nullable=True),
    )
    op.add_column(
        'candidate_profiles',
        sa.Column('ai_screening_reasoning_md', sa.Text(), nullable=True),
    )
    op.add_column(
        'candidate_profiles',
        sa.Column('ai_screening_at', sa.DateTime(timezone=True), nullable=True),
    )

    # 3) Удаляем устаревшие feedback-поля
    op.drop_column('candidate_profiles', 'ai_feedback_md')
    # Старая поле resume-summary заменяется на screening — удаляем тоже
    op.drop_column('candidate_profiles', 'ai_resume_summary_md')


def downgrade() -> None:
    op.add_column(
        'candidate_profiles',
        sa.Column('ai_resume_summary_md', sa.Text(), nullable=True),
    )
    op.add_column(
        'candidate_profiles',
        sa.Column('ai_feedback_md', sa.Text(), nullable=True),
    )
    op.drop_column('candidate_profiles', 'ai_screening_at')
    op.drop_column('candidate_profiles', 'ai_screening_reasoning_md')
    op.drop_column('candidate_profiles', 'ai_screening_recommended')
    op.drop_column('candidate_profiles', 'ai_screening_score')
    op.drop_index(
        op.f('ix_candidate_profiles_vacancy_id'),
        table_name='candidate_profiles',
    )
    op.drop_constraint(
        'fk_candidate_profiles_vacancy_id_vacancies',
        'candidate_profiles', type_='foreignkey',
    )
    op.drop_column('candidate_profiles', 'vacancy_id')
    op.drop_index(op.f('ix_vacancies_created_by_id'), table_name='vacancies')
    op.drop_index(op.f('ix_vacancies_status'), table_name='vacancies')
    op.drop_index(op.f('ix_vacancies_department_id'), table_name='vacancies')
    op.drop_index(op.f('ix_vacancies_project_id'), table_name='vacancies')
    op.drop_table('vacancies')
