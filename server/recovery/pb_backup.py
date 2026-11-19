#!/usr/bin/env python3
"""Validate a native PocketBase ZIP; optionally restore into a new directory.

Does not start PocketBase or execute hooks/migrations from the archive.
"""
import argparse
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import tempfile
import zipfile


def validate(archive, target=None):
    with zipfile.ZipFile(archive) as source:
        names = set()
        for entry in source.infolist():
            path = PurePosixPath(entry.filename)
            mode = entry.external_attr >> 16
            if (path.is_absolute() or '..' in path.parts or '\\' in entry.filename
                    or entry.filename.rstrip('/') != str(path)
                    or not path.parts or entry.filename in names
                    or stat.S_ISLNK(mode)
                    or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR))):
                raise ValueError('Unsafe or duplicate archive entry')
            names.add(entry.filename)
        if 'data.db' not in names:
            raise ValueError('Native PocketBase backup must contain data.db at root')
        # Never restore hot SQLite sidecars over the consistent backup database.
        if any(n.endswith(('-wal', '-shm', '-journal')) for n in names):
            raise ValueError('Unexpected SQLite sidecar in native backup')
        bad = source.testzip()
        if bad:
            raise ValueError('ZIP checksum failed')
        with tempfile.TemporaryDirectory(prefix='pb-check-') as scratch:
            for name in ('data.db', 'auxiliary.db'):
                if name not in names:
                    continue
                db = Path(scratch) / name
                with source.open(name) as incoming, db.open('wb') as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True) as connection:
                    if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                        raise ValueError('SQLite integrity check failed')
        if target is not None:
            # Exclusive creation: do not overwrite a live or existing database.
            target = Path(target)
            target.mkdir(mode=0o700, parents=False, exist_ok=False)
            try:
                source.extractall(target)
                for root, dirs, files in os.walk(target):
                    os.chmod(root, 0o700)
                    for name in files:
                        os.chmod(Path(root) / name, 0o600)
            except BaseException:
                shutil.rmtree(target)
                raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--restore-to', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    validate(args.archive, args.restore_to)
    print('Backup validated' + (' and extracted; PocketBase remains stopped' if args.restore_to else ''))
