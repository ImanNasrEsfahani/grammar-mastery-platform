import os

bind = "0.0.0.0:8000"
workers = int(os.getenv("GUNICORN_WORKERS", "2"))
threads = int(os.getenv("GUNICORN_THREADS", "2"))
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))
graceful_timeout = 30
keepalive = 5

accesslog = "-"
errorlog = "-"
capture_output = True

# Bound the impact of gradual per-worker memory growth without coordinating
# application state in process memory.
max_requests = 2000
max_requests_jitter = 200
