"""Spike of an interface-bound control listener; no workflow/control actions."""
import argparse,fcntl,http.server,socket,struct,urllib.request

def address(interface):
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as stream:
        data=fcntl.ioctl(stream.fileno(),0x8915,struct.pack('256s',interface.encode()))
        return socket.inet_ntoa(data[20:24])

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    if args.check:
        with urllib.request.urlopen('http://'+address('eth0')+':8010',timeout=1) as reply:assert reply.status==200
    else:
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200);self.end_headers();self.wfile.write(b'front listener alive')
            def log_message(self,*args):pass
        http.server.HTTPServer((address('eth0'),8010),Handler).serve_forever()
