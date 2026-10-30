"""Host-only positive-test fixture: reset SIM, then wait for actual stack readiness.

This is not imported by the provider or included in its command allowlist.
It never arms the robot. Reset rejection is fatal; there is no command retry.
"""
import argparse
import subprocess


SCRIPT = r'''
import json,time,urllib.request
def post(path, payload):
    request=urllib.request.Request('http://localhost:8090'+path,
        data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    result=json.load(urllib.request.urlopen(request,timeout=5))
    assert result.get('accepted') is True, result
    return result
post('/api/control',{'action':'disarm'})
time.sleep(1)
reset=post('/api/sim',{'action':'reset'})
deadline=time.monotonic()+60
while time.monotonic()<deadline:
    state=json.load(urllib.request.urlopen('http://localhost:8090/api/state',timeout=5))
    brain=state.get('brain') or {}
    if (brain.get('scene_epoch') == reset['scene_epoch']
        and brain.get('ready') is True and brain.get('nav_ready') is True
        and not brain.get('scene_transition') and brain.get('active_motion_id') is None):
        print(json.dumps({'fixture':'actual SIM reset/readiness','passed':True,
            'scene_epoch':brain['scene_epoch'],'map_generation':brain['map_generation'],
            'mode':brain['mode']}),flush=True)
        break
    time.sleep(.1)
else:
    raise AssertionError('actual stack did not become ready after SIM reset')
'''


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gateway-container',default='dog-ros2-r1-gateway-1')
    args=parser.parse_args()
    subprocess.run(['docker','exec',args.gateway_container,'python3','-c',SCRIPT],check=True)
