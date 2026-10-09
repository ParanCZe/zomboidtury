"""Build a static, same-origin Kino pack from a pinned public upstream manifest."""
import argparse, concurrent.futures, hashlib, json, pathlib, subprocess, shutil

def fetch_file(entry, destination, upstream):
    path = pathlib.PurePosixPath(entry['path'])
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Invalid manifest path')
    target = destination.joinpath(*path.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.stat().st_size == entry['size']:
        if hashlib.file_digest(target.open('rb'), 'sha256').hexdigest() == entry['sha256']:
            return
    temp = target.with_name(target.name + '.download')
    subprocess.run(['curl', '--fail', '--location', '--retry', '3', '--max-time', '600', '--output', str(temp), upstream + '/'.join(path.parts)], check=True)
    if temp.stat().st_size != entry['size'] or hashlib.file_digest(temp.open('rb'), 'sha256').hexdigest() != entry['sha256']:
        temp.unlink(missing_ok=True)
        raise ValueError('Upstream integrity mismatch: ' + str(path))
    temp.replace(target)
    print('Verified:', path, flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--destination', default='site/game')
    args = parser.parse_args()
    destination = pathlib.Path(args.destination)
    manifest = json.loads(pathlib.Path('kino-manifest.json').read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        jobs = [pool.submit(fetch_file, f, destination, 'https://cdn.vel.gg/packs/kino/') for f in manifest['files']]
        for job in jobs: job.result()
    shutil.copyfile('kino-manifest.json', destination / 'manifest.json')

if __name__ == '__main__': main()
