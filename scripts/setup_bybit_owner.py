#!/usr/bin/env python3
"""Set a separate server-only Bybit-view password interactively, never via argv.

No Bybit API access. No frontend password/default is reused. Replacing an
existing owner-password file requires --rotate and invalidates active sessions.
"""
import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import sys
import tempfile

DESTINATION = Path('/etc/crypto-dashboard/bybit-owner-auth.json')


def make_record(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 256:
        raise ValueError('Use a new private-account password of 12 to 256 characters')
    salt = secrets.token_bytes(32)
    digest = hashlib.scrypt(password.encode('utf-8'), salt=salt, n=16384, r=8, p=1,
                            dklen=64, maxmem=64*1024*1024)
    return {'version': 1, 'kdf': 'scrypt', 'N': 16384, 'r': 8, 'p': 1,
            'keylen': 64, 'salt': salt.hex(), 'password_hash': digest.hex(),
            'created_at': datetime.now(timezone.utc).isoformat()}


def save_record(record, destination=DESTINATION, *, rotate=False):
    destination = Path(destination)
    directory = destination.parent
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or stat.S_IMODE(directory.stat().st_mode) & 0o077:
        raise ValueError('The private configuration directory must be owner-only (mode 700)')
    if destination.is_symlink():
        raise ValueError('Refusing a symlink for private authentication configuration')
    if destination.exists() and not rotate:
        raise ValueError('Password already configured; use --rotate only to deliberately replace it')
    fd, temp = tempfile.mkstemp(prefix='.bybit-owner-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(record, stream, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        if rotate:
            os.replace(temp, destination)
        else:
            os.link(temp, destination)  # Exclusive creation; never silently overwrite.
        dir_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rotate', action='store_true', help='Explicitly replace the private-view password and revoke existing sessions')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.exit(1, 'Run this command with sudo.\n')
    if not sys.stdin.isatty():
        parser.exit(1, 'Use an interactive SSH terminal; passwords are not accepted through pipes or arguments.\n')
    if DESTINATION.exists() and not args.rotate:
        parser.exit(1, 'Private login already configured. Use --rotate only if you intend to change it.\n')
    try:
        password = getpass.getpass('New private Bybit-view password (not your API secret; minimum 12 characters): ')
        confirm = getpass.getpass('Confirm private password: ')
        if password != confirm:
            raise ValueError('Passwords do not match; nothing saved')
        # Prevent accidentally using venue credentials as the browser password.
        # Values remain local and are never printed or stored in the auth file.
        credential_file = DESTINATION.parent / 'bybit-readonly.env'
        if credential_file.exists():
            if credential_file.is_symlink():
                raise ValueError('Refusing a symlink for private credential configuration')
            for line in credential_file.read_text().splitlines():
                key, separator, value = line.strip().partition('=')
                if separator and key.strip() in ('BYBIT_API_KEY', 'BYBIT_API_SECRET'):
                    value = value.strip().strip('\"\'')
                    if len(value) >= 8 and value in password:
                        raise ValueError('Choose a separate owner password; never use API credentials')
        record = make_record(password)
        save_record(record, rotate=args.rotate)
    except (ValueError, OSError) as exc:
        parser.exit(1, f'Not configured: {exc}\n')
    print('Private Bybit-view login configured. No password or API credentials were printed.')
    print('Use this password only in the private Bybit account section of the website.')


if __name__ == '__main__':
    main()
