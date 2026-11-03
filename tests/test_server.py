import functools
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Handler, initialize

class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.db=Path(self.temp.name)/'rixu.sqlite3';initialize(self.db)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,db_path=self.db))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def get(self):
        return json.load(urllib.request.urlopen(self.base+'/api/tasks'))
    def patch(self,ops,origin=None):
        headers={'Content-Type':'application/json'}
        if origin:headers['Origin']=origin
        request=urllib.request.Request(self.base+'/api/tasks',method='PATCH',headers=headers,data=json.dumps({'operations':ops}).encode())
        return json.load(urllib.request.urlopen(request))
    def create(self,id='task-a',op='op-a'):
        return {'id':id,'opId':op,'patch':{'title':'过去的阅读','date':'2026-10-31','time':'20:00','notes':'笔记','category':'学习','priority':'normal','completed':False,'completedDate':'','createdAt':'2026-11-03T10:00:00Z','updatedAt':'2026-11-03T10:00:00Z','deletedAt':None}}
    def test_persistence_backfill_and_recovery(self):
        self.assertFalse(self.get()['initialized'])
        self.patch([self.create()])
        self.patch([{'id':'task-a','opId':'done','patch':{'completed':True,'completedDate':'2026-10-31'}}])
        self.patch([{'id':'task-a','opId':'delete','patch':{'deletedAt':'2026-11-03T10:10:00Z'}}])
        self.patch([{'id':'task-a','opId':'restore','patch':{'deletedAt':None}}])
        task=self.get()['tasks'][0]
        self.assertEqual(task['completedDate'],'2026-10-31');self.assertTrue(task['completed']);self.assertIsNone(task['deletedAt'])
        with sqlite3.connect(self.db) as conn:self.assertEqual(json.loads(conn.execute('SELECT data FROM tasks').fetchone()[0]),task)
    def test_two_devices_field_merge_and_retry(self):
        self.patch([self.create()])
        self.patch([{'id':'task-a','opId':'device-a','patch':{'title':'新标题'}}])
        self.patch([{'id':'task-a','opId':'device-b','patch':{'date':'2026-11-04'}}])
        # Retrying an old create operation must not overwrite subsequent edits.
        task=self.patch([self.create()])['tasks'][0]
        self.assertEqual(task['title'],'新标题');self.assertEqual(task['date'],'2026-11-04')
    def test_invalid_batch_rolls_back(self):
        bad=self.create('bad','bad');bad['patch']['date']='2026-02-30'
        with self.assertRaises(urllib.error.HTTPError) as error:self.patch([self.create(),bad])
        self.assertEqual(error.exception.code,400);self.assertEqual(self.get()['tasks'],[])
    def test_cross_site_write_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.patch([self.create()],origin='https://other.example')
        self.assertEqual(error.exception.code,403);self.assertEqual(self.get()['tasks'],[])
    def test_invalid_import_does_not_remove_existing_data(self):
        self.patch([self.create()]);bad=self.create('bad','bad');bad['patch']['title']=' '
        with self.assertRaises(urllib.error.HTTPError):self.patch([bad])
        self.assertEqual(len(self.get()['tasks']),1)

if __name__=='__main__':unittest.main()
