"""Isolated full Studio CI: production images, native mock, actual headed browser."""
import os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
ROBOT=ROOT/'robotics'
output=ROBOT/'runtime/m26';output.mkdir(parents=True,exist_ok=True)
env={**os.environ,'COMPOSE_PROJECT_NAME':'sr-studio-ci','SR_PROJECT_VOLUME':'sr-studio-ci-projects',
 'SR_ZOO_CAPABILITY_VOLUME':'sr-studio-ci-capability','SR_STUDIO_FRONT_NETWORK':'sr-studio-ci-front','SR_STUDIO_HTTP_PORT':'3181'}
compose=['docker','compose','-f',str(ROBOT/'compose.yaml'),'-f',str(ROBOT/'studio/compose.yaml')]
def run(command,timeout=300):subprocess.run(command,env=env,check=True,timeout=timeout)
try:
 run(['docker','build','-t','sr-studio-api:dev','-f',str(ROBOT/'studio/api/Dockerfile'),str(ROBOT)])
 run(['docker','run','--rm','--network','none','--read-only','--tmpfs','/tmp','--memory','256m','sr-studio-api:dev'])
 for source,target in [('sr-runner:spike','sr-runner:dev'),('sr-studio-web:spike','sr-studio-web:dev')]:run(['docker','image','tag',source,target])
 run(['docker','run','--rm','--network','none','--read-only','--tmpfs','/tmp','--env','HOME=/tmp',
      '--tmpfs','/work/node_modules/.vite-temp','--tmpfs','/work/node_modules/.vite','--tmpfs','/work/node_modules/.vitest-cache','sr-studio-web-builder:spike','npm','test'])
 run(['python3',str(ROBOT/'studio/backend_tests/qualify.py')],timeout=150)
 run(compose+['up','-d','--wait','--wait-timeout','90','protobus-mock','studio-web'],timeout=120)
 for name in ('editor-e2e.cjs','scenarios-e2e.cjs'):
  run(['docker','run','--rm','--init','--network','host','--user',f'{os.getuid()}:{os.getgid()}',
       '--read-only','--tmpfs','/tmp','--shm-size','256m','--env','STUDIO_URL=http://127.0.0.1:3181',
       '-v',str(ROBOT/'studio/web/tests')+':/opt/studio/tests:ro','-v',str(output)+':/evidence',
       'sr-studio-browser:spike','xvfb-run','-a','-s','-screen 0 1600x1000x24','node','tests/'+name],timeout=420)
finally:
 subprocess.run(compose+['logs','--no-color','--tail','40','studio-api','runner-sim'],env=env,check=False,timeout=20)
 subprocess.run(compose+['down'],env=env,check=False,timeout=40)
