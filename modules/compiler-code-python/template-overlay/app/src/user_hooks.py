"""Your code around the generated workflows (installed once; SynCode never touches this file).

The workflows themselves are generated into ``generated/`` from the canvas — edit them there, not in
Python. Use these hooks for set-up and clean-up that the blocks do not cover.
"""


def on_app_start() -> None:
    """Runs once the vehicle data broker is connected, before the workflows start."""


def on_app_stop() -> None:
    """Runs when the app stops (SIGTERM/SIGINT or a Stop block with scope "app")."""
