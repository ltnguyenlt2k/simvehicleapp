"""protobus-broker entry point: main listener (Broker + Provider) and SafetyLane listener."""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import signal

import grpc

from protobus.broker.audit import AuditLog
from protobus.broker.safety import SafetyServer
from protobus.broker.service import BrokerService
from protobus.catalog import Catalog
from protobus.v1 import protobus_pb2_grpc as rpc


async def serve(catalog_path: str, bind: str, port: int, safety_port: int, audit_dir: str | None,
                started: asyncio.Event | None = None) -> tuple[BrokerService, grpc.aio.Server, SafetyServer]:
    catalog = Catalog.load(catalog_path)
    audit = AuditLog(audit_dir)
    service = BrokerService(catalog, audit)
    stop_timeout = catalog.node("Robot.Safety.Stop")["timeoutMs"] if "Robot.Safety.Stop" in catalog.nodes else 1000
    safety = SafetyServer(bind, safety_port, stop_timeout, audit, service.notify_stop)
    safety.start()
    service.safety = safety
    server = grpc.aio.server(options=[("grpc.so_reuseport", 0)])
    rpc.add_BrokerServicer_to_server(service, server)
    rpc.add_ProviderServicer_to_server(service, server)
    service.bound_port = server.add_insecure_port(f"{bind}:{port}")
    await server.start()
    service.start_background()
    audit.record("broker.start", catalog=catalog.hash, port=service.bound_port, safety_port=safety.bound_port)
    if started:
        started.set()
    return service, server, safety


def main() -> None:
    parser = argparse.ArgumentParser(prog="protobus-broker")
    parser.add_argument("--catalog", default=os.environ.get("PB_CATALOG", "/catalog/catalog.json"))
    parser.add_argument("--bind", default=os.environ.get("PB_BIND", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PB_PORT", "55500")))
    parser.add_argument("--safety-port", type=int, default=int(os.environ.get("PB_SAFETY_PORT", "55501")))
    parser.add_argument("--audit-dir", default=os.environ.get("PB_AUDIT_DIR"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    async def run():
        service, server, safety = await serve(args.catalog, args.bind, args.port, args.safety_port, args.audit_dir)
        logging.info("protobus broker ready catalog=%s port=%s safety=%s", service.catalog.hash,
                     service.bound_port, safety.bound_port)
        stop = asyncio.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            asyncio.get_running_loop().add_signal_handler(sig, stop.set)
        await stop.wait()
        await server.stop(1)
        safety.shutdown()

    asyncio.run(run())


if __name__ == "__main__":
    main()
