"""Bind control only; broker bus interface must never expose HTTP control."""
import fcntl,socket,struct
import uvicorn
from service import create_app

def interface_address(name):
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as stream:
        data=fcntl.ioctl(stream.fileno(),0x8915,struct.pack('256s',name.encode()))
        return socket.inet_ntoa(data[20:24])

if __name__=='__main__':
    uvicorn.run(create_app(),host=interface_address('eth0'),port=8011,access_log=False,
                limit_concurrency=32,timeout_graceful_shutdown=6)
