"""Pure compiler image entrypoint: JSON in, diagnostics/file set out."""
import argparse
import json
from pathlib import Path
import sys
from codegen import build_application


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--runtime-package-hash', required=True)
    parser.add_argument('--authorize-sim-arm', action='store_true')
    args=parser.parse_args()
    raw=sys.stdin.buffer.read(1024*1024+1)
    catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text())
    profile=json.loads(Path('profiles/dog-go2-sim.json').read_text())
    profile['allowRemoteArm']=args.authorize_sim_arm
    result=build_application(raw,catalog,profile,runtime_package_hash=args.runtime_package_hash)
    print(json.dumps(result,ensure_ascii=False,allow_nan=False))
    return 0 if result['ok'] else 2

if __name__=='__main__':
    raise SystemExit(main())
