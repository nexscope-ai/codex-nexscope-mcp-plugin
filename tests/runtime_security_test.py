"""Run with python3 tests/runtime_security_test.py; no service calls or credentials."""
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch, MagicMock
from zipfile import ZipFile

WHEEL = Path(__file__).resolve().parents[1] / 'runtime/nexscope_cli-0.1.1-py3-none-any.whl'


class RuntimeSecurityTest(unittest.TestCase):
    def test_email_requires_confirmation(self):
        module = types.ModuleType('email_notification')
        with ZipFile(WHEEL) as archive:
            exec(compile(archive.read('nexscope_cli/skills/product-ai-visibility/scripts/send_report_email.py'), 'send_report_email.py', 'exec'), module.__dict__)
        with patch.object(module.urllib.request, 'urlopen') as send:
            self.assertFalse(module.send_report_email('Product', '/missing', 'https://example.com/report')['success'])
            send.assert_not_called()
            response = MagicMock()
            response.status = 200
            response.read.return_value = b'{"code":0}'
            send.return_value.__enter__.return_value = response
            with patch.dict(module.os.environ, {'NEXSCOPE_PROXY_BASE': 'https://example.com', 'NEXSCOPE_API_KEY': 'test-only'}):
                self.assertTrue(module.send_report_email('Product', '/missing', 'https://example.com/report', confirmed=True)['success'])
            self.assertEqual(send.call_count, 1)

    def test_wheel_integrity_and_catalog(self):
        with ZipFile(WHEEL) as archive:
            catalog = json.loads(archive.read('nexscope_cli/catalog.json'))['skills']
            self.assertEqual(len(catalog), 138)
            self.assertEqual(sum(item['available'] is True for item in catalog.values()), 136)
            for key, item in catalog.items():
                for path, digest in item['files'].items():
                    self.assertEqual(hashlib.sha256(archive.read(f'nexscope_cli/skills/{key}/{path}')).hexdigest(), digest)
            record = next(name for name in archive.namelist() if name.endswith('.dist-info/RECORD'))
            for name, digest, size in csv.reader(io.StringIO(archive.read(record).decode())):
                if name == record:
                    continue
                data = archive.read(name)
                self.assertEqual(int(size), len(data))
                self.assertEqual(digest, 'sha256=' + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('='))


if __name__ == '__main__':
    unittest.main()
