"""Stage 21 backend services plus the selected Django/DRF transport adapter.

Authentication, idempotency, safe projections and answer transactions remain
transport-independent. The backend.django_adapter package maps Django REST
Framework requests to these services without moving learning rules into views.
"""

from .errors import APIError

__all__ = ["APIError"]
