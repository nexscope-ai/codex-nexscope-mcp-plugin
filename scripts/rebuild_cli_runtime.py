#!/usr/bin/env python3
"""Rebuild the scoped CLI wheel from the unchanged, pinned upstream wheel."""
import argparse
import base64
import csv
import hashlib
import io
from pathlib import Path
import subprocess
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA256 = '027aee2cd223adaadfb88bb01ed56805281ca7071e873d7a043c2291950ee553'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('upstream_wheel', type=Path)
    args = parser.parse_args()
    if hashlib.sha256(args.upstream_wheel.read_bytes()).hexdigest() != BASE_SHA256:
        parser.error('Unexpected upstream wheel')
    with ZipFile(args.upstream_wheel) as archive, tempfile.TemporaryDirectory() as tmp:
        names = archive.namelist()
        archive.extractall(tmp)  # Hash-pinned, known package paths.
        subprocess.run(['patch', '-p0', '--batch', '-i', str(ROOT / 'runtime/compliance.patch')], cwd=tmp, check=True, stdout=subprocess.DEVNULL)
        contents = {name: (Path(tmp) / name).read_bytes() for name in names}
    record = next(name for name in names if name.endswith('.dist-info/RECORD'))
    output = io.StringIO()
    writer = csv.writer(output, lineterminator='\n')
    for name, data in contents.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('=')
        writer.writerow([name, '', ''] if name == record else [name, 'sha256=' + digest, len(data)])
    contents[record] = output.getvalue().encode()
    destination = ROOT / 'runtime/nexscope_cli-0.1.1-py3-none-any.whl'
    with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
        for name, data in contents.items():
            # Stable timestamps make repeated builds byte-identical.
            from zipfile import ZipInfo
            info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)
    print(hashlib.sha256(destination.read_bytes()).hexdigest(), destination.stat().st_size)


if __name__ == '__main__':
    main()
