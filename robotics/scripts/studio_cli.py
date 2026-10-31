"""WSL/Linux production-image lifecycle; no Docker socket enters a service."""
import argparse,datetime,fcntl,os,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
COMPOSE=['docker','compose','-f',str(ROOT/'compose.yaml'),'-f',str(ROOT/'studio/compose.yaml')]
def run(command,env=None):subprocess.run(command,env=env,check=True)
def main():
    parser=argparse.ArgumentParser(description='Independent Robot Studio, local simulation only')
    parser.add_argument('action',choices=['build','up','down','status','demo-video'])
    parser.add_argument('--live',action='store_true');parser.add_argument('--authorize-sim-arm',action='store_true')
    parser.add_argument('--out')
    args=parser.parse_args()
    if args.authorize_sim_arm and (not args.live or args.action!='up'):parser.error('--authorize-sim-arm requires up --live')
    env=dict(os.environ)
    if args.authorize_sim_arm:env['SR_AUTHORIZE_SIM_ARM']='true'
    if args.action=='build':
        for context,tag,file in [('contracts','sr-contracts:dev',None),('rss','sr-rss:dev',None),('protobus','sr-protobus:dev',None),('robotflow','sr-robotflow:dev',None),('rfrt','sr-rfrt:dev',None),('','sr-rflowc-api:dev','robotflow/service.Dockerfile'),('','sr-runner:dev','runner/Dockerfile'),('','sr-studio-api:dev','studio/api/Dockerfile'),('studio/web','sr-studio-web:dev',None)]:
            command=['docker','build','-t',tag]
            if file:command+=['-f',str(ROOT/file)]
            run(command+[str(ROOT/context)])
        if args.live:run(['docker','build','-t','sr-protobus-ros2:dev','-f',str(ROOT/'protobus/bridge-ros2.Dockerfile'),str(ROOT/'protobus')])
    elif args.action=='up':
        services=['protobus-mock','studio-web']+(['protobus-ros2'] if args.live else [])
        run(COMPOSE+(['--profile','live'] if args.live else [])+['up','-d','--wait','--wait-timeout','90']+services,env)
        print('Robot Studio: http://127.0.0.1:'+env.get('SR_STUDIO_HTTP_PORT','3180'))
        print('Build/Deploy never starts or Arms a robot; use explicit Start.')
    elif args.action=='down':
        run(COMPOSE+['stop','-t','8','runner-sim','runner-live'],env)
        run(COMPOSE+['stop','studio-web','studio-api','rflowc'],env)
    elif args.action=='status':run(COMPOSE+['ps'],env)
    else:
        if args.live or args.authorize_sim_arm:parser.error('demo-video uses the documented local simulation endpoints')
        slug=args.out or 'video-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}',slug):parser.error('--out must be a simple evidence directory name')
        output=ROOT/'runtime/m27'/slug;output.mkdir(parents=True,exist_ok=False)
        run(['docker','build','--target','builder','-t','sr-studio-web-builder:dev',str(ROOT/'studio/web')])
        run(['docker','build','-f',str(ROOT/'studio/web/recording.Dockerfile'),'-t','sr-studio-recorder:dev',str(ROOT/'studio/web')])
        # Serializes real ROS tests and screen recordings across invocations.
        with open('/tmp/sr-live-ui.lock','a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            run(['docker','run','--rm','--init','--network','host','--user',f'{os.getuid()}:{os.getgid()}',
                 '--read-only','--tmpfs','/tmp','--shm-size','512m','-v',str(ROOT/'studio/web/tests')+':/opt/studio/tests:ro',
                 '-v',str(output)+':/evidence','sr-studio-recorder:dev','xvfb-run','-a','-s','-screen 0 1600x1000x24','node','tests/full-flow-video.cjs'])
        print(output/'full-flow.mp4')
if __name__=='__main__':main()
