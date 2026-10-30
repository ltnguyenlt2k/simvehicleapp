"""Explicit local-SIM ROS provider process. Startup never claims or arms."""
import argparse
import asyncio
import json
from pathlib import Path

import rclpy
from broker import load_catalog
from dog_backend import DogBackend, DogProvider
from dog_ros_link import DogRosLink
from mapping import MappingEngine


async def serve(args):
    catalog = load_catalog(args.catalog)
    profile = json.loads(Path(args.mapping).read_text())
    if args.authorize_sim_arm:
        profile['allowRemoteArm'] = True
    engine = MappingEngine(catalog, profile)
    rclpy.init(args=[])
    link = DogRosLink(engine, Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                      authorize_sim_arm=args.authorize_sim_arm)
    routes = {}
    if args.routes:
        route_file = json.loads(Path(args.routes).read_text())
        if route_file.get('schema') != 'dog-routes.v1' or not isinstance(route_file.get('routes'),dict):
            raise ValueError('invalid versioned route file')
        routes = route_file['routes']
    backend = DogBackend(catalog, engine, link, routes)
    provider = DogProvider(args.bus, catalog, backend, provider_id='ros2-dog-control-1',
                           profile_id=profile['profile'])
    await backend.start()
    async def monitor():
        while True:
            await asyncio.sleep(.1)
            if provider.connected.is_set() and not link.ready():
                backend.lost('ROS_SOURCE_LOST')
                provider.restart.set()
    monitor_task = asyncio.create_task(monitor())
    try:
        print(json.dumps({'backend':'ROS_SIM','mappingHash':engine.profile_hash,
                          'remoteArmAuthorized':link.authorize_sim_arm}),flush=True)
        await provider.run()
    finally:
        monitor_task.cancel()
        await asyncio.gather(monitor_task,return_exceptions=True)
        await backend.close()
        link.close()
        rclpy.shutdown()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog',required=True)
    parser.add_argument('--mapping',default='profiles/dog-go2-sim/mapping.json')
    parser.add_argument('--bus',default='protobus-live:55600')
    parser.add_argument('--authorize-sim-arm',action='store_true')
    parser.add_argument('--routes')
    asyncio.run(serve(parser.parse_args()))


if __name__ == '__main__':
    main()
