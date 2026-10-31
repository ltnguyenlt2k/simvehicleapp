"""Isolated developer CLI/native-template CI gate; actual mock, no ROS network."""
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'runtime/t08'
OUTPUT.mkdir(parents=True,exist_ok=True)
env={**os.environ,'COMPOSE_PROJECT_NAME':'sr-native-cli-test'}
compose=['docker','compose','-f',str(ROOT/'compose.yaml')]
cli=['python3',str(ROOT/'scripts/native_cli.py')]


def run(command):subprocess.run(command,env=env,check=True,timeout=300)

try:
    templates=json.loads(subprocess.check_output(['docker','run','--rm','--network','none','sr-robotflow:dev',
        'python','-c','import json;from templates import templates;print(json.dumps(templates()))'],env=env,text=True))
    assert set(templates)=={'RW-A','RW-B','RW-C','RW-D'}
    folder=OUTPUT/'flows';folder.mkdir(exist_ok=True)
    for name,value in templates.items():(folder/(name+'.json')).write_text(json.dumps(value),encoding='utf-8')
    run(compose+['up','-d','--wait','--wait-timeout','60','protobus-mock'])
    target=ROOT/'runtime/targets/t08-mock.json'
    if not target.exists():run(cli+['target','--sim','--out','t08-mock'])
    run(['python3',str(ROOT/'conformance/native_templates_probe.py')])
    run(['python3',str(ROOT/'conformance/cli_probe.py')])
finally:
    # Fixed isolated project only; preserve artifacts and all named volumes.
    subprocess.run(compose+['down'],env=env,check=False,timeout=30)
