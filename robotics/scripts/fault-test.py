"""Docker host orchestrator; no container receives Docker socket/host privileges."""
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT/'runtime/m23/process-faults'
COMPOSE = ['docker', 'compose', '-f', str(ROOT/'compose.yaml')]


def command(*args, check=True):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        raise RuntimeError(f'{args}: {result.stderr}')
    return result.stdout.strip()


def read(name, file, timeout=30):
    deadline = time.monotonic()+timeout
    target = OUTPUT/(name+'-'+file+'.json')
    target.unlink(missing_ok=True)
    while time.monotonic() < deadline:
        value = command('docker', 'exec', name, 'cat', '/tmp/'+file+'.json', check=False)
        if value:
            target.write_text(value)
            return json.loads(value)
        time.sleep(.1)
    raise TimeoutError(file)


def mark(name, file, data):
    command('docker', 'exec', name, 'python', '-c',
        'import pathlib,sys;pathlib.Path(sys.argv[1]).write_text(sys.argv[2])',
        '/tmp/'+file+'.json', json.dumps(data))


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    observer = 'sr-fault-observer'
    command('docker', 'network', 'create', '--internal', observer)
    results = []
    try:
        for case in ('broker-restart', 'provider-restart', 'network-flap'):
            name = 'sr-fault-'+case
            command(*COMPOSE, 'up', '-d', '--force-recreate', '--wait', '--wait-timeout', '60')
            broker = command(*COMPOSE, 'ps', '-q', 'protobus-sim')
            provider = command(*COMPOSE, 'ps', '-q', 'protobus-mock')
            networks = json.loads(command('docker', 'inspect', broker))[0]['NetworkSettings']['Networks']
            network = next(iter(networks))
            command('docker', 'network', 'connect', '--alias', 'mock-observer', observer, provider)
            command('docker', 'create', '--name', name, '--network', observer,
                '--cpus', '1', '--memory', '128m', '--read-only', '--tmpfs', '/tmp',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                'sr-protobus:dev', 'python', '-m', 'fault_probe')
            command('docker', 'network', 'connect', network, name)
            command('docker', 'start', name)
            try:
                ready = read(name, 'ready')
                started = time.monotonic()
                if case == 'broker-restart':
                    command('docker', 'kill', broker)
                elif case == 'provider-restart':
                    command('docker', 'kill', provider)
                else:
                    command('docker', 'network', 'disconnect', network, provider)
                mark(name, 'fault', {'case': case, 'started': started})
                safe = read(name, 'safe', 10)
                if case == 'broker-restart':
                    command('docker', 'start', broker)
                elif case == 'provider-restart':
                    command('docker', 'start', provider)
                else:
                    command('docker', 'network', 'connect', '--alias', 'protobus-mock', network, provider)
                mark(name, 'restored', {})
                result = read(name, 'result')
                result.update(ready=ready, safe=safe)
                (OUTPUT/(case+'.json')).write_text(json.dumps(result, indent=2)+'\n')
                assert result['passed'], result
                results.append(result)
                print(case, 'PASS', round(safe['observedAfterSeconds'], 3), 's', flush=True)
            finally:
                (OUTPUT/(case+'.log')).write_text(command('docker', 'logs', name, check=False))
                command('docker', 'rm', '-f', name, check=False)
        (OUTPUT/'summary.json').write_text(json.dumps(results, indent=2)+'\n')
    finally:
        command('docker', 'network', 'disconnect', observer,
            command(*COMPOSE, 'ps', '-q', 'protobus-mock'), check=False)
        command('docker', 'network', 'rm', observer, check=False)
        command(*COMPOSE, 'up', '-d', '--wait', '--wait-timeout', '60')


if __name__ == '__main__':
    main()
