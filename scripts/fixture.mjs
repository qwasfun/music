import {Mp3Encoder} from '@breezystack/lamejs';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('output/fixtures',{recursive:true});
const sampleRate=44100,seconds=18,encoder=new Mp3Encoder(1,sampleRate,128),out=[];
const samples=new Int16Array(sampleRate*seconds);
for(let i=0;i<samples.length;i++){const t=i/sampleRate;const envelope=Math.min(1,t/.1,(seconds-t)/.2)*.18;samples[i]=Math.round(Math.sin(2*Math.PI*440*t)*32767*envelope);}
for(let i=0;i<samples.length;i+=1152){const frame=encoder.encodeBuffer(samples.subarray(i,i+1152));if(frame.length)out.push(Buffer.from(frame));}out.push(Buffer.from(encoder.flush()));
await writeFile('output/fixtures/test-tone.mp3',Buffer.concat(out));
console.log('Generated an 18-second synthetic MP3 for playback testing');
