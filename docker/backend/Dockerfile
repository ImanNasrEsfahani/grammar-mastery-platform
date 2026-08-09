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

# Copy only runtime code/contracts required by the app and Stage 26 migration tool.
COPY src ./src
COPY config ./config
COPY database ./database
COPY ops ./ops
COPY schemas ./schemas
COPY docker/backend ./docker/backend

RUN chmod 0755 docker/backend/entrypoint.sh \
    && chown -R app:app /app

USER app

EXPOSE 8000

ENTRYPOINT ["/app/docker/backend/entrypoint.sh"]
