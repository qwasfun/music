import {describe,expect,it} from 'vitest';
import {PlayAttempt} from '../src/play-attempt';

describe('effective plays',()=>{
  it('counts 30 seconds of media time once on a long track',()=>{
    const attempt=new PlayAttempt('long',120);
    attempt.resume(0,0,1);
    expect(attempt.sample(29.9,29900,1,120)).toBe(false);
    expect(attempt.sample(30,30000,1,120)).toBe(true);
    attempt.resume(0,31000,1);
    expect(attempt.sample(40,71000,1,120)).toBe(false);
  });

  it('uses half of the actual duration for a short track',()=>{
    const attempt=new PlayAttempt('short',120);
    attempt.resume(0,0,1);
    expect(attempt.sample(3,3000,1,8)).toBe(false);
    expect(attempt.sample(4,4000,1,8)).toBe(true);
  });

  it('preserves elapsed playback through pause, buffering and seeks',()=>{
    const attempt=new PlayAttempt('short',18);
    attempt.resume(0,0,1);
    expect(attempt.sample(3,3000,1,NaN)).toBe(false);
    attempt.suspend();
    expect(attempt.sample(8,12000,1,NaN)).toBe(false);
    attempt.resume(8,12000,1);
    expect(attempt.sample(8,22000,1,NaN)).toBe(false);
    expect(attempt.sample(14,22100,1,NaN)).toBe(false);
    expect(attempt.sample(17,25100,1,NaN)).toBe(false);
    attempt.suspend();
    attempt.resume(0,26000,1);
    expect(attempt.sample(3,29000,1,NaN)).toBe(true);
  });

  it('starts counting from the restored position and honors playback rate',()=>{
    const attempt=new PlayAttempt('restored',100);
    attempt.resume(35,0,2);
    expect(attempt.sample(63,14000,2,100)).toBe(false);
    expect(attempt.sample(65,15000,2,100)).toBe(true);
  });
});
