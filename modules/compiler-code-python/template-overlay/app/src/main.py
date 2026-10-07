# Copyright (c) 2022-2025 Contributors to the Eclipse Foundation
# Copyright (c) 2026 SimVehicleApp contributors
#
# This program and the accompanying materials are made available under the
# terms of the Apache License, Version 2.0 which is available at
# https://www.apache.org/licenses/LICENSE-2.0.
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
# WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
# License for the specific language governing permissions and limitations
# under the License.
#
# SPDX-License-Identifier: Apache-2.0
#
# Modified by SimVehicleApp: runs the generated workflows (generated/app.py) on the vendored
# SimVehicleApp runtime instead of the template's sample app (ADR-0040 §3).

"""The vehicle app: the project's workflows on the SimVehicleApp runtime."""

import asyncio
import logging
import os
import signal
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "simvehicleapp-runtime"))

from generated.app import APP_NAME, TRACE_LEVEL, WORKFLOWS  # noqa: E402
from simvehicleapp_runtime.velocitas import SimVehicleApp  # noqa: E402
from velocitas_sdk.util.log import (  # type: ignore # noqa: E402
    get_opentelemetry_log_factory,
    get_opentelemetry_log_format,
)

import user_hooks  # noqa: E402

# Configure the VehicleApp logger with the necessary log config and level.
logging.setLogRecordFactory(get_opentelemetry_log_factory())
logging.basicConfig(format=get_opentelemetry_log_format())
logging.getLogger().setLevel("INFO")
logger = logging.getLogger(__name__)


async def main():
    """Main function"""
    logger.info("Starting %s...", APP_NAME)
    app = SimVehicleApp(
        APP_NAME,
        WORKFLOWS,
        TRACE_LEVEL,
        on_app_start=user_hooks.on_app_start,
        on_app_stop=user_hooks.on_app_stop,
    )
    loop = asyncio.get_running_loop()

    async def stop() -> None:
        await app.shutdown()
        loop.stop()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.ensure_future(stop()))
    await app.run()


LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(LOOP)
try:
    LOOP.run_until_complete(main())
except RuntimeError:
    pass  # the loop was stopped by a signal or a Stop block
finally:
    LOOP.close()
