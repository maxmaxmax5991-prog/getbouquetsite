import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('pb_backup', Path(__file__).with_name('pb_backup.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_restore_and_refuse_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with sqlite3.connect(root / 'data.db') as db:
                db.execute('CREATE TABLE orders (id TEXT)')
                db.execute("INSERT INTO orders VALUES ('kept')")
            archive = root / 'backup.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.write(root / 'data.db', 'data.db')
                z.writestr('storage/photo.jpg', b'photo')
            target = root / 'restore'
            backup.validate(archive, target)
            with sqlite3.connect(target / 'data.db') as db:
                self.assertEqual(db.execute('SELECT id FROM orders').fetchone(), ('kept',))
            self.assertEqual((target / 'storage/photo.jpg').read_bytes(), b'photo')
            with self.assertRaises(FileExistsError):
                backup.validate(archive, target)

    def test_reject_unsafe_paths_and_bad_database(self):
        for name in ('../escape', '/absolute', 'storage/../../escape', './data.db',
                     'storage//photo.jpg', 'data.db-wal', 'data.db'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                with zipfile.ZipFile(root / 'bad.zip', 'w') as z:
                    z.writestr(name, b'not sqlite')
                with self.assertRaises((ValueError, sqlite3.DatabaseError)):
                    backup.validate(root / 'bad.zip', root / 'restore')
                self.assertFalse((root / 'restore').exists())


if __name__ == '__main__':
    unittest.main()
