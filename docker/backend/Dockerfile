ARG PYTHON_VERSION=3.12
FROM python:${PYTHON_VERSION}-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_SETTINGS_MODULE=gmp_runtime.settings \
    PYTHONPATH=/app/src:/app/docker/backend

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app

COPY requirements.txt requirements-docker.txt ./
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements-docker.txt

# Copy runtime code/contracts required by the app and operational tools.
COPY src ./src
COPY config ./config
COPY database ./database
COPY ops ./ops
COPY schemas ./schemas

# Canonical reference inputs required by the one-time Stage 12 knowledge/taxonomy seed.
# Only the pinned files used by ops/stage12/seed_canonical_reference.py are copied.
COPY data/knowledge/stage1_lessons_v1.0.csv ./data/knowledge/stage1_lessons_v1.0.csv
COPY data/knowledge/stage1_subtopics_v1.0.csv ./data/knowledge/stage1_subtopics_v1.0.csv
COPY data/taxonomy/stage2_categories_v1.0.csv ./data/taxonomy/stage2_categories_v1.0.csv
COPY data/taxonomy/stage2_subcategories_v1.0.csv ./data/taxonomy/stage2_subcategories_v1.0.csv
COPY data/taxonomy/stage2_controlled_tags_v1.0.csv ./data/taxonomy/stage2_controlled_tags_v1.0.csv
COPY data/taxonomy/stage2_lesson_category_mapping_v1.0.csv ./data/taxonomy/stage2_lesson_category_mapping_v1.0.csv
COPY data/taxonomy/stage2_lesson_tags_v1.0.csv ./data/taxonomy/stage2_lesson_tags_v1.0.csv
COPY data/planning/stage3_lesson_weights_v1.0.csv ./data/planning/stage3_lesson_weights_v1.0.csv

COPY docker/backend ./docker/backend

RUN chmod 0755 docker/backend/entrypoint.sh \
    && chown -R app:app /app

USER app

EXPOSE 8000

ENTRYPOINT ["/app/docker/backend/entrypoint.sh"]
