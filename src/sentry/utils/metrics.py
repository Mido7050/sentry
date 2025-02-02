__all__ = ["timing", "incr"]


import functools
import logging
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from queue import Queue
from random import random
from threading import Thread
from typing import Any, TypeVar

import sentry_sdk
from django.conf import settings
from rest_framework.request import Request

from sentry.metrics.base import MetricsBackend, MutableTags, Tags
from sentry.metrics.middleware import MiddlewareWrapper, add_global_tags, global_tags

metrics_skip_all_internal = settings.SENTRY_METRICS_SKIP_ALL_INTERNAL
metrics_skip_internal_prefixes = tuple(settings.SENTRY_METRICS_SKIP_INTERNAL_PREFIXES)

__all__ = [
    "add_global_tags",
    "global_tags",
    "incr",
    "timer",
    "timing",
    "gauge",
    "backend",
    "MutableTags",
    "ensure_non_negative_crash_free_rate_value",
]


T = TypeVar("T")
F = TypeVar("F", bound=Callable[..., Any])


def get_default_backend() -> MetricsBackend:
    from sentry.utils.imports import import_string

    cls: type[MetricsBackend] = import_string(settings.SENTRY_METRICS_BACKEND)

    return MiddlewareWrapper(cls(**settings.SENTRY_METRICS_OPTIONS))


backend = get_default_backend()


def _get_key(key: str) -> str:
    prefix = settings.SENTRY_METRICS_PREFIX
    if prefix:
        return f"{prefix}{key}"
    return key


def _should_sample(sample_rate: float) -> bool:
    return sample_rate >= 1 or random() >= 1 - sample_rate


def _sampled_value(value: int, sample_rate: float) -> int:
    if sample_rate < 1:
        value = int(value * (1.0 / sample_rate))
    return value


class InternalMetrics:
    def __init__(self) -> None:
        self._started = False

    def _start(self) -> None:
        q: Queue[tuple[str, str | None, Tags | None, int, float]]
        self.q = q = Queue()

        def worker() -> None:
            from sentry import tsdb
            from sentry.tsdb.base import TSDBModel

            while True:
                key, instance, tags, amount, sample_rate = q.get()
                amount = _sampled_value(amount, sample_rate)
                if instance:
                    full_key = f"{key}.{instance}"
                else:
                    full_key = key
                try:
                    tsdb.backend.incr(TSDBModel.internal, full_key, count=amount)
                except Exception:
                    logger = logging.getLogger("sentry.errors")
                    logger.exception("Unable to incr internal metric")
                finally:
                    q.task_done()

        t = Thread(target=worker, daemon=True)
        t.start()

        self._started = True

    def incr(
        self,
        key: str,
        instance: str | None = None,
        tags: Tags | None = None,
        amount: int = 1,
        sample_rate: float = settings.SENTRY_METRICS_SAMPLE_RATE,
    ) -> None:
        if not self._started:
            self._start()
        self.q.put((key, instance, tags, amount, sample_rate))


internal = InternalMetrics()


def incr(
    key: str,
    amount: int = 1,
    instance: str | None = None,
    tags: Tags | None = None,
    skip_internal: bool = True,
    sample_rate: float = settings.SENTRY_METRICS_SAMPLE_RATE,
    unit: str | None = None,
    stacklevel: int = 0,
) -> None:
    should_send_internal = (
        not metrics_skip_all_internal
        and not skip_internal
        and _should_sample(sample_rate)
        and not key.startswith(metrics_skip_internal_prefixes)
    )

    if should_send_internal:
        internal.incr(key, instance, tags, amount, sample_rate)

    try:
        backend.incr(key, instance, tags, amount, sample_rate, unit, stacklevel + 1)
        if should_send_internal:
            backend.incr("internal_metrics.incr", key, None, 1, sample_rate)
    except Exception:
        logger = logging.getLogger("sentry.errors")
        logger.exception("Unable to record backend metric")


def gauge(
    key: str,
    value: float,
    instance: str | None = None,
    tags: Tags | None = None,
    sample_rate: float = settings.SENTRY_METRICS_SAMPLE_RATE,
    unit: str | None = None,
    stacklevel: int = 0,
) -> None:
    try:
        backend.gauge(key, value, instance, tags, sample_rate, unit, stacklevel + 1)
    except Exception:
        logger = logging.getLogger("sentry.errors")
        logger.exception("Unable to record backend metric")


def timing(
    key: str,
    value: int | float,
    instance: str | None = None,
    tags: Tags | None = None,
    sample_rate: float = settings.SENTRY_METRICS_SAMPLE_RATE,
    stacklevel: int = 0,
) -> None:
    try:
        backend.timing(key, value, instance, tags, sample_rate, stacklevel + 1)
    except Exception:
        logger = logging.getLogger("sentry.errors")
        logger.exception("Unable to record backend metric")


