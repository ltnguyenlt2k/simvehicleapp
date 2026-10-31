"""API listens on Studio front only; control networks are outbound-only."""
import fcntl,os,socket,struct
import uvicorn
from service import create_app

def address():
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as stream:
        data=fcntl.ioctl(stream.fileno(),0x8915,struct.pack('256s',b'eth0'))
        return socket.inet_ntoa(data[20:24])
if __name__=='__main__':
    port=int(os.environ.get('SR_STUDIO_HTTP_PORT','3180'))
    if not 1<=port<=65535:raise ValueError('invalid public Studio port')
    app=create_app(origins=['http://127.0.0.1:'+str(port),'http://localhost:'+str(port)])
    uvicorn.run(app,host=address(),port=8010,access_log=False,limit_concurrency=32,timeout_graceful_shutdown=5)
