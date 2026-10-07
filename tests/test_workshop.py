import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from community.packages import SCHEMA, parse_package, predict
from serve import WorkshopServer

def sample(name='Prueba',language='LESCO',value=0.0):
    return dict(schema=SCHEMA,name=name,language=language,description='Sintética',samples=[[value]*63 for _ in range(30)],radius=.05)

class PackageTests(unittest.TestCase):
    def test_invalid_coordinates(self):
        for invalid in (float('nan'),float('inf'),True,'0',11):
            data=sample();data['samples'][0][0]=invalid
            with self.assertRaises(ValueError):parse_package(data)
    def test_rejection_and_language(self):
        package=parse_package(sample())
        self.assertEqual(predict([package],[0.0]*63,'LESCO'),'Prueba')
        self.assertIsNone(predict([package],[1.0]*63,'LESCO'))
        self.assertIsNone(predict([package],[0.0]*63,'ASL'))
    def test_ambiguous_rejected(self):
        self.assertIsNone(predict([parse_package(sample()),parse_package(sample('Otra'))],[0.0]*63,'LESCO'))
    def test_schema_and_size(self):
        for key,value in [('schema','v0'),('samples',[[0.0]*63]),('radius',1),('language','FAKE'),('name','')]:
            data=sample();data[key]=value
            with self.assertRaises(ValueError):parse_package(data)

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.server=WorkshopServer(('127.0.0.1',0),Path(self.temp.name)/'db.sqlite3')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def request(self,path,body=None,token=None,method=None):
        headers={'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        req=Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
        try:
            with urlopen(req) as response:return response.status,json.load(response)
        except HTTPError as error:return error.code,json.load(error)
    def register(self,user):
        status,data=self.request('/api/register',dict(username=user,password='test-password-123'))
        self.assertEqual(status,200);return data['token']
    def test_publish_download_delete_ownership(self):
        body=dict(package=sample(),consent=True)
        self.assertEqual(self.request('/api/packages',body)[0],401)
        owner=self.register('owner');other=self.register('other')
        self.assertEqual(self.request('/api/packages',dict(package=sample(),consent=False),owner)[0],400)
        status,data=self.request('/api/packages',body,owner);self.assertEqual(status,201);identity=data['id']
        self.assertEqual(len(self.request('/api/packages')[1]['items']),1)
        self.assertEqual(self.request('/api/packages/'+identity)[1],sample())
        self.assertEqual(self.request('/api/packages/'+identity,token=other,method='DELETE')[0],404)
        self.assertEqual(self.request('/api/packages/'+identity,token=owner,method='DELETE')[0],200)
        self.assertEqual(self.request('/api/packages/'+identity)[0],404)
    def test_credentials_and_validation(self):
        token=self.register('tester')
        self.assertEqual(self.request('/api/login',dict(username='tester',password='wrong-password-123'))[0],401)
        broken=sample();broken['samples'][0][0]=float('nan')
        self.assertEqual(self.request('/api/packages',dict(package=broken,consent=True),token)[0],400)
    def test_no_private_files(self):
        for path in ['/../config.py','/%2e%2e/serve.py','/.env','/var/workshop.sqlite3']:
            with self.assertRaises(HTTPError) as caught:urlopen(self.base+path)
            self.assertEqual(caught.exception.code,404)

if __name__=='__main__':unittest.main()
