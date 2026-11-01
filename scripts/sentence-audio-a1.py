import asyncio, hashlib, json, random
from pathlib import Path
import aiohttp
import edge_tts

root=Path(__file__).resolve().parents[1]
source=root/'public/data/sentences-a1.json'
out=root/'build/sentence-audio-a1'
out.mkdir(parents=True,exist_ok=True)
rows=json.loads(source.read_text())
voices=['de-DE-KatjaNeural','de-DE-ConradNeural']
entries=[]

def valid_mp3(b): return len(b)>500 and (b[:3]==b'ID3' or (b[0]==255 and b[1]&224==224))
def checkpoint(status):
 value={'schemaVersion':1,'provider':'Microsoft Edge TTS','language':'de-DE','status':status,'requestedSentences':len(rows),'completedSentences':len(entries),'voices':voices,'entries':entries}
 tmp=out/'manifest.tmp';tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');tmp.replace(out/'manifest.json')

async def main():
 for index,row in enumerate(rows):
  text=row['target'].strip();voice=voices[index%2]
  key=hashlib.sha256(json.dumps({'text':text,'voice':voice,'rate':'+0%'},ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:16]
  filename=f"{row['id']}-{key}.mp3";path=out/filename
  if not path.exists() or not valid_mp3(path.read_bytes()):
   await asyncio.sleep(random.uniform(1.2,2.8))
   for attempt in range(3):
    try:
     tmp=path.with_suffix('.tmp')
     await asyncio.wait_for(edge_tts.Communicate(text,voice).save(str(tmp)),timeout=45)
     if not valid_mp3(tmp.read_bytes()):raise RuntimeError('Invalid MP3 response')
     tmp.replace(path);break
    except aiohttp.ClientResponseError as error:
     if error.status in (403,429) or attempt==2:raise RuntimeError(f'Service returned HTTP {error.status}; stopping without bypassing limits') from None
     await asyncio.sleep(2**(attempt+1)+random.uniform(0,2))
    except (aiohttp.ClientConnectionError,asyncio.TimeoutError):
     if attempt==2:raise
     await asyncio.sleep(2**(attempt+1)+random.uniform(0,2))
  entries.append({'id':row['id'],'text':text,'voice':voice,'file':filename,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
  checkpoint('in-progress');print(f'{len(entries)}/{len(rows)} {row["id"]} {voice}',flush=True)
 checkpoint('complete');print(f'COMPLETE {len(entries)} sentences, {sum(e["bytes"] for e in entries)} bytes',flush=True)
try:asyncio.run(main())
except BaseException as error:
 checkpoint('interrupted');print(f'STOPPED after {len(entries)} sentences: {type(error).__name__}: {error}',flush=True);raise
