"""Install/check pinned local runtimes for Word and Excel content previews.

The site remains native ESM and does not load third-party viewers from a CDN at
runtime. This tool downloads exact, integrity-pinned archives and atomically
vendors only the browser files required by Orders.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import argparse, base64, hashlib, io, os, shutil, tarfile, tempfile, urllib.request

ROOT=Path(__file__).resolve().parents[1]
DESTINATION=ROOT/'netunim-orders/site/assets/vendor/document-viewers'
MANIFEST_NAME='_runtime-manifest.txt'

@dataclass(frozen=True)
class RuntimePackage:
    name:str;version:str;url:str;integrity:str;destination:str;candidates:tuple[str,...];license_candidates:tuple[str,...]

PACKAGES=(
    RuntimePackage('docx-preview','0.4.0','https://registry.npmjs.org/docx-preview/-/docx-preview-0.4.0.tgz','sha512-OdKtE/uj3M4RfGarLkGjahUzRg8/kBp0Sraj1r1NAY1tp/sTpHOBqDrzVf9onMBt9vxP6SdQ6bpLCUCsFwjgcA==','docx-preview/docx-preview.min.js',('dist/docx-preview.min.js',),('LICENSE','LICENSE.md','LICENSE.txt')),
    RuntimePackage('jszip','3.10.1','https://registry.npmjs.org/jszip/-/jszip-3.10.1.tgz','sha512-xXDvecyTpGLrqFrvkrUSoxxfJI5AH7U8zxxtVclpsUtMCq4JQ290LY8AW5c7Ggnr/Y/oK+bQMbqK2qmtk3pN4g==','jszip/jszip.min.js',('dist/jszip.min.js',),('LICENSE.markdown','LICENSE','LICENSE.md')),
    RuntimePackage('xlsx','0.20.3','https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz','sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==','xlsx/xlsx.full.min.js',('dist/xlsx.full.min.js','xlsx.full.min.js'),('LICENSE','LICENSE.md','LICENSE.txt')),
)

def expected_digest(integrity:str)->bytes:
    algorithm,encoded=integrity.split('-',1)
    if algorithm!='sha512':raise ValueError(f'unsupported integrity algorithm: {algorithm}')
    return base64.b64decode(encoded,validate=True)

def verify(data:bytes,pkg:RuntimePackage)->None:
    if hashlib.sha512(data).digest()!=expected_digest(pkg.integrity):raise ValueError(f'{pkg.name} {pkg.version} archive integrity mismatch')

def safe(member:tarfile.TarInfo)->bool:
    path=PurePosixPath(member.name);return not path.is_absolute() and '..' not in path.parts and (member.isfile() or member.isdir())

def relative_member(name:str)->str:
    path=PurePosixPath(name);parts=list(path.parts)
    if parts and parts[0]=='package':parts=parts[1:]
    return PurePosixPath(*parts).as_posix()

def member_for(archive:tarfile.TarFile,candidates:tuple[str,...])->tarfile.TarInfo|None:
    exact={c.replace('\\','/').lstrip('./') for c in candidates}
    rows=[]
    for member in archive.getmembers():
        if not safe(member):raise ValueError(f'unsafe archive member: {member.name}')
        if not member.isfile():continue
        rel=relative_member(member.name)
        if rel in exact:return member
        if any(rel.endswith('/'+candidate) for candidate in exact):rows.append(member)
    return rows[0] if len(rows)==1 else None

def extract_package(data:bytes,pkg:RuntimePackage,staging:Path)->None:
    verify(data,pkg)
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
        runtime=member_for(archive,pkg.candidates)
        if runtime is None:raise ValueError(f'{pkg.name} archive is missing browser runtime {pkg.candidates[0]}')
        source=archive.extractfile(runtime)
        if source is None:raise ValueError(f'cannot read {runtime.name}')
        target=staging/PurePosixPath(pkg.destination);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read())
        license_member=member_for(archive,pkg.license_candidates)
        if license_member:
            license_source=archive.extractfile(license_member)
            if license_source:
                license_target=target.parent/'LICENSE';license_target.write_bytes(license_source.read())

def digest(path:Path)->str:return hashlib.sha256(path.read_bytes()).hexdigest()
def write_manifest(destination:Path)->None:
    files=sorted(path for path in destination.rglob('*') if path.is_file() and path.name!=MANIFEST_NAME)
    lines=['runtime=netunim-document-viewers','format=1']
    for pkg in PACKAGES:lines.extend([f'{pkg.name}.version={pkg.version}',f'{pkg.name}.source={pkg.url}',f'{pkg.name}.integrity={pkg.integrity}'])
    lines.extend([f'files={len(files)}',''])
    lines.extend(f'{digest(path)}  {path.relative_to(destination).as_posix()}' for path in files)
    (destination/MANIFEST_NAME).write_text('\n'.join(lines)+'\n',encoding='utf-8',newline='\n')

def download(pkg:RuntimePackage)->bytes:
    request=urllib.request.Request(pkg.url,headers={'User-Agent':f'netunim-document-viewers/{pkg.version}','Accept':'application/octet-stream'})
    with urllib.request.urlopen(request,timeout=90) as response:data=response.read()
    if not data:raise OSError(f'downloaded {pkg.name} archive is empty')
    return data

def build_runtime(archives:dict[str,bytes],destination:Path=DESTINATION)->None:
    destination.parent.mkdir(parents=True,exist_ok=True);staging=Path(tempfile.mkdtemp(prefix='.document-viewers-',dir=destination.parent))
    try:
        for pkg in PACKAGES:
            if pkg.name not in archives:raise ValueError(f'missing archive for {pkg.name}')
            extract_package(archives[pkg.name],pkg,staging)
        write_manifest(staging)
        backup=destination.with_name(destination.name+'.previous')
        if backup.exists():shutil.rmtree(backup)
        if destination.exists():os.replace(destination,backup)
        try:os.replace(staging,destination);staging=None
        except Exception:
            if backup.exists() and not destination.exists():os.replace(backup,destination)
            raise
        finally:
            if backup.exists():shutil.rmtree(backup)
    finally:
        if staging is not None and staging.exists():shutil.rmtree(staging,ignore_errors=True)

def parse_manifest(destination:Path=DESTINATION):
    path=destination/MANIFEST_NAME
    if not path.is_file():raise FileNotFoundError(f'missing {path.relative_to(ROOT)}')
    meta,files={},{}
    for raw in path.read_text(encoding='utf-8').splitlines():
        line=raw.strip()
        if not line:continue
        if '  ' in line and len(line.split('  ',1)[0])==64:
            value,name=line.split('  ',1);files[name]=value
        elif '=' in line:
            key,value=line.split('=',1);meta[key]=value
        else:raise ValueError(f'invalid runtime manifest line: {raw!r}')
    return meta,files

def check_runtime(destination:Path=DESTINATION)->list[str]:
    try:meta,expected=parse_manifest(destination)
    except (OSError,UnicodeError,ValueError) as error:return [str(error)]
    errors=[]
    for pkg in PACKAGES:
        for key,value in ((f'{pkg.name}.version',pkg.version),(f'{pkg.name}.source',pkg.url),(f'{pkg.name}.integrity',pkg.integrity)):
            if meta.get(key)!=value:errors.append(f'manifest {key} mismatch')
    actual={p.relative_to(destination).as_posix():p for p in destination.rglob('*') if p.is_file() and p.name!=MANIFEST_NAME}
    if set(actual)!=set(expected):
        missing=sorted(set(expected)-set(actual));extra=sorted(set(actual)-set(expected))
        if missing:errors.append('missing vendored files: '+', '.join(missing))
        if extra:errors.append('unexpected vendored files: '+', '.join(extra))
    for name,path in actual.items():
        if name in expected and digest(path)!=expected[name]:errors.append(f'vendored file digest mismatch: {name}')
    for pkg in PACKAGES:
        if pkg.destination not in actual:errors.append(f'missing required runtime: {pkg.destination}')
    return errors

def install(archive_dir:Path|None=None)->None:
    archives={}
    for pkg in PACKAGES:
        if archive_dir:
            candidates=list(archive_dir.glob(f'{pkg.name}-{pkg.version}*.tgz'))
            if pkg.name=='xlsx':candidates+=list(archive_dir.glob(f'xlsx-{pkg.version}*.tgz'))
            if not candidates:raise FileNotFoundError(f'archive for {pkg.name} {pkg.version} not found in {archive_dir}')
            archives[pkg.name]=candidates[0].read_bytes()
        else:archives[pkg.name]=download(pkg)
    build_runtime(archives)

def main()->int:
    parser=argparse.ArgumentParser(description='Install/check local Word and Excel browser runtimes');subs=parser.add_subparsers(dest='command',required=True)
    p=subs.add_parser('install');p.add_argument('--archive-dir',type=Path,help='directory containing already-downloaded .tgz archives')
    subs.add_parser('check');args=parser.parse_args()
    try:
        if args.command=='install':install(args.archive_dir);print(f'Document viewer runtimes installed in {DESTINATION.relative_to(ROOT)}');return 0
        errors=check_runtime()
        if errors:
            print('Document viewer runtime verification failed:');[print('-',e) for e in errors];print('Run: npm run document-viewers:install');return 1
        print(f'Document viewer runtimes verified ({DESTINATION.relative_to(ROOT)})');return 0
    except (OSError,ValueError,tarfile.TarError) as error:print(f'ERROR: document viewer runtime operation failed: {error}');return 2
if __name__=='__main__':raise SystemExit(main())
