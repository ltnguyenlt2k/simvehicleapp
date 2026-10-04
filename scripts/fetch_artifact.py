#!/usr/bin/env python3
"""Download a GitHub Actions artifact with parallel HTTP range requests.

The artifact blob store serves a single connection at ~0.1 MB/s on some networks, while 16 ranged
connections reach ~25 MB/s, so `gh run download` of the ~700 MB studio image takes hours but this
takes about a minute. The signed blob URL expires quickly, so every (re)try asks the API for a
fresh one. Output: the artifact zip; `--extract DIR` also unpacks it.

  python3 scripts/fetch_artifact.py --repo owner/name --artifact 123 --out a.zip [--extract dir]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import os
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile

API = "https://api.github.com"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401 - keep the Location for ourselves
        return None


def token() -> str:
    return os.environ.get("GITHUB_TOKEN") or subprocess.run(
        ["gh", "auth", "token"], check=True, capture_output=True, text=True
    ).stdout.strip()


def api_json(path: str, tok: str) -> dict:
    import json

    req = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def signed_url(repo: str, artifact: int, tok: str) -> str:
    opener = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(f"{API}/repos/{repo}/actions/artifacts/{artifact}/zip", headers={"Authorization": f"Bearer {tok}"})
    try:
        opener.open(req, timeout=30)
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307) and e.headers.get("Location"):
            return e.headers["Location"]
        raise
    raise RuntimeError("artifact download did not redirect to blob storage")


def fetch_range(repo: str, artifact: int, tok: str, path: str, start: int, end: int, attempts: int = 5) -> None:
    last: Exception | None = None
    for _ in range(attempts):
        try:
            req = urllib.request.Request(signed_url(repo, artifact, tok), headers={"Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(req, timeout=120) as r, open(path, "r+b") as f:
                f.seek(start)
                expected = end - start + 1
                got = 0
                while chunk := r.read(1 << 20):
                    f.write(chunk)
                    got += len(chunk)
                if got != expected:
                    raise IOError(f"range {start}-{end}: got {got} of {expected} bytes")
                return
        except Exception as e:  # retry with a fresh signed URL
            last = e
    raise RuntimeError(f"range {start}-{end} failed after {attempts} attempts: {last}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--artifact", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--extract")
    ap.add_argument("--parts", type=int, default=16)
    args = ap.parse_args()

    tok = token()
    size = int(api_json(f"/repos/{args.repo}/actions/artifacts/{args.artifact}", tok)["size_in_bytes"])
    # size_in_bytes is the uncompressed size; ask the blob for the real zip length.
    head = urllib.request.Request(signed_url(args.repo, args.artifact, tok), headers={"Range": "bytes=0-0"})
    with urllib.request.urlopen(head, timeout=30) as r:
        total = int(r.headers["Content-Range"].split("/")[1])
    print(f"fetch-artifact: {args.artifact} ({total / 1e6:.0f} MB zip, {size / 1e6:.0f} MB content) in {args.parts} parts", flush=True)

    with open(args.out, "wb") as f:
        f.truncate(total)
    step = -(-total // args.parts)
    ranges = [(s, min(s + step, total) - 1) for s in range(0, total, step)]
    with cf.ThreadPoolExecutor(max_workers=args.parts) as pool:
        for fut in cf.as_completed([pool.submit(fetch_range, args.repo, args.artifact, tok, args.out, s, e) for s, e in ranges]):
            fut.result()

    with zipfile.ZipFile(args.out) as z:
        bad = z.testzip()
        if bad is not None:
            raise RuntimeError(f"corrupt member {bad} in {args.out}")
        if args.extract:
            z.extractall(args.extract)
    print(f"fetch-artifact: OK {args.out}" + (f" → {args.extract}" if args.extract else ""), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
