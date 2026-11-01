"""Verify a completed authoring batch, then publish content-addressed A1 MP3 assets."""
import hashlib, json, shutil, subprocess, wave
from pathlib import Path

root=Path(__file__).resolve().parents[1]
cache=root/'build/sentence-audio-a1'
source=json.loads((root/'public/data/sentences-a1.json').read_text())
batch=json.loads((cache/'manifest.json').read_text())
voices=['de-DE-KatjaNeural','de-DE-ConradNeural']
assert batch['status']=='complete', 'Generate the complete A1 batch before publication'
assert len(batch['entries'])==len(source), 'The batch must cover the current A1 source'
assert [e['id'] for e in batch['entries']]==[r['id'] for r in source], 'Source IDs changed'
assert [e['text'] for e in batch['entries']]==[r['target'] for r in source], 'Source text changed'
afconvert=shutil.which('afconvert');ffmpeg=shutil.which('ffmpeg')
if not afconvert and not ffmpeg:raise RuntimeError('An audio decoder is required: macOS afconvert or FFmpeg')
entries=[]
for index,entry in enumerate(batch['entries']):
 assert entry['voice']==voices[index%2], 'Unexpected voice assignment'
 path=cache/Path(entry['file']).name
 data=path.read_bytes();digest=hashlib.sha256(data).hexdigest()
 assert digest==entry['sha256'], f'Checksum mismatch: {entry["id"]}'
 decoded=cache/'validation.wav'
 command=[afconvert,str(path),str(decoded),'-f','WAVE','-d','LEI16'] if afconvert else [ffmpeg,'-v','error','-y','-i',str(path),str(decoded)]
 result=subprocess.run(command,capture_output=True)
 assert result.returncode==0,f'Cannot decode {entry["id"]}'
 with wave.open(str(decoded),'rb') as audio:
  duration=audio.getnframes()/audio.getframerate()
  assert audio.getnchannels()==1 and audio.getframerate()==24000
  assert .25<duration<15 and any(audio.readframes(audio.getnframes())),f'Invalid audio for {entry["id"]}'
 entries.append({'text':entry['text'],'url':f'audio/sentences/a1/{digest}.mp3','voice':entry['voice'],'durationSeconds':round(duration,3)})
# Validate the whole batch before modifying published content. Changed text/voice
# creates a new immutable filename; unrelated batches and old assets are preserved.
assets=root/'public/audio/sentences/a1';assets.mkdir(parents=True,exist_ok=True)
for original,published in zip(batch['entries'],entries):
 shutil.copyfile(cache/Path(original['file']).name,root/'public'/published['url'])
target=root/'public/data/audio/sentences-a1.json';tmp=target.with_suffix('.tmp')
tmp.write_text(json.dumps({'schemaVersion':1,'provider':'microsoft-edge','entries':entries},ensure_ascii=False,indent=2)+'\n');tmp.replace(target)
print(f'Published {len(entries)} verified recordings, {sum(e["bytes"] for e in batch["entries"])/1e6:.2f} MB')
