import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvents } from '../src/ask/stream.ts';
const bytes = text => new TextEncoder().encode(text);
test('silent response is cancelled without discarding already delivered text', async () => {
 let cancelled=false; const events=[];
 const stream=new ReadableStream({start(c){c.enqueue(bytes('data: {"type":"token","delta":"partial"}\n\n'));},cancel(){cancelled=true;}});
 await assert.rejects(readEvents(stream,e=>events.push(e),{idleMs:15}),/went silent/);
 assert.equal(cancelled,true); assert.equal(events[0].delta,'partial'); assert.equal(stream.locked,false);
});
test('done completes even when the proxy leaves the connection open', async () => {
 let cancelled=false; const events=[];
 const stream=new ReadableStream({start(c){c.enqueue(bytes('data: {"type":"done","answer":"complete"}\n\n'));},cancel(){cancelled=true;}});
 await readEvents(stream,e=>events.push(e),{idleMs:15});
 assert.equal(events[0].answer,'complete'); assert.equal(cancelled,true);
});
test('chunked events and heartbeat comments are handled without losing final data',async()=>{
 const events=[];
 const stream=new ReadableStream({start(c){c.enqueue(bytes(': ping\n\ndata: {"type":"to'));c.enqueue(bytes('ken","delta":"ok"}\n\ndata: {"type":"done"}\n\n'));c.close();}});
 await readEvents(stream,e=>events.push(e));assert.deepEqual(events.map(e=>e.type),['token','done']);
});
