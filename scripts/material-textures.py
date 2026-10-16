#!/usr/bin/env python3
"""Regenerate the two seeded grayscale material textures; Python stdlib only."""
from pathlib import Path
import random,math,zlib,struct
root=Path(__file__).resolve().parents[1] / 'src/design';root.mkdir(exist_ok=True)
a=root/'assets';a.mkdir(exist_ok=True)
def png(name,w,h,values):
 def chunk(t,d):return struct.pack('!I',len(d))+t+d+struct.pack('!I',zlib.crc32(t+d)&0xffffffff)
 raw=b''.join(b'\0'+bytes(values[y*w:(y+1)*w]) for y in range(h))
 (a/name).write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,0,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))
r=random.Random(1947)
png('grain.png',256,256,[r.randrange(32,224) for _ in range(256*256)])
png('pigment.png',128,128,[round(128+28*math.sin(x*.13+math.sin(y*.08)*2)+24*math.cos(y*.11+x*.037)+r.uniform(-10,10)) for y in range(128) for x in range(128)])
