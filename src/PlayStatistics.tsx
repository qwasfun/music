import {useMemo,type ComponentProps} from 'react';
import {ChartNoAxesColumnIncreasing} from 'lucide-react';
import {TrackList} from './TrackList';

type Props=Omit<ComponentProps<typeof TrackList>,'selectedPlaylist'|'viewKey'>&{
  totalCount:number;
  ready:boolean;
  loading:boolean;
};

export function PlayStatistics({totalCount,ready,loading,tracks,playCounts,...listProps}:Props){
  const top=useMemo(()=>tracks.filter(track=>playCounts[track.id]>0)
    .sort((a,b)=>playCounts[b.id]-playCounts[a.id]).slice(0,10),[tracks,playCounts]);

  return <section className="play-statistics" aria-labelledby="play-statistics-title">
    <h1 id="play-statistics-title">播放统计</h1>
    {ready?<><div className="play-statistics-summary">
      <ChartNoAxesColumnIncreasing size={21} aria-hidden="true"/>
      <div>
        <h2>历史总播放次数</h2>
        <strong>{totalCount.toLocaleString('zh-CN')} 次</strong>
        <p>包含已删除歌曲。每轮听满 30 秒计一次，短于 60 秒的歌曲听满一半即可。</p>
      </div>
    </div>
    <h2 className="play-statistics-ranking">最常听</h2>
    {top.length?<TrackList {...listProps} tracks={top} playCounts={playCounts} viewKey="statistics"/>:
      <div className="empty-state"><ChartNoAxesColumnIncreasing size={25}/><p>曲库中还没有歌曲进入榜单。</p></div>}
    </>:<div className="empty-state">
      {loading?<p role="status">正在打开你的曲库</p>:<p>登录曲库后即可查看播放统计。</p>}
    </div>}
  </section>;
}
