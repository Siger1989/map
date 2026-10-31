import json
import secrets
import socket
import subprocess
import threading
import time
import argparse
import os
import imageio_ffmpeg
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser(description='Loopback-only native APK video and touch preview')
parser.add_argument('--adb', default=os.environ.get('ADB', 'adb'))
parser.add_argument('--serial', required=True)
parser.add_argument('--port', type=int, default=9174)
args = parser.parse_args()
ADB = args.adb
DEVICE = args.serial
lock = threading.Lock()
touch_lock = threading.Lock()
TOKEN = secrets.token_urlsafe(24)
cached = b''
captured_at = 0.0
frame_ready = threading.Condition()
frame_sequence = 0

def stream_frames():
    global cached, frame_sequence
    while True:
        encoder = decoder = None
        try:
            encoder = subprocess.Popen([ADB,'-s',DEVICE,'exec-out','screenrecord','--output-format=h264','--size','872x1920','--bit-rate','8000000','--time-limit','180','-'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
            decoder = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(),'-loglevel','error','-flags','low_delay','-probesize','32','-analyzeduration','0','-f','h264','-i','pipe:0','-an','-threads','1','-fps_mode','passthrough','-q:v','2','-f','image2pipe','-vcodec','mjpeg','pipe:1'],stdin=encoder.stdout,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
            encoder.stdout.close()
            pending=b''
            while True:
                chunk=decoder.stdout.read1(65536)
                if not chunk: break
                pending+=chunk
                while True:
                    start=pending.find(b'\xff\xd8')
                    end=pending.find(b'\xff\xd9',start+2) if start>=0 else -1
                    if end<0: break
                    with frame_ready:
                        cached=pending[start:end+2]
                        frame_sequence+=1
                        frame_ready.notify_all()
                    pending=pending[end+2:]
        except Exception:
            pass
        finally:
            for process in (decoder,encoder):
                if process is not None and process.poll() is None: process.terminate()
        time.sleep(.5)
HTML = '''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>山兔 · 原生APK交互预览</title><style>html,body{margin:0;background:#111b19;color:#e5eee9;font:12px system-ui;height:100%;overflow:hidden}header{height:40px;display:flex;justify-content:center;align-items:center;gap:8px}main{height:calc(100% - 40px);display:flex;justify-content:center}img{height:100%;max-width:100%;object-fit:contain;touch-action:none;user-select:none;-webkit-user-drag:none;cursor:grab}button{color:#e5eee9;background:#35443e;border:0;border-radius:4px;padding:5px 9px}span{color:#ccdf83}#status{position:fixed;bottom:4px;left:4px;max-width:190px;color:#cbd6ce;font-size:10px}</style><header><span>实际APK · 可点击拖动</span><button id="back">返回</button><button id="zin">＋</button><button id="zout">－</button></header><main><img id="screen" draggable="false" alt="正在获取原生地图画面"></main><div id="status">滚轮缩放；触屏双指松开后缩放。画面有传输延迟。</div><script>
const s=document.getElementById('screen'),status=document.getElementById('status');let chain=Promise.resolve(),active=false,pending=null,lastWheel=0,pointers=new Map(),pinchStart=0,pinchEnd=null;
function send(v){chain=chain.then(async()=>{let r=await fetch('/input',{method:'POST',headers:{'Content-Type':'application/json','X-Preview-Token':'__TOKEN__'},body:JSON.stringify(v)});let x=await r.json();if(!x.ok)throw Error(x.error||'连接暂不可用');status.textContent='已连接实际APK · 滚轮缩放，拖动平移；画面有传输延迟';}).catch(e=>status.textContent=e.message);return chain}
function pos(e){let r=s.getBoundingClientRect(),w=s.naturalWidth||1256,h=s.naturalHeight||2760,k=Math.min(r.width/w,r.height/h),ox=(r.width-w*k)/2,oy=(r.height-h*k)/2;return {x:Math.max(0,Math.min(w-1,Math.round((e.clientX-r.left-ox)/k))),y:Math.max(0,Math.min(h-1,Math.round((e.clientY-r.top-oy)/k)))}}
function flush(){if(pending){send({action:'move',...pending});pending=null}}setInterval(flush,60);
s.onpointerdown=e=>{e.preventDefault();s.setPointerCapture(e.pointerId);let p=pos(e);pointers.set(e.pointerId,p);if(pointers.size===1){active=true;send({action:'down',...p})}else if(pointers.size===2){flush();send({action:'cancel',...p});active=false;let a=[...pointers.values()];pinchStart=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);pinchEnd=a}};
s.onpointermove=e=>{if(!pointers.has(e.pointerId))return;e.preventDefault();let p=pos(e);pointers.set(e.pointerId,p);if(active)pending=p;else if(pointers.size===2)pinchEnd=[...pointers.values()]};
s.onpointerup=e=>{e.preventDefault();if(active){flush();send({action:'up',...pos(e)});active=false}else if(pinchStart&&pinchEnd){let a=pinchEnd,d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);send({action:'pinch',x:Math.round((a[0].x+a[1].x)/2),y:Math.round((a[0].y+a[1].y)/2),factor:Math.max(.4,Math.min(2.5,d/pinchStart))});pinchStart=0}pointers.delete(e.pointerId)};
s.onpointercancel=e=>{pending=null;pointers.delete(e.pointerId);if(active)send({action:'cancel',...pos(e)});active=false;pinchStart=0};s.oncontextmenu=e=>e.preventDefault();s.onwheel=e=>{e.preventDefault();if(Date.now()-lastWheel<150)return;lastWheel=Date.now();send({action:'pinch',...pos(e),factor:e.deltaY<0?1.25:.8})};
document.getElementById('back').onclick=()=>send({action:'key',code:4});document.getElementById('zin').onclick=()=>send({action:'pinch',x:628,y:1380,factor:1.3});document.getElementById('zout').onclick=()=>send({action:'pinch',x:628,y:1380,factor:1/1.3});function next(){s.src='/frame.jpg?t='+Date.now()}s.onload=()=>setTimeout(next,120);s.onerror=()=>setTimeout(next,1000);next();
</script></html>'''.replace('__TOKEN__',TOKEN)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        global cached, captured_at
        if self.path.startswith('/stream.mjpg'):
            self.send_response(200)
            self.send_header('Content-Type','multipart/x-mixed-replace; boundary=frame')
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            previous=-1
            try:
                while True:
                    with frame_ready:
                        frame_ready.wait_for(lambda: frame_sequence!=previous,timeout=5)
                        data=cached
                        previous=frame_sequence
                    if data:
                        self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: '+str(len(data)).encode()+b'\r\n\r\n'+data+b'\r\n')
                        self.wfile.flush()
            except (BrokenPipeError,ConnectionResetError): pass
            return
        if self.path.startswith('/frame.jpg'):
            with frame_ready: data,kind=cached,'image/jpeg'
        else:
            data, kind = HTML.encode('utf-8'), 'text/html; charset=utf-8'
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != '/input' or self.headers.get('X-Preview-Token') != TOKEN:
            self.send_error(403)
            return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0 < length < 2048: raise ValueError('invalid input')
            command=json.loads(self.rfile.read(length))
            if command.get('action') not in ('down','move','up','cancel','pinch','key','tap'): raise ValueError('invalid action')
            with touch_lock, socket.create_connection(('127.0.0.1',23458),timeout=2) as connection:
                connection.sendall((json.dumps(command)+'\n').encode('utf-8'))
                response=connection.makefile('rb').readline(4096)
            result=json.loads(response)
        except Exception:
            result={'ok':False,'error':'触控连接暂未就绪，正在连接模拟器'}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)

HTML = HTML.replace('w=s.naturalWidth||1256,h=s.naturalHeight||2760','w=1256,h=2760').replace("s.src='/frame.jpg?t='","s.src='/stream.mjpg?t='").replace('s.onload=()=>setTimeout(next,120);','').replace('实际APK · 可点击拖动','实际APK · 实时操作')
threading.Thread(target=stream_frames,daemon=True).start()
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
