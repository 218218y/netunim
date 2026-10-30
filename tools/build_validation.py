"""Production validation must remain enabled under python -O/PYTHONOPTIMIZE."""


class BuildValidationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise BuildValidationError(message)
