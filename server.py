#!/usr/bin/env python3
"""日序本机原型服务。无第三方依赖，默认只监听本机。"""
import argparse
import datetime as dt
import json
import re
import sqlite3
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
FIELDS = {'title','date','time','notes','category','priority','completed','completedDate','createdAt','updatedAt','deletedAt'}

def valid_date(value, optional=True):
    if optional and value == '': return True
    try:
        return isinstance(value,str) and '1900-01-01' <= value <= '2200-12-31' and dt.date.fromisoformat(value).isoformat() == value
    except (ValueError,TypeError): return False

def validate(task):
    if not isinstance(task.get('title'),str) or not 1 <= len(task['title'].strip()) <= 200: raise ValueError('无效标题')
    if not valid_date(task.get('date')): raise ValueError('无效日期')
    if not isinstance(task.get('notes'),str) or len(task['notes']) > 10000: raise ValueError('无效备注')
    if task.get('category') not in ('生活','学习','工作') or task.get('priority') not in ('normal','high'): raise ValueError('无效分类或优先级')
    if not isinstance(task.get('completed'),bool): raise ValueError('无效完成状态')
    if not valid_date(task.get('completedDate','')): raise ValueError('无效完成日期')
    time = task.get('time','')
    if not isinstance(time,str) or (time and (not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d',time) or not task['date'])): raise ValueError('无效时间')
    for field in ('createdAt','updatedAt','deletedAt'):
        value=task.get(field)
        if value is not None and (not isinstance(value,str) or len(value)>50): raise ValueError('无效时间戳')

def initialize(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);')

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,db_path,**kwargs):
        self.db_path=db_path
        super().__init__(*args,directory=str(ROOT/'public'),**kwargs)

    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','same-origin')
        if self.path.endswith(('sw.js','app.js','style.css','.html')) or self.path == '/': self.send_header('Cache-Control','no-cache')
        super().end_headers()

    def json_response(self,status,data):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

    def get_data(self,conn):
        return {'tasks':[json.loads(row[0]) for row in conn.execute('SELECT data FROM tasks ORDER BY id')], 'initialized':bool(conn.execute("SELECT 1 FROM metadata WHERE key='initialized'").fetchone())}

    def do_GET(self):
        path=urlsplit(self.path).path
        if path == '/runtime-config.js':
            body=b"window.RIXU_CONFIG = {storage: 'server'};"
            self.send_response(200);self.send_header('Content-Type','application/javascript; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            return
        if path == '/api/tasks':
            with sqlite3.connect(self.db_path) as conn: return self.json_response(200,self.get_data(conn))
        if path == '/api/health': return self.json_response(200,{'ok':True,'app':'rixu'})
        if path.startswith('/api/'): return self.json_response(404,{'error':'不存在的接口'})
        super().do_GET()

    def do_PATCH(self):
        if urlsplit(self.path).path != '/api/tasks': return self.json_response(404,{'error':'不存在的接口'})
        # 拒绝跨站请求，避免其他网页向本机服务写入数据。
        origin=self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'): return self.json_response(403,{'error':'不接受跨站写入'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<=0 or length>10*1024*1024: return self.json_response(413,{'error':'请求体大小不合适'})
            payload=json.loads(self.rfile.read(length))
            ops=payload.get('operations')
            if not isinstance(ops,list) or len(ops)>10000: raise ValueError('无效操作列表')
            with sqlite3.connect(self.db_path,timeout=15) as conn:
                conn.execute('BEGIN IMMEDIATE')
                for op in ops:
                    task_id,op_id,patch=op.get('id'),op.get('opId'),op.get('patch')
                    if not isinstance(task_id,str) or not 1<=len(task_id)<=100 or not isinstance(op_id,str) or not 1<=len(op_id)<=100 or not isinstance(patch,dict) or set(patch)-FIELDS: raise ValueError('无效操作')
                    if conn.execute('SELECT 1 FROM operations WHERE id=?',(op_id,)).fetchone(): continue
                    row=conn.execute('SELECT data FROM tasks WHERE id=?',(task_id,)).fetchone()
                    task=json.loads(row[0]) if row else {'id':task_id}
                    task.update(patch);validate(task)
                    conn.execute('INSERT INTO tasks (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',(task_id,json.dumps(task,ensure_ascii=False)))
                    conn.execute('INSERT INTO operations (id) VALUES (?)',(op_id,))
                conn.execute("INSERT OR REPLACE INTO metadata VALUES ('initialized','1')")
                result=self.get_data(conn)
            self.json_response(200,result)
        except (ValueError,TypeError,AttributeError,KeyError) as error: self.json_response(400,{'error':str(error)})
        except sqlite3.Error: self.json_response(503,{'error':'保存暂时失败，请稍后重试'})

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description='日序个人计划原型')
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--data-dir',type=Path,default=ROOT/'data')
    args=parser.parse_args();db=args.data_dir/'rixu.sqlite3';initialize(db)
    server=ThreadingHTTPServer((args.host,args.port),partial(Handler,db_path=db))
    print(f'日序已启动：http://{args.host}:{args.port}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