def distribution(
    key: str,
    value: int | float,
    instance: str | None = None,
    tags: Tags | None = None,
    sample_rate: float = settings.SENTRY_METRICS_SAMPLE_RATE,
    unit: str | None = None,
    stacklevel: int = 0,
) -> None:
    try:
        backend.distribution(key, value, instance, tags, sample_rate, unit, stacklevel + 1)
    except Exception:
        logger = logging.getLogger("sentry.errors")
        logger.exception("Unable to record backend metric")


@contextmanager
def timer(
    key: str,
    instance: str | None = None,
    tags: Tags | None = None,
    sample_rate: float = settings.SENTRY_METRICS_SAMPLE_RATE,
    stacklevel: int = 0,
) -> Generator[MutableTags, None, None]:
    start = time.monotonic()
    current_tags: MutableTags = dict(tags or ())
    try:
        yield current_tags
    except Exception:
        current_tags["result"] = "failure"
        raise
    else:
        current_tags["result"] = "success"
    finally:
        # stacklevel must be increased by 2 because of the contextmanager indirection
        timing(key, time.monotonic() - start, instance, current_tags, sample_rate, stacklevel + 2)


def wraps(
    key: str,
    instance: str | None = None,
    tags: Tags | None = None,
    sample_rate: float = settings.SENTRY_METRICS_SAMPLE_RATE,
    stacklevel: int = 0,
) -> Callable[[F], F]:
    def wrapper(f: F) -> F:
        @functools.wraps(f)
        def inner(*args: Any, **kwargs: Any) -> Any:
            with timer(
                key,
                instance=instance,
                tags=tags,
                sample_rate=sample_rate,
                stacklevel=stacklevel + 1,
            ):
                return f(*args, **kwargs)

        return inner  # type: ignore[return-value]

    return wrapper


def event(
    title: str,
    message: str,
    alert_type: str | None = None,
    aggregation_key: str | None = None,
    source_type_name: str | None = None,
    priority: str | None = None,
    instance: str | None = None,
    tags: Tags | None = None,
    stacklevel: int = 0,
) -> None:
    try:
        backend.event(
            title,
            message,
            alert_type,
            aggregation_key,
            source_type_name,
            priority,
            instance,
            tags,
            stacklevel + 1,
        )
    except Exception:
        logger = logging.getLogger("sentry.errors")
        logger.exception("Unable to record backend metric")


def ensure_non_negative_crash_free_rate_value(
    data: Any, request: Request, organization, CRASH_FREE_RATE_METRIC_KEY="session.crash_free_rate"
):
    """
    Ensures that crash_free_rate metric will never have negative
    value returned to the customer by replacing all the negative values with 0.
    Negative value of crash_free_metric can happen due to the
    corrupted data that is used to calculate the metric
    (see: https://github.com/getsentry/sentry/issues/73172)

    Example format of data argument:
    {
        ...
        "groups" : [
            ...
            "series": {..., "session.crash_free_rate": [..., None, 0.35]},
            "totals": {..., "session.crash_free_rate": 0.35}
        ]
    }
    """
    groups = data["groups"]
    for group in groups:
        if "series" in group:
            series = group["series"]
            if CRASH_FREE_RATE_METRIC_KEY in series:
                for i, value in enumerate(series[CRASH_FREE_RATE_METRIC_KEY]):
                    try:
                        value = float(value)
                        if value < 0:
                            with sentry_sdk.push_scope() as scope:
                                scope.set_tag("organization", organization.id)
                                scope.set_extra("crash_free_rate_in_series", value)
                                scope.set_extra("request_query_params", request.query_params)
                                sentry_sdk.capture_message("crash_free_rate in series is negative")
                            series[CRASH_FREE_RATE_METRIC_KEY][i] = 0
                    except TypeError:
                        # value is not a number
                        continue

        if "totals" in group:
            totals = group["totals"]
            if (
                CRASH_FREE_RATE_METRIC_KEY in totals
                and totals[CRASH_FREE_RATE_METRIC_KEY] is not None
                and totals[CRASH_FREE_RATE_METRIC_KEY] < 0
            ):
                with sentry_sdk.push_scope() as scope:
                    scope.set_tag("organization", organization.id)
                    scope.set_extra("crash_free_rate", totals[CRASH_FREE_RATE_METRIC_KEY])
                    scope.set_extra("request_query_params", request.query_params)
                    sentry_sdk.capture_message("crash_free_rate is negative")
                totals[CRASH_FREE_RATE_METRIC_KEY] = 0
