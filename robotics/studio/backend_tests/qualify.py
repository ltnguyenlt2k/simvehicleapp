"""Dedicated backend fixture; no shared user projects or live provider touched."""
import os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
env={**os.environ,'COMPOSE_PROJECT_NAME':'sr-studio-backend-test',
 'SR_PROJECT_VOLUME':'sr-studio-backend-test-projects','SR_ZOO_CAPABILITY_VOLUME':'sr-studio-backend-test-capability',
 'SR_STUDIO_FRONT_NETWORK':'sr-studio-backend-test-front','SR_STUDIO_HTTP_PORT':'3180'}
compose=['docker','compose','-f',str(ROOT/'compose.yaml'),'-f',str(ROOT/'studio/compose.yaml'),'-f',str(Path(__file__).with_name('compose.yaml'))]
try:
 subprocess.run(compose+['up','-d','--wait','--wait-timeout','60','protobus-mock','studio-api'],env=env,check=True,timeout=90)
 code="""import socket,json
from pathlib import Path
blocked=[]
for host,port in [('studio-api',8010),('runner-live',8011),('protobus-live',55600),('1.1.1.1',443)]:
 try:
  connection=socket.create_connection((host,port),timeout=.5);connection.close()
 except OSError:blocked.append(host)
 else:raise AssertionError('unexpected mode/control reachability: '+host)
assert not Path('/control/zoo-key').exists()
print(json.dumps({'passed':True,'scope':'actual Studio service topology from sim runner','blocked':blocked,'zooCapabilityNotMounted':True}))
"""
 subprocess.run(compose+['exec','-T','runner-sim','python','-c',code],env=env,check=True,timeout=8)
 subprocess.run(compose+['--profile','backend-tests','run','--rm','--no-deps','backend-client'],env=env,check=True,timeout=45)
finally:
 subprocess.run(compose+['logs','--no-color','--tail','30','studio-api','runner-sim'],env=env,check=False,timeout=15)
 subprocess.run(compose+['down'],env=env,check=False,timeout=30)
